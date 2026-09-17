import { buildPostgresUrl, resolveDatabaseUrl } from "./config.ts";
import { assert } from "../../testing/assert.ts";

function environment(
  values: Readonly<Record<string, string>>,
): { readonly get: (name: string) => string | undefined } {
  return { get: (name) => values[name] };
}

Deno.test("PostgreSQL URL builder encodes credentials and database names", () => {
  const url = buildPostgresUrl({
    database: "circle/db%",
    host: "127.0.0.1",
    password: "p@ss:/%word",
    port: 55432,
    user: "owner@local",
  });
  assert(
    url ===
      "postgresql://owner%40local:p%40ss%3A%2F%25word@127.0.0.1:55432/circle%2Fdb%25",
    `reserved connection fields must be percent encoded, received ${url}`,
  );
});

Deno.test("database configuration supports URL precedence and PG fields", () => {
  assert(
    resolveDatabaseUrl(environment({
      DATABASE_URL: "postgres://direct:encoded@database/direct",
      PGHOST: "ignored",
    })) === "postgres://direct:encoded@database/direct",
    "explicit DATABASE_URL retains precedence",
  );
  assert(
    resolveDatabaseUrl(environment({})) === undefined,
    "an unconfigured public-only process remains supported",
  );
  assert(
    resolveDatabaseUrl(environment({
      PGDATABASE: "kinship/custom",
      PGHOST: "postgres",
      PGPASSWORD: "secret@:/%",
      PGPORT: "5432",
      PGUSER: "kinship-owner",
    })) ===
      "postgresql://kinship-owner:secret%40%3A%2F%25@postgres:5432/kinship%2Fcustom",
    "individual PG fields use the shared safe URL builder",
  );
});

Deno.test("partial or malformed PostgreSQL fields fail closed without secrets", () => {
  for (
    const values of [
      { PGHOST: "postgres" },
      {
        PGDATABASE: "kinship",
        PGHOST: "postgres",
        PGPASSWORD: "private-value",
        PGPORT: "NaN",
        PGUSER: "kinship",
      },
      {
        PGDATABASE: "kinship",
        PGHOST: "user@postgres",
        PGPASSWORD: "private-value",
        PGUSER: "kinship",
      },
    ]
  ) {
    let error: unknown;
    try {
      resolveDatabaseUrl(environment(values));
    } catch (caught) {
      error = caught;
    }
    assert(error instanceof Error, "malformed PG fields must fail startup");
    assert(
      !error.message.includes("private-value"),
      "configuration errors must redact secret material",
    );
  }
});
