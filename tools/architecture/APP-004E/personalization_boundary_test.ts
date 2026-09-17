function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("APP-004E personalization adapters keep table ownership boundaries", async () => {
  const tag = await Deno.readTextFile(
    "packages/backend/modules/people/adapters/postgres/tag_personalization.ts",
  );
  assert(
    !tag.includes("modules/workspaces"),
    "People adapter cannot import Workspaces",
  );
  assert(
    !/crm\.(?:workspace_members|workspaces)/.test(tag),
    "People adapter cannot authorize with Workspaces tables",
  );
  const tagTables = [...tag.matchAll(/crm\.([a-z_]+)/g)].map((match) =>
    match[1]
  );
  assert(
    tagTables.every((table) => table === "tags" || table === "person_tags"),
    "tag personalization queries only People-owned tags and person_tags",
  );

  const workspace = await Deno.readTextFile(
    "packages/backend/modules/workspaces/adapters/postgres/personalization.ts",
  );
  assert(
    !/crm\.(?:people|relationships|activities|life_events|reminder_rules)/.test(
      workspace,
    ),
    "Workspaces adapter cannot query cross-owned reference or Planning tables",
  );

  const planning = await Deno.readTextFile(
    "packages/backend/modules/planning/adapters/postgres/reminder_rule_personalization.ts",
  );
  const planningTables = [...planning.matchAll(/crm\.([a-z_]+)/g)].map((
    match,
  ) => match[1]);
  assert(
    planningTables.length > 0 &&
      planningTables.every((table) => table === "reminder_rules"),
    "Planning reminder facade queries only reminder_rules",
  );

  const router = await Deno.readTextFile(
    "apps/api/personalization_router.ts",
  );
  assert(
    router.indexOf("workspace.authorize(command)") <
      router.indexOf("routed(command.section).list"),
    "active Workspaces authorization precedes routed module list access",
  );
});
