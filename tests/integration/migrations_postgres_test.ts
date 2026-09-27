/**
 * The migration runner against real PostgreSQL (GAP-037): the path
 * `deno task migration:apply` takes, driven through its exported entry so the
 * refusals and the v1-v7 upgrades are observed on a live catalog rather than on
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

const priorBaselines = [
  ["v1", artifacts.v1Sql],
  ["v2", artifacts.v2Sql],
  ["v3", artifacts.v3Sql],
  ["v4", artifacts.v4Sql],
  ["v5", artifacts.v5Sql],
  ["v6", artifacts.v6Sql],
  ["v7", artifacts.v7Sql],
] as const;

for (const [version, baselineSql] of priorBaselines) {
  Deno.test(`[GAP-044] the migration runner upgrades an exact ${version} database to the v8 catalog`, async () => {
    await withScratchDatabase(async ({ sql, url }) => {
      await sql.unsafe(baselineSql);
      const userId = crypto.randomUUID();
      await sql`
        insert into crm.users (id, email)
        values (${userId}, ${`${version}-runner@example.test`})
      `;

      assert(
        await runMigration(environment(url)) === `upgrade-${version}-to-v8`,
        `an exact ${version} database was not classified for the upgrade`,
      );

      const upgraded = await crmTables(sql);
      const expected = canonicalTableNames(artifacts.v8Sql);
      assert(
        JSON.stringify(upgraded) === JSON.stringify(expected) &&
          upgraded.length === 89,
        `the upgraded catalog is not v8: ${
          expected.filter((name) => !upgraded.includes(name)).join(", ")
        }`,
      );
      const [preserved] = await sql<{ readonly email: string }[]>`
        select email::text from crm.users where id = ${userId}
      `;
      assert(
        preserved?.email === `${version}-runner@example.test`,
        `the upgrade lost a ${version} row`,
      );
      // The runner verified the structure against a freshly built v8 catalog
      // before it committed; a second run finds exactly that catalog.
      assert(
        await runMigration(environment(url)) === "verify-v8",
        `an upgraded ${version} database is not recognised as exact v8`,
      );
    });
  });
}

Deno.test("[GAP-044] the v7-to-v8 upgrade keeps every member on in-app delivery with no digest", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v7Sql);
    const [userId, workspaceId, memberId] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    await sql`insert into crm.users (id, email) values (${userId}, 'v7-member@example.test')`;
    await sql`
      insert into crm.workspaces (id, name, created_by_user_id)
      values (${workspaceId}, 'V7 upgrade', ${userId})
    `;
    await sql`
      insert into crm.workspace_members (id, workspace_id, user_id, role, status)
      values (${memberId}, ${workspaceId}, ${userId}, 'owner', 'active')
    `;
    await sql`
      insert into crm.member_preferences (member_id, timezone)
      values (${memberId}, 'Europe/Belgrade')
    `;

    assert(
      await runMigration(environment(url)) === "upgrade-v7-to-v8",
      "an exact v7 database was not classified for the v7-to-v8 upgrade",
    );
    const [preference] = await sql<{
      readonly digest_time: string | null;
      readonly reminder_delivery: string;
      readonly timezone: string;
    }[]>`
      select reminder_delivery, digest_time::text, timezone
      from crm.member_preferences where member_id = ${memberId}
    `;
    assert(
      preference?.reminder_delivery === "in_app" &&
        preference.digest_time === null &&
        preference.timezone === "Europe/Belgrade",
      `the upgrade changed a member's delivery: ${JSON.stringify(preference)}`,
    );
    const refused = await refusal(() =>
      sql`
        update crm.member_preferences set reminder_delivery = 'sms'
        where member_id = ${memberId}
      `
    );
    assert(
      refused.includes("member_preferences_reminder_delivery_ck"),
      `an unknown delivery channel was stored: ${refused}`,
    );
  });
});

Deno.test("[GAP-037] the migration runner refuses a drifted catalog and leaves it untouched", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v8Sql);
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
    await sql.unsafe(artifacts.v7Sql);
    const message = await refusal(() =>
      applyCanonicalSchema(url, {
        ...artifacts,
        migrationV7ToV8: `${artifacts.migrationV7ToV8}\n-- drifted`,
      })
    );
    assert(
      message.startsWith("Schema v7-to-v8 migration checksum mismatch"),
      `a changed migration was not refused by checksum: ${message}`,
    );
    const [column] = await sql<{ readonly present: boolean }[]>`
      select exists (select 1 from information_schema.columns
        where table_schema = 'crm' and table_name = 'member_preferences'
          and column_name = 'reminder_delivery') as present
    `;
    assert(
      column?.present === false,
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
