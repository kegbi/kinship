/**
 * The migration runner against real PostgreSQL (GAP-037): the path
 * `deno task migration:apply` takes, driven through its exported entry so the
 * refusals and the v6 upgrade are observed on a live catalog rather than on
 * the classification alone (`tools/migrations/baseline_test.ts`).
 *
 * Each case owns a scratch database on the disposable server, so the shared
 * `kinship` database the other suites read is never touched.
 */

import {
  applyCanonicalSchema,
  canonicalTableNames,
} from "../../tools/migrations/baseline.ts";
import {
  readCanonicalArtifacts,
  runMigration,
} from "../../tools/migrations/main.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import { openSql, requireDatabaseUrl, type Sql } from "../support/database.ts";

const databaseUrl = requireDatabaseUrl();
const artifacts = await readCanonicalArtifacts();

/** Runs `work` against a fresh, empty database that is dropped afterwards. */
async function withScratchDatabase(
  work: (scratch: { readonly sql: Sql; readonly url: string }) => Promise<void>,
): Promise<void> {
  const name = `kinship_migration_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = openSql(databaseUrl, { max: 1 });
  try {
    await admin.unsafe(`create database ${name}`);
    const url = new URL(databaseUrl);
    url.pathname = `/${name}`;
    const sql = openSql(url.toString(), { max: 1, prepare: false });
    try {
      await work({ sql, url: url.toString() });
    } finally {
      await sql.end();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
    }
  } finally {
    await admin.end();
  }
}

function environment(url: string) {
  return { get: (name: string) => name === "DATABASE_URL" ? url : undefined };
}

async function refusal(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "<accepted>";
}

async function crmTables(sql: Sql): Promise<readonly string[]> {
  const rows = await sql<{ readonly name: string }[]>`
    select table_name::text as name from information_schema.tables
    where table_schema = 'crm' and table_type = 'BASE TABLE'
    order by table_name
  `;
  return rows.map((row) => row.name);
}

Deno.test("[GAP-037] the migration runner upgrades an exact v6 database to the v7 catalog", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v6Sql);
    const userId = crypto.randomUUID();
    await sql`
      insert into crm.users (id, email, first_name, status)
      values (${userId}, 'v6-runner@example.test', 'Upgrade', 'active')
    `;
    const v6Tables = await crmTables(sql);
    assert(
      !v6Tables.includes("workspace_lifecycle_records"),
      "the v6 fixture already carried a v7 table",
    );

    assert(
      await runMigration(environment(url)) === "upgrade-v6-to-v7",
      "an exact v6 database was not classified for the v6-to-v7 upgrade",
    );

    const upgraded = await crmTables(sql);
    const expected = canonicalTableNames(artifacts.v7Sql);
    assert(
      JSON.stringify(upgraded) === JSON.stringify(expected) &&
        upgraded.length === 89,
      `the upgraded catalog is not v7: ${
        expected.filter((name) => !upgraded.includes(name)).join(", ")
      }`,
    );
    const [preserved] = await sql<{ readonly email: string }[]>`
      select email::text from crm.users where id = ${userId}
    `;
    assert(
      preserved?.email === "v6-runner@example.test",
      "the upgrade lost a v6 row",
    );
    // The runner verified the structure against a freshly built v7 catalog
    // before it committed; a second run finds exactly that catalog.
    assert(
      await runMigration(environment(url)) === "verify-v7",
      "an upgraded database is not recognised as exact v7",
    );
  });
});

Deno.test("[GAP-037] the migration runner refuses a drifted catalog and leaves it untouched", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v7Sql);
    await sql`alter table crm.users add column drifted_note text`;

    const message = await refusal(() => runMigration(environment(url)));
    assert(
      message === "Refusing ambiguous or drifted database state.",
      `a drifted catalog was not refused: ${message}`,
    );
    const [column] = await sql<{ readonly present: boolean }[]>`
      select exists (select 1 from information_schema.columns
        where table_schema = 'crm' and table_name = 'users'
          and column_name = 'drifted_note') as present
    `;
    assert(column?.present === true, "the refusal rewrote the drifted catalog");
  });
});

Deno.test("[GAP-037] the migration runner refuses a crm schema that matches no baseline", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    await sql`create schema crm`;
    await sql`create table crm.users (id uuid primary key)`;

    const message = await refusal(() => runMigration(environment(url)));
    assert(
      message === "Refusing ambiguous or drifted database state.",
      `an ambiguous crm schema was not refused: ${message}`,
    );
    assert(
      JSON.stringify(await crmTables(sql)) === JSON.stringify(["users"]),
      "the refusal applied schema changes to an ambiguous database",
    );
  });
});

Deno.test("[GAP-037] the migration runner refuses a changed immutable artifact before connecting", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v6Sql);
    const message = await refusal(() =>
      applyCanonicalSchema(url, {
        ...artifacts,
        migrationV6ToV7: `${artifacts.migrationV6ToV7}\n-- drifted`,
      })
    );
    assert(
      message.startsWith("Schema v6-to-v7 migration checksum mismatch"),
      `a changed migration was not refused by checksum: ${message}`,
    );
    assert(
      !(await crmTables(sql)).includes("workspace_lifecycle_records"),
      "a refused migration still changed the database",
    );
  });
});

Deno.test("[GAP-037] the migration runner requires a database configuration", async () => {
  const message = await refusal(() => runMigration({ get: () => undefined }));
  assert(
    message === "DATABASE_URL or complete PG connection fields are required",
    `an unconfigured runner was not refused: ${message}`,
  );
});
