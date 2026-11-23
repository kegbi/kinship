/**
 * Recording a call or a conversation, once.
 *
 * The write is idempotent by construction: the request's identifier derives
 * the communication's, the row under it is locked before anything else is
 * read, and a request that already landed is hydrated and handed back instead
 * of written again; one whose record a member deleted is refused as
 * `request-deleted` by the tombstone the delete left (MCP-E3). The derivation, the canonical message order, what counts
 * as the same request, and the input rules are all in
 * `domain/communication_rules.ts`; what is left here is the order the ports
 * are called in and the transaction they share.
 */

import type {
  Failure,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import { boundedText } from "../../../shared-kernel/validation.ts";
import {
  canonicalEmotionIds,
  type CommunicationRecord,
  deriveCommunicationId,
  derivedMessages,
  matchesStored,
  type RecordCommunicationInput,
  validateCommunication,
} from "../domain/communication_rules.ts";
import { canonicalUuid } from "../domain/interaction_rules.ts";
import type { InteractionActor } from "../ports/context.ts";
import {
  active,
  type CommunicationDependencies,
  hydrate,
} from "./communication_context.ts";
import { canonicalActor } from "./interaction_context.ts";

export type RecordCommunicationResult =
  | { readonly record: CommunicationRecord; readonly status: "created" }
  | ValidationFailure
  | Failure<
    "archived-write-rejected" | "forbidden" | "not-found",
    "hidden" | "idempotency-conflict" | "request-deleted"
  >;

export function createCommunicationWrites(
  dependencies: CommunicationDependencies,
) {
  return {
    recordCommunication: async (
      actor: InteractionActor,
      input: RecordCommunicationInput,
    ): Promise<RecordCommunicationResult> => {
      const errors = validateCommunication(input);
      if (Object.keys(errors).length > 0) {
        return { errors, status: "validation-error" };
      }
      const canonical = canonicalActor(actor);
      const personId = canonicalUuid(input.personId);
      return await dependencies.transaction.run(async (transaction) => {
        if (!await active(dependencies, canonical, transaction, true)) {
          return { status: "forbidden" as const };
        }
        const id = await deriveCommunicationId(
          input.kind,
          canonical.workspaceId,
          input.requestId,
        );
        await dependencies.repository.lockRequest({ id, transaction });
        const replay = await dependencies.repository.findRequest({
          id,
          transaction,
          workspaceId: canonical.workspaceId,
        });
        if (replay.status === "found") {
          if (!matchesStored(replay.communication, input, canonical.memberId)) {
            return { status: "idempotency-conflict" as const };
          }
          const record = await hydrate(
            dependencies,
            canonical,
            replay.communication,
            transaction,
          );
          return record
            ? { record, status: "created" as const }
            : { status: "not-found" as const };
        }
        if (
          await dependencies.tombstones.recorded({
            recordId: id,
            transaction,
            workspaceId: canonical.workspaceId,
          })
        ) return { status: "request-deleted" as const };
        const emotionIds = input.kind === "call"
          ? canonicalEmotionIds(input.emotionIds)
          : [];
        const context = await dependencies.workspace.inspectCommunication({
          ...canonical,
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
          ...canonical,
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
          ...canonical,
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
            workspaceId: canonical.workspaceId,
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
            ...canonical,
            calledAt: new Date(input.calledAt),
            contactWasCaller: input.contactWasCaller,
            ...(boundedText(input.content, 10_000)
              ? { content: boundedText(input.content, 10_000)! }
              : {}),
            emotions: context.emotions,
            id,
            occurredAt,
            person: { id: person.id, name: person.name },
            transaction,
          })
          : await dependencies.repository.createConversation({
            ...canonical,
            channelType: context.channelType!,
            ...(contactMethod ? { contactMethod } : {}),
            happenedAt: new Date(input.happenedAt),
            id,
            messages: await derivedMessages(
              input.messages ?? [],
              canonical.workspaceId,
              input.requestId,
            ),
            occurredAt,
            person: { id: person.id, name: person.name },
            ...(boundedText(input.title, 500)
              ? { title: boundedText(input.title, 500)! }
              : {}),
            transaction,
          });
        if (!record) return { status: "not-found" as const };
        const auditCommand = {
          actor: canonical,
          occurredAt,
          record,
          transaction,
        };
        const auditId = await dependencies.audit.record(auditCommand);
        await dependencies.repository.assertPostcondition({
          ...canonical,
          record,
          transaction,
        });
        await dependencies.audit.assertPostcondition({
          ...auditCommand,
          auditId,
        });
        await dependencies.publisher?.interactionRecorded({
          happenedAt: record.kind === "call"
            ? record.calledAt
            : record.happenedAt,
          memberId: canonical.memberId,
          personIds: [record.person.id],
          transaction,
          workspaceId: canonical.workspaceId,
        });
        return { record, status: "created" as const };
      }, { workspaceId: actor.workspaceId });
    },
  };
}
