/**
 * Build-time presentation of the generated agent tool catalog (MCP-C3) for
 * the public MCP guide; never hydrated. Everything the guide says about a
 * tool — its grant, annotations, route, and input — is read from
 * `packages/contracts/mcp/tools.json`, so the page cannot drift from the
 * catalog the endpoint serves.
 */
import catalog from "../../../../../packages/contracts/mcp/tools.json";
import { referenceOperations } from "../api-reference/reference.ts";
import {
  API_TOKEN_SCOPE_CHOICES,
  API_TOKEN_SCOPE_GROUPS,
  type ScopeAccess,
  type ScopeCaution,
  scopeLabel,
} from "../settings/api-access/api-access.ts";

/** The subset of JSON Schema the catalog's input schemas use. */
export interface JsonSchema {
  readonly type?: string;
  readonly description?: string;
  readonly format?: string;
  readonly pattern?: string;
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly default?: unknown;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly $ref?: string;
  readonly $defs?: Readonly<Record<string, JsonSchema>>;
  readonly anyOf?: readonly JsonSchema[];
  readonly items?: JsonSchema;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
}

export interface McpToolRoute {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
}

export interface McpTool {
  readonly name: string;
  readonly area: string;
  readonly title: string;
  readonly description: string;
  /** The grant a token needs to see and call the tool; `null` is any token. */
  readonly scope: string | null;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: boolean;
  };
  readonly route: McpToolRoute;
  readonly inputSchema: JsonSchema;
}

export interface McpCatalog {
  readonly endpoint: { readonly method: string; readonly path: string };
  readonly instructions: string;
  readonly areas: readonly {
    readonly id: string;
    readonly title: string;
    readonly tools: readonly string[];
  }[];
  readonly tools: readonly McpTool[];
}

// The generated JSON is checked against the tool definitions by
// `contracts:check`; its schemas are wider than this reader needs.
export const mcpCatalog = catalog as unknown as McpCatalog;

/** An annotation set in words, so nothing depends on colour. */
export interface ToolTraits {
  readonly destructive: boolean;
  readonly words: readonly string[];
}

export function toolTraits(annotations: McpTool["annotations"]): ToolTraits {
  const words = [
    annotations.destructiveHint
      ? "Destructive"
      : annotations.readOnlyHint
      ? "Read-only"
      : "Changes data",
  ];
  if (annotations.idempotentHint) words.push("Idempotent");
  if (annotations.openWorldHint) words.push("Reaches beyond Kinship");
  return { destructive: annotations.destructiveHint, words };
}

/** The `/docs/api` anchor of the REST operation a tool calls, when published. */
export function operationLink(
  route: McpToolRoute,
  operations: readonly {
    readonly operation: { readonly operationId: string };
  }[] = referenceOperations,
): string | undefined {
  return operations.some(({ operation }) =>
      operation.operationId === route.operationId
    )
    ? `/docs/api#${route.operationId}`
    : undefined;
}

/** One input field as the reference table shows it. */
export interface SchemaField {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly description?: string;
  readonly values?: readonly string[];
  readonly constraints: readonly string[];
}

type Definitions = Readonly<Record<string, JsonSchema>>;

function resolved(node: JsonSchema, defs: Definitions): JsonSchema {
  if (node.$ref === undefined) return node;
  const { $ref, ...rest } = node;
  return { ...defs[$ref.replace(/^#\/\$defs\//, "")], ...rest };
}

function typeOf(node: JsonSchema, defs: Definitions): string {
  const schema = resolved(node, defs);
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.anyOf) {
    return schema.anyOf.map((member) => typeOf(member, defs)).join(" or ");
  }
  if (schema.type === "array") {
    return `array of ${typeOf(schema.items ?? {}, defs)}`;
  }
  if (schema.type === undefined) return "any";
  return schema.format ? `${schema.type} (${schema.format})` : schema.type;
}

function range(
  low: number | undefined,
  high: number | undefined,
  unit: string,
): string | undefined {
  const suffix = unit ? ` ${unit}` : "";
  if (low !== undefined && high !== undefined) {
    return unit ? `${low}–${high}${suffix}` : `from ${low} to ${high}`;
  }
  if (low !== undefined) return `at least ${low}${suffix}`;
  if (high !== undefined) return `at most ${high}${suffix}`;
  return undefined;
}

function constraintsOf(node: JsonSchema, defs: Definitions): string[] {
  const schema = resolved(node, defs);
  const constraints = [
    range(
      schema.minLength,
      schema.maxLength,
      schema.minLength === 1 && schema.maxLength === undefined
        ? "character"
        : "characters",
    ),
    range(schema.minimum, schema.maximum, ""),
    range(schema.minItems, schema.maxItems, "items"),
    schema.pattern !== undefined && schema.format === undefined
      ? `matches ${schema.pattern}`
      : undefined,
    schema.default !== undefined
      ? `default ${JSON.stringify(schema.default)}`
      : undefined,
  ].filter((constraint) => constraint !== undefined);
  for (const member of schema.anyOf ?? []) {
    constraints.push(...constraintsOf(member, defs));
  }
  return constraints;
}

function valuesOf(node: JsonSchema, defs: Definitions): string[] {
  const schema = resolved(node, defs);
  return [
    ...(schema.enum ?? []).map(String),
    ...(schema.anyOf ?? []).flatMap((member) => valuesOf(member, defs)),
    ...(schema.items ? valuesOf(schema.items, defs) : []),
  ];
}

function fieldsOf(
  object: JsonSchema,
  defs: Definitions,
  prefix: string,
): SchemaField[] {
  const required = new Set(object.required ?? []);
  return Object.entries(object.properties ?? {}).flatMap(([key, node]) => {
    const schema = resolved(node, defs);
    const values = valuesOf(schema, defs);
    const field: SchemaField = {
      constraints: constraintsOf(schema, defs),
      name: `${prefix}${key}`,
      required: required.has(key),
      type: typeOf(schema, defs),
      ...(schema.description === undefined
        ? {}
        : { description: schema.description }),
      ...(values.length === 0 ? {} : { values }),
    };
    const items = schema.items && resolved(schema.items, defs);
    return items?.type === "object"
      ? [field, ...fieldsOf(items, defs, `${prefix}${key}[].`)]
      : [field];
  });
}

/** A tool's input fields, nested object members spelled `parent[].member`. */
export function schemaFields(schema: JsonSchema): readonly SchemaField[] {
  return fieldsOf(schema, schema.$defs ?? {}, "");
}

/** One tool as the reference renders it. */
export interface GuideTool {
  readonly tool: McpTool;
  readonly traits: ToolTraits;
  readonly operationHref: string | undefined;
  readonly fields: readonly SchemaField[];
}

export interface GuideArea {
  readonly id: string;
  readonly title: string;
  readonly tools: readonly GuideTool[];
}

/**
 * The catalog's tools by area, in the catalog's area order. A tool whose area
 * the catalog does not list still appears, under its area's id.
 */
export function guideAreas(
  source: McpCatalog = mcpCatalog,
): readonly GuideArea[] {
  const known = source.areas.map(({ id, title }) => ({ id, title }));
  const extra = [...new Set(source.tools.map(({ area }) => area))]
    .filter((id) => !known.some((area) => area.id === id))
    .map((id) => ({ id, title: id }));
  return [...known, ...extra].map(({ id, title }) => ({
    id,
    title,
    tools: source.tools.filter((tool) => tool.area === id).map((tool) => ({
      fields: schemaFields(tool.inputSchema),
      operationHref: operationLink(tool.route),
      tool,
      traits: toolTraits(tool.annotations),
    })),
  })).filter(({ tools }) => tools.length > 0);
}

/** Every tool the reference renders, in order: exactly the catalog's tools. */
export function guideTools(
  source: McpCatalog = mcpCatalog,
): readonly GuideTool[] {
  return guideAreas(source).flatMap(({ tools }) => tools);
}

/** The tools whose input takes a `requestId` retry key, in catalog order. */
export function retryKeyTools(
  source: McpCatalog = mcpCatalog,
): readonly string[] {
  return guideTools(source).filter(({ fields }) =>
    fields.some(({ name }) => name === "requestId")
  ).map(({ tool }) => tool.name);
}

/** A grant and the tools it unlocks, grouped by catalog area. */
export interface GrantRow {
  readonly scope: string | null;
  readonly label: string;
  readonly access: ScopeAccess | "any";
  readonly caution?: ScopeCaution;
  readonly areas: readonly {
    readonly id: string;
    readonly title: string;
    readonly tools: readonly {
      readonly name: string;
      readonly destructive: boolean;
    }[];
  }[];
}

export interface GrantSection {
  readonly id: string;
  readonly title: string;
  readonly grants: readonly GrantRow[];
}

/**
 * Every grant the token form offers, by the form's areas, with the tools each
 * one unlocks; first the tools any token may call, and last any grant a tool
 * needs that the form does not describe.
 */
export function grantSections(
  source: McpCatalog = mcpCatalog,
): readonly GrantSection[] {
  const areas = guideAreas(source);
  const row = (
    scope: string | null,
    rest: Omit<GrantRow, "scope" | "areas">,
  ): GrantRow => ({
    scope,
    ...rest,
    areas: areas.map(({ id, title, tools }) => ({
      id,
      title,
      tools: tools.filter(({ tool }) => tool.scope === scope).map((
        { tool, traits },
      ) => ({ destructive: traits.destructive, name: tool.name })),
    })).filter(({ tools }) => tools.length > 0),
  });
  const known = new Set<string>(
    API_TOKEN_SCOPE_CHOICES.map(({ scope }) => scope),
  );
  const unknown = [
    ...new Set(
      source.tools.flatMap(({ scope }) =>
        scope === null || known.has(scope) ? [] : [scope]
      ),
    ),
  ];
  const sections: GrantSection[] = API_TOKEN_SCOPE_GROUPS.map((
    { id, title },
  ) => ({
    grants: API_TOKEN_SCOPE_CHOICES.filter(({ group }) => group === id).map((
      { scope, label, access, caution },
    ) => row(scope, { access, label, ...(caution ? { caution } : {}) })),
    id,
    title,
  }));
  if (source.tools.some(({ scope }) => scope === null)) {
    sections.unshift({
      grants: [row(null, { access: "any", label: "Any valid token" })],
      id: "any",
      title: "No grant needed",
    });
  }
  if (unknown.length > 0) {
    sections.push({
      grants: unknown.map((scope) =>
        row(scope, { access: "unknown", label: scopeLabel(scope) })
      ),
      id: "other",
      title: "Other grants",
    });
  }
  return sections;
}
