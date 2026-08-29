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
const profilePage = readFileSync(
  resolve("apps/web/src/pages/internal/person-profile-shell.astro"),
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

  it("uses one profile action treatment for buttons and links", () => {
    const unclassifiedButtons = [
      ...profilePage.matchAll(/<button\b[\s\S]*?<\/button>/g),
    ].flatMap(([button]) =>
      /^<button\b[^>]*\bclass="[^"]*\bbutton-(?:primary|secondary|danger)\b[^>]*>/s
          .test(button)
        ? []
        : [button.match(/^<button\b[^>]*>/s)?.[0] ?? button]
    );
    expect(unclassifiedButtons).toEqual([]);
    expect(profilePage).toMatch(
      /<a[^>]*id="person-export-vcard"[^>]*class="button-secondary"[^>]*>Export vCard<\/a>/,
    );
    expect(profilePage).toMatch(
      /<a[^>]*class="button-secondary"[^>]*data-activity-report-link[^>]*>Open activity report<\/a>/,
    );
    expect(profilePage).toMatch(
      /<button[^>]*data-profile-fact-add[^>]*class="button-secondary"[^>]*>Edit tags<\/button>/,
    );
    expect(profilePage).toMatch(
      /<button[^>]*data-life-event-retry[^>]*class="button-secondary"[^>]*>Retry life events<\/button>/,
    );
    expect(applicationStyles).toMatch(
      /\.person-workspace button,\s*\.person-workspace a:is\(\.button-primary,\s*\.button-secondary,\s*\.button-danger\)\s*\{[^}]*align-items:\s*center;[^}]*box-sizing:\s*border-box;[^}]*display:\s*inline-flex;[^}]*justify-content:\s*center;[^}]*min-height:\s*44px;[^}]*padding:[^;]+;[^}]*border-width:\s*1px;[^}]*border-style:\s*solid;[^}]*border-radius:[^;]+;[^}]*cursor:\s*pointer;[^}]*font-weight:[^;]+;[^}]*line-height:[^;]+;[^}]*text-decoration:\s*none;/s,
    );
    expect(applicationStyles).toMatch(
      /\.person-workspace button\s*\{[^}]*border-color:[^;]+;[^}]*color:[^;]+;[^}]*background:[^;]+;/s,
    );
    expect(applicationStyles).toMatch(
      /\.person-workspace button:disabled,\s*\.person-workspace a:is\(\.button-primary,\s*\.button-secondary,\s*\.button-danger\)\[aria-disabled="true"\]\s*\{[^}]*cursor:\s*not-allowed;[^}]*opacity:/s,
    );
    expect(applicationStyles).toMatch(
      /\.person-workspace \.form-actions a:is\(\.button-primary,\s*\.button-secondary,\s*\.button-danger\)\s*\{[^}]*min-height:\s*46px;[^}]*padding:[^;]+;[^}]*border-radius:[^;]+;/s,
    );
    expect(applicationStyles).toMatch(
      /\.person-lifecycle-buttons button,\s*\.person-lifecycle-buttons a:is\(\.button-primary,\s*\.button-secondary,\s*\.button-danger\)\s*\{[^}]*min-height:\s*44px;[^}]*padding:[^;]+;[^}]*border-radius:\s*999px;/s,
    );
    for (const variant of ["primary", "secondary", "danger"]) {
      expect(applicationStyles).toMatch(
        new RegExp(
          `\\.person-workspace\\s+\\.button-${variant}\\s*\\{[^}]*border-color:[^;]+;[^}]*color:[^;]+;[^}]*background:[^;]+;`,
          "s",
        ),
      );
    }
  });

  it("styles profile form fields without turning checkboxes into text fields", () => {
    expect(applicationStyles).toMatch(
      /\.profile-fact-form input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),\s*\.profile-fact-form select,\s*\.profile-fact-form textarea\s*\{[^}]*padding:[^;]+;[^}]*border:[^;]+;[^}]*border-radius:[^;]+;[^}]*background:\s*white;[^}]*font-family:\s*inherit;/s,
    );
    expect(applicationStyles).toMatch(
      /\.profile-fact-form input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),\s*\.profile-fact-form select\s*\{[^}]*min-height:\s*44px;/s,
    );
    expect(applicationStyles).toMatch(
      /\.profile-fact-form select\[multiple\]\s*\{[^}]*min-height:\s*7rem;/s,
    );
    expect(applicationStyles).toMatch(
      /\.profile-fact-form \.checkbox-row input\s*\{[^}]*width:\s*auto;/s,
    );
  });

  it("UXD-002B keeps the directory and ordered profile facts in one compact rail", () => {
    const railStart = profilePage.indexOf('class="profile-facts-rail"');
    const mainStart = profilePage.indexOf('class="profile-section-list"');
    const rail = profilePage.slice(railStart, mainStart);
    expect(railStart).toBeGreaterThan(-1);
    expect(mainStart).toBeGreaterThan(railStart);
    expect(profilePage.slice(0, railStart)).toContain(
      'class="profile-facts-column"',
    );
    expect(rail).toContain('<h2 class="sr-only">Profile facts</h2>');
    const railDefinition = profilePage.slice(
      profilePage.indexOf("const railSections = ["),
      profilePage.indexOf(
        "] as const;",
        profilePage.indexOf("const railSections = ["),
      ),
    );
    const orderedIds = [
      "contact-methods",
      "relationships",
      "important-dates",
      "addresses",
      "work",
      "pets",
      "food-preferences",
      "first-meeting",
      "stay-in-touch",
    ];
    let previous = -1;
    for (const id of orderedIds) {
      const current = railDefinition.indexOf(`"${id}"`);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
    expect(rail).not.toContain("section-kicker");
    expect(rail).not.toContain("state-badge");
    expect(rail.match(/class="profile-section-card profile-rail-block"/g))
      .toHaveLength(4);
    expect(rail).toContain("data-profile-rail-count hidden");
    expect(rail).toContain("data-profile-fact-add-icon");
    expect(rail).toContain('aria-label="Add important date"');
    expect(rail).toContain('aria-label="Add relationship"');
    expect(rail).toContain('<span aria-hidden="true">+</span>');
  });

  it("UXD-002B gives the rail its specified columns, density, and one sticky owner", () => {
    expect(applicationStyles).toMatch(
      /\.person-workspace-layout\s*\{[^}]*grid-template-columns:\s*minmax\(280px, 320px\) minmax\(0, 1fr\);[^}]*gap:\s*1\.5rem;/s,
    );
    expect(applicationStyles).toMatch(
      /@media \(max-width: 1199px\)[\s\S]*?\.person-workspace-layout\s*\{[^}]*grid-template-columns:\s*minmax\(240px, 260px\) minmax\(0, 1fr\);[^}]*gap:\s*1\.25rem;/s,
    );
    expect(applicationStyles).toMatch(
      /\.profile-facts-column\s*\{[^}]*position:\s*sticky;[^}]*top:\s*6rem;[^}]*max-height:\s*calc\(100vh - 7rem\);[^}]*overflow:\s*auto;/s,
    );
    expect(applicationStyles).not.toMatch(
      /\.profile-section-directory\s*\{[^}]*(?:position:\s*sticky|max-height:|overflow:\s*auto)/s,
    );
    expect(applicationStyles).toMatch(
      /\.profile-rail-block\s*\{[^}]*min-width:\s*0;[^}]*padding:\s*\.875rem;/s,
    );
    expect(applicationStyles).toMatch(
      /\.profile-rail-block h3\s*\{[^}]*font-size:\s*\.95rem;/s,
    );
    expect(applicationStyles).toMatch(
      /\.profile-rail-add\s*\{[^}]*width:\s*44px;[^}]*padding:\s*0;[^}]*aspect-ratio:\s*1;/s,
    );
    expect(applicationStyles).toMatch(
      /\.profile-rail-block\[data-rail-empty="true"\][\s\S]*?\[data-profile-fact-list\][\s\S]*?display:\s*none;/s,
    );
    expect(applicationStyles).toMatch(
      /\.profile-rail-block\[data-rail-empty="true"\] > \.section-state\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1;/s,
    );
    expect(applicationStyles).toMatch(
      /\.profile-rail-block\[data-rail-empty="true"\] \.profile-rail-add\s*\{[^}]*grid-column:\s*4;[^}]*grid-row:\s*1;/s,
    );
    expect(applicationStyles).toMatch(
      /\.profile-rail-block\[data-rail-empty="true"\] > \.section-state:empty \+ #relationships-list\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1;/s,
    );
  });
});
