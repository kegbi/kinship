import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface SchemaValidation {
  readonly status: string;
  readonly source_tables: number;
  readonly source_columns: number;
  readonly tables: number;
  readonly columns: number;
  readonly explicit_indexes: number;
  readonly foreign_keys: number;
  readonly jsonb_fields: number;
  readonly workspace_id_fields: number;
  readonly table_mapping_rows: number;
  readonly column_mapping_rows: number;
  readonly field_catalog_rows: number;
  readonly all_indexes: number;
  readonly check_constraints: number;
  readonly primary_keys: number;
  readonly unique_constraints: number;
  readonly deferred_foreign_keys: number;
  readonly sha256: Readonly<Record<string, string>>;
}

interface LiveMetrics {
  readonly tables: number;
  readonly columns: number;
  readonly foreign_keys: number;
  readonly explicit_indexes: number;
  readonly jsonb_fields: number;
  readonly workspace_id_fields: number;
  readonly forward_reference_foreign_keys: number;
  readonly primary_keys: number;
  readonly all_indexes: number;
  readonly check_constraints: number;
  readonly unique_constraints: number;
}

interface CommandOptions {
  readonly quiet?: boolean;
  readonly allowFailure?: boolean;
}

// deno-fmt-ignore
const DEFAULT_POSTGRES_IMAGE = "postgres:18.4-alpine3.23@sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e";
const SCHEMA_DATABASE = "crm_schema_test";
const ROLLBACK_DATABASE = "crm_rollback_test";
const UPGRADE_DATABASE = "crm_upgrade_test";
const V2_UPGRADE_DATABASE = "crm_v2_upgrade_test";
const V3_UPGRADE_DATABASE = "crm_v3_upgrade_test";
const MIGRATION_ROLLBACK_DATABASE = "crm_migration_rollback_test";
const DATABASE_USER = "crm_test";

const scriptDirectory = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
);
const repositoryRoot = resolve(scriptDirectory, "../..");
const schemaDirectory = resolve(repositoryRoot, "personal-crm-schema/v4");
const v1SchemaDirectory = resolve(repositoryRoot, "personal-crm-schema/v1");
const v2SchemaDirectory = resolve(repositoryRoot, "personal-crm-schema/v2");
const v3SchemaDirectory = resolve(repositoryRoot, "personal-crm-schema/v3");
const validationPath = resolve(
  schemaDirectory,
  "personal_crm_schema_v4_validation.json",
);
const v1ValidationPath = resolve(
  v1SchemaDirectory,
  "personal_crm_schema_v3_validation.json",
);
const v2ValidationPath = resolve(
  v2SchemaDirectory,
  "personal_crm_schema_v2_validation.json",
);
const v3ValidationPath = resolve(
  v3SchemaDirectory,
  "personal_crm_schema_v3_validation.json",
);

function parsePostgresImage(args: readonly string[]): string {
  let image = DEFAULT_POSTGRES_IMAGE;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--postgres-image") {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error("--postgres-image requires a value");
      }
      image = value;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--postgres-image=")) {
      image = argument.slice("--postgres-image=".length);
      continue;
    }
    if (argument === "--help") {
      console.log(
        "Usage: deno task test:schema [--postgres-image <official-image>]",
      );
      Deno.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$/.test(image)) {
    throw new Error(`Invalid PostgreSQL image reference: ${image}`);
  }

  return image;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim();
}

function formatFailure(
  executable: string,
  args: readonly string[],
  code: number,
  stdout: Uint8Array,
  stderr: Uint8Array,
): string {
  return [
    `Command failed (${code}): ${executable} ${args.join(" ")}`,
    decode(stdout),
    decode(stderr),
  ].filter((line) => line.length > 0).join("\n");
}

async function sha256(path: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await Deno.readFile(path),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function verifyArtifacts(
  validation: SchemaValidation,
): Promise<void> {
  if (
    validation.status !== "pending-live-validation" &&
    validation.status !== "passed"
  ) {
    throw new Error(`Schema v4 validation status is ${validation.status}`);
  }

  for (const [filename, expectedHash] of Object.entries(validation.sha256)) {
    const actualHash = await sha256(resolve(schemaDirectory, filename));
    if (actualHash !== expectedHash) {
      throw new Error(
        `Schema v4 artifact hash mismatch for ${filename}: ${actualHash}`,
      );
    }
  }
}

async function verifyImmutableV1Artifacts(): Promise<void> {
  const parsed = JSON.parse(await Deno.readTextFile(v1ValidationPath)) as {
    readonly sha256?: Readonly<Record<string, string>>;
  };
  if (!parsed.sha256) throw new Error("Invalid immutable v1 validation JSON.");
  for (const [filename, expectedHash] of Object.entries(parsed.sha256)) {
    const actualHash = await sha256(resolve(v1SchemaDirectory, filename));
    if (actualHash !== expectedHash) {
      throw new Error(`Immutable schema v1 artifact drifted: ${filename}.`);
    }
  }
}

async function verifyImmutableV2Artifacts(): Promise<void> {
  const parsed = JSON.parse(await Deno.readTextFile(v2ValidationPath)) as {
    readonly sha256?: Readonly<Record<string, string>>;
  };
  if (!parsed.sha256) throw new Error("Invalid immutable v2 validation JSON.");
  for (const [filename, expectedHash] of Object.entries(parsed.sha256)) {
    const actualHash = await sha256(resolve(v2SchemaDirectory, filename));
    if (actualHash !== expectedHash) {
      throw new Error(`Immutable schema v2 artifact drifted: ${filename}.`);
    }
  }
}

async function verifyImmutableV3Artifacts(): Promise<void> {
  const parsed = JSON.parse(await Deno.readTextFile(v3ValidationPath)) as {
    readonly sha256?: Readonly<Record<string, string>>;
  };
  if (!parsed.sha256) throw new Error("Invalid immutable v3 validation JSON.");
  for (const [filename, expectedHash] of Object.entries(parsed.sha256)) {
    const actualHash = await sha256(resolve(v3SchemaDirectory, filename));
    if (actualHash !== expectedHash) {
      throw new Error(`Immutable schema v3 artifact drifted: ${filename}.`);
    }
  }
}

function countCsvRows(path: string): Promise<number> {
  return Deno.readTextFile(path).then((contents) => {
    const lines = contents.trimEnd().split(/\r?\n/);
    return Math.max(0, lines.length - 1);
  });
}

function assertEqual(
  label: string,
  actual: number,
  expected: number,
): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const postgresImage = parsePostgresImage(Deno.args);
const projectName = `relationships-schema-${Deno.pid}-${Date.now()}`;
const composePrefix = [
  "compose",
  "--file",
  resolve(repositoryRoot, "compose.schema-test.yaml"),
  "--project-name",
  projectName,
];

async function runDocker(
  args: readonly string[],
  options: CommandOptions = {},
): Promise<string> {
  const command = new Deno.Command("docker", {
    args: [...args],
    cwd: repositoryRoot,
    env: { POSTGRES_IMAGE: postgresImage },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const stdout = decode(output.stdout);
  const stderr = decode(output.stderr);

  if (!output.success && !options.allowFailure) {
    throw new Error(
      formatFailure("docker", args, output.code, output.stdout, output.stderr),
    );
  }
  if (!options.quiet) {
    if (stdout.length > 0) console.log(stdout);
    if (stderr.length > 0) console.error(stderr);
  }
  return stdout;
}

function runCompose(
  args: readonly string[],
  options: CommandOptions = {},
): Promise<string> {
  return runDocker([...composePrefix, ...args], options);
}

function runPsql(
  database: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<string> {
  return runCompose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-X",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    DATABASE_USER,
    "-d",
    database,
    ...args,
  ], options);
}

async function copyFixture(
  repositoryRelativePath: string,
  containerPath: string,
): Promise<void> {
  await runCompose([
    "cp",
    repositoryRelativePath,
    `postgres:${containerPath}`,
  ], { quiet: true });
}

async function readValidation(): Promise<SchemaValidation> {
  const parsed: unknown = JSON.parse(await Deno.readTextFile(validationPath));
  if (typeof parsed !== "object" || parsed === null || !("sha256" in parsed)) {
    throw new Error("Invalid schema v4 validation JSON");
  }
  return parsed as SchemaValidation;
}

async function readLiveMetrics(): Promise<LiveMetrics> {
  const query = `
    SELECT json_build_object(
      'tables', (SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'crm'),
      'columns', (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'crm'),
      'foreign_keys', (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace = 'crm'::regnamespace AND contype = 'f'),
      'explicit_indexes', (
        SELECT count(*)
        FROM pg_catalog.pg_class AS indexes
        JOIN pg_catalog.pg_namespace AS namespaces ON namespaces.oid = indexes.relnamespace
        WHERE namespaces.nspname = 'crm'
          AND indexes.relkind = 'i'
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_constraint AS constraints
            WHERE constraints.conindid = indexes.oid
          )
      ),
      'jsonb_fields', (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'crm' AND data_type = 'jsonb'),
      'workspace_id_fields', (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'crm' AND column_name = 'workspace_id'),
      'forward_reference_foreign_keys', (
        SELECT count(*) FROM pg_catalog.pg_constraint
        WHERE connamespace = 'crm'::regnamespace
          AND contype = 'f'
          AND conname IN ('workspace_members_self_person_fk', 'person_first_meetings_location_fk')
      ),
      'primary_keys', (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace = 'crm'::regnamespace AND contype = 'p'),
      'all_indexes', (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname = 'crm'),
      'check_constraints', (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace = 'crm'::regnamespace AND contype = 'c'),
      'unique_constraints', (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace = 'crm'::regnamespace AND contype = 'u')
    )::text;
  `;
  const output = await runPsql(
    SCHEMA_DATABASE,
    ["-A", "-t", "-c", query],
    { quiet: true },
  );
  return JSON.parse(output) as LiveMetrics;
}

async function assertArtifactCounts(
  validation: SchemaValidation,
): Promise<void> {
  assertEqual(
    "table mapping rows",
    await countCsvRows(resolve(schemaDirectory, "monica_table_mapping_v4.csv")),
    validation.table_mapping_rows,
  );
  assertEqual(
    "column mapping rows",
    await countCsvRows(
      resolve(schemaDirectory, "monica_column_mapping_v4.csv"),
    ),
    validation.column_mapping_rows,
  );
  assertEqual(
    "field catalog rows",
    await countCsvRows(
      resolve(schemaDirectory, "personal_crm_field_catalog_v4.csv"),
    ),
    validation.field_catalog_rows,
  );
}

async function applySchema(database: string): Promise<void> {
  await runPsql(database, [
    "--single-transaction",
    "-f",
    "/tmp/personal_crm_schema_v4.sql",
  ], { quiet: true });
}

async function assertRollback(): Promise<void> {
  await runPsql("postgres", [
    "-c",
    `CREATE DATABASE ${ROLLBACK_DATABASE}`,
  ], { quiet: true });

  try {
    await runPsql(ROLLBACK_DATABASE, [
      "-c",
      "BEGIN",
      "-f",
      "/tmp/personal_crm_schema_v4.sql",
      "-c",
      "ROLLBACK",
    ], { quiet: true });

    const remaining = await runPsql(ROLLBACK_DATABASE, [
      "-A",
      "-t",
      "-c",
      "SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspname = 'crm';",
    ], { quiet: true });
    if (remaining !== "0") {
      throw new Error(
        `transaction rollback left the crm schema behind: ${remaining}`,
      );
    }
  } finally {
    await runPsql("postgres", [
      "-c",
      `DROP DATABASE IF EXISTS ${ROLLBACK_DATABASE}`,
    ], { quiet: true });
  }
}

async function assertV1UpgradeAndFailureRollback(): Promise<void> {
  for (
    const database of [
      UPGRADE_DATABASE,
      V2_UPGRADE_DATABASE,
      V3_UPGRADE_DATABASE,
      MIGRATION_ROLLBACK_DATABASE,
    ]
  ) {
    await runPsql("postgres", ["-c", `CREATE DATABASE ${database}`], {
      quiet: true,
    });
  }
  try {
    await runPsql(UPGRADE_DATABASE, [
      "--single-transaction",
      "-f",
      "/tmp/personal_crm_schema_v1.sql",
    ], { quiet: true });
    await runPsql(UPGRADE_DATABASE, [
      "-c",
      "INSERT INTO crm.api_request_logs (method, path, status_code) VALUES ('GET', '/upgrade-preserved', 200)",
      "--single-transaction",
      "-f",
      "/tmp/0002_add_authentication_subject_digest.sql",
      "-f",
      "/tmp/0003_add_user_session_purpose.sql",
      "-f",
      "/tmp/0004_seed_iso_4217_currencies.sql",
    ], { quiet: true });
    const upgraded = await runPsql(UPGRADE_DATABASE, [
      "-A",
      "-t",
      "-c",
      `SELECT
        EXISTS(SELECT 1 FROM information_schema.columns
          WHERE table_schema='crm' AND table_name='api_request_logs'
            AND column_name='authentication_subject_digest')
        AND EXISTS(SELECT 1 FROM information_schema.columns
          WHERE table_schema='crm' AND table_name='user_sessions'
            AND column_name='purpose')
        AND (SELECT count(*) = 165 FROM crm.currencies)
        AND (SELECT count(*) = 1 FROM crm.api_request_logs
          WHERE path='/upgrade-preserved');`,
    ], { quiet: true });
    if (upgraded !== "t") {
      throw new Error("v1-to-v4 migration did not preserve the exact fixture.");
    }

    await runPsql(V2_UPGRADE_DATABASE, [
      "--single-transaction",
      "-f",
      "/tmp/personal_crm_schema_v2.sql",
      "-c",
      `INSERT INTO crm.users (id, email, first_name, last_name, status)
       VALUES ('00000000-0000-4000-8000-000000000003', 'legacy@example.test', 'Legacy', 'Session', 'active')`,
      "-c",
      `INSERT INTO crm.user_sessions
       (id, user_id, session_hash, expires_at)
       VALUES ('00000000-0000-4000-8000-000000000004',
         '00000000-0000-4000-8000-000000000003', 'legacy-hash', now() + interval '1 hour')`,
      "-f",
      "/tmp/0003_add_user_session_purpose.sql",
      "-f",
      "/tmp/0004_seed_iso_4217_currencies.sql",
    ], { quiet: true });
    const v2Upgraded = await runPsql(V2_UPGRADE_DATABASE, [
      "-A",
      "-t",
      "-c",
      `SELECT purpose = 'legacy' AND revoked_at IS NOT NULL
         AND (SELECT count(*) = 165 FROM crm.currencies)
       FROM crm.user_sessions
       WHERE id = '00000000-0000-4000-8000-000000000004';`,
    ], { quiet: true });
    if (v2Upgraded !== "t") {
      throw new Error("v2-to-v4 migration did not revoke ambiguous authority.");
    }

    await runPsql(V3_UPGRADE_DATABASE, [
      "--single-transaction",
      "-f",
      "/tmp/personal_crm_schema_v3.sql",
      "-f",
      "/tmp/0004_seed_iso_4217_currencies.sql",
    ], { quiet: true });
    const v3Upgraded = await runPsql(V3_UPGRADE_DATABASE, [
      "-A",
      "-t",
      "-c",
      `SELECT count(*) = 165
       AND bool_and(is_active)
       AND max(name) FILTER (WHERE code = 'EUR') = 'Euro'
       FROM crm.currencies;`,
    ], { quiet: true });
    if (v3Upgraded !== "t") {
      throw new Error("v3-to-v4 migration did not seed the exact catalog.");
    }

    await runPsql(MIGRATION_ROLLBACK_DATABASE, [
      "--single-transaction",
      "-f",
      "/tmp/personal_crm_schema_v2.sql",
    ], { quiet: true });
    await runPsql(MIGRATION_ROLLBACK_DATABASE, [
      "-c",
      "BEGIN",
      "-f",
      "/tmp/0003_add_user_session_purpose.sql",
      "-c",
      "SELECT 1 / 0",
    ], { allowFailure: true, quiet: true });
    const rolledBack = await runPsql(MIGRATION_ROLLBACK_DATABASE, [
      "-A",
      "-t",
      "-c",
      `SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='crm' AND table_name='user_sessions'
          AND column_name='purpose');`,
    ], { quiet: true });
    if (rolledBack !== "t") {
      throw new Error(
        "failed v2-to-v3 migration did not roll back atomically.",
      );
    }
  } finally {
    for (
      const database of [
        UPGRADE_DATABASE,
        V2_UPGRADE_DATABASE,
        V3_UPGRADE_DATABASE,
        MIGRATION_ROLLBACK_DATABASE,
      ]
    ) {
      await runPsql("postgres", [
        "-c",
        `DROP DATABASE IF EXISTS ${database}`,
      ], { quiet: true, allowFailure: true });
    }
  }
}

async function main(): Promise<void> {
  const validation = await readValidation();
  await verifyArtifacts(validation);
  await verifyImmutableV1Artifacts();
  await verifyImmutableV2Artifacts();
  await verifyImmutableV3Artifacts();
  await assertArtifactCounts(validation);

  const dockerVersion = await runDocker(
    ["info", "--format", "{{.ServerVersion}}"],
    { quiet: true },
  );
  console.log(`Docker Engine ${dockerVersion}`);
  console.log(`Testing ${postgresImage}`);

  let started = false;
  try {
    await runCompose(["up", "--detach", "--wait", "--wait-timeout", "90"]);
    started = true;

    await copyFixture(
      "personal-crm-schema/v4/personal_crm_schema_v4.sql",
      "/tmp/personal_crm_schema_v4.sql",
    );
    await copyFixture(
      "personal-crm-schema/v3/personal_crm_schema_v3.sql",
      "/tmp/personal_crm_schema_v3.sql",
    );
    await copyFixture(
      "personal-crm-schema/v2/personal_crm_schema_v2.sql",
      "/tmp/personal_crm_schema_v2.sql",
    );
    await copyFixture(
      "personal-crm-schema/v4/personal_crm_field_catalog_v4.csv",
      "/tmp/personal_crm_field_catalog_v4.csv",
    );
    await copyFixture(
      "personal-crm-schema/v1/personal_crm_rewrite_schema_v3.sql",
      "/tmp/personal_crm_schema_v1.sql",
    );
    await copyFixture(
      "personal-crm-schema/v2/migrations/0002_add_authentication_subject_digest.sql",
      "/tmp/0002_add_authentication_subject_digest.sql",
    );
    await copyFixture(
      "personal-crm-schema/v3/migrations/0003_add_user_session_purpose.sql",
      "/tmp/0003_add_user_session_purpose.sql",
    );
    await copyFixture(
      "personal-crm-schema/v4/migrations/0004_seed_iso_4217_currencies.sql",
      "/tmp/0004_seed_iso_4217_currencies.sql",
    );
    await copyFixture(
      "tools/schema/assert_schema.sql",
      "/tmp/assert_schema.sql",
    );
    await copyFixture(
      "tools/schema/assert_behavior.sql",
      "/tmp/assert_behavior.sql",
    );

    const serverVersion = await runPsql(
      SCHEMA_DATABASE,
      ["-A", "-t", "-c", "SHOW server_version;"],
      { quiet: true },
    );
    console.log(`PostgreSQL ${serverVersion}`);

    await assertRollback();
    console.log("PASS atomic apply rollback");

    await assertV1UpgradeAndFailureRollback();
    console.log(
      "PASS exact v1/v2/v3 upgrades and failed v2 migration rollback",
    );

    await applySchema(SCHEMA_DATABASE);
    console.log("PASS clean schema apply");

    const metrics = await readLiveMetrics();
    assertEqual("live tables", metrics.tables, validation.tables);
    assertEqual("live columns", metrics.columns, validation.columns);
    assertEqual(
      "live foreign keys",
      metrics.foreign_keys,
      validation.foreign_keys,
    );
    assertEqual(
      "live explicit indexes",
      metrics.explicit_indexes,
      validation.explicit_indexes,
    );
    assertEqual(
      "live JSONB fields",
      metrics.jsonb_fields,
      validation.jsonb_fields,
    );
    assertEqual(
      "live workspace_id fields",
      metrics.workspace_id_fields,
      validation.workspace_id_fields,
    );
    assertEqual(
      "live forward-reference foreign keys",
      metrics.forward_reference_foreign_keys,
      validation.deferred_foreign_keys,
    );
    assertEqual(
      "one primary key per table",
      metrics.primary_keys,
      validation.primary_keys,
    );
    assertEqual("all indexes", metrics.all_indexes, validation.all_indexes);
    assertEqual(
      "check constraints",
      metrics.check_constraints,
      validation.check_constraints,
    );
    assertEqual(
      "unique constraints",
      metrics.unique_constraints,
      validation.unique_constraints,
    );

    await runPsql(
      SCHEMA_DATABASE,
      ["-f", "/tmp/assert_schema.sql"],
      { quiet: true },
    );
    console.log("PASS catalog and field-catalog assertions");

    await runPsql(
      SCHEMA_DATABASE,
      ["-f", "/tmp/assert_behavior.sql"],
      { quiet: true },
    );
    console.log("PASS database behavior assertions");

    await runPsql(
      SCHEMA_DATABASE,
      ["-c", "DROP SCHEMA crm CASCADE"],
      { quiet: true },
    );
    const remainingTables = await runPsql(SCHEMA_DATABASE, [
      "-A",
      "-t",
      "-c",
      "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'crm';",
    ], { quiet: true });
    if (remainingTables !== "0") {
      throw new Error(`schema teardown left tables behind: ${remainingTables}`);
    }
    console.log("PASS schema teardown");

    await applySchema(SCHEMA_DATABASE);
    const reappliedMetrics = await readLiveMetrics();
    assertEqual(
      "reapplied tables",
      reappliedMetrics.tables,
      validation.tables,
    );
    assertEqual(
      "reapplied columns",
      reappliedMetrics.columns,
      validation.columns,
    );
    console.log("PASS clean reapply after teardown");

    console.log(JSON.stringify(
      {
        postgresImage,
        serverVersion,
        sourceTables: validation.source_tables,
        sourceColumns: validation.source_columns,
        ...metrics,
      },
      null,
      2,
    ));
  } catch (error) {
    if (started) {
      await runCompose(["logs", "--no-color", "postgres"], {
        allowFailure: true,
      });
    }
    throw error;
  } finally {
    await runCompose(
      ["down", "--volumes", "--remove-orphans", "--timeout", "10"],
      { allowFailure: true, quiet: true },
    );
  }
}

await main();
