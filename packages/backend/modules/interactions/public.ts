export type { JournalActivityReference } from "./application/journal_activity_reference.ts";
export type { InteractionPersonalizationReferences } from "./application/personalization_references.ts";
export { createInteractionManagement } from "./application/record_interaction.ts";
export { createCommunicationManagement } from "./application/record_communication.ts";
export type {
  CallRecord,
  CommunicationAudit,
  CommunicationManagement,
  CommunicationMessage,
  CommunicationRecord,
  CommunicationRepository,
  ConversationRecord,
  RecordCommunicationInput,
  RecordCommunicationResult,
  StoredCommunication,
} from "./application/record_communication.ts";
export type {
  ActivityRecord,
  InteractionAudit,
  InteractionManagement,
  InteractionOption,
  InteractionParticipant,
  InteractionRecord,
  InteractionRecordedPublisher,
  InteractionRepository,
  InteractionWorkspaceBoundary,
  NoteRecord,
  RecordInteractionInput,
  RecordInteractionResult,
  StoredInteraction,
} from "./application/record_interaction.ts";
export {
  communicationAuditFrom,
  interactionAuditFrom,
} from "./application/audit_events.ts";
