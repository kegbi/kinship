/**
 * What each interactions suite loads (GAP-035): a configured app, pool, and
 * mailbox, the use cases the suites drive directly, and the fixtures that
 * register owners and create people through the API.
 *
 * Deno loads every test file in its own worker isolate, so each suite that
 * imports this module evaluates it afresh and owns its own app, pools, and
 * mailbox; nothing here is shared between suites. Each suite closes its own
 * instance in its final test, most of them through `closeResources()`.
 */

import { PostgresRequestTombstones } from "../../packages/backend/modules/governance/adapters/postgres/request_tombstones.ts";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  createCommunicationManagement,
  createInteractionManagement,
} from "../../packages/backend/modules/interactions/public.ts";
import {
  communicationAuditFrom,
  interactionAuditFrom,
} from "../../packages/backend/modules/interactions/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import { PostgresCommunicationRepository } from "../../packages/backend/modules/interactions/adapters/postgres/communication_repository.ts";
import { PostgresInteractionRepository } from "../../packages/backend/modules/interactions/adapters/postgres/interaction_repository.ts";
import { PostgresPeopleTransaction } from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import { PostgresRelationshipPersonBoundary } from "../../packages/backend/modules/people/adapters/postgres/relationship_person_boundary.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import { PostgresInteractionWorkspaceBoundary } from "../../packages/backend/modules/workspaces/adapters/postgres/interaction_workspace_boundary.ts";
import { openSql, requireDatabaseUrl } from "../support/database.ts";
import { apiSupport, type SignedInFixture } from "../support/api.ts";
import { createPerson as createPersonThroughApi } from "../support/fixtures.ts";

export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]));
  }
  if (
    typeof left !== "object" || left === null ||
    typeof right !== "object" || right === null
  ) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord).sort();
  return keys.join("\u0000") ===
      Object.keys(rightRecord).sort().join("\u0000") &&
    keys.every((key) => deepEqual(leftRecord[key], rightRecord[key]));
}

export function tamperCursorId(cursor: string): string {
  const normalized = cursor.replaceAll("-", "+").replaceAll("_", "/");
  const parsed = JSON.parse(atob(normalized.padEnd(
    normalized.length + (4 - normalized.length % 4) % 4,
    "=",
  ))) as Record<string, unknown>;
  return btoa(JSON.stringify({ ...parsed, id: "not-a-uuid" }))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export const databaseUrl = requireDatabaseUrl();
export const sql = openSql(databaseUrl);
export const mail = new CapturedVerificationMail();
export const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
export const directConnection = connectDatabase(databaseUrl);
export const directInteractions = createInteractionManagement({
  actors: new PostgresActorRevalidation(),
  audit: interactionAuditFrom(new PostgresAuditEventRecorder()),
  clock: { now: () => new Date("2026-08-17T12:30:00.000Z") },
  people: new PostgresRelationshipPersonBoundary(),
  repository: new PostgresInteractionRepository(),
  tombstones: new PostgresRequestTombstones(),
  transaction: new PostgresPeopleTransaction(directConnection.db),
  workspace: new PostgresInteractionWorkspaceBoundary(),
});
export const directCommunications = createCommunicationManagement({
  actors: new PostgresActorRevalidation(),
  audit: communicationAuditFrom(new PostgresAuditEventRecorder()),
  clock: { now: () => new Date("2026-08-17T12:30:00.000Z") },
  people: new PostgresRelationshipPersonBoundary(),
  repository: new PostgresCommunicationRepository(),
  tombstones: new PostgresRequestTombstones(),
  transaction: new PostgresPeopleTransaction(directConnection.db),
  workspace: new PostgresInteractionWorkspaceBoundary(),
});

const api = apiSupport(configured.app, mail, sql);

export type Fixture = SignedInFixture;

export function register(
  email: string,
  workspaceName: string,
): Promise<Fixture> {
  return api.register(email, workspaceName, {
    firstName: "Interaction",
    lastName: "Tester",
  });
}

export function createPerson(
  fixture: Fixture,
  givenName: string,
): Promise<string> {
  return createPersonThroughApi(api, fixture, givenName);
}

export function request(
  fixture: Fixture,
  path: string,
  method: "DELETE" | "GET" | "POST" = "GET",
  body?: unknown,
): Promise<Response> {
  return api.request(fixture, path, method, body);
}

/** Closes the app and every pool this suite's instance of the module opened. */
export async function closeResources(): Promise<void> {
  await sql.end();
  await configured.close();
  await directConnection.destroy();
}
