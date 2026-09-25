/**
 * What `astro build` ships to the browser (GAP-026).
 *
 * ADR 0006 lets React run only inside hydrated islands: static, public, and
 * no-JavaScript pages ship none, and every island's hydrated bytes are
 * measured. This suite reads the client output the build just wrote, follows
 * every script a page can load — static imports, dynamic imports, and the
 * preload lists Vite writes for them — and fails when a public page can reach
 * a chunk that carries React. It also measures the gifts island, which loads
 * with its zone on the person page, so the evidence line records real bytes.
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

/** The one entry that may load React: the static person shell. */
const PERSON_SHELL = "internal/person-profile-shell/index.html";

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

Deno.test("[GAP-026] no page script but the person shell's can reach React", async () => {
  // Pages rendered on demand (auth resets, invitations) have no HTML in the
  // client output, but their scripts do: every page script is checked.
  const shell = new Set(chunkReferences(await read(PERSON_SHELL)));
  let scripts = 0;
  for await (const entry of Deno.readDir(new URL("_astro/", CLIENT))) {
    const chunk = `_astro/${entry.name}`;
    if (!/.astro_astro_type_script_.*.js$/.test(entry.name)) continue;
    scripts += 1;
    if (shell.has(chunk)) continue;
    for (const loaded of await reachable([chunk])) {
      assert(
        !carriesReact(await read(loaded)),
        `${chunk} can load React through ${loaded}`,
      );
    }
  }
  assert(scripts > 10, `the build wrote page scripts, found ${scripts}`);
});

Deno.test("[GAP-026] the person shell loads React only with its lazy gifts island", async () => {
  // The control: the detector does find React where an island needs it.
  const react = await reactChunksOf(PERSON_SHELL);
  assert(react.length > 0, "the person shell can load the gifts island");
  const html = await read(PERSON_SHELL);
  const eager = new Set(
    [...html.matchAll(/<script\b[^>]*\bsrc="\/(_astro\/[\w.-]+\.js)"/g)].map((
      [, chunk],
    ) => chunk!),
  );
  for (const chunk of react) {
    assert(
      !eager.has(chunk),
      `${chunk} carries React but loads with the page instead of the island`,
    );
  }

  const island: string[] = [];
  for await (const entry of Deno.readDir(new URL("_astro/", CLIENT))) {
    const chunk = `_astro/${entry.name}`;
    if (!entry.name.endsWith(".js")) continue;
    if (/["'`]person-gifts["'`]/.test(await read(chunk))) island.push(chunk);
  }
  assert(island.length === 1, `one gifts island entry, not ${island}`);
  const entry = island[0]!;
  const loads = await reachable([entry]);
  const runtime = [...loads].filter((chunk) => chunk !== entry).filter(
    (chunk) => react.includes(chunk),
  );
  const entryBytes = await gzipSize(entry);
  let runtimeBytes = 0;
  for (const chunk of runtime) runtimeBytes += await gzipSize(chunk);
  console.log(
    `person-gifts island hydrated bytes (gzip): entry ${entry} ${entryBytes} B + React runtime ${
      runtime.join(", ")
    } ${runtimeBytes} B = ${entryBytes + runtimeBytes} B`,
  );
});

Deno.test("[GAP-026] no Tailwind utility shares a name with a hand-written class", async () => {
  // Tailwind generates a utility for every candidate word in the island
  // sources. One named like a class the existing stylesheets style would
  // restyle every vanilla element that carries it.
  let built = "";
  for await (const entry of Deno.readDir(new URL("_astro/", CLIENT))) {
    if (!entry.name.endsWith(".css")) continue;
    const css = await read(`_astro/${entry.name}`);
    if (css.includes("@layer utilities")) built = css;
  }
  assert(built.length > 0, "the build wrote the island utilities");
  const utilities = built.slice(built.indexOf("@layer utilities"));
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
