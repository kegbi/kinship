import {
  type CompiledQuery,
  type DatabaseConnection,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
} from "kysely";
import {
  countPersonReferences,
  referenceName,
  relinkPersonReferences,
} from "./person_references.ts";
import { assertEquals, assertRejects } from "../../testing/assert.ts";

const PERSON = "00000000-0000-4000-8000-0000000000aa";
const PRIMARY = "00000000-0000-4000-8000-0000000000bb";
const WORKSPACE = "00000000-0000-4000-8000-000000000001";
const OCCURRED_AT = new Date("2026-09-27T10:00:00.000Z");

/** A session whose only job is to record what the helpers asked for. */
function recorder(answers: readonly Record<string, unknown>[][] = []) {
  const asked: CompiledQuery[] = [];
  const connection: DatabaseConnection = {
    executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
      const rows = answers[asked.length] ?? [];
      asked.push(compiled);
      return Promise.resolve({ rows: rows as R[] });
    },
    streamQuery: () => {
      throw new Error("a reference query is never streamed");
    },
  };
  const database = new Kysely<Record<string, never>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => ({
        acquireConnection: () => Promise.resolve(connection),
        beginTransaction: () => Promise.resolve(),
        commitTransaction: () => Promise.resolve(),
        destroy: () => Promise.resolve(),
        init: () => Promise.resolve(),
        releaseConnection: () => Promise.resolve(),
        rollbackTransaction: () => Promise.resolve(),
      }),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { asked, transaction: { opaque: database } };
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

Deno.test("[PEOPLE-008] references are counted per site, scoped where the table can be", async () => {
  const session = recorder([[{ count: 2 }], []]);
  const counts = await countPersonReferences([
    { column: "person_id", table: "crm.notes", workspaceScoped: true },
    { column: "person_id", table: "crm.person_tags" },
  ], {
    personId: PERSON,
    transaction: session.transaction,
    workspaceId: WORKSPACE,
  });
  assertEquals(counts, {
    "crm.notes.person_id": 2,
    "crm.person_tags.person_id": 0,
  });
  assertEquals(session.asked.map((query) => squash(query.sql)), [
    "select count(*)::int as count from crm.notes where person_id = $1::uuid and workspace_id = $2::uuid",
    "select count(*)::int as count from crm.person_tags where person_id = $1::uuid",
  ]);
  assertEquals(session.asked[0]?.parameters, [PERSON, WORKSPACE]);
});

Deno.test("[PEOPLE-008] a relink rewrites the duplicate's rows and moves updated_at only where it exists", async () => {
  const session = recorder([[{ moved: 1 }, { moved: 1 }], [{ moved: 1 }]]);
  const relinked = await relinkPersonReferences([
    {
      column: "person_id",
      table: "crm.notes",
      touches: true,
      workspaceScoped: true,
    },
    { column: "person_id", table: "crm.person_tags" },
  ], {
    duplicateId: PERSON,
    occurredAt: OCCURRED_AT,
    primaryId: PRIMARY,
    transaction: session.transaction,
    workspaceId: WORKSPACE,
  });
  assertEquals(relinked, {
    "crm.notes.person_id": 2,
    "crm.person_tags.person_id": 1,
  });
  assertEquals(
    squash(session.asked[0]!.sql),
    "update crm.notes set person_id = $1::uuid, updated_at = greatest( $2::timestamptz, updated_at + interval '1 microsecond' ) where person_id = $3::uuid and workspace_id = $4::uuid returning 1 as moved",
  );
  assertEquals(
    squash(session.asked[1]!.sql),
    "update crm.person_tags set person_id = $1::uuid where person_id = $2::uuid returning 1 as moved",
  );
});

Deno.test("[PEOPLE-008] a site that is not a plain identifier is refused before any SQL runs", async () => {
  for (
    const site of [
      { column: "person_id", table: "notes" },
      { column: "person_id", table: "crm.notes; drop table crm.people" },
      { column: "person_id or true", table: "crm.notes" },
      { column: "Person", table: "crm.notes" },
    ]
  ) {
    const session = recorder();
    await assertRejects(
      () =>
        countPersonReferences([site], {
          personId: PERSON,
          transaction: session.transaction,
          workspaceId: WORKSPACE,
        }),
      `${site.table}.${site.column}`,
    );
    await assertRejects(
      () =>
        relinkPersonReferences([site], {
          duplicateId: PERSON,
          occurredAt: OCCURRED_AT,
          primaryId: PRIMARY,
          transaction: session.transaction,
          workspaceId: WORKSPACE,
        }),
      `${site.table}.${site.column}`,
    );
    assertEquals(session.asked, []);
  }
  assertEquals(
    referenceName({ column: "to_person_id", table: "crm.relationships" }),
    "crm.relationships.to_person_id",
  );
});
