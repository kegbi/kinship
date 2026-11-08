import {
  applyCanonicalSchema,
  type CanonicalSchemaArtifacts,
  type SchemaAction,
} from "./baseline.ts";
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
const v5SchemaPath = new URL(
  "../../personal-crm-schema/v5/personal_crm_schema_v5.sql",
  import.meta.url,
);
const v6SchemaPath = new URL(
  "../../personal-crm-schema/v6/personal_crm_schema_v6.sql",
  import.meta.url,
);
const v7SchemaPath = new URL(
  "../../personal-crm-schema/v7/personal_crm_schema_v7.sql",
  import.meta.url,
);
const v8SchemaPath = new URL(
  "../../personal-crm-schema/v8/personal_crm_schema_v8.sql",
  import.meta.url,
);
const v9SchemaPath = new URL(
  "../../personal-crm-schema/v9/personal_crm_schema_v9.sql",
  import.meta.url,
);
const v10SchemaPath = new URL(
  "../../personal-crm-schema/v10/personal_crm_schema_v10.sql",
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
const migrationV4ToV5Path = new URL(
  "../../personal-crm-schema/v5/migrations/0005_add_person_date_year_approximation.sql",
  import.meta.url,
);
const migrationV5ToV6Path = new URL(
  "../../personal-crm-schema/v6/migrations/0006_add_durable_reminder_delivery.sql",
  import.meta.url,
);
const migrationV6ToV7Path = new URL(
  "../../personal-crm-schema/v7/migrations/0007_add_workspace_deletion_records.sql",
  import.meta.url,
);
const migrationV7ToV8Path = new URL(
  "../../personal-crm-schema/v8/migrations/0008_add_member_reminder_delivery.sql",
  import.meta.url,
);

const migrationV8ToV9Path = new URL(
  "../../personal-crm-schema/v9/migrations/0009_add_search_indexes_and_duplicate_dismissals.sql",
  import.meta.url,
);

const migrationV9ToV10Path = new URL(
  "../../personal-crm-schema/v10/migrations/0010_add_recurring_debts.sql",
  import.meta.url,
);

/** Reads every immutable schema artifact the runner verifies and applies. */
export async function readCanonicalArtifacts(): Promise<
  CanonicalSchemaArtifacts
> {
  return {
    v13Sql: await Deno.readTextFile(
      new URL(
        "../../personal-crm-schema/v13/personal_crm_schema_v13.sql",
        import.meta.url,
      ),
    ),
    migrationV12ToV13: await Deno.readTextFile(
      new URL(
        "../../personal-crm-schema/v13/migrations/0013_index_queries_and_seed_catalogs.sql",
        import.meta.url,
      ),
    ),
    v12Sql: await Deno.readTextFile(
      new URL(
        "../../personal-crm-schema/v12/personal_crm_schema_v12.sql",
        import.meta.url,
      ),
    ),
    migrationV11ToV12: await Deno.readTextFile(
      new URL(
        "../../personal-crm-schema/v12/migrations/0012_reword_member_reminder_delivery_comment.sql",
        import.meta.url,
      ),
    ),
    v11Sql: await Deno.readTextFile(
      new URL(
        "../../personal-crm-schema/v11/personal_crm_schema_v11.sql",
        import.meta.url,
      ),
    ),
    migrationV10ToV11: await Deno.readTextFile(
      new URL(
        "../../personal-crm-schema/v11/migrations/0011_add_debt_settlements.sql",
        import.meta.url,
      ),
    ),
    migrationV1ToV2: await Deno.readTextFile(migrationPath),
    migrationV2ToV3: await Deno.readTextFile(migrationV2ToV3Path),
    migrationV3ToV4: await Deno.readTextFile(migrationV3ToV4Path),
    migrationV4ToV5: await Deno.readTextFile(migrationV4ToV5Path),
    migrationV5ToV6: await Deno.readTextFile(migrationV5ToV6Path),
    migrationV6ToV7: await Deno.readTextFile(migrationV6ToV7Path),
    migrationV7ToV8: await Deno.readTextFile(migrationV7ToV8Path),
    migrationV8ToV9: await Deno.readTextFile(migrationV8ToV9Path),
    migrationV9ToV10: await Deno.readTextFile(migrationV9ToV10Path),
    v1Sql: await Deno.readTextFile(v1SchemaPath),
    v2Sql: await Deno.readTextFile(v2SchemaPath),
    v3Sql: await Deno.readTextFile(v3SchemaPath),
    v4Sql: await Deno.readTextFile(v4SchemaPath),
    v5Sql: await Deno.readTextFile(v5SchemaPath),
    v6Sql: await Deno.readTextFile(v6SchemaPath),
    v7Sql: await Deno.readTextFile(v7SchemaPath),
    v8Sql: await Deno.readTextFile(v8SchemaPath),
    v9Sql: await Deno.readTextFile(v9SchemaPath),
    v10Sql: await Deno.readTextFile(v10SchemaPath),
  };
}

/** Brings the configured database to canonical schema v13, or refuses. */
export async function runMigration(
  environment: { get(name: string): string | undefined },
): Promise<Exclude<SchemaAction, "reject">> {
  const databaseUrl = resolveDatabaseUrl(environment);
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL or complete PG connection fields are required",
    );
  }
  return await applyCanonicalSchema(
    databaseUrl,
    await readCanonicalArtifacts(),
  );
}

if (import.meta.main) {
  console.log(`Canonical schema v13: ${await runMigration(Deno.env)}`);
}
