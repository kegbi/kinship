import type {
  InteractionPersonBoundary,
  PeopleActor,
  PeopleTransaction,
} from "../../people/public.ts";

export interface InteractionParticipant {
  readonly id: string;
  readonly name: string;
}

export interface InteractionOption {
  readonly id: string;
  readonly name: string;
}

export interface InteractionAvailability {
  readonly activity: boolean;
  readonly note: boolean;
}

export interface ActivityRecord {
  readonly activityType?: string;
  readonly createdAt: string;
  readonly description?: string;
  readonly emotions: readonly InteractionOption[];
  readonly happenedAt: string;
  readonly id: string;
  readonly kind: "activity";
  readonly participants: readonly InteractionParticipant[];
  readonly summary: string;
}

export interface NoteRecord {
  readonly body: string;
  readonly createdAt: string;
  readonly id: string;
  readonly isFavorited: boolean;
  readonly kind: "note";
  readonly person: InteractionParticipant;
}

export type InteractionRecord = ActivityRecord | NoteRecord;

export type StoredInteraction =
  | {
    readonly activityTypeId?: string;
    readonly createdAt: string;
    readonly createdByMemberId?: string;
    readonly description?: string;
    readonly emotionIds: readonly string[];
    readonly happenedAt: string;
    readonly id: string;
    readonly kind: "activity";
    readonly participantIds: readonly string[];
    readonly summary: string;
  }
  | {
    readonly body: string;
    readonly createdAt: string;
    readonly createdByMemberId?: string;
    readonly id: string;
    readonly isFavorited: boolean;
    readonly kind: "note";
    readonly personId: string;
  };

export interface InteractionWorkspaceBoundary {
  authorize(
    command: PeopleActor & {
      readonly transaction: PeopleTransaction;
    },
  ): Promise<{ readonly status: "forbidden" | "ready" }>;
  describe(
    command: {
      readonly activityTypeId?: string;
      readonly emotionIds: readonly string[];
      readonly transaction: PeopleTransaction;
      readonly workspaceId: string;
    },
  ): Promise<{
    readonly activityType?: InteractionOption;
    readonly emotions: readonly InteractionOption[];
  }>;
  inspect(
    command: PeopleActor & {
      readonly activityTypeId?: string;
      readonly emotionIds: readonly string[];
      readonly kind: "activity" | "note";
      readonly lock: boolean;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | {
      readonly activityType?: InteractionOption;
      readonly emotions: readonly InteractionOption[];
      readonly status: "ready";
    }
    | { readonly status: "forbidden" | "hidden" | "not-found" }
  >;
  options(
    command: PeopleActor & {
      readonly activityTypeCursor?: string;
      readonly activityTypeSearch?: string;
      readonly emotionCursor?: string;
      readonly emotionSearch?: string;
      readonly limit: number;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | {
      readonly activityTypes: readonly InteractionOption[];
      readonly activityTypesNextCursor?: string;
      readonly availability: InteractionAvailability;
      readonly emotions: readonly InteractionOption[];
      readonly emotionsNextCursor?: string;
      readonly status: "ready";
    }
    | { readonly status: "forbidden" | "stale-cursor" }
  >;
}

export interface InteractionRepository {
  lockRequest(command: {
    readonly id: string;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
  findRequest(
    command: {
      readonly id: string;
      readonly transaction: PeopleTransaction;
      readonly workspaceId: string;
    },
  ): Promise<
    | { readonly status: "absent" }
    | { readonly interaction: StoredInteraction; readonly status: "found" }
  >;
  createActivity(
    command: PeopleActor & {
      readonly activityType?: InteractionOption;
      readonly description?: string;
      readonly emotions: readonly InteractionOption[];
      readonly happenedAt: Date;
      readonly id: string;
      readonly occurredAt: Date;
      readonly participantIds: readonly string[];
      readonly participants: readonly InteractionParticipant[];
      readonly summary: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<ActivityRecord | undefined>;
  createNote(
    command: PeopleActor & {
      readonly body: string;
      readonly id: string;
      readonly isFavorited: boolean;
      readonly occurredAt: Date;
      readonly person: InteractionParticipant;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<NoteRecord | undefined>;
  assertPostcondition(
    command: PeopleActor & {
      readonly record: InteractionRecord;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
}

export interface InteractionAudit {
  record(command: {
    readonly actor: PeopleActor;
    readonly occurredAt: Date;
    readonly record: InteractionRecord;
    readonly transaction: PeopleTransaction;
  }): Promise<string>;
  assertPostcondition(command: {
    readonly actor: PeopleActor;
    readonly auditId: string;
    readonly occurredAt: Date;
    readonly record: InteractionRecord;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
}

export type RecordInteractionInput =
  | {
    readonly activityTypeId?: string;
    readonly description?: string;
    readonly emotionIds?: readonly string[];
    readonly happenedAt: string;
    readonly kind: "activity";
    readonly participantIds: readonly string[];
    readonly requestId: string;
    readonly summary: string;
  }
  | {
    readonly body: string;
    readonly isFavorited?: boolean;
    readonly kind: "note";
    readonly personId: string;
    readonly requestId: string;
  };

export type RecordInteractionResult =
  | { readonly record: InteractionRecord; readonly status: "created" }
  | {
    readonly status:
      | "archived-write-rejected"
      | "forbidden"
      | "hidden"
      | "idempotency-conflict"
      | "not-found";
  }
  | {
    readonly errors: Readonly<Record<string, string>>;
    readonly status: "validation-error";
  };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalUuid(value: string): string {
  return value.toLowerCase();
}

async function deriveInteractionId(
  workspaceId: string,
  requestId: string,
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        `kinship.interactions.aggregate-id.v1\u0000${workspaceId.toLowerCase()}\u0000${requestId.toLowerCase()}`,
      ),
    ),
  );
  digest[6] = (digest[6]! & 0x0f) | 0x80;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = [...digest.slice(0, 16)].map((value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`;
}

function matchesExpected(
  stored: StoredInteraction,
  expected:
    | {
      readonly activityTypeId?: string;
      readonly description?: string;
      readonly emotionIds: readonly string[];
      readonly happenedAt: Date;
      readonly kind: "activity";
      readonly participantIds: readonly string[];
      readonly summary: string;
    }
    | {
      readonly body: string;
      readonly isFavorited: boolean;
      readonly kind: "note";
      readonly personId: string;
    },
  memberId: string,
): boolean {
  if (stored.createdByMemberId !== memberId || stored.kind !== expected.kind) {
    return false;
  }
  return stored.kind === "activity" && expected.kind === "activity"
    ? stored.activityTypeId === expected.activityTypeId &&
      stored.description === expected.description &&
      stored.happenedAt === expected.happenedAt.toISOString() &&
      stored.summary === expected.summary &&
      stored.participantIds.join(",") === expected.participantIds.join(",") &&
      stored.emotionIds.join(",") === expected.emotionIds.join(",")
    : stored.kind === "note" && expected.kind === "note" &&
      stored.personId === expected.personId && stored.body === expected.body &&
      stored.isFavorited === expected.isFavorited;
}

function nonBlank(value: string, maximum: number): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum
    ? normalized
    : undefined;
}

function validate(input: RecordInteractionInput):
  | { readonly errors: Readonly<Record<string, string>> }
  | {
    readonly activityTypeId?: string;
    readonly body?: string;
    readonly description?: string;
    readonly emotionIds: readonly string[];
    readonly happenedAt?: Date;
    readonly participantIds: readonly string[];
    readonly requestId: string;
    readonly summary?: string;
  } {
  const errors: Record<string, string> = {};
  if (!UUID_PATTERN.test(input.requestId)) {
    errors.requestId = "Use a canonical request identifier.";
  }
  if (input.kind === "note") {
    const body = nonBlank(input.body, 10_000);
    if (!body) errors.body = "Write a note of at most 10,000 characters.";
    if (!UUID_PATTERN.test(input.personId)) {
      errors.personId = "Choose one person from this workspace.";
    }
    return Object.keys(errors).length > 0 ? { errors } : {
      body: body!,
      emotionIds: [],
      participantIds: [canonicalUuid(input.personId)],
      requestId: canonicalUuid(input.requestId),
    };
  }
  const summary = nonBlank(input.summary, 500);
  if (!summary) errors.summary = "Add a summary of at most 500 characters.";
  const description = input.description === undefined
    ? undefined
    : nonBlank(input.description, 10_000);
  if (input.description !== undefined && !description) {
    errors.description = "Details must be at most 10,000 characters.";
  }
  const happenedAt = new Date(input.happenedAt);
  if (!Number.isFinite(happenedAt.getTime())) {
    errors.happenedAt = "Choose a valid occurrence time.";
  }
  const participantIds = [
    ...new Set(input.participantIds.map(canonicalUuid)),
  ].sort();
  if (
    input.participantIds.length === 0 || input.participantIds.length > 50 ||
    participantIds.some((id) => !UUID_PATTERN.test(id))
  ) {
    errors.participantIds = "Choose between 1 and 50 valid people.";
  }
  const rawEmotions = input.emotionIds ?? [];
  const emotionIds = [...new Set(rawEmotions.map(canonicalUuid))].sort();
  if (
    rawEmotions.length > 20 ||
    emotionIds.some((id) => !UUID_PATTERN.test(id))
  ) {
    errors.emotionIds = "Choose at most 20 active emotions.";
  }
  if (input.activityTypeId && !UUID_PATTERN.test(input.activityTypeId)) {
    errors.activityTypeId = "Choose an active activity type.";
  }
  return Object.keys(errors).length > 0 ? { errors } : {
    ...(input.activityTypeId
      ? { activityTypeId: canonicalUuid(input.activityTypeId) }
      : {}),
    ...(description ? { description } : {}),
    emotionIds,
    happenedAt,
    participantIds,
    requestId: canonicalUuid(input.requestId),
    summary: summary!,
  };
}

export function createInteractionManagement(dependencies: {
  readonly audit: InteractionAudit;
  readonly clock: { now(): Date };
  readonly people: InteractionPersonBoundary;
  readonly publisher?: InteractionRecordedPublisher;
  readonly repository: InteractionRepository;
  readonly transaction: {
    run<T>(work: (transaction: PeopleTransaction) => Promise<T>): Promise<T>;
  };
  readonly workspace: InteractionWorkspaceBoundary;
}) {
  return {
    options: (
      actor: PeopleActor,
      input: {
        readonly activityTypeCursor?: string;
        readonly activityTypeSearch?: string;
        readonly emotionCursor?: string;
        readonly emotionSearch?: string;
        readonly limit?: number;
      } = {},
    ) =>
      dependencies.transaction.run((transaction) =>
        dependencies.workspace.options({
          ...actor,
          ...(input.activityTypeCursor
            ? { activityTypeCursor: input.activityTypeCursor }
            : {}),
          ...(input.activityTypeSearch?.trim()
            ? { activityTypeSearch: input.activityTypeSearch.trim() }
            : {}),
          ...(input.emotionCursor
            ? { emotionCursor: input.emotionCursor }
            : {}),
          ...(input.emotionSearch?.trim()
            ? { emotionSearch: input.emotionSearch.trim() }
            : {}),
          limit: Math.max(1, Math.min(20, Math.trunc(input.limit ?? 20))),
          transaction,
        })
      ),
    record: async (
      actor: PeopleActor,
      input: RecordInteractionInput,
    ): Promise<RecordInteractionResult> => {
      const checked = validate(input);
      if ("errors" in checked) {
        return { errors: checked.errors, status: "validation-error" };
      }
      const canonicalActor = {
        ...actor,
        memberId: canonicalUuid(actor.memberId),
        userId: canonicalUuid(actor.userId),
        workspaceId: canonicalUuid(actor.workspaceId),
      };
      return await dependencies.transaction.run(async (transaction) => {
        const authorization = await dependencies.workspace.authorize({
          ...canonicalActor,
          transaction,
        });
        if (authorization.status !== "ready") {
          return { status: "forbidden" as const };
        }
        const id = await deriveInteractionId(
          canonicalActor.workspaceId,
          checked.requestId,
        );
        await dependencies.repository.lockRequest({
          id,
          transaction,
        });
        const expected = input.kind === "activity"
          ? {
            ...(checked.activityTypeId
              ? { activityTypeId: checked.activityTypeId }
              : {}),
            ...(checked.description
              ? { description: checked.description }
              : {}),
            emotionIds: checked.emotionIds,
            happenedAt: checked.happenedAt!,
            kind: "activity" as const,
            participantIds: checked.participantIds,
            summary: checked.summary!,
          }
          : {
            body: checked.body!,
            isFavorited: input.isFavorited === true,
            kind: "note" as const,
            personId: checked.participantIds[0]!,
          };
        const replay = await dependencies.repository.findRequest({
          id,
          transaction,
          workspaceId: canonicalActor.workspaceId,
        });
        if (replay.status === "found") {
          if (
            !matchesExpected(
              replay.interaction,
              expected,
              canonicalActor.memberId,
            )
          ) {
            return { status: "idempotency-conflict" as const };
          }
          if (replay.interaction.kind === "activity") {
            const [summaries, descriptors] = await Promise.all([
              dependencies.people.summarize({
                ...canonicalActor,
                personIds: replay.interaction.participantIds,
                transaction,
              }),
              dependencies.workspace.describe({
                ...(replay.interaction.activityTypeId
                  ? { activityTypeId: replay.interaction.activityTypeId }
                  : {}),
                emotionIds: replay.interaction.emotionIds,
                transaction,
                workspaceId: canonicalActor.workspaceId,
              }),
            ]);
            return {
              record: {
                ...(descriptors.activityType
                  ? { activityType: descriptors.activityType.name }
                  : {}),
                createdAt: replay.interaction.createdAt,
                ...(replay.interaction.description
                  ? { description: replay.interaction.description }
                  : {}),
                emotions: descriptors.emotions,
                happenedAt: replay.interaction.happenedAt,
                id,
                kind: "activity",
                participants: summaries.map(({ id, name }) => ({ id, name })),
                summary: replay.interaction.summary,
              },
              status: "created" as const,
            };
          }
          const summaries = await dependencies.people.summarize({
            ...canonicalActor,
            personIds: [replay.interaction.personId],
            transaction,
          });
          const person = summaries[0];
          if (!person || person.id !== replay.interaction.personId) {
            return { status: "not-found" as const };
          }
          return {
            record: {
              body: replay.interaction.body,
              createdAt: replay.interaction.createdAt,
              id,
              isFavorited: replay.interaction.isFavorited,
              kind: "note",
              person: { id: person.id, name: person.name },
            },
            status: "created" as const,
          };
        }
        const workspace = await dependencies.workspace.inspect({
          ...canonicalActor,
          ...(input.kind === "activity" && checked.activityTypeId
            ? { activityTypeId: checked.activityTypeId }
            : {}),
          emotionIds: checked.emotionIds,
          kind: input.kind,
          lock: true,
          transaction,
        });
        if (workspace.status !== "ready") return workspace;
        const people = await dependencies.people.inspect({
          ...canonicalActor,
          lock: true,
          personIds: checked.participantIds,
          transaction,
        });
        if (people.status !== "ready") {
          return people.status === "archived"
            ? { status: "archived-write-rejected" as const }
            : { status: "not-found" as const };
        }
        const summaries = await dependencies.people.summarize({
          ...canonicalActor,
          personIds: checked.participantIds,
          transaction,
        });
        if (summaries.length !== checked.participantIds.length) {
          return { status: "not-found" as const };
        }
        const participants = summaries.map(({ id, name }) => ({ id, name }));
        const occurredAt = dependencies.clock.now();
        const record = input.kind === "activity"
          ? await dependencies.repository.createActivity({
            ...canonicalActor,
            ...(workspace.activityType
              ? { activityType: workspace.activityType }
              : {}),
            ...(checked.description
              ? { description: checked.description }
              : {}),
            emotions: workspace.emotions,
            happenedAt: checked.happenedAt!,
            id,
            occurredAt,
            participantIds: checked.participantIds,
            participants,
            summary: checked.summary!,
            transaction,
          })
          : await dependencies.repository.createNote({
            ...canonicalActor,
            body: checked.body!,
            id,
            isFavorited: input.isFavorited === true,
            occurredAt,
            person: participants[0]!,
            personId: checked.participantIds[0]!,
            transaction,
          });
        if (!record) return { status: "not-found" as const };
        const auditCommand = {
          actor: canonicalActor,
          occurredAt,
          record,
          transaction,
        };
        const auditId = await dependencies.audit.record(auditCommand);
        await dependencies.repository.assertPostcondition({
          ...canonicalActor,
          record,
          transaction,
        });
        await dependencies.audit.assertPostcondition({
          ...auditCommand,
          auditId,
        });
        if (record.kind === "activity") {
          await dependencies.publisher?.interactionRecorded({
            happenedAt: record.happenedAt,
            memberId: canonicalActor.memberId,
            personIds: record.participants.map((person) => person.id),
            transaction,
            workspaceId: canonicalActor.workspaceId,
          });
        }
        return { record, status: "created" as const };
      });
    },
  };
}

export interface InteractionRecordedPublisher {
  interactionRecorded(event: {
    readonly happenedAt: string;
    readonly memberId: string;
    readonly personIds: readonly string[];
    readonly transaction: PeopleTransaction;
    readonly workspaceId: string;
  }): Promise<void>;
}

export type InteractionManagement = ReturnType<
  typeof createInteractionManagement
>;
