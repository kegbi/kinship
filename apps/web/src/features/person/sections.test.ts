import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { personProfileSectionId } from "../../../../../packages/contracts/schemas/people.ts";
import {
  filterZone,
  PERSON_SECTIONS,
  personSection,
  RAIL_SECTION_ORDER,
  railSections,
  STREAM_ZONES,
  zoneSections,
} from "./sections.ts";

/** The `sections:` list the page catalog declares for `people.profile`. */
function catalogSections(): string[] {
  const catalog = readFileSync(
    resolve("docs/product/page-catalog.yaml"),
    "utf8",
  );
  const page = catalog.slice(catalog.indexOf("- id: people.profile"));
  const list = page.slice(page.indexOf("    sections:\n") + 14);
  const block = list.slice(0, list.search(/\n {4}\S/));
  return [...block.matchAll(/^ {6}- ([a-z-]+)$/gm)].map(([, id]) => id!);
}

describe("GAP-028 person section registry", () => {
  it("declares every page-catalog section once, in catalog order", () => {
    const ids = PERSON_SECTIONS.map((section) => section.id);
    expect(catalogSections()).toHaveLength(22);
    expect(ids).toEqual(catalogSections());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps each section in the zone the workspace shows it in", () => {
    expect(STREAM_ZONES.map((zone) => zone.id)).toEqual([
      "timeline",
      "planning",
      "things",
      "admin",
    ]);
    expect(zoneSections("timeline").map((section) => section.id)).toEqual([
      "life-events",
      "notes",
      "conversations",
      "calls",
      "activities",
    ]);
    expect(zoneSections("planning").map((section) => section.id)).toEqual([
      "tasks",
      "reminders",
    ]);
    expect(zoneSections("things").map((section) => section.id)).toEqual([
      "gifts",
      "debts",
      "documents",
      "photos",
    ]);
    expect(zoneSections("admin").map((section) => section.id)).toEqual([
      "audit-summary",
    ]);
    expect(railSections().map((section) => section.id)).toEqual([
      ...RAIL_SECTION_ORDER,
    ]);
    expect(
      PERSON_SECTIONS.filter((section) => section.zone === "rail").map((
        section,
      ) => section.id).sort(),
    ).toEqual([...RAIL_SECTION_ORDER].sort());
    expect(
      PERSON_SECTIONS.filter((section) => section.zone === "hero").map((
        section,
      ) => section.id),
    ).toEqual(["identity-summary"]);
  });

  it("files rail sections under facts and the identity editor under Admin", () => {
    const zones = Object.fromEntries(
      PERSON_SECTIONS.map((section) => [section.id, filterZone(section)]),
    );
    expect(zones).toMatchObject({
      "audit-summary": "admin",
      "identity-summary": "admin",
      "important-dates": "facts",
      "life-events": "timeline",
      reminders: "planning",
      "stay-in-touch": "facts",
      gifts: "things",
    });
  });

  it("names only real profile modules as visibility keys", () => {
    const modules = new Set<string>(personProfileSectionId.options);
    for (const section of PERSON_SECTIONS) {
      if (section.visibilityKey === null) continue;
      expect(modules.has(section.visibilityKey)).toBe(true);
      // A module switches off the section of the same name.
      expect(section.visibilityKey).toBe(section.id);
    }
  });

  it("finds an entry by id and nothing for anything else", () => {
    expect(personSection("work")?.title).toBe("Work");
    expect(personSection("tags")).toBeUndefined();
    expect(personSection(null)).toBeUndefined();
  });
});
