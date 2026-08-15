export { createPeopleManagement } from "./application/create_person.ts";
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
export {
  PostgresPeopleRepository,
  PostgresPeopleTransaction,
} from "./adapters/postgres/people_repository.ts";
