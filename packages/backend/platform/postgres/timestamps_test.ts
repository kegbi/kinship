import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type RawNode,
} from "kysely";
import type { Database } from "./database.ts";
import {
  INSTANT_FORMAT,
  instantColumn,
  instantOf,
  MILLISECOND_INSTANT_FORMAT,
  millisecondInstantColumn,
} from "./timestamps.ts";
import { assert } from "../../testing/assert.ts";

function rendered(builder: { toOperationNode(): unknown }): string {
  const node = builder.toOperationNode() as RawNode;
  assert(
    node.parameters.length === 0,
    "a timestamp projection binds no parameters",
  );
  return node.sqlFragments.join("");
}

Deno.test("[GAP-010] the instant projection is one fragment at one precision", () => {
  const sql = rendered(instantColumn("task.due_at"));
  assert(
    sql === `to_char(task.due_at at time zone 'UTC', '${INSTANT_FORMAT}')`,
    `the projection must render the shared fragment, received ${sql}`,
  );
  assert(
    INSTANT_FORMAT === `YYYY-MM-DD"T"HH24:MI:SS.US"Z"`,
    `the canonical schema stores six fractional digits, received ${INSTANT_FORMAT}`,
  );
});

Deno.test("[GAP-010] an expression may be any SQL, not only a column", () => {
  const sql = rendered(millisecondInstantColumn("max(contacted_at)"));
  assert(
    sql ===
      `to_char(max(contacted_at) at time zone 'UTC', '${MILLISECOND_INSTANT_FORMAT}')`,
    `the millisecond projection must wrap the expression whole, received ${sql}`,
  );
  assert(
    MILLISECOND_INSTANT_FORMAT === `YYYY-MM-DD"T"HH24:MI:SS.MS"Z"`,
    `the narrower format keeps three digits, received ${MILLISECOND_INSTANT_FORMAT}`,
  );
});

Deno.test("[GAP-042] a typed column renders the same instant projection", () => {
  const database = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  const compiled = database.selectFrom("crm.gifts as gift")
    .select((eb) => instantOf(eb.ref("gift.created_at")).as("created_at"))
    .compile();
  assert(
    compiled.sql ===
      `select to_char("gift"."created_at" at time zone 'UTC', '${INSTANT_FORMAT}') as "created_at" from "crm"."gifts" as "gift"`,
    `the typed projection must render the shared fragment, received ${compiled.sql}`,
  );
  assert(
    compiled.parameters.length === 0,
    "a timestamp projection binds no parameters",
  );
});
