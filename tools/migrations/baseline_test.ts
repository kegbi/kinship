import {
  canonicalTableNames,
  decideSchemaAction,
  verifyArtifactChecksum,
  verifyBaselineShape,
  withinRunnerTransaction,
} from "./baseline.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("schema v15 migration classifies only exact empty and v1-v15 states", () => {
  assert(
    decideSchemaAction({ crmSchemaExists: false, state: "empty" }) ===
      "apply-v15",
    "empty target applies the full v15 schema",
  );
  for (
    const version of [
      "v1",
      "v2",
      "v3",
      "v4",
      "v5",
      "v6",
      "v7",
      "v8",
      "v9",
      "v10",
      "v11",
      "v12",
      "v13",
      "v14",
    ] as const
  ) {
    assert(
      decideSchemaAction({ crmSchemaExists: true, state: version }) ===
        `upgrade-${version}-to-v15`,
      `exact ${version} target upgrades`,
    );
  }
  assert(
    decideSchemaAction({ crmSchemaExists: true, state: "v15" }) ===
      "verify-v15",
    "exact v15 target verifies idempotently",
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

Deno.test("schema v15 specification reports its exact canonical metrics", async () => {
  const specification = await Deno.readTextFile(
    "personal-crm-schema/v15/personal_crm_schema_spec_v15.md",
  );
  assert(
    specification.includes("SQL tables parsed: **92**") &&
      specification.includes("SQL columns parsed: **907**") &&
      specification.includes("Explicit indexes: **158**"),
    "v15 specification metrics drifted from canonical SQL and validation JSON",
  );
  const sql = await Deno.readTextFile(
    "personal-crm-schema/v15/personal_crm_schema_v15.sql",
  );
  assert(
    sql.includes("'transactional-failure'") &&
      specification.includes("`transactional-failure`"),
    "v13 omits the redacted post-rollback lifecycle outcome",
  );
  assert(
    sql.includes("reminder_delivery text NOT NULL DEFAULT 'in_app'") &&
      sql.includes(
        "CHECK (reminder_delivery IN ('in_app', 'email', 'both'))",
      ) &&
      sql.replaceAll("\r\n", "\n").includes("  digest_time time,\n") &&
      specification.includes("`reminder_delivery`") &&
      specification.includes("`digest_time`"),
    "v13 omits the member reminder-delivery preferences",
  );
  const deliveryComment =
    "Channels for every reminder occurrence not yet sent, including those already scheduled: in_app, email, or both; email requires a verified address.";
  const catalog = await Deno.readTextFile(
    "personal-crm-schema/v15/personal_crm_field_catalog_v15.csv",
  );
  assert(
    sql.includes(
      `COMMENT ON COLUMN member_preferences.reminder_delivery IS '${deliveryComment}';`,
    ) &&
      !sql.includes("occurrences generated from now on") &&
      catalog.includes(deliveryComment) &&
      !catalog.includes("occurrences generated from now on"),
    "v13 reminder-delivery comment does not apply to every unsent occurrence",
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
    "v13 omits the workspace-shared duplicate dismissals",
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
      `v13 omits ${index}`,
    );
  }
  assert(
    sql.includes("CREATE TABLE recurring_debts (") &&
      sql.includes(
        "CONSTRAINT recurring_debts_person_fk FOREIGN KEY (workspace_id, person_id) REFERENCES people(workspace_id, id) ON DELETE CASCADE",
      ) &&
      sql.includes(
        "CONSTRAINT recurring_debts_day_ck CHECK (day_of_month BETWEEN 1 AND 31)",
      ) &&
      sql.includes(
        "CONSTRAINT debts_recurring_occurrence_key UNIQUE (recurring_debt_id, occurrence_on)",
      ) &&
      sql.includes("ON DELETE SET NULL (recurring_debt_id)") &&
      specification.includes("### `recurring_debts`") &&
      specification.includes("debts_recurring_occurrence_key"),
    "v13 omits the recurring debt rules or their one-debt-per-period key",
  );
});

Deno.test("schema v13 declares the query indexes, the MFA challenge purpose, and the catalog seeds", async () => {
  const specification = await Deno.readTextFile(
    "personal-crm-schema/v15/personal_crm_schema_spec_v15.md",
  );
  const sql = await Deno.readTextFile(
    "personal-crm-schema/v15/personal_crm_schema_v15.sql",
  );
  for (
    const index of [
      "notes_workspace_created_idx ON notes (workspace_id, created_at DESC, id DESC)",
      "reminder_occurrences_member_feed_idx ON reminder_occurrences (member_id, date_trunc('milliseconds', visible_at AT TIME ZONE 'UTC') DESC, id DESC) WHERE channel = 'in_app' AND status = 'sent' AND visible_at IS NOT NULL",
      "reminder_occurrences_member_open_idx ON reminder_occurrences (member_id, (CASE WHEN status = 'retry' THEN next_attempt_at ELSE deliver_at END)) WHERE status IN ('pending', 'retry', 'failed', 'manual_attention')",
      // v14 (ADR 0008, Q4) rebuilds both on stored keys with v13's exact
      // expressions, so the directory and duplicate check seek them under RLS.
      "people_active_given_name_idx ON people (workspace_id, sort_given_name, sort_family_name, id) WHERE archived_at IS NULL AND deleted_at IS NULL",
      "people_active_duplicate_name_idx ON people (workspace_id, duplicate_given_name, duplicate_family_name, duplicate_nickname) WHERE archived_at IS NULL AND deleted_at IS NULL",
      "reminders_person_date_idx ON reminders (person_date_id) WHERE person_date_id IS NOT NULL",
      "reminders_life_event_idx ON reminders (life_event_id) WHERE life_event_id IS NOT NULL",
      "reminders_task_idx ON reminders (task_id) WHERE task_id IS NOT NULL",
      "api_request_logs_post_subject_idx ON api_request_logs (path, authentication_subject_digest, occurred_at DESC) WHERE method = 'POST'",
      // Kept for the member foreign key's delete cascade.
      "reminder_occurrences_member_idx ON reminder_occurrences (member_id)",
    ]
  ) {
    assert(
      sql.includes(`CREATE INDEX ${index};`) &&
        specification.includes(`CREATE INDEX ${index};`),
      `v13 omits ${index}`,
    );
  }
  for (
    const index of [
      "people_workspace_idx",
      "people_active_name_idx",
      "person_dates_person_idx",
      "api_request_logs_auth_subject_idx",
      "person_contact_methods_normalized_idx",
      "users_status_idx",
      "workspaces_status_idx",
      "workspace_members_status_idx",
      "debts_status_idx",
    ]
  ) {
    assert(
      !sql.includes(`CREATE INDEX ${index} `) &&
        !specification.includes(`CREATE INDEX ${index} `),
      `v13 still declares ${index}`,
    );
  }
  assert(
    sql.includes(
      "CHECK (purpose IN ('authenticated', 'verified-entry', 'legacy', 'mfa-challenge'))",
    ) && specification.includes("`mfa-challenge`"),
    "v13 user sessions do not admit a durable MFA challenge",
  );
  assert(
    sql.includes("  pending_workspace_name text,\n") &&
      sql.includes(
        "AND char_length(pending_workspace_name) BETWEEN 1 AND 120",
      ) &&
      specification.includes("`users.pending_workspace_name`"),
    "v13 users cannot hold a pending registration's workspace name",
  );
  assert(
    sql.includes("INSERT INTO emotion_options (name, sort_order) VALUES") &&
      sql.includes(
        "INSERT INTO pet_categories (name, is_common, sort_order) VALUES",
      ),
    "v13 does not seed the global emotion and pet catalogs",
  );
});

Deno.test("[REL-118] the runner strips exactly a file's own transaction wrapper", () => {
  const body =
    "SET LOCAL lock_timeout = '5s';\n\nDO $$\nBEGIN\n  NULL;\nEND\n$$;\n";
  assert(
    withinRunnerTransaction(`BEGIN;\n\n${body}\nCOMMIT;\n`) === `\n${body}`,
    "a leading BEGIN; and trailing COMMIT; were not stripped exactly",
  );
  assert(
    withinRunnerTransaction(body) === body,
    "a file without its own transaction was changed",
  );
  for (
    const contained of [
      "ALTER TABLE t ADD c int;\nCOMMIT;\n",
      "BEGIN;\nALTER TABLE t ADD c int;\n",
      "BEGIN;\nSELECT 1;\nCOMMIT;\nSELECT 2;\n",
      "SELECT 1;\n  rollback;\n",
      "START TRANSACTION;\nSELECT 1;\n",
    ]
  ) {
    let refused = "";
    try {
      withinRunnerTransaction(contained);
    } catch (error) {
      refused = error instanceof Error ? error.message : String(error);
    }
    assert(
      refused.startsWith("Refusing a schema file with transaction control"),
      `uncontainable transaction control was accepted: ${contained}`,
    );
  }
});
