function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("REL-006 API coverage includes delivered Slice 7 tests", async () => {
  const manifest = JSON.parse(await Deno.readTextFile("deno.json")) as {
    readonly tasks?: Readonly<Record<string, string>>;
  };
  const coverageTask = manifest.tasks?.["test:coverage:api:direct"] ?? "";
  const deliveredTests = [
    "apps/api/gifts_test.ts",
    "packages/backend/modules/gifts/gift_management_test.ts",
    "packages/contracts/gifts_test.ts",
    "tests/integration/gifts_postgres_test.ts",
    "apps/api/imports_test.ts",
    "packages/backend/modules/import-export/import_management_test.ts",
    "tests/integration/import_postgres_test.ts",
    "apps/api/exports_test.ts",
    "packages/backend/modules/import-export/export_management_test.ts",
    "tests/integration/export_postgres_test.ts",
    "apps/api/personal_lifecycle_test.ts",
    "packages/backend/modules/workspaces/personal_lifecycle_test.ts",
    "packages/contracts/personal_lifecycle_test.ts",
    "tests/integration/personal_lifecycle_postgres_test.ts",
    "apps/api/workspace_lifecycle_test.ts",
    "apps/worker/composition_test.ts",
    "packages/backend/modules/workspaces/workspace_lifecycle_test.ts",
    "packages/contracts/workspace_lifecycle_test.ts",
  ];

  const missingTests = deliveredTests.filter((test) =>
    !coverageTask.includes(test)
  );
  assert(
    missingTests.length === 0,
    `API coverage omits delivered Slice 7 tests: ${missingTests.join(", ")}`,
  );
});
