import {
  type CompiledQuery,
  type DatabaseConnection,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
} from "kysely";
import { workspaceLifecycleImpact } from "./lifecycle_impact.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const WORKSPACE = "00000000-0000-4000-8000-000000000001";

/** A session whose only job is to record what the adapter asked for. */
function recorder(rows: readonly Record<string, unknown>[] = []) {
  const asked: CompiledQuery[] = [];
  const connection: DatabaseConnection = {
    executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
      asked.push(compiled);
      return Promise.resolve({ rows: rows as R[] });
    },
    streamQuery: () => {
      throw new Error("the impact query is never streamed");
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
  return { asked, transaction: { opaque: database }, workspaceId: WORKSPACE };
}

Deno.test("[GAP-012] a ' via ' step becomes a join to the owning table", async () => {
  const session = recorder([{ dates: 2, revision: "d41d8" }]);
  const impact = workspaceLifecycleImpact({
    counts: { dates: "crm.person_dates via crm.people.person_id" },
    revision: { dates: "crm.person_dates@id via crm.people.person_id" },
  });
  const contribution = await impact.inspectBeforeCascade(session);
  const [query] = session.asked;
  assert(query !== undefined, "the adapter asked exactly one question");
  assert(
    query.sql.includes(
      `from "crm"."person_dates" as "t", "crm"."people" as "o1" ` +
        `where "o1"."id" = "t"."person_id" and "o1"."workspace_id" = $1::uuid`,
    ),
    `the owner carries the workspace predicate, received ${query.sql}`,
  );
  assert(
    query.sql.includes(`jsonb_agg(to_jsonb("t") order by "t"."id")`),
    `the digest aggregates the owned rows in order, received ${query.sql}`,
  );
  assert(
    query.parameters.every((parameter) => parameter === WORKSPACE),
    "the workspace is the only parameter",
  );
  assert(
    contribution.counts.dates === 2 && contribution.revision === "d41d8",
    `the row becomes the contribution, received ${
      JSON.stringify(contribution)
    }`,
  );
  assert(
    !("objectKeys" in contribution),
    "a module without stored objects contributes none",
  );
});

Deno.test("[GAP-012] a two-step path chains the owners in order", async () => {
  const session = recorder([{ labels: 0, revision: "" }]);
  await workspaceLifecycleImpact({
    counts: { labels: "crm.a" },
    revision: {
      labels: "crm.a@x,y via crm.b.b_id via crm.c.c_id",
    },
  }).inspectBeforeCascade(session);
  assert(
    session.asked[0]?.sql.includes(
      `from "crm"."a" as "t", "crm"."b" as "o1", "crm"."c" as "o2" ` +
        `where "o1"."id" = "t"."b_id" and "o2"."id" = "o1"."c_id" ` +
        `and "o2"."workspace_id" = $2::uuid`,
    ),
    `the last owner owns the rows, received ${session.asked[0]?.sql}`,
  );
  assert(
    session.asked[0]?.sql.includes(`order by "t"."x", "t"."y"`),
    `every ordering column is used, received ${session.asked[0]?.sql}`,
  );
});

Deno.test("[GAP-012] several counted tables become one summed number", async () => {
  const session = recorder([{ integrations: 5, revision: "" }]);
  const contribution = await workspaceLifecycleImpact({
    counts: { integrations: ["crm.books", "crm.subscriptions"] },
    revision: "crm.books@id",
  }).inspectBeforeCascade(session);
  const sql = session.asked[0]?.sql ?? "";
  assert(
    sql.includes(
      `((select count(*) from "crm"."books" as "t" ` +
        `where "t"."workspace_id" = $1::uuid) + ` +
        `(select count(*) from "crm"."subscriptions" as "t" ` +
        `where "t"."workspace_id" = $2::uuid))::int as "integrations"`,
    ),
    `the counts are added, received ${sql}`,
  );
  assert(
    sql.includes(`md5(coalesce((select jsonb_agg(`) &&
      !sql.includes("jsonb_build_object"),
    `a single unlabelled source hashes the bare array, received ${sql}`,
  );
  assert(contribution.counts.integrations === 5, "the sum is reported");
});

Deno.test("[GAP-012] a labelled digest keeps the declared label order", async () => {
  const session = recorder([{ n: 0, revision: "" }]);
  await workspaceLifecycleImpact({
    counts: { n: "crm.a" },
    revision: { second: "crm.b@id", first: "crm.a@id" },
  }).inspectBeforeCascade(session);
  const sql = session.asked[0]?.sql ?? "";
  assert(
    sql.indexOf("'second'") < sql.indexOf("'first'"),
    `the spec order is the digest order, received ${sql}`,
  );
});

Deno.test("[GAP-012] stored object keys drop the rows that have none", async () => {
  const session = recorder([{
    files: 1,
    objectKeys: ["a", null, 7, "b"],
    revision: "",
  }]);
  const contribution = await workspaceLifecycleImpact({
    counts: { files: "crm.files" },
    objectKeys: "crm.files@storage_key",
    revision: { files: "crm.files@id" },
  }).inspectBeforeCascade(session);
  assert(
    session.asked[0]?.sql.includes(
      `filter (where "t"."storage_key" is not null)`,
    ),
    `the query skips the keyless rows, received ${session.asked[0]?.sql}`,
  );
  assert(
    JSON.stringify(contribution.objectKeys) === '["a","b"]',
    `only the text keys survive, received ${
      JSON.stringify(contribution.objectKeys)
    }`,
  );
});

Deno.test("[GAP-012] an empty result still contributes a shape", async () => {
  const session = recorder([]);
  const contribution = await workspaceLifecycleImpact({
    counts: { files: "crm.files" },
    objectKeys: "crm.files@storage_key",
    revision: "crm.files@id",
  }).inspectBeforeCascade(session);
  assert(
    JSON.stringify(contribution) ===
      '{"counts":{"files":0},"objectKeys":[],"revision":""}',
    `an absent row reads as nothing, received ${JSON.stringify(contribution)}`,
  );
});

Deno.test("[GAP-012] a malformed spec fails when the module is imported", () => {
  const rejected = (
    build: () => unknown,
    because: string,
  ) => {
    try {
      build();
    } catch {
      return;
    }
    throw new Error(`the spec was accepted although ${because}`);
  };
  rejected(
    () =>
      workspaceLifecycleImpact({
        counts: { a: "crm.a" },
        revision: { a: "crm.a" },
      }),
    "a digest source names no ordering column",
  );
  rejected(
    () =>
      workspaceLifecycleImpact({
        counts: { a: "people" },
        revision: { a: "crm.a@id" },
      }),
    "a counted table carries no schema",
  );
  rejected(
    () =>
      workspaceLifecycleImpact({
        counts: { a: "crm.a" },
        revision: { "a'b": "crm.a@id" },
      }),
    "a digest label is not a plain name",
  );
  rejected(
    () =>
      workspaceLifecycleImpact({
        counts: { a: "crm.a" },
        objectKeys: "crm.a@one,two",
        revision: "crm.a@id",
      }),
    "the object keys are not a single column",
  );
  rejected(
    () =>
      workspaceLifecycleImpact({
        counts: { a: "crm.a" },
        revision: "crm.a@id; drop table",
      }),
    "an ordering column is not a plain name",
  );
});
