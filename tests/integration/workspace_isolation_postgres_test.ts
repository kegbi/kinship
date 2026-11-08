/**
 * Schema v14 makes the database backstop workspace isolation (AUD-V2, ADR
 * 0008; SECT-01, SECT-02). These suites connect the way the deployed services
 * do — the API as `kinship_app`, the worker as `kinship_worker` — and seed as
 * the disposable project's superuser, which row-level security does not bind.
 *
 * - The service roles are not superusers and do not bypass row-level
 *   security, and they create nothing.
 * - A statement whose transaction set no `app.workspace_id` reads no tenant
 *   row, also on a pooled connection a scoped transaction used before.
 * - A reference into another workspace fails at the database, whoever writes
 *   it, because every tenant reference is a composite key.
 * - The list of tenant references is generated from the foreign-key catalog
 *   (`tests/support/workspace_references.ts`): this suite fails while the
 *   live catalog and the list differ, so a new reference cannot land without
 *   being listed under the kind whose negative test below covers it.
 */

import postgres from "postgres";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  requireWorkerDatabaseUrl,
  revocableActor,
  type Sql,
} from "../support/database.ts";
import {
  PLAIN_WORKSPACE_REFERENCE,
  SINGLE_PARENT_REFERENCES,
  UNFORCED_CHILD_REFERENCES,
  WORKSPACE_REFERENCES,
  type WorkspaceReferenceKind,
} from "../support/workspace_references.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl, { prepare: false });

function serviceSql(url: string): Sql {
  return postgres(url, { max: 1, onnotice: () => undefined, prepare: false });
}

/** The PostgreSQL error code `work` fails with, or `<accepted>`. */
async function failureCode(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
  } catch (error) {
    return (error as { readonly code?: string }).code ?? String(error);
  }
  return "<accepted>";
}

Deno.test({
  name:
    "[AUD-V2] the API and worker roles are not superusers, do not bypass row-level security, and create nothing",
  sanitizeResources: false,
  async fn() {
    for (
      const [url, role] of [
        [databaseUrl, "kinship_app"],
        [requireWorkerDatabaseUrl(), "kinship_worker"],
      ] as const
    ) {
      const service = serviceSql(url);
      try {
        const [standing] = await service<{
          readonly bypass: boolean;
          readonly createCrm: boolean;
          readonly createPublic: boolean;
          readonly name: string;
          readonly superuser: boolean;
        }[]>`
          select current_user::text as name, r.rolsuper as superuser,
            r.rolbypassrls as bypass,
            has_schema_privilege('crm', 'CREATE') as "createCrm",
            has_schema_privilege('public', 'CREATE') as "createPublic"
          from pg_roles r where r.rolname = current_user
        `;
        assert(
          standing?.name === role && !standing.superuser && !standing.bypass &&
            !standing.createCrm && !standing.createPublic,
          `${role} is not least-privilege: ${JSON.stringify(standing)}`,
        );
        assert(
          await failureCode(() =>
            service`create table crm.aud_v2_probe (id int)`
          ) === "42501",
          `${role} could create a table`,
        );
      } finally {
        await service.end();
      }
    }
  },
});

Deno.test({
  name:
    "[AUD-V2] a statement without app.workspace_id reads no tenant row, also on a pooled connection",
  sanitizeResources: false,
  async fn() {
    const a = await revocableActor(sql, `aud-v2-a-${crypto.randomUUID()}`);
    const b = await revocableActor(sql, `aud-v2-b-${crypto.randomUUID()}`);
    const app = serviceSql(databaseUrl);
    try {
      const tables = await sql<{ readonly name: string }[]>`
        select c.relname::text as name from pg_class c
        where c.relnamespace = 'crm'::regnamespace and c.relkind = 'r'
          and c.relforcerowsecurity
        order by c.relname
      `;
      assert(tables.length === 64, `${tables.length} tenant tables are forced`);
      const visible = async () => {
        const seen: string[] = [];
        for (const { name } of tables) {
          const [row] = await app.unsafe<{ readonly count: number }[]>(
            `select count(*)::int as count from crm.${name}`,
          );
          if ((row?.count ?? 0) > 0) seen.push(name);
        }
        return seen;
      };
      assert(
        (await visible()).length === 0,
        "an unscoped statement saw tenant rows",
      );
      const scoped = await app.begin(async (transaction) => {
        await transaction`select set_config('app.workspace_id', ${a.workspaceId}, true)`;
        return await transaction<{ readonly id: string }[]>`
          select id::text from crm.people order by id
        `;
      });
      assert(
        scoped.length === 1 && scoped[0]?.id === a.personId,
        `workspace A's scope saw ${JSON.stringify(scoped)}`,
      );
      // The same pooled connection now reads the setting back as '', which
      // nullif turns into no workspace rather than a failed cast.
      const after = await visible();
      assert(after.length === 0, `after a scoped transaction: ${after}`);
      assert(
        (await sql`select 1 from crm.people where id = ${b.personId}`)
          .length ===
          1,
        "the fixture wrote workspace B's person",
      );
    } finally {
      await app.end();
    }
  },
});

/**
 * Writes, as the superuser, which row-level security does not bind, so only
 * the composite key decides: a row of workspace B naming workspace A's
 * parent. `prepare` seeds A's parent and answers its id.
 */
const NEGATIVE: Readonly<
  Record<WorkspaceReferenceKind, {
    readonly reference: string;
    readonly write: (
      a: Awaited<ReturnType<typeof revocableActor>>,
      b: Awaited<ReturnType<typeof revocableActor>>,
    ) => Promise<unknown>;
  }>
> = {
  person: {
    reference: "notes_person_id_fkey",
    write: (a, b) =>
      sql`insert into crm.notes (workspace_id, person_id, body)
        values (${b.workspaceId}, ${a.personId}, 'cross')`,
  },
  member: {
    reference: "notes_created_by_member_id_fkey",
    write: (a, b) =>
      sql`insert into crm.notes (workspace_id, person_id, body,
          created_by_member_id)
        values (${b.workspaceId}, ${b.personId}, 'cross', ${a.memberId})`,
  },
  vocabulary: {
    reference: "person_tags_tag_id_fkey",
    write: async (a, b) => {
      const tagId = crypto.randomUUID();
      await sql`insert into crm.tags (id, workspace_id, name, slug)
        values (${tagId}, ${a.workspaceId}, 'cross', ${`cross-${tagId}`})`;
      return await sql`insert into crm.person_tags (workspace_id, person_id,
          tag_id) values (${b.workspaceId}, ${b.personId}, ${tagId})`;
    },
  },
  file: {
    reference: "data_exports_file_id_fkey",
    write: async (a, b) => {
      const fileId = crypto.randomUUID();
      await sql`insert into crm.files (id, workspace_id, storage_key)
        values (${fileId}, ${a.workspaceId}, ${`objects/${fileId}`})`;
      return await sql`insert into crm.data_exports (workspace_id, format,
          file_id) values (${b.workspaceId}, 'json', ${fileId})`;
    },
  },
  aggregate: {
    reference: "messages_conversation_id_fkey",
    write: async (a, b) => {
      const threadId = crypto.randomUUID();
      await sql`insert into crm.conversation_threads (id, workspace_id,
          person_id, happened_at)
        values (${threadId}, ${a.workspaceId}, ${a.personId}, now())`;
      return await sql`insert into crm.messages (workspace_id,
          conversation_id, content, written_at, direction)
        values (${b.workspaceId}, ${threadId}, 'cross', now(), 'inbound')`;
    },
  },
};

for (const [kind, negative] of Object.entries(NEGATIVE)) {
  Deno.test({
    name:
      `[AUD-V2] a cross-workspace ${kind} reference fails at the database (${negative.reference})`,
    sanitizeResources: false,
    async fn() {
      const a = await revocableActor(
        sql,
        `aud-v2-${kind}-a-${crypto.randomUUID()}`,
      );
      const b = await revocableActor(
        sql,
        `aud-v2-${kind}-b-${crypto.randomUUID()}`,
      );
      const listed = WORKSPACE_REFERENCES.find((reference) =>
        reference.constraint === negative.reference
      );
      assert(listed?.kind === kind, `${negative.reference} is not a ${kind}`);
      assert(
        await failureCode(() => negative.write(a, b)) === "23503",
        `${negative.reference} accepted a reference into another workspace`,
      );
    },
  });
}

Deno.test({
  name:
    "[AUD-V2] the API's own write into another workspace is refused by its scope",
  sanitizeResources: false,
  async fn() {
    const a = await revocableActor(
      sql,
      `aud-v2-scope-a-${crypto.randomUUID()}`,
    );
    const b = await revocableActor(
      sql,
      `aud-v2-scope-b-${crypto.randomUUID()}`,
    );
    const app = serviceSql(databaseUrl);
    try {
      const outOfScope = await failureCode(() =>
        app.begin(async (transaction) => {
          await transaction`select set_config('app.workspace_id', ${a.workspaceId}, true)`;
          await transaction`insert into crm.notes (workspace_id, person_id, body)
            values (${b.workspaceId}, ${b.personId}, 'intruder')`;
        })
      );
      assert(
        outOfScope === "42501",
        `a write outside the scope: ${outOfScope}`,
      );
      const unscoped = await failureCode(() =>
        app`insert into crm.notes (workspace_id, person_id, body)
          values (${a.workspaceId}, ${a.personId}, 'unscoped')`
      );
      assert(unscoped === "42501", `an unscoped write: ${unscoped}`);
    } finally {
      await app.end();
    }
  },
});

Deno.test({
  name:
    "[AUD-V2] every tenant reference is listed from the foreign-key catalog and bound to its workspace",
  sanitizeResources: false,
  async fn() {
    // The catalog query the list is generated from.
    const live = await sql<{
      readonly child: string;
      readonly column: string;
      readonly constraint: string;
      readonly definition: string;
      readonly onDelete: string;
      readonly parent: string;
    }[]>`
      select con.conname::text as constraint, src.relname::text as child,
        referenced.attname::text as column, tgt.relname::text as parent,
        case con.confdeltype when 'c' then 'cascade' when 'n' then 'set null'
          when 'r' then 'restrict' else 'no action' end as "onDelete",
        pg_get_constraintdef(con.oid) as definition
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_class tgt on tgt.oid = con.confrelid
      cross join lateral (
        select a.attname from unnest(con.conkey) with ordinality k(attnum, ord)
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
        where a.attname <> 'workspace_id' order by k.ord limit 1
      ) referenced
      where con.contype = 'f' and con.connamespace = 'crm'::regnamespace
        and src.relforcerowsecurity and tgt.relforcerowsecurity
      order by src.relname, con.conname
    `;
    const listed = (
      rows: readonly {
        readonly child: string;
        readonly column: string;
        readonly constraint: string;
        readonly onDelete: string;
        readonly parent: string;
      }[],
    ) =>
      rows.map((row) =>
        `${row.constraint} ${row.child}.${row.column} -> ${row.parent} ${row.onDelete}`
      ).sort();
    const want = listed(WORKSPACE_REFERENCES);
    const have = listed(live);
    assert(
      JSON.stringify(have) === JSON.stringify(want),
      `the foreign-key catalog and tests/support/workspace_references.ts differ: ${
        JSON.stringify({
          missing: have.filter((entry) => !want.includes(entry)),
          stale: want.filter((entry) => !have.includes(entry)),
        })
      }`,
    );
    const unbound = live.filter((row) =>
      row.constraint !== PLAIN_WORKSPACE_REFERENCE &&
      !row.definition.startsWith(
        `FOREIGN KEY (workspace_id, ${row.column}) REFERENCES crm.${row.parent}(workspace_id, id)`,
      )
    );
    assert(
      unbound.length === 0,
      `tenant references without their workspace: ${
        unbound.map((row) => row.constraint).join(", ")
      }`,
    );
    for (const kind of Object.keys(NEGATIVE)) {
      assert(
        WORKSPACE_REFERENCES.some((reference) => reference.kind === kind),
        `no reference of kind ${kind}`,
      );
    }
  },
});

/**
 * What the reference guard refuses in `database`'s `crm` schema (ADR 0008):
 *
 * - a reference between two tenant tables that is not listed;
 * - a reference from a table without forced row-level security into a tenant
 *   table that is not one of today's single-parent children with its parent;
 * - a reference into a workspace-owned table without row-level security — the
 *   root `workspaces` table, or any child the two allowlists name — that is
 *   neither a forced table's own `workspace_id` key nor listed below them;
 * - a listed single-parent or unforced-child reference that no longer exists.
 */
async function referenceGuardViolations(
  database: Sql,
): Promise<readonly string[]> {
  const rows = await database<{
    readonly child: string;
    readonly constraint: string;
    readonly forced: boolean;
    readonly parent: string;
    readonly parentForced: boolean;
    readonly workspaceKey: boolean;
  }[]>`
    select con.conname::text as constraint, src.relname::text as child,
      tgt.relname::text as parent, src.relforcerowsecurity as forced,
      tgt.relforcerowsecurity as "parentForced",
      exists (
        select 1 from unnest(con.conkey) key(attnum)
        join pg_attribute a on a.attrelid = con.conrelid
          and a.attnum = key.attnum
        where a.attname = 'workspace_id'
      ) as "workspaceKey"
    from pg_constraint con
    join pg_class src on src.oid = con.conrelid
    join pg_class tgt on tgt.oid = con.confrelid
    where con.contype = 'f' and con.connamespace = 'crm'::regnamespace
    order by con.conname
  `;
  const entry = (
    row: {
      readonly child: string;
      readonly constraint: string;
      readonly parent: string;
    },
  ) => `${row.constraint} ${row.child} -> ${row.parent}`;
  const listed = new Set(
    WORKSPACE_REFERENCES.map((reference) => reference.constraint),
  );
  const singleParent = new Set(SINGLE_PARENT_REFERENCES.map(entry));
  const unforcedChild = new Set(UNFORCED_CHILD_REFERENCES.map(entry));
  // The workspace-owned tables row-level security does not bind.
  const unforcedTenant = new Set([
    "workspaces",
    ...SINGLE_PARENT_REFERENCES.map((reference) => reference.child),
    ...UNFORCED_CHILD_REFERENCES.map((reference) => reference.child),
  ]);
  const present = new Set(rows.map(entry));
  return [
    ...rows.filter((row) =>
      row.forced && row.parentForced && !listed.has(row.constraint)
    ).map((row) => row.constraint),
    ...rows.filter((row) =>
      !row.forced && row.parentForced && !singleParent.has(entry(row))
    ).map((row) => row.constraint),
    ...rows.filter((row) =>
      unforcedTenant.has(row.parent) && !(row.forced && row.workspaceKey) &&
      !unforcedChild.has(entry(row))
    ).map((row) => row.constraint),
    ...[...singleParent, ...unforcedChild].filter((listedEntry) =>
      !present.has(listedEntry)
    ).map((listedEntry) => `stale: ${listedEntry}`),
  ];
}

Deno.test({
  name:
    "[AUD-V2] a new link table without workspace_id fails the reference guard",
  sanitizeResources: false,
  async fn() {
    assert(
      (await referenceGuardViolations(sql)).length === 0,
      `the live catalog fails the reference guard: ${
        (await referenceGuardViolations(sql)).join(", ")
      }`,
    );
    // A link that names a person but carries no workspace: no forced policy,
    // no composite key. It must not pass silently.
    let caught: readonly string[] = [];
    const rolledBack = new Error("rolled back");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(`
        create table crm.person_x_links (
          person_id uuid not null references crm.people (id),
          x_id uuid not null
        )
      `);
      caught = await referenceGuardViolations(transaction as unknown as Sql);
      throw rolledBack;
    }).catch((error) => {
      if (error !== rolledBack) throw error;
    });
    assert(
      caught.includes("person_x_links_person_id_fkey"),
      `a link table without workspace_id passed the reference guard: ${
        JSON.stringify(caught)
      }`,
    );
  },
});

Deno.test({
  name:
    "[AUD-V2] a new table below an unforced child fails the reference guard",
  sanitizeResources: false,
  async fn() {
    // A grandchild of `people` through `pets`, which has no workspace_id of
    // its own: nothing binds it to a workspace. It must not pass silently.
    let caught: readonly string[] = [];
    const rolledBack = new Error("rolled back");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(`
        create table crm.pet_photos (
          pet_id uuid not null references crm.pets (id),
          caption text
        )
      `);
      caught = await referenceGuardViolations(transaction as unknown as Sql);
      throw rolledBack;
    }).catch((error) => {
      if (error !== rolledBack) throw error;
    });
    assert(
      caught.includes("pet_photos_pet_id_fkey"),
      `a table below an unforced child passed the reference guard: ${
        JSON.stringify(caught)
      }`,
    );
  },
});

Deno.test({
  name: "[AUD-V2] workspace isolation resources close",
  sanitizeResources: false,
  async fn() {
    await sql.end();
  },
});
