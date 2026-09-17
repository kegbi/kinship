/**
 * How the module stores a call or a conversation.
 *
 * Recording is idempotent, so the sequence mirrors the interaction
 * repository's: `lockRequest` takes the derived identifier first,
 * `findRequest` says whether that request already landed, and only then does a
 * create run. `listForPerson` answers with the stored rows rather than with
 * finished records, because resolving the person, the channel, and the
 * emotions is the application's job and doing it row by row would be a query
 * per record.
 *
 * `assertPostcondition` closes a write: the row is read back inside the same
 * transaction, so a write that silently did nothing fails loudly instead of
 * being audited as a success.
 */

import type {
  CallRecord,
  CommunicationMessage,
  CommunicationRecord,
  ConversationRecord,
  StoredCommunication,
} from "../domain/communication_rules.ts";
import type {
  InteractionOption,
  InteractionParticipant,
} from "../domain/interaction_rules.ts";
import type { InteractionActor, InteractionTransaction } from "./context.ts";

export interface CommunicationRepository {
  lockRequest(
    command: {
      readonly id: string;
      readonly transaction: InteractionTransaction;
    },
  ): Promise<void>;
  findRequest(command: {
    readonly id: string;
    readonly transaction: InteractionTransaction;
    readonly workspaceId: string;
  }): Promise<
    { readonly status: "absent" } | {
      readonly communication: StoredCommunication;
      readonly status: "found";
    }
  >;
  createCall(
    command: InteractionActor & {
      readonly calledAt: Date;
      readonly contactWasCaller: boolean;
      readonly content?: string;
      readonly emotions: readonly InteractionOption[];
      readonly id: string;
      readonly occurredAt: Date;
      readonly person: InteractionParticipant;
      readonly transaction: InteractionTransaction;
    },
  ): Promise<CallRecord | undefined>;
  createConversation(
    command: InteractionActor & {
      readonly channelType: InteractionOption;
      readonly contactMethod?: { readonly id: string; readonly value: string };
      readonly happenedAt: Date;
      readonly id: string;
      readonly messages: readonly CommunicationMessage[];
      readonly occurredAt: Date;
      readonly person: InteractionParticipant;
      readonly title?: string;
      readonly transaction: InteractionTransaction;
    },
  ): Promise<ConversationRecord | undefined>;
  listForPerson(
    command: InteractionActor & {
      readonly personId: string;
      readonly transaction: InteractionTransaction;
    },
  ): Promise<readonly StoredCommunication[]>;
  assertPostcondition(
    command: InteractionActor & {
      readonly record: CommunicationRecord;
      readonly transaction: InteractionTransaction;
    },
  ): Promise<void>;
}
