/**
 * What `astro build` ships to the browser (GAP-026, GAP-027, GAP-028).
 *
 * ADR 0006 lets React run only inside hydrated islands: static, public, and
 * no-JavaScript pages ship none, and every island's hydrated bytes are
 * measured. This suite reads the client output the build just wrote, follows
 * every script a page can load — static imports, dynamic imports, and the
 * preload lists Vite writes for them — and fails when a public page can reach
 * a chunk that carries React. A protected page's layout loads none until it
 * is asked (FER-01): the header's three islands — the people palette, Quick
 * capture, and the notification bell — are separate dynamic imports of the
 * layout script, made only for a signed-in member. The person page adds its
 * own islands —
 * the hero, the rail summary, the timeline, life events, gifts, files, the
 * audit summary, and the seven profile fact sections — each loaded on
 * demand — and the protected pages in `PAGE_ISLANDS` (Today, the journal,
 * people, tasks, and every settings page) mount theirs from their own page
 * script, as the on-demand pages in `ON_DEMAND_ISLANDS` (the required legal
 * review) do. Every island's bytes are measured, so the evidence line
 * records real numbers. Each page preloads exactly the static import closure
 * of its scripts (FER-02), and the person shell also the hero, rail, and fact
 * sections it always mounts, so no lazy chunk and no React is preloaded where
 * the page would not load it eagerly.
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
  "docs/api/index.html",
  "index.html",
  "privacy/index.html",
  "terms/index.html",
];

/** The static person shell, which loads its islands lazily. */
const PERSON_SHELL = "internal/person-profile-shell/index.html";

/** A protected page with no island of its own: the settings overview. */
const SHELL_ONLY_PAGE = "app/settings/index.html";

/**
 * The protected pages whose own script mounts islands (GAP-031, GAP-033),
 * and the islands each one mounts.
 */
const PAGE_ISLANDS: Readonly<Record<string, readonly string[]>> = {
  "app/index.html": [
    "today-attention",
    "today-reminders",
    "today-recent-people",
    "today-favorite-notes",
    "today-recent-activity",
  ],
  "app/journal/index.html": ["journal-surface"],
  "app/people/archived/index.html": ["people-directory"],
  "app/people/index.html": ["people-directory"],
  "app/people/new/index.html": ["people-create"],
  "app/settings/api/index.html": ["settings-api-access"],
  "app/settings/audit/index.html": ["audit-history"],
  "app/settings/export/index.html": ["settings-exports"],
  "app/settings/import/index.html": ["settings-import-history"],
  "app/settings/import/new/index.html": ["settings-import-new"],
  "app/settings/integrations/index.html": ["settings-integrations"],
  "app/settings/members/index.html": ["settings-members"],
  "app/settings/personalization/index.html": ["settings-personalization"],
  "app/settings/preferences/index.html": ["settings-preferences"],
  "app/settings/profile/index.html": [
    "settings-profile",
    "settings-personal-lifecycle",
  ],
  "app/settings/security/index.html": ["settings-security"],
  "app/settings/storage/index.html": ["settings-storage"],
  "app/settings/workspace/danger-zone/index.html": [
    "settings-workspace-danger",
  ],
  "app/settings/workspace/index.html": ["settings-workspace"],
  "app/tasks/index.html": ["tasks-page"],
  "internal/activity-report-shell/index.html": ["activity-report"],
  "internal/import-report-shell/index.html": ["settings-import-report"],
  "internal/journal-item-shell/index.html": ["journal-surface"],
  "internal/person-audit-shell/index.html": ["audit-history"],
};

/**
 * The protected pages rendered on demand whose own script mounts islands
 * (GAP-033): they have no HTML in the client output, so each is found by
 * its page script's name, and the islands it mounts.
 */
const ON_DEMAND_ISLANDS: Readonly<Record<string, readonly string[]>> = {
  compliance: ["compliance-review"],
};

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

/**
 * The chunks a piece of HTML or JavaScript loads before it runs: the page's
 * script tags and preload links, and a chunk's static `import … from` and
 * bare `import` statements. Dynamic `import()` calls and the preload lists
 * Vite writes for them load only when the code asks, so they are not here.
 */
export function eagerChunkReferences(source: string, from = ""): string[] {
  const found = new Set<string>();
  const base = from.slice(0, from.lastIndexOf("/") + 1);
  for (
    const [, name] of source.matchAll(
      /<(?:script\b[^>]*\bsrc|link\b[^>]*\bhref)="\/?_astro\/([\w.-]+\.js)"/g,
    )
  ) {
    found.add(`_astro/${name}`);
  }
  for (
    const [, name] of source.matchAll(
      /\b(?:import|from)\s*["']\.\/([\w.-]+\.js)["']/g,
    )
  ) {
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

/** The chunks a page or chunk loads before it runs, transitively. */
async function eagerlyReachable(
  entries: readonly string[],
): Promise<Set<string>> {
  const seen = new Set<string>();
  const pending = [...entries];
  while (pending.length > 0) {
    const chunk = pending.pop()!;
    if (seen.has(chunk)) continue;
    seen.add(chunk);
    pending.push(...eagerChunkReferences(await read(chunk), chunk));
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

Deno.test("[FER-01] the eager chunk reader skips dynamic imports and their preload lists", () => {
  const html =
    '<script type="module" src="/_astro/page.A1.js"></script><link rel="modulepreload" href="/_astro/shared.B2.js">';
  assert(
    JSON.stringify(eagerChunkReferences(html, "index.html")) ===
      JSON.stringify(["_astro/page.A1.js", "_astro/shared.B2.js"]),
    "page scripts and preloads load eagerly",
  );
  const chunk =
    'import{a}from"./react.C3.js";import"./side.D4.js";const m=()=>import(`./lazy.E5.js`);m.f||(m.f=["_astro/island.F6.js"]);';
  assert(
    JSON.stringify(eagerChunkReferences(chunk, "_astro/page.A1.js")) ===
      JSON.stringify(["_astro/react.C3.js", "_astro/side.D4.js"]),
    "only static and bare imports load eagerly",
  );
});

Deno.test("[FER-01] a protected page with no island of its own references no React chunk eagerly", async () => {
  const eager = await eagerlyReachable(
    eagerChunkReferences(await read(SHELL_ONLY_PAGE), SHELL_ONLY_PAGE),
  );
  const react: string[] = [];
  for (const chunk of eager) {
    if (carriesReact(await read(chunk))) react.push(chunk);
  }
  assert(
    react.length === 0,
    `${SHELL_ONLY_PAGE} loads React before anyone asks: ${react.sort()}`,
  );
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

/** The one page script an on-demand page named `page` ships. */
async function onDemandScript(page: string): Promise<string> {
  const scripts: string[] = [];
  const pattern = new RegExp(`^${page}\\.astro_astro_type_script_.*\\.js$`);
  for await (const entry of Deno.readDir(new URL("_astro/", CLIENT))) {
    if (pattern.test(entry.name)) scripts.push(`_astro/${entry.name}`);
  }
  assert(scripts.length === 1, `one ${page} page script, not ${scripts}`);
  return scripts[0]!;
}

function eagerScripts(html: string): Set<string> {
  return new Set(
    [...html.matchAll(/<script\b[^>]*\bsrc="\/(_astro\/[\w.-]+\.js)"/g)].map((
      [, chunk],
    ) => chunk!),
  );
}

/** The header's islands (FER-01), each a dynamic import of the layout. */
const SHELL_ISLANDS = [
  "global-people-search",
  "quick-capture",
  "notification-bell",
] as const;

/** The one layout script every protected page loads. */
async function layoutScript(): Promise<string> {
  const scripts = [...eagerScripts(await read(SHELL_ONLY_PAGE))].filter((
    chunk,
  ) => /ApplicationLayout\.astro_astro_type_script_/.test(chunk));
  assert(scripts.length === 1, `one layout script, not ${scripts}`);
  return scripts[0]!;
}

/** The entry chunk of the header's island `name`. */
async function shellIslandEntry(name: string): Promise<string> {
  const entries = await islandEntries(name);
  assert(entries.length === 1, `one ${name} island entry, not ${entries}`);
  return entries[0]!;
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

/**
 * A protected page's own script (GAP-031, GAP-033), which mounts its
 * islands: the one page script the page loads beyond its layout's.
 */
async function pageScript(page: string): Promise<string> {
  const scripts = [...eagerScripts(await read(page))].filter((chunk) =>
    !/ApplicationLayout\.astro_astro_type_script_/.test(chunk) &&
    /\.astro_astro_type_script_/.test(chunk)
  );
  assert(scripts.length === 1, `one ${page} page script, not ${scripts}`);
  return scripts[0]!;
}

Deno.test("[GAP-027] no page script but the layout's, the person shell's, and the island pages' can reach React", async () => {
  // Pages rendered on demand (auth resets, invitations) have no HTML in the
  // client output, but their scripts do: every page script is checked. The
  // layout's reaches React only through its islands' dynamic imports (FER-01).
  const allowed = new Set([await layoutScript()]);
  for (const page of Object.keys(PAGE_ISLANDS)) {
    allowed.add(await pageScript(page));
  }
  for (const page of Object.keys(ON_DEMAND_ISLANDS)) {
    allowed.add(await onDemandScript(page));
  }
  let scripts = 0;
  for await (const entry of Deno.readDir(new URL("_astro/", CLIENT))) {
    const chunk = `_astro/${entry.name}`;
    if (!/.astro_astro_type_script_.*.js$/.test(entry.name)) continue;
    scripts += 1;
    if (allowed.has(chunk) || /^person-profile-shell\./.test(entry.name)) {
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

Deno.test("[FER-01] the signed-out shell reaches no React: the header's islands are three on-demand imports", async () => {
  const layout = await layoutScript();
  const eager = await eagerlyReachable([layout]);
  for (const chunk of eager) {
    assert(
      !carriesReact(await read(chunk)),
      `the layout script loads React before a session is ready: ${chunk}`,
    );
  }
  const fromLayout = await reachable([layout]);
  const entries: string[] = [];
  for (const name of SHELL_ISLANDS) {
    const entry = await shellIslandEntry(name);
    assert(fromLayout.has(entry), `the layout can load ${name}`);
    assert(!eager.has(entry), `${name} loads only when it is asked for`);
    entries.push(entry);
  }
  for (const entry of entries) {
    const closure = await eagerlyReachable([entry]);
    for (const other of entries) {
      assert(
        other === entry || !closure.has(other),
        `${entry} loads ${other} with it`,
      );
    }
  }
});

Deno.test("[GAP-027] [FER-01] a protected page with no island of its own can load React only for the header's islands", async () => {
  const react = await reactChunksOf(SHELL_ONLY_PAGE);
  assert(react.length > 0, "the page can load the header's islands");
  const entries: string[] = [];
  for (const name of SHELL_ISLANDS) entries.push(await shellIslandEntry(name));
  const fromIslands = await reachable(entries);
  for (const chunk of react) {
    assert(
      fromIslands.has(chunk),
      `${chunk} carries React outside the header's islands`,
    );
  }
  for (const [index, name] of SHELL_ISLANDS.entries()) {
    await logHydratedBytes(name, entries[index]!, react);
  }
});

/**
 * The person shell's islands (GAP-026, GAP-028, GAP-029, GAP-031), each
 * loaded on demand by the shell's script rather than shipped as a page script:
 * the hero and the rail summary as soon as the person resolves; important
 * dates, relationships, the profile fact sections, and the tags editor with
 * the rail; the timeline, life events, notes and activities, and calls and
 * conversations with the Timeline zone; tasks with the Planning zone;
 * reminders, which also draw the rail's stay-in-touch block, with whichever of
 * the rail and the Planning zone activates first; gifts and debts, and
 * documents and photos, with the Things zone; and the audit summary with the
 * Admin zone.
 */
const PERSON_ISLANDS = [
  "person-hero",
  "person-rail",
  "person-fact-contact-methods",
  "person-fact-addresses",
  "person-fact-work",
  "person-fact-pets",
  "person-fact-food-preferences",
  "person-fact-first-meeting",
  "person-fact-tags",
  "person-timeline",
  "person-life-events",
  "person-interactions",
  "person-communications",
  "person-gifts",
  "person-important-dates",
  "person-relationships",
  "person-reminders",
  "person-tasks",
  "person-files",
  "person-audit-summary",
] as const;

Deno.test("[GAP-028] the person shell loads each of its islands on demand", async () => {
  const react = await reactChunksOf(PERSON_SHELL);
  const fromLayout = await reachable([await layoutScript()]);
  const html = await read(PERSON_SHELL);
  const fromShell = await reachable(chunkReferences(html, PERSON_SHELL));
  for (const name of PERSON_ISLANDS) {
    const island = await islandEntries(name);
    assert(island.length === 1, `one ${name} island entry, not ${island}`);
    const entry = island[0]!;
    assert(fromShell.has(entry), `the person shell can load ${name}`);
    assert(!eagerScripts(html).has(entry), `${name} is not a page script`);
    assert(!fromLayout.has(entry), `${name} does not load with the layout`);
    await logHydratedBytes(name, entry, react);
  }
});

Deno.test("[GAP-031] [GAP-033] each island page loads its islands from its own script", async () => {
  const fromLayout = await reachable([await layoutScript()]);
  for (const [page, islands] of Object.entries(PAGE_ISLANDS)) {
    const react = await reactChunksOf(page);
    const script = await pageScript(page);
    const fromScript = await reachable([script]);
    for (const chunk of react) {
      assert(
        fromLayout.has(chunk) || fromScript.has(chunk),
        `${page} carries React through ${chunk} outside its islands`,
      );
    }
    for (const name of islands) {
      const [entry, ...others] = await islandEntries(name);
      assert(entry && others.length === 0, `one ${name} island entry`);
      assert(fromScript.has(entry), `${page}'s script loads ${name}`);
      assert(!fromLayout.has(entry), `${name} does not load with the layout`);
      await logHydratedBytes(`${page} ${name}`, entry, react);
    }
  }
});

/**
 * The public pages rendered on demand (GAP-033): their HTML is not in the
 * client output, so they are named by the page scripts the build wrote.
 */
const ON_DEMAND_PUBLIC_SCRIPTS = [
  /^mfa\.astro_astro_type_script_/,
  /^reset-password\.astro_astro_type_script_/,
  /^verify-email\.astro_astro_type_script_/,
  /^_token_\.astro_astro_type_script_/,
] as const;

Deno.test("[GAP-033] no public page, prerendered or on demand, reaches React or builds an element", async () => {
  const entries: string[] = [];
  for (const page of PUBLIC_PAGES) {
    entries.push(...chunkReferences(await read(page), page));
  }
  const names: string[] = [];
  for await (const entry of Deno.readDir(new URL("_astro/", CLIENT))) {
    names.push(entry.name);
  }
  for (const pattern of ON_DEMAND_PUBLIC_SCRIPTS) {
    const matched = names.filter((name) => pattern.test(name));
    assert(
      matched.length === 1,
      `${pattern} names one on-demand page script, not ${matched}`,
    );
    entries.push(`_astro/${matched[0]}`);
  }
  for (const chunk of await reachable(entries)) {
    const source = await read(chunk);
    assert(!carriesReact(source), `${chunk} carries React to a public page`);
    assert(
      !source.includes("createElement("),
      `${chunk} builds an element on a public page`,
    );
  }
});

Deno.test("[GAP-033] each on-demand island page loads its islands from its own script", async () => {
  const fromLayout = await reachable([await layoutScript()]);
  for (const [page, islands] of Object.entries(ON_DEMAND_ISLANDS)) {
    const script = await onDemandScript(page);
    const fromScript = await reachable([script]);
    const react: string[] = [];
    for (const chunk of fromScript) {
      if (carriesReact(await read(chunk))) react.push(chunk);
    }
    assert(react.length > 0, `${page}'s script loads React for its islands`);
    for (const name of islands) {
      const [entry, ...others] = await islandEntries(name);
      assert(entry && others.length === 0, `one ${name} island entry`);
      assert(fromScript.has(entry), `${page}'s script loads ${name}`);
      assert(!fromLayout.has(entry), `${name} does not load with the layout`);
      await logHydratedBytes(`${page} ${name}`, entry, react);
    }
  }
});

/** The `href` of every `<link rel="modulepreload">` in a page's `<head>`. */
export function modulePreloads(html: string): string[] {
  const head = html.slice(0, html.indexOf("</head>"));
  return [...head.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .filter((tag) => /\brel\s*=\s*["']?modulepreload\b/i.test(tag))
    .map((tag) => tag.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] ?? "");
}

Deno.test("[FER-02] the preload reader finds each modulepreload in the head only", () => {
  const html = [
    '<html><head><link rel="stylesheet" href="/_astro/a.css">',
    '<link rel="modulepreload" href="/_astro/one.A1.js">',
    "<link href='/_astro/two.B2.js' rel='modulepreload'>",
    '</head><body><link rel="modulepreload" href="/_astro/late.C3.js">',
    "</body></html>",
  ].join("");
  assert(
    JSON.stringify(modulePreloads(html)) ===
      JSON.stringify(["/_astro/one.A1.js", "/_astro/two.B2.js"]),
    `head modulepreloads only: ${modulePreloads(html)}`,
  );
});

/**
 * The person shell's islands every person page mounts once the person
 * resolves (FER-02): the hero, the rail summary, and the profile fact
 * sections the rail loads. Their entries and static imports are preloaded
 * with the shell's own closure; every other person island stays lazy.
 */
const PERSON_PRELOADED_ISLANDS = [
  "person-hero",
  "person-rail",
  "person-fact-contact-methods",
  "person-fact-addresses",
  "person-fact-work",
  "person-fact-pets",
  "person-fact-food-preferences",
  "person-fact-first-meeting",
  "person-fact-tags",
] as const;

/** The chunks a page must preload: its scripts' static closure, and extras. */
async function expectedPreloads(page: string): Promise<Set<string>> {
  const entries = [...eagerScripts(await read(page))];
  if (page === PERSON_SHELL) {
    for (const name of PERSON_PRELOADED_ISLANDS) {
      const island = await islandEntries(name);
      assert(island.length === 1, `one ${name} island entry, not ${island}`);
      entries.push(island[0]!);
    }
  }
  return await eagerlyReachable(entries);
}

Deno.test("[FER-02] every page preloads exactly its static module closure in its head", async () => {
  const pages = await builtPages();
  assert(pages.length > 20, `the build wrote pages, found ${pages.length}`);
  let preloading = 0;
  for (const page of pages) {
    const html = await read(page);
    const preloads = modulePreloads(html);
    for (const href of preloads) {
      assert(
        /^\/_astro\/[\w.-]+\.js$/.test(href),
        `${page} preloads ${href}, not a same-origin fingerprinted chunk`,
      );
    }
    const preloaded = new Set(preloads.map((href) => href.slice(1)));
    assert(
      preloaded.size === preloads.length,
      `${page} preloads a chunk twice`,
    );
    const expected = await expectedPreloads(page);
    const missing = [...expected].filter((chunk) => !preloaded.has(chunk));
    assert(
      missing.length === 0,
      `${page} does not preload ${missing.sort().join(", ")}`,
    );
    const extra = [...preloaded].filter((chunk) => !expected.has(chunk));
    assert(
      extra.length === 0,
      `${page} preloads lazy chunks ${extra.sort().join(", ")}`,
    );
    assert(
      !/<link\b[^>]*\bas\s*=\s*["']?fetch\b/i.test(html),
      `${page} preloads a fetch`,
    );
    if (expected.size > 0) preloading += 1;
  }
  assert(preloading > 20, `pages with scripts preload, found ${preloading}`);
});

Deno.test("[FER-02] the person shell preloads the hero, the rail, and the fact sections, and no other island", async () => {
  const preloaded = new Set(
    modulePreloads(await read(PERSON_SHELL)).map((href) => href.slice(1)),
  );
  for (const name of PERSON_PRELOADED_ISLANDS) {
    const [entry] = await islandEntries(name);
    assert(entry && preloaded.has(entry), `the person shell preloads ${name}`);
  }
  const lazy = [
    ...PERSON_ISLANDS.filter((name) =>
      !(PERSON_PRELOADED_ISLANDS as readonly string[]).includes(name)
    ),
    ...SHELL_ISLANDS,
  ];
  for (const name of lazy) {
    const [entry] = await islandEntries(name);
    assert(entry && !preloaded.has(entry), `the person shell preloads ${name}`);
  }
});

Deno.test("[FER-02] public pages and the island-free shell preload no React", async () => {
  for (const page of [...PUBLIC_PAGES, SHELL_ONLY_PAGE]) {
    for (const href of modulePreloads(await read(page))) {
      assert(
        !carriesReact(await read(href.slice(1))),
        `${page} preloads React through ${href}`,
      );
    }
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

/** Every built HTML page under the client output, relative to it. */
async function builtPages(directory = ""): Promise<string[]> {
  const pages: string[] = [];
  for await (const entry of Deno.readDir(new URL(directory || ".", CLIENT))) {
    const path = `${directory}${entry.name}`;
    if (entry.isDirectory) pages.push(...await builtPages(`${path}/`));
    else if (entry.name.endsWith(".html")) pages.push(path);
  }
  return pages.sort();
}

/** Script types a browser executes, which CSP governs; others are data. */
const EXECUTABLE_SCRIPT_TYPE =
  /^(|module|text\/javascript|application\/javascript)$/i;

/** The bodies of the executable scripts a page carries inline. */
export function inlineScripts(html: string): string[] {
  const bodies: string[] = [];
  for (
    const [, attributes = "", body = ""] of html.matchAll(
      /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    )
  ) {
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const type = attributes.match(/\btype\s*=\s*["']?([^"'\s>]*)/i)?.[1] ??
      "";
    if (EXECUTABLE_SCRIPT_TYPE.test(type)) bodies.push(body);
  }
  return bodies;
}

/** The `script-src` sources the gateway's CSP allows. */
async function gatewayScriptSources(): Promise<Set<string>> {
  const headers = await Deno.readTextFile(
    new URL("../gateway/security_headers.conf", import.meta.url),
  );
  const policy = headers.match(
    /add_header Content-Security-Policy "([^"]*)" always;/,
  )?.[1] ?? "";
  const directive = policy.split(";").map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === "script-src") ?? [];
  return new Set(directive.slice(1));
}

async function hashSource(body: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}

Deno.test("[GAP-040] the inline script reader skips external and data scripts", () => {
  const html = [
    '<script src="/_astro/a.js"></script>',
    "<script>one()</script>",
    '<script type="module">two()</script>',
    '<script type="application/json">{"data":1}</script>',
    "<SCRIPT type='text/javascript'>three()</SCRIPT>",
  ].join("");
  assert(
    JSON.stringify(inlineScripts(html)) ===
      JSON.stringify(["one()", "two()", "three()"]),
    `executable inline scripts only: ${inlineScripts(html)}`,
  );
});

Deno.test("[GAP-040] every inline script the build ships is allowed by the gateway's CSP", async () => {
  const allowed = await gatewayScriptSources();
  assert(
    allowed.has("'self'") && !allowed.has("'unsafe-inline'"),
    "the gateway's script-src is the origin plus hashes",
  );
  const pages = await builtPages();
  assert(pages.length > 20, `the build wrote pages, found ${pages.length}`);
  const shipped = new Set<string>();
  for (const page of pages) {
    const html = await read(page);
    for (const body of inlineScripts(html)) {
      const hash = await hashSource(body);
      shipped.add(hash);
      assert(allowed.has(hash), `${page} inlines a script CSP blocks: ${hash}`);
    }
    const handler = html.match(/<[a-zA-Z][^>]*?\son[a-z]+\s*=/)?.[0];
    assert(handler === undefined, `${page} carries an inline handler`);
    assert(!/javascript:/i.test(html), `${page} carries a javascript: URL`);
  }
  // Only the hand-written theme script is inline; Astro inlines no bundled
  // page script (astro.config.mjs), so no build output changes the policy.
  assert(
    shipped.size === 1 && [...allowed].filter((s) => s !== "'self'")
      .every((hash) => shipped.has(hash)),
    `the build ships exactly the inline scripts the CSP hashes: ${[
      ...shipped,
    ]}`,
  );
});

Deno.test("[GAP-040] pages rendered on demand inline no bundled script either", async () => {
  // The renderer's manifest lists the bundled scripts it would write into a
  // page body; on-demand pages have no HTML in the client output to hash.
  const entry = await Deno.readTextFile(
    new URL("../apps/web/dist/server/entry.mjs", import.meta.url),
  );
  const inlined = entry.match(/"inlinedScripts":(\[[^\]]*\])/)?.[1];
  assert(inlined !== undefined, "the renderer manifest names inlined scripts");
  assert(inlined === "[]", `the renderer inlines scripts: ${inlined}`);
});

Deno.test("[AUD-G3] no page, prerendered or on demand, carries an inline style", async () => {
  // The gateway's CSP allows styles only from the origin: no `<style>`
  // element (Astro inlines none, `inlineStylesheets: "never"`) and no
  // `style` attribute in markup. CSSOM writes at runtime are not inline.
  const pages = await builtPages();
  assert(pages.length > 20, `the build wrote pages, found ${pages.length}`);
  for (const page of pages) {
    const html = await read(page);
    const element = html.match(/<style\b[^>]*>/i)?.[0];
    assert(element === undefined, `${page} carries ${element}`);
    const attribute = html.match(/<[a-zA-Z][^>]*?\sstyle\s*=[^>]*>/)?.[0];
    assert(attribute === undefined, `${page} carries ${attribute}`);
  }
  const entry = await Deno.readTextFile(
    new URL("../apps/web/dist/server/entry.mjs", import.meta.url),
  );
  assert(
    /"styles":\[\{"type":"external","src":/.test(entry),
    "the renderer manifest links its pages' stylesheets",
  );
  assert(
    !/"type":"inline","content"/.test(entry),
    "the renderer manifest inlines no stylesheet",
  );
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

// --- [FER-09] Each page group loads only its own CSS (AUD-F8) --------------

/**
 * The protected page groups, each found by its built pages' paths, and one
 * selector only that group's stylesheet carries. The layout's stylesheet holds
 * what every protected page shares; a page adds its group's sheet, so it never
 * downloads another group's rules.
 */
const STYLE_GROUPS: readonly {
  readonly name: string;
  readonly pages: RegExp;
  readonly marker: string;
}[] = [
  {
    name: "settings",
    pages: /^(app\/settings\/|internal\/import-report-shell\/)/,
    marker: ".settings-layout{",
  },
  {
    name: "people",
    pages: /^app\/people\//,
    marker: ".people-directory-controls{",
  },
  {
    name: "person",
    pages: /^internal\/person-profile-shell\//,
    marker: ".person-workspace-layout{",
  },
  // Today, tasks, the journal, the activity report, and a person's audit.
  { name: "general", pages: /^(app|internal)\//, marker: ".attention-groups{" },
];

/** A selector only the layout's shared stylesheet carries: the shell's. */
const SHARED_STYLE_MARKER = ".primary-nav{";

/** The most protected CSS, gzipped, one page may load (FER-09). */
const PAGE_GROUP_CSS_BUDGET = 30 * 1024;

/** The `_astro/*.css` stylesheets a page links, in document order. */
function linkedStylesheets(html: string): string[] {
  return [
    ...html.matchAll(
      /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\/(_astro\/[\w.-]+\.css)"/g,
    ),
  ].map(([, href]) => href!);
}

/** Every built protected page, with the group it belongs to. */
async function protectedPageGroups(): Promise<
  { page: string; group: (typeof STYLE_GROUPS)[number] }[]
> {
  const pages = [...await builtPages("app/"), ...await builtPages("internal/")];
  return pages.map((page) => ({
    page,
    group: STYLE_GROUPS.find(({ pages }) => pages.test(page))!,
  }));
}

Deno.test("[FER-09] the stylesheet reader finds every linked stylesheet", () => {
  const html =
    '<link rel="stylesheet" href="/_astro/A.1.css"><link rel="preload" href="/_astro/B.2.css">' +
    '<link rel="stylesheet" href="/_astro/C_x.3.css" media="all">';
  assert(
    JSON.stringify(linkedStylesheets(html)) ===
      JSON.stringify(["_astro/A.1.css", "_astro/C_x.3.css"]),
    "stylesheet links are read, preloads are not",
  );
});

Deno.test("[FER-09] each protected page group loads only its own CSS", async () => {
  // The shared stylesheet comes first, so its rules keep their place in the
  // cascade before the group's (GAP-032), and no page inlines a style.
  const pages = await protectedPageGroups();
  assert(pages.length > 20, "the build wrote the protected pages");
  for (const { name } of STYLE_GROUPS) {
    assert(
      pages.some(({ group }) => group.name === name),
      `the build wrote a ${name} page`,
    );
  }
  for (const { page, group } of pages) {
    const html = await read(page);
    assert(!/<style\b/i.test(html), `${page} inlines no style`);
    const sheets = linkedStylesheets(html);
    const css = await Promise.all(sheets.map(read));
    for (const other of STYLE_GROUPS) {
      if (other === group) continue;
      assert(
        !css.some((sheet) => sheet.includes(other.marker)),
        `${page} (${group.name}) loads the ${other.name} CSS: ${sheets}`,
      );
    }
    assert(
      css.length === 2 && css[0]!.includes(SHARED_STYLE_MARKER) &&
        !css[0]!.includes(group.marker) && css[1]!.includes(group.marker),
      `${page} links the shared stylesheet, then the ${group.name} one: ${sheets}`,
    );
  }
});

Deno.test("[FER-09] no protected page group loads more than 30 KB of gzipped CSS", async () => {
  const totals = new Map<string, number>();
  for (const { page, group } of await protectedPageGroups()) {
    const sheets = linkedStylesheets(await read(page));
    assert(sheets.length > 0, `${page} links a stylesheet`);
    let bytes = 0;
    for (const sheet of sheets) bytes += await gzipSize(sheet);
    assert(
      bytes <= PAGE_GROUP_CSS_BUDGET,
      `${page} loads ${bytes} bytes of gzipped CSS, over ${PAGE_GROUP_CSS_BUDGET}`,
    );
    totals.set(group.name, Math.max(totals.get(group.name) ?? 0, bytes));
  }
  console.log(
    `Protected CSS per page group, gzip: ${
      [...totals].map(([name, bytes]) => `${name} ${bytes} B`).join(", ")
    }`,
  );
});
