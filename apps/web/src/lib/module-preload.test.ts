import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chunkGraph,
  facadeChunk,
  modulePreload,
  type OutputEntry,
  pageScripts,
  preloadPages,
  staticClosure,
  withModulePreloads,
} from "./module-preload.ts";

const bundle: Record<string, OutputEntry> = {
  "_astro/page.A1.js": {
    type: "chunk",
    fileName: "_astro/page.A1.js",
    imports: ["_astro/shared.B2.js"],
    facadeModuleId: "D:/repo/apps/web/src/pages/index.astro?astro&type=script",
  },
  "_astro/shared.B2.js": {
    type: "chunk",
    fileName: "_astro/shared.B2.js",
    imports: ["_astro/leaf.C3.js"],
    facadeModuleId: null,
  },
  "_astro/leaf.C3.js": { type: "chunk", fileName: "_astro/leaf.C3.js" },
  "_astro/hero.D4.js": {
    type: "chunk",
    fileName: "_astro/hero.D4.js",
    imports: ["_astro/react.E5.js", "_astro/leaf.C3.js"],
    facadeModuleId: "D:\\repo\\apps\\web\\src\\islands\\person-hero\\mount.tsx",
  },
  "_astro/react.E5.js": { type: "chunk", fileName: "_astro/react.E5.js" },
  "_astro/site.F6.css": { type: "asset", fileName: "_astro/site.F6.css" },
};

const page = (head: string, scripts = "") =>
  `<!DOCTYPE html><html><head><meta charset="UTF-8">${head}</head><body></body></html>${scripts}`;

const script = (chunk: string) =>
  `<script type="module" src="/${chunk}"></script>`;

const links = (...chunks: string[]) =>
  chunks.map((chunk) => `<link rel="modulepreload" href="/${chunk}">`).join(
    "",
  );

describe("module preload graph (FER-02)", () => {
  it("records each chunk's static imports and its facade module", () => {
    const graph = chunkGraph(bundle);
    expect([...graph.imports.keys()].sort()).toEqual([
      "_astro/hero.D4.js",
      "_astro/leaf.C3.js",
      "_astro/page.A1.js",
      "_astro/react.E5.js",
      "_astro/shared.B2.js",
    ]);
    expect(graph.imports.get("_astro/leaf.C3.js")).toEqual([]);
    expect(
      graph.facades.get("D:/repo/apps/web/src/islands/person-hero/mount.tsx"),
    ).toBe("_astro/hero.D4.js");
  });

  it("reads a page's module scripts, once each, and nothing else", () => {
    const html = page(
      '<script>inline()</script><script src="/_astro/classic.Z9.js"></script>',
      [
        script("_astro/page.A1.js"),
        "<SCRIPT TYPE='module' SRC='/_astro/second.G7.js'></SCRIPT>",
        script("_astro/page.A1.js"),
        '<script type="module" src="https://cdn.example/x.js"></script>',
      ].join(""),
    );
    expect(pageScripts(html)).toEqual([
      "_astro/page.A1.js",
      "_astro/second.G7.js",
    ]);
  });

  it("follows static imports transitively, entries first, each once", () => {
    const graph = chunkGraph(bundle);
    expect(staticClosure(["_astro/page.A1.js", "_astro/hero.D4.js"], graph))
      .toEqual([
        "_astro/page.A1.js",
        "_astro/hero.D4.js",
        "_astro/shared.B2.js",
        "_astro/react.E5.js",
        "_astro/leaf.C3.js",
      ]);
    expect(staticClosure([], graph)).toEqual([]);
  });

  it("refuses a chunk the client bundle does not hold", () => {
    expect(() => staticClosure(["_astro/gone.X0.js"], chunkGraph(bundle)))
      .toThrow("_astro/gone.X0.js is not in the client bundle");
  });

  it("finds a dynamic entry by its source module", () => {
    const graph = chunkGraph(bundle);
    expect(facadeChunk(graph, "src/islands/person-hero/mount.tsx")).toBe(
      "_astro/hero.D4.js",
    );
    expect(facadeChunk(graph, "./src/pages/index.astro")).toBe(
      "_astro/page.A1.js",
    );
    expect(() => facadeChunk(graph, "src/islands/missing/mount.tsx")).toThrow(
      "src/islands/missing/mount.tsx is the entry of 0 chunks, not one",
    );
  });

  it("writes one link per missing chunk at the end of the head", () => {
    const html = page(links("_astro/page.A1.js"));
    expect(
      withModulePreloads(html, ["_astro/page.A1.js", "_astro/leaf.C3.js"]),
    ).toBe(page(links("_astro/page.A1.js", "_astro/leaf.C3.js")));
    expect(withModulePreloads(html, ["_astro/page.A1.js"])).toBe(html);
    expect(withModulePreloads("<p>no head</p>", [])).toBe("<p>no head</p>");
    expect(() => withModulePreloads("<p>no head</p>", ["_astro/a.js"]))
      .toThrow("the page has no </head>");
  });
});

describe("module preload pages (FER-02)", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function site(
    files: Record<string, string>,
  ): Promise<URL> {
    dir = await mkdtemp(join(tmpdir(), "module-preload-"));
    for (const [path, html] of Object.entries(files)) {
      await mkdir(join(dir, path, ".."), { recursive: true });
      await writeFile(join(dir, path), html);
    }
    return pathToFileURL(`${dir}/`);
  }

  async function built(root: URL, path: string): Promise<string> {
    return await readFile(new URL(path, root), "utf8");
  }

  it("preloads every page's closure and a page's extra entries", async () => {
    const root = await site({
      "index.html": page("", script("_astro/page.A1.js")),
      "features/index.html": page(""),
      "internal/person/index.html": page("", script("_astro/page.A1.js")),
      "_astro/notes.txt": "not a page",
    });
    const rewritten = await preloadPages(root, chunkGraph(bundle), {
      "internal/person/index.html": ["src/islands/person-hero/mount.tsx"],
    });
    expect(rewritten).toBe(2);
    expect(await built(root, "index.html")).toBe(
      page(
        links("_astro/page.A1.js", "_astro/shared.B2.js", "_astro/leaf.C3.js"),
        script("_astro/page.A1.js"),
      ),
    );
    expect(await built(root, "features/index.html")).toBe(page(""));
    expect(await built(root, "internal/person/index.html")).toBe(
      page(
        links(
          "_astro/page.A1.js",
          "_astro/hero.D4.js",
          "_astro/shared.B2.js",
          "_astro/react.E5.js",
          "_astro/leaf.C3.js",
        ),
        script("_astro/page.A1.js"),
      ),
    );
    expect(await preloadPages(root, chunkGraph(bundle))).toBe(0);
  });

  it("refuses extra entries for a page the build did not write", async () => {
    const root = await site({ "index.html": page("") });
    await expect(
      preloadPages(root, chunkGraph(bundle), {
        "internal/gone/index.html": ["src/islands/person-hero/mount.tsx"],
      }),
    ).rejects.toThrow("the build wrote no internal/gone/index.html");
  });
});

describe("module preload integration (FER-02)", () => {
  type Hooks = Required<ReturnType<typeof modulePreload>["hooks"]>;

  function recorderOf(hooks: Hooks) {
    const updateConfig = vi.fn();
    (hooks["astro:config:setup"] as (options: unknown) => void)({
      updateConfig,
    });
    const [[{ vite }]] = updateConfig.mock.calls as [
      [{ vite: { plugins: [Record<string, unknown>] } }],
    ];
    return vite.plugins[0] as {
      apply: string;
      applyToEnvironment: (environment: { name: string }) => boolean;
      generateBundle: (options: unknown, bundle: unknown) => void;
    };
  }

  it("records the client bundle in the build and rewrites the pages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "module-preload-"));
    try {
      await writeFile(
        join(dir, "index.html"),
        page("", script("_astro/page.A1.js")),
      );
      const hooks = modulePreload().hooks as Hooks;
      const recorder = recorderOf(hooks);
      expect(recorder.apply).toBe("build");
      expect(recorder.applyToEnvironment({ name: "client" })).toBe(true);
      expect(recorder.applyToEnvironment({ name: "ssr" })).toBe(false);
      recorder.generateBundle({}, bundle);
      const logger = { info: vi.fn() };
      await (hooks["astro:build:done"] as (options: unknown) => Promise<void>)(
        { dir: pathToFileURL(`${dir}/`), logger },
      );
      expect(logger.info).toHaveBeenCalledWith(
        "preloaded the module graph of 1 pages",
      );
      expect(await readFile(join(dir, "index.html"), "utf8")).toContain(
        links("_astro/page.A1.js", "_astro/shared.B2.js", "_astro/leaf.C3.js"),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails the build when the client bundle was never recorded", async () => {
    const hooks = modulePreload().hooks as Hooks;
    await expect(
      (hooks["astro:build:done"] as (options: unknown) => Promise<void>)({
        dir: new URL("file:///nowhere/"),
        logger: { info: vi.fn() },
      }),
    ).rejects.toThrow("the client bundle was not recorded");
  });
});
