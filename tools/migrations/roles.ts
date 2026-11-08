/**
 * The database roles schema v14 onward relies on (ADR 0008), and the one bootstrap
 * step that creates them.
 *
 * Roles are cluster objects with passwords, so the canonical DDL never creates
 * one: it names these roles, refuses to apply when they are missing, and
 * grants them exactly what each needs. The bootstrap step is the only code
 * that connects as the database superuser. It:
 *
 * - creates or corrects the three login roles — `kinship_migrator`, which owns
 *   schema `crm`, runs only the migrate job, and bypasses row-level security;
 *   `kinship_app`, the API's role; and `kinship_worker`, the worker's — none a
 *   superuser, and the two service roles with `NOBYPASSRLS`;
 * - creates the non-login roles that own the narrow cross-workspace functions,
 *   none of which bypasses row-level security, and lets the migrator assign
 *   ownership to them without inheriting their privileges;
 * - lets the roles connect, lets the migrator create the schema, and revokes
 *   `CREATE` on schema `public`;
 * - hands an existing schema `crm` (one a pre-v14 migrate job created as the
 *   superuser) to the migrator, so the v13-to-v14 migration can run.
 *
 * Every statement is idempotent, so the step runs before each migrate job.
 */

import postgres from "postgres";

/** The three login roles, one per process. */
export const LOGIN_ROLES = {
  app: "kinship_app",
  migrator: "kinship_migrator",
  worker: "kinship_worker",
} as const;

/**
 * The non-login owners of the cross-workspace functions, one per path that
 * ADR 0008 (amended 2026-11-08) admits.
 */
export const FUNCTION_OWNER_ROLES = [
  "kinship_session_resolver",
  "kinship_token_resolver",
  "kinship_invitation_resolver",
  "kinship_registration",
  "kinship_account_lifecycle",
  "kinship_workspace_lifecycle",
  "kinship_request_budget",
  "kinship_planning_maintenance",
] as const;

/** The passwords the login roles are given, from deployment secrets. */
export interface RolePasswords {
  readonly app: string;
  readonly migrator: string;
  readonly worker: string;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`"${name}" is no identifier`);
  return name;
}

/**
 * The statement that creates and corrects every role, without passwords or
 * any database grant. The schema validator runs exactly this against its
 * scratch cluster, so the canonical DDL is always applied against the roles
 * production has.
 */
export function roleCreationStatements(): string {
  const { app, migrator, worker } = LOGIN_ROLES;
  const owners = FUNCTION_OWNER_ROLES.map(identifier);
  const ensure = (name: string, attributes: string) => `
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${name}') THEN
    CREATE ROLE ${name} ${attributes};
  END IF;
  ALTER ROLE ${name} ${attributes};`;
  const fixed = "NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS";
  return `DO $kinship_roles$
BEGIN${
    owners.map((name) => ensure(name, `NOLOGIN NOINHERIT ${fixed}`)).join("")
  }${ensure(app, `NOLOGIN NOINHERIT ${fixed}`)}${
    ensure(worker, `NOLOGIN NOINHERIT ${fixed}`)
  }${
    ensure(
      migrator,
      "NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS",
    )
  }
END
$kinship_roles$;`;
}

/**
 * Every bootstrap statement for one database, without passwords: the roles,
 * the database grants, membership that lets the migrator assign function
 * owners, and the hand-over of an existing schema to the migrator.
 */
export function roleStatements(database: string): string {
  const db = identifier(database);
  const { app, migrator, worker } = LOGIN_ROLES;
  const owners = FUNCTION_OWNER_ROLES.map(identifier);
  return `${roleCreationStatements()}
GRANT CONNECT ON DATABASE ${db} TO ${app}, ${worker}, ${migrator};
GRANT CREATE ON DATABASE ${db} TO ${migrator};
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
${
    owners.map((name) =>
      `GRANT ${name} TO ${migrator} WITH INHERIT FALSE, SET TRUE;`
    ).join("\n")
  }
DO $kinship_owner$
DECLARE
  item record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'crm') THEN
    RETURN;
  END IF;
  EXECUTE 'ALTER SCHEMA crm OWNER TO ${migrator}';
  FOR item IN
    SELECT c.oid::regclass AS name FROM pg_class c
    WHERE c.relnamespace = 'crm'::regnamespace
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND c.relowner <> '${migrator}'::regrole
  LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO ${migrator}', item.name);
  END LOOP;
  FOR item IN
    SELECT p.oid::regprocedure AS name FROM pg_proc p
    WHERE p.pronamespace = 'crm'::regnamespace
      AND p.proowner <> '${migrator}'::regrole
      AND p.proowner::regrole::text NOT IN (${
    owners.map((name) => `'${name}'`).join(", ")
  })
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO ${migrator}', item.name);
  END LOOP;
  FOR item IN
    SELECT t.oid::regtype AS name FROM pg_type t
    WHERE t.typnamespace = 'crm'::regnamespace AND t.typtype IN ('e', 'd', 'r')
      AND t.typowner <> '${migrator}'::regrole
  LOOP
    EXECUTE format('ALTER TYPE %s OWNER TO ${migrator}', item.name);
  END LOOP;
END
$kinship_owner$;`;
}

/** The statements that let the login roles sign in with their passwords. */
async function loginStatements(
  client: postgres.Sql,
  passwords: RolePasswords,
): Promise<readonly string[]> {
  const statements: string[] = [];
  for (
    const [role, password] of [
      [LOGIN_ROLES.migrator, passwords.migrator],
      [LOGIN_ROLES.app, passwords.app],
      [LOGIN_ROLES.worker, passwords.worker],
    ] as const
  ) {
    if (password.length < 16) {
      throw new Error(`The ${role} password must be at least 16 characters.`);
    }
    // The server quotes the secret, so no client-side escaping is involved.
    const [row] = await client<{ readonly statement: string }[]>`
      select format('ALTER ROLE %I LOGIN PASSWORD %L', ${role}::text,
        ${password}::text) as statement
    `;
    if (!row) throw new Error(`Could not prepare the ${role} login.`);
    statements.push(row.statement);
  }
  return statements;
}

/**
 * Creates or corrects every role, and gives the login roles their passwords,
 * in one transaction, connected as the superuser at `adminUrl`.
 */
export async function bootstrapRoles(
  adminUrl: string,
  passwords: RolePasswords,
): Promise<void> {
  const client = postgres(adminUrl, {
    connect_timeout: 5,
    idle_timeout: 5,
    max: 1,
    onnotice: () => undefined,
    prepare: false,
  });
  try {
    const [current] = await client<{ readonly database: string }[]>`
      select current_database() as database
    `;
    if (!current) throw new Error("Could not read the database name.");
    const logins = await loginStatements(client, passwords);
    await client.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(492337111)`;
      await transaction.unsafe(roleStatements(current.database));
      for (const statement of logins) await transaction.unsafe(statement);
    });
  } finally {
    await client.end({ timeout: 2 });
  }
}

/** Reads the three role passwords from the environment, or refuses. */
export function rolePasswordsFrom(
  environment: { get(name: string): string | undefined },
): RolePasswords {
  const read = (name: string) => {
    const value = environment.get(name);
    if (!value) throw new Error(`${name} is required.`);
    return value;
  };
  const passwords = {
    app: read("POSTGRES_APP_PASSWORD"),
    migrator: read("POSTGRES_MIGRATOR_PASSWORD"),
    worker: read("POSTGRES_WORKER_PASSWORD"),
  };
  if (new Set(Object.values(passwords)).size !== 3) {
    throw new Error("Each database role needs its own password.");
  }
  return passwords;
}
