export {
  displayName,
  type PersonNameParts,
  UNNAMED_PERSON,
} from "./domain/person_name.ts";
export {
  AVATAR_PALETTE,
  avatarColor,
  avatarView,
  isAvatarColor,
} from "./domain/avatar.ts";
export type {
  AvatarSource,
  PersonAvatarRecord,
  PersonAvatarView,
} from "./domain/avatar.ts";
export type {
  CreatePersonInput,
  PersonIdentity,
  PossibleDuplicate,
} from "./domain/person_identity.ts";
export type {
  DeletePersonInput,
  EditPersonInput,
  GenderOptionInspection,
  PersonLifecycleAction,
  PersonLifecycleRecord,
  PersonLifecycleState,
  PersonTransitionInput,
} from "./domain/lifecycle_rules.ts";
export type {
  ImportantDateAction,
  ImportantDateKind,
  ImportantDatePrecision,
  ImportantDateRecord,
  ImportantDateValue,
} from "./domain/important_dates/rules.ts";
export type {
  AddressFact,
  ContactMethodFact,
  FirstMeetingFact,
  FoodPreferencesFact,
  OccupationFact,
  PetFact,
  ProfileFactOption,
  ProfileFactRecord,
  ProfileFactSection,
  ProfileFactValue,
  TagsFact,
} from "./domain/profile_facts/values.ts";
export type {
  MergeCandidate,
  MergeConflict,
  MergeConflictFact,
  MergedIdentity,
  MergePeopleInput,
  MergeRevisions,
  PersonMergeFacts,
  ReferenceCounts,
  ReferenceOutcome,
} from "./domain/merge_rules.ts";
export type {
  ImportantDateAudit,
  PersonAvatarAudit,
  PersonCreatedAudit,
  PersonDuplicateDismissalAudit,
  PersonLifecycleAudit,
  PersonMergeAudit,
  PersonMergeAuditCommand,
  PersonStarAudit,
  ProfileFactAudit,
} from "./ports/audit.ts";
export type { PersonStarRepository } from "./ports/star.ts";
export type {
  PersonDuplicateDismissalRepository,
  PersonDuplicatePairCommand,
} from "./ports/duplicate_dismissal.ts";
export type {
  LockedMergePair,
  PersonMergeCommand,
  PersonMergeInspection,
  PersonMergePairScope,
  PersonMergeParticipant,
  PersonMergeRepository,
} from "./ports/person_merge.ts";
export type { PeopleActor, PeopleTransaction } from "./ports/context.ts";
export type { PersonGenderOptions } from "./ports/gender_options.ts";
export type {
  AvatarImageInput,
  PersonAvatarImages,
  PersonAvatarRepository,
  PersonAvatarState,
} from "./ports/avatar.ts";
export type {
  PeopleRepository,
  PersonIdentityLookup,
} from "./ports/person_repository.ts";
export type {
  PersonLifecycleLock,
  PersonLifecycleRepository,
} from "./ports/person_lifecycle_repository.ts";
export type {
  ImportantDateContextLock,
  ImportantDateLock,
  ImportantDatePublisher,
  ImportantDateRepository,
} from "./ports/important_date_repository.ts";
export type {
  ProfileFactContextLock,
  ProfileFactOrganizationBoundary,
  ProfileFactRepository,
  ProfileFactWorkspaceBoundary,
  ProfileFactWorkspaceInspection,
} from "./ports/profile_fact_repository.ts";
export { createPeopleManagement } from "./application/create_person.ts";
export { createImportantDateManagement } from "./application/important_dates.ts";
export { createPersonLifecycle } from "./application/lifecycle_person.ts";
export { createPersonAvatarManagement } from "./application/person_avatar.ts";
export { createPersonStarManagement } from "./application/person_star.ts";
export type {
  PersonStarDependencies,
  PersonStarManagement,
  SetPersonStarResult,
} from "./application/person_star.ts";
export { createPersonMerge } from "./application/merge_people.ts";
export { createPersonDuplicateDismissals } from "./application/duplicate_dismissal.ts";
export type {
  DismissDuplicatePairResult,
  PersonDuplicateDismissalDependencies,
  PersonDuplicateDismissals,
} from "./application/duplicate_dismissal.ts";
export { createBulkPeopleActions } from "./application/bulk_people.ts";
export type {
  BulkPeopleActions,
  BulkPeopleDependencies,
  BulkPeopleResult,
} from "./application/bulk_people.ts";
export { BULK_PEOPLE_LIMIT } from "./domain/bulk_rules.ts";
export type {
  BulkFailureCode,
  BulkItemOutcome,
  BulkItemResult,
  BulkPeopleAction,
  BulkPeopleInput,
  BulkSummary,
} from "./domain/bulk_rules.ts";
export type { PeopleBulkTagLookup } from "./ports/bulk.ts";
export type {
  MergePeopleResult,
  PersonMerge,
  PersonMergeDependencies,
  PreviewPeopleMergeResult,
} from "./application/merge_people.ts";
export type {
  PersonAvatarDependencies,
  PersonAvatarManagement,
  RemovePersonAvatarResult,
  ReplacePersonAvatarResult,
} from "./application/person_avatar.ts";
export { createProfileFactManagement } from "./application/profile_facts.ts";
export type { ProfileFactManagement } from "./application/profile_facts.ts";
export type { ProfileFactDependencies } from "./application/profile_fact_context.ts";
export type {
  ProfileFactListResult,
} from "./application/profile_fact_listing.ts";
export type {
  ProfileFactCreateInput,
  ProfileFactFailureResult,
  ProfileFactMutationResult,
  ProfileFactUpdateInput,
} from "./application/profile_fact_writes.ts";
export type {
  ImportantDateCreateResult,
  ImportantDateDeleteInput,
  ImportantDateDeleteResult,
  ImportantDateDependencies,
  ImportantDateFailure,
  ImportantDateListResult,
  ImportantDateManagement,
  ImportantDateMutationResult,
  ImportantDateUpdateInput,
  ImportantDateUpdateResult,
} from "./application/important_dates.ts";
export type {
  CreatePersonResult,
  GetPersonResult,
  PeopleManagement,
  PeopleManagementDependencies,
  TransactionalPeopleCreation,
} from "./application/create_person.ts";
export type {
  DeletePersonResult,
  EditPersonResult,
  PersonDeletionImpact,
  PersonLifecycle,
  PersonLifecycleDependencies,
  PersonLifecycleFailure,
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
  ImportedPersonDetails,
  PeopleImportActor,
  PeopleImportBoundary,
  PeopleImportTransaction,
  PersonImportPresence,
} from "./application/import_people_boundary.ts";
export type {
  ExportContactMethod,
  ExportDate,
  ExportPerson,
  PeopleExportBoundary,
} from "./application/export_people_boundary.ts";
export {
  importantDateAuditFrom,
  personAvatarAuditFrom,
  personCreatedAuditFrom,
  personDuplicateDismissalAuditFrom,
  personLifecycleAuditFrom,
  personMergeAuditFrom,
  personStarAuditFrom,
  profileFactAuditFrom,
} from "./application/audit_events.ts";
