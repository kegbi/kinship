import {
  canonicalTableNames,
  decideSchemaAction,
  verifyArtifactChecksum,
  verifyBaselineShape,
} from "./baseline.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("schema v5 migration classifies only exact empty and v1-v5 states", () => {
  assert(
    decideSchemaAction({ crmSchemaExists: false, state: "empty" }) ===
      "apply-v5",
    "empty target applies the full v5 schema",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v1" }) ===
      "upgrade-v1-to-v5",
    "exact v1 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v2" }) ===
      "upgrade-v2-to-v5",
    "exact v2 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v3" }) ===
      "upgrade-v3-to-v5",
    "exact v3 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v4" }) ===
      "upgrade-v4-to-v5",
    "exact v4 target upgrades",
  );
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v5" }) ===
      "verify-v5",
    "exact v5 target verifies idempotently",
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
