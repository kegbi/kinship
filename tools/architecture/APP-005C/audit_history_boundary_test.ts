function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("APP-005C audit-history composition is read-only and allowlisted", async () => {
  const repository = await Deno.readTextFile(
    "packages/backend/read-models/audit-history/adapters/postgres/audit_history_repository.ts",
  );
  assert(
    !/\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate)\b/i.test(
      repository,
    ),
    "audit-history read model contains a write statement",
  );
  const tables = [...repository.matchAll(/crm\.([a-z_]+)/g)].map((match) =>
    match[1]
  );
  const allowed = new Set([
    "audit_events",
    "people",
    "workspace_members",
    "workspaces",
  ]);
  assert(
    tables.length > 0 && tables.every((table) => table && allowed.has(table)),
    `audit-history queries non-allowlisted tables: ${tables.join(", ")}`,
  );
  const api = await Deno.readTextFile("apps/api/governance.ts");
  assert(
    !api.includes("modules/governance/adapters") &&
      !api.includes("modules/people/adapters") &&
      !api.includes("modules/workspaces/adapters"),
    "audit API bypasses the approved read-model/public boundary",
  );
});
