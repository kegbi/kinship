import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { STREAM_ZONES } from "../features/person/sections.ts";

/**
 * Every hand-written rule styles something the application can draw
 * (GAP-032). A selector is dead when a class, id, attribute, or element it
 * requires appears in no production `.astro`, `.ts`, or `.tsx` source: not as
 * a word (markup, `variants.ts`, class strings, `<template>` markup, JSX
 * attributes), not through `dataset`, and not as the literal part of a class
 * assembled in code (`status-${kind}`, `${zone}-card`). Anything inside a
 * functional pseudo-class (`:not()`, `:is()`, `:has()`, `:where()`) is left
 * alone, so the scan only ever under-reports.
 */

const root = resolve("apps/web/src");
const stylesDirectory = join(root, "styles");

/**
 * Attributes and elements drawn by the libraries the islands render, which no
 * production source spells out.
 */
const libraryProduced: ReadonlySet<string> = new Set([
  // Astro wraps every hydrated island in this element.
  "astro-island",
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ["styles", "testing"].includes(entry.name) &&
          directory === root
        ? []
        : sourceFiles(path);
    }
    if (!/\.(astro|ts|tsx)$/.test(entry.name)) return [];
    if (/\.test(-helper)?\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

/** Source text without comments, which name classes they do not draw. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

interface Corpus {
  readonly words: ReadonlySet<string>;
  readonly prefixes: readonly string[];
  readonly suffixes: readonly string[];
}

function readCorpus(): Corpus {
  return corpusOf(
    sourceFiles(root)
      .map((path) => withoutComments(readFileSync(path, "utf8")))
      .join("\n"),
  );
}

function corpusOf(text: string): Corpus {
  return {
    words: new Set(text.match(/[A-Za-z_][\w-]*/g) ?? []),
    prefixes: [
      ...text.matchAll(/([A-Za-z_][\w-]*-)\$\{/g),
      ...text.matchAll(/["'`]([A-Za-z_][\w-]*-)["'`]\s*\+/g),
    ].map(([, prefix]) => prefix!),
    suffixes: [...text.matchAll(/\}(-[\w-]*[\w])/g)].map(([, suffix]) =>
      suffix!
    ),
  };
}

interface Rule {
  readonly sheet: string;
  readonly line: number;
  readonly selector: string;
}

/** The selectors of every style rule, outside `@keyframes`. */
function styleRules(sheet: string, css: string): Rule[] {
  const source = css.replace(
    /\/\*[\s\S]*?\*\//g,
    (comment) => comment.replace(/[^\n]/g, " "),
  );
  const rules: Rule[] = [];
  let buffer = "";
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === ";" || character === "}") {
      buffer = "";
      start = index + 1;
      continue;
    }
    if (character !== "{") {
      buffer += character;
      continue;
    }
    const prelude = buffer.trim();
    const line = source.slice(0, start + buffer.search(/\S/)).split("\n")
      .length;
    buffer = "";
    start = index + 1;
    if (prelude.startsWith("@") && !/^@keyframes\b/.test(prelude)) continue;
    // A style rule's declarations, or a whole `@keyframes`, hold no rule.
    let depth = 1;
    while (depth > 0 && index < source.length - 1) {
      index += 1;
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") depth -= 1;
    }
    start = index + 1;
    if (prelude.startsWith("@")) continue;
    for (const selector of splitTopLevel(prelude)) {
      rules.push({ sheet, line, selector });
    }
  }
  return rules;
}

function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of list) {
    if (character === "(" || character === "[") depth += 1;
    if (character === ")" || character === "]") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += character;
  }
  parts.push(current.trim());
  return parts.filter((part) => part.length > 0);
}

/** What a selector requires the markup to contain, outside pseudo-classes. */
function requirements(selector: string): string[] {
  let bare = selector;
  // Drop functional pseudo-classes innermost first, then plain pseudos.
  while (/:[\w-]+\([^()]*\)/.test(bare)) {
    bare = bare.replace(/::?[\w-]+\([^()]*\)/g, "");
  }
  const needed: string[] = [];
  bare = bare.replace(
    /\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*)?(?:\s[is])?\]/g,
    (_match, name: string, operator?: string, ...values: string[]) => {
      needed.push(`attr:${name}`);
      const value = values.slice(0, 3).find((v) => v !== undefined);
      if (operator === "=" && value !== undefined && value !== "") {
        needed.push(`value:${value}`);
      }
      return " ";
    },
  );
  bare = bare.replace(/::?[\w-]+/g, "");
  for (const [, name] of bare.matchAll(/\.([\w-]+)/g)) {
    needed.push(`class:${name}`);
  }
  for (const [, name] of bare.matchAll(/#([\w-]+)/g)) needed.push(`id:${name}`);
  for (const [, name] of bare.matchAll(/(?:^|[\s>+~])([a-z][a-z0-9-]*)/g)) {
    needed.push(`element:${name}`);
  }
  return needed;
}

function camelDataset(attribute: string): string | null {
  if (!attribute.startsWith("data-")) return null;
  return attribute.slice(5).replace(
    /-([a-z])/g,
    (_, letter: string) => letter.toUpperCase(),
  );
}

function isProduced(requirement: string, corpus: Corpus): boolean {
  const [kind, name] = requirement.split(/:(.*)/s) as [string, string];
  if (libraryProduced.has(name)) return true;
  if (corpus.words.has(name)) return true;
  if (kind === "attr") {
    const dataset = camelDataset(name);
    return dataset !== null && corpus.words.has(dataset);
  }
  if (kind === "value") {
    // A value is matched as a word; free text such as `a b` word by word.
    const words = name.match(/[A-Za-z_][\w-]*/g) ?? [];
    return words.length === 0 || words.every((word) => corpus.words.has(word));
  }
  if (kind === "class" || kind === "id") {
    return corpus.prefixes.some((prefix) => name.startsWith(prefix)) ||
      corpus.suffixes.some((suffix) => name.endsWith(suffix));
  }
  return false;
}

/** Each dead selector as `sheet:line selector (missing …)`. */
function deadSelectors(): string[] {
  const corpus = readCorpus();
  const sheets = readdirSync(stylesDirectory)
    .filter((name) => name.endsWith(".css") && name !== "islands.css")
    .sort();
  return sheets.flatMap((name) =>
    styleRules(
      relative(root, join(stylesDirectory, name)),
      readFileSync(join(stylesDirectory, name), "utf8"),
    ).flatMap((rule) => {
      const missing = requirements(rule.selector).filter((requirement) =>
        !isProduced(requirement, corpus)
      );
      return missing.length === 0 ? [] : [
        `${rule.sheet}:${rule.line} ${rule.selector} (missing ${
          missing.join(", ")
        })`,
      ];
    })
  );
}

describe("stylesheet liveness", () => {
  it("styles only what a production source can draw", () => {
    expect(deadSelectors()).toEqual([]);
  });

  it("reads rules through at-rules and past keyframes", () => {
    const rules = styleRules(
      "sample.css",
      [
        "/* .commented { } */",
        "@layer legacy-defaults { button, .a:not(.b) { color: red; } }",
        "@keyframes spin { from { opacity: 0; } to { opacity: 1; } }",
        "@media (max-width: 1px) {",
        '  .c[data-state="open"] > li { gap: 0; }',
        "}",
      ].join("\n"),
    ).map(({ line, selector }) => `${line} ${selector}`);
    expect(rules).toEqual([
      "2 button",
      "2 .a:not(.b)",
      '5 .c[data-state="open"] > li',
    ]);
    expect(requirements('.c[data-state="open"] > li:is(.x, .y)')).toEqual([
      "attr:data-state",
      "value:open",
      "class:c",
      "element:li",
    ]);
  });

  it("finds a class or attribute value only where a source produces it", () => {
    const corpus = corpusOf(
      '<li class="kept-row" data-state="open"></li>\n`status-${kind}`',
    );
    expect(isProduced("class:kept-row", corpus)).toBe(true);
    expect(isProduced("class:status-overdue", corpus)).toBe(true);
    expect(isProduced("class:missing-row", corpus)).toBe(false);
    expect(isProduced("attr:data-state", corpus)).toBe(true);
    expect(isProduced("value:open", corpus)).toBe(true);
    expect(isProduced("value:closed", corpus)).toBe(false);
    expect(isProduced("attr:data-missing", corpus)).toBe(false);
  });
});

describe("stylesheet ownership", () => {
  const imports = [
    ...readFileSync(join(stylesDirectory, "application.css"), "utf8")
      .matchAll(/^@import\s+"\.\/([\w-]+)\.css";$/gm),
  ].map(([, name]) => name!);

  it("gives each person workspace zone its own stylesheet, in zone order", () => {
    const zones = ["hero", "rail", ...STREAM_ZONES.map(({ id }) => id)];
    const person = imports.filter((name) => name.startsWith("person-"));
    expect(person).toEqual([
      "person-chrome",
      ...zones.map((zone) => `person-${zone}`),
    ]);
    expect(readdirSync(stylesDirectory)).not.toContain("person.css");
  });

  it("imports the stylesheets in their cascade order", () => {
    expect(imports).toEqual([
      "fonts",
      "tokens",
      "base",
      "shell",
      "settings",
      "components",
      "person-chrome",
      "person-hero",
      "person-rail",
      "person-timeline",
      "person-planning",
      "person-things",
      "person-admin",
      "people",
      "pages",
      "overrides",
    ]);
  });

  it("documents the owner of every stylesheet", () => {
    const design = readFileSync(
      resolve("docs/product/dashboard-settings-design.md"),
      "utf8",
    );
    const section = design.slice(
      design.indexOf("### Stylesheet Ownership"),
      design.indexOf("## Change Control"),
    );
    const undocumented = readdirSync(stylesDirectory)
      .filter((name) => name.endsWith(".css"))
      .filter((name) => !section.includes(`\`styles/${name}\``));
    expect(undocumented).toEqual([]);
  });
});

describe("Tailwind source coverage", () => {
  // Tailwind globs use forward slashes on every host.
  const sourceRelative = (path: string): string =>
    relative(root, path).split(sep).join("/");
  const islands = readFileSync(join(stylesDirectory, "islands.css"), "utf8");
  const rules = [...islands.matchAll(/^@source\s+(not\s+)?"([^"]+)";/gm)]
    .map(([, not, path]) => ({ exclude: not !== undefined, path: path! }));
  /** A `@source` glob relative to `styles/`, as a regular expression. */
  const pattern = (glob: string): RegExp =>
    new RegExp(
      "^" +
        sourceRelative(resolve(stylesDirectory, glob)).split("/").map((part) =>
          part === "**" ? "(?:.+/)?" : part.replace(/[.]/g, "\\.")
            .replace(/\*/g, "[^/]*") + "/"
        ).join("").replace(/\/$/, "") + "(?:/.*)?$",
    );
  const scanned = (file: string): boolean =>
    rules.some((rule) => !rule.exclude && pattern(rule.path).test(file)) &&
    !rules.some((rule) => rule.exclude && pattern(rule.path).test(file));
  const everyFile = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? everyFile(join(directory, entry.name))
        : [sourceRelative(join(directory, entry.name))]
    );

  it("scans every top-level source directory with production files", () => {
    const directories = [
      ...new Set(
        sourceFiles(root).map(sourceRelative)
          .filter((file) => file.includes("/"))
          .map((file) => file.slice(0, file.indexOf("/"))),
      ),
    ].sort();
    expect(directories.length).toBeGreaterThan(0);
    const unscanned = directories.filter((directory) =>
      !rules.some((rule) =>
        !rule.exclude && sourceRelative(resolve(stylesDirectory, rule.path)) ===
          directory
      )
    );
    expect(unscanned).toEqual([]);
    expect(
      sourceFiles(root).map(sourceRelative).filter((file) =>
        !scanned(file) && file.includes("/")
      ),
    ).toEqual([]);
  });

  it("scans no test, test helper, or test support file", () => {
    const tests = everyFile(root).filter((file) =>
      /\.test(-helper)?\.tsx?$/.test(file) || file.startsWith("testing/")
    );
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.filter(scanned)).toEqual([]);
  });
});
