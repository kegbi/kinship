import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { groups } from "./settings-destinations.ts";

const settingsNavigationPath = resolve(
  "apps/web/src/components/SettingsNavigation.astro",
);
const settingsNavigation = existsSync(settingsNavigationPath)
  ? readFileSync(settingsNavigationPath, "utf8")
  : "";

describe("settings navigation component", () => {
  it("UXD-008 renders one labelled destination nav with only the current page marked", () => {
    expect(settingsNavigation).toContain('aria-label="Settings navigation"');
    expect(settingsNavigation).toContain(
      '<p class="scope-label">{group.label}</p>',
    );
    expect(settingsNavigation).not.toMatch(
      /<h[1-6][^>]*>\{group\.label\}<\/h[1-6]>/,
    );
    expect(settingsNavigation).toContain(
      'aria-current={currentDestinationId === destination.id ? "page" : undefined}',
    );
    expect(settingsNavigation.match(/aria-current=/g)).toHaveLength(1);
  });

  it("UXD-008 exhaustively marks role-gated destinations for session gating", () => {
    expect(settingsNavigation).toContain(
      'import { groups } from "../lib/settings-destinations.ts";',
    );
    const destinations = groups.flatMap((group) =>
      group.destinations.map(({ access, label }) => ({ access, label }))
    );

    expect(destinations).toEqual([
      { access: "member", label: "Profile" },
      { access: "member", label: "Preferences" },
      { access: "member", label: "Security & sessions" },
      { access: "admin", label: "General" },
      { access: "admin", label: "Members" },
      { access: "admin", label: "Personalization" },
      { access: "admin", label: "Storage" },
      { access: "admin", label: "Import" },
      { access: "admin", label: "Export" },
      { access: "admin", label: "Audit history" },
      { access: "admin", label: "Integrations" },
      { access: "admin", label: "API access" },
      { access: "owner", label: "Workspace danger zone" },
    ]);
    expect(settingsNavigation).toContain(
      'data-requires-workspace-admin={destination.access === "admin" ? "true" : undefined}',
    );
    expect(settingsNavigation).toContain(
      'data-requires-workspace-owner={destination.access === "owner" ? "true" : undefined}',
    );
  });
});
