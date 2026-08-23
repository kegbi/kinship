import document from "./openapi/openapi.json" with { type: "json" };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("WORKSPACE-002 contract requires a current impact and exact confirmation", () => {
  const paths = document.paths as Record<string, Record<string, unknown>>;
  assert(
    paths["/api/v1/settings/workspace-lifecycle"]?.get !== undefined,
    "impact preview operation missing",
  );
  assert(
    paths["/api/v1/settings/workspace-lifecycle"]?.delete !== undefined,
    "workspace deletion operation missing",
  );
  const deletion = paths["/api/v1/settings/workspace-lifecycle"]?.delete as {
    readonly responses?: Record<string, unknown>;
  };
  assert(
    deletion.responses?.["429"] !== undefined,
    "workspace deletion contract omits bounded step-up attempts",
  );
  assert(
    paths["/api/v1/settings/workspace-lifecycle/reset"]?.post !== undefined,
    "workspace reset operation missing",
  );
  const schemas = document.components.schemas as Record<string, {
    readonly properties?: Record<
      string,
      { readonly required?: readonly string[] }
    >;
    readonly required?: readonly string[];
  }>;
  for (const field of ["confirmation", "impactToken", "password"]) {
    assert(
      schemas.WorkspaceLifecycleConfirmation?.required?.includes(field),
      `destructive confirmation does not require ${field}`,
    );
  }
  assert(
    schemas.WorkspaceLifecyclePreview?.required?.includes("counts"),
    "preview omits current impact counts",
  );
  const impactCounts = schemas.WorkspaceLifecyclePreview?.properties?.counts
    ?.required;
  for (
    const field of [
      "activities",
      "auditEvents",
      "calls",
      "debts",
      "exports",
      "files",
      "gifts",
      "imports",
      "integrations",
      "journalPosts",
      "lifeEvents",
      "members",
      "messages",
      "notes",
      "operations",
      "people",
      "relationships",
      "reminders",
      "tasks",
    ]
  ) {
    assert(
      impactCounts?.includes(field),
      `preview impact omits delivered module count ${field}`,
    );
  }
});
