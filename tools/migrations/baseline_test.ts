import {
  canonicalTableNames,
  decideSchemaAction,
  verifyArtifactChecksum,
  verifyBaselineShape,
} from "./baseline.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("schema v9 migration classifies only exact empty and v1-v9 states", () => {
  assert(
    decideSchemaAction({ crmSchemaExists: false, state: "empty" }) ===
      "apply-v9",
    "empty target applies the full v9 schema",
  );
  for (
    const version of ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"] as const
  ) {
    assert(
      decideSchemaAction({ crmSchemaExists: true, state: version }) ===
        `upgrade-${version}-to-v9`,
      `exact ${version} target upgrades`,
    );
  }
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v9" }) ===
      "verify-v9",
    "exact v9 target verifies idempotently",
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

Deno.test("schema v9 specification reports its exact canonical metrics", async () => {
  const specification = await Deno.readTextFile(
    "personal-crm-schema/v9/personal_crm_schema_spec_v9.md",
  );
  assert(
    specification.includes("SQL tables parsed: **90**") &&
      specification.includes("SQL columns parsed: **850**") &&
      specification.includes("Explicit indexes: **154**"),
    "v9 specification metrics drifted from canonical SQL and validation JSON",
  );
  const sql = await Deno.readTextFile(
    "personal-crm-schema/v9/personal_crm_schema_v9.sql",
  );
  assert(
    sql.includes("'transactional-failure'") &&
      specification.includes("`transactional-failure`"),
    "v9 omits the redacted post-rollback lifecycle outcome",
  );
  assert(
    sql.includes("reminder_delivery text NOT NULL DEFAULT 'in_app'") &&
      sql.includes(
        "CHECK (reminder_delivery IN ('in_app', 'email', 'both'))",
      ) &&
      sql.includes("  digest_time time,\n") &&
      specification.includes("`reminder_delivery`") &&
      specification.includes("`digest_time`"),
    "v9 omits the member reminder-delivery preferences",
  );
  assert(
    sql.includes("CREATE TABLE person_duplicate_dismissals (") &&
      sql.includes("CHECK (person_low_id < person_high_id)") &&
      sql.includes(
        "FOREIGN KEY (workspace_id, person_low_id) REFERENCES people(workspace_id, id) ON DELETE CASCADE",
      ) &&
      sql.includes(
        "FOREIGN KEY (workspace_id, person_high_id) REFERENCES people(workspace_id, id) ON DELETE CASCADE",
      ) &&
      specification.includes("### `person_duplicate_dismissals`"),
    "v9 omits the workspace-shared duplicate dismissals",
  );
  for (
    const index of [
      "notes_search_idx ON notes USING gin (to_tsvector('simple', body))",
      "activities_search_idx ON activities USING gin (to_tsvector('simple', summary || ' ' || coalesce(description, '')))",
      "journal_posts_search_idx ON journal_posts USING gin (to_tsvector('simple', coalesce(title, '') || ' ' || body))",
      "tasks_search_idx ON tasks USING gin (to_tsvector('simple', title || ' ' || coalesce(description, '')))",
    ]
  ) {
    assert(
      sql.includes(`CREATE INDEX ${index};`) &&
        specification.includes(`CREATE INDEX ${index};`),
      `v9 omits ${index}`,
    );
  }
});
