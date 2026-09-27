/**
 * What the read-model suites load (GAP-037): one Kysely connection the
 * PostgreSQL repositories read through, the actor revalidation and read
 * transaction their use cases take, and two workspaces seeded straight into
 * PostgreSQL so a repository is observed on rows it must and must not return.
 *
 * Read models only read, so the fixtures are written directly rather than
 * through the owning modules' facades; nothing here is production code.
 *
 * Deno loads every test file in its own worker isolate, so each suite that
 * imports this module owns its own pool and connection and closes them
 * through `closeResources()` in its final test.
 */

import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { PostgresPeopleTransaction } from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import {
  openSql,
  requireDatabaseUrl,
  type RevocableActor,
  revocableActor,
} from "../support/database.ts";

export const databaseUrl = requireDatabaseUrl();
export const sql = openSql(databaseUrl);
export const connection = connectDatabase(databaseUrl);
export const actors = new PostgresActorRevalidation();
export const transaction = new PostgresPeopleTransaction(connection.db);

export type SeededActor = RevocableActor & {
  readonly role: "admin" | "member" | "owner";
};

/**
 * Two workspaces, each with its own owner and person: the reader's, and a
 * foreign one whose rows the reader must never see.
 */
export async function twoWorkspaces(name: string): Promise<{
  readonly foreign: SeededActor;
  readonly reader: SeededActor;
}> {
  const suffix = crypto.randomUUID();
  const reader = await revocableActor(sql, `${name}-reader-${suffix}`, {
    personName: "Reader subject",
    workspaceName: `${name} reader`,
  });
  const foreign = await revocableActor(sql, `${name}-foreign-${suffix}`, {
    personName: "Foreign secret",
    workspaceName: `${name} foreign`,
  });
  return { foreign, reader };
}

/** Another active member of an existing workspace, with the given role. */
export async function memberOf(
  workspace: SeededActor,
  role: "admin" | "member",
): Promise<SeededActor> {
  const userId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  await sql`
    insert into crm.users (id, email, first_name, status)
    values (${userId}, ${`${role}-${userId}@example.test`}, 'Second', 'active')
  `;
  await sql`
    insert into crm.workspace_members (
      id, workspace_id, user_id, role, status, joined_at
    ) values (
      ${memberId}, ${workspace.workspaceId}, ${userId}, ${role}, 'active', now()
    )
  `;
  return { ...workspace, memberId, role, userId };
}

/** A person in the actor's workspace. */
export async function addPerson(
  actor: SeededActor,
  givenName: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.people (id, workspace_id, created_by_member_id, given_name)
    values (${id}, ${actor.workspaceId}, ${actor.memberId}, ${givenName})
  `;
  return id;
}

/** An activity in the actor's workspace, attended by the given people. */
export async function addActivity(
  actor: SeededActor,
  summary: string,
  happenedAt: string,
  participants: readonly string[],
): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.activities (
      id, workspace_id, summary, happened_at, created_by_member_id
    ) values (
      ${id}, ${actor.workspaceId}, ${summary}, ${happenedAt},
      ${actor.memberId}
    )
  `;
  for (const personId of participants) {
    await sql`
      insert into crm.activity_participants (activity_id, person_id)
      values (${id}, ${personId})
    `;
  }
  return id;
}

/** A note on a person in the actor's workspace. */
export async function addNote(
  actor: SeededActor,
  personId: string,
  body: string,
  createdAt: string,
  favorited = false,
): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.notes (
      id, workspace_id, person_id, body, is_favorited, favorited_at,
      created_by_member_id, created_at, updated_at
    ) values (
      ${id}, ${actor.workspaceId}, ${personId}, ${body}, ${favorited},
      ${favorited ? createdAt : null}, ${actor.memberId}, ${createdAt},
      ${createdAt}
    )
  `;
  return id;
}

/** Closes the pool and connection this suite's instance of the module opened. */
export async function closeResources(): Promise<void> {
  await Promise.all([sql.end(), connection.destroy()]);
}
