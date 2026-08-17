import type {
  InteractionPersonBoundary,
  PeopleActor,
  PeopleTransaction,
} from "../../people/public.ts";
import type {
  InteractionWorkspaceBoundary,
  WorkspaceInteractionOption,
} from "../../workspaces/public.ts";

export interface CommunicationMessage {
  readonly content: string;
  readonly direction: "inbound" | "outbound";
  readonly id: string;
  readonly writtenAt: string;
}

export interface CallRecord {
  readonly calledAt: string;
  readonly contactWasCaller: boolean;
  readonly content?: string;
  readonly createdAt: string;
  readonly emotions: readonly WorkspaceInteractionOption[];
  readonly id: string;
  readonly kind: "call";
  readonly person: { readonly id: string; readonly name: string };
}

export interface ConversationRecord {
  readonly channelType?: WorkspaceInteractionOption;
  readonly contactMethod?: { readonly id: string; readonly value: string };
  readonly createdAt: string;
  readonly happenedAt: string;
  readonly id: string;
  readonly kind: "conversation";
  readonly messages: readonly CommunicationMessage[];
  readonly person: { readonly id: string; readonly name: string };
  readonly title?: string;
}

export type CommunicationRecord = CallRecord | ConversationRecord;

export type RecordCommunicationInput =
  | {
    readonly calledAt: string;
    readonly contactWasCaller: boolean;
    readonly content?: string;
    readonly emotionIds?: readonly string[];
    readonly kind: "call";
    readonly personId: string;
    readonly requestId: string;
  }
  | {
    readonly channelTypeId: string;
    readonly contactMethodId?: string;
    readonly happenedAt: string;
    readonly kind: "conversation";
    readonly messages?: readonly {
      readonly content: string;
      readonly direction: "inbound" | "outbound";
      readonly writtenAt: string;
    }[];
    readonly personId: string;
    readonly requestId: string;
    readonly title?: string;
  };

export type StoredCommunication =
  | {
    readonly calledAt: string;
    readonly contactWasCaller: boolean;
    readonly content?: string;
    readonly createdAt: string;
    readonly createdByMemberId?: string;
    readonly emotionIds: readonly string[];
    readonly id: string;
    readonly kind: "call";
    readonly personId: string;
  }
  | {
    readonly channelTypeId?: string;
    readonly contactMethodId?: string;
    readonly createdAt: string;
    readonly happenedAt: string;
    readonly id: string;
    readonly kind: "conversation";
    readonly messages: readonly CommunicationMessage[];
    readonly personId: string;
    readonly title?: string;
  };

export interface CommunicationRepository {
  lockRequest(
    command: { readonly id: string; readonly transaction: PeopleTransaction },
  ): Promise<void>;
  findRequest(command: {
    readonly id: string;
    readonly transaction: PeopleTransaction;
    readonly workspaceId: string;
  }): Promise<
    { readonly status: "absent" } | {
      readonly communication: StoredCommunication;
      readonly status: "found";
    }
  >;
  createCall(
    command: PeopleActor & {
      readonly calledAt: Date;
      readonly contactWasCaller: boolean;
      readonly content?: string;
      readonly emotions: readonly WorkspaceInteractionOption[];
      readonly id: string;
      readonly occurredAt: Date;
      readonly person: { readonly id: string; readonly name: string };
      readonly transaction: PeopleTransaction;
    },
  ): Promise<CallRecord | undefined>;
  createConversation(
    command: PeopleActor & {
      readonly channelType: WorkspaceInteractionOption;
      readonly contactMethod?: { readonly id: string; readonly value: string };
      readonly happenedAt: Date;
      readonly id: string;
      readonly messages: readonly CommunicationMessage[];
      readonly occurredAt: Date;
      readonly person: { readonly id: string; readonly name: string };
      readonly title?: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<ConversationRecord | undefined>;
  listForPerson(
    command: PeopleActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<readonly StoredCommunication[]>;
  assertPostcondition(
    command: PeopleActor & {
      readonly record: CommunicationRecord;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
}

export interface CommunicationAudit {
  record(command: {
    readonly actor: PeopleActor;
    readonly occurredAt: Date;
    readonly record: CommunicationRecord;
    readonly transaction: PeopleTransaction;
  }): Promise<string>;
  assertPostcondition(command: {
    readonly actor: PeopleActor;
    readonly auditId: string;
    readonly occurredAt: Date;
    readonly record: CommunicationRecord;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
}

export type RecordCommunicationResult =
  | { readonly record: CommunicationRecord; readonly status: "created" }
  | {
    readonly errors: Readonly<Record<string, string>>;
    readonly status: "validation-error";
  }
  | {
    readonly status:
      | "archived-write-rejected"
      | "forbidden"
      | "hidden"
      | "idempotency-conflict"
      | "not-found";
  };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const canonicalUuid = (value: string) => value.toLowerCase();
const bounded = (value: string | undefined, maximum: number) => {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum
    ? normalized
    : undefined;
};

type MessageValue = Omit<CommunicationMessage, "id">;

function compareMessageValues(left: MessageValue, right: MessageValue): number {
  for (
    const [a, b] of [
      [left.writtenAt, right.writtenAt],
      [left.direction, right.direction],
      [left.content, right.content],
    ] as const
  ) {
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

function orderMessages<T extends CommunicationMessage>(
  messages: readonly T[],
): readonly T[] {
  return [...messages].sort((left, right) =>
    compareMessageValues(left, right) || left.id.localeCompare(right.id)
  );
}

function canonicalMessages(
  messages: readonly {
    readonly content: string;
    readonly direction: "inbound" | "outbound";
    readonly writtenAt: string;
  }[],
): readonly MessageValue[] {
  return messages.map((message) => ({
    content: message.content.trim(),
    direction: message.direction,
    writtenAt: new Date(message.writtenAt).toISOString(),
  })).sort(compareMessageValues);
}

async function derivedId(
  namespace: string,
  workspaceId: string,
  requestId: string,
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        `kinship.interactions.${namespace}.v1\u0000${workspaceId.toLowerCase()}\u0000${requestId.toLowerCase()}`,
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

function same(
  stored: StoredCommunication,
  input: RecordCommunicationInput,
  memberId: string,
): boolean {
  if (
    stored.kind !== input.kind ||
    stored.personId !== canonicalUuid(input.personId)
  ) return false;
  if (stored.kind === "call" && input.kind === "call") {
    return stored.createdByMemberId === memberId &&
      stored.calledAt === new Date(input.calledAt).toISOString() &&
      stored.contactWasCaller === input.contactWasCaller &&
      stored.content === bounded(input.content, 10_000) &&
      stored.emotionIds.join(",") ===
        [...new Set((input.emotionIds ?? []).map(canonicalUuid))].sort().join(
          ",",
        );
  }
  if (stored.kind !== "conversation" || input.kind !== "conversation") {
    return false;
  }
  const messages = canonicalMessages(input.messages ?? []);
  const storedMessages = canonicalMessages(stored.messages);
  return stored.channelTypeId === canonicalUuid(input.channelTypeId) &&
    stored.contactMethodId ===
      (input.contactMethodId
        ? canonicalUuid(input.contactMethodId)
        : undefined) &&
    stored.happenedAt === new Date(input.happenedAt).toISOString() &&
    stored.title === bounded(input.title, 500) &&
    storedMessages.length === messages.length &&
    storedMessages.every((message, index) => {
      const expected = messages[index]!;
      return message.content === expected.content &&
        message.direction === expected.direction &&
        message.writtenAt === expected.writtenAt;
    });
}

function validate(
  input: RecordCommunicationInput,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  if (!UUID_PATTERN.test(input.requestId)) {
    errors.requestId = "Use a canonical request identifier.";
  }
  if (!UUID_PATTERN.test(input.personId)) {
    errors.personId = "Choose one person from this workspace.";
  }
  const happenedAt = new Date(
    input.kind === "call" ? input.calledAt : input.happenedAt,
  );
  if (!Number.isFinite(happenedAt.getTime())) {
    errors.happenedAt = "Choose a valid occurrence time.";
  }
  if (input.kind === "call") {
    if (input.content !== undefined && !bounded(input.content, 10_000)) {
      errors.content = "Details must be at most 10,000 characters.";
    }
    const emotions = [...new Set((input.emotionIds ?? []).map(canonicalUuid))];
    if (emotions.length > 20 || emotions.some((id) => !UUID_PATTERN.test(id))) {
      errors.emotionIds = "Choose at most 20 active emotions.";
    }
  } else {
    if (!UUID_PATTERN.test(input.channelTypeId)) {
      errors.channelTypeId = "Choose an active channel.";
    }
    if (input.contactMethodId && !UUID_PATTERN.test(input.contactMethodId)) {
      errors.contactMethodId = "Choose a contact method for this person.";
    }
    if (input.title !== undefined && !bounded(input.title, 500)) {
      errors.title = "Title must be at most 500 characters.";
    }
    const messages = input.messages ?? [];
    if (messages.length > 50) errors.messages = "Record at most 50 messages.";
    if (
      messages.some((message) =>
        !bounded(message.content, 10_000) ||
        !Number.isFinite(new Date(message.writtenAt).getTime())
      )
    ) {
      errors.messages = "Each message needs bounded content and a valid time.";
    }
  }
  return errors;
}

export function createCommunicationManagement(dependencies: {
  readonly audit: CommunicationAudit;
  readonly clock: { now(): Date };
  readonly people: InteractionPersonBoundary;
  readonly repository: CommunicationRepository;
  readonly transaction: {
    run<T>(work: (transaction: PeopleTransaction) => Promise<T>): Promise<T>;
  };
  readonly workspace: InteractionWorkspaceBoundary;
}) {
  const hydrate = async (
    actor: PeopleActor,
    stored: StoredCommunication,
    transaction: PeopleTransaction,
  ): Promise<CommunicationRecord | undefined> => {
    const person = (await dependencies.people.summarize({
      ...actor,
      personIds: [stored.personId],
      transaction,
    }))[0];
    if (!person) return undefined;
    if (stored.kind === "call") {
      const described = await dependencies.workspace.describe({
        emotionIds: stored.emotionIds,
        transaction,
        workspaceId: actor.workspaceId,
      });
      return {
        calledAt: stored.calledAt,
        contactWasCaller: stored.contactWasCaller,
        ...(stored.content ? { content: stored.content } : {}),
        createdAt: stored.createdAt,
        emotions: described.emotions,
        id: stored.id,
        kind: "call",
        person: { id: person.id, name: person.name },
      };
    }
    const described = await dependencies.workspace.describeCommunication({
      ...(stored.channelTypeId ? { channelTypeId: stored.channelTypeId } : {}),
      emotionIds: [],
      transaction,
      workspaceId: actor.workspaceId,
    });
    const contact = stored.contactMethodId
      ? await dependencies.people.inspectContactMethod({
        contactMethodId: stored.contactMethodId,
        personId: stored.personId,
        transaction,
        workspaceId: actor.workspaceId,
      })
      : undefined;
    return {
      ...(described.channelType ? { channelType: described.channelType } : {}),
      ...(contact?.status === "ready"
        ? {
          contactMethod: {
            id: contact.contactMethod.id,
            value: contact.contactMethod.value,
          },
        }
        : {}),
      createdAt: stored.createdAt,
      happenedAt: stored.happenedAt,
      id: stored.id,
      kind: "conversation",
      messages: orderMessages(stored.messages),
      person: { id: person.id, name: person.name },
      ...(stored.title ? { title: stored.title } : {}),
    };
  };
  const hydrateMany = async (
    actor: PeopleActor,
    stored: readonly StoredCommunication[],
    transaction: PeopleTransaction,
  ): Promise<readonly CommunicationRecord[]> => {
    if (stored.length === 0) return [];
    const people = await dependencies.people.summarize({
      ...actor,
      personIds: [...new Set(stored.map((record) => record.personId))],
      transaction,
    });
    const peopleById = new Map(people.map((person) => [person.id, person]));
    const contactMethodIds = stored.flatMap((record) =>
      record.kind === "conversation" && record.contactMethodId
        ? [record.contactMethodId]
        : []
    );
    const channelTypeIds = stored.flatMap((record) =>
      record.kind === "conversation" && record.channelTypeId
        ? [record.channelTypeId]
        : []
    );
    const emotionIds = stored.flatMap((record) =>
      record.kind === "call" ? record.emotionIds : []
    );
    const [contactMethods, references] = await Promise.all([
      dependencies.people.describeContactMethods({
        contactMethodIds,
        personId: stored[0]!.personId,
        transaction,
        workspaceId: actor.workspaceId,
      }),
      dependencies.workspace.describeCommunicationReferences({
        channelTypeIds,
        emotionIds,
        transaction,
        workspaceId: actor.workspaceId,
      }),
    ]);
    const contactsById = new Map(
      contactMethods.map((entry) => [entry.id, entry]),
    );
    const channelsById = new Map(
      references.channelTypes.map((entry) => [entry.id, entry]),
    );
    const emotionsById = new Map(
      references.emotions.map((entry) => [entry.id, entry]),
    );
    return stored.flatMap((record): readonly CommunicationRecord[] => {
      const person = peopleById.get(record.personId);
      if (!person) return [];
      if (record.kind === "call") {
        return [{
          calledAt: record.calledAt,
          contactWasCaller: record.contactWasCaller,
          ...(record.content ? { content: record.content } : {}),
          createdAt: record.createdAt,
          emotions: record.emotionIds.flatMap((id) => {
            const emotion = emotionsById.get(id);
            return emotion ? [emotion] : [];
          }),
          id: record.id,
          kind: "call",
          person: { id: person.id, name: person.name },
        }];
      }
      const channelType = record.channelTypeId
        ? channelsById.get(record.channelTypeId)
        : undefined;
      const contactMethod = record.contactMethodId
        ? contactsById.get(record.contactMethodId)
        : undefined;
      return [{
        ...(channelType ? { channelType } : {}),
        ...(contactMethod
          ? {
            contactMethod: { id: contactMethod.id, value: contactMethod.value },
          }
          : {}),
        createdAt: record.createdAt,
        happenedAt: record.happenedAt,
        id: record.id,
        kind: "conversation",
        messages: orderMessages(record.messages),
        person: { id: person.id, name: person.name },
        ...(record.title ? { title: record.title } : {}),
      }];
    });
  };
  return {
    communicationOptions: (actor: PeopleActor) =>
      dependencies.transaction.run((transaction) =>
        dependencies.workspace.communicationOptions({ ...actor, transaction })
      ),
    listCommunications: (actor: PeopleActor, personId: string) =>
      dependencies.transaction.run(async (transaction) => {
        const authorization = await dependencies.workspace.authorize({
          ...actor,
          transaction,
        });
        if (authorization.status !== "ready") {
          return { status: "forbidden" as const };
        }
        const people = await dependencies.people.inspect({
          ...actor,
          lock: false,
          personIds: [personId],
          transaction,
        });
        if (people.status === "not-found") {
          return { status: "not-found" as const };
        }
        const stored = await dependencies.repository.listForPerson({
          ...actor,
          personId,
          transaction,
        });
        return {
          items: await hydrateMany(actor, stored, transaction),
          status: "ready" as const,
        };
      }),
    recordCommunication: async (
      actor: PeopleActor,
      input: RecordCommunicationInput,
    ): Promise<RecordCommunicationResult> => {
      const errors = validate(input);
      if (Object.keys(errors).length > 0) {
        return { errors, status: "validation-error" };
      }
      const canonicalActor = {
        ...actor,
        memberId: canonicalUuid(actor.memberId),
        userId: canonicalUuid(actor.userId),
        workspaceId: canonicalUuid(actor.workspaceId),
      };
      const personId = canonicalUuid(input.personId);
      return await dependencies.transaction.run(async (transaction) => {
        const authorization = await dependencies.workspace.authorize({
          ...canonicalActor,
          transaction,
        });
        if (authorization.status !== "ready") {
          return { status: "forbidden" as const };
        }
        const id = await derivedId(
          input.kind,
          canonicalActor.workspaceId,
          input.requestId,
        );
        await dependencies.repository.lockRequest({ id, transaction });
        const replay = await dependencies.repository.findRequest({
          id,
          transaction,
          workspaceId: canonicalActor.workspaceId,
        });
        if (replay.status === "found") {
          if (!same(replay.communication, input, canonicalActor.memberId)) {
            return { status: "idempotency-conflict" as const };
          }
          const record = await hydrate(
            canonicalActor,
            replay.communication,
            transaction,
          );
          return record
            ? { record, status: "created" as const }
            : { status: "not-found" as const };
        }
        const emotionIds = input.kind === "call"
          ? [...new Set((input.emotionIds ?? []).map(canonicalUuid))].sort()
          : [];
        const context = await dependencies.workspace.inspectCommunication({
          ...canonicalActor,
          ...(input.kind === "conversation"
            ? { channelTypeId: canonicalUuid(input.channelTypeId) }
            : {}),
          emotionIds,
          kind: input.kind,
          lock: true,
          transaction,
        });
        if (context.status !== "ready") return context;
        const personState = await dependencies.people.inspect({
          ...canonicalActor,
          lock: true,
          personIds: [personId],
          transaction,
        });
        if (personState.status !== "ready") {
          return personState.status === "archived"
            ? { status: "archived-write-rejected" as const }
            : { status: "not-found" as const };
        }
        const person = (await dependencies.people.summarize({
          ...canonicalActor,
          personIds: [personId],
          transaction,
        }))[0];
        if (!person) return { status: "not-found" as const };
        let contactMethod:
          | { readonly id: string; readonly value: string }
          | undefined;
        if (input.kind === "conversation" && input.contactMethodId) {
          const inspected = await dependencies.people.inspectContactMethod({
            contactMethodId: canonicalUuid(input.contactMethodId),
            personId,
            transaction,
            workspaceId: canonicalActor.workspaceId,
          });
          if (
            inspected.status !== "ready" ||
            inspected.contactMethod.typeId !==
              canonicalUuid(input.channelTypeId)
          ) return { status: "not-found" as const };
          contactMethod = {
            id: inspected.contactMethod.id,
            value: inspected.contactMethod.value,
          };
        }
        const occurredAt = dependencies.clock.now();
        const record = input.kind === "call"
          ? await dependencies.repository.createCall({
            ...canonicalActor,
            calledAt: new Date(input.calledAt),
            contactWasCaller: input.contactWasCaller,
            ...(bounded(input.content, 10_000)
              ? { content: bounded(input.content, 10_000)! }
              : {}),
            emotions: context.emotions,
            id,
            occurredAt,
            person: { id: person.id, name: person.name },
            transaction,
          })
          : await dependencies.repository.createConversation({
            ...canonicalActor,
            channelType: context.channelType!,
            ...(contactMethod ? { contactMethod } : {}),
            happenedAt: new Date(input.happenedAt),
            id,
            messages: orderMessages(
              await Promise.all(
                canonicalMessages(input.messages ?? []).map(async (
                  message,
                  index,
                ) => ({
                  content: message.content,
                  direction: message.direction,
                  id: await derivedId(
                    `message-${index}`,
                    canonicalActor.workspaceId,
                    input.requestId,
                  ),
                  writtenAt: message.writtenAt,
                })),
              ),
            ),
            occurredAt,
            person: { id: person.id, name: person.name },
            ...(bounded(input.title, 500)
              ? { title: bounded(input.title, 500)! }
              : {}),
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
        return { record, status: "created" as const };
      });
    },
  };
}

export type CommunicationManagement = ReturnType<
  typeof createCommunicationManagement
>;
