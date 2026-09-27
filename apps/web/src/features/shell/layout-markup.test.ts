import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCESS_TEMPLATES,
  TOAST_REGION,
  WORKSPACE_OPTION_TEMPLATE,
} from "../../testing/shell.ts";
import * as templates from "./templates.ts";

const layout = readFileSync(
  "apps/web/src/layouts/ApplicationLayout.astro",
  "utf8",
);

/**
 * The layout's markup with each `id={NAME}` expression replaced by the
 * template id it names and every class attribute dropped, since the layout
 * computes the access actions' classes in its frontmatter.
 */
function resolved(markup: string): string {
  return markup
    .replace(/\sid=\{(\w+)\}/g, (_, name: string) => {
      const value = (templates as Record<string, unknown>)[name];
      if (typeof value !== "string") throw new Error(`unknown ${name}`);
      return ` id="${value}"`;
    })
    .replace(/\sclass=(?:\{\w+\}|"[^"]*")/g, "");
}

describe("GAP-033 application layout templates", () => {
  it("draws exactly the markup the suites draw", () => {
    const source = resolved(layout);
    const access = ACCESS_TEMPLATES.match(/<template[\s\S]*?<\/template>/g);
    expect(access).toHaveLength(3);
    for (const markup of [...access!, TOAST_REGION]) {
      expect(source).toContain(resolved(markup));
    }
    expect(source).toContain(WORKSPACE_OPTION_TEMPLATE);
  });

  it("draws every template the shell clones", () => {
    const ids = Object.entries(templates).filter(([name]) =>
      name.endsWith("_TEMPLATE_ID")
    ).map(([name]) => name);
    expect(ids).toHaveLength(5);
    for (const name of ids) {
      expect(layout).toContain(`<template id={${name}}>`);
    }
  });

  it("keeps the layout's frontmatter off the modules that run the page", () => {
    const frontmatter = layout.split("---")[1]!;
    expect(frontmatter).toContain('from "../features/shell/templates.ts"');
    expect(frontmatter).not.toMatch(/application-shell|toasts/);
  });

  it("draws no element but the static access card in the access state", () => {
    const state = /<section id="access-state"[\s\S]*?<\/section>/.exec(
      layout,
    )?.[0];
    expect(state).toContain('<div class="access-card">');
    expect(state).not.toMatch(/<main|<a\s|<button/);
  });
});
