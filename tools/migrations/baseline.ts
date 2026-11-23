import postgres from "postgres";

export type SchemaAction =
  | "apply-v16"
  | "reject"
  | "upgrade-v1-to-v16"
  | "upgrade-v2-to-v16"
  | "upgrade-v3-to-v16"
  | "upgrade-v4-to-v16"
  | "upgrade-v5-to-v16"
  | "upgrade-v6-to-v16"
  | "upgrade-v7-to-v16"
  | "upgrade-v8-to-v16"
  | "upgrade-v9-to-v16"
  | "upgrade-v10-to-v16"
  | "upgrade-v11-to-v16"
  | "upgrade-v12-to-v16"
  | "upgrade-v13-to-v16"
  | "upgrade-v14-to-v16"
  | "upgrade-v15-to-v16"
  | "verify-v16";

export const V1_SQL_SHA256 =
  "3d082df6641ddeea9706adee39b41b90656709979a5f980cc93a7d98d1a79e91";
export const V2_SQL_SHA256 =
  "0bb1375b65948a90c20d1c7f86dc4c14cf13dfd390865864ecd83082c2b10f62";
export const V3_SQL_SHA256 =
  "e00707ac4c7f13e04f33bae98df6723b688cc09b09036c1474bfd32c2aa2e890";
export const V4_SQL_SHA256 =
  "c318b76d75dfae9307f71b1d46dfe7462017f153fdcf81eaa660ce5e36216b21";
export const V5_SQL_SHA256 =
  "ebb686b7954d0c822d31f451558d1a950f67adfcc500c715c013415e670912bf";
export const V6_SQL_SHA256 =
  "af6fe653a9c247deab6289bc42c6b5728a66802b81dae0a836e64d5a8f1ff62e";
export const V7_SQL_SHA256 =
  "5eb7fe3e32ee054528f92f943a8b6fc34ca0ee82b1c1418d46ef854a4da65b53";
export const V8_SQL_SHA256 =
  "317953463b3f8bbc59067513680c638205054260d29616d66a9ca22b664c120d";
export const V9_SQL_SHA256 =
  "d84050ffa668e5bffe41c321e1f9b65c9bfd39af3af925d17ab43476c40e7f6f";
export const V10_SQL_SHA256 =
  "1202621345c18314d0098f46e3d05f134f624ab7e08afdb7f717423ce25e3e8d";
export const V11_SQL_SHA256 =
  "ce1af92ab7b66eba326a0914a7eab72f040e8a9d78ec928b6af219b40f313e41";
export const V10_TO_V11_MIGRATION_SHA256 =
  "6fa4d95ac63696c544d8d4c5b7bbf62c9c37142349c13dd56fa042316d7c03f9";
export const V12_SQL_SHA256 =
  "fd28ae460da3242e7c062cb77f80043fee474e520808eda6fb4c0542905f3693";
export const V11_TO_V12_MIGRATION_SHA256 =
  "4146b3ed7c1f7da3523c6759e522fc0d98e80cd47b3e40f9d38fb1118153e3df";
export const V13_SQL_SHA256 =
  "5c1f1041ff031d9b046e9b314d0ba2c537524fa6ae08a78c107930567ebeb53f";
export const V12_TO_V13_MIGRATION_SHA256 =
  "7ae2931b2dcb462d4186a1ab8eca77402ec802d865b1d590fbabb28582f49cde";
export const V14_SQL_SHA256 =
  "b4bc6c5898519d598ccc2f8a0dbcbd964a73f0def8773988a9884d73d5dc76cd";
export const V13_TO_V14_MIGRATION_SHA256 =
  "f8482b75c9a743b31e79db2b4afaac1c7b138a59064473aa5cfb8cef17cb9d3e";
export const V15_SQL_SHA256 =
  "47ad4e83569f788e07800cc222a52499ca32d03ed7d7dfb23afe4147eac991ba";
export const V14_TO_V15_MIGRATION_SHA256 =
  "32bda3249d9617ba5d16d68e37156d4d1614c1471e30509deb86963bf77ddd3b";
export const V16_SQL_SHA256 =
  "b0ac841bf59a62e013360b37634af42f31c919ec3054916ca0216a6e55703a08";
export const V15_TO_V16_MIGRATION_SHA256 =
  "8c56a05d3a7e734b489f6bcaadfd0ea66574eabc9c6c6560ca8587c63f3eb529";

export const V1_TO_V2_MIGRATION_SHA256 =
  "6483b51b4d432a265087ccc8e7045dfb42b22b2d0dc5b0e5da548b1966a3cef5";
export const V2_TO_V3_MIGRATION_SHA256 =
  "0ab1477040d98eb25f2b285a643f3faf2e97bea867ff5058ce0dbc876a38a134";
export const V3_TO_V4_MIGRATION_SHA256 =
  "cf9dffcecb7baeffc0d149fe3caecb7827f6b5dca7c267ecd03d2be40659f251";
export const V4_TO_V5_MIGRATION_SHA256 =
  "c76ad9edfdd9bed20d84307fe5705d900d882893168a5d51c9cde773ccafc55d";
export const V5_TO_V6_MIGRATION_SHA256 =
  "e5a8708234672cb17720f9cf7324a0309557a2deef953ea891dc1aead53402b8";
export const V6_TO_V7_MIGRATION_SHA256 =
  "39834448226aa140cd1e2526a3177f5c3d724b2722cbd42087ed315e65ca734a";
export const V7_TO_V8_MIGRATION_SHA256 =
  "212ba83a3413ba5906b01ab6e286d9c0657f85e0f81ee659a416b24f8112af4a";
export const V8_TO_V9_MIGRATION_SHA256 =
  "e3f6e0fb18483118c5fb10269e6dacd116cb32a12906b954a525ecd5a0b34d18";
export const V9_TO_V10_MIGRATION_SHA256 =
  "184ed3f6ac670c1dfefea5e617c89df57a64435cd939d48974311777911d5b10";

/** The index of the first migration each exact-baseline upgrade applies. */
const UPGRADE_FROM: Readonly<
  Record<Exclude<SchemaAction, "apply-v16" | "reject" | "verify-v16">, number>
> = {
  "upgrade-v1-to-v16": 0,
  "upgrade-v2-to-v16": 1,
  "upgrade-v3-to-v16": 2,
  "upgrade-v4-to-v16": 3,
  "upgrade-v5-to-v16": 4,
  "upgrade-v6-to-v16": 5,
  "upgrade-v7-to-v16": 6,
  "upgrade-v8-to-v16": 7,
  "upgrade-v9-to-v16": 8,
  "upgrade-v10-to-v16": 9,
  "upgrade-v11-to-v16": 10,
  "upgrade-v12-to-v16": 11,
  "upgrade-v13-to-v16": 12,
  "upgrade-v14-to-v16": 13,
  "upgrade-v15-to-v16": 14,
};

export function canonicalTableNames(sqlText: string): string[] {
  return Array.from(
    sqlText.matchAll(
      /\bCREATE\s+TABLE\s+(?:crm\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi,
    ),
    (match) => match[1]?.toLowerCase(),
  ).filter((name): name is string => name !== undefined).sort();
}

export function decideSchemaAction(state: {
  readonly crmSchemaExists: boolean;
  readonly state:
    | "drift"
    | "empty"
    | "v1"
    | "v2"
    | "v3"
    | "v4"
    | "v5"
    | "v6"
    | "v7"
    | "v8"
    | "v9"
    | "v10"
    | "v11"
    | "v12"
    | "v13"
    | "v14"
    | "v15"
    | "v16";
}): SchemaAction {
  if (!state.crmSchemaExists && state.state === "empty") return "apply-v16";
  if (state.crmSchemaExists && state.state === "v1") {
    return "upgrade-v1-to-v16";
  }
  if (state.crmSchemaExists && state.state === "v2") {
    return "upgrade-v2-to-v16";
  }
  if (state.crmSchemaExists && state.state === "v3") {
    return "upgrade-v3-to-v16";
  }
  if (state.crmSchemaExists && state.state === "v4") return "upgrade-v4-to-v16";
  if (state.crmSchemaExists && state.state === "v5") return "upgrade-v5-to-v16";
  if (state.crmSchemaExists && state.state === "v6") return "upgrade-v6-to-v16";
  if (state.crmSchemaExists && state.state === "v7") return "upgrade-v7-to-v16";
  if (state.crmSchemaExists && state.state === "v8") return "upgrade-v8-to-v16";
  if (state.crmSchemaExists && state.state === "v9") {
    return "upgrade-v9-to-v16";
  }
  if (state.crmSchemaExists && state.state === "v10") {
    return "upgrade-v10-to-v16";
  }
  if (state.crmSchemaExists && state.state === "v11") {
    return "upgrade-v11-to-v16";
  }
  if (state.crmSchemaExists && state.state === "v12") {
    return "upgrade-v12-to-v16";
  }
  if (state.crmSchemaExists && state.state === "v13") {
    return "upgrade-v13-to-v16";
  }
  if (state.crmSchemaExists && state.state === "v14") {
    return "upgrade-v14-to-v16";
  }
  if (state.crmSchemaExists && state.state === "v15") {
    return "upgrade-v15-to-v16";
  }
  if (state.crmSchemaExists && state.state === "v16") return "verify-v16";
  return "reject";
}

export function verifyBaselineShape(
  tableNames: readonly string[],
  expectedTableNames: readonly string[],
): boolean {
  if (tableNames.length !== expectedTableNames.length) return false;
  const actual = [...tableNames].sort();
  const expected = [...expectedTableNames].sort();
  return actual.every((name, index) => name === expected[index]);
}

interface StateRow {
  readonly crm_schema_exists: boolean;
  readonly crm_table_count: number;
}

interface CatalogRow {
  readonly definition: string | null;
  readonly kind: string;
  readonly name: string;
  readonly position: number;
  readonly table_name: string;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function verifyArtifactChecksum(
  value: string,
  expected: string,
  label: string,
): Promise<void> {
  const actual = await sha256(value);
  if (actual !== expected) {
    throw new Error(
      `${label} checksum mismatch: expected ${expected}, got ${actual}.`,
    );
  }
}

function canonicalSqlForSchema(sqlText: string, schema: string): string {
  const replaced = sqlText
    .replace(
      "CREATE SCHEMA IF NOT EXISTS crm;",
      `CREATE SCHEMA ${schema};`,
    )
    .replace(
      "SET search_path = crm, public;",
      `SET search_path = ${schema}, public;`,
    );
  if (replaced === sqlText) {
    throw new Error("Canonical SQL schema preamble is not recognized.");
  }
  return replaced;
}

function normalizeDefinition(value: string | null, schema: string): string {
  return (value ?? "")
    .replaceAll(`\"${schema}\".`, "<schema>.")
    .replaceAll(`${schema}.`, "<schema>.")
    // A SECURITY DEFINER function (v14 onward) names every relation as crm.<name>,
    // also when the canonical DDL is applied into a scratch schema.
    .replaceAll("crm.", "<schema>.")
    .replaceAll(/\s+/g, " ")
    .trim();
}

// Grants compare as grantee and privilege, without the owner's own entry or
// the grantor (aclexplode), so the same schema applied by the migrator in
// production or by a superuser in a test compares equal (ADR 0008).
async function catalogStructure(
  transaction: postgres.TransactionSql,
  schema: string,
): Promise<readonly string[]> {
  const namespaces = await transaction<CatalogRow[]>`
    select 'namespace'::text kind, ''::text table_name,
      0::int position, '<schema>'::text name,
      (coalesce(obj_description(n.oid, 'pg_namespace'), '') ||
        '|acl=' || coalesce((select string_agg(case when grant_row.grantee = 0 then 'public' else grant_row.grantee::regrole::text end || '=' || grant_row.privilege_type || case when grant_row.is_grantable then '*' else '' end, ',' order by 1) from aclexplode(n.nspacl) grant_row where grant_row.grantee <> n.nspowner), ''))::text definition
    from pg_namespace n
    where n.nspname = ${schema}
  `;
  const relations = await transaction<CatalogRow[]>`
    select 'relation'::text kind, c.relkind::text table_name,
      0::int position, c.relname::text name,
      (
        'relkind=' || c.relkind::text ||
        '|persistence=' || c.relpersistence::text ||
        '|partition=' || coalesce(pg_get_partkeydef(c.oid), '') ||
        '|view=' || case when c.relkind in ('v', 'm')
          then pg_get_viewdef(c.oid, true) else '' end ||
        '|sequence=' || coalesce((
          select concat_ws(',', format_type(s.seqtypid, null), s.seqstart,
            s.seqincrement, s.seqmax, s.seqmin, s.seqcache, s.seqcycle)
          from pg_sequence s where s.seqrelid = c.oid
        ), '') ||
        '|foreign=' || coalesce((
          select fs.srvname || ':' || coalesce(
            array_to_string(ft.ftoptions, ','), ''
          )
          from pg_foreign_table ft
          join pg_foreign_server fs on fs.oid = ft.ftserver
          where ft.ftrelid = c.oid
        ), '') ||
        '|comment=' || coalesce(obj_description(c.oid, 'pg_class'), '') ||
        '|rls=' || c.relrowsecurity::text ||
        '|force_rls=' || c.relforcerowsecurity::text ||
        '|acl=' || coalesce((select string_agg(case when grant_row.grantee = 0 then 'public' else grant_row.grantee::regrole::text end || '=' || grant_row.privilege_type || case when grant_row.is_grantable then '*' else '' end, ',' order by 1) from aclexplode(c.relacl) grant_row where grant_row.grantee <> c.relowner), '')
      )::text definition
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = ${schema}
      and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  `;
  const columns = await transaction<CatalogRow[]>`
    select 'column'::text kind, c.relname::text table_name,
      a.attnum::int position, a.attname::text name,
      (format_type(a.atttypid, a.atttypmod) || '|not_null=' || a.attnotnull ||
        '|default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') ||
        '|identity=' || a.attidentity::text ||
        '|generated=' || a.attgenerated::text ||
        '|comment=' || coalesce(col_description(c.oid, a.attnum), '') ||
        '|acl=' || coalesce((select string_agg(case when grant_row.grantee = 0 then 'public' else grant_row.grantee::regrole::text end || '=' || grant_row.privilege_type || case when grant_row.is_grantable then '*' else '' end, ',' order by 1) from aclexplode(a.attacl) grant_row where grant_row.grantee <> c.relowner), ''))::text definition
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
    where n.nspname = ${schema}
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
  `;
  const constraints = await transaction<CatalogRow[]>`
    select 'constraint'::text kind, coalesce(c.relname, '')::text table_name,
      0::int position, con.conname::text name,
      (con.contype::text || '|' || pg_get_constraintdef(con.oid, true) ||
        '|deferrable=' || con.condeferrable ||
        '|deferred=' || con.condeferred ||
        '|validated=' || con.convalidated)::text definition
    from pg_constraint con
    left join pg_class c on c.oid = con.conrelid
    where con.connamespace = ${schema}::regnamespace
      and (c.oid is null or c.relkind in ('r', 'p', 'v', 'm', 'f'))
  `;
  const indexes = await transaction<CatalogRow[]>`
    select 'index'::text kind, table_class.relname::text table_name,
      0::int position, index_class.relname::text name,
      pg_get_indexdef(index_class.oid)::text definition
    from pg_index i
    join pg_class table_class on table_class.oid = i.indrelid
    join pg_namespace n on n.oid = table_class.relnamespace
    join pg_class index_class on index_class.oid = i.indexrelid
    where n.nspname = ${schema}
      and table_class.relkind in ('r', 'p', 'm')
  `;
  const routines = await transaction<CatalogRow[]>`
    select 'routine'::text kind, p.prokind::text table_name,
      0::int position,
      (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text name,
      (pg_get_functiondef(p.oid) ||
        '|owner=' || p.proowner::regrole::text ||
        '|acl=' || coalesce((select string_agg(case when grant_row.grantee = 0 then 'public' else grant_row.grantee::regrole::text end || '=' || grant_row.privilege_type || case when grant_row.is_grantable then '*' else '' end, ',' order by 1) from aclexplode(p.proacl) grant_row where grant_row.grantee <> p.proowner), '') ||
        '|comment=' || coalesce(obj_description(p.oid, 'pg_proc'), ''))::text definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = ${schema}
  `;
  const types = await transaction<CatalogRow[]>`
    select 'type'::text kind, t.typtype::text table_name,
      0::int position, t.typname::text name,
      case t.typtype
        when 'e' then 'enum=' || coalesce((
          select string_agg(e.enumlabel, ',' order by e.enumsortorder)
          from pg_enum e where e.enumtypid = t.oid
        ), '')
        when 'd' then 'domain=' || format_type(t.typbasetype, t.typtypmod) ||
          '|not_null=' || t.typnotnull ||
          '|default=' || coalesce(t.typdefault, '')
        when 'r' then 'range=' || format_type(r.rngsubtype, null) ||
          '|collation=' || r.rngcollation::text ||
          '|opclass=' || r.rngsubopc::text ||
          '|canonical=' || r.rngcanonical::text ||
          '|difference=' || r.rngsubdiff::text ||
          '|multirange=' || format_type(r.rngmultitypid, null)
        else ''
      end::text definition
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    left join pg_range r on r.rngtypid = t.oid
    where n.nspname = ${schema} and t.typtype in ('e', 'd', 'r')
  `;
  const triggers = await transaction<CatalogRow[]>`
    select 'trigger'::text kind, c.relname::text table_name,
      0::int position, t.tgname::text name,
      pg_get_triggerdef(t.oid, true)::text definition
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = ${schema} and not t.tgisinternal
  `;
  const policies = await transaction<CatalogRow[]>`
    select 'policy'::text kind, c.relname::text table_name,
      0::int position, p.polname::text name,
      (
        'command=' || p.polcmd::text ||
        '|permissive=' || p.polpermissive ||
        '|roles=' || coalesce((
          select string_agg(
            case when role_oid = 0 then 'public'
              else role_oid::regrole::text end,
            ',' order by role_oid
          )
          from unnest(p.polroles) as roles(role_oid)
        ), '') ||
        '|using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') ||
        '|check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
      )::text definition
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = ${schema}
  `;
  return [
    ...namespaces,
    ...relations,
    ...columns,
    ...constraints,
    ...indexes,
    ...routines,
    ...types,
    ...triggers,
    ...policies,
  ].map((row) =>
    [
      row.kind,
      row.table_name,
      row.position,
      row.name,
      normalizeDefinition(row.definition, schema),
    ].join("|")
  ).sort();
}

function structuresMatch(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return actual.length === expected.length &&
    actual.every((item, index) => item === expected[index]);
}

interface CurrencyCatalogRow {
  readonly code: string;
  readonly is_active: boolean;
  readonly minor_unit: number;
  readonly name: string;
}

async function currencyCatalog(
  transaction: postgres.TransactionSql,
  schema: string,
): Promise<readonly CurrencyCatalogRow[]> {
  if (!/^[a-z][a-z0-9_]+$/.test(schema)) {
    throw new Error("Invalid internal schema identifier.");
  }
  return await transaction.unsafe<CurrencyCatalogRow[]>(
    `select code::text, name, minor_unit::int, is_active
     from ${schema}.currencies order by code`,
  );
}

function currencyCatalogMatches(
  actual: readonly CurrencyCatalogRow[],
  expected: readonly CurrencyCatalogRow[],
): boolean {
  const byCode = new Map(actual.map((row) => [row.code.trim(), row]));
  return expected.length === 165 && expected.every((row) => {
    const candidate = byCode.get(row.code.trim());
    return candidate?.name === row.name &&
      candidate.minor_unit === row.minor_unit &&
      candidate.is_active === row.is_active;
  });
}

export interface CanonicalSchemaArtifacts {
  readonly migrationV1ToV2: string;
  readonly migrationV2ToV3: string;
  readonly migrationV3ToV4: string;
  readonly migrationV4ToV5: string;
  readonly migrationV5ToV6: string;
  readonly migrationV6ToV7: string;
  readonly migrationV7ToV8: string;
  readonly migrationV8ToV9: string;
  readonly migrationV9ToV10: string;
  readonly v1Sql: string;
  readonly v2Sql: string;
  readonly v3Sql: string;
  readonly v4Sql: string;
  readonly v5Sql: string;
  readonly v6Sql: string;
  readonly v7Sql: string;
  readonly v8Sql: string;
  readonly v9Sql: string;
  readonly v10Sql: string;
  readonly v11Sql: string;
  readonly migrationV10ToV11: string;
  readonly v12Sql: string;
  readonly migrationV11ToV12: string;
  readonly v13Sql: string;
  readonly migrationV12ToV13: string;
  readonly v14Sql: string;
  readonly migrationV13ToV14: string;
  readonly v15Sql: string;
  readonly migrationV14ToV15: string;
  readonly v16Sql: string;
  readonly migrationV15ToV16: string;
}

/**
 * Brings the database at `databaseUrl` to canonical schema v16, or refuses.
 * Every artifact checksum is verified before the runner connects.
 */
export async function applyCanonicalSchema(
  databaseUrl: string,
  artifacts: CanonicalSchemaArtifacts,
): Promise<Exclude<SchemaAction, "reject">> {
  await verifyCanonicalArtifacts(artifacts);
  const client = postgres(databaseUrl, {
    connect_timeout: 5,
    idle_timeout: 5,
    max: 1,
    onnotice: () => undefined,
    prepare: false,
  });
  try {
    return await migrateCanonicalSchema(client, artifacts);
  } finally {
    await client.end({ timeout: 2 });
  }
}

/**
 * Runs the same migration on a caller-owned single-connection client, so a
 * caller can observe the connection's session state afterwards. The client is
 * left open.
 */
export async function applyCanonicalSchemaWith(
  client: postgres.Sql,
  artifacts: CanonicalSchemaArtifacts,
): Promise<Exclude<SchemaAction, "reject">> {
  await verifyCanonicalArtifacts(artifacts);
  return await migrateCanonicalSchema(client, artifacts);
}

async function verifyCanonicalArtifacts(
  artifacts: CanonicalSchemaArtifacts,
): Promise<void> {
  await Promise.all([
    verifyArtifactChecksum(artifacts.v1Sql, V1_SQL_SHA256, "Schema v1 SQL"),
    verifyArtifactChecksum(artifacts.v2Sql, V2_SQL_SHA256, "Schema v2 SQL"),
    verifyArtifactChecksum(artifacts.v3Sql, V3_SQL_SHA256, "Schema v3 SQL"),
    verifyArtifactChecksum(artifacts.v4Sql, V4_SQL_SHA256, "Schema v4 SQL"),
    verifyArtifactChecksum(artifacts.v5Sql, V5_SQL_SHA256, "Schema v5 SQL"),
    verifyArtifactChecksum(artifacts.v6Sql, V6_SQL_SHA256, "Schema v6 SQL"),
    verifyArtifactChecksum(artifacts.v7Sql, V7_SQL_SHA256, "Schema v7 SQL"),
    verifyArtifactChecksum(artifacts.v8Sql, V8_SQL_SHA256, "Schema v8 SQL"),
    verifyArtifactChecksum(artifacts.v9Sql, V9_SQL_SHA256, "Schema v9 SQL"),
    verifyArtifactChecksum(artifacts.v10Sql, V10_SQL_SHA256, "Schema v10 SQL"),
    verifyArtifactChecksum(
      artifacts.migrationV1ToV2,
      V1_TO_V2_MIGRATION_SHA256,
      "Schema v1-to-v2 migration",
    ),
    verifyArtifactChecksum(
      artifacts.migrationV2ToV3,
      V2_TO_V3_MIGRATION_SHA256,
      "Schema v2-to-v3 migration",
    ),
    verifyArtifactChecksum(
      artifacts.migrationV3ToV4,
      V3_TO_V4_MIGRATION_SHA256,
      "Schema v3-to-v4 migration",
    ),
    verifyArtifactChecksum(
      artifacts.migrationV4ToV5,
      V4_TO_V5_MIGRATION_SHA256,
      "Schema v4-to-v5 migration",
    ),
    verifyArtifactChecksum(
      artifacts.migrationV5ToV6,
      V5_TO_V6_MIGRATION_SHA256,
      "Schema v5-to-v6 migration",
    ),
    verifyArtifactChecksum(
      artifacts.migrationV6ToV7,
      V6_TO_V7_MIGRATION_SHA256,
      "Schema v6-to-v7 migration",
    ),
    verifyArtifactChecksum(
      artifacts.migrationV7ToV8,
      V7_TO_V8_MIGRATION_SHA256,
      "Schema v7-to-v8 migration",
    ),
    verifyArtifactChecksum(
      artifacts.migrationV8ToV9,
      V8_TO_V9_MIGRATION_SHA256,
      "Schema v8-to-v9 migration",
    ),
    verifyArtifactChecksum(
      artifacts.migrationV9ToV10,
      V9_TO_V10_MIGRATION_SHA256,
      "Schema v9-to-v10 migration",
    ),
  ]);
  await verifyArtifactChecksum(
    artifacts.v11Sql,
    V11_SQL_SHA256,
    "Schema v11 SQL",
  );
  await verifyArtifactChecksum(
    artifacts.migrationV10ToV11,
    V10_TO_V11_MIGRATION_SHA256,
    "Schema v10-to-v11 migration",
  );
  await verifyArtifactChecksum(
    artifacts.v12Sql,
    V12_SQL_SHA256,
    "Schema v12 SQL",
  );
  await verifyArtifactChecksum(
    artifacts.migrationV11ToV12,
    V11_TO_V12_MIGRATION_SHA256,
    "Schema v11-to-v12 migration",
  );
  await verifyArtifactChecksum(
    artifacts.v13Sql,
    V13_SQL_SHA256,
    "Schema v13 SQL",
  );
  await verifyArtifactChecksum(
    artifacts.migrationV12ToV13,
    V12_TO_V13_MIGRATION_SHA256,
    "Schema v12-to-v13 migration",
  );
  await verifyArtifactChecksum(
    artifacts.v14Sql,
    V14_SQL_SHA256,
    "Schema v14 SQL",
  );
  await verifyArtifactChecksum(
    artifacts.migrationV13ToV14,
    V13_TO_V14_MIGRATION_SHA256,
    "Schema v13-to-v14 migration",
  );
  await verifyArtifactChecksum(
    artifacts.v15Sql,
    V15_SQL_SHA256,
    "Schema v15 SQL",
  );
  await verifyArtifactChecksum(
    artifacts.migrationV14ToV15,
    V14_TO_V15_MIGRATION_SHA256,
    "Schema v14-to-v15 migration",
  );
  await verifyArtifactChecksum(
    artifacts.v16Sql,
    V16_SQL_SHA256,
    "Schema v16 SQL",
  );
  await verifyArtifactChecksum(
    artifacts.migrationV15ToV16,
    V15_TO_V16_MIGRATION_SHA256,
    "Schema v15-to-v16 migration",
  );
  const expectedTables = canonicalTableNames(artifacts.v16Sql);
  if (expectedTables.length !== 93) {
    throw new Error(
      "Canonical schema v16 does not contain the accepted table catalog.",
    );
  }
}

/**
 * Migration 0004 wraps itself in `BEGIN;` ... `COMMIT;`. Sent inside the
 * runner's one transaction, that COMMIT would end it early and release the
 * advisory lock and timeouts (REL-118). The runner strips exactly a file's own
 * leading `BEGIN;` and trailing `COMMIT;` after the unmodified file's checksum
 * is verified, and refuses a file with any other top-level transaction control.
 */
export function withinRunnerTransaction(sqlText: string): string {
  const own = /^BEGIN;\n([\s\S]*)\nCOMMIT;\n?$/.exec(sqlText);
  const body = own ? own[1] ?? "" : sqlText;
  if (/^\s*(?:BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\s*;/im.test(body)) {
    throw new Error(
      "Refusing a schema file with transaction control the runner cannot contain.",
    );
  }
  return body;
}

interface SearchPathRow {
  readonly search_path: string;
}

// Canonical DDL preambles, 0011, and 0014 `SET search_path` for the session;
// inside a transaction that value outlives the commit. The runner records the
// session's path first and restores it before committing, leaving only a
// transaction-local path for its catalog reads (REL-118).
async function sessionSearchPath(
  transaction: postgres.TransactionSql,
): Promise<string> {
  const [row] = await transaction<SearchPathRow[]>`
    select current_setting('search_path') as search_path
  `;
  if (!row) throw new Error("Could not read the session search_path.");
  return row.search_path;
}

async function restoreSessionSearchPath(
  transaction: postgres.TransactionSql,
  searchPath: string,
): Promise<void> {
  await transaction`select set_config('search_path', ${searchPath}, false)`;
  await transaction`set local search_path = public`;
}

async function migrateCanonicalSchema(
  client: postgres.Sql,
  artifacts: CanonicalSchemaArtifacts,
): Promise<Exclude<SchemaAction, "reject">> {
  const expectedCatalog = async (sqlText: string, version: string) => {
    const schema = `kinship_expected_${version}_${
      crypto.randomUUID().replaceAll("-", "")
    }`;
    return await client.begin(async (transaction) => {
      const searchPath = await sessionSearchPath(transaction);
      await transaction.unsafe(canonicalSqlForSchema(sqlText, schema));
      await restoreSessionSearchPath(transaction, searchPath);
      const structure = await catalogStructure(transaction, schema);
      const currencies = await currencyCatalog(transaction, schema);
      await transaction.unsafe(`drop schema ${schema} cascade`);
      return { currencies, structure };
    });
  };
  // Build each immutable expected catalog in its own short transaction. This
  // releases relation locks between versions and keeps the production
  // verifier within PostgreSQL's default max_locks_per_transaction setting.
  const expectedV1 = await expectedCatalog(artifacts.v1Sql, "v1");
  const expectedV2 = await expectedCatalog(artifacts.v2Sql, "v2");
  const expectedV3 = await expectedCatalog(artifacts.v3Sql, "v3");
  const expectedV4 = await expectedCatalog(artifacts.v4Sql, "v4");
  const expectedV5 = await expectedCatalog(artifacts.v5Sql, "v5");
  const expectedV6 = await expectedCatalog(artifacts.v6Sql, "v6");
  const expectedV7 = await expectedCatalog(artifacts.v7Sql, "v7");
  const expectedV8 = await expectedCatalog(artifacts.v8Sql, "v8");
  const expectedV9 = await expectedCatalog(artifacts.v9Sql, "v9");
  const expectedV10 = await expectedCatalog(artifacts.v10Sql, "v10");
  const expectedV11 = await expectedCatalog(artifacts.v11Sql, "v11");
  const expectedV12 = await expectedCatalog(artifacts.v12Sql, "v12");
  const expectedV13 = await expectedCatalog(artifacts.v13Sql, "v13");
  const expectedV14 = await expectedCatalog(artifacts.v14Sql, "v14");
  const expectedV15 = await expectedCatalog(artifacts.v15Sql, "v15");
  const expectedV16 = await expectedCatalog(artifacts.v16Sql, "v16");
  return await client.begin(async (transaction) => {
    await transaction`set local lock_timeout = '5s'`;
    await transaction`set local statement_timeout = '120s'`;
    await transaction`select pg_advisory_xact_lock(492337110)`;
    const searchPath = await sessionSearchPath(transaction);
    await transaction`set local search_path = public`;
    const [state] = await transaction<StateRow[]>`
        select
          exists(select 1 from pg_namespace where nspname = 'crm') as crm_schema_exists,
          (select count(*)::int from information_schema.tables where table_schema = 'crm' and table_type = 'BASE TABLE') as crm_table_count
      `;
    if (!state) throw new Error("Could not inspect database state.");
    const actual = state.crm_schema_exists
      ? await catalogStructure(transaction, "crm")
      : [];
    const catalogState = !state.crm_schema_exists &&
        state.crm_table_count === 0
      ? "empty"
      : structuresMatch(actual, expectedV1.structure)
      ? "v1"
      : structuresMatch(actual, expectedV2.structure)
      ? "v2"
      : structuresMatch(actual, expectedV3.structure)
      ? "v3"
      : structuresMatch(actual, expectedV4.structure)
      ? "v4"
      : structuresMatch(actual, expectedV5.structure)
      ? "v5"
      : structuresMatch(actual, expectedV6.structure)
      ? "v6"
      : structuresMatch(actual, expectedV7.structure)
      ? "v7"
      : structuresMatch(actual, expectedV8.structure)
      ? "v8"
      : structuresMatch(actual, expectedV9.structure)
      ? "v9"
      : structuresMatch(actual, expectedV10.structure)
      ? "v10"
      : structuresMatch(actual, expectedV11.structure)
      ? "v11"
      : structuresMatch(actual, expectedV12.structure)
      ? "v12"
      : structuresMatch(actual, expectedV13.structure)
      ? "v13"
      : structuresMatch(actual, expectedV14.structure)
      ? "v14"
      : structuresMatch(actual, expectedV15.structure)
      ? "v15"
      : structuresMatch(actual, expectedV16.structure)
      ? "v16"
      : "drift";
    const action = decideSchemaAction({
      crmSchemaExists: state.crm_schema_exists,
      state: catalogState,
    });
    if (action === "reject") {
      throw new Error("Refusing ambiguous or drifted database state.");
    }
    const migrations = [
      artifacts.migrationV1ToV2,
      artifacts.migrationV2ToV3,
      artifacts.migrationV3ToV4,
      artifacts.migrationV4ToV5,
      artifacts.migrationV5ToV6,
      artifacts.migrationV6ToV7,
      artifacts.migrationV7ToV8,
      artifacts.migrationV8ToV9,
      artifacts.migrationV9ToV10,
      artifacts.migrationV10ToV11,
      artifacts.migrationV11ToV12,
      artifacts.migrationV12ToV13,
      artifacts.migrationV13ToV14,
      artifacts.migrationV14ToV15,
      artifacts.migrationV15ToV16,
    ];
    if (action === "apply-v16") {
      await transaction.unsafe(withinRunnerTransaction(artifacts.v16Sql));
    } else if (action !== "verify-v16") {
      // An exact vN target applies every immutable migration from vN onward,
      // all inside this one transaction.
      for (const migration of migrations.slice(UPGRADE_FROM[action])) {
        await transaction.unsafe(withinRunnerTransaction(migration));
      }
    }
    await restoreSessionSearchPath(transaction, searchPath);
    const finalStructure = await catalogStructure(transaction, "crm");
    if (!structuresMatch(finalStructure, expectedV16.structure)) {
      const mismatch = finalStructure.findIndex((item, index) =>
        item !== expectedV16.structure[index]
      );
      throw new Error(
        `Canonical schema v16 structural verification failed at ${mismatch}: actual=${
          finalStructure[mismatch] ?? "<missing>"
        }; expected=${expectedV16.structure[mismatch] ?? "<missing>"}.`,
      );
    }
    const actualCurrencies = await currencyCatalog(transaction, "crm");
    if (!currencyCatalogMatches(actualCurrencies, expectedV16.currencies)) {
      throw new Error(
        "Canonical schema v16 currency reference-data verification failed.",
      );
    }
    return action;
  });
}
