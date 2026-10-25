import { describe, expect, it } from "vitest";
import { groups } from "./settings-destinations.ts";
import { SETTINGS_SEARCH_INDEX } from "./settings-search-index.ts";

describe("settings search index", () => {
  const entries = SETTINGS_SEARCH_INDEX.flatMap((category) => category.entries);

  it("lists the theme under Personal, linked to its control", () => {
    const personal = SETTINGS_SEARCH_INDEX.find(({ id }) => id === "personal");
    const theme = personal?.entries.find(({ label }) => label === "Theme");
    expect(theme?.href).toBe("/app/settings/preferences#appearance-heading");
    expect(theme?.keywords).toMatch(/dark/);
  });

  it("indexes every settings destination, with its own access", () => {
    for (const group of groups) {
      for (const destination of group.destinations) {
        const page = entries.find((entry) =>
          entry.href === destination.href && entry.label === destination.label
        );
        expect(page, destination.id).toBeDefined();
        expect(page?.access).toBe(destination.access);
      }
    }
  });

  it("opens every entry inside settings", () => {
    for (const entry of entries) {
      expect(entry.href, entry.label).toMatch(/^\/app\/settings\//);
    }
  });
});
