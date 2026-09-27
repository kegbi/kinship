/**
 * PostgreSQL scaffolding the integration suites share (GAP-035).
 *
 * Every integration file runs against the one disposable PostgreSQL project
 * `deno task test:integration` provisions around the suite. These helpers own
 * the steps each file used to hand-roll: reading the connection string, opening
 * a quiet Postgres.js pool, resetting the identity tables a file starts from,
 * and seeding a workspace whose membership a test can revoke mid-flight.
 *
 * Like `apps/web/src/testing/`, this is test support: it is neither production
 * code nor a suite, so no coverage set measures it and it has no manifest
 * home of its own.
 */

import postgres from "postgres";

export type Sql = postgres.Sql;

/** The disposable database every integration file connects to. */
export function requireDatabaseUrl(): string {
  const databaseUrl = Deno.env.get("DATABASE_URL");
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for integration tests");
  }
  return databaseUrl;
}

/** A Postgres.js pool that keeps server notices out of the test output. */
export function openSql(
  databaseUrl: string,
  options: { readonly max?: number; readonly prepare?: boolean } = {},
): Sql {
  return postgres(databaseUrl, {
    max: options.max ?? 2,
    onnotice: () => undefined,
    ...(options.prepare === undefined ? {} : { prepare: options.prepare }),
  });
}

/** The roots whose cascade clears every identity, workspace, and audit row. */
export const IDENTITY_TABLES = [
  "crm.users",
  "crm.workspaces",
  "crm.audit_events",
] as const;

/** Empties the named tables, restarting identities and cascading. */
export async function truncate(
  sql: Sql,
  tables: readonly string[],
): Promise<void> {
  await sql`truncate table ${sql(tables)} restart identity cascade`;
}

/**
 * Returns the database to a clean slate: the identity roots, plus any table a
 * file needs cleared that no identity root cascades to.
 */
export async function resetDatabase(
  sql: Sql,
  extra: readonly string[] = [],
): Promise<void> {
  await truncate(sql, [...IDENTITY_TABLES, ...extra]);
}

export interface RevocableActor {
  readonly memberId: string;
  readonly personId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

export interface RevocableActorOptions<Role extends string> {
  /** The user's first name. */
  readonly firstName?: string;
  /** The seeded person's given name. */
  readonly personName?: string;
  readonly role?: Role;
  /** The workspace's name; the actor's name when omitted. */
  readonly workspaceName?: string;
}

/**
 * A workspace whose only member can be revoked mid-test (GAP-009). The rows
 * are written directly so a use case is exercised without the session layer
 * refusing first.
 */
export async function revocableActor<Role extends string = "owner">(
  sql: Sql,
  name: string,
  options: RevocableActorOptions<Role> = {},
): Promise<RevocableActor & { readonly role: Role }> {
  const role = options.role ?? "owner" as Role;
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const personId = crypto.randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`
      insert into crm.users (id, email, first_name, status)
      values (
        ${userId}, ${`${name}@example.test`},
        ${options.firstName ?? "Revocable"}, 'active'
      )
    `;
    await transaction`
      insert into crm.workspaces (id, name, status, created_by_user_id)
      values (
        ${workspaceId}, ${options.workspaceName ?? name}, 'active', ${userId}
      )
    `;
    await transaction`
      insert into crm.workspace_members (
        id, workspace_id, user_id, role, status, joined_at
      ) values (${memberId}, ${workspaceId}, ${userId}, ${role}, 'active', now())
    `;
    await transaction`
      insert into crm.people (id, workspace_id, created_by_member_id, given_name)
      values (
        ${personId}, ${workspaceId}, ${memberId},
        ${options.personName ?? "Revocation subject"}
      )
    `;
  });
  return { memberId, personId, role, userId, workspaceId };
}

/** Ends a membership the way leaving a workspace does. */
export async function revokeMembership(
  sql: Sql,
  memberId: string,
): Promise<void> {
  await sql`
    update crm.workspace_members set status = 'left', left_at = now()
    where id = ${memberId}
  `;
}

/**
 * Adds an active membership for an existing user, with the preferences row
 * registration would have created.
 */
export async function addMembership(
  sql: Sql,
  userId: string,
  workspaceId: string,
  role: "admin" | "member" | "owner",
  status: "active" | "suspended" = "active",
): Promise<string> {
  const memberId = crypto.randomUUID();
  await sql`
    insert into crm.workspace_members (
      id, workspace_id, user_id, role, status, joined_at, created_at, updated_at
    ) values (
      ${memberId}, ${workspaceId}, ${userId}, ${role}, ${status},
      now(), now(), now()
    )
  `;
  await sql`insert into crm.member_preferences (member_id) values (${memberId})`;
  return memberId;
}
