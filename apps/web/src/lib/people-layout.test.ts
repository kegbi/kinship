// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readApplicationStylesheet } from "./application-stylesheet.test-helper.ts";

const createPage = readFileSync(
  resolve("apps/web/src/pages/app/people/new.astro"),
  "utf8",
);
const applicationStyles = readApplicationStylesheet();
const personStyles = readFileSync(
  resolve("apps/web/src/styles/person.css"),
  "utf8",
);
const applicationLayout = readFileSync(
  resolve("apps/web/src/layouts/ApplicationLayout.astro"),
  "utf8",
);
const profilePage = readFileSync(
  resolve("apps/web/src/pages/internal/person-profile-shell.astro"),
  "utf8",
);
const paletteIsland = readFileSync(
  resolve(
    "apps/web/src/islands/global-people-search/global-people-search.tsx",
  ),
  "utf8",
);
const islandStyles = readFileSync(
  resolve("apps/web/src/styles/islands.css"),
  "utf8",
);
const profileController = readFileSync(
  resolve("apps/web/src/lib/people-profile.ts"),
  "utf8",
);

describe("people form layout regressions", () => {
  it("keeps timeline filters disabled until their controller binds them", () => {
    const filters = [...profilePage.matchAll(
      /<button\b[^>]*data-timeline-filter="[^"]+"[^>]*>/g,
    )];
    expect(filters).toHaveLength(6);
    for (const [markup] of filters) {
      const template = document.createElement("template");
      template.innerHTML = markup;
      expect(template.content.querySelector("button")?.disabled).toBe(true);
    }
  });

  it("UXD-004 keeps exactly one global finder visible and distinctly named", () => {
    const compactButton = String
      .raw`\.global-search > button\.global-people-search-open`;
    expect(applicationStyles).toMatch(
      new RegExp(`${compactButton}\\s*\\{[^}]*display:\\s*none;`, "s"),
    );
    expect(applicationStyles).toMatch(
      new RegExp(
        `@media \\(max-width: 1050px\\)[\\s\\S]*?${compactButton}\\s*\\{[^}]*display:\\s*inline-flex;`,
        "s",
      ),
    );
    expect(applicationLayout.match(/aria-label="Find a person"/g))
      .toHaveLength(2);
    // The header draws the finder statically; the palette island takes it
    // over and names its dialog the same way (GAP-027).
    expect(applicationLayout).toContain("data-global-people-search");
    expect(applicationLayout).toContain(
      'import { mountGlobalPeopleSearch } from "../islands/global-people-search/mount.tsx";',
    );
    expect(applicationLayout).not.toContain(
      '<dialog id="global-people-search-dialog"',
    );
    expect(paletteIsland).toContain('const LABEL = "Find a person";');
    expect(paletteIsland).toMatch(
      /<DialogTitle[^>]*>\s*\{LABEL\}\s*<\/DialogTitle>/,
    );
    expect(applicationLayout).toContain('placeholder="Search people…"');
    expect(paletteIsland).toContain('placeholder="Search people…"');
  });

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

  it("only lets toast items in passive status surfaces intercept clicks", () => {
    expect(applicationStyles).toMatch(
      /\.sr-status\s*\{[^}]*pointer-events:\s*none/s,
    );
    expect(applicationStyles).toMatch(
      /\.app-toasts\s*\{[^}]*pointer-events:\s*none/s,
    );
    expect(applicationStyles).toMatch(
      /\.app-toast\s*\{[^}]*pointer-events:\s*auto/s,
    );
  });

  it("uses one profile action treatment for buttons and links", () => {
    // Every profile button and action link draws with a Kinship variant from
    // components/ui/variants.ts (GAP-027): a button or a segmented filter.
    const unclassifiedButtons = [
      ...profilePage.matchAll(/<button\b[\s\S]*?<\/button>/g),
    ].flatMap(([button]) =>
      /^<button\b[^>]*\bclass=\{(?:buttonVariants\(|segment\})[^>]*>/s
          .test(button)
        ? []
        : [button.match(/^<button\b[^>]*>/s)?.[0] ?? button]
    );
    expect(unclassifiedButtons).toEqual([]);
    const outline = String
      .raw`class=\{buttonVariants\(\{ variant: "outline" \}\)\}`;
    expect(profilePage).toMatch(
      new RegExp(
        `<a[^>]*id="person-export-vcard"[^>]*${outline}[^>]*>Export vCard</a>`,
      ),
    );
    expect(profilePage).toMatch(
      new RegExp(
        `<a[^>]*${outline}[^>]*data-activity-report-link[^>]*>Open activity report</a>`,
      ),
    );
    expect(profilePage).toMatch(
      new RegExp(
        `<button[^>]*data-profile-fact-add[^>]*${outline}[^>]*>Edit tags</button>`,
      ),
    );
    expect(profilePage).toMatch(
      new RegExp(
        `<button[^>]*data-life-event-retry[^>]*${outline}[^>]*>Retry life events</button>`,
      ),
    );
    // The workspace keeps its button box, and a button without a variant
    // takes the outline colours from a default the variants draw over.
    expect(applicationStyles).toMatch(
      /\.person-workspace button\s*\{[^}]*align-items:\s*center;[^}]*box-sizing:\s*border-box;[^}]*display:\s*inline-flex;[^}]*justify-content:\s*center;[^}]*min-height:\s*44px;[^}]*padding:[^;]+;[^}]*border-width:\s*1px;[^}]*border-style:\s*solid;[^}]*border-radius:[^;]+;[^}]*cursor:\s*pointer;[^}]*font-weight:[^;]+;[^}]*line-height:[^;]+;[^}]*text-decoration:\s*none;/s,
    );
    expect(applicationStyles).toMatch(
      /@layer legacy-defaults\s*\{\s*\.person-workspace button\s*\{[^}]*border-color:[^;]+;[^}]*color:[^;]+;[^}]*background:[^;]+;/s,
    );
    expect(applicationStyles).toMatch(
      /\.person-workspace button:disabled\s*\{[^}]*cursor:\s*not-allowed;[^}]*opacity:/s,
    );
    expect(applicationStyles).toMatch(
      /\.person-lifecycle-buttons button\s*\{[^}]*min-height:\s*44px;[^}]*padding:[^;]+;[^}]*border-radius:\s*999px;/s,
    );
    expect(applicationStyles).not.toMatch(
      /\.button-(?:primary|secondary|danger|link)\b/,
    );
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
      ".person-workspace .person-menu-popover > :is(button, a)";
    expect(applicationStyles).toContain(`${menuItemSelector} {`);
    expect(applicationStyles).toMatch(
      /\.person-workspace \.person-menu-popover > :is\(button, a\)\s*\{[^}]*width:\s*100%;[^}]*justify-content:\s*flex-start;/s,
    );
    expect(menu).toContain(
      'id="person-delete-open" class={buttonVariants({ className: "person-menu-danger", variant: "destructive" })}',
    );
    expect(applicationStyles).toContain(
      ".person-workspace .person-menu-popover > .person-menu-danger {\n  color: var(--danger);",
    );
    expect(applicationStyles).toContain(
      `${menuItemSelector}:hover {`,
    );
  });

  it("styles profile form fields without turning checkboxes into text fields", () => {
    expect(applicationStyles).toMatch(
      /\.profile-fact-form input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),\s*\.profile-fact-form select,\s*\.profile-fact-form textarea\s*\{[^}]*padding:[^;]+;[^}]*border:[^;]+;[^}]*border-radius:[^;]+;[^}]*background:\s*var\(--surface-1\);[^}]*font-family:\s*inherit;/s,
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

  it("PRF-001 gives ordered facts a visible heading and puts navigation before the blocks", () => {
    const railStart = profilePage.indexOf('class="profile-facts-rail"');
    const mainStart = profilePage.indexOf('class="profile-section-list"');
    const rail = profilePage.slice(railStart, mainStart);
    expect(railStart).toBeGreaterThan(-1);
    expect(mainStart).toBeGreaterThan(railStart);
    expect(profilePage.slice(0, railStart)).toContain(
      'class="profile-facts-column"',
    );
    expect(profilePage.slice(0, railStart)).toContain(
      '<h2 id="profile-facts-heading">Profile facts</h2>',
    );
    expect(profilePage.indexOf('class="person-workspace-navigation"'))
      .toBeLessThan(railStart);
    expect(profilePage).toContain(
      '<details class="profile-section-directory">',
    );
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

  it("PRF-001 stacks the mobile workspace and gives desktop facts paired cards without nested scrolling", () => {
    expect(applicationStyles).toMatch(
      /\.person-workspace-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*gap:\s*var\(--space-5\);/s,
    );
    expect(applicationStyles).toMatch(
      /@media \(min-width: 1200px\)[\s\S]*?\.person-workspace-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 5fr\) minmax\(0, 7fr\);/s,
    );
    expect(applicationStyles).toMatch(
      /@media \(min-width: 600px\)[\s\S]*?\.profile-facts-rail\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
    );
    expect(applicationStyles).not.toMatch(
      /\.profile-facts-column\s*\{[^}]*(?:position:\s*sticky|overflow:\s*auto)/s,
    );
    expect(applicationStyles).not.toMatch(
      /\.profile-section-directory\s*\{[^}]*(?:position:\s*sticky|max-height:|overflow:\s*auto)/s,
    );
    expect(applicationStyles).toMatch(
      /\.profile-rail-block\s*\{[^}]*min-width:\s*0;[^}]*padding:\s*var\(--pad-block\);/s,
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
      /\.profile-rail-block\[data-rail-empty="true"\] > \.profile-section-heading\s*\{[^}]*border-bottom:\s*0;/s,
    );
  });

  it("UXD-019 pins rail sheets to the established mobile breakpoint", () => {
    const selector = ".profile-rail-dialog {";
    const sheetStart = applicationStyles.indexOf(selector);
    expect(sheetStart).toBeGreaterThan(-1);
    expect(
      applicationStyles.match(/\.profile-rail-dialog \{/g),
    )
      .toHaveLength(1);
    const mobileStart = applicationStyles.lastIndexOf(
      "@media (max-width: 760px)",
      sheetStart,
    );
    const nextMedia = applicationStyles.indexOf("@media", sheetStart);
    const mobileRules = applicationStyles.slice(
      mobileStart,
      nextMedia === -1 ? undefined : nextMedia,
    );
    expect(mobileRules).toMatch(
      /\.person-workspace-layout\s*\{[^}]*grid-template-columns:\s*1fr;/s,
    );
    expect(mobileRules).toMatch(
      /\.profile-rail-dialog::backdrop\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--ink-1\) 38%, transparent\);/s,
    );
    expect(mobileRules).toMatch(
      /\.profile-rail-dialog\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*auto 0 0;[^}]*width:\s*100%;[^}]*max-height:\s*80dvh;[^}]*padding:\s*var\(--pad-card\);[^}]*overflow-y:\s*auto;[^}]*border-radius:\s*var\(--radius-lg\) var\(--radius-lg\) 0 0;[^}]*background:\s*var\(--surface-1\);[^}]*box-shadow:\s*var\(--shadow-2\);/s,
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
      profilePage.indexOf('<p id="person-profile-section-notice"'),
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
      /\.person-workspace-navigation\s*\{[^}]*--person-navigation-top:\s*6rem;[^}]*position:\s*sticky;[^}]*top:\s*var\(--person-navigation-top\);[^}]*background:\s*var\(--surface-page\);/s,
    );
    expect(applicationStyles).toMatch(
      /@media \(max-width: 1050px\)[\s\S]*?\.app-header\s*\{[^}]*position:\s*static;/s,
    );
    expect(applicationStyles).toMatch(
      /@media \(max-width: 1050px\)[\s\S]*?\.person-workspace-navigation\s*\{[^}]*--person-navigation-top:\s*var\(--space-2\);/s,
    );
    expect(applicationStyles).toMatch(
      /\.zone-switcher\s*\{[^}]*overflow-x:\s*auto;/s,
    );
    expect(applicationStyles).toMatch(
      /\.zone-mini-identity\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*0 1 auto;/s,
    );
    expect(applicationStyles).toMatch(
      /\.zone-mini-avatar\s*\{[^}]*width:\s*1\.5rem;[^}]*aspect-ratio:\s*1;/s,
    );
    expect(applicationStyles).toMatch(
      /\.person-zone \.profile-section-heading h3\s*\{[^}]*font-size:\s*\.95rem;/s,
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
    const mobileSwitcher = personStyles.slice(
      personStyles.indexOf(
        ".zone-switcher {",
        personStyles.indexOf("@media (max-width: 760px)"),
      ),
      personStyles.indexOf(
        "}",
        personStyles.indexOf(
          ".zone-switcher {",
          personStyles.indexOf("@media (max-width: 760px)"),
        ),
      ),
    );
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
      /<h1 id="person-profile-name"[^>]*>[\s\S]*?class=\{skeletonVariants\([^)]*\)\} data-slot="skeleton" aria-hidden="true"[\s\S]*?Loading person…[\s\S]*?<\/h1>/,
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

    // The sweep is the skeleton variant's `animate-skeleton`, which stops for
    // reduced motion (`motion-reduce:animate-none`, pinned in variants.test).
    expect(islandStyles).toContain(
      "--animate-skeleton: skeleton-sweep 1.4s ease-in-out infinite;",
    );
    expect(islandStyles).toMatch(/@keyframes skeleton-sweep\s*\{/);
    expect(profilePage).toContain('skeletonVariants({ shape: "avatar" })');
    expect(profilePage).toContain(
      'skeletonVariants({ className: "w-28", shape: "chip" })',
    );
  });
});
