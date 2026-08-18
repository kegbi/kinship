export { PostgresInteractionPersonalizationReferences } from "./adapters/postgres/personalization_references.ts";
export type { InteractionPersonalizationReferences } from "./application/personalization_references.ts";
export { createInteractionManagement } from "./application/record_interaction.ts";
export { PostgresInteractionRepository } from "./adapters/postgres/interaction_repository.ts";
export { createCommunicationManagement } from "./application/record_communication.ts";
export { PostgresCommunicationRepository } from "./adapters/postgres/communication_repository.ts";
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
