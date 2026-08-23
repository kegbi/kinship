import {
  canonicalTableNames,
  decideSchemaAction,
  verifyArtifactChecksum,
  verifyBaselineShape,
} from "./baseline.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("schema v7 migration classifies only exact empty and v1-v7 states", () => {
  assert(
    decideSchemaAction({ crmSchemaExists: false, state: "empty" }) ===
      "apply-v7",
    "empty target applies the full v7 schema",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v1" }) ===
      "upgrade-v1-to-v7",
    "exact v1 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v2" }) ===
      "upgrade-v2-to-v7",
    "exact v2 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v3" }) ===
      "upgrade-v3-to-v7",
    "exact v3 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v4" }) ===
      "upgrade-v4-to-v7",
    "exact v4 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v5" }) ===
      "upgrade-v5-to-v7",
    "exact v5 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v6" }) ===
      "upgrade-v6-to-v7",
    "exact v6 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v7" }) ===
      "verify-v7",
    "exact v7 target verifies idempotently",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "drift" }) ===
      "reject",
    "drifted target is rejected",
  );
});

Deno.test("schema artifacts reject immutable checksum drift", async () => {
  const accepted = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("accepted"),
  );
  const checksum = Array.from(
    new Uint8Array(accepted),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  await verifyArtifactChecksum("accepted", checksum, "fixture");
  let rejected = false;
  try {
    await verifyArtifactChecksum("drifted", checksum, "fixture");
  } catch {
    rejected = true;
  }
  assert(rejected, "changed immutable migration must be rejected");
});

Deno.test("baseline verification requires the complete canonical table catalog", () => {
  const canonicalSql = [
    "CREATE TABLE crm.users (id uuid);",
    "CREATE TABLE workspaces (id uuid);",
    "CREATE TABLE audit_events (id uuid);",
  ].join("\n");
  const required = canonicalTableNames(canonicalSql);
  assert(
    verifyBaselineShape(required, required),
    "exact canonical catalog must verify",
  );
  assert(
    !verifyBaselineShape(
      ["users", "workspaces", "renamed_noncritical_table"],
      required,
    ),
    "a rename retaining the same count must fail",
  );
});

Deno.test("schema v7 specification reports its exact canonical metrics", async () => {
  const specification = await Deno.readTextFile(
    "personal-crm-schema/v7/personal_crm_schema_spec_v7.md",
  );
  assert(
    specification.includes("SQL tables parsed: **89**") &&
      specification.includes("Explicit indexes: **149**"),
    "v7 specification metrics drifted from canonical SQL and validation JSON",
  );
  const sql = await Deno.readTextFile(
    "personal-crm-schema/v7/personal_crm_schema_v7.sql",
  );
  assert(
    sql.includes("'transactional-failure'") &&
      specification.includes("`transactional-failure`"),
    "v7 omits the redacted post-rollback lifecycle outcome",
  );
});
