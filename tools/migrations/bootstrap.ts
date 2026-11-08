import { resolveDatabaseUrl } from "../../packages/backend/platform/postgres/config.ts";
import { bootstrapRoles, rolePasswordsFrom } from "./roles.ts";

/**
 * The one-shot bootstrap job: connects as the database superuser, the only
 * code that ever does, and creates or corrects the roles schema v14 relies on
 * (ADR 0008). The migrate job then runs as `kinship_migrator`.
 */
export async function runBootstrap(
  environment: { get(name: string): string | undefined },
): Promise<void> {
  const adminUrl = resolveDatabaseUrl(environment);
  if (!adminUrl) {
    throw new Error(
      "DATABASE_URL or complete PG connection fields are required",
    );
  }
  await bootstrapRoles(adminUrl, rolePasswordsFrom(environment));
}

if (import.meta.main) {
  await runBootstrap(Deno.env);
  console.log("Database roles: ready");
}
