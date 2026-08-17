export { createPeopleManagement } from "./application/create_person.ts";
export { createImportantDateManagement } from "./application/important_dates.ts";
export { createPersonLifecycle } from "./application/lifecycle_person.ts";
export { createProfileFactManagement } from "./application/profile_facts.ts";
export type {
  AddressFact,
  ContactMethodFact,
  FirstMeetingFact,
  FoodPreferencesFact,
  OccupationFact,
  PetFact,
  ProfileFactAudit,
  ProfileFactContextLock,
  ProfileFactCreateInput,
  ProfileFactDependencies,
  ProfileFactFailureResult,
  ProfileFactListResult,
  ProfileFactManagement,
  ProfileFactMutationResult,
  ProfileFactOption,
  ProfileFactOrganizationBoundary,
  ProfileFactRecord,
  ProfileFactRepository,
  ProfileFactSection,
  ProfileFactUpdateInput,
  ProfileFactValue,
  ProfileFactWorkspaceBoundary,
  ProfileFactWorkspaceInspection,
  TagsFact,
} from "./application/profile_facts.ts";
export type {
  ImportantDateAction,
  ImportantDateAudit,
  ImportantDateContextLock,
  ImportantDateCreateResult,
  ImportantDateDeleteInput,
  ImportantDateDeleteResult,
  ImportantDateDependencies,
  ImportantDateFailure,
  ImportantDateKind,
  ImportantDateListResult,
  ImportantDateLock,
  ImportantDateManagement,
  ImportantDateMutationResult,
  ImportantDatePrecision,
  ImportantDatePublisher,
  ImportantDateRecord,
  ImportantDateRepository,
  ImportantDateUpdateInput,
  ImportantDateUpdateResult,
  ImportantDateValue,
} from "./application/important_dates.ts";
export type {
  CreatePersonInput,
  CreatePersonResult,
  GetPersonResult,
  PeopleActor,
  PeopleManagement,
  PeopleManagementDependencies,
  PeopleRepository,
  PeopleTransaction,
  PersonCreatedAudit,
  PersonIdentity,
  PersonIdentityLookup,
  PossibleDuplicate,
  TransactionalPeopleCreation,
} from "./application/create_person.ts";
export type {
  DeletePersonInput,
  DeletePersonResult,
  EditPersonInput,
  EditPersonResult,
  PersonDeletionImpact,
  PersonLifecycle,
  PersonLifecycleAction,
  PersonLifecycleAudit,
  PersonLifecycleDependencies,
  PersonLifecycleFailure,
  PersonLifecycleLock,
  PersonLifecycleRecord,
  PersonLifecycleRepository,
  PersonLifecycleState,
  PersonTransitionInput,
  PreviewPersonDeletionResult,
  TransitionPersonResult,
} from "./application/lifecycle_person.ts";
export {
  PostgresPeopleRepository,
  PostgresPeopleTransaction,
} from "./adapters/postgres/people_repository.ts";
export { PostgresPersonLifecycleRepository } from "./adapters/postgres/person_lifecycle_repository.ts";
export { PostgresImportantDateRepository } from "./adapters/postgres/important_date_repository.ts";
export { PostgresProfileFactRepository } from "./adapters/postgres/profile_fact_repository.ts";
export { PostgresProfileFactOrganizations } from "./adapters/postgres/profile_fact_organizations.ts";
export { PostgresRelationshipPersonBoundary } from "./adapters/postgres/relationship_person_boundary.ts";
export type {
  InteractionPersonBoundary,
} from "./application/interaction_person_boundary.ts";
export type {
  RelationshipPersonBoundary,
  RelationshipPersonInspection,
  RelationshipPersonSummary,
} from "./application/relationship_person_boundary.ts";
export type { TagPersonalizationFacade } from "./application/tag_personalization.ts";
export { PostgresTagPersonalization } from "./adapters/postgres/tag_personalization.ts";
export { PostgresPeoplePersonalizationReferences } from "./adapters/postgres/personalization_references.ts";
export type { PeoplePersonalizationReferences } from "./application/personalization_references.ts";
