/**
 * What `astro build` ships to the browser (GAP-026, GAP-027, GAP-028).
 *
 * ADR 0006 lets React run only inside hydrated islands: static, public, and
 * no-JavaScript pages ship none, and every island's hydrated bytes are
 * measured. This suite reads the client output the build just wrote, follows
 * every script a page can load — static imports, dynamic imports, and the
 * preload lists Vite writes for them — and fails when a public page can reach
 * a chunk that carries React. Protected pages load React for one island in
 * their layout, the people palette; the person page adds its own islands —
 * the hero, the rail summary, the timeline, life events, and gifts — each
 * loaded on demand. Every island's bytes are measured, so the evidence line
 * records real numbers.
 *
 * It needs `apps/web/dist`, so it runs from the `build` verb right after
 * `astro build` rather than in the aggregate unit gate.
 */

const CLIENT = new URL("../apps/web/dist/client/", import.meta.url);

/**
 * Strings only React's own runtime contains: the React 19 element symbol and
 * react-dom's internals handle. A chunk with either carries React.
 */
const REACT_MARKERS = [
  "react.transitional.element",
  "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
];

/** The prerendered public pages the page catalog serves as static files. */
const PUBLIC_PAGES = [
  "404.html",
  "auth/forgot-password/index.html",
  "auth/sign-in/index.html",
  "auth/sign-up/index.html",
  "features/index.html",
  "index.html",
  "privacy/index.html",
  "terms/index.html",
];

/** The static person shell, which loads its islands lazily. */
const PERSON_SHELL = "internal/person-profile-shell/index.html";

/** A protected page with no island of its own: Today. */
const TODAY = "app/index.html";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const decoder = new TextDecoder();
const cache = new Map<string, string>();

async function read(path: string): Promise<string> {
  const known = cache.get(path);
  if (known !== undefined) return known;
  const text = decoder.decode(await Deno.readFile(new URL(path, CLIENT)));
  cache.set(path, text);
  return text;
}

/** Every `_astro/*.js` chunk a piece of HTML or JavaScript names. */
export function chunkReferences(source: string, from = ""): string[] {
  const found = new Set<string>();
  const base = from.slice(0, from.lastIndexOf("/") + 1);
  for (const [, name] of source.matchAll(/["'`(]\/?_astro\/([\w.-]+\.js)/g)) {
    found.add(`_astro/${name}`);
  }
  for (const [, name] of source.matchAll(/["'`]\.\/([\w.-]+\.js)["'`]/g)) {
    found.add(`${base}${name}`);
  }
  return [...found].sort();
}

export function carriesReact(source: string): boolean {
  return REACT_MARKERS.some((marker) => source.includes(marker));
}

/** The chunks a page or chunk can load, itself excluded, transitively. */
async function reachable(entries: readonly string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  const pending = [...entries];
  while (pending.length > 0) {
    const chunk = pending.pop()!;
    if (seen.has(chunk)) continue;
    seen.add(chunk);
    pending.push(...chunkReferences(await read(chunk), chunk));
  }
  return seen;
}

async function reactChunksOf(page: string): Promise<string[]> {
  const html = await read(page);
  const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map(([, body]) => body ?? "");
  assert(
    !inline.some(carriesReact),
    `${page} inlines React into a script`,
  );
  const chunks = await reachable(chunkReferences(html, page));
  const react: string[] = [];
  for (const chunk of chunks) {
    if (carriesReact(await read(chunk))) react.push(chunk);
  }
  return react.sort();
}

async function gzipSize(path: string): Promise<number> {
  const compressed = new Blob([await Deno.readFile(new URL(path, CLIENT))])
    .stream().pipeThrough(new CompressionStream("gzip"));
  return (await new Response(compressed).arrayBuffer()).byteLength;
}

Deno.test("[GAP-026] the chunk reader finds every way a script names a chunk", () => {
  const html =
    '<script type="module" src="/_astro/page.A1.js"></script><link rel="modulepreload" href="/_astro/shared.B2.js">';
  assert(
    JSON.stringify(chunkReferences(html, "index.html")) ===
      JSON.stringify(["_astro/page.A1.js", "_astro/shared.B2.js"]),
    "page scripts and preloads are chunk references",
  );
  const chunk =
    'import{a}from"./react.C3.js";import"./side.D4.js";const m=()=>import("./lazy.E5.js");m.f||(m.f=["_astro/island.F6.js"]);';
  assert(
    JSON.stringify(chunkReferences(chunk, "_astro/page.A1.js")) ===
      JSON.stringify([
        "_astro/island.F6.js",
        "_astro/lazy.E5.js",
        "_astro/react.C3.js",
        "_astro/side.D4.js",
      ]),
    "static, bare, dynamic, and preload-map imports are chunk references",
  );
  assert(carriesReact('Symbol.for("react.transitional.element")'), "React");
  assert(!carriesReact("export const reaction = 1;"), "not React");
});

Deno.test("[GAP-026] public pages ship no React", async () => {
  for (const page of PUBLIC_PAGES) {
    const react = await reactChunksOf(page);
    assert(
      react.length === 0,
      `${page} can load React through ${react.join(", ")}`,
    );
  }
});

/** The chunks whose source names island `name` as a string. */
async function islandEntries(name: string): Promise<string[]> {
  const pattern = new RegExp(`["'\`]${name}["'\`]`);
  const entries: string[] = [];
  for await (const entry of Deno.readDir(new URL("_astro/", CLIENT))) {
    const chunk = `_astro/${entry.name}`;
    if (!entry.name.endsWith(".js")) continue;
    if (pattern.test(await read(chunk))) entries.push(chunk);
  }
  return entries.sort();
}

/** The layout script that mounts the people palette on every protected page. */
async function paletteScript(): Promise<string> {
  const entries = await islandEntries("global-people-search");
  assert(entries.length === 1, `one palette island entry, not ${entries}`);
  const entry = entries[0]!;
  assert(
    /ApplicationLayout\.astro_astro_type_script_/.test(entry),
    `the palette mounts from the application layout, not ${entry}`,
  );
  return entry;
}

function eagerScripts(html: string): Set<string> {
  return new Set(
    [...html.matchAll(/<script\b[^>]*\bsrc="\/(_astro\/[\w.-]+\.js)"/g)].map((
      [, chunk],
    ) => chunk!),
  );
}

async function logHydratedBytes(
  name: string,
  entry: string,
  react: readonly string[],
): Promise<void> {
  const runtime = [...await reachable([entry])].filter((chunk) =>
    chunk !== entry && react.includes(chunk)
  ).sort();
  const entryBytes = await gzipSize(entry);
  let runtimeBytes = 0;
  for (const chunk of runtime) runtimeBytes += await gzipSize(chunk);
  console.log(
    `${name} island hydrated bytes (gzip): entry ${entry} ${entryBytes} B + React runtime ${
      runtime.join(", ")
    } ${runtimeBytes} B = ${entryBytes + runtimeBytes} B`,
  );
}

Deno.test("[GAP-027] no page script but the palette's and the person shell's can reach React", async () => {
  // Pages rendered on demand (auth resets, invitations) have no HTML in the
  // client output, but their scripts do: every page script is checked.
  const palette = await paletteScript();
  let scripts = 0;
  for await (const entry of Deno.readDir(new URL("_astro/", CLIENT))) {
    const chunk = `_astro/${entry.name}`;
    if (!/.astro_astro_type_script_.*.js$/.test(entry.name)) continue;
    scripts += 1;
    if (chunk === palette || /^person-profile-shell\./.test(entry.name)) {
      continue;
    }
    for (const loaded of await reachable([chunk])) {
      assert(
        !carriesReact(await read(loaded)),
        `${chunk} can load React through ${loaded}`,
      );
    }
  }
  assert(scripts > 10, `the build wrote page scripts, found ${scripts}`);
});

Deno.test("[GAP-027] a protected page loads React only for the people palette", async () => {
  const palette = await paletteScript();
  const react = await reactChunksOf(TODAY);
  assert(react.length > 0, "Today can load the palette island");
  assert(
    eagerScripts(await read(TODAY)).has(palette),
    "Today mounts the palette from its layout",
  );
  const fromPalette = await reachable([palette]);
  for (const chunk of react) {
    assert(
      fromPalette.has(chunk),
      `${chunk} carries React outside the palette`,
    );
  }
  await logHydratedBytes("global-people-search", palette, react);
});

/**
 * The person shell's islands (GAP-026, GAP-028), each loaded on demand by the
 * shell's script rather than shipped as a page script: the hero and the rail
 * summary as soon as the person resolves, the timeline and life events with
 * the Timeline zone, and gifts and debts with the Things zone.
 */
const PERSON_ISLANDS = [
  "person-hero",
  "person-rail",
  "person-timeline",
  "person-life-events",
  "person-gifts",
] as const;

Deno.test("[GAP-028] the person shell loads each of its islands on demand", async () => {
  const react = await reactChunksOf(PERSON_SHELL);
  const fromPalette = await reachable([await paletteScript()]);
  const html = await read(PERSON_SHELL);
  const fromShell = await reachable(chunkReferences(html, PERSON_SHELL));
  for (const name of PERSON_ISLANDS) {
    const island = await islandEntries(name);
    assert(island.length === 1, `one ${name} island entry, not ${island}`);
    const entry = island[0]!;
    assert(fromShell.has(entry), `the person shell can load ${name}`);
    assert(!eagerScripts(html).has(entry), `${name} is not a page script`);
    assert(!fromPalette.has(entry), `${name} does not load with the palette`);
    await logHydratedBytes(name, entry, react);
  }
});

Deno.test("[GAP-027] no chunk ships cmdk's unused Radix Dialog", async () => {
  // cmdk attaches a Radix-based Command.Dialog the palette never renders;
  // astro.config.mjs aliases it to a stub so Radix's dialog, focus scope,
  // dismissable layer, and scroll lock stay beside Base UI, not in the build.
  const markers = [
    "DismissableLayer",
    "FocusScope",
    "data-radix",
    "RemoveScroll",
  ];
  for await (const entry of Deno.readDir(new URL("_astro/", CLIENT))) {
    if (!entry.name.endsWith(".js")) continue;
    const source = await read(`_astro/${entry.name}`);
    const found = markers.filter((marker) => source.includes(marker));
    assert(
      found.length === 0,
      `_astro/${entry.name} ships Radix Dialog (${found.join(", ")})`,
    );
  }
});

/**
 * The body of the built `@layer utilities { … }` block. The protected pages'
 * stylesheet bundles the hand-written CSS and the Tailwind layers into one
 * file (GAP-027), so the block is cut out by its braces.
 */
async function utilitiesLayer(): Promise<string> {
  let built = "";
  for await (const entry of Deno.readDir(new URL("_astro/", CLIENT))) {
    if (!entry.name.endsWith(".css")) continue;
    const css = await read(`_astro/${entry.name}`);
    if (/@layer utilities\s*\{/.test(css)) built = css;
  }
  assert(built.length > 0, "the build wrote the Tailwind utilities");
  const open = built.indexOf("{", built.search(/@layer utilities\s*\{/));
  let depth = 0;
  for (let index = open; index < built.length; index += 1) {
    if (built[index] === "{") depth += 1;
    else if (built[index] === "}" && --depth === 0) {
      return built.slice(open + 1, index);
    }
  }
  throw new Error("the utilities layer is not closed");
}

Deno.test("[GAP-027] the Kinship variants compile to utilities over the tokens", async () => {
  // Representative classes of every variant in components/ui/variants.ts,
  // and the declaration each must produce.
  const utilities = (await utilitiesLayer()).replace(/\s+/g, " ")
    .replaceAll(": ", ":");
  const expected: readonly (readonly [string, string])[] = [
    [String.raw`.min-h-11{`, "min-height:calc(var(--spacing) * 11)"],
    [String.raw`.px-\(--space-4\){`, "padding-inline:var(--space-4)"],
    [String.raw`.py-\(--space-3\){`, "padding-block:var(--space-3)"],
    [String.raw`.rounded-\[\.65rem\]{`, "border-radius:.65rem"],
    [String.raw`.bg-primary{`, "background-color:var(--primary)"],
    [String.raw`.border-input{`, "border-color:var(--input)"],
    [String.raw`.bg-\(--accent\){`, "background-color:var(--accent)"],
    [String.raw`.p-\(--pad-card\){`, "padding:var(--pad-card)"],
    [
      String.raw`.border-\(--line-hairline\){`,
      "border-color:var(--line-hairline)",
    ],
    [String.raw`.animate-skeleton{`, "animation:var(--animate-skeleton)"],
    [
      String.raw`.aria-pressed\:bg-primary[aria-pressed=true]{`,
      "background-color:var(--primary)",
    ],
    [String.raw`.motion-reduce\:animate-none{`, "animation:none"],
    [
      String
        .raw`:where([data-section-state=error]) .in-data-\[section-state\=error\]\:bg-\(--accent-soft\){`,
      "background-color:var(--accent-soft)",
    ],
  ];
  for (const [selector, declaration] of expected) {
    const at = utilities.indexOf(selector);
    assert(at >= 0, `${selector} is generated`);
    assert(
      utilities.slice(at + selector.length).startsWith(declaration),
      `${selector} declares ${declaration}`,
    );
  }
});

Deno.test("[GAP-026] no Tailwind utility shares a name with a hand-written class", async () => {
  // Tailwind generates a utility for every candidate word in the scanned
  // sources, which include the Astro templates and the vanilla modules
  // (GAP-027). One named like a class the existing stylesheets style would
  // restyle every vanilla element that carries it.
  const utilities = await utilitiesLayer();
  const generated = new Set(
    [...utilities.matchAll(/\.((?:\.|[\w-])+)/g)].map(([, name]) => name!),
  );
  const styles = new URL("../apps/web/src/styles/", import.meta.url);
  const handWritten = new Set<string>();
  for await (const entry of Deno.readDir(styles)) {
    if (!entry.name.endsWith(".css") || entry.name === "islands.css") continue;
    const css = (await Deno.readTextFile(new URL(entry.name, styles)))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, name] of css.matchAll(/\.([a-zA-Z_][\w-]*)/g)) {
      handWritten.add(name!);
    }
  }
  // `sr-only` means the same visually hidden text in both.
  const shared = [...generated].filter((name) =>
    handWritten.has(name) && name !== "sr-only"
  );
  assert(
    shared.length === 0,
    `utilities collide with hand-written classes: ${shared.join(", ")}`,
  );
});
