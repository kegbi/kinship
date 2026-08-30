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
const profileController = readFileSync(
  resolve("apps/web/src/lib/people-profile.ts"),
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

  it("UXD-002A2 keeps two peer actions and moves lifecycle actions into one person menu", () => {
    const actions = profilePage.slice(
      profilePage.indexOf('class="person-profile-actions"'),
      profilePage.indexOf('<dl class="person-vital-stats"'),
    );
    expect(actions).toContain('aria-label="Open person menu"');
    expect(actions).toContain('aria-expanded="false"');
    expect(actions).toContain('aria-controls="person-menu"');
    expect(actions).toContain('<span aria-hidden="true">…</span>');
    expect(actions).toContain(
      '<div id="person-menu" class="person-menu-popover" hidden>',
    );
    const menu = actions.slice(actions.indexOf('id="person-menu"'));
    const orderedItems = [
      "Edit person",
      "Export vCard",
      "Archive person",
      "Audit history",
      "Delete person",
    ];
    let previous = -1;
    for (const item of orderedItems) {
      const current = menu.indexOf(item);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
    expect(menu).not.toContain("Restore person");
    expect(menu).toMatch(
      /<button[^>]*id="person-audit-history"[^>]*>Audit history<\/button>/,
    );
    expect(menu).not.toMatch(/<a[^>]*>Audit history<\/a>/);
    expect(applicationStyles).toMatch(
      /\.person-profile-actions\s*\{[^}]*flex-wrap:\s*wrap;/s,
    );
    expect(applicationStyles).toMatch(
      /\.person-menu\s*\{[^}]*position:\s*relative;/s,
    );
    expect(applicationStyles).toMatch(
      /\.person-menu-popover\s*\{[^}]*position:\s*absolute;[^}]*top:\s*calc\(100% \+ \.65rem\);[^}]*right:\s*0;/s,
    );
    const menuItemSelector =
      ".person-workspace .person-menu-popover > :is(button, a:is(.button-primary, .button-secondary, .button-danger))";
    expect(applicationStyles).toContain(`${menuItemSelector} {`);
    expect(applicationStyles).toMatch(
      /\.person-workspace \.person-menu-popover > :is\(button, a:is\(\.button-primary, \.button-secondary, \.button-danger\)\)\s*\{[^}]*width:\s*100%;[^}]*justify-content:\s*flex-start;/s,
    );
    expect(applicationStyles).toContain(
      `${menuItemSelector}.button-danger {\n  color: var(--danger);`,
    );
    expect(applicationStyles).toContain(
      `${menuItemSelector}:hover {`,
    );
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

  it("UXD-002C groups the twelve stream cards under legal headings and retires load-mode metadata", () => {
    const zoneDefinition = profilePage.slice(
      profilePage.indexOf("const streamZones = ["),
      profilePage.indexOf(
        "] as const;",
        profilePage.indexOf("const streamZones = ["),
      ),
    );
    const orderedZones = ["timeline", "planning", "things", "admin"];
    let previousZone = -1;
    for (const zone of orderedZones) {
      const currentZone = zoneDefinition.indexOf(`"${zone}"`);
      expect(currentZone).toBeGreaterThan(previousZone);
      previousZone = currentZone;
    }
    const main = profilePage.slice(
      profilePage.indexOf('class="profile-section-list"'),
    );
    expect(main).toContain(
      '<section class="person-zone" data-zone={zone} aria-labelledby={`person-zone-${zone}-heading`} aria-busy="true">',
    );
    expect(main).toContain(
      "<h2 id={`person-zone-${zone}-heading`}>{zoneTitle}</h2>",
    );
    expect(main).not.toContain("section-kicker");
    expect(main).not.toContain("<h2 id={`profile-section-");
    expect(main).toContain("<h3 id={`profile-section-${id}-heading`}");
    expect(main).toContain(
      '<h3 id="profile-section-life-events-heading">Life events</h3>',
    );
    expect(main).toContain(
      '<h3 id="profile-section-tasks-heading">Tasks</h3>',
    );
    expect(main).toContain(
      "<div><h4>Open</h4><ul data-task-open-list",
    );
    expect(main).toContain(
      "<div><h4>Completed</h4><ul data-task-completed-list",
    );
    expect(main).toContain(
      "<div><h4>Cancelled</h4><ul data-task-cancelled-list",
    );
    expect(profilePage).not.toContain("data-load-mode");
  });

  it("UXD-002C maps every stable profile section to its filter zone", () => {
    const sectionZone = profileController.slice(
      profileController.indexOf("const SECTION_ZONE = {"),
      profileController.indexOf(
        "} as const;",
        profileController.indexOf("const SECTION_ZONE = {"),
      ),
    );
    const expectedSections = [
      "contact-methods",
      "addresses",
      "relationships",
      "important-dates",
      "work",
      "pets",
      "food-preferences",
      "first-meeting",
      "stay-in-touch",
      "life-events",
      "notes",
      "conversations",
      "calls",
      "activities",
      "tasks",
      "reminders",
      "gifts",
      "debts",
      "documents",
      "photos",
      "audit-summary",
      "identity-summary",
    ];
    expect(sectionZone.match(/^\s{2}(?:"[^"]+"|[a-z-]+):/gm)).toHaveLength(
      22,
    );
    for (const id of expectedSections) {
      expect(sectionZone).toMatch(
        new RegExp(
          `(?:"${id}"|${id}): "(?:facts|timeline|planning|things|admin)"`,
        ),
      );
    }
  });

  it("UXD-002C uses an accessible sticky filter without introducing tabs or a second heading", () => {
    const switcher = profilePage.slice(
      profilePage.indexOf('class="zone-switcher"'),
      profilePage.indexOf('<section class="person-zone"'),
    );
    expect(switcher).toContain(
      '<div class="zone-filter" role="group" aria-label="Filter person sections">',
    );
    expect(switcher.match(/<button\b/g)).toHaveLength(5);
    for (const view of ["all", "timeline", "planning", "things", "admin"]) {
      expect(switcher).toContain(`data-zone-filter="${view}"`);
    }
    expect(switcher).not.toContain('role="tablist"');
    expect(switcher).not.toContain('role="tab"');
    expect(switcher).toContain(
      '<div class="zone-mini-identity" data-zone-mini-identity aria-hidden="true" hidden>',
    );
    expect(switcher).not.toMatch(/<h[1-6]\b/);
    expect(applicationStyles).toMatch(
      /\.zone-switcher\s*\{[^}]*position:\s*sticky;[^}]*top:\s*6rem;[^}]*overflow-x:\s*auto;[^}]*background:\s*var\(--surface-page\);/s,
    );
    expect(applicationStyles).toMatch(
      /\.zone-mini-identity\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*0 1 auto;/s,
    );
    expect(applicationStyles).toMatch(
      /\.zone-mini-avatar\s*\{[^}]*width:\s*1\.5rem;[^}]*aspect-ratio:\s*1;/s,
    );
    expect(applicationStyles).toMatch(
      /\.person-zone \.profile-section-heading h3\s*\{[^}]*font-size:\s*clamp\(1\.45rem, 3vw, 2rem\);/s,
    );
    expect(applicationStyles).not.toMatch(
      /(?:^|\n)\.profile-section-heading h3\s*\{/,
    );
    expect(applicationStyles).toMatch(
      /\.profile-section-card\s*\{[^}]*scroll-margin-top:\s*6\.5rem;/s,
    );
    expect(applicationStyles).toMatch(
      /\.person-zone \.profile-section-card\s*\{[^}]*scroll-margin-top:\s*10\.5rem;/s,
    );
    const mobileSwitcher = applicationStyles.slice(
      applicationStyles.indexOf(
        ".zone-switcher {",
        applicationStyles.indexOf("@media (max-width: 760px)"),
      ),
      applicationStyles.indexOf(
        "}",
        applicationStyles.indexOf(
          ".zone-switcher {",
          applicationStyles.indexOf("@media (max-width: 760px)"),
        ),
      ),
    );
    expect(mobileSwitcher).toContain("top: 6rem;");
    expect(mobileSwitcher).toContain("scroll-snap-type: x proximity;");
    expect(mobileSwitcher).not.toContain("overflow-x");
  });

  it("UXD-003B ships the visible busy shell, silent section states, and reduced-motion skeletons", () => {
    const stateTag = profilePage.match(
      /<section id="person-profile-state"[^>]*>/,
    )?.[0];
    const readyTag = profilePage.match(
      /<section id="person-profile-ready"[^>]*>/,
    )?.[0];
    expect(stateTag).toContain("hidden");
    expect(readyTag).not.toContain("hidden");
    expect(readyTag).toContain('aria-busy="true"');
    expect(profilePage).not.toContain("Opening person…");
    expect(profilePage).toMatch(
      /<h1 id="person-profile-name"[^>]*>[\s\S]*?class="[^"]*skeleton[^"]*"[^>]*aria-hidden="true"[\s\S]*?Loading person…[\s\S]*?<\/h1>/,
    );

    const initialSectionStates = [
      ...profilePage.matchAll(
        /<p\b[^>]*\bclass="[^"]*\bsection-state\b[^"]*"[^>]*>/gs,
      ),
    ].map(([tag]) => tag).filter((tag) =>
      !tag.includes('id="person-lifecycle-status"') &&
      !tag.includes('role="alert"')
    );
    expect(initialSectionStates.length).toBeGreaterThan(10);
    expect(
      initialSectionStates.every((tag) =>
        !tag.includes('role="status"') && !tag.includes("aria-live")
      ),
    ).toBe(true);
    expect(profilePage).toMatch(
      /id="person-lifecycle-status"[^>]*role="status"[^>]*aria-live="polite"/,
    );
    expect(profilePage).toMatch(
      /id="person-delete-impact"[^>]*role="status"/,
    );

    expect(applicationStyles).toMatch(
      /\.skeleton\s*\{[^}]*linear-gradient\(90deg, var\(--surface-2\) 0%, var\(--surface-3\) 50%,\s*var\(--surface-2\) 100%\);[^}]*background-size:\s*200% 100%;[^}]*animation:\s*skeleton-sweep 1\.4s ease-in-out infinite;/s,
    );
    expect(applicationStyles).toMatch(/@keyframes skeleton-sweep\s*\{/);
    expect(applicationStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.skeleton\s*\{[^}]*animation:\s*none;/,
    );
    expect(applicationStyles).toMatch(
      /\.skeleton-line\s*\{[^}]*height:\s*\.9rem;/s,
    );
    expect(applicationStyles).toContain(".skeleton-avatar");
    expect(applicationStyles).toContain(".skeleton-chip");
  });
});
