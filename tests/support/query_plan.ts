/**
 * Query-plan scaffolding for the integration suites that assert how
 * PostgreSQL executes a repository's statement (AUD-Q1).
 *
 * A plan is only meaningful against statistics the suite controls, so
 * `withScratchCrm` gives each such suite its own database holding the
 * canonical DDL and nothing else, dropped afterwards. `explainedPlan` then
 * runs a repository unchanged and swaps the one statement it is asked about
 * for `EXPLAIN (ANALYZE, FORMAT JSON)` of that exact statement, so the plan is
 * the plan of the SQL the application sends, with its real parameters.
 *
 * Like the rest of `tests/support/`, this is test support: neither production
 * code nor a suite.
 */

import { type Kysely, type KyselyPlugin, RawNode } from "kysely";
import { openSql, requireAdminDatabaseUrl, type Sql } from "./database.ts";

/** The canonical DDL the scratch databases are created from. */
const CANONICAL_SCHEMA = "personal-crm-schema/v14/personal_crm_schema_v14.sql";

/**
 * Runs `work` on a scratch database holding the canonical DDL, created
 * through `admin` and dropped afterwards, however `work` ends. The DDL is
 * applied, and `sql` seeds, as the project's superuser; `url` names the
 * scratch database as `databaseUrl`'s role, so a repository explained there
 * runs under the same row-level security as in production (ADR 0008).
 */
export async function withScratchCrm(
  admin: Sql,
  databaseUrl: string,
  work: (scratch: { readonly sql: Sql; readonly url: string }) => Promise<void>,
): Promise<void> {
  const name = `kinship_plan_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`create database ${name}`);
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  const adminUrl = new URL(requireAdminDatabaseUrl());
  adminUrl.pathname = `/${name}`;
  const scratch = openSql(adminUrl.toString(), { max: 1, prepare: false });
  try {
    await scratch.unsafe(await Deno.readTextFile(CANONICAL_SCHEMA));
    await work({ sql: scratch, url: url.toString() });
  } finally {
    await scratch.end();
    await admin.unsafe(`drop database if exists ${name} with (force)`);
  }
}

/** One node of an `EXPLAIN (ANALYZE, FORMAT JSON)` plan. */
export interface PlanNode {
  readonly "Actual Loops"?: number;
  readonly "Actual Rows"?: number;
  readonly "Function Name"?: string;
  readonly "Index Name"?: string;
  readonly "Node Type": string;
  /** `Member` for a branch of an `Append`; `InitPlan` for a CTE; ... */
  readonly "Parent Relationship"?: string;
  readonly Plans?: readonly PlanNode[];
  readonly "Relation Name"?: string;
}

/** Every node of `plan`, depth first, the root included. */
export function planNodes(plan: PlanNode): readonly PlanNode[] {
  return [plan, ...(plan.Plans ?? []).flatMap(planNodes)];
}

/** The nodes that read `relation`, by any scan. */
export function scansOf(
  plan: PlanNode,
  relation: string,
): readonly PlanNode[] {
  return planNodes(plan).filter((node) => node["Relation Name"] === relation);
}

/**
 * The branches of every union in `plan`, one list per union: an `Append`,
 * or a `Merge Append` when each branch already reads in the union's order.
 */
export function unionBranches(
  plan: PlanNode,
): readonly (readonly PlanNode[])[] {
  return planNodes(plan).filter((node) =>
    node["Node Type"] === "Append" || node["Node Type"] === "Merge Append"
  ).map(
    (append) =>
      (append.Plans ?? []).filter((child) =>
        child["Parent Relationship"] === "Member"
      ),
  );
}

/** The rows a node produced across all of its loops. */
export function rowsProduced(node: PlanNode): number {
  return (node["Actual Rows"] ?? 0) * (node["Actual Loops"] ?? 1);
}

/** A one-line rendering of the nodes, for an assertion's message. */
export function describePlan(plan: PlanNode): string {
  return planNodes(plan).map((node) =>
    [
      node["Node Type"],
      node["Relation Name"] ? `on ${node["Relation Name"]}` : "",
      node["Index Name"] ? `using ${node["Index Name"]}` : "",
      `rows=${node["Actual Rows"]}`,
      `loops=${node["Actual Loops"]}`,
    ].filter(Boolean).join(" ")
  ).join("; ");
}

/** The SQL text of a raw statement, with the fragments composed into it. */
function rawText(node: RawNode): string {
  return [
    ...node.sqlFragments,
    ...node.parameters.flatMap((parameter) =>
      RawNode.is(parameter) ? [rawText(parameter)] : []
    ),
  ].join(" ");
}

/**
 * The executed plan of the first statement `run` sends through `database`
 * whose SQL `matches`. That statement is explained instead of answered, and
 * the repository receives `rows` in its place; every other statement runs as
 * written.
 */
export async function explainedPlan<Database>(
  database: Kysely<Database>,
  matches: (sql: string) => boolean,
  run: (database: Kysely<Database>) => Promise<unknown>,
  rows: readonly unknown[] = [],
): Promise<PlanNode> {
  const explained = new Set<unknown>();
  let plan: PlanNode | undefined;
  const explain: KyselyPlugin = {
    transformQuery({ node, queryId }) {
      if (
        plan === undefined && explained.size === 0 && RawNode.is(node) &&
        matches(rawText(node))
      ) {
        explained.add(queryId.queryId);
        return RawNode.create(
          [`explain (analyze, format json) ${node.sqlFragments[0]}`].concat(
            node.sqlFragments.slice(1),
          ),
          node.parameters,
        );
      }
      return node;
    },
    transformResult({ queryId, result }) {
      if (!explained.has(queryId.queryId)) return Promise.resolve(result);
      const explainedRows = result.rows as Record<string, unknown>[];
      const document = explainedRows[0]?.["QUERY PLAN"] as
        | readonly { readonly Plan: PlanNode }[]
        | undefined;
      plan = document?.[0]?.Plan;
      return Promise.resolve({ rows: [...rows] as typeof result.rows });
    },
  };
  await run(database.withPlugin(explain));
  if (plan === undefined) {
    throw new Error("No statement matched; nothing was explained.");
  }
  return plan;
}

/**
 * The executed plan of the query a `SECURITY DEFINER` function runs, which an
 * `EXPLAIN` of the call hides behind one Function Scan (ADR 0008). The body is
 * read from the catalog — its `RETURN QUERY` statement, or the expression of a
 * scalar `RETURN (…)` — with each argument bound in its declared type, and
 * explained as the function's owner, under the owner's own policies, so the
 * plan is the one the function executes.
 */
export async function explainedFunctionBody(
  sql: Sql,
  signature: string,
  args: readonly unknown[],
): Promise<PlanNode> {
  const [definition] = await sql<{
    readonly source: string;
    readonly owner: string;
    readonly names: readonly string[];
    readonly types: readonly string[];
  }[]>`
    select p.prosrc as source, quote_ident(pg_get_userbyid(p.proowner)) as owner,
      p.proargnames as names,
      array(select format_type(t, null) from unnest(p.proargtypes) t) as types
    from pg_proc p where p.oid = ${signature}::regprocedure
  `;
  if (definition === undefined) throw new Error(`${signature} is not defined`);
  const body = definition.source.match(/RETURN QUERY\s+([\s\S]*?);\s*END/i)
    ?.[1] ??
    definition.source.match(/RETURN \(\s*([\s\S]*?)\s*\);\s*END/i)?.[1];
  if (body === undefined) {
    throw new Error(`${signature} returns no single query to explain`);
  }
  const query = definition.types.reduce(
    (text, type, index) =>
      text.replace(
        new RegExp(`\\b${definition.names[index]}\\b`, "g"),
        () => `$${index + 1}::${type}`,
      ),
    body,
  );
  return await sql.begin(async (transaction) => {
    await transaction.unsafe(`set local role ${definition.owner}`);
    const rows = await transaction.unsafe(
      `explain (analyze, format json) ${query}`,
      args as never[],
    );
    const document = (rows[0] as Record<string, unknown>)["QUERY PLAN"] as
      | readonly { readonly Plan: PlanNode }[]
      | undefined;
    const plan = document?.[0]?.Plan;
    if (plan === undefined) throw new Error(`${signature} was not explained`);
    return plan;
  }) as PlanNode;
}
