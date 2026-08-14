function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Compose and root development pass PostgreSQL credentials as fields", async () => {
  const compose = await Deno.readTextFile(
    new URL("../compose.yaml", import.meta.url),
  );
  assert(
    !compose.includes("DATABASE_URL: postgres://"),
    "Compose must not interpolate an unescaped password into a database URL",
  );
  for (
    const field of [
      "PGHOST: postgres",
      'PGPORT: "5432"',
      "PGUSER: ${POSTGRES_USER:-kinship}",
      "PGDATABASE: ${POSTGRES_DB:-kinship}",
      "PGPASSWORD: ${POSTGRES_PASSWORD}",
    ]
  ) {
    assert(
      compose.includes(field),
      `Compose must pass the PostgreSQL field ${field}`,
    );
  }

  const developmentTool = await Deno.readTextFile(
    new URL("./dev.ts", import.meta.url),
  );
  assert(
    developmentTool.includes('configured("POSTGRES_USER")') &&
      developmentTool.includes('configured("POSTGRES_DB")'),
    "root development must consume its documented user and database",
  );
  assert(
    developmentTool.includes("PGUSER:") &&
      developmentTool.includes("PGDATABASE:") &&
      developmentTool.includes("PGPASSWORD:"),
    "root development must pass PostgreSQL credentials as separate fields",
  );
  assert(
    developmentTool.includes('DATABASE_URL: ""'),
    "root development must not inherit a conflicting ambient URL",
  );
  assert(
    !developmentTool.includes("`postgres://kinship:${postgresPassword}"),
    "root development must not build a raw password URL",
  );
});
