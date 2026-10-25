import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from "kysely";
import type { Database } from "./database.ts";
import { nameMatchSql } from "./name_match.ts";
import { assert, assertEquals } from "../../testing/assert.ts";

const database = new Kysely<Database>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

const compiled = (match: ReturnType<typeof nameMatchSql>) =>
  sql`select ${match}`.compile(database);

Deno.test("[SEARCH-001] without forms a name matches the query as typed alone", () => {
  const query = compiled(nameMatchSql(sql`person.name`, "Ada", [], []));
  assertEquals(
    query.sql,
    "select strpos(lower(person.name), lower($1::text)) > 0",
  );
  assertEquals(query.parameters, ["Ada"]);
});

Deno.test("[SEARCH-001] each fold step and form is a bound parameter, in order", () => {
  const query = compiled(
    nameMatchSql(sql`person.name`, "'; drop table x; --", ["elena", "o'k"], [
      ["е", "e"],
      ["'", "''"],
    ]),
  );
  assertEquals(
    query.sql,
    "select (strpos(lower(person.name), lower($1::text)) > 0 or exists (" +
      "select 1 from unnest($2::text[]) form where strpos(" +
      "replace(replace(lower(person.name), $3::text, $4::text), $5::text, " +
      "$6::text), form) > 0))",
  );
  assertEquals(query.parameters, [
    "'; drop table x; --",
    ["elena", "o'k"],
    "е",
    "e",
    "'",
    "''",
  ]);
  assert(!query.sql.includes("drop"), "nothing the caller passes is SQL");
});
