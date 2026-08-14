import postgres from "postgres";

export type SchemaAction =
  | "apply-v2"
  | "reject"
  | "upgrade-v1-to-v2"
  | "verify-v2";

export const V1_SQL_SHA256 =
  "3d082df6641ddeea9706adee39b41b90656709979a5f980cc93a7d98d1a79e91";
export const V2_SQL_SHA256 =
  "0bb1375b65948a90c20d1c7f86dc4c14cf13dfd390865864ecd83082c2b10f62";
export const V1_TO_V2_MIGRATION_SHA256 =
  "6483b51b4d432a265087ccc8e7045dfb42b22b2d0dc5b0e5da548b1966a3cef5";

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
  readonly state: "drift" | "empty" | "v1" | "v2";
}): SchemaAction {
  if (!state.crmSchemaExists && state.state === "empty") return "apply-v2";
  if (state.crmSchemaExists && state.state === "v1") {
    return "upgrade-v1-to-v2";
  }
  if (state.crmSchemaExists && state.state === "v2") return "verify-v2";
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

export interface CanonicalSchemaArtifacts {
  readonly migrationV1ToV2: string;
  readonly v1Sql: string;
  readonly v2Sql: string;
}

export async function applyCanonicalSchema(
  databaseUrl: string,
  artifacts: CanonicalSchemaArtifacts,
): Promise<Exclude<SchemaAction, "reject">> {
  await Promise.all([
    verifyArtifactChecksum(artifacts.v1Sql, V1_SQL_SHA256, "Schema v1 SQL"),
    verifyArtifactChecksum(artifacts.v2Sql, V2_SQL_SHA256, "Schema v2 SQL"),
    verifyArtifactChecksum(
      artifacts.migrationV1ToV2,
      V1_TO_V2_MIGRATION_SHA256,
      "Schema v1-to-v2 migration",
    ),
  ]);
  const expectedTables = canonicalTableNames(artifacts.v2Sql);
  if (expectedTables.length !== 87) {
    throw new Error(
      "Canonical schema v2 does not contain the accepted table catalog.",
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
      const suffix = crypto.randomUUID().replaceAll("-", "");
      const expectedV1Schema = `kinship_expected_v1_${suffix}`;
      const expectedV2Schema = `kinship_expected_v2_${suffix}`;
      await transaction.unsafe(
        canonicalSqlForSchema(artifacts.v1Sql, expectedV1Schema),
      );
      await transaction.unsafe(
        canonicalSqlForSchema(artifacts.v2Sql, expectedV2Schema),
      );
      await transaction`set local search_path = public`;
      const [actual, expectedV1, expectedV2] = await Promise.all([
        state.crm_schema_exists
          ? catalogStructure(transaction, "crm")
          : Promise.resolve([]),
        catalogStructure(transaction, expectedV1Schema),
        catalogStructure(transaction, expectedV2Schema),
      ]);
      const catalogState = !state.crm_schema_exists &&
          state.crm_table_count === 0
        ? "empty"
        : structuresMatch(actual, expectedV1)
        ? "v1"
        : structuresMatch(actual, expectedV2)
        ? "v2"
        : "drift";
      const action = decideSchemaAction({
        crmSchemaExists: state.crm_schema_exists,
        state: catalogState,
      });
      if (action === "reject") {
        throw new Error("Refusing ambiguous or drifted database state.");
      }
      if (action === "apply-v2") {
        await transaction.unsafe(artifacts.v2Sql);
      } else if (action === "upgrade-v1-to-v2") {
        await transaction.unsafe(artifacts.migrationV1ToV2);
      }
      await transaction`set local search_path = public`;
      const finalStructure = await catalogStructure(transaction, "crm");
      if (!structuresMatch(finalStructure, expectedV2)) {
        const mismatch = finalStructure.findIndex((item, index) =>
          item !== expectedV2[index]
        );
        throw new Error(
          `Canonical schema v2 structural verification failed at ${mismatch}: actual=${
            finalStructure[mismatch] ?? "<missing>"
          }; expected=${expectedV2[mismatch] ?? "<missing>"}.`,
        );
      }
      await transaction.unsafe(`drop schema ${expectedV1Schema} cascade`);
      await transaction.unsafe(`drop schema ${expectedV2Schema} cascade`);
      return action;
    });
  } finally {
    await client.end({ timeout: 2 });
  }
}
