import postgres from "postgres";

export type BaselineAction = "apply" | "reject" | "verify";

const CANONICAL_SQL_SHA256 =
  "3d082df6641ddeea9706adee39b41b90656709979a5f980cc93a7d98d1a79e91";

export function canonicalTableNames(sqlText: string): string[] {
  return Array.from(
    sqlText.matchAll(
      /\bCREATE\s+TABLE\s+(?:crm\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi,
    ),
    (match) => match[1]?.toLowerCase(),
  ).filter((name): name is string => name !== undefined).sort();
}

export function decideBaselineAction(state: {
  readonly crmSchemaExists: boolean;
  readonly crmTableCount: number;
}): BaselineAction {
  if (!state.crmSchemaExists && state.crmTableCount === 0) return "apply";
  if (state.crmSchemaExists && state.crmTableCount === 87) return "verify";
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

interface TableRow {
  readonly table_name: string;
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
  const columns = await transaction<CatalogRow[]>`
    select 'column'::text kind, c.relname::text table_name,
      a.attnum::int position, a.attname::text name,
      (format_type(a.atttypid, a.atttypmod) || '|not_null=' || a.attnotnull ||
        '|default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), ''))::text definition
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
    where n.nspname = ${schema} and c.relkind = 'r'
  `;
  const constraints = await transaction<CatalogRow[]>`
    select 'constraint'::text kind, c.relname::text table_name,
      0::int position, con.conname::text name,
      (con.contype::text || '|' || pg_get_constraintdef(con.oid, true))::text definition
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = ${schema} and c.relkind = 'r'
  `;
  const indexes = await transaction<CatalogRow[]>`
    select 'index'::text kind, table_class.relname::text table_name,
      0::int position, index_class.relname::text name,
      pg_get_indexdef(index_class.oid)::text definition
    from pg_index i
    join pg_class table_class on table_class.oid = i.indrelid
    join pg_namespace n on n.oid = table_class.relnamespace
    join pg_class index_class on index_class.oid = i.indexrelid
    where n.nspname = ${schema} and table_class.relkind = 'r'
  `;
  return [...columns, ...constraints, ...indexes].map((row) =>
    [
      row.kind,
      row.table_name,
      row.position,
      row.name,
      normalizeDefinition(row.definition, schema),
    ].join("|")
  ).sort();
}

export async function applyCanonicalBaseline(
  databaseUrl: string,
  sqlText: string,
): Promise<BaselineAction> {
  if (await sha256(sqlText) !== CANONICAL_SQL_SHA256) {
    throw new Error(
      "Canonical SQL artifact hash does not match the accepted bundle.",
    );
  }
  const expectedTables = canonicalTableNames(sqlText);
  if (expectedTables.length !== 87) {
    throw new Error(
      "Canonical SQL does not contain the audited table catalog.",
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
      const action = decideBaselineAction({
        crmSchemaExists: state.crm_schema_exists,
        crmTableCount: state.crm_table_count,
      });
      if (action === "reject") {
        throw new Error("Refusing ambiguous or drifted database state.");
      }
      if (action === "apply") await transaction.unsafe(sqlText);
      const tables = await transaction<TableRow[]>`
        select table_name from information_schema.tables
        where table_schema = 'crm' and table_type = 'BASE TABLE'
        order by table_name
      `;
      if (
        !verifyBaselineShape(
          tables.map((row) => row.table_name),
          expectedTables,
        )
      ) {
        throw new Error("Canonical baseline verification failed.");
      }
      const expectedSchema = `kinship_expected_${
        crypto.randomUUID().replaceAll("-", "")
      }`;
      await transaction.unsafe(canonicalSqlForSchema(sqlText, expectedSchema));
      await transaction`set local search_path = public`;
      const [actualStructure, expectedStructure] = await Promise.all([
        catalogStructure(transaction, "crm"),
        catalogStructure(transaction, expectedSchema),
      ]);
      if (
        actualStructure.length !== expectedStructure.length ||
        actualStructure.some((item, index) => item !== expectedStructure[index])
      ) {
        throw new Error("Canonical baseline structural verification failed.");
      }
      await transaction.unsafe(`drop schema ${expectedSchema} cascade`);
      return action;
    });
  } finally {
    await client.end({ timeout: 2 });
  }
}
