// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const createPage = readFileSync(
  resolve("apps/web/src/pages/app/people/new.astro"),
  "utf8",
);
const applicationStyles = readFileSync(
  resolve("apps/web/src/styles/application.css"),
  "utf8",
);

describe("people form layout regressions", () => {
  it("aligns directory controls to their first field row and styles retry actions", () => {
    expect(applicationStyles).toMatch(
      /\.people-directory-controls\s*\{[^}]*align-items:\s*start/s,
    );
    expect(applicationStyles).toMatch(
      /\.today-touch-target\s*\{[^}]*border:/s,
    );
  });

  it("uses one label row for every identity input and removes the obsolete scaffold", () => {
    expect(createPage.match(/class="field-label"/g)).toHaveLength(4);
    expect(createPage).not.toContain(
      "Additional profile sections are not available yet",
    );
  });

  it("only lets the auto-clearing shell notice intercept clicks", () => {
    expect(applicationStyles).toMatch(
      /\.sr-status\s*\{[^}]*pointer-events:\s*none/s,
    );
    expect(applicationStyles).toMatch(
      /#shell-status\s*\{[^}]*pointer-events:\s*auto/s,
    );
  });
});
