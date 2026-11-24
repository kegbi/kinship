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
  applyCanonicalSchemaWith,
  canonicalTableNames,
  type ExpectedCatalogs,
} from "../../tools/migrations/baseline.ts";
import {
  readCanonicalArtifacts,
  runMigration,
} from "../../tools/migrations/main.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireAdminDatabaseUrl,
  type Sql,
} from "../support/database.ts";

// Scratch databases are created, seeded, and migrated as the project superuser;
// the gate itself proves the migrate job as kinship_migrator (ADR 0008).
const databaseUrl = requireAdminDatabaseUrl();
const artifacts = await readCanonicalArtifacts();
// Every case migrates a scratch database of the one disposable server, where
// an immutable baseline always gives the same catalog. The cases above the
// [REL-129] ones share the catalogs they build, so each baseline is built once
// for the file and not on every run. The [REL-129] cases start from maps of
// their own, as a runner process does.
const builtCatalogs: ExpectedCatalogs = new Map();

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
  ["v11", artifacts.v11Sql],
  ["v12", artifacts.v12Sql],
  ["v13", artifacts.v13Sql],
  ["v14", artifacts.v14Sql],
  ["v15", artifacts.v15Sql],
] as const;

for (const [version, baselineSql] of priorBaselines) {
  Deno.test(`[REL-061] the migration runner upgrades an exact ${version} database to the v16 catalog`, async () => {
    await withScratchDatabase(async ({ sql, url }) => {
      await sql.unsafe(baselineSql);
      const userId = crypto.randomUUID();
      await sql`
        insert into crm.users (id, email)
        values (${userId}, ${`${version}-runner@example.test`})
      `;

      assert(
        await runMigration(environment(url), builtCatalogs) ===
          `upgrade-${version}-to-v16`,
        `an exact ${version} database was not classified for the upgrade`,
      );

      const upgraded = await crmTables(sql);
      const expected = canonicalTableNames(artifacts.v16Sql);
      assert(
        JSON.stringify(upgraded) === JSON.stringify(expected) &&
          upgraded.length === 93,
        `the upgraded catalog is not v16: ${
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
      // The runner verified the structure against the v16 catalog before it
      // committed; a second run finds exactly that catalog.
      assert(
        await runMigration(environment(url), builtCatalogs) === "verify-v16",
        `an upgraded ${version} database is not recognised as exact v16`,
      );
    });
  });
}

async function searchPath(sql: Sql): Promise<string | undefined> {
  const [row] = await sql<{ readonly search_path: string }[]>`
    select current_setting('search_path') as search_path
  `;
  return row?.search_path;
}

// Migration 0004 carries its own BEGIN/COMMIT. A v1 upgrade must still be one
// transaction: a failure in 0014, after 0004, leaves the v1 catalog and its
// rows exactly as they were (REL-118).
Deno.test("[REL-118] a v1 upgrade that fails after 0004 leaves the database unchanged", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v1Sql);
    const [userId, workspaceId, otherWorkspaceId] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    const [ada, stranger, noteId] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    await sql`insert into crm.users (id, email) values (${userId}, 'v1-atomic@example.test')`;
    await sql`
      insert into crm.workspaces (id, name, created_by_user_id) values
        (${workspaceId}, 'V1 atomic', ${userId}),
        (${otherWorkspaceId}, 'V1 other', ${userId})
    `;
    await sql`
      insert into crm.people (id, workspace_id, given_name) values
        (${ada}, ${workspaceId}, 'Ada'), (${stranger}, ${otherWorkspaceId}, 'Ada')
    `;
    // v1 admits a note whose person lives in another workspace; 0014's
    // workspace-bound key refuses it, so the upgrade fails after 0004.
    await sql`
      insert into crm.notes (id, workspace_id, person_id, body)
      values (${noteId}, ${workspaceId}, ${stranger}, 'Bridges two workspaces')
    `;
    const before = await crmTables(sql);
    const [currenciesBefore] = await sql<{ readonly found: number }[]>`
      select count(*)::int as found from crm.currencies
    `;

    const message = await refusal(() =>
      runMigration(environment(url), builtCatalogs)
    );
    assert(
      message.includes("notes_person_id_fkey"),
      `the bridging note did not fail the upgrade in 0014: ${message}`,
    );

    assert(
      JSON.stringify(await crmTables(sql)) === JSON.stringify(before),
      "the failed upgrade left tables from later migrations behind",
    );
    const [state] = await sql<
      {
        readonly currencies: number;
        readonly digest: boolean;
        readonly note: boolean;
      }[]
    >`
      select
        (select count(*)::int from crm.currencies) as currencies,
        exists (select 1 from information_schema.columns
          where table_schema = 'crm' and table_name = 'api_request_logs'
            and column_name = 'authentication_subject_digest') as digest,
        exists (select 1 from crm.notes where id = ${noteId}) as note
    `;
    assert(
      state !== undefined && state.currencies === currenciesBefore?.found &&
        state.digest === false &&
        state.note === true,
      `the failed upgrade committed part of 0002-0004: ${
        JSON.stringify(state)
      }`,
    );
  });
});

// 0011 and 0014 set search_path for the session; the runner keeps that inside
// its transaction, so the connection it used is unchanged afterwards.
Deno.test("[REL-118] the v1 upgrade and a v16 verification leave the connection's search_path unchanged", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v1Sql);
    const client = openSql(url, { max: 1, prepare: false });
    // Catalogs of its own: the scratch builds set search_path too, and they
    // run on this connection only when the catalogs are not built yet.
    const ownCatalogs: ExpectedCatalogs = new Map();
    try {
      const original = await searchPath(client);
      assert(
        await applyCanonicalSchemaWith(client, artifacts, ownCatalogs) ===
          "upgrade-v1-to-v16",
        "an exact v1 database was not upgraded on the caller's connection",
      );
      const afterUpgrade = await searchPath(client);
      assert(
        afterUpgrade === original,
        `the upgrade changed search_path from ${original} to ${afterUpgrade}`,
      );
      assert(
        await applyCanonicalSchemaWith(client, artifacts, ownCatalogs) ===
          "verify-v16",
        "the upgraded database is not recognised as exact v16",
      );
      const afterVerify = await searchPath(client);
      assert(
        afterVerify === original,
        `verification changed search_path from ${original} to ${afterVerify}`,
      );
    } finally {
      await client.end();
    }
  });
});

// Production databases are v14 (REL-120): the runner upgrades one with tenant
// rows in the eleven tables v15 binds, each row keeps everything it held, and
// each child takes its parent's workspace.
Deno.test("[REL-120] the v14-to-v16 upgrade keeps every child row and gives it its parent's workspace", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v14Sql);
    const [userId, workspaceId, otherId, memberId, personId, otherPersonId] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    await sql`insert into crm.users (id, email) values (${userId}, 'v14-runner@example.test')`;
    await sql`
      insert into crm.workspaces (id, name, created_by_user_id) values
        (${workspaceId}, 'V14 upgrade', ${userId}), (${otherId}, 'V14 other', ${userId})
    `;
    await sql`
      insert into crm.workspace_members (id, workspace_id, user_id, role, status)
      values (${memberId}, ${workspaceId}, ${userId}, 'owner', 'active')
    `;
    await sql`
      insert into crm.member_preferences (member_id, timezone, ui_state)
      values (${memberId}, 'Europe/Belgrade', '{"tab":"notes"}'::jsonb)
    `;
    await sql`
      insert into crm.people (id, workspace_id, given_name) values
        (${personId}, ${workspaceId}, 'Ada'), (${otherPersonId}, ${otherId}, 'Bo')
    `;
    await sql`
      insert into crm.pets (person_id, name, notes) values
        (${personId}, 'Rex', 'Good dog'), (${otherPersonId}, 'Tom', null)
    `;
    const [dataImport] = await sql<{ readonly id: string }[]>`
      insert into crm.data_imports (workspace_id, source_system)
      values (${workspaceId}, 'monica') returning id::text
    `;
    const [entity] = await sql<{ readonly id: string }[]>`
      insert into crm.data_import_entities (import_id, source_table,
        source_primary_key, raw_snapshot)
      values (${dataImport!.id}, 'contacts', '7', '{"first_name":"Ada"}'::jsonb)
      returning id::text
    `;
    await sql`
      insert into crm.data_import_reports (import_id, entity_id, severity,
        message) values (${dataImport!.id}, ${entity!.id}, 'warning', 'kept')
    `;
    const snapshot = () =>
      sql<{ readonly rows: string }[]>`
        select concat_ws(' | ',
          (select string_agg((to_jsonb(p) - 'workspace_id')::text, ',' order by p.name) from crm.pets p),
          (select (to_jsonb(m) - 'workspace_id')::text from crm.member_preferences m),
          (select (to_jsonb(e) - 'workspace_id')::text from crm.data_import_entities e),
          (select (to_jsonb(r) - 'workspace_id')::text from crm.data_import_reports r)
        ) as rows
      `;
    const [before] = await snapshot();

    assert(
      await runMigration(environment(url), builtCatalogs) ===
        "upgrade-v14-to-v16",
      "an exact v14 database was not classified for the v14-to-v16 upgrade",
    );
    const [after] = await snapshot();
    assert(
      before?.rows !== undefined && after?.rows === before.rows,
      `the upgrade changed a child row: ${before?.rows} -> ${after?.rows}`,
    );
    const owners = await sql<
      { readonly name: string; readonly owner: string }[]
    >`
      select 'pet ' || p.name as name, p.workspace_id::text as owner from crm.pets p
      union all select 'preferences', m.workspace_id::text from crm.member_preferences m
      union all select 'entity', e.workspace_id::text from crm.data_import_entities e
      union all select 'report', r.workspace_id::text from crm.data_import_reports r
      order by name
    `;
    assert(
      JSON.stringify(owners) === JSON.stringify([
        { name: "entity", owner: workspaceId },
        { name: "pet Rex", owner: workspaceId },
        { name: "pet Tom", owner: otherId },
        { name: "preferences", owner: workspaceId },
        { name: "report", owner: workspaceId },
      ]),
      `the children did not take their parents' workspaces: ${
        JSON.stringify(owners)
      }`,
    );
    assert(
      await runMigration(environment(url), builtCatalogs) === "verify-v16",
      "an upgraded v14 database is not recognised as exact v16",
    );
  });
});

// Production databases are v15 (MCP-E3): the runner upgrades one with records
// a keyed create made, keeps every row, and adds the request tombstones empty,
// since no record deleted before v16 needs one.
Deno.test("[MCP-E3] the v15-to-v16 upgrade keeps every row and adds an empty, forced tombstone table", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v15Sql);
    const [userId, workspaceId, personId] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    await sql`insert into crm.users (id, email) values (${userId}, 'v15-runner@example.test')`;
    await sql`
      insert into crm.workspaces (id, name, created_by_user_id)
      values (${workspaceId}, 'V15 upgrade', ${userId})
    `;
    await sql`
      insert into crm.people (id, workspace_id, given_name)
      values (${personId}, ${workspaceId}, 'Ada')
    `;
    await sql`
      insert into crm.notes (id, workspace_id, person_id, body) values
        ('00000000-0000-8000-8000-0000000016a1', ${workspaceId}, ${personId}, 'Kept')
    `;
    await sql`
      insert into crm.gifts (id, workspace_id, person_id, name) values
        ('00000000-0000-8000-8000-0000000016a2', ${workspaceId}, ${personId}, 'Lamp')
    `;
    const snapshot = () =>
      sql<{ readonly rows: string }[]>`
        select concat_ws(' | ',
          (select string_agg(to_jsonb(n)::text, ',' order by n.id) from crm.notes n),
          (select string_agg(to_jsonb(g)::text, ',' order by g.id) from crm.gifts g),
          (select string_agg(to_jsonb(p)::text, ',' order by p.id) from crm.people p)
        ) as rows
      `;
    const [before] = await snapshot();
    assert(
      await runMigration(environment(url), builtCatalogs) ===
        "upgrade-v15-to-v16",
      "an exact v15 database was not classified for the v15-to-v16 upgrade",
    );
    const [after] = await snapshot();
    assert(
      before?.rows !== undefined && after?.rows === before.rows,
      `the upgrade changed a row: ${before?.rows} -> ${after?.rows}`,
    );
    const [table] = await sql<
      { readonly forced: boolean; readonly rows: number }[]
    >`
      select c.relforcerowsecurity as forced,
        (select count(*)::int from crm.request_tombstones) as rows
      from pg_class c where c.oid = 'crm.request_tombstones'::regclass
    `;
    assert(
      table?.forced === true && table.rows === 0,
      `the tombstones are not forced and empty: ${JSON.stringify(table)}`,
    );
    assert(
      await runMigration(environment(url), builtCatalogs) === "verify-v16",
      "an upgraded v15 database is not recognised as exact v16",
    );
  });
});

// A fresh database still applies v16 once and then verifies.
Deno.test("[REL-118] a fresh v16 database applies once and then verifies as exact v16", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    const client = openSql(url, { max: 1, prepare: false });
    try {
      const original = await searchPath(client);
      assert(
        await applyCanonicalSchemaWith(client, artifacts, new Map()) ===
          "apply-v16",
        "an empty database was not given the v16 schema",
      );
      const afterApply = await searchPath(client);
      assert(
        afterApply === original,
        `applying v16 changed search_path from ${original} to ${afterApply}`,
      );
    } finally {
      await client.end();
    }
    assert(
      await runMigration(environment(url), builtCatalogs) === "verify-v16",
      "a fresh v16 database is not recognised as exact v16",
    );
    assert(
      (await crmTables(sql)).length === 93,
      "verification changed the v16 catalog",
    );
  });
});

Deno.test("[GAP-044] the upgrade from v11 rewords only the reminder-delivery column comment", async () => {
  const columnComment = (sql: Sql) =>
    sql<{ readonly comment: string }[]>`
      select col_description('crm.member_preferences'::regclass, attnum) as comment
      from pg_attribute
      where attrelid = 'crm.member_preferences'::regclass
        and attname = 'reminder_delivery'
    `;
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v11Sql);
    const [before] = await columnComment(sql);
    assert(
      before?.comment.includes("generated from now on") === true,
      "the v11 comment no longer describes only later occurrences",
    );

    assert(
      await runMigration(environment(url), builtCatalogs) ===
        "upgrade-v11-to-v16",
      "an exact v11 database was not classified for the v11-to-v16 upgrade",
    );
    const [after] = await columnComment(sql);
    assert(
      after?.comment ===
        "Channels for every reminder occurrence not yet sent, including those already scheduled: in_app, email, or both; email requires a verified address.",
      `the v12 comment was not applied: ${after?.comment}`,
    );
    assert(
      JSON.stringify(await crmTables(sql)) ===
        JSON.stringify(canonicalTableNames(artifacts.v16Sql)),
      "the comment-only upgrade changed the table catalog",
    );
  });
});

Deno.test("[REL-061] the v12-to-v16 upgrade keeps imported catalog rows, seeds the rest, and admits an MFA challenge", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v12Sql);
    const [userId, emotionId, petId] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    await sql`
      insert into crm.users (id, email)
      values (${userId}, 'v13-runner@example.test')
    `;
    // A Monica import into v12 named one stock emotion and one stock pet.
    await sql`insert into crm.emotion_options (id, name) values (${emotionId}, 'Joy')`;
    await sql`
      insert into crm.pet_categories (id, name, is_common)
      values (${petId}, 'dog', true)
    `;

    assert(
      await runMigration(environment(url), builtCatalogs) ===
        "upgrade-v12-to-v16",
      "an exact v12 database was not classified for the v12-to-v16 upgrade",
    );
    const [catalogs] = await sql<{
      readonly emotions: number;
      readonly joy: string;
      readonly dog: string;
      readonly pets: number;
    }[]>`
      select
        (select count(*)::int from crm.emotion_options) as emotions,
        (select id::text from crm.emotion_options where lower(name) = 'joy')
          as joy,
        (select count(*)::int from crm.pet_categories) as pets,
        (select id::text from crm.pet_categories where name = 'dog') as dog
    `;
    assert(
      catalogs?.emotions === 132 && catalogs.joy === emotionId &&
        catalogs.pets === 11 && catalogs.dog === petId,
      `the upgrade did not keep the imported rows and seed the rest: ${
        JSON.stringify(catalogs)
      }`,
    );
    await sql`
      insert into crm.user_sessions (user_id, session_hash, purpose, expires_at)
      values (${userId}, 'v13-mfa-challenge', 'mfa-challenge',
        now() + interval '5 minutes')
    `;
    assert(
      await runMigration(environment(url), builtCatalogs) === "verify-v16",
      "an upgraded v12 database is not recognised as exact v16",
    );
  });
});

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
      await runMigration(environment(url), builtCatalogs) ===
        "upgrade-v7-to-v16",
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
      await runMigration(environment(url), builtCatalogs) ===
        "upgrade-v8-to-v16",
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

Deno.test("[GIFTS-001] the v9-to-v16 upgrade keeps hand-recorded debts and charges a period once", async () => {
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
      await runMigration(environment(url), builtCatalogs) ===
        "upgrade-v9-to-v16",
      "an exact v9 database was not classified for the v9-to-v16 upgrade",
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

    const message = await refusal(() =>
      runMigration(environment(url), builtCatalogs)
    );
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

    const message = await refusal(() =>
      runMigration(environment(url), builtCatalogs)
    );
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
      message.startsWith("Schema v9-to-v10 migration checksum mismatch"),
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

function builtVersions(expected: ExpectedCatalogs): readonly number[] {
  return [...expected.keys()].sort((left, right) => left - right);
}

// A baseline's expected catalog costs a full build of that schema. The runner
// builds the current one, then older ones only until the database matches, so
// an up-to-date database or the previous version does not pay for sixteen.
Deno.test("[REL-129] the runner builds only the baselines it needs to classify a database", async () => {
  await withScratchDatabase(async ({ url }) => {
    const fresh: ExpectedCatalogs = new Map();
    assert(
      await applyCanonicalSchema(url, artifacts, fresh) === "apply-v16",
      "an empty database was not given the v16 schema",
    );
    assert(
      JSON.stringify(builtVersions(fresh)) === "[16]",
      `an empty database built more than v16: ${builtVersions(fresh)}`,
    );
    const current: ExpectedCatalogs = new Map();
    assert(
      await applyCanonicalSchema(url, artifacts, current) === "verify-v16",
      "a current database was not verified",
    );
    assert(
      JSON.stringify(builtVersions(current)) === "[16]",
      `a current database built more than v16: ${builtVersions(current)}`,
    );
  });
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v13Sql);
    const older: ExpectedCatalogs = new Map();
    assert(
      await applyCanonicalSchema(url, artifacts, older) ===
        "upgrade-v13-to-v16",
      "an exact v13 database was not upgraded",
    );
    assert(
      JSON.stringify(builtVersions(older)) === "[13,14,15,16]",
      `a v13 database built other baselines: ${builtVersions(older)}`,
    );
  });
});

// One server gives one catalog per immutable baseline, so a caller that runs
// the runner repeatedly may hand every run the catalogs an earlier run built.
Deno.test("[REL-129] catalogs an earlier run built are reused, and a drifted database is still refused", async () => {
  const shared: ExpectedCatalogs = new Map();
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v15Sql);
    assert(
      await applyCanonicalSchema(url, artifacts, shared) ===
        "upgrade-v15-to-v16",
      "an exact v15 database was not upgraded",
    );
  });
  const [v15, v16] = [shared.get(15), shared.get(16)];
  assert(
    v15 !== undefined && v16 !== undefined && shared.size === 2,
    `the first run did not leave v15 and v16: ${builtVersions(shared)}`,
  );
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v15Sql);
    assert(
      await applyCanonicalSchema(url, artifacts, shared) ===
        "upgrade-v15-to-v16",
      "a second v15 database was not upgraded from the reused catalogs",
    );
    assert(
      shared.get(15) === v15 && shared.get(16) === v16 && shared.size === 2,
      "the second run rebuilt a catalog it was given",
    );
    await sql`alter table crm.users add column drifted_note text`;
    const message = await refusal(() =>
      applyCanonicalSchema(url, artifacts, shared)
    );
    assert(
      message === "Refusing ambiguous or drifted database state.",
      `a drifted catalog was not refused with reused catalogs: ${message}`,
    );
    assert(
      shared.get(16) === v16 && builtVersions(shared).length === 16,
      `a drift refusal did not compare every baseline: ${
        builtVersions(shared)
      }`,
    );
  });
  // Classification names the one baseline a database equals, which holds only
  // while no two baselines have the same catalog.
  const distinct = new Set(
    [...shared.values()].map((catalog) => catalog.structure.join("\n")),
  );
  assert(
    distinct.size === 16,
    `two baselines have the same catalog: ${distinct.size} distinct of 16`,
  );
});

/** Resolves once a session of `sql`'s database waits for an advisory lock. */
async function advisoryLockWaiter(sql: Sql): Promise<void> {
  for (let attempt = 0; attempt < 800; attempt += 1) {
    const [row] = await sql<{ readonly waiting: number }[]>`
      select count(*)::int as waiting from pg_locks
      where locktype = 'advisory' and not granted and database =
        (select oid from pg_database where datname = current_database())
    `;
    if ((row?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("no session waited for the migration advisory lock");
}

/**
 * Starts a runner on `url` while `sql` holds the migration lock, runs `change`
 * once the runner waits for it, and returns what the runner answered. The
 * runner waits at most five seconds, so `change` is one small statement.
 */
async function whileRunnerWaits(
  sql: Sql,
  url: string,
  expected: ExpectedCatalogs,
  change: () => Promise<unknown>,
): Promise<string> {
  await sql`select pg_advisory_lock(492337110)`;
  const run = applyCanonicalSchema(url, artifacts, expected).catch((error) =>
    error instanceof Error ? error.message : String(error)
  );
  try {
    await advisoryLockWaiter(sql);
    await change();
  } finally {
    await sql`select pg_advisory_unlock(492337110)`;
    await run;
  }
  return await run;
}

// The runner classifies before it takes its lock, to build only what it needs.
// It classifies again under the lock, so a database another session changed in
// between is never acted on as the state the runner first saw.
Deno.test("[REL-129] a database that drifts between classification and the lock is refused, and verifies once restored", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    const expected: ExpectedCatalogs = new Map();
    assert(
      await applyCanonicalSchema(url, artifacts, expected) === "apply-v16",
      "an empty database was not given the v16 schema",
    );
    const answer = await whileRunnerWaits(
      sql,
      url,
      expected,
      () => sql`alter table crm.users add column drifted_note text`,
    );
    assert(
      answer ===
        "The database schema changed while the runner classified it; run the migration again.",
      `a database changed under the runner was not refused: ${answer}`,
    );
    assert(
      JSON.stringify(builtVersions(expected)) === "[16]",
      `the refused run built baselines after its first reading: ${
        builtVersions(expected)
      }`,
    );
    await sql`alter table crm.users drop column drifted_note`;
    assert(
      await applyCanonicalSchema(url, artifacts, expected) === "verify-v16",
      "the restored database was not verified on the next run",
    );
  });
});

// A migrate job that read v15 and then waited while another job upgraded the
// database verifies the v16 it finds under the lock; it does not upgrade again.
Deno.test("[REL-129] a runner that read v15 and waited while the database was upgraded verifies v16", async () => {
  await withScratchDatabase(async ({ sql, url }) => {
    await sql.unsafe(artifacts.v15Sql);
    await sql`select set_config('search_path', 'public', false)`;
    const expected: ExpectedCatalogs = new Map();
    const answer = await whileRunnerWaits(sql, url, expected, async () => {
      await sql.unsafe(artifacts.migrationV15ToV16);
      await sql`select set_config('search_path', 'public', false)`;
    });
    assert(
      answer === "verify-v16",
      `a runner that waited through an upgrade answered: ${answer}`,
    );
    assert(
      JSON.stringify(builtVersions(expected)) === "[15,16]",
      `the waiting runner had not read v15 first: ${builtVersions(expected)}`,
    );
    assert(
      (await crmTables(sql)).length === 93,
      "the waiting runner did not leave the v16 catalog",
    );
  });
});
