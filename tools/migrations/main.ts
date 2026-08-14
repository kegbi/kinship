import { applyCanonicalBaseline } from "./baseline.ts";
import { resolveDatabaseUrl } from "../../packages/backend/platform/postgres/config.ts";

const schemaPath = new URL(
  "../../personal-crm-schema/v1/personal_crm_rewrite_schema_v3.sql",
  import.meta.url,
);

if (import.meta.main) {
  const databaseUrl = resolveDatabaseUrl(Deno.env);
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL or complete PG connection fields are required",
    );
  }
  const sqlText = await Deno.readTextFile(schemaPath);
  const action = await applyCanonicalBaseline(databaseUrl, sqlText);
  console.log(`Canonical schema baseline: ${action}`);
}
