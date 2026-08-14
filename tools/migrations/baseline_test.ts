import {
  canonicalTableNames,
  decideBaselineAction,
  verifyBaselineShape,
} from "./baseline.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("baseline migration applies only to an empty target", () => {
  assert(
    decideBaselineAction({ crmSchemaExists: false, crmTableCount: 0 }) ===
      "apply",
    "empty target applies",
  );
  assert(
    decideBaselineAction({ crmSchemaExists: true, crmTableCount: 87 }) ===
      "verify",
    "complete target verifies",
  );
  assert(
    decideBaselineAction({ crmSchemaExists: true, crmTableCount: 2 }) ===
      "reject",
    "ambiguous target is rejected",
  );
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
