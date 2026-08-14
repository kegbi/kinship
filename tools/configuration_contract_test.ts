function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Compose and root development pass PostgreSQL credentials as fields", async () => {
  const compose = await Deno.readTextFile(
    new URL("../compose.yaml", import.meta.url),
  );
  assert(
    compose.includes(
      "AUTH_MINIMUM_RESPONSE_MS: ${AUTH_MINIMUM_RESPONSE_MS:-250}",
    ),
    "Compose must pass the bounded authentication response floor only to the API",
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
  assert(
    compose.includes(
      "AUTH_MFA_ENCRYPTION_KEYSET: ${AUTH_MFA_ENCRYPTION_KEYSET:-}",
    ),
    "Compose must pass the private MFA encryption key only to the API",
  );
  assert(
    compose.includes(
      "AUTH_THROTTLE_SUBJECT_KEYSET: ${AUTH_THROTTLE_SUBJECT_KEYSET:-}",
    ),
    "Compose must pass the private authentication-subject key only to the API",
  );
  const example = await Deno.readTextFile(
    new URL("../.env.example", import.meta.url),
  );
  assert(
    example.includes("AUTH_MINIMUM_RESPONSE_MS=250"),
    "the environment example must document the authentication response floor",
  );
  assert(
    example.includes("AUTH_MFA_ENCRYPTION_KEYSET="),
    "the environment example must document the production MFA key name",
  );
  assert(
    example.includes("AUTH_THROTTLE_SUBJECT_KEYSET="),
    "the environment example must document the authentication-subject key name",
  );

  const developmentTool = await Deno.readTextFile(
    new URL("./dev.ts", import.meta.url),
  );
  assert(
    developmentTool.includes('configured("AUTH_MINIMUM_RESPONSE_MS")') &&
      developmentTool.includes(
        "AUTH_MINIMUM_RESPONSE_MS: authenticationResponseFloor",
      ),
    "root development must pass an explicitly configured authentication response floor to the API",
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
    developmentTool.includes('configured("AUTH_MFA_ENCRYPTION_KEYSET")') &&
      developmentTool.includes(
        "AUTH_MFA_ENCRYPTION_KEYSET: mfaEncryptionKeyset",
      ),
    "root development must pass an explicitly configured MFA key to the API",
  );
  assert(
    developmentTool.includes('configured("AUTH_THROTTLE_SUBJECT_KEYSET")') &&
      developmentTool.includes(
        "AUTH_THROTTLE_SUBJECT_KEYSET: throttleSubjectKeyset",
      ),
    "root development must pass an explicitly configured authentication-subject key to the API",
  );
  assert(
    !developmentTool.includes("`postgres://kinship:${postgresPassword}"),
    "root development must not build a raw password URL",
  );
});
