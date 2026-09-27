/**
 * What each people suite loads (GAP-035): a configured app, the pools the
 * race tests need, the people use cases and read models the suites drive
 * directly, the person-scoped requests, and the revocation race fixtures.
 *
 * Deno loads every test file in its own worker isolate, so each suite that
 * imports this module evaluates it afresh and owns its own app, pools, and
 * mailbox; nothing here is shared between suites. Each suite closes its own
 * instance in its final test, most of them through `closeResources()`.
 */

import postgres from "postgres";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  createPeopleManagement,
  createProfileFactManagement,
  type PeopleActor,
  type PeopleRepository,
} from "../../packages/backend/modules/people/public.ts";
import {
  personCreatedAuditFrom,
  profileFactAuditFrom,
} from "../../packages/backend/modules/people/public.ts";
import { type ActorRevalidation } from "../../packages/backend/modules/workspaces/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { createPeopleDirectory } from "../../packages/backend/read-models/people-directory/public.ts";
import { createPersonProfile } from "../../packages/backend/read-models/person-profile/public.ts";
import {
  PostgresPeopleRepository,
  PostgresPeopleTransaction,
} from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import { PostgresProfileFactOrganizations } from "../../packages/backend/modules/people/adapters/postgres/profile_fact_organizations.ts";
import { PostgresProfileFactRepository } from "../../packages/backend/modules/people/adapters/postgres/profile_fact_repository.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import { PostgresProfileFactConfiguration } from "../../packages/backend/modules/workspaces/adapters/postgres/profile_fact_configuration.ts";
import { PostgresPeopleDirectoryRepository } from "../../packages/backend/read-models/people-directory/adapters/postgres/people_directory_repository.ts";
import { PostgresPersonProfileRepository } from "../../packages/backend/read-models/person-profile/adapters/postgres/person_profile_repository.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  revocableActor,
} from "../support/database.ts";
import { apiSupport } from "../support/api.ts";
import {
  importantDateRequest as importantDateRequestThroughApi,
  listTagOptions as listTagOptionsThroughApi,
  submitPerson,
} from "../support/fixtures.ts";

export const databaseUrl = requireDatabaseUrl();
export const sql = openSql(databaseUrl, { max: 3 });
export const raceSql = openSql(databaseUrl);
export const peopleConnection = connectDatabase(databaseUrl);
export const actors = new PostgresActorRevalidation();
export const people = createPeopleManagement({
  actors,
  audit: personCreatedAuditFrom(new PostgresAuditEventRecorder()),
  clock: { now: () => new Date() },
  ids: { create: () => crypto.randomUUID() },
  repository: new PostgresPeopleRepository(),
  transaction: new PostgresPeopleTransaction(peopleConnection.db),
});
export const profileFacts = createProfileFactManagement({
  actors,
  audit: profileFactAuditFrom(new PostgresAuditEventRecorder()),
  clock: { now: () => new Date() },
  ids: { create: () => crypto.randomUUID() },
  organizations: new PostgresProfileFactOrganizations(),
  repository: new PostgresProfileFactRepository(),
  transaction: new PostgresPeopleTransaction(peopleConnection.db),
  workspace: new PostgresProfileFactConfiguration(),
});
export const directory = createPeopleDirectory({
  actors,
  repository: new PostgresPeopleDirectoryRepository(peopleConnection.db),
  transaction: new PostgresPeopleTransaction(peopleConnection.db),
});
export const personProfile = createPersonProfile({
  actors,
  repository: new PostgresPersonProfileRepository(peopleConnection.db),
  transaction: new PostgresPeopleTransaction(peopleConnection.db),
});
export const mail = new CapturedVerificationMail();
export const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const api = apiSupport(configured.app, mail, sql);

export interface Fixture {
  readonly cookie: string;
  readonly memberId: string;
  readonly workspaceId: string;
}

export function register(
  email: string,
  workspaceName: string,
): Promise<Fixture> {
  return api.register(email, workspaceName);
}

export function createPerson(
  fixture: Fixture,
  body: Readonly<Record<string, unknown>>,
  workspaceId = fixture.workspaceId,
): Promise<Response> {
  return submitPerson(api, fixture, body, workspaceId);
}

export function getPerson(
  fixture: Fixture,
  personId: string,
  workspaceId = fixture.workspaceId,
): Promise<Response> {
  return api.request(
    fixture,
    `/api/v1/people/${personId}`,
    "GET",
    undefined,
    workspaceId,
  );
}

export function getPersonSummary(
  fixture: Fixture,
  personId: string,
  workspaceId = fixture.workspaceId,
): Promise<Response> {
  return api.request(
    fixture,
    `/api/v1/people/${personId}?include=summary`,
    "GET",
    undefined,
    workspaceId,
  );
}

export function listPersonLifeEvents(
  fixture: Fixture,
  personId: string,
): Promise<Response> {
  return api.request(fixture, `/api/v1/people/${personId}/life-events`);
}

export function listPersonTimeline(
  fixture: Fixture,
  personId: string,
  query = "",
  workspaceId = fixture.workspaceId,
): Promise<Response> {
  return api.request(
    fixture,
    `/api/v1/people/${personId}/timeline${query ? `?${query}` : ""}`,
    "GET",
    undefined,
    workspaceId,
  );
}

export function listPeople(fixture: Fixture, query = ""): Promise<Response> {
  return api.request(fixture, `/api/v1/people${query ? `?${query}` : ""}`);
}

export function listTagOptions(
  fixture: Fixture,
  query = "",
): Promise<Response> {
  return listTagOptionsThroughApi(api, fixture, query);
}

export function importantDateRequest(
  fixture: Fixture,
  personId: string,
  method: "DELETE" | "GET" | "PATCH" | "POST",
  body?: Readonly<Record<string, unknown>>,
  dateId?: string,
): Promise<Response> {
  return importantDateRequestThroughApi(
    api,
    fixture,
    personId,
    method,
    body,
    dateId,
  );
}

export function relationshipRequest(
  fixture: Fixture,
  personId: string,
  method: "DELETE" | "GET" | "PATCH" | "POST",
  body?: Readonly<Record<string, unknown>>,
  relationshipId?: string,
): Promise<Response> {
  return api.request(
    fixture,
    `/api/v1/people/${personId}/relationships${
      relationshipId ? `/${relationshipId}` : ""
    }`,
    method,
    body,
  );
}

export async function createStaleActorFixture(
  name: string,
): Promise<
  PeopleActor & { readonly personId: string; readonly personName: string }
> {
  const personName = `Hidden ${name}`;
  const actor = await revocableActor(sql, name, {
    firstName: "Stale",
    personName,
    role: "member",
    workspaceName: `${name} circle`,
  });
  return { ...actor, personName };
}

export interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

export function deferred(): Deferred {
  let resolve = () => {};
  const promise = new Promise<void>((settled) => {
    resolve = settled;
  });
  return { promise, resolve };
}

export async function bounded<T>(
  operation: Promise<T>,
  label: string,
  milliseconds = 3_000,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export interface RevocationScenario {
  readonly name: string;
  apply(
    transaction: postgres.TransactionSql,
    actor: PeopleActor,
  ): Promise<void>;
}

export const revocationScenarios: readonly RevocationScenario[] = [
  {
    name: "member-left-at",
    async apply(transaction, actor) {
      await transaction`update crm.workspace_members set left_at = now()
        where id = ${actor.memberId}`;
    },
  },
  {
    name: "user-disabled",
    async apply(transaction, actor) {
      await transaction`update crm.users set status = 'disabled'
        where id = ${actor.userId}`;
    },
  },
  {
    name: "user-deleted-at",
    async apply(transaction, actor) {
      await transaction`update crm.users set deleted_at = now()
        where id = ${actor.userId}`;
    },
  },
  {
    name: "workspace-suspended",
    async apply(transaction, actor) {
      await transaction`update crm.workspaces set status = 'suspended'
        where id = ${actor.workspaceId}`;
    },
  },
  {
    name: "workspace-deleted-at",
    async apply(transaction, actor) {
      await transaction`update crm.workspaces set deleted_at = now()
        where id = ${actor.workspaceId}`;
    },
  },
];

export function racingPeople(
  authorizationAttempted: Deferred,
  authorizationLocked?: {
    readonly release: Deferred;
    readonly ready: Deferred;
  },
) {
  const delegate = new PostgresPeopleRepository();
  const repository: PeopleRepository = {
    lockRequest: () => Promise.resolve(),
    assertCreatedPostcondition: (command) =>
      delegate.assertCreatedPostcondition(command),
    create: (command) => delegate.create(command),
    findPossibleDuplicates: (command) =>
      delegate.findPossibleDuplicates(command),
    getIdentity: (command) => delegate.getIdentity(command),
  };
  const racingActors: ActorRevalidation = {
    async revalidate(command) {
      authorizationAttempted.resolve();
      const standing = await actors.revalidate(command);
      if (standing === "active" && authorizationLocked) {
        authorizationLocked.ready.resolve();
        await authorizationLocked.release.promise;
      }
      return standing;
    },
  };
  return createPeopleManagement({
    actors: racingActors,
    audit: personCreatedAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    ids: { create: () => crypto.randomUUID() },
    repository,
    transaction: new PostgresPeopleTransaction(peopleConnection.db),
  });
}

export async function counts(actor: PeopleActor): Promise<{
  readonly audits: number;
  readonly people: number;
}> {
  const [proof] = await sql<{
    readonly audits: number;
    readonly people: number;
  }[]>`
    select
      (select count(*)::int from crm.people
        where workspace_id = ${actor.workspaceId}) people,
      (select count(*)::int from crm.audit_events
        where workspace_id = ${actor.workspaceId}
          and action = 'people.person-created') audits
  `;
  assert(proof, "race proof is present");
  return proof;
}

/** Closes the app and every pool this suite's instance of the module opened. */
export async function closeResources(): Promise<void> {
  await sql.end();
  await raceSql.end();
  await peopleConnection.destroy();
  await configured.close();
}
