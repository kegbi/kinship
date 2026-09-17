import {
  type CompiledQuery,
  type DatabaseConnection,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
} from "kysely";
import { referenceCounter } from "./reference_counter.ts";
import { assert } from "../../testing/assert.ts";

const ENTRY = "00000000-0000-4000-8000-0000000000aa";
const REPLACEMENT = "00000000-0000-4000-8000-0000000000bb";
const WORKSPACE = "00000000-0000-4000-8000-000000000001";

/** A session whose only job is to record what the adapter asked for. */
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
  return {
    asked,
    command: {
      id: ENTRY,
      replacementId: REPLACEMENT,
      transaction: { opaque: database },
      workspaceId: WORKSPACE,
    },
  };
}

Deno.test("[GAP-012] the sites of one section are counted together", async () => {
  const session = recorder([[{ count: 7 }]]);
  const counted = await referenceCounter({
    "contact-labels": {
      sites: [
        {
          column: "label_id",
          junctionKey: "contact_method_id",
          source: "crm.method_labels via crm.methods.contact_method_id",
        },
        {
          column: "label_id",
          junctionKey: "address_id",
          source: "crm.address_labels via crm.addresses.address_id",
        },
      ],
    },
  }).count({ ...session.command, section: "contact-labels" });
  const sql = session.asked[0]?.sql ?? "";
  assert(
    sql.includes(
      `(select count(*) from "crm"."method_labels" as "t", ` +
        `"crm"."methods" as "o1" where "o1"."id" = "t"."contact_method_id" ` +
        `and "o1"."workspace_id" = $1::uuid and "t"."label_id" = $2::uuid) + `,
    ),
    `each site is scoped and added, received ${sql}`,
  );
  assert(counted === 7, `the sum is reported, received ${counted}`);
});

Deno.test("[GAP-012] an owned site is rewritten through its owner", async () => {
  const session = recorder();
  const outcome = await referenceCounter({
    "pet-categories": {
      sites: [{
        column: "category_id",
        source: "crm.pets via crm.people.person_id",
      }],
    },
  }).replace({ ...session.command, section: "pet-categories" });
  assert(outcome === "replaced", `the rewrite succeeds, received ${outcome}`);
  assert(session.asked.length === 1, "one site is one statement");
  assert(
    session.asked[0]?.sql ===
      `update "crm"."pets" as "t" set "category_id" = $1::uuid, ` +
        `"updated_at" = now() from "crm"."people" as "o1" ` +
        `where "o1"."id" = "t"."person_id" and "o1"."workspace_id" = $2::uuid ` +
        `and "t"."category_id" = $3::uuid`,
    `the rewrite touches updated_at, received ${session.asked[0]?.sql}`,
  );
  assert(
    JSON.stringify(session.asked[0]?.parameters) ===
      JSON.stringify([REPLACEMENT, WORKSPACE, ENTRY]),
    `the replacement is bound first, received ${
      JSON.stringify(session.asked[0]?.parameters)
    }`,
  );
});

Deno.test("[GAP-012] a junction is re-pointed by insert and delete", async () => {
  const session = recorder();
  await referenceCounter({
    only: {
      sites: [{
        column: "label_id",
        junctionKey: "contact_method_id",
        source: "crm.method_labels via crm.methods.contact_method_id",
      }],
    },
  }).replace({ ...session.command, section: "only" });
  assert(session.asked.length === 2, "a junction costs two statements");
  assert(
    session.asked[0]?.sql.startsWith(
      `insert into "crm"."method_labels" ("contact_method_id", "label_id") ` +
        `select "t"."contact_method_id", $1::uuid`,
    ) && session.asked[0]?.sql.endsWith("on conflict do nothing"),
    `the replacement rows are added first, received ${session.asked[0]?.sql}`,
  );
  assert(
    session.asked[1]?.sql.startsWith(
      `delete from "crm"."method_labels" as "t" using "crm"."methods" as "o1"`,
    ),
    `the originals are then removed, received ${session.asked[1]?.sql}`,
  );
  assert(
    !session.asked.some((query) => query.sql.includes("updated_at")),
    "a junction row has no updated_at to touch",
  );
});

Deno.test("[GAP-012] a counted site is never rewritten", async () => {
  const session = recorder([[{ count: 3 }]]);
  const counter = referenceCounter({
    "emotion-options": {
      sites: [{
        column: "emotion_id",
        countOnly: true,
        source: "crm.activity_emotions via crm.activities.activity_id",
      }],
    },
  });
  const command = { ...session.command, section: "emotion-options" };
  assert(await counter.count(command) === 3, "the references are reported");
  assert(
    await counter.replace(command) === "replaced",
    "the rewrite reports success",
  );
  assert(session.asked.length === 1, "only the count reached the database");
});

Deno.test("[GAP-012] a composite key refuses a colliding replacement", async () => {
  const collision = [
    { groupKey: "p1", included: true, value: ENTRY },
    { groupKey: "p1", included: true, value: REPLACEMENT },
  ];
  const session = recorder([collision]);
  const counter = referenceCounter({
    "contact-method-types": {
      conflict: { keyColumns: ["person_id"], whenTrue: "is_primary" },
      sites: [{
        column: "type_id",
        source: "crm.methods via crm.people.person_id",
      }],
    },
  });
  const command = { ...session.command, section: "contact-method-types" };
  assert(
    await counter.replace(command) === "conflict",
    "a group holding both entries is a conflict",
  );
  assert(session.asked.length === 1, "nothing is rewritten after a conflict");
  const sql = session.asked[0]?.sql ?? "";
  assert(
    sql.includes(`concat_ws(':', "t"."person_id"::text) as "groupKey"`) &&
      sql.includes(`"t"."is_primary" as "included"`),
    `the key and the filter are projected, received ${sql}`,
  );
  assert(
    sql.includes(
      `order by "t"."person_id", "t"."id" for update of "t"`,
    ),
    `the affected rows are locked in key order, received ${sql}`,
  );
});

Deno.test("[GAP-012] only the rows the filter admits can collide", async () => {
  const session = recorder([[
    { groupKey: "p1", included: false, value: ENTRY },
    { groupKey: "p1", included: true, value: REPLACEMENT },
    { groupKey: "p2", included: true, value: ENTRY },
  ]]);
  const outcome = await referenceCounter({
    "contact-method-types": {
      conflict: { keyColumns: ["person_id"], whenTrue: "is_primary" },
      sites: [{ column: "type_id", source: "crm.methods" }],
    },
  }).replace({ ...session.command, section: "contact-method-types" });
  assert(
    outcome === "replaced",
    `a filtered-out row cannot collide, received ${outcome}`,
  );
  assert(session.asked.length === 2, "the rewrite followed the lock");
});

Deno.test("[GAP-012] a section without a filter locks every affected row", async () => {
  const session = recorder([[]]);
  await referenceCounter({
    "relationship-types": {
      conflict: { keyColumns: ["from_person_id", "to_person_id"] },
      sites: [{ column: "relationship_type_id", source: "crm.relationships" }],
    },
  }).replace({ ...session.command, section: "relationship-types" });
  const sql = session.asked[0]?.sql ?? "";
  assert(
    sql.includes(
      `concat_ws(':', "t"."from_person_id"::text, "t"."to_person_id"::text)`,
    ),
    `every key column joins the group key, received ${sql}`,
  );
  assert(
    sql.includes('true as "included"'),
    `an unfiltered section admits every row, received ${sql}`,
  );
  assert(
    sql.includes(
      `order by "t"."from_person_id", "t"."to_person_id", "t"."id"`,
    ),
    `the lock order ends at the row identity, received ${sql}`,
  );
});

Deno.test("[GAP-012] a module with one section is asked without one", async () => {
  const session = recorder([[{ count: 4 }]]);
  const counter = referenceCounter({
    "life-event-types": {
      sites: [{ column: "life_event_type_id", source: "crm.life_events" }],
    },
  });
  const { replacementId: _, ...command } = session.command;
  assert(
    await counter.count(command) === 4,
    "the only section answers a sectionless command",
  );
  assert(
    session.asked[0]?.sql.includes(`"crm"."life_events"`),
    `the only section's site is counted, received ${session.asked[0]?.sql}`,
  );
});

Deno.test("[GAP-012] an unknown section of a several-section module is inert", async () => {
  const session = recorder();
  const counter = referenceCounter({
    a: { sites: [{ column: "a_id", source: "crm.a" }] },
    b: { sites: [{ column: "b_id", source: "crm.b" }] },
  });
  assert(
    await counter.count({ ...session.command, section: "c" }) === 0,
    "an unknown section references nothing",
  );
  assert(
    await counter.replace({ ...session.command, section: "c" }) === "replaced",
    "an unknown section rewrites nothing",
  );
  assert(session.asked.length === 0, "the database was never asked");
});

Deno.test("[GAP-012] a malformed site fails when the module is imported", () => {
  try {
    referenceCounter({ a: { sites: [{ column: "x", source: "people" }] } });
  } catch {
    return;
  }
  throw new Error("a site whose table carries no schema was accepted");
});
