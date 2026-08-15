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
const v3SchemaPath = new URL(
  "../../personal-crm-schema/v3/personal_crm_schema_v3.sql",
  import.meta.url,
);
const v4SchemaPath = new URL(
  "../../personal-crm-schema/v4/personal_crm_schema_v4.sql",
  import.meta.url,
);
const migrationPath = new URL(
  "../../personal-crm-schema/v2/migrations/0002_add_authentication_subject_digest.sql",
  import.meta.url,
);
const migrationV2ToV3Path = new URL(
  "../../personal-crm-schema/v3/migrations/0003_add_user_session_purpose.sql",
  import.meta.url,
);
const migrationV3ToV4Path = new URL(
  "../../personal-crm-schema/v4/migrations/0004_seed_iso_4217_currencies.sql",
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
    migrationV2ToV3: await Deno.readTextFile(migrationV2ToV3Path),
    migrationV3ToV4: await Deno.readTextFile(migrationV3ToV4Path),
    v1Sql: await Deno.readTextFile(v1SchemaPath),
    v2Sql: await Deno.readTextFile(v2SchemaPath),
    v3Sql: await Deno.readTextFile(v3SchemaPath),
    v4Sql: await Deno.readTextFile(v4SchemaPath),
  });
  console.log(`Canonical schema v4: ${action}`);
}
