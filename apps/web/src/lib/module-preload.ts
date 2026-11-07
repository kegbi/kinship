/**
 * Module preloads for every built page (FER-02).
 *
 * Astro writes each page's module scripts after `</html>` and no
 * `modulepreload` for their imports, so the browser discovers the module graph
 * one import level at a time. This build-only integration records the client
 * bundle's static import graph and, once the build is done, writes one
 * `<link rel="modulepreload">` into each built page's `<head>` for every chunk
 * in the static import closure of the page's scripts. Dynamic imports stay
 * lazy: the header's islands (FER-01) and every other on-demand chunk are not
 * preloaded, so a page that loads no React eagerly preloads none either. A page
 * may name extra dynamic entries it always loads (the person shell's hero,
 * rail, and fact sections); their static closures are preloaded too.
 *
 * Every link names a same-origin fingerprinted `/_astro/` chunk, so the CSP's
 * `script-src 'self'` covers it and no inline script is added. It runs inside
 * `astro build`, before the production image pre-compresses the HTML.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import type { AstroIntegration } from "astro";
import type { Plugin } from "vite";

/** The part of a Rollup output entry the graph needs. */
export interface OutputEntry {
  readonly type: string;
  readonly fileName: string;
  readonly imports?: readonly string[];
  readonly facadeModuleId?: string | null;
}

/** The client bundle's static import graph, by output file name. */
export interface ChunkGraph {
  readonly imports: ReadonlyMap<string, readonly string[]>;
  readonly facades: ReadonlyMap<string, string>;
}

export interface ModulePreloadOptions {
  /**
   * Per built page (its path under the client output, such as
   * `internal/person-profile-shell/index.html`), the source modules (paths
   * relative to the Astro root) of the dynamic entries it always loads.
   */
  readonly extraEntries?: Readonly<Record<string, readonly string[]>>;
}

/** Records each chunk's static imports and the module it is the facade of. */
export function chunkGraph(
  bundle: Readonly<Record<string, OutputEntry>>,
): ChunkGraph {
  const imports = new Map<string, readonly string[]>();
  const facades = new Map<string, string>();
  for (const entry of Object.values(bundle)) {
    if (entry.type !== "chunk") continue;
    imports.set(entry.fileName, [...entry.imports ?? []]);
    if (entry.facadeModuleId) {
      facades.set(entry.facadeModuleId.replaceAll("\\", "/"), entry.fileName);
    }
  }
  return { imports, facades };
}

/** The `_astro/` chunks a page's module scripts load, in document order. */
export function pageScripts(html: string): string[] {
  const scripts: string[] = [];
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype\s*=\s*["']?module\b/i.test(tag)) continue;
    const chunk = tag.match(/\bsrc\s*=\s*["']\/(_astro\/[\w.-]+\.js)["']/i)
      ?.[1];
    if (chunk && !scripts.includes(chunk)) scripts.push(chunk);
  }
  return scripts;
}

/** The chunk whose facade is the source module ending in `module`. */
export function facadeChunk(graph: ChunkGraph, module: string): string {
  const suffix = `/${module.replace(/^\.?\//, "")}`;
  const matches = [...graph.facades].filter(([id]) =>
    id.split("?")[0]!.endsWith(suffix)
  );
  if (matches.length !== 1) {
    throw new Error(
      `module preload: ${module} is the entry of ${matches.length} chunks, not one`,
    );
  }
  return matches[0]![1];
}

/** `entries` and every chunk they import statically, transitively. */
export function staticClosure(
  entries: readonly string[],
  graph: ChunkGraph,
): string[] {
  const seen: string[] = [];
  const pending = [...entries];
  while (pending.length > 0) {
    const chunk = pending.shift()!;
    if (seen.includes(chunk)) continue;
    const imports = graph.imports.get(chunk);
    if (!imports) {
      throw new Error(`module preload: ${chunk} is not in the client bundle`);
    }
    seen.push(chunk);
    pending.push(...imports);
  }
  return seen;
}

/** `html` with a `modulepreload` link for each chunk it does not yet have. */
export function withModulePreloads(
  html: string,
  chunks: readonly string[],
): string {
  const links = chunks
    .filter((chunk) => !html.includes(`rel="modulepreload" href="/${chunk}"`))
    .map((chunk) => `<link rel="modulepreload" href="/${chunk}">`);
  if (links.length === 0) return html;
  const head = html.indexOf("</head>");
  if (head < 0) throw new Error("module preload: the page has no </head>");
  return `${html.slice(0, head)}${links.join("")}${html.slice(head)}`;
}

/** Every `.html` file under `dir`, as paths relative to it. */
async function htmlFiles(dir: URL, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (
    const entry of await readdir(new URL(prefix || ".", dir), {
      withFileTypes: true,
    })
  ) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...await htmlFiles(dir, `${path}/`));
    else if (entry.name.endsWith(".html")) files.push(path);
  }
  return files.sort();
}

/** Writes the preloads into every built page under `dir`. */
export async function preloadPages(
  dir: URL,
  graph: ChunkGraph,
  extraEntries: Readonly<Record<string, readonly string[]>> = {},
): Promise<number> {
  const pages = await htmlFiles(dir);
  for (const page of Object.keys(extraEntries)) {
    if (!pages.includes(page)) {
      throw new Error(`module preload: the build wrote no ${page}`);
    }
  }
  let rewritten = 0;
  for (const page of pages) {
    const file = new URL(page, dir);
    const html = await readFile(file, "utf8");
    const entries = [
      ...pageScripts(html),
      ...(extraEntries[page] ?? []).map((module) => facadeChunk(graph, module)),
    ];
    const preloaded = withModulePreloads(html, staticClosure(entries, graph));
    if (preloaded === html) continue;
    await writeFile(file, preloaded);
    rewritten += 1;
  }
  return rewritten;
}

/** The Astro integration: record the client graph, then rewrite the pages. */
export function modulePreload(
  options: ModulePreloadOptions = {},
): AstroIntegration {
  let graph: ChunkGraph | undefined;
  const recorder: Plugin = {
    name: "kinship-module-preload-graph",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle(_options, bundle) {
      graph = chunkGraph(bundle as Record<string, OutputEntry>);
    },
  };
  return {
    name: "kinship-module-preload",
    hooks: {
      "astro:config:setup": ({ updateConfig }) => {
        updateConfig({ vite: { plugins: [recorder] } });
      },
      "astro:build:done": async ({ dir, logger }) => {
        if (!graph) {
          throw new Error("module preload: the client bundle was not recorded");
        }
        const rewritten = await preloadPages(dir, graph, options.extraEntries);
        logger.info(`preloaded the module graph of ${rewritten} pages`);
      },
    },
  };
}
