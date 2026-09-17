import { displayName, UNNAMED_PERSON } from "../../modules/people/public.ts";
import { personDisplayNameSql } from "./person_display.ts";
import { assert } from "../../testing/assert.ts";

/**
 * The SQL fragment evaluated the way PostgreSQL would evaluate it.
 *
 * The rule is small enough to model exactly — `nullif`, `concat_ws`, `trim`,
 * `coalesce` — so the test can compare the fragment's meaning with the people
 * module's function instead of comparing two hand-written strings. The two now
 * live on opposite sides of a boundary, which is exactly why they need pinning
 * together.
 */
function evaluateFragment(
  fragment: string,
  row: {
    readonly familyName: string | null;
    readonly givenName: string | null;
    readonly nickname: string | null;
  },
): string {
  const quoted = fragment.match(/'((?:[^']|'')*)'\s*\)\s*$/)?.[1];
  assert(
    quoted !== undefined,
    `the fragment must end in a quoted fallback, received ${fragment}`,
  );
  const fallback = quoted.replaceAll("''", "'");
  const nullif = (value: string | null) => value === "" ? null : value;
  const parts = [nullif(row.givenName), row.familyName].filter((value) =>
    value !== null
  );
  const formal = nullif(parts.join(" ").trim());
  return formal ?? nullif(row.nickname) ?? fallback;
}

const REPRESENTATIVE_ROWS = [
  { familyName: null, givenName: "Ada", nickname: null },
  { familyName: "Lovelace", givenName: "Ada", nickname: "Countess" },
  { familyName: "Lovelace", givenName: "", nickname: null },
  { familyName: "", givenName: "Ada", nickname: "" },
  { familyName: null, givenName: "", nickname: "Countess" },
  { familyName: "", givenName: "", nickname: "" },
  { familyName: null, givenName: null, nickname: null },
  { familyName: null, givenName: "   ", nickname: "Countess" },
] as const;

Deno.test("[GAP-010] the SQL fragment carries the people module's fallback", () => {
  const qualified = personDisplayNameSql(UNNAMED_PERSON, "person");
  const bare = personDisplayNameSql(UNNAMED_PERSON);
  for (const fragment of [qualified, bare]) {
    assert(
      fragment.split(UNNAMED_PERSON).length === 2,
      `the fragment must name the fallback exactly once, received ${fragment}`,
    );
  }
  assert(
    qualified.includes("person.given_name") &&
      qualified.includes("person.family_name") &&
      qualified.includes("person.nickname"),
    `a qualified fragment must read the aliased columns, received ${qualified}`,
  );
  assert(
    !bare.includes("."),
    `an unqualified fragment must read bare columns, received ${bare}`,
  );
  assert(
    personDisplayNameSql("O'Hara").endsWith("'O''Hara')"),
    `a quote in the fallback must be escaped, received ${
      personDisplayNameSql("O'Hara")
    }`,
  );
});

Deno.test("[GAP-010] the SQL fragment and the TypeScript rule agree", () => {
  const expected = [
    "Ada",
    "Ada Lovelace",
    "Lovelace",
    "Ada",
    "Countess",
    UNNAMED_PERSON,
    UNNAMED_PERSON,
    "Countess",
  ];
  const fragment = personDisplayNameSql(UNNAMED_PERSON, "person");
  for (const [index, row] of REPRESENTATIVE_ROWS.entries()) {
    const fromTypeScript = displayName(row);
    assert(
      fromTypeScript === expected[index],
      `row ${index} must render ${expected[index]}, received ${fromTypeScript}`,
    );
    const fromSql = evaluateFragment(fragment, row);
    assert(
      fromSql === fromTypeScript,
      `row ${index} renders ${fromSql} in SQL and ${fromTypeScript} in TypeScript`,
    );
  }
});
