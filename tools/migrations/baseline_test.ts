import {
  canonicalTableNames,
  decideSchemaAction,
  verifyArtifactChecksum,
  verifyBaselineShape,
} from "./baseline.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("schema v8 migration classifies only exact empty and v1-v8 states", () => {
  assert(
    decideSchemaAction({ crmSchemaExists: false, state: "empty" }) ===
      "apply-v8",
    "empty target applies the full v8 schema",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v1" }) ===
      "upgrade-v1-to-v8",
    "exact v1 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v2" }) ===
      "upgrade-v2-to-v8",
    "exact v2 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v3" }) ===
      "upgrade-v3-to-v8",
    "exact v3 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v4" }) ===
      "upgrade-v4-to-v8",
    "exact v4 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v5" }) ===
      "upgrade-v5-to-v8",
    "exact v5 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v6" }) ===
      "upgrade-v6-to-v8",
    "exact v6 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v7" }) ===
      "upgrade-v7-to-v8",
    "exact v7 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v8" }) ===
      "verify-v8",
    "exact v8 target verifies idempotently",
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

Deno.test("schema v8 specification reports its exact canonical metrics", async () => {
  const specification = await Deno.readTextFile(
    "personal-crm-schema/v8/personal_crm_schema_spec_v8.md",
  );
  assert(
    specification.includes("SQL tables parsed: **89**") &&
      specification.includes("SQL columns parsed: **845**") &&
      specification.includes("Explicit indexes: **149**"),
    "v8 specification metrics drifted from canonical SQL and validation JSON",
  );
  const sql = await Deno.readTextFile(
    "personal-crm-schema/v8/personal_crm_schema_v8.sql",
  );
  assert(
    sql.includes("'transactional-failure'") &&
      specification.includes("`transactional-failure`"),
    "v8 omits the redacted post-rollback lifecycle outcome",
  );
  assert(
    sql.includes("reminder_delivery text NOT NULL DEFAULT 'in_app'") &&
      sql.includes(
        "CHECK (reminder_delivery IN ('in_app', 'email', 'both'))",
      ) &&
      sql.includes("  digest_time time,\n") &&
      specification.includes("`reminder_delivery`") &&
      specification.includes("`digest_time`"),
    "v8 omits the member reminder-delivery preferences",
  );
});
