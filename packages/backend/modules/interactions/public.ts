export { PostgresInteractionPersonalizationReferences } from "./adapters/postgres/personalization_references.ts";
export type { InteractionPersonalizationReferences } from "./application/personalization_references.ts";
export { createInteractionManagement } from "./application/record_interaction.ts";
export { PostgresInteractionRepository } from "./adapters/postgres/interaction_repository.ts";
export type {
  ActivityRecord,
  InteractionAudit,
  InteractionManagement,
  InteractionOption,
  InteractionParticipant,
  InteractionRecord,
  InteractionRepository,
  InteractionWorkspaceBoundary,
  NoteRecord,
  RecordInteractionInput,
  RecordInteractionResult,
  StoredInteraction,
} from "./application/record_interaction.ts";
