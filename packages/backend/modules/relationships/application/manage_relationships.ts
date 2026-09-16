import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import type {
  Failure,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import type {
  CreatePersonInput,
  CreatePersonResult,
  PeopleActor,
  PeopleTransaction,
  PersonIdentity,
  RelationshipPersonBoundary,
  TransactionalPeopleCreation,
} from "../../people/public.ts";
import type {
  RelationshipWorkspaceBoundary,
  WorkspaceRelationshipType,
  WorkspaceRelationshipTypeCursor,
} from "../../workspaces/public.ts";

export type RelationshipTypeOption = WorkspaceRelationshipType;

export interface RelationshipRecord {
  readonly createdAt: string;
  readonly forwardLabel: string;
  readonly fromPersonId: string;
  readonly id: string;
  readonly relationshipTypeId: string;
  readonly relationshipTypeArchived: boolean;
  readonly reverseLabel: string;
  readonly status: "active" | "ended";
  readonly toPersonId: string;
  readonly updatedAt: string;
}

export interface RelationshipAuditCommand {
  readonly action: "create" | "delete" | "update";
  readonly actor: PeopleActor;
  readonly after?: RelationshipRecord;
  readonly before?: RelationshipRecord;
  readonly occurredAt: Date;
  readonly transaction: PeopleTransaction;
}

export interface RelationshipAudit {
  record(command: RelationshipAuditCommand): Promise<string>;
  assertPostcondition(
    command: RelationshipAuditCommand & { readonly auditId: string },
  ): Promise<void>;
}

export interface RelationshipDisplay {
  readonly label: string;
  readonly name?: string;
  readonly personId: string;
  readonly relationshipId: string;
}

export interface RelationshipCursor {
  readonly createdAt: string;
  readonly id: string;
}

export type RelationshipLock =
  | { readonly relationship: RelationshipRecord; readonly status: "ready" }
  | Failure<"not-found">;

export interface RelationshipRepository {
  list(
    command: PeopleActor & {
      readonly after?: RelationshipCursor;
      readonly limit: number;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | {
      readonly records: readonly RelationshipRecord[];
      readonly status: "ready";
    }
    | { readonly status: "stale-cursor" }
  >;
  get(
    command: PeopleActor & {
      readonly personId: string;
      readonly relationshipId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<RelationshipRecord | undefined>;
  lockRelationship(
    command: PeopleActor & {
      readonly personId: string;
      readonly relationshipId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<RelationshipLock>;
  findExact(
    command: PeopleActor & {
      readonly relationshipTypeId: string;
      readonly sourcePersonId: string;
      readonly targetPersonId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<RelationshipRecord | undefined>;
  create(
    command: PeopleActor & {
      readonly id: string;
      readonly occurredAt: Date;
      readonly sourcePersonId: string;
      readonly targetPersonId: string;
      readonly transaction: PeopleTransaction;
      readonly type: RelationshipTypeOption;
    },
  ): Promise<RelationshipRecord | undefined>;
  update(
    command: PeopleActor & {
      readonly occurredAt: Date;
      readonly relationshipId: string;
      readonly transaction: PeopleTransaction;
      readonly type: RelationshipTypeOption;
    },
  ): Promise<RelationshipRecord | undefined>;
  delete(
    command: PeopleActor & {
      readonly relationshipId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<boolean>;
  assertPostcondition(
    command: PeopleActor & {
      readonly action: "create" | "delete" | "update";
      readonly after?: RelationshipRecord;
      readonly before?: RelationshipRecord;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
}

export interface RelationshipDependencies {
  readonly audit: RelationshipAudit;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly people: RelationshipPersonBoundary;
  readonly peopleCreation: TransactionalPeopleCreation;
  readonly repository: RelationshipRepository;
  readonly transaction: {
    run<T>(work: (transaction: PeopleTransaction) => Promise<T>): Promise<T>;
  };
  readonly workspace: RelationshipWorkspaceBoundary;
}

type MutationFailure =
  | Failure<"archived-write-rejected" | "forbidden" | "not-found", "stale">
  | ValidationFailure;

type MutationSuccess = {
  readonly affectedPersonIds: readonly [string, string];
  readonly forward: RelationshipDisplay;
  readonly inverse: RelationshipDisplay;
  readonly relationship: RelationshipRecord;
};

type RelatedPersonFailure =
  | Exclude<CreatePersonResult, { readonly status: "created" }>
  | MutationFailure;

export type RelatedPersonRelationshipResult =
  | RelatedPersonFailure
  | (MutationSuccess & {
    readonly person: PersonIdentity;
    readonly status: "created";
  });

class RelatedPersonAbort extends Error {
  constructor(readonly result: RelatedPersonFailure) {
    super("Atomic related-person creation aborted.");
  }
}

interface EncodedRelationshipCursor extends RelationshipCursor {
  readonly personId: string;
  readonly version: 1;
  readonly workspaceId: string;
}

interface EncodedRelationshipTypeCursor
  extends WorkspaceRelationshipTypeCursor {
  readonly search: string;
  readonly version: 1;
  readonly workspaceId: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function base64UrlEncode(value: string): string {
  const binary = Array.from(
    new TextEncoder().encode(value),
    (byte) => String.fromCharCode(byte),
  ).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

function base64UrlDecode(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + (4 - normalized.length % 4) % 4,
    "=",
  );
  const bytes = Uint8Array.from(
    atob(padded),
    (character) => character.charCodeAt(0),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function encodeCursor(
  record: RelationshipRecord,
  actor: PeopleActor,
  personId: string,
): string {
  return base64UrlEncode(JSON.stringify(
    {
      createdAt: record.createdAt,
      id: record.id,
      personId,
      version: 1,
      workspaceId: actor.workspaceId,
    } satisfies EncodedRelationshipCursor,
  ));
}

function decodeCursor(
  value: string,
  actor: PeopleActor,
  personId: string,
): RelationshipCursor | undefined {
  try {
    const parsed = JSON.parse(
      base64UrlDecode(value),
    ) as Partial<EncodedRelationshipCursor>;
    if (
      parsed.version !== 1 || parsed.workspaceId !== actor.workspaceId ||
      parsed.personId !== personId || !UUID_PATTERN.test(parsed.id ?? "") ||
      !Number.isFinite(Date.parse(parsed.createdAt ?? ""))
    ) return undefined;
    return { createdAt: parsed.createdAt!, id: parsed.id! };
  } catch {
    return undefined;
  }
}

function encodeTypeCursor(
  cursor: WorkspaceRelationshipTypeCursor,
  actor: PeopleActor,
  search: string,
): string {
  return base64UrlEncode(JSON.stringify(
    {
      ...cursor,
      search,
      version: 1,
      workspaceId: actor.workspaceId,
    } satisfies EncodedRelationshipTypeCursor,
  ));
}

function decodeTypeCursor(
  value: string,
  actor: PeopleActor,
  search: string,
): WorkspaceRelationshipTypeCursor | undefined {
  try {
    const parsed = JSON.parse(
      base64UrlDecode(value),
    ) as Partial<EncodedRelationshipTypeCursor>;
    if (
      parsed.version !== 1 || parsed.workspaceId !== actor.workspaceId ||
      parsed.search !== search || !UUID_PATTERN.test(parsed.id ?? "") ||
      typeof parsed.forwardLabel !== "string" ||
      !Number.isSafeInteger(parsed.sortOrder)
    ) return undefined;
    return {
      forwardLabel: parsed.forwardLabel,
      id: parsed.id!,
      sortOrder: parsed.sortOrder!,
    };
  } catch {
    return undefined;
  }
}

function displays(
  record: RelationshipRecord,
  personId: string,
  name?: string,
): RelationshipDisplay {
  const forward = record.fromPersonId === personId;
  return {
    label: forward ? record.forwardLabel : record.reverseLabel,
    ...(name ? { name } : {}),
    personId: forward ? record.toPersonId : record.fromPersonId,
    relationshipId: record.id,
  };
}

function decorate(
  record: RelationshipRecord,
  type: RelationshipTypeOption,
): RelationshipRecord {
  return {
    ...record,
    forwardLabel: type.forwardLabel,
    relationshipTypeArchived: type.archived,
    reverseLabel: type.reverseLabel,
  };
}

function success<T extends "created" | "existing" | "updated">(
  record: RelationshipRecord,
  status: T,
) {
  return {
    affectedPersonIds: [record.fromPersonId, record.toPersonId] as const,
    forward: displays(record, record.fromPersonId),
    inverse: displays(record, record.toPersonId),
    relationship: record,
    status,
  };
}

export function createRelationshipManagement(
  dependencies: RelationshipDependencies,
) {
  const inspectMutation = async (
    actor: PeopleActor,
    transaction: PeopleTransaction,
    personIds: readonly string[],
    relationshipTypeId?: string,
  ): Promise<
    MutationFailure | {
      readonly status: "ready";
      readonly type?: RelationshipTypeOption;
    }
  > => {
    const defaults = await dependencies.workspace
      .ensureDefaultRelationshipTypes(
        { ...actor, transaction },
      );
    if (defaults.status !== "ready") return { status: "forbidden" };
    const workspace = await dependencies.workspace.inspect({
      ...actor,
      lock: true,
      ...(relationshipTypeId ? { relationshipTypeId } : {}),
      transaction,
    });
    if (workspace.status === "forbidden" || workspace.status === "hidden") {
      return { status: "forbidden" };
    }
    if (workspace.status === "not-found") return { status: "not-found" };
    const people = await dependencies.people.inspect({
      ...actor,
      lock: true,
      personIds,
      transaction,
    });
    if (people.status === "not-found") return { status: "not-found" };
    if (people.status === "archived") {
      return { status: "archived-write-rejected" };
    }
    const type = workspace.status === "ready" ? workspace.type : undefined;
    return { status: "ready", ...(type ? { type } : {}) };
  };
  const audit = async (
    action: "create" | "delete" | "update",
    actor: PeopleActor,
    transaction: PeopleTransaction,
    occurredAt: Date,
    before: RelationshipRecord | undefined,
    after: RelationshipRecord | undefined,
  ) => {
    const command = {
      action,
      actor,
      ...(after ? { after } : {}),
      ...(before ? { before } : {}),
      occurredAt,
      transaction,
    };
    const auditId = await dependencies.audit.record(command);
    await dependencies.repository.assertPostcondition({
      action,
      ...actor,
      ...(after ? { after } : {}),
      ...(before ? { before } : {}),
      transaction,
    });
    await dependencies.audit.assertPostcondition({ ...command, auditId });
  };
  const createInTransaction = async (
    actor: PeopleActor,
    sourcePersonId: string,
    input: {
      readonly relationshipTypeId: string;
      readonly targetPersonId: string;
    },
    transaction: PeopleTransaction,
  ): Promise<
    | MutationFailure
    | (MutationSuccess & { readonly status: "created" | "existing" })
  > => {
    if (sourcePersonId === input.targetPersonId) {
      return {
        errors: { targetPersonId: "Choose another person." },
        status: "validation-error",
      };
    }
    const context = await inspectMutation(actor, transaction, [
      sourcePersonId,
      input.targetPersonId,
    ], input.relationshipTypeId);
    if (context.status !== "ready") return context;
    if (!context.type) return { status: "not-found" };
    const occurredAt = dependencies.clock.now();
    const record = await dependencies.repository.create({
      ...actor,
      id: dependencies.ids.create(),
      occurredAt,
      sourcePersonId,
      targetPersonId: input.targetPersonId,
      transaction,
      type: context.type,
    });
    if (!record) {
      const existing = await dependencies.repository.findExact({
        ...actor,
        relationshipTypeId: input.relationshipTypeId,
        sourcePersonId,
        targetPersonId: input.targetPersonId,
        transaction,
      });
      return existing
        ? success(decorate(existing, context.type), "existing")
        : { status: "stale" };
    }
    await audit("create", actor, transaction, occurredAt, undefined, record);
    return success(record, "created");
  };
  return {
    listTypes: (
      actor: PeopleActor,
      input: {
        readonly cursor?: string;
        readonly search?: string;
        readonly selectedTypeIds?: readonly string[];
      } = {},
    ) =>
      dependencies.transaction.run(async (transaction) => {
        const search = input.search?.trim() ?? "";
        const after = input.cursor
          ? decodeTypeCursor(input.cursor, actor, search)
          : undefined;
        if (input.cursor && !after) {
          return { status: "stale-cursor" as const };
        }
        const defaults = await dependencies.workspace
          .ensureDefaultRelationshipTypes({ ...actor, transaction });
        if (defaults.status === "hidden") {
          return { options: [], selected: [], status: "hidden" as const };
        }
        if (defaults.status === "forbidden") return defaults;
        const page = await dependencies.workspace.listTypes({
          ...actor,
          ...(after ? { after } : {}),
          limit: 21,
          ...(search ? { search } : {}),
          transaction,
        });
        if (page.status === "hidden") {
          return {
            options: [],
            selected: [],
            status: "hidden" as const,
          };
        }
        if (page.status !== "ready") return page;
        const visible = page.records.slice(0, 20);
        const hydration = await dependencies.workspace.hydrateTypes({
          ...actor,
          relationshipTypeIds: [...new Set(input.selectedTypeIds ?? [])].slice(
            0,
            20,
          ),
          transaction,
        });
        if (hydration.status === "hidden") {
          return {
            options: [],
            selected: [],
            status: "hidden" as const,
          };
        }
        if (hydration.status === "forbidden") return hydration;
        const final = visible.at(-1);
        return {
          ...(page.records.length > 20 && final
            ? { nextCursor: encodeTypeCursor(final.cursor, actor, search) }
            : {}),
          options: visible.map(({ cursor: _cursor, ...option }) => option),
          selected: hydration.records,
          status: "ready" as const,
        };
      }),
    list: (
      actor: PeopleActor,
      personId: string,
      input: { readonly cursor?: string; readonly limit?: number } = {},
    ) =>
      dependencies.transaction.run(async (transaction) => {
        const workspace = await dependencies.workspace
          .ensureDefaultRelationshipTypes({ ...actor, transaction });
        if (workspace.status === "forbidden") {
          return { status: "forbidden" as const };
        }
        if (workspace.status === "hidden") {
          return { relationships: [], status: "hidden" as const };
        }
        const subject = await dependencies.people.inspect({
          ...actor,
          lock: false,
          personIds: [personId],
          transaction,
        });
        if (subject.status === "not-found") {
          return { status: "not-found" as const };
        }
        const limit = Math.max(1, Math.min(20, Math.trunc(input.limit ?? 20)));
        const after = input.cursor
          ? decodeCursor(input.cursor, actor, personId)
          : undefined;
        if (input.cursor && !after) {
          return { status: "stale-cursor" as const };
        }
        const page = await dependencies.repository.list({
          ...actor,
          ...(after ? { after } : {}),
          limit: limit + 1,
          personId,
          transaction,
        });
        if (page.status !== "ready") return page;
        const visible = page.records.slice(0, limit);
        const typeHydration = await dependencies.workspace.hydrateTypes({
          ...actor,
          relationshipTypeIds: visible.map((record) =>
            record.relationshipTypeId
          ),
          transaction,
        });
        if (typeHydration.status === "hidden") {
          return { relationships: [], status: "hidden" as const };
        }
        if (typeHydration.status === "forbidden") return typeHydration;
        const byId = new Map(
          typeHydration.records.map((type) => [type.id, type]),
        );
        const endpointIds = [
          ...new Set(visible.flatMap((record) => [
            record.fromPersonId,
            record.toPersonId,
          ])),
        ];
        const summaries = await dependencies.people.summarize({
          ...actor,
          personIds: endpointIds,
          transaction,
        });
        const summaryById = new Map(summaries.map((summary) => [
          summary.id,
          summary,
        ]));
        const relationships = visible.flatMap((record) => {
          const type = byId.get(record.relationshipTypeId);
          if (
            !type || !summaryById.has(record.fromPersonId) ||
            !summaryById.has(record.toPersonId)
          ) return [];
          const hydrated = decorate(record, type);
          const displayed = displays(hydrated, personId);
          const summary = summaryById.get(displayed.personId);
          return [{
            ...hydrated,
            display: {
              ...displayed,
              name: summary!.name,
            },
          }];
        });
        const final = visible.at(-1);
        return {
          ...(page.records.length > limit && final
            ? { nextCursor: encodeCursor(final, actor, personId) }
            : {}),
          relationships,
          status: subject.status,
        };
      }),
    create: async (
      actor: PeopleActor,
      sourcePersonId: string,
      input: {
        readonly relationshipTypeId: string;
        readonly targetPersonId: string;
      },
    ): Promise<
      | MutationFailure
      | (MutationSuccess & { readonly status: "created" | "existing" })
    > => {
      return await dependencies.transaction.run((transaction) =>
        createInTransaction(actor, sourcePersonId, input, transaction)
      );
    },
    createRelatedPerson: async (
      actor: PeopleActor,
      sourcePersonId: string,
      input: {
        readonly person: CreatePersonInput;
        readonly relationshipTypeId: string;
      },
    ): Promise<RelatedPersonRelationshipResult> => {
      try {
        return await dependencies.transaction.run(async (transaction) => {
          const defaults = await dependencies.workspace
            .ensureDefaultRelationshipTypes({ ...actor, transaction });
          if (defaults.status !== "ready") return { status: "forbidden" };
          const person = await dependencies.peopleCreation.createInTransaction(
            actor,
            input.person,
            transaction,
          );
          if (person.status !== "created") return person;
          const relationship = await createInTransaction(
            actor,
            sourcePersonId,
            {
              relationshipTypeId: input.relationshipTypeId,
              targetPersonId: person.person.id,
            },
            transaction,
          );
          if (!("relationship" in relationship)) {
            throw new RelatedPersonAbort(relationship);
          }
          return {
            ...relationship,
            person: person.person,
            status: "created" as const,
          };
        });
      } catch (error) {
        if (error instanceof RelatedPersonAbort) return error.result;
        throw error;
      }
    },
    update: async (
      actor: PeopleActor,
      personId: string,
      relationshipId: string,
      input: {
        readonly expectedUpdatedAt: string;
        readonly relationshipTypeId: string;
      },
    ): Promise<
      MutationFailure | (MutationSuccess & { readonly status: "updated" })
    > => {
      if (!Number.isFinite(Date.parse(input.expectedUpdatedAt))) {
        return {
          errors: { expectedUpdatedAt: "Refresh relationships before saving." },
          status: "validation-error",
        };
      }
      return await dependencies.transaction.run(async (transaction) => {
        const observed = await dependencies.repository.get({
          ...actor,
          personId,
          relationshipId,
          transaction,
        });
        if (!observed) return { status: "not-found" };
        const context = await inspectMutation(actor, transaction, [
          observed.fromPersonId,
          observed.toPersonId,
        ], input.relationshipTypeId);
        if (context.status !== "ready") return context;
        if (!context.type) return { status: "not-found" };
        const locked = await dependencies.repository.lockRelationship({
          ...actor,
          personId,
          relationshipId,
          transaction,
        });
        if (locked.status !== "ready") return locked;
        if (locked.relationship.updatedAt !== input.expectedUpdatedAt) {
          return { status: "stale" };
        }
        const occurredAt = dependencies.clock.now();
        const record = await dependencies.repository.update({
          ...actor,
          occurredAt,
          relationshipId,
          transaction,
          type: context.type,
        });
        if (!record) return { status: "stale" };
        await audit(
          "update",
          actor,
          transaction,
          occurredAt,
          locked.relationship,
          record,
        );
        return success(record, "updated");
      });
    },
    delete: async (
      actor: PeopleActor,
      personId: string,
      relationshipId: string,
      input: { readonly expectedUpdatedAt: string },
    ) => {
      if (!Number.isFinite(Date.parse(input.expectedUpdatedAt))) {
        return {
          errors: {
            expectedUpdatedAt: "Refresh relationships before unlinking.",
          },
          status: "validation-error" as const,
        };
      }
      return await dependencies.transaction.run(async (transaction) => {
        const observed = await dependencies.repository.get({
          ...actor,
          personId,
          relationshipId,
          transaction,
        });
        if (!observed) return { status: "not-found" as const };
        const context = await inspectMutation(actor, transaction, [
          observed.fromPersonId,
          observed.toPersonId,
        ]);
        if (context.status !== "ready") return context;
        const locked = await dependencies.repository.lockRelationship({
          ...actor,
          personId,
          relationshipId,
          transaction,
        });
        if (locked.status !== "ready") return locked;
        if (locked.relationship.updatedAt !== input.expectedUpdatedAt) {
          return { status: "stale" as const };
        }
        const occurredAt = dependencies.clock.now();
        if (
          !(await dependencies.repository.delete({
            ...actor,
            relationshipId,
            transaction,
          }))
        ) return { status: "stale" as const };
        await audit(
          "delete",
          actor,
          transaction,
          occurredAt,
          locked.relationship,
          undefined,
        );
        return {
          affectedPersonIds: [
            locked.relationship.fromPersonId,
            locked.relationship.toPersonId,
          ] as const,
          relationshipId,
          status: "deleted" as const,
        };
      });
    },
  };
}

export type RelationshipManagement = ReturnType<
  typeof createRelationshipManagement
>;
