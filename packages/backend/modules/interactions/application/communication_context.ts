/**
 * What reading or recording a communication needs before it may proceed.
 *
 * A stored call or conversation keeps identifiers, not names, so every path
 * that hands one back has to resolve the person, the channel, the contact
 * method, and the emotions first. Doing that one row at a time is a query per
 * record, so the many-row path resolves each kind of reference once and then
 * assembles the records; both paths and the dependency set they share are
 * written once here, and the assembling itself is a rule in
 * `domain/communication_rules.ts`.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import {
  callRecord,
  type CommunicationRecord,
  conversationRecord,
  type StoredCommunication,
} from "../domain/communication_rules.ts";
import type { CommunicationAudit } from "../ports/audit.ts";
import type {
  InteractionActor,
  InteractionTransaction,
  InteractionTransactionRunner,
} from "../ports/context.ts";
import type { CommunicationRepository } from "../ports/communication_repository.ts";
import type { InteractionRecordedPublisher } from "../ports/interaction_repository.ts";
import type { InteractionPersonBoundary } from "../../people/public.ts";
import type {
  ActorRevalidation,
  InteractionWorkspaceBoundary as CommunicationWorkspaceBoundary,
} from "../../workspaces/public.ts";

export interface CommunicationDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: CommunicationAudit;
  readonly clock: Clock;
  readonly people: InteractionPersonBoundary;
  readonly publisher?: InteractionRecordedPublisher;
  readonly repository: CommunicationRepository;
  readonly transaction: InteractionTransactionRunner;
  readonly workspace: CommunicationWorkspaceBoundary;
}

/**
 * The actor's standing, asked first inside the caller's transaction. Write
 * paths lock the actor's rows; read paths keep their lock-free concurrency.
 */
export async function active(
  dependencies: Pick<CommunicationDependencies, "actors">,
  actor: InteractionActor,
  transaction: InteractionTransaction,
  lock: boolean,
): Promise<boolean> {
  return await dependencies.actors.revalidate({
    ...actor,
    lock,
    transaction,
  }) === "active";
}

/**
 * One stored communication as a reader sees it, or nothing when the person it
 * belongs to is no longer visible to the caller.
 */
export async function hydrate(
  dependencies: Pick<CommunicationDependencies, "people" | "workspace">,
  actor: InteractionActor,
  stored: StoredCommunication,
  transaction: InteractionTransaction,
): Promise<CommunicationRecord | undefined> {
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
    return callRecord(stored, person, described.emotions);
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
  return conversationRecord(
    stored,
    person,
    described.channelType,
    contact?.status === "ready" ? contact.contactMethod : undefined,
  );
}

/**
 * A person's communications as a reader sees them.
 *
 * Every reference each kind of row needs is resolved in one round of reads, so
 * the cost of a timeline is a fixed handful of queries rather than a handful
 * per row. A row whose person no longer resolves is dropped, which is the same
 * answer `hydrate` gives for one.
 */
export async function hydrateMany(
  dependencies: Pick<CommunicationDependencies, "people" | "workspace">,
  actor: InteractionActor,
  stored: readonly StoredCommunication[],
  transaction: InteractionTransaction,
): Promise<readonly CommunicationRecord[]> {
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
      return [callRecord(
        record,
        person,
        record.emotionIds.flatMap((id) => {
          const emotion = emotionsById.get(id);
          return emotion ? [emotion] : [];
        }),
      )];
    }
    return [conversationRecord(
      record,
      person,
      record.channelTypeId ? channelsById.get(record.channelTypeId) : undefined,
      record.contactMethodId
        ? contactsById.get(record.contactMethodId)
        : undefined,
    )];
  });
}
