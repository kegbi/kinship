const WORKSPACE_CONFIGURATION =
  "packages/backend/modules/workspaces/adapters/postgres/profile_fact_configuration.ts";
const PEOPLE_ORGANIZATIONS =
  "packages/backend/modules/people/adapters/postgres/profile_fact_organizations.ts";
const PEOPLE_PUBLIC = "packages/backend/modules/people/public.ts";

Deno.test("APP-004C keeps organization queries inside the People module", async () => {
  const workspace = await Deno.readTextFile(WORKSPACE_CONFIGURATION);
  if (/crm\.organizations\b/.test(workspace)) {
    throw new Error(
      `${WORKSPACE_CONFIGURATION} must not access People-owned crm.organizations`,
    );
  }

  const [organizations, peoplePublic] = await Promise.all([
    Deno.readTextFile(PEOPLE_ORGANIZATIONS),
    Deno.readTextFile(PEOPLE_PUBLIC),
  ]);
  if (!/crm\.organizations\b/.test(organizations)) {
    throw new Error("the People-owned organization adapter must own its SQL");
  }
  if (!peoplePublic.includes("PostgresProfileFactOrganizations")) {
    throw new Error(
      "the People public entry point must export the boundary adapter",
    );
  }
});
