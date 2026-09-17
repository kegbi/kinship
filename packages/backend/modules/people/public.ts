export {
  displayName,
  type PersonNameParts,
  UNNAMED_PERSON,
} from "./domain/person_name.ts";
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
export type {
  InteractionPersonBoundary,
} from "./application/interaction_person_boundary.ts";
export type {
  RelationshipPersonBoundary,
  RelationshipPersonInspection,
  RelationshipPersonSummary,
} from "./application/relationship_person_boundary.ts";
export type { TagPersonalizationFacade } from "./application/tag_personalization.ts";
export type { PeoplePersonalizationReferences } from "./application/personalization_references.ts";
export type {
  ImportedPerson,
  PeopleImportActor,
  PeopleImportBoundary,
  PeopleImportTransaction,
} from "./application/import_people_boundary.ts";
export type {
  ExportContactMethod,
  ExportPerson,
  PeopleExportBoundary,
} from "./application/export_people_boundary.ts";
export {
  importantDateAuditFrom,
  personCreatedAuditFrom,
  personLifecycleAuditFrom,
  profileFactAuditFrom,
} from "./application/audit_events.ts";
