const schemaDirectory = new URL(
  "../../personal-crm-schema/v1/",
  import.meta.url,
);

function assertRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }
}

async function sha256(path: URL): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await Deno.readFile(path),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

Deno.test("fresh checkout bytes match every frozen schema audit hash", async () => {
  const validation: unknown = JSON.parse(
    await Deno.readTextFile(
      new URL("personal_crm_schema_v3_validation.json", schemaDirectory),
    ),
  );
  assertRecord(validation, "schema validation");
  assertRecord(validation.sha256, "schema validation hashes");

  for (const [filename, expected] of Object.entries(validation.sha256)) {
    if (typeof expected !== "string") {
      throw new Error(`Expected a SHA-256 string for ${filename}`);
    }
    const actual = await sha256(new URL(filename, schemaDirectory));
    if (actual !== expected) {
      throw new Error(
        `Audited artifact hash mismatch for ${filename}: ${actual}`,
      );
    }
  }
});
