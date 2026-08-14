import { applyCanonicalSchema } from "./baseline.ts";
import { resolveDatabaseUrl } from "../../packages/backend/platform/postgres/config.ts";

const v1SchemaPath = new URL(
  "../../personal-crm-schema/v1/personal_crm_rewrite_schema_v3.sql",
  import.meta.url,
);
const v2SchemaPath = new URL(
  "../../personal-crm-schema/v2/personal_crm_schema_v2.sql",
  import.meta.url,
);
const migrationPath = new URL(
  "../../personal-crm-schema/v2/migrations/0002_add_authentication_subject_digest.sql",
  import.meta.url,
);

if (import.meta.main) {
  const databaseUrl = resolveDatabaseUrl(Deno.env);
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL or complete PG connection fields are required",
    );
  }
  const action = await applyCanonicalSchema(databaseUrl, {
    migrationV1ToV2: await Deno.readTextFile(migrationPath),
    v1Sql: await Deno.readTextFile(v1SchemaPath),
    v2Sql: await Deno.readTextFile(v2SchemaPath),
  });
  console.log(`Canonical schema v2: ${action}`);
}
