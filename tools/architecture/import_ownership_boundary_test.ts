function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("[APP-009A] import orchestration mutates domain tables only through owners", async () => {
  const repository = await Deno.readTextFile(
    new URL(
      "../../packages/backend/modules/import-export/adapters/postgres/import_repository.ts",
      import.meta.url,
    ),
  );
  for (const table of ["people", "person_avatars", "files", "audit_events"]) {
    assert(
      !new RegExp(`crm\\.${table}\\b`, "i").test(repository),
      `import repository bypasses the ${table} owner`,
    );
  }
  for (
    const path of [
      "../../packages/backend/modules/people/application/import_people_boundary.ts",
      "../../packages/backend/modules/files/application/import_file_boundary.ts",
      "../../packages/backend/modules/governance/application/import_audit.ts",
    ]
  ) {
    const source = await Deno.readTextFile(new URL(path, import.meta.url));
    assert(
      source.includes("transaction") && source.includes("Import"),
      `${path} is not a narrow transaction-aware import boundary`,
    );
  }
});
