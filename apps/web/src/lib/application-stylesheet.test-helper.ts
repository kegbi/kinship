import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const stylesDirectory = resolve("apps/web/src/styles");
const importStatement =
  /^@import\s+(?:url\()?["]\.\/([\w-]+)\.css["]\)?;\r?\n?/gm;

/**
 * The protected page groups (FER-09). A page of each imports
 * `styles/page-<group>.css` right after the layout, which imports
 * `styles/application.css`.
 */
export const PAGE_GROUPS = ["general", "people", "person", "settings"] as const;
export type PageGroup = (typeof PAGE_GROUPS)[number];

/**
 * Every protected stylesheet in its one cascade order (GAP-032). The layout's
 * application.css imports the first four; each page group's stylesheet imports
 * the rest it draws, in this order, so no rule changes place against another
 * that can meet it on one element.
 */
export const PROTECTED_CASCADE = [
  "fonts",
  "tokens",
  "base",
  "shell",
  "sections",
  "settings",
  "components",
  "status",
  "person-chrome",
  "section-form",
  "person-hero",
  "person-rail",
  "person-timeline",
  "person-planning",
  "person-things",
  "person-admin",
  "people",
  "person-actions",
  "task-board",
  "pages",
  "overrides",
] as const;

function readStylesheet(name: string): string {
  return readFileSync(resolve(stylesDirectory, `${name}.css`), "utf8");
}

/** The stylesheets one stylesheet imports, by name, in order. */
export function stylesheetImports(name: string): string[] {
  return [...readStylesheet(name).matchAll(importStatement)].map(([, file]) =>
    file!
  );
}

/** A stylesheet with its imports written in place. */
function inlined(name: string): string {
  const source = readStylesheet(name);
  if (source.match(importStatement) === null) {
    throw new Error(`${name}.css does not import any stylesheets`);
  }
  return source.replace(
    importStatement,
    (_statement, file: string) => readStylesheet(file),
  );
}

/**
 * The CSS a protected page of `group` loads, in cascade order: the layout's
 * application.css, then the group's stylesheet. Without a group, every
 * protected stylesheet in `PROTECTED_CASCADE` order.
 */
export function readApplicationStylesheet(group?: PageGroup): string {
  if (group) return `${inlined("application")}\n${inlined(`page-${group}`)}`;
  const shared = stylesheetImports("application");
  return [
    inlined("application"),
    ...PROTECTED_CASCADE.slice(shared.length).map(readStylesheet),
  ].join("\n");
}
