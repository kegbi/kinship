/**
 * The generic architecture boundary checker.
 *
 * Before GAP-005 the only automated architecture evidence was a handful of
 * ticket-named text greps under `tools/architecture/<TICKET>/`. Nothing read
 * `docs/architecture/module-boundaries.yaml`, nothing proved the canonical
 * schema's tables were owned, and nothing looked at the import graph, so the
 * copy-pasted `crm.users` joins and the files-to-gifts read stayed invisible.
 *
 * This module is that missing checker. It is a pure function over text —
 * `inspectBoundaries` takes the manifest, its JSON Schema, the canonical DDL,
 * and the repository's source files, and returns violations — so the same
 * engine backs both the repository gate and its regression suite.
 *
 * Seven rules:
 *
 * 1. `manifest-schema` — the manifest satisfies `module-boundaries.schema.json`.
 * 2. `table-ownership` — every canonical table has exactly one owning module,
 *    and no module claims a table the canonical schema does not define.
 * 3. `layer` — the import graph obeys `layerRules`: every import that crosses
 *    into another module or read model targets that unit's public entry point,
 *    whether it comes from a peer module, a read model, an app, or a tool, and
 *    a module or read model may only import modules it declares; `application`,
 *    `domain`, and `ports` carry no infrastructure import — neither a vendor
 *    client nor a `packages/backend/platform` adapter — no `Deno.env`, and no
 *    raw `crm.` SQL; a module's `transport` imports only its own facade,
 *    `application/`, and `transport/`, the shared kernel, other units'
 *    facades (a read model's only when it composes the module), the route
 *    contracts, the HTTP kit, Hono, and Zod; read models never write;
 *    `apps/web` never imports `packages/backend`; only declared composition
 *    roots reach into another unit's `adapters/` or mount its
 *    `transport/http/routes.ts`. `sharedKernel.path` is a unit of its own:
 *    every layer may import it, and it may import nothing outside itself.
 * 4. `table-access` and `table-foreign-read` — every `crm.<table>` token inside
 *    a module's `adapters/` is measured against the module's `ownsTables` and
 *    the owned tables of its `allowedModuleDependencies`. A token owned by
 *    neither is a `table-access` breach; a token owned by a declared dependency
 *    rather than by the module itself is the weaker `table-foreign-read`, which
 *    is what the copy-pasted tenancy joins are. Read models are cross-module by
 *    contract, so they are measured against their `sourceModules` only.
 *    `approvedCrossModuleReads` names the few adapter files allowed to make a
 *    specific foreign read — today only the one actor-revalidation adapter
 *    that replaced those joins. The exemption is exact: it matches one module,
 *    one file, and one table, and it never excuses a `table-access` breach.
 * 5. `cycle` — neither the declared dependencies nor the real module imports
 *    form a cycle.
 * 6. `composition` — a unit's `composition.ts` is where that unit builds its
 *    own adapters. Only a declared composition root may import one, plus the
 *    unit's own files, so the adapter registry cannot leak back out through a
 *    second door once `public.ts` stopped being one.
 * 7. `public-surface` — a declared public entry point exports types, factories,
 *    and pure helpers. It never re-exports a value from its own `adapters/`,
 *    which is what made `public.ts` an adapter registry before GAP-013.
 *
 * Known violations live in `tools/architecture/boundary-baseline.json`. The
 * check fails on any violation missing from the baseline and on any baseline
 * entry that no longer occurs, so the baseline can only shrink.
 *
 * Run: `deno task check:architecture`.
 */

import { parse as parseYaml } from "@std/yaml";

// --- Results -------------------------------------------------------------

export type BoundaryRule =
  | "manifest-schema"
  | "table-ownership"
  | "layer"
  | "table-access"
  | "table-foreign-read"
  | "cycle"
  | "composition"
  | "public-surface";

export interface Violation {
  readonly rule: BoundaryRule;
  /** The file or document the violation belongs to. */
  readonly subject: string;
  readonly detail: string;
}

export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

export interface BoundaryInput {
  readonly manifestPath: string;
  readonly manifestText: string;
  /** `module-boundaries.schema.json` as text. */
  readonly schemaText: string;
  readonly canonicalSchemaPath: string;
  readonly canonicalSchemaSql: string;
  /** Every production source file, repository-relative. */
  readonly files: readonly SourceFile[];
}

/** The stable identity of a violation, used to match baseline entries. */
export function violationKey(violation: Violation): string {
  return [violation.rule, violation.subject, violation.detail].join("|");
}

// --- A JSON Schema subset validator --------------------------------------
//
// `module-boundaries.schema.json` uses a small, closed subset of draft
// 2020-12. Validating it here keeps the gate dependency-light, and the
// validator fails closed: a keyword it does not implement is an error, never a
// silent pass.

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type JsonObject = { readonly [key: string]: JsonValue };

const SUPPORTED_KEYWORDS = new Set([
  "$schema",
  "$id",
  "title",
  "$defs",
  "$ref",
  "type",
  "const",
  "enum",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minItems",
  "uniqueItems",
  "minLength",
  "pattern",
]);

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeName(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  return typeof value;
}

function matchesType(value: JsonValue, expected: string): boolean {
  if (expected === "object") return isJsonObject(value);
  if (expected === "array") return Array.isArray(value);
  if (expected === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }
  if (expected === "number") return typeof value === "number";
  return typeName(value) === expected;
}

/**
 * Validates one value against one schema node, appending `pointer: message`
 * issues. Throws on an unsupported keyword rather than accepting the document.
 */
export function validateAgainstSchema(
  value: JsonValue,
  schema: JsonObject,
  root: JsonObject,
  pointer: string,
  issues: string[],
): void {
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      throw new Error(
        `unsupported JSON Schema keyword "${keyword}" at ${pointer || "#"}`,
      );
    }
  }

  const reference = schema["$ref"];
  if (typeof reference === "string") {
    const name = reference.startsWith("#/$defs/")
      ? reference.slice("#/$defs/".length)
      : undefined;
    const definitions = root["$defs"];
    const target = name !== undefined && isJsonObject(definitions)
      ? definitions[name]
      : undefined;
    if (!isJsonObject(target)) {
      throw new Error(`unresolved JSON Schema reference ${reference}`);
    }
    validateAgainstSchema(value, target, root, pointer, issues);
    return;
  }

  const expected = schema["type"];
  if (typeof expected === "string" && !matchesType(value, expected)) {
    issues.push(`${pointer}: expected ${expected}, found ${typeName(value)}`);
    return;
  }

  if ("const" in schema) {
    const constant = schema["const"] as JsonValue;
    if (JSON.stringify(value) !== JSON.stringify(constant)) {
      issues.push(`${pointer}: must be ${JSON.stringify(constant)}`);
    }
  }

  const allowed = schema["enum"];
  if (Array.isArray(allowed)) {
    const rendered = allowed.map((entry) => JSON.stringify(entry));
    if (!rendered.includes(JSON.stringify(value))) {
      issues.push(`${pointer}: must be one of ${rendered.join(", ")}`);
    }
  }

  if (typeof value === "string") {
    const minimum = schema["minLength"];
    if (typeof minimum === "number" && value.length < minimum) {
      issues.push(`${pointer}: must be at least ${minimum} characters`);
    }
    const pattern = schema["pattern"];
    if (typeof pattern === "string" && !new RegExp(pattern).test(value)) {
      issues.push(`${pointer}: must match ${pattern}`);
    }
  }

  if (Array.isArray(value)) {
    const minimum = schema["minItems"];
    if (typeof minimum === "number" && value.length < minimum) {
      issues.push(`${pointer}: must have at least ${minimum} items`);
    }
    if (schema["uniqueItems"] === true) {
      const rendered = value.map((entry) => JSON.stringify(entry));
      if (new Set(rendered).size !== rendered.length) {
        issues.push(`${pointer}: must not repeat an item`);
      }
    }
    const items = schema["items"];
    if (isJsonObject(items)) {
      value.forEach((entry, index) => {
        validateAgainstSchema(
          entry,
          items,
          root,
          `${pointer}/${index}`,
          issues,
        );
      });
    }
  }

  if (isJsonObject(value)) {
    const required = schema["required"];
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === "string" && !(key in value)) {
          issues.push(`${pointer}: missing required property ${key}`);
        }
      }
    }
    const properties = schema["properties"];
    const declared = isJsonObject(properties) ? properties : {};
    if (schema["additionalProperties"] === false) {
      for (const key of Object.keys(value)) {
        if (!(key in declared)) {
          issues.push(`${pointer}: unknown property ${key}`);
        }
      }
    } else if ("additionalProperties" in schema) {
      throw new Error(
        `unsupported additionalProperties schema at ${pointer || "#"}`,
      );
    }
    for (const [key, entry] of Object.entries(declared)) {
      if (!(key in value) || !isJsonObject(entry)) continue;
      validateAgainstSchema(
        value[key] as JsonValue,
        entry,
        root,
        `${pointer}/${key}`,
        issues,
      );
    }
  }
}

// --- The manifest --------------------------------------------------------

/**
 * One adapter file the manifest allows to read a named table owned by another
 * module. It narrows `table-foreign-read` only: the owning module must still
 * be a declared dependency, so an approved read can never hide a
 * `table-access` breach.
 */
export interface ApprovedCrossModuleRead {
  readonly adapter: string;
  readonly module: string;
  readonly tables: readonly string[];
}

export interface ManifestModule {
  readonly id: string;
  readonly path: string;
  readonly ownsTables: readonly string[];
  readonly publicEntryPoints: readonly string[];
  readonly allowedModuleDependencies: readonly string[];
}

export interface ManifestReadModel {
  readonly id: string;
  readonly path: string;
  readonly sourceModules: readonly string[];
  /** Declared facades, or the conventional `<path>/public.ts`. */
  readonly publicEntryPoints: readonly string[];
}

export interface Manifest {
  readonly approvedCrossModuleReads: readonly ApprovedCrossModuleRead[];
  readonly compositionRoots: readonly string[];
  /** `sharedKernel.path`: the one unit every other unit may import. */
  readonly sharedKernelPath: string;
  readonly modules: readonly ManifestModule[];
  readonly readModels: readonly ManifestReadModel[];
}

function strings(value: JsonValue | undefined): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function text(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function readManifest(document: JsonObject): Manifest {
  const modules = Array.isArray(document["modules"]) ? document["modules"] : [];
  const readModels = Array.isArray(document["readModels"])
    ? document["readModels"]
    : [];
  const sharedKernel = document["sharedKernel"];
  const approvedReads = Array.isArray(document["approvedCrossModuleReads"])
    ? document["approvedCrossModuleReads"]
    : [];
  return {
    approvedCrossModuleReads: approvedReads.filter(isJsonObject).map((
      entry,
    ) => ({
      adapter: text(entry["adapter"]),
      module: text(entry["module"]),
      tables: strings(entry["tables"]),
    })),
    compositionRoots: strings(document["compositionRoots"]),
    sharedKernelPath: isJsonObject(sharedKernel)
      ? text(sharedKernel["path"])
      : "",
    modules: modules.filter(isJsonObject).map((entry) => ({
      id: text(entry["id"]),
      path: text(entry["path"]),
      ownsTables: strings(entry["ownsTables"]),
      publicEntryPoints: strings(entry["publicEntryPoints"]),
      allowedModuleDependencies: strings(entry["allowedModuleDependencies"]),
    })),
    readModels: readModels.filter(isJsonObject).map((entry) => {
      const path = text(entry["path"]);
      const declared = strings(entry["publicEntryPoints"]);
      return {
        id: text(entry["id"]),
        path,
        sourceModules: strings(entry["sourceModules"]),
        publicEntryPoints: declared.length > 0
          ? declared
          : [`${path}/public.ts`],
      };
    }),
  };
}

// --- The canonical schema ------------------------------------------------

/** Every table the canonical DDL creates, without its schema qualifier. */
export function canonicalTables(sql: string): readonly string[] {
  const tables: string[] = [];
  const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/gi;
  for (const match of sql.matchAll(pattern)) {
    const name = (match[1] ?? "").replaceAll('"', "");
    const unqualified = name.slice(name.lastIndexOf(".") + 1);
    if (unqualified.length > 0) tables.push(unqualified);
  }
  return tables;
}

// --- Imports -------------------------------------------------------------

const IMPORT_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s+["']([^"']+)["']/g,
];

/** Every module specifier a source file names. */
export function importSpecifiers(source: string): readonly string[] {
  const found = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) found.add(specifier);
    }
  }
  return [...found];
}

/** Resolves a relative specifier against the importing file's directory. */
export function resolveSpecifier(
  fromPath: string,
  specifier: string,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const segments = fromPath.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "." || segment.length === 0) continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

// --- Rules ---------------------------------------------------------------

const INFRASTRUCTURE_IMPORTS = [
  "kysely",
  "kysely-postgres-js",
  "postgres",
  "hono",
  "minio",
  "zod",
];

const APPLICATION_LAYERS = ["application", "domain", "ports"];

/**
 * What a module's `transport/` may import besides its own facade, application,
 * and transport, the shared kernel, and other units' facades: the route
 * contracts it mounts, the HTTP kit it mounts them with, and the two libraries
 * the kit is written in. `layerRules.transportMayImport` names the same list.
 */
const TRANSPORT_SUPPORT_PATHS = ["packages/contracts", "packages/http-kit"];
const TRANSPORT_LIBRARIES = ["hono", "zod"];

/** The one transport file a composition root may import from a module. */
const TRANSPORT_ENTRY = "transport/http/routes.ts";

/**
 * The shared infrastructure adapters.
 *
 * `repository-layout.md` places them beside the modules rather than inside
 * one, and `backend-architecture.md` calls them adapters, so the same rule
 * that keeps Kysely out of a use case keeps these out too: a driver-free file
 * under this path is still infrastructure. Adapters and composition roots
 * import it freely; `application`, `domain`, and `ports` never do.
 */
const PLATFORM_PATH = "packages/backend/platform";

const TABLE_TOKEN = /crm\.([a-z_][a-z0-9_]*)/g;

interface Unit {
  readonly id: string;
  readonly path: string;
  readonly kind: "module" | "read-model" | "shared-kernel";
}

function owningUnit(
  path: string,
  units: readonly Unit[],
): Unit | undefined {
  return units.find((unit) => path.startsWith(`${unit.path}/`));
}

/** The layer a backend file belongs to, relative to its unit. */
function layerOf(path: string, unit: Unit): string {
  return path.slice(unit.path.length + 1).split("/")[0] ?? "";
}

/** The manifest as data, or the reason it could not be read. */
function parseManifestDocument(text: string): JsonValue | string {
  try {
    return parseYaml(text) as JsonValue;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function manifestSchemaViolations(input: BoundaryInput): Violation[] {
  const issues: string[] = [];
  const document = parseManifestDocument(input.manifestText);
  const schema = JSON.parse(input.schemaText) as JsonObject;
  if (typeof document === "string") {
    issues.push(`#: the manifest is not readable YAML: ${document}`);
  } else if (!isJsonObject(document)) {
    issues.push("#: the manifest must be a mapping");
  } else {
    validateAgainstSchema(document, schema, schema, "", issues);
  }
  return issues.map((detail) => ({
    rule: "manifest-schema" as const,
    subject: input.manifestPath,
    detail,
  }));
}

function tableOwnershipViolations(
  input: BoundaryInput,
  manifest: Manifest,
): Violation[] {
  const violations: Violation[] = [];
  const owners = new Map<string, string[]>();
  for (const module of manifest.modules) {
    for (const table of module.ownsTables) {
      owners.set(table, [...(owners.get(table) ?? []), module.id]);
    }
  }
  const declared = new Set(canonicalTables(input.canonicalSchemaSql));
  for (const table of [...declared].sort()) {
    const claimed = owners.get(table) ?? [];
    if (claimed.length === 0) {
      violations.push({
        rule: "table-ownership",
        subject: input.manifestPath,
        detail: `no module owns crm.${table}`,
      });
      continue;
    }
    if (claimed.length > 1) {
      violations.push({
        rule: "table-ownership",
        subject: input.manifestPath,
        detail: `crm.${table} is owned by ${[...claimed].sort().join(", ")}`,
      });
    }
  }
  for (const [table, claimed] of [...owners].sort()) {
    if (declared.has(table)) continue;
    violations.push({
      rule: "table-ownership",
      subject: input.manifestPath,
      detail: `${
        claimed.sort().join(", ")
      } owns crm.${table}, which ${input.canonicalSchemaPath} does not define`,
    });
  }
  return violations;
}

function layerViolations(
  input: BoundaryInput,
  manifest: Manifest,
  units: readonly Unit[],
): Violation[] {
  const violations: Violation[] = [];
  const compositionRoots = new Set(manifest.compositionRoots);
  const moduleById = new Map(
    manifest.modules.map((module) => [module.id, module]),
  );
  const readModelById = new Map(
    manifest.readModels.map((model) => [model.id, model]),
  );

  for (const file of input.files) {
    const unit = owningUnit(file.path, units);
    const layer = unit ? layerOf(file.path, unit) : "";
    const specifiers = importSpecifiers(file.text);

    if (file.path.startsWith("apps/web/")) {
      for (const specifier of specifiers) {
        const resolved = resolveSpecifier(file.path, specifier) ?? specifier;
        if (!resolved.includes("packages/backend")) continue;
        violations.push({
          rule: "layer",
          subject: file.path,
          detail: `apps/web imports ${resolved} from packages/backend`,
        });
      }
    }

    if (unit && APPLICATION_LAYERS.includes(layer)) {
      for (const specifier of specifiers) {
        const bare = specifier.replace(/^npm:/, "").replace(/@[^/@]+$/, "");
        if (!INFRASTRUCTURE_IMPORTS.includes(bare)) continue;
        violations.push({
          rule: "layer",
          subject: file.path,
          detail: `the ${layer} layer imports ${specifier}`,
        });
      }
      for (const specifier of specifiers) {
        const resolved = resolveSpecifier(file.path, specifier);
        if (resolved === undefined) continue;
        if (!resolved.startsWith(`${PLATFORM_PATH}/`)) continue;
        violations.push({
          rule: "layer",
          subject: file.path,
          detail: `the ${layer} layer imports the platform adapter ${resolved}`,
        });
      }
      if (/\bDeno\.env\b/.test(file.text)) {
        violations.push({
          rule: "layer",
          subject: file.path,
          detail: `the ${layer} layer reads Deno.env`,
        });
      }
      for (const table of new Set(tableTokens(file.text))) {
        violations.push({
          rule: "layer",
          subject: file.path,
          detail: `the ${layer} layer writes raw SQL against crm.${table}`,
        });
      }
    }

    // The shared kernel is the one unit everything may depend on, so it may
    // depend on nothing: no module, no read model, no vendor client, no
    // environment, no SQL. `layerRules` lets every other layer import it, and
    // that permission is only safe while the kernel stays a leaf.
    if (unit?.kind === "shared-kernel") {
      for (const specifier of specifiers) {
        const resolved = resolveSpecifier(file.path, specifier);
        if (resolved !== undefined && resolved.startsWith(`${unit.path}/`)) {
          continue;
        }
        violations.push({
          rule: "layer",
          subject: file.path,
          detail: `the shared kernel imports ${
            resolved ?? specifier
          }, which is outside the kernel`,
        });
      }
      if (/\bDeno\.env\b/.test(file.text)) {
        violations.push({
          rule: "layer",
          subject: file.path,
          detail: "the shared kernel reads Deno.env",
        });
      }
      for (const table of new Set(tableTokens(file.text))) {
        violations.push({
          rule: "layer",
          subject: file.path,
          detail: `the shared kernel writes raw SQL against crm.${table}`,
        });
      }
      continue;
    }

    if (unit?.kind === "module" && layer === "transport") {
      violations.push(
        ...transportViolations(
          file.path,
          specifiers,
          unit,
          units,
          readModelById,
        ),
      );
    }

    if (unit?.kind === "read-model") {
      for (const call of ["insertInto", "updateTable", "deleteFrom"]) {
        if (!new RegExp(`\\b${call}\\s*\\(`).test(file.text)) continue;
        violations.push({
          rule: "layer",
          subject: file.path,
          detail: `the ${unit.id} read model calls ${call}`,
        });
      }
    }

    for (const specifier of specifiers) {
      const resolved = resolveSpecifier(file.path, specifier);
      if (resolved === undefined) continue;
      const target = owningUnit(resolved, units);
      // `layerRules` lists `shared-kernel` for domain, application, ports, and
      // adapters, and the read models consume it on the same terms.
      if (target?.kind === "shared-kernel") continue;

      if (
        resolved.includes("/adapters/") &&
        (target === undefined || target.path !== unit?.path) &&
        !compositionRoots.has(file.path)
      ) {
        violations.push({
          rule: "layer",
          subject: file.path,
          detail:
            `${resolved} is an adapter and this file is not a declared composition root`,
        });
      }

      if (target === undefined) continue;
      // A unit reaches its own files freely, and the adapter rule above
      // already owns every adapter import, composition roots included.
      if (target.path === unit?.path) continue;
      if (resolved.includes("/adapters/")) continue;
      // A unit's `composition.ts` is not a facade and never will be; the
      // `composition` rule below decides who may import one.
      if (resolved === `${target.path}/composition.ts`) continue;
      // A composition root mounts a module's routes the way it builds the
      // module's adapters: directly, and through the one transport entry.
      if (
        compositionRoots.has(file.path) &&
        resolved === `${target.path}/${TRANSPORT_ENTRY}`
      ) continue;

      // Everything else — another unit's file, whether the importer is a
      // module, a read model, an app, or a tool — enters through the facade.
      const entryPoints = target.kind === "module"
        ? moduleById.get(target.id)?.publicEntryPoints ?? []
        : readModelById.get(target.id)?.publicEntryPoints ?? [];
      if (!entryPoints.includes(resolved)) {
        violations.push({
          rule: "layer",
          subject: file.path,
          detail: `${resolved} is not a public entry point of ${target.id}`,
        });
      }

      // Only a module or a read model declares which modules it may consume.
      if (unit === undefined || target.kind !== "module") continue;
      const permitted = unit.kind === "module"
        ? moduleById.get(unit.id)?.allowedModuleDependencies ?? []
        : readModelById.get(unit.id)?.sourceModules ?? [];
      if (!permitted.includes(target.id)) {
        violations.push({
          rule: "layer",
          subject: file.path,
          detail: `${unit.id} imports ${target.id}, which it does not declare`,
        });
      }
    }
  }
  return violations;
}

/**
 * The `transport` layer: a module's HTTP routes.
 *
 * Routes call the module's use cases through its facade or its `application/`
 * and never build or reach the module's adapters, domain, ports, or
 * composition. Outside the module they mount `packages/contracts` descriptors
 * with the `packages/http-kit` kit, and they may read the shared kernel,
 * another module's facade (the declared-dependency rule still applies), and a
 * read model's facade when that read model composes this module, which is how
 * a projection over the module's own data is served beside its writes.
 * Everything else — the platform, an app, the test support package, a
 * database or storage client — is out of reach.
 */
function transportViolations(
  path: string,
  specifiers: readonly string[],
  unit: Unit,
  units: readonly Unit[],
  readModelById: ReadonlyMap<string, ManifestReadModel>,
): Violation[] {
  const violations: Violation[] = [];
  const violation = (detail: string): Violation => ({
    rule: "layer",
    subject: path,
    detail,
  });
  for (const specifier of specifiers) {
    const resolved = resolveSpecifier(path, specifier);
    if (resolved === undefined) {
      // The scanner reads text, so prose such as `from "the session store is
      // down"` in a comment surfaces too; a real specifier has no whitespace.
      if (/\s/.test(specifier)) continue;
      const bare = specifier.replace(/^npm:/, "").replace(/@[^/@]+$/, "");
      const library = bare.split("/")[0] ?? "";
      if (TRANSPORT_LIBRARIES.includes(library)) continue;
      violations.push(violation(`the transport layer imports ${specifier}`));
      continue;
    }
    const target = owningUnit(resolved, units);
    if (target?.path === unit.path) {
      const own = resolved.slice(unit.path.length + 1);
      if (
        own === "public.ts" || own.startsWith("application/") ||
        own.startsWith("transport/")
      ) continue;
      violations.push(violation(
        `the transport layer imports ${resolved}; a module's transport reaches its own module only through public.ts, application/, and transport/`,
      ));
      continue;
    }
    if (target?.kind === "shared-kernel" || target?.kind === "module") {
      // Another module's files are the general facade rule's business.
      continue;
    }
    if (target?.kind === "read-model") {
      const sources = readModelById.get(target.id)?.sourceModules ?? [];
      if (sources.includes(unit.id)) continue;
      violations.push(violation(
        `the transport layer imports the ${target.id} read model, which does not compose ${unit.id}`,
      ));
      continue;
    }
    if (
      TRANSPORT_SUPPORT_PATHS.some((support) =>
        resolved.startsWith(`${support}/`)
      )
    ) continue;
    violations.push(violation(
      `the transport layer imports ${resolved}, which is outside the HTTP kit, the contracts, the shared kernel, and the module and read-model facades`,
    ));
  }
  return violations;
}

function tableTokens(source: string): readonly string[] {
  return [...source.matchAll(TABLE_TOKEN)].map((match) => match[1] ?? "");
}

function tableAccessViolations(
  input: BoundaryInput,
  manifest: Manifest,
): Violation[] {
  const violations: Violation[] = [];
  const ownerOf = new Map<string, string>();
  for (const module of manifest.modules) {
    for (const table of module.ownsTables) {
      if (!ownerOf.has(table)) ownerOf.set(table, module.id);
    }
  }
  const tablesOf = (id: string): readonly string[] =>
    manifest.modules.find((module) => module.id === id)?.ownsTables ?? [];

  const scopes: {
    readonly prefix: string;
    readonly id: string;
    readonly owned: ReadonlySet<string>;
    readonly reachable: ReadonlySet<string>;
  }[] = [];
  for (const module of manifest.modules) {
    const reachable = new Set(module.ownsTables);
    for (const dependency of module.allowedModuleDependencies) {
      for (const table of tablesOf(dependency)) reachable.add(table);
    }
    scopes.push({
      prefix: `${module.path}/adapters/`,
      id: module.id,
      owned: new Set(module.ownsTables),
      reachable,
    });
  }
  for (const model of manifest.readModels) {
    const reachable = new Set<string>();
    for (const source of model.sourceModules) {
      for (const table of tablesOf(source)) reachable.add(table);
    }
    scopes.push({
      prefix: `${model.path}/`,
      id: model.id,
      owned: reachable,
      reachable,
    });
  }

  // The manifest's declared actor-context reads, keyed by module, file, and
  // table. They excuse a `table-foreign-read` and nothing else.
  const approved = new Set(
    manifest.approvedCrossModuleReads.flatMap((entry) =>
      entry.tables.map((table) => `${entry.module}|${entry.adapter}|${table}`)
    ),
  );

  for (const file of input.files) {
    const scope = scopes.find((candidate) =>
      file.path.startsWith(candidate.prefix)
    );
    if (scope === undefined) continue;
    for (const table of [...new Set(tableTokens(file.text))].sort()) {
      if (scope.owned.has(table)) continue;
      const owner = ownerOf.get(table) ?? "no module";
      if (!scope.reachable.has(table)) {
        violations.push({
          rule: "table-access",
          subject: file.path,
          detail:
            `${scope.id} reads crm.${table}, owned by ${owner}, which it does not declare`,
        });
        continue;
      }
      if (approved.has(`${scope.id}|${file.path}|${table}`)) continue;
      violations.push({
        rule: "table-foreign-read",
        subject: file.path,
        detail: `${scope.id} reads crm.${table}, owned by ${owner}`,
      });
    }
  }
  return violations;
}

/** The lexicographically smallest rotation, so a cycle has one identity. */
function canonicalCycle(cycle: readonly string[]): string[] {
  let best = 0;
  for (let index = 1; index < cycle.length; index += 1) {
    if ((cycle[index] ?? "") < (cycle[best] ?? "")) best = index;
  }
  return [...cycle.slice(best), ...cycle.slice(0, best)];
}

/** Every cycle reachable in a directed graph, each reported once. */
export function findCycles(
  edges: ReadonlyMap<string, readonly string[]>,
): string[][] {
  const found = new Map<string, string[]>();
  const state = new Map<string, "visiting" | "done">();
  const visit = (node: string, path: readonly string[]): void => {
    if (state.get(node) === "done") return;
    const start = path.indexOf(node);
    if (start >= 0) {
      const cycle = canonicalCycle(path.slice(start));
      found.set(cycle.join(" -> "), cycle);
      return;
    }
    state.set(node, "visiting");
    for (const next of edges.get(node) ?? []) visit(next, [...path, node]);
    state.set(node, "done");
  };
  for (const node of [...edges.keys()].sort()) visit(node, []);
  return [...found.values()];
}

function cycleViolations(
  input: BoundaryInput,
  manifest: Manifest,
  units: readonly Unit[],
): Violation[] {
  const violations: Violation[] = [];
  const declared = new Map<string, readonly string[]>(
    manifest.modules.map((module) => [
      module.id,
      module.allowedModuleDependencies,
    ]),
  );
  for (const cycle of findCycles(declared)) {
    violations.push({
      rule: "cycle",
      subject: input.manifestPath,
      detail: `allowedModuleDependencies form a cycle: ${
        [...cycle, cycle[0]].join(" -> ")
      }`,
    });
  }

  const imported = new Map<string, Set<string>>();
  for (const module of manifest.modules) imported.set(module.id, new Set());
  for (const file of input.files) {
    const unit = owningUnit(file.path, units);
    if (unit?.kind !== "module") continue;
    for (const specifier of importSpecifiers(file.text)) {
      const resolved = resolveSpecifier(file.path, specifier);
      if (resolved === undefined) continue;
      const target = owningUnit(resolved, units);
      if (target === undefined || target.kind !== "module") continue;
      if (target.id === unit.id) continue;
      imported.get(unit.id)?.add(target.id);
    }
  }
  const actual = new Map<string, readonly string[]>(
    [...imported].map(([id, targets]) => [id, [...targets].sort()]),
  );
  for (const cycle of findCycles(actual)) {
    violations.push({
      rule: "cycle",
      subject: "packages/backend/modules",
      detail: `module imports form a cycle: ${
        [...cycle, cycle[0]].join(" -> ")
      }`,
    });
  }
  return violations;
}

/** A unit's own composition file, the one place it may build its adapters. */
function compositionFileOf(unit: Unit): string {
  return `${unit.path}/composition.ts`;
}

/**
 * Per-module composition files are private to the roots.
 *
 * `public.ts` stopped exporting adapter classes, so `composition.ts` is now the
 * only reachable name for them. This rule keeps that name reachable from the
 * declared roots alone: anything else importing it would rebuild the registry
 * the ticket removed.
 */
function compositionViolations(
  input: BoundaryInput,
  manifest: Manifest,
  units: readonly Unit[],
): Violation[] {
  const violations: Violation[] = [];
  const compositionRoots = new Set(manifest.compositionRoots);
  for (const file of input.files) {
    if (compositionRoots.has(file.path)) continue;
    const importer = owningUnit(file.path, units);
    for (const specifier of importSpecifiers(file.text)) {
      const resolved = resolveSpecifier(file.path, specifier);
      if (resolved === undefined) continue;
      const target = owningUnit(resolved, units);
      if (target === undefined) continue;
      if (resolved !== compositionFileOf(target)) continue;
      // A unit composes itself freely; nobody else may.
      if (importer?.path === target.path) continue;
      violations.push({
        rule: "composition",
        subject: file.path,
        detail:
          `${resolved} is ${target.id}'s composition file and this file is not a declared composition root`,
      });
    }
  }
  return violations;
}

/** `export ... from "..."`, with whether every exported name is a type. */
const EXPORT_FROM =
  /export\s+(type\s+)?(\*|\{[^}]*\})\s*from\s*["']([^"']+)["']/g;

function exportsOnlyTypes(clause: string, typeKeyword: boolean): boolean {
  if (typeKeyword) return true;
  if (!clause.startsWith("{")) return false;
  const names = clause.slice(1, -1).split(",").map((name) => name.trim())
    .filter((name) => name.length > 0);
  return names.length > 0 &&
    names.every((name) => /^type\s/.test(name));
}

/**
 * A public entry point is a facade, not an adapter registry.
 *
 * Re-exporting an adapter class from `public.ts` made every consumer able to
 * construct infrastructure while appearing to obey the layer rule. Types are
 * still fine — a keyset or an options shape carries no implementation.
 */
function publicSurfaceViolations(
  input: BoundaryInput,
  manifest: Manifest,
): Violation[] {
  const violations: Violation[] = [];
  const entryPoints = new Set([
    ...manifest.modules.flatMap((module) => module.publicEntryPoints),
    ...manifest.readModels.flatMap((model) => model.publicEntryPoints),
  ]);
  for (const file of input.files) {
    if (!entryPoints.has(file.path)) continue;
    for (const match of file.text.matchAll(EXPORT_FROM)) {
      const clause = match[2] ?? "";
      if (exportsOnlyTypes(clause, match[1] !== undefined)) continue;
      const resolved = resolveSpecifier(file.path, match[3] ?? "");
      if (resolved === undefined || !resolved.includes("/adapters/")) continue;
      violations.push({
        rule: "public-surface",
        subject: file.path,
        detail:
          `${resolved} is an adapter and a public entry point may re-export only its types`,
      });
    }
  }
  return violations;
}

// --- The checker ---------------------------------------------------------

function sortViolations(violations: readonly Violation[]): Violation[] {
  return [...violations].sort((left, right) =>
    violationKey(left).localeCompare(violationKey(right))
  );
}

/** Every boundary violation the inputs contain, in a stable order. */
export function inspectBoundaries(input: BoundaryInput): Violation[] {
  const schemaViolations = manifestSchemaViolations(input);
  if (schemaViolations.length > 0) return sortViolations(schemaViolations);

  // The schema pass above returned early unless the manifest parsed and
  // validated, so reading it as the declared shape is safe here.
  const manifest = readManifest(parseYaml(input.manifestText) as JsonObject);
  const units: Unit[] = [
    ...manifest.modules.map((module) => ({
      id: module.id,
      path: module.path,
      kind: "module" as const,
    })),
    ...manifest.readModels.map((model) => ({
      id: model.id,
      path: model.path,
      kind: "read-model" as const,
    })),
    ...(manifest.sharedKernelPath
      ? [{
        id: "shared-kernel",
        path: manifest.sharedKernelPath,
        kind: "shared-kernel" as const,
      }]
      : []),
  ];
  return sortViolations([
    ...tableOwnershipViolations(input, manifest),
    ...layerViolations(input, manifest, units),
    ...tableAccessViolations(input, manifest),
    ...cycleViolations(input, manifest, units),
    ...compositionViolations(input, manifest, units),
    ...publicSurfaceViolations(input, manifest),
  ]);
}

export interface BaselineComparison {
  /** Violations the baseline does not record. */
  readonly introduced: readonly Violation[];
  /** Baseline entries that no longer occur. */
  readonly resolved: readonly Violation[];
  readonly remaining: number;
}

export function compareWithBaseline(
  current: readonly Violation[],
  baseline: readonly Violation[],
): BaselineComparison {
  const known = new Map(
    baseline.map((violation) => [violationKey(violation), violation]),
  );
  const seen = new Set(current.map(violationKey));
  const introduced = current.filter(
    (violation) => !known.has(violationKey(violation)),
  );
  const resolved = [...known].filter(([key]) => !seen.has(key)).map(
    ([, violation]) => violation,
  );
  return {
    introduced: sortViolations(introduced),
    resolved: sortViolations(resolved),
    remaining: current.length - introduced.length,
  };
}

export function formatReport(
  comparison: BaselineComparison,
  baselinePath: string,
): string {
  const lines: string[] = [];
  const render = (violation: Violation): string =>
    `  [${violation.rule}] ${violation.subject}\n      ${violation.detail}`;
  if (comparison.introduced.length > 0) {
    lines.push(
      `${comparison.introduced.length} new architecture violation(s):`,
      ...comparison.introduced.map(render),
      "",
      `Fix them, or record them deliberately in ${baselinePath}.`,
    );
  }
  if (comparison.resolved.length > 0) {
    lines.push(
      `${comparison.resolved.length} baseline entr(y/ies) no longer occur:`,
      ...comparison.resolved.map(render),
      "",
      `Delete them from ${baselinePath}; the baseline may only shrink.`,
    );
  }
  if (lines.length === 0) {
    lines.push(
      `Architecture boundaries hold. ${comparison.remaining} known violation(s) remain in ${baselinePath}.`,
    );
  }
  return lines.join("\n");
}

export interface Baseline {
  readonly note?: string;
  readonly violations: readonly Violation[];
}

// --- The repository gate -------------------------------------------------

const ROOT = new URL("../../", import.meta.url);
const MANIFEST_PATH = "docs/architecture/module-boundaries.yaml";
const SCHEMA_PATH = "docs/architecture/module-boundaries.schema.json";
const CANONICAL_SCHEMA_PATH =
  "personal-crm-schema/v7/personal_crm_schema_v7.sql";
const BASELINE_PATH = "tools/architecture/boundary-baseline.json";
const SOURCE_ROOTS = ["apps", "packages", "tools"];
const SOURCE_EXTENSIONS = [".ts", ".astro"];
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".astro",
  "dist",
  ".coverage",
]);

function isSource(name: string): boolean {
  if (name.endsWith("_test.ts") || name.endsWith(".test.ts")) return false;
  if (name.endsWith(".test-helper.ts")) return false;
  if (name.endsWith(".d.ts")) return false;
  return SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

async function collectSources(root: URL): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  const walk = async (relative: string): Promise<void> => {
    for await (const entry of Deno.readDir(new URL(relative, root))) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(path);
        continue;
      }
      if (!isSource(entry.name)) continue;
      files.push({ path, text: await Deno.readTextFile(new URL(path, root)) });
    }
  };
  for (const base of SOURCE_ROOTS) await walk(base);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function main(): Promise<number> {
  const [manifestText, schemaText, canonicalSchemaSql, baselineText] =
    await Promise.all(
      [MANIFEST_PATH, SCHEMA_PATH, CANONICAL_SCHEMA_PATH, BASELINE_PATH].map(
        (path) => Deno.readTextFile(new URL(path, ROOT)),
      ),
    );
  const baseline = JSON.parse(baselineText ?? "") as Baseline;
  const violations = inspectBoundaries({
    manifestPath: MANIFEST_PATH,
    manifestText: manifestText ?? "",
    schemaText: schemaText ?? "",
    canonicalSchemaPath: CANONICAL_SCHEMA_PATH,
    canonicalSchemaSql: canonicalSchemaSql ?? "",
    files: await collectSources(ROOT),
  });
  const comparison = compareWithBaseline(violations, baseline.violations);
  console.log(formatReport(comparison, BASELINE_PATH));
  return comparison.introduced.length + comparison.resolved.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
