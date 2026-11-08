import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import {
  DATABASE_TYPES_HEADER,
  DATABASE_TYPES_PATH,
  databaseTypesDrift,
  renderDatabaseTypes,
} from "./database_types.ts";
import { databaseTypesArguments } from "../tasks/run.ts";

const body = [
  "export interface CrmGifts {",
  "  name: string;",
  "}",
  "",
].join("\n");

function assertIncludes(text: string, part: string): void {
  assert(
    text.includes(part),
    `Expected ${JSON.stringify(text)} to name ${part}`,
  );
}

Deno.test("[GAP-042] the generated types open with the generator header", () => {
  const rendered = renderDatabaseTypes(`\n${body}\n\n`);
  assert(rendered.startsWith(`${DATABASE_TYPES_HEADER}\n\n`), rendered);
  assert(rendered.endsWith("}\n"), rendered);
  assertIncludes(DATABASE_TYPES_HEADER, "Do not edit.");
  assertIncludes(DATABASE_TYPES_HEADER, "personal-crm-schema/v14");
  assertEquals(renderDatabaseTypes(body), rendered);
});

Deno.test("[GAP-042] identical generated and committed types report no drift", () => {
  const rendered = renderDatabaseTypes(body);
  assertEquals(databaseTypesDrift(rendered, rendered), undefined);
});

Deno.test("[GAP-042] a changed column is drift naming the first differing line", () => {
  const generated = renderDatabaseTypes(body.replace("name", "title"));
  const drift = databaseTypesDrift(generated, renderDatabaseTypes(body));
  assert(drift, "a renamed column must be drift");
  assertIncludes(drift, `${DATABASE_TYPES_PATH} differs`);
  assertIncludes(drift, "line 4");
  assertIncludes(drift, '"  title: string;"');
  assertIncludes(drift, '"  name: string;"');
});

Deno.test("[GAP-042] a byte-level difference such as a trailing newline is drift", () => {
  const rendered = renderDatabaseTypes(body);
  const drift = databaseTypesDrift(rendered, `${rendered}\n`);
  assert(drift, "an extra newline must be drift");
  assertIncludes(drift, "<end of file>");
});

Deno.test("[GAP-042] a missing committed file is drift", () => {
  const drift = databaseTypesDrift(renderDatabaseTypes(body), undefined);
  assert(drift, "a missing file must be drift");
  assertIncludes(drift, "is missing");
});

Deno.test("[GAP-042] the drift check writes nothing and the generator writes one folder", () => {
  const check = databaseTypesArguments(true);
  assertEquals(check.at(-1), "--check");
  assert(
    !check.some((argument) => argument.startsWith("--allow-write")),
    `the drift check must not write, received ${check.join(" ")}`,
  );
  const generate = databaseTypesArguments(false);
  assert(!generate.includes("--check"), generate.join(" "));
  assert(
    generate.includes(
      `--allow-write=${
        DATABASE_TYPES_PATH.slice(0, DATABASE_TYPES_PATH.lastIndexOf("/"))
      }`,
    ),
    `the generator may write only the generated folder, received ${
      generate.join(" ")
    }`,
  );
  assert(
    check.includes("--allow-net=127.0.0.1") &&
      generate.includes("--allow-net=127.0.0.1"),
    "both forms reach only the local disposable database",
  );
});
