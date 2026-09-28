export type { JournalActivityReference } from "./application/journal_activity_reference.ts";
export type { InteractionPersonalizationReferences } from "./application/personalization_references.ts";
export type {
  CallRecord,
  CommunicationMessage,
  CommunicationRecord,
  ConversationRecord,
  RecordCommunicationInput,
  StoredCommunication,
} from "./domain/communication_rules.ts";
export type {
  ActivityRecord,
  InteractionOption,
  InteractionParticipant,
  InteractionRecord,
  NoteRecord,
  RecordInteractionInput,
  StoredInteraction,
} from "./domain/interaction_rules.ts";
export type { CommunicationAudit, InteractionAudit } from "./ports/audit.ts";
export type {
  InteractionActor,
  InteractionTransaction,
} from "./ports/context.ts";
export type { CommunicationRepository } from "./ports/communication_repository.ts";
export type {
  InteractionRecordedPublisher,
  InteractionRepository,
  InteractionWorkspaceBoundary,
} from "./ports/interaction_repository.ts";
export { createInteractionManagement } from "./application/record_interaction.ts";
export type { InteractionManagement } from "./application/record_interaction.ts";
export type { InteractionDependencies } from "./application/interaction_context.ts";
export type { RecordInteractionResult } from "./application/interaction_writes.ts";
export { createCommunicationManagement } from "./application/record_communication.ts";
export type { CommunicationManagement } from "./application/record_communication.ts";
export type { CommunicationDependencies } from "./application/communication_context.ts";
export type { RecordCommunicationResult } from "./application/communication_writes.ts";
export {
  communicationAuditFrom,
  interactionAuditFrom,
} from "./application/audit_events.ts";
export type { InteractionImportBoundary } from "./application/import_note_boundary.ts";
