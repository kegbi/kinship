/**
 * The migration runner against real PostgreSQL (GAP-037): the path
 * `deno task migration:apply` takes, driven through its exported entry so the
 * refusals and the v1-v9 upgrades are observed on a live catalog rather than on
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
  ["v8", artifacts.v8Sql],
  ["v9", artifacts.v9Sql],
  ["v10", artifacts.v10Sql],
] as const;

for (const [version, baselineSql] of priorBaselines) {
  Deno.test(`[REL-061] the migration runner upgrades an exact ${version} database to the v11 catalog`, async () => {
    await withScratchDatabase(async ({ sql, url }) => {
      await sql.unsafe(baselineSql);
      const userId = crypto.randomUUID();
      await sql`
        insert into crm.users (id, email)
        values (${userId}, ${`${version}-runner@example.test`})
      `;

      assert(
        await runMigration(environment(url)) === `upgrade-${version}-to-v11`,
        `an exact ${version} database was not classified for the upgrade`,
      );

      const upgraded = await crmTables(sql);
      const expected = canonicalTableNames(artifacts.v11Sql);
      assert(
        JSON.stringify(upgraded) === JSON.stringify(expected) &&
          upgraded.length === 92,
        `the upgraded catalog is not v11: ${
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
      // The runner verified the structure against a freshly built v11 catalog
      // before it committed; a second run finds exactly that catalog.
      assert(
        await runMigration(environment(url)) === "verify-v11",
        `an upgraded ${version} database is not recognised as exact v11`,
      );
    });
  });
}

Deno.test("[GAP-044] the upgrade from v7 keeps every member on in-app delivery with no digest", async () => {
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
      await runMigration(environment(url)) === "upgrade-v7-to-v11",
      "an exact v7 database was not classified for the v7 upgrade",
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

Deno.test("[REL-061] the v8-to-v9 upgrade indexes existing text and dismisses pairs only within a workspace", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v8Sql);
    const [userId, workspaceId, otherWorkspaceId] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    const [ada, twin, stranger] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    await sql`insert into crm.users (id, email) values (${userId}, 'v8-owner@example.test')`;
    await sql`
      insert into crm.workspaces (id, name, created_by_user_id) values
        (${workspaceId}, 'V8 upgrade', ${userId}),
        (${otherWorkspaceId}, 'V8 other', ${userId})
    `;
    await sql`
      insert into crm.people (id, workspace_id, given_name) values
        (${ada}, ${workspaceId}, 'Ada'), (${twin}, ${workspaceId}, 'Ada'),
        (${stranger}, ${otherWorkspaceId}, 'Ada')
    `;
    await sql`
      insert into crm.notes (workspace_id, person_id, body)
      values (${workspaceId}, ${ada}, 'Written before the upgrade')
    `;

    assert(
      await runMigration(environment(url)) === "upgrade-v8-to-v11",
      "an exact v8 database was not classified for the v8 upgrade",
    );
    const [indexed] = await sql<{ readonly found: number }[]>`
      select count(*)::int as found from crm.notes
      where to_tsvector('simple', body) @@ to_tsquery('simple', 'upgrade')
    `;
    assert(indexed?.found === 1, "the upgrade changed an existing note");
    const [low, high] = [ada, twin].sort();
    await sql`
      insert into crm.person_duplicate_dismissals (
        workspace_id, person_low_id, person_high_id
      ) values (${workspaceId}, ${low!}, ${high!})
    `;
    const [crossLow, crossHigh] = [ada, stranger].sort();
    const refused = await refusal(() =>
      sql`
        insert into crm.person_duplicate_dismissals (
          workspace_id, person_low_id, person_high_id
        ) values (${workspaceId}, ${crossLow!}, ${crossHigh!})
      `
    );
    assert(
      refused.includes("person_duplicate_dismissals_") &&
        refused.includes("_person_fk"),
      `a pair across workspaces was stored: ${refused}`,
    );
  });
});

Deno.test("[GIFTS-001] the v9-to-v11 upgrade keeps hand-recorded debts and charges a period once", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v9Sql);
    const [userId, workspaceId, otherWorkspaceId] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    const [ada, stranger, debtId] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    await sql`insert into crm.users (id, email) values (${userId}, 'v9-owner@example.test')`;
    await sql`
      insert into crm.workspaces (id, name, created_by_user_id) values
        (${workspaceId}, 'V9 upgrade', ${userId}),
        (${otherWorkspaceId}, 'V9 other', ${userId})
    `;
    await sql`
      insert into crm.people (id, workspace_id, given_name) values
        (${ada}, ${workspaceId}, 'Ada'), (${stranger}, ${otherWorkspaceId}, 'Ada')
    `;
    await sql`
      insert into crm.debts (id, workspace_id, person_id, direction, amount, currency_code)
      values (${debtId}, ${workspaceId}, ${ada}, 'they_owe', 12.5, 'EUR')
    `;

    assert(
      await runMigration(environment(url)) === "upgrade-v9-to-v11",
      "an exact v9 database was not classified for the v9-to-v11 upgrade",
    );
    const [kept] = await sql<
      { readonly amount: string; readonly rule: string | null }[]
    >`
      select amount::text, recurring_debt_id::text as rule from crm.debts
      where id = ${debtId}
    `;
    assert(
      kept?.amount === "12.5000" && kept.rule === null,
      "the upgrade changed a hand-recorded debt",
    );
    const [rule] = await sql<{ readonly id: string }[]>`
      insert into crm.recurring_debts (
        workspace_id, person_id, direction, amount, currency_code,
        day_of_month, starts_on
      ) values (${workspaceId}, ${ada}, 'they_owe', 30, 'EUR', 31, '2026-01-31')
      returning id::text
    `;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await sql`
        insert into crm.debts (
          workspace_id, person_id, direction, amount, currency_code,
          recurring_debt_id, occurrence_on
        ) values (
          ${workspaceId}, ${ada}, 'they_owe', 30, 'EUR', ${rule!.id},
          '2026-02-28'
        ) on conflict (recurring_debt_id, occurrence_on) do nothing
      `;
    }
    const [charged] = await sql<{ readonly found: number }[]>`
      select count(*)::int as found from crm.debts
      where recurring_debt_id = ${rule!.id}
    `;
    assert(charged?.found === 1, "a recurring period was charged twice");
    const refused = await refusal(() =>
      sql`
        insert into crm.recurring_debts (
          workspace_id, person_id, direction, amount, currency_code,
          day_of_month, starts_on
        ) values (
          ${workspaceId}, ${stranger}, 'they_owe', 30, 'EUR', 1, '2026-01-01'
        )
      `
    );
    assert(
      refused.includes("recurring_debts_person_fk"),
      `a rule across workspaces was stored: ${refused}`,
    );
  });
});

Deno.test("[GAP-037] the migration runner refuses a drifted catalog and leaves it untouched", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v10Sql);
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
    await sql.unsafe(artifacts.v9Sql);
    const message = await refusal(() =>
      applyCanonicalSchema(url, {
        ...artifacts,
        migrationV9ToV10: `${artifacts.migrationV9ToV10}\n-- drifted`,
      })
    );
    assert(
      message.startsWith("Schema v9-to-v11 migration checksum mismatch"),
      `a changed migration was not refused by checksum: ${message}`,
    );
    const [table] = await sql<{ readonly present: boolean }[]>`
      select to_regclass('crm.recurring_debts') is not null
        as present
    `;
    assert(
      table?.present === false,
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
