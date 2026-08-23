const root = new URL("../../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

Deno.test("[AUTH-005] personal lifecycle coordinates only owning public boundaries", async () => {
  const [application, identity, memberships, audit] = await Promise.all([
    read(
      "packages/backend/modules/workspaces/application/personal_lifecycle.ts",
    ),
    read(
      "packages/backend/modules/identity/adapters/postgres/personal_lifecycle.ts",
    ),
    read(
      "packages/backend/modules/workspaces/adapters/postgres/personal_lifecycle.ts",
    ),
    read(
      "packages/backend/modules/governance/adapters/postgres/personal_lifecycle_audit.ts",
    ),
  ]);

  if (
    !application.includes('from "../../identity/public.ts"') ||
    !application.includes("transaction.run") ||
    /\b(sql|crm\.)\b/.test(application)
  ) {
    throw new Error(
      "personal lifecycle must coordinate identity in one transaction without direct SQL",
    );
  }
  if (
    !/crm\.(users|user_sessions)\b/.test(identity) ||
    /crm\.(workspace_members|workspaces|audit_events)\b/.test(identity)
  ) {
    throw new Error("identity lifecycle adapter crossed its table boundary");
  }
  if (
    !/crm\.(workspace_members|workspaces)\b/.test(memberships) ||
    /crm\.(users|user_sessions|audit_events)\b/.test(memberships)
  ) {
    throw new Error("workspace lifecycle adapter crossed its table boundary");
  }
  if (
    !memberships.includes(
      "pg_advisory_xact_lock(hashtextextended(${workspaceId}, 2))",
    ) || !memberships.includes("order by wm.workspace_id")
  ) {
    throw new Error(
      "lifecycle owner counts must share the deterministic settings member lock",
    );
  }
  if (
    !/crm\.audit_events\b/.test(audit) ||
    /crm\.(users|user_sessions|workspace_members|workspaces)\b/.test(audit)
  ) {
    throw new Error("governance lifecycle adapter crossed its table boundary");
  }
});
