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
const V4_UPGRADE_DATABASE = "crm_v4_upgrade_test";
const V5_UPGRADE_DATABASE = "crm_v5_upgrade_test";
const V6_UPGRADE_DATABASE = "crm_v6_upgrade_test";
const V7_UPGRADE_DATABASE = "crm_v7_upgrade_test";
const V8_UPGRADE_DATABASE = "crm_v8_upgrade_test";
const MIGRATION_ROLLBACK_DATABASE = "crm_migration_rollback_test";
const DATABASE_USER = "crm_test";

const scriptDirectory = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
);
const repositoryRoot = resolve(scriptDirectory, "../..");
const schemaDirectory = resolve(repositoryRoot, "personal-crm-schema/v9");
const validationPath = resolve(
  schemaDirectory,
  "personal_crm_schema_v9_validation.json",
);

/**
 * Every immutable prior baseline and the validation file that records its
 * exact hashes. Repository v1 keeps the audited bundle's v3-named file.
 */
const IMMUTABLE_BASELINES = [
  ["v1", "personal_crm_schema_v3_validation.json"],
  ["v2", "personal_crm_schema_v2_validation.json"],
  ["v3", "personal_crm_schema_v3_validation.json"],
  ["v4", "personal_crm_schema_v4_validation.json"],
  ["v5", "personal_crm_schema_v5_validation.json"],
  ["v6", "personal_crm_schema_v6_validation.json"],
  ["v7", "personal_crm_schema_v7_validation.json"],
  ["v8", "personal_crm_schema_v8_validation.json"],
] as const;

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
    throw new Error(`Schema v9 validation status is ${validation.status}`);
  }

  for (const [filename, expectedHash] of Object.entries(validation.sha256)) {
    const actualHash = await sha256(resolve(schemaDirectory, filename));
    if (actualHash !== expectedHash) {
      throw new Error(
        `Schema v9 artifact hash mismatch for ${filename}: ${actualHash}`,
      );
    }
  }

  const ddl = await Deno.readTextFile(
    resolve(schemaDirectory, "personal_crm_schema_v9.sql"),
  );
  const migration = await Deno.readTextFile(
    resolve(
      schemaDirectory,
      "migrations/0006_add_durable_reminder_delivery.sql",
    ),
  );
  const v7Migration = await Deno.readTextFile(
    resolve(
      schemaDirectory,
      "migrations/0007_add_workspace_deletion_records.sql",
    ),
  );
  const v8Migration = await Deno.readTextFile(
    resolve(
      schemaDirectory,
      "migrations/0008_add_member_reminder_delivery.sql",
    ),
  );
  const v9Migration = await Deno.readTextFile(
    resolve(
      schemaDirectory,
      "migrations/0009_add_search_indexes_and_duplicate_dismissals.sql",
    ),
  );
  const tableColumns = (table: string): readonly string[] => {
    const body = ddl.match(
      new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`),
    )?.[1] ?? "";
    return body.split("\n").map((line) => line.trim()).filter((line) =>
      /^[a-z][a-z0-9_]*\s/.test(line) &&
      !line.startsWith("constraint ") && !line.startsWith("check ") &&
      !line.startsWith("unique ")
    ).map((line) => line.split(/\s+/, 1)[0]!);
  };
  const expectedOccurrenceColumns = [
    "id",
    "reminder_id",
    "member_id",
    "occurs_on",
    "deliver_at",
    "lead_time_days",
    "channel",
    "status",
    "sent_at",
    "title_snapshot",
    "body_snapshot",
    "error",
    "created_at",
    "updated_at",
    "claim_token",
    "claim_owner",
    "lease_expires_at",
    "attempt_count",
    "last_attempt_at",
    "next_attempt_at",
    "provider_idempotency_key",
    "provider_receipt",
    "provider_result_state",
    "provider_effect_at",
    "visible_at",
  ];
  const occurrenceColumns = tableColumns("reminder_occurrences");
  const cadenceColumns = tableColumns("stay_in_touch_cadences");
  const deletionColumns = tableColumns("workspace_lifecycle_records");
  const preferenceColumns = tableColumns("member_preferences");
  const dismissalColumns = tableColumns("person_duplicate_dismissals");
  const contractErrors: string[] = [];
  if (occurrenceColumns.join(",") !== expectedOccurrenceColumns.join(",")) {
    contractErrors.push(
      `reminder_occurrences additive order mismatch: ${
        occurrenceColumns.join(",")
      }`,
    );
  }
  if (
    cadenceColumns.slice(-2).join(",") !==
      "last_request_id,last_request_fingerprint"
  ) {
    contractErrors.push("cadence durable request metadata is missing");
  }
  if (
    !migration.includes("provider_effect_at") ||
    !migration.includes("visible_at")
  ) {
    contractErrors.push("durable in_app effect migration is missing");
  }
  if (
    !migration.includes("channel <> 'in_app'") &&
    !migration.includes("channel != 'in_app'")
  ) {
    contractErrors.push("unsupported legacy channel migration is missing");
  }
  if (!migration.includes("last_request_fingerprint")) {
    contractErrors.push("cadence replay migration is missing");
  }
  if (
    deletionColumns.join(",") !==
      "id,workspace_id,actor_user_id,action,outcome,impact_counts,object_keys,cleanup_status,occurred_at,cleanup_completed_at,created_at"
  ) {
    contractErrors.push("workspace deletion security record shape is missing");
  }
  if (
    !v7Migration.includes("workspace_lifecycle_records") ||
    v7Migration.includes("REFERENCES crm.workspaces") ||
    v7Migration.includes("REFERENCES workspaces")
  ) {
    contractErrors.push(
      "surviving deletion record migration is missing or cascades",
    );
  }
  if (
    preferenceColumns.slice(-2).join(",") !== "reminder_delivery,digest_time"
  ) {
    contractErrors.push("member reminder-delivery preferences are missing");
  }
  if (
    !v8Migration.includes("ADD COLUMN reminder_delivery") ||
    !v8Migration.includes("ADD COLUMN digest_time") ||
    !v8Migration.includes("member_preferences_reminder_delivery_ck")
  ) {
    contractErrors.push("member reminder-delivery migration is missing");
  }
  if (
    dismissalColumns.join(",") !==
      "workspace_id,person_low_id,person_high_id,dismissed_by_member_id,created_at"
  ) {
    contractErrors.push("duplicate dismissal shape is missing");
  }
  for (
    const name of [
      "people_workspace_id_id_key",
      "person_duplicate_dismissals_order_ck",
      "person_duplicate_dismissals_low_person_fk",
      "person_duplicate_dismissals_high_person_fk",
      "person_duplicate_dismissals_high_idx",
      "notes_search_idx",
      "activities_search_idx",
      "journal_posts_search_idx",
      "tasks_search_idx",
    ]
  ) {
    if (!ddl.includes(name) || !v9Migration.includes(name)) {
      contractErrors.push(`${name} is missing from the DDL or migration`);
    }
  }
  if (contractErrors.length > 0) {
    throw new Error(
      `Schema v9 synchronized contract: ${contractErrors.join("; ")}`,
    );
  }
}

async function verifyImmutableArtifacts(): Promise<void> {
  for (const [version, validationFile] of IMMUTABLE_BASELINES) {
    const directory = resolve(repositoryRoot, `personal-crm-schema/${version}`);
    const parsed = JSON.parse(
      await Deno.readTextFile(resolve(directory, validationFile)),
    ) as { readonly sha256?: Readonly<Record<string, string>> };
    if (!parsed.sha256) {
      throw new Error(`Invalid immutable ${version} validation JSON.`);
    }
    for (const [filename, expectedHash] of Object.entries(parsed.sha256)) {
      const actualHash = await sha256(resolve(directory, filename));
      if (actualHash !== expectedHash) {
        throw new Error(
          `Immutable schema ${version} artifact drifted: ${filename}.`,
        );
      }
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
    throw new Error("Invalid schema v9 validation JSON");
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
    await countCsvRows(resolve(schemaDirectory, "monica_table_mapping_v9.csv")),
    validation.table_mapping_rows,
  );
  assertEqual(
    "column mapping rows",
    await countCsvRows(
      resolve(schemaDirectory, "monica_column_mapping_v9.csv"),
    ),
    validation.column_mapping_rows,
  );
  assertEqual(
    "field catalog rows",
    await countCsvRows(
      resolve(schemaDirectory, "personal_crm_field_catalog_v9.csv"),
    ),
    validation.field_catalog_rows,
  );
}

async function applySchema(database: string): Promise<void> {
  await runPsql(database, [
    "--single-transaction",
    "-f",
    "/tmp/personal_crm_schema_v9.sql",
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
      "/tmp/personal_crm_schema_v9.sql",
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
      V4_UPGRADE_DATABASE,
      V5_UPGRADE_DATABASE,
      V6_UPGRADE_DATABASE,
      V7_UPGRADE_DATABASE,
      V8_UPGRADE_DATABASE,
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
      "-f",
      "/tmp/0005_add_person_date_year_approximation.sql",
      "-f",
      "/tmp/0006_add_durable_reminder_delivery.sql",
      "-f",
      "/tmp/0007_add_workspace_deletion_records.sql",
      "-f",
      "/tmp/0008_add_member_reminder_delivery.sql",
      "-f",
      "/tmp/0009_add_search_indexes_and_duplicate_dismissals.sql",
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
        AND EXISTS(SELECT 1 FROM information_schema.columns
          WHERE table_schema='crm' AND table_name='person_dates'
            AND column_name='is_year_approximate')
        AND (SELECT count(*) = 1 FROM crm.api_request_logs
          WHERE path='/upgrade-preserved');`,
    ], { quiet: true });
    if (upgraded !== "t") {
      throw new Error("v1-to-v9 migration did not preserve the exact fixture.");
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
      "-f",
      "/tmp/0005_add_person_date_year_approximation.sql",
      "-f",
      "/tmp/0006_add_durable_reminder_delivery.sql",
      "-f",
      "/tmp/0007_add_workspace_deletion_records.sql",
      "-f",
      "/tmp/0008_add_member_reminder_delivery.sql",
      "-f",
      "/tmp/0009_add_search_indexes_and_duplicate_dismissals.sql",
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
      throw new Error("v2-to-v9 migration did not revoke ambiguous authority.");
    }

    await runPsql(V3_UPGRADE_DATABASE, [
      "--single-transaction",
      "-f",
      "/tmp/personal_crm_schema_v3.sql",
      "-f",
      "/tmp/0004_seed_iso_4217_currencies.sql",
      "-f",
      "/tmp/0005_add_person_date_year_approximation.sql",
      "-f",
      "/tmp/0006_add_durable_reminder_delivery.sql",
      "-f",
      "/tmp/0007_add_workspace_deletion_records.sql",
      "-f",
      "/tmp/0008_add_member_reminder_delivery.sql",
      "-f",
      "/tmp/0009_add_search_indexes_and_duplicate_dismissals.sql",
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
      throw new Error("v3-to-v9 migration did not seed the exact catalog.");
    }

    await runPsql(V4_UPGRADE_DATABASE, [
      "--single-transaction",
      "-f",
      "/tmp/personal_crm_schema_v4.sql",
      "-f",
      "/tmp/0005_add_person_date_year_approximation.sql",
      "-f",
      "/tmp/0006_add_durable_reminder_delivery.sql",
      "-f",
      "/tmp/0007_add_workspace_deletion_records.sql",
      "-f",
      "/tmp/0008_add_member_reminder_delivery.sql",
      "-f",
      "/tmp/0009_add_search_indexes_and_duplicate_dismissals.sql",
    ], { quiet: true });
    const v4Upgraded = await runPsql(V4_UPGRADE_DATABASE, [
      "-A",
      "-t",
      "-c",
      `SELECT EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='crm' AND table_name='person_dates'
          AND column_name='is_year_approximate' AND is_nullable='NO')
       AND EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='crm' AND table_name='reminder_occurrences'
          AND column_name='lease_expires_at')
       AND (SELECT count(*) = 165 FROM crm.currencies);`,
    ], { quiet: true });
    if (v4Upgraded !== "t") {
      throw new Error("v4-to-v9 migration did not preserve the exact fixture.");
    }

    await runPsql(V5_UPGRADE_DATABASE, [
      "--single-transaction",
      "-f",
      "/tmp/personal_crm_schema_v5.sql",
      "-c",
      `INSERT INTO crm.users (id, email) VALUES
         ('00000000-0000-4000-8000-000000000501', 'v6-upgrade@example.test');
       INSERT INTO crm.workspaces (id, name, created_by_user_id) VALUES
         ('00000000-0000-4000-8000-000000000502', 'V6 upgrade', '00000000-0000-4000-8000-000000000501');
       INSERT INTO crm.workspace_members (id, workspace_id, user_id, role, status) VALUES
         ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000501', 'owner', 'active');
       INSERT INTO crm.people (id, workspace_id, created_by_member_id, given_name) VALUES
         ('00000000-0000-4000-8000-000000000504', '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000503', 'Legacy');
       INSERT INTO crm.reminders (id, workspace_id, person_id, target_kind, title, anchor_on, send_time, created_by_member_id) VALUES
         ('00000000-0000-4000-8000-000000000505', '00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000504', 'person', 'Legacy reminder', '2026-08-18', '09:00', '00000000-0000-4000-8000-000000000503');
       INSERT INTO crm.reminder_occurrences
         (id, reminder_id, member_id, occurs_on, deliver_at, lead_time_days, channel, status, sent_at)
       VALUES
         ('00000000-0000-4000-8000-000000000506', '00000000-0000-4000-8000-000000000505', '00000000-0000-4000-8000-000000000503', '2026-08-18', '2026-08-18T09:00:00Z', null, 'email', 'pending', null),
         ('00000000-0000-4000-8000-000000000507', '00000000-0000-4000-8000-000000000505', '00000000-0000-4000-8000-000000000503', '2026-08-19', '2026-08-19T09:00:00Z', null, 'email', 'sent', '2026-08-19T09:01:00Z'),
         ('00000000-0000-4000-8000-000000000508', '00000000-0000-4000-8000-000000000505', '00000000-0000-4000-8000-000000000503', '2026-09-18', '2026-09-18T09:00:00Z', 0, 'in_app', 'pending', null),
         ('00000000-0000-4000-8000-000000000509', '00000000-0000-4000-8000-000000000505', '00000000-0000-4000-8000-000000000503', '2026-09-18', '2026-09-11T09:00:00Z', 7, 'in_app', 'pending', null);`,
      "-f",
      "/tmp/0006_add_durable_reminder_delivery.sql",
      "-f",
      "/tmp/0007_add_workspace_deletion_records.sql",
      "-f",
      "/tmp/0008_add_member_reminder_delivery.sql",
      "-f",
      "/tmp/0009_add_search_indexes_and_duplicate_dismissals.sql",
    ], { quiet: true });
    const v5Upgraded = await runPsql(V5_UPGRADE_DATABASE, [
      "-A",
      "-t",
      "-c",
      `SELECT EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='crm' AND table_name='reminder_occurrences'
          AND column_name='provider_idempotency_key' AND is_nullable='NO')
       AND EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='crm'
          AND indexname='reminder_occurrences_lease_idx')
       AND EXISTS(SELECT 1 FROM information_schema.tables
          WHERE table_schema='crm' AND table_name='workspace_lifecycle_records')
       AND (SELECT status = 'manual_attention' AND provider_result_state = 'rejected'
              AND provider_receipt IS NULL AND visible_at IS NULL
            FROM crm.reminder_occurrences
            WHERE id = '00000000-0000-4000-8000-000000000506')
       AND (SELECT status = 'sent' AND provider_result_state = 'confirmed'
              AND provider_receipt IS NOT NULL AND provider_effect_at IS NOT NULL
              AND visible_at IS NOT NULL
            FROM crm.reminder_occurrences
            WHERE id = '00000000-0000-4000-8000-000000000507')
       AND (SELECT array_agg(lead_time_days ORDER BY lead_time_days) = ARRAY[0, 7]
            FROM crm.reminder_occurrences
            WHERE reminder_id = '00000000-0000-4000-8000-000000000505'
              AND occurs_on = '2026-09-18' AND channel = 'in_app')
       AND (SELECT array_agg(attname ORDER BY attnum)::text =
          '{id,reminder_id,member_id,occurs_on,deliver_at,lead_time_days,channel,status,sent_at,title_snapshot,body_snapshot,error,created_at,updated_at,claim_token,claim_owner,lease_expires_at,attempt_count,last_attempt_at,next_attempt_at,provider_idempotency_key,provider_receipt,provider_result_state,provider_effect_at,visible_at}'
          FROM pg_attribute WHERE attrelid = 'crm.reminder_occurrences'::regclass
            AND attnum > 0 AND NOT attisdropped);`,
    ], { quiet: true });
    if (v5Upgraded !== "t") {
      throw new Error(
        "v5-to-v9 migration did not install durable delivery state.",
      );
    }

    await runPsql(V6_UPGRADE_DATABASE, [
      "--single-transaction",
      "-f",
      "/tmp/personal_crm_schema_v6.sql",
      "-c",
      `INSERT INTO crm.users (id, email) VALUES
         ('00000000-0000-4000-8000-000000000601', 'v7-upgrade@example.test');`,
      "-f",
      "/tmp/0007_add_workspace_deletion_records.sql",
      "-f",
      "/tmp/0008_add_member_reminder_delivery.sql",
      "-f",
      "/tmp/0009_add_search_indexes_and_duplicate_dismissals.sql",
    ], { quiet: true });
    const v6Upgraded = await runPsql(V6_UPGRADE_DATABASE, [
      "-A",
      "-t",
      "-c",
      `SELECT EXISTS(SELECT 1 FROM information_schema.tables
          WHERE table_schema='crm' AND table_name='workspace_lifecycle_records')
       AND EXISTS(SELECT 1 FROM information_schema.columns
          WHERE table_schema='crm' AND table_name='workspace_lifecycle_records'
            AND column_name='occurred_at' AND is_nullable='NO')
       AND EXISTS(SELECT 1 FROM crm.users
          WHERE id='00000000-0000-4000-8000-000000000601');`,
    ], { quiet: true });
    if (v6Upgraded !== "t") {
      throw new Error("v6-to-v9 migration did not preserve the exact fixture.");
    }

    await runPsql(V7_UPGRADE_DATABASE, [
      "--single-transaction",
      "-f",
      "/tmp/personal_crm_schema_v7.sql",
      "-c",
      `INSERT INTO crm.users (id, email) VALUES
         ('00000000-0000-4000-8000-000000000701', 'v8-upgrade@example.test');
       INSERT INTO crm.workspaces (id, name, created_by_user_id) VALUES
         ('00000000-0000-4000-8000-000000000702', 'V8 upgrade', '00000000-0000-4000-8000-000000000701');
       INSERT INTO crm.workspace_members (id, workspace_id, user_id, role, status) VALUES
         ('00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000701', 'owner', 'active');
       INSERT INTO crm.member_preferences (member_id, timezone) VALUES
         ('00000000-0000-4000-8000-000000000703', 'Europe/Belgrade');`,
      "-f",
      "/tmp/0008_add_member_reminder_delivery.sql",
      "-f",
      "/tmp/0009_add_search_indexes_and_duplicate_dismissals.sql",
    ], { quiet: true });
    const v7Upgraded = await runPsql(V7_UPGRADE_DATABASE, [
      "-A",
      "-t",
      "-c",
      `SELECT (SELECT reminder_delivery = 'in_app' AND digest_time IS NULL
            AND timezone = 'Europe/Belgrade'
          FROM crm.member_preferences
          WHERE member_id = '00000000-0000-4000-8000-000000000703')
       AND (SELECT array_agg(attname ORDER BY attnum)::text =
          '{member_id,timezone,locale,temperature_scale,measurement_system,currency_code,contact_sort_order,contact_name_order,fluid_layout,ui_state,updated_at,reminder_delivery,digest_time}'
          FROM pg_attribute WHERE attrelid = 'crm.member_preferences'::regclass
            AND attnum > 0 AND NOT attisdropped)
       AND EXISTS(SELECT 1 FROM pg_constraint
          WHERE conname = 'member_preferences_reminder_delivery_ck');`,
    ], { quiet: true });
    if (v7Upgraded !== "t") {
      throw new Error("v7-to-v9 migration did not preserve the exact fixture.");
    }

    await runPsql(V8_UPGRADE_DATABASE, [
      "--single-transaction",
      "-f",
      "/tmp/personal_crm_schema_v8.sql",
      "-c",
      `INSERT INTO crm.users (id, email) VALUES
         ('00000000-0000-4000-8000-000000000801', 'v9-upgrade@example.test');
       INSERT INTO crm.workspaces (id, name, created_by_user_id) VALUES
         ('00000000-0000-4000-8000-000000000802', 'V9 upgrade', '00000000-0000-4000-8000-000000000801');
       INSERT INTO crm.people (id, workspace_id, given_name) VALUES
         ('00000000-0000-4000-8000-000000000803', '00000000-0000-4000-8000-000000000802', 'Ada');
       INSERT INTO crm.notes (workspace_id, person_id, body) VALUES
         ('00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000803', 'Kept through the v9 upgrade');`,
      "-f",
      "/tmp/0009_add_search_indexes_and_duplicate_dismissals.sql",
    ], { quiet: true });
    const v8Upgraded = await runPsql(V8_UPGRADE_DATABASE, [
      "-A",
      "-t",
      "-c",
      `SELECT (SELECT count(*) = 1 FROM crm.notes
          WHERE to_tsvector('simple', body) @@ to_tsquery('simple', 'upgrade'))
       AND (SELECT count(*) = 4 FROM pg_catalog.pg_indexes
          WHERE schemaname = 'crm' AND indexname IN ('notes_search_idx',
            'activities_search_idx', 'journal_posts_search_idx',
            'tasks_search_idx') AND indexdef LIKE '%USING gin%')
       AND to_regclass('crm.person_duplicate_dismissals') IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM crm.person_duplicate_dismissals)
       AND EXISTS(SELECT 1 FROM pg_constraint
          WHERE conname = 'people_workspace_id_id_key');`,
    ], { quiet: true });
    if (v8Upgraded !== "t") {
      throw new Error("v8-to-v9 migration did not preserve the exact fixture.");
    }

    await runPsql(MIGRATION_ROLLBACK_DATABASE, [
      "--single-transaction",
      "-f",
      "/tmp/personal_crm_schema_v5.sql",
    ], { quiet: true });
    await runPsql(MIGRATION_ROLLBACK_DATABASE, [
      "-c",
      "BEGIN",
      "-f",
      "/tmp/0006_add_durable_reminder_delivery.sql",
      "-c",
      "SELECT 1 / 0",
    ], { allowFailure: true, quiet: true });
    const rolledBack = await runPsql(MIGRATION_ROLLBACK_DATABASE, [
      "-A",
      "-t",
      "-c",
      `SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='crm' AND table_name='reminder_occurrences'
          AND column_name='provider_idempotency_key');`,
    ], { quiet: true });
    if (rolledBack !== "t") {
      throw new Error(
        "failed v5-to-v6 migration did not roll back atomically.",
      );
    }
    await runPsql(MIGRATION_ROLLBACK_DATABASE, [
      "--single-transaction",
      "-f",
      "/tmp/0006_add_durable_reminder_delivery.sql",
    ], { quiet: true });
    await runPsql(MIGRATION_ROLLBACK_DATABASE, [
      "-c",
      "BEGIN",
      "-f",
      "/tmp/0007_add_workspace_deletion_records.sql",
      "-c",
      "SELECT 1 / 0",
    ], { allowFailure: true, quiet: true });
    const v7RolledBack = await runPsql(MIGRATION_ROLLBACK_DATABASE, [
      "-A",
      "-t",
      "-c",
      `SELECT NOT EXISTS(SELECT 1 FROM information_schema.tables
        WHERE table_schema='crm' AND table_name='workspace_lifecycle_records');`,
    ], { quiet: true });
    if (v7RolledBack !== "t") {
      throw new Error(
        "failed v6-to-v7 migration did not roll back atomically.",
      );
    }
    await runPsql(MIGRATION_ROLLBACK_DATABASE, [
      "--single-transaction",
      "-f",
      "/tmp/0007_add_workspace_deletion_records.sql",
    ], { quiet: true });
    await runPsql(MIGRATION_ROLLBACK_DATABASE, [
      "-c",
      "BEGIN",
      "-f",
      "/tmp/0008_add_member_reminder_delivery.sql",
      "-c",
      "SELECT 1 / 0",
    ], { allowFailure: true, quiet: true });
    const v8RolledBack = await runPsql(MIGRATION_ROLLBACK_DATABASE, [
      "-A",
      "-t",
      "-c",
      `SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='crm' AND table_name='member_preferences'
          AND column_name IN ('reminder_delivery', 'digest_time'));`,
    ], { quiet: true });
    if (v8RolledBack !== "t") {
      throw new Error(
        "failed v7-to-v8 migration did not roll back atomically.",
      );
    }
    await runPsql(MIGRATION_ROLLBACK_DATABASE, [
      "--single-transaction",
      "-f",
      "/tmp/0008_add_member_reminder_delivery.sql",
    ], { quiet: true });
    await runPsql(MIGRATION_ROLLBACK_DATABASE, [
      "-c",
      "BEGIN",
      "-f",
      "/tmp/0009_add_search_indexes_and_duplicate_dismissals.sql",
      "-c",
      "SELECT 1 / 0",
    ], { allowFailure: true, quiet: true });
    const v9RolledBack = await runPsql(MIGRATION_ROLLBACK_DATABASE, [
      "-A",
      "-t",
      "-c",
      `SELECT to_regclass('crm.person_duplicate_dismissals') IS NULL
        AND to_regclass('crm.notes_search_idx') IS NULL
        AND NOT EXISTS(SELECT 1 FROM pg_constraint
          WHERE conname = 'people_workspace_id_id_key');`,
    ], { quiet: true });
    if (v9RolledBack !== "t") {
      throw new Error(
        "failed v8-to-v9 migration did not roll back atomically.",
      );
    }
  } finally {
    for (
      const database of [
        UPGRADE_DATABASE,
        V2_UPGRADE_DATABASE,
        V3_UPGRADE_DATABASE,
        V4_UPGRADE_DATABASE,
        V5_UPGRADE_DATABASE,
        V6_UPGRADE_DATABASE,
        V7_UPGRADE_DATABASE,
        V8_UPGRADE_DATABASE,
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
  await verifyImmutableArtifacts();
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
      "personal-crm-schema/v9/personal_crm_schema_v9.sql",
      "/tmp/personal_crm_schema_v9.sql",
    );
    await copyFixture(
      "personal-crm-schema/v8/personal_crm_schema_v8.sql",
      "/tmp/personal_crm_schema_v8.sql",
    );
    await copyFixture(
      "personal-crm-schema/v7/personal_crm_schema_v7.sql",
      "/tmp/personal_crm_schema_v7.sql",
    );
    await copyFixture(
      "personal-crm-schema/v5/personal_crm_schema_v5.sql",
      "/tmp/personal_crm_schema_v5.sql",
    );
    await copyFixture(
      "personal-crm-schema/v6/personal_crm_schema_v6.sql",
      "/tmp/personal_crm_schema_v6.sql",
    );
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
      "personal-crm-schema/v9/personal_crm_field_catalog_v9.csv",
      "/tmp/personal_crm_field_catalog_v9.csv",
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
      "personal-crm-schema/v5/migrations/0005_add_person_date_year_approximation.sql",
      "/tmp/0005_add_person_date_year_approximation.sql",
    );
    await copyFixture(
      "personal-crm-schema/v6/migrations/0006_add_durable_reminder_delivery.sql",
      "/tmp/0006_add_durable_reminder_delivery.sql",
    );
    await copyFixture(
      "personal-crm-schema/v7/migrations/0007_add_workspace_deletion_records.sql",
      "/tmp/0007_add_workspace_deletion_records.sql",
    );
    await copyFixture(
      "personal-crm-schema/v8/migrations/0008_add_member_reminder_delivery.sql",
      "/tmp/0008_add_member_reminder_delivery.sql",
    );
    await copyFixture(
      "personal-crm-schema/v9/migrations/0009_add_search_indexes_and_duplicate_dismissals.sql",
      "/tmp/0009_add_search_indexes_and_duplicate_dismissals.sql",
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
      "PASS exact v1/v2/v3/v4/v5/v6/v7/v8 upgrades and failed migration rollback",
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
