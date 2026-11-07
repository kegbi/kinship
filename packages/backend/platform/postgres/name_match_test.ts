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
    "select (strpos(lower(person.name), lower($1::text)) > 0 or " +
      "case when octet_length(lower(person.name)) = " +
      "char_length(lower(person.name)) " +
      "then replace(lower(person.name), $2::text, $3::text) " +
      "else replace(replace(lower(person.name), $4::text, $5::text), " +
      "$6::text, $7::text) end like any ($8::text[]))",
  );
  assertEquals(query.parameters, [
    "'; drop table x; --",
    "'",
    "''",
    "е",
    "e",
    "'",
    "''",
    ["%elena%", "%o'k%"],
  ]);
  assert(!query.sql.includes("drop"), "nothing the caller passes is SQL");
});

Deno.test("[SEARCH-001] AUD-Q1 a name is folded once, however many forms the query has", () => {
  const query = compiled(
    nameMatchSql(sql`person.name`, "Tktyf", ["tktif", "elena", "ksenia"], [
      ["x", "ks"],
      ["y", "i"],
    ]),
  );
  assert(
    !query.sql.includes("unnest(") && !query.sql.includes("exists"),
    `the fold is not re-evaluated for each form: ${query.sql}`,
  );
  assertEquals(query.sql.match(/replace\(/g)?.length, 2);
  assert(
    !query.sql.includes("octet_length"),
    "a fold of only ASCII steps needs no ASCII shortcut",
  );
  assertEquals(query.parameters.at(-1), ["%tktif%", "%elena%", "%ksenia%"]);
});

Deno.test("[SEARCH-001] AUD-Q1 a form's like metacharacters match only themselves", () => {
  const query = compiled(
    nameMatchSql(sql`person.name`, "a_b", ["a_b", "50%", "c\\d"], []),
  );
  assertEquals(query.parameters.at(-1), [
    "%a\\_b%",
    "%50\\%%",
    "%c\\\\d%",
  ]);
});

Deno.test("[SEARCH-001] AUD-Q1 a step that writes a non-ASCII letter keeps the whole fold for every name", () => {
  const query = compiled(
    nameMatchSql(sql`person.name`, "ae", ["ae"], [["ä", "ae"], ["a", "ä"]]),
  );
  assert(!query.sql.includes("octet_length"), query.sql);
  assertEquals(query.sql.match(/replace\(/g)?.length, 2);
});
