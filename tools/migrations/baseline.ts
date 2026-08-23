import postgres from "postgres";

export type SchemaAction =
  | "apply-v7"
  | "reject"
  | "upgrade-v1-to-v7"
  | "upgrade-v2-to-v7"
  | "upgrade-v3-to-v7"
  | "upgrade-v4-to-v7"
  | "upgrade-v5-to-v7"
  | "upgrade-v6-to-v7"
  | "verify-v7";

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
    | "v7";
}): SchemaAction {
  if (!state.crmSchemaExists && state.state === "empty") return "apply-v7";
  if (state.crmSchemaExists && state.state === "v1") {
    return "upgrade-v1-to-v7";
  }
  if (state.crmSchemaExists && state.state === "v2") {
    return "upgrade-v2-to-v7";
  }
  if (state.crmSchemaExists && state.state === "v3") {
    return "upgrade-v3-to-v7";
  }
  if (state.crmSchemaExists && state.state === "v4") return "upgrade-v4-to-v7";
  if (state.crmSchemaExists && state.state === "v5") return "upgrade-v5-to-v7";
  if (state.crmSchemaExists && state.state === "v6") return "upgrade-v6-to-v7";
  if (state.crmSchemaExists && state.state === "v7") return "verify-v7";
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
    .replaceAll(/\s+/g, " ")
    .trim();
}

async function catalogStructure(
  transaction: postgres.TransactionSql,
  schema: string,
): Promise<readonly string[]> {
  const namespaces = await transaction<CatalogRow[]>`
    select 'namespace'::text kind, ''::text table_name,
      0::int position, '<schema>'::text name,
      coalesce(obj_description(n.oid, 'pg_namespace'), '')::text definition
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
        '|comment=' || coalesce(obj_description(c.oid, 'pg_class'), '')
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
        '|comment=' || coalesce(col_description(c.oid, a.attnum), ''))::text definition
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
      pg_get_functiondef(p.oid)::text definition
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
  readonly v1Sql: string;
  readonly v2Sql: string;
  readonly v3Sql: string;
  readonly v4Sql: string;
  readonly v5Sql: string;
  readonly v6Sql: string;
  readonly v7Sql: string;
}

export async function applyCanonicalSchema(
  databaseUrl: string,
  artifacts: CanonicalSchemaArtifacts,
): Promise<Exclude<SchemaAction, "reject">> {
  await Promise.all([
    verifyArtifactChecksum(artifacts.v1Sql, V1_SQL_SHA256, "Schema v1 SQL"),
    verifyArtifactChecksum(artifacts.v2Sql, V2_SQL_SHA256, "Schema v2 SQL"),
    verifyArtifactChecksum(artifacts.v3Sql, V3_SQL_SHA256, "Schema v3 SQL"),
    verifyArtifactChecksum(artifacts.v4Sql, V4_SQL_SHA256, "Schema v4 SQL"),
    verifyArtifactChecksum(artifacts.v5Sql, V5_SQL_SHA256, "Schema v5 SQL"),
    verifyArtifactChecksum(artifacts.v6Sql, V6_SQL_SHA256, "Schema v6 SQL"),
    verifyArtifactChecksum(artifacts.v7Sql, V7_SQL_SHA256, "Schema v7 SQL"),
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
  ]);
  const expectedTables = canonicalTableNames(artifacts.v7Sql);
  if (expectedTables.length !== 89) {
    throw new Error(
      "Canonical schema v7 does not contain the accepted table catalog.",
    );
  }
  const client = postgres(databaseUrl, {
    connect_timeout: 5,
    idle_timeout: 5,
    max: 1,
    onnotice: () => undefined,
    prepare: false,
  });
  try {
    const expectedCatalog = async (sqlText: string, version: string) => {
      const schema = `kinship_expected_${version}_${
        crypto.randomUUID().replaceAll("-", "")
      }`;
      return await client.begin(async (transaction) => {
        await transaction.unsafe(canonicalSqlForSchema(sqlText, schema));
        await transaction`set local search_path = public`;
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
    return await client.begin(async (transaction) => {
      await transaction`set local lock_timeout = '5s'`;
      await transaction`set local statement_timeout = '120s'`;
      await transaction`select pg_advisory_xact_lock(492337110)`;
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
        : "drift";
      const action = decideSchemaAction({
        crmSchemaExists: state.crm_schema_exists,
        state: catalogState,
      });
      if (action === "reject") {
        throw new Error("Refusing ambiguous or drifted database state.");
      }
      if (action === "apply-v7") {
        await transaction.unsafe(artifacts.v7Sql);
      } else if (action === "upgrade-v1-to-v7") {
        await transaction.unsafe(artifacts.migrationV1ToV2);
        await transaction.unsafe(artifacts.migrationV2ToV3);
        await transaction.unsafe(artifacts.migrationV3ToV4);
        await transaction.unsafe(artifacts.migrationV4ToV5);
        await transaction.unsafe(artifacts.migrationV5ToV6);
        await transaction.unsafe(artifacts.migrationV6ToV7);
      } else if (action === "upgrade-v2-to-v7") {
        await transaction.unsafe(artifacts.migrationV2ToV3);
        await transaction.unsafe(artifacts.migrationV3ToV4);
        await transaction.unsafe(artifacts.migrationV4ToV5);
        await transaction.unsafe(artifacts.migrationV5ToV6);
        await transaction.unsafe(artifacts.migrationV6ToV7);
      } else if (action === "upgrade-v3-to-v7") {
        await transaction.unsafe(artifacts.migrationV3ToV4);
        await transaction.unsafe(artifacts.migrationV4ToV5);
        await transaction.unsafe(artifacts.migrationV5ToV6);
        await transaction.unsafe(artifacts.migrationV6ToV7);
      } else if (action === "upgrade-v4-to-v7") {
        await transaction.unsafe(artifacts.migrationV4ToV5);
        await transaction.unsafe(artifacts.migrationV5ToV6);
        await transaction.unsafe(artifacts.migrationV6ToV7);
      } else if (action === "upgrade-v5-to-v7") {
        await transaction.unsafe(artifacts.migrationV5ToV6);
        await transaction.unsafe(artifacts.migrationV6ToV7);
      } else if (action === "upgrade-v6-to-v7") {
        await transaction.unsafe(artifacts.migrationV6ToV7);
      }
      await transaction`set local search_path = public`;
      const finalStructure = await catalogStructure(transaction, "crm");
      if (!structuresMatch(finalStructure, expectedV7.structure)) {
        const mismatch = finalStructure.findIndex((item, index) =>
          item !== expectedV7.structure[index]
        );
        throw new Error(
          `Canonical schema v7 structural verification failed at ${mismatch}: actual=${
            finalStructure[mismatch] ?? "<missing>"
          }; expected=${expectedV7.structure[mismatch] ?? "<missing>"}.`,
        );
      }
      const actualCurrencies = await currencyCatalog(transaction, "crm");
      if (!currencyCatalogMatches(actualCurrencies, expectedV7.currencies)) {
        throw new Error(
          "Canonical schema v7 currency reference-data verification failed.",
        );
      }
      return action;
    });
  } finally {
    await client.end({ timeout: 2 });
  }
}
