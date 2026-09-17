/**
 * The contract build, and the check that the committed artefacts are it.
 *
 * `tools/contracts/generate.ts` was 9,904 lines: `buildOpenApiDocument` hand-
 * encoded every schema a second time as object literals, and a dozen
 * `render*Client` functions printed the TypeScript client as template strings.
 * Its `--check` mode diffed the generator against its own output, so it could
 * only ever catch an artefact somebody had edited by hand — never a route whose
 * Zod had moved on. GAP-022 deleted it.
 *
 * What replaced it is this file and its two neighbours. `document.ts` renders
 * the OpenAPI document from the route registry, `client.ts` renders the
 * compatibility barrel from the authored client modules, and
 * `openapi-typescript` turns the document into the types the client aliases.
 * Every artefact is therefore downstream of the Zod the routes parse with.
 *
 * `--check` proves three things: the committed artefacts equal what a build
 * produces, every route the registry carries is documented unless it says in
 * writing why it is not, and every documented operation is a route the registry
 * carries. The mounted-versus-registered half of the claim belongs to
 * `apps/api/routes_test.ts`, which builds the app and compares what Hono ended
 * up holding; keeping it there is what lets this run without a database, a
 * port, or any of the API's adapters.
 */

import openapiTS, { astToString, type OpenAPI3 } from "openapi-typescript";
import { buildOpenApiDocument } from "./document.ts";
import { readClientModules, renderClientBarrel } from "./client.ts";
import {
  API_ROUTES,
  DOCUMENTED_ROUTES,
} from "../../packages/contracts/routes/mod.ts";

const CONTRACTS = new URL("../../packages/contracts/", import.meta.url);

/** One committed artefact and the text a build says it should hold. */
export interface Artefact {
  readonly path: string;
  readonly contents: string;
}

/** Builds every artefact, in memory. */
export async function buildArtefacts(): Promise<readonly Artefact[]> {
  const document = buildOpenApiDocument();
  // `openapi-typescript` rewrites the document it is handed — it expands a
  // discriminator into an enum on every arm — so it is given a copy, and the
  // committed JSON stays exactly what the registry produced.
  const serialised = `${JSON.stringify(document, null, 2)}\n`;
  const types = astToString(
    await openapiTS(JSON.parse(serialised) as OpenAPI3, {
      immutable: true,
      rootTypes: false,
    }),
  );
  const barrel = renderClientBarrel(await readClientModules());
  return [
    {
      path: "openapi/openapi.json",
      contents: serialised,
    },
    { path: "generated/api-types.ts", contents: types },
    { path: "generated/auth-client.ts", contents: barrel },
  ];
}

/**
 * Proves the registry and the document describe the same surface.
 *
 * A route that is neither documented nor explicitly excused fails here, which
 * is the half of the drift check the old generator could not perform at all.
 */
export function compareRegistryToDocument(
  document: Record<string, unknown>,
): readonly string[] {
  const complaints: string[] = [];
  const paths = document.paths as Record<string, Record<string, unknown>>;
  const documented = new Set<string>();
  for (const [path, operations] of Object.entries(paths)) {
    for (const method of Object.keys(operations)) {
      documented.add(`${method} ${path}`);
    }
  }
  const registered = new Set(
    DOCUMENTED_ROUTES.map((route) => `${route.method} ${route.path}`),
  );
  for (const key of registered) {
    if (!documented.has(key)) {
      complaints.push(`${key} is registered and undocumented`);
    }
  }
  for (const key of documented) {
    if (!registered.has(key)) {
      complaints.push(`${key} is documented and unregistered`);
    }
  }
  for (const route of API_ROUTES) {
    if (route.undocumented === undefined) continue;
    if (route.undocumented.length < 20) {
      complaints.push(
        `${route.operationId} leaves the published document without saying why`,
      );
    }
  }
  return complaints;
}

async function read(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(new URL(path, CONTRACTS));
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const checking = Deno.args.includes("--check");
  const artefacts = await buildArtefacts();
  const document = JSON.parse(artefacts[0]?.contents ?? "{}") as Record<
    string,
    unknown
  >;
  const complaints = [...compareRegistryToDocument(document)];

  if (!checking) {
    for (const artefact of artefacts) {
      await Deno.writeTextFile(
        new URL(artefact.path, CONTRACTS),
        artefact.contents,
      );
    }
  } else {
    for (const artefact of artefacts) {
      const committed = await read(artefact.path);
      if (committed === undefined) {
        complaints.push(`packages/contracts/${artefact.path} is missing`);
      } else if (committed !== artefact.contents) {
        complaints.push(
          `packages/contracts/${artefact.path} is not what a build produces`,
        );
      }
    }
  }

  if (complaints.length > 0) {
    for (const complaint of complaints) console.error(`  ${complaint}`);
    console.error(
      checking
        ? "Run deno task contracts:generate and commit what it writes."
        : "The registry and the document disagree.",
    );
    Deno.exit(1);
  }
  console.log(
    checking
      ? `contracts: ${DOCUMENTED_ROUTES.length} documented routes, ${API_ROUTES.length} mounted, 3 artefacts current`
      : `contracts: wrote ${artefacts.length} artefacts for ${DOCUMENTED_ROUTES.length} documented routes`,
  );
}

if (import.meta.main) await main();
