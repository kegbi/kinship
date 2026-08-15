export { createPeopleManagement } from "./application/create_person.ts";
export { createPersonLifecycle } from "./application/lifecycle_person.ts";
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
