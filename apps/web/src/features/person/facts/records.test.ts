import { describe, expect, it } from "vitest";
import type { ProfileFactRecord } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  addressLines,
  factDetails,
  type FactRecord,
  factSummary,
  isLaterRevision,
  mergeOptions,
  pageSummary,
  railPresentation,
  tagNames,
  tagSummary,
  workSummaryRecord,
} from "./records.ts";

const revision = "2026-08-16T12:00:00.000000Z";
const typeId = "00000000-0000-4000-8000-000000000200";
const labelId = "00000000-0000-4000-8000-000000000299";

function record<Section extends ProfileFactRecord["section"]>(
  section: Section,
  value: object,
  id = "00000000-0000-4000-8000-000000000100",
): FactRecord<Section> {
  return { id, section, updatedAt: revision, value } as FactRecord<Section>;
}

const options = [
  { id: typeId, kind: "contact-type" as const, name: "Email" },
  { id: labelId, kind: "contact-label" as const, name: "Personal" },
];

describe("GAP-029 profile fact records", () => {
  it("names every section's record in one line", () => {
    expect(factSummary(
      record("contact-methods", { typeId, value: "ada@example.test" }),
      options,
    )).toBe("Email: ada@example.test");
    expect(factSummary(
      record("contact-methods", { typeId: labelId + "0", value: "x" }),
      [],
    )).toBe("Contact: x");
    expect(factSummary(
      record("addresses", {
        city: "London",
        country: "UK",
        displayName: "Home",
        region: "Greater London",
        street: "One Way",
      }),
      [],
    )).toBe("Home, One Way, London, UK");
    expect(factSummary(
      record("first-meeting", {
        notes: "Introduced there",
        placeText: "Salon",
      }),
      [],
    )).toBe("Salon — Introduced there");
    expect(factSummary(record("first-meeting", {}), [])).toBe(
      "No first-meeting context saved",
    );
    expect(factSummary(
      record("work", { organizationName: "Engines", title: "Mathematician" }),
      [],
    )).toBe("Mathematician at Engines");
    expect(factSummary(record("food-preferences", {}), [])).toBe(
      "No food preferences saved",
    );
    expect(factSummary(
      record("food-preferences", { foodPreferences: "Tea" }),
      [],
    )).toBe("Tea");
    expect(factSummary(
      record("pets", { categoryId: typeId, name: "Byron" }),
      [{ id: typeId, name: "Cat" }],
    )).toBe("Byron · Cat");
    expect(factSummary(record("tags", { tagIds: [] }), [])).toBe(
      "Tag assignments",
    );
  });

  it("PRF-001 lays an address over three lines, falling back to its label", () => {
    expect(addressLines(
      record("addresses", {
        city: "London",
        country: "United Kingdom",
        displayName: "Home",
        isPrimary: true,
        labelIds: [],
        postalCode: "SW1A 1AA",
        region: "Greater London",
        street: "1 Analytical Engine Way",
      }),
      [],
    )).toEqual([
      "Home",
      "1 Analytical Engine Way",
      "London, Greater London, SW1A 1AA, United Kingdom",
    ]);
    expect(addressLines(
      record("addresses", { city: "Paris", labelIds: [labelId] }),
      options,
    )).toEqual(["Personal", "Paris"]);
  });

  it("keeps the latest current work role, else the latest ended one, in view", () => {
    const work = (id: string, value: object) =>
      record("work", { isCurrent: false, title: id, ...value }, id);
    const current = [
      work("00000000-0000-4000-8000-000000000412", { startOn: "2024-01-01" }),
      work("00000000-0000-4000-8000-000000000411", { startOn: "2024-01-01" }),
      work("00000000-0000-4000-8000-000000000413", {
        endOn: "2026-08-01",
        startOn: "2025-01-01",
      }),
    ];
    expect(workSummaryRecord(current)?.id).toBe(
      "00000000-0000-4000-8000-000000000411",
    );
    const ended = [
      work("00000000-0000-4000-8000-000000000422", { endOn: "2026-08-30" }),
      work("00000000-0000-4000-8000-000000000421", { endOn: "2026-08-29" }),
      work("00000000-0000-4000-8000-000000000420", { endOn: "2025-01-01" }),
    ];
    expect(workSummaryRecord(ended)?.id).toBe(
      "00000000-0000-4000-8000-000000000422",
    );
    expect(workSummaryRecord([])).toBeUndefined();
  });

  it("PRF-001 exposes each section's details under its record", () => {
    const rows = (value: ProfileFactRecord) =>
      Object.fromEntries(
        factDetails(value, options).map((row) => [row.label, row.value]),
      );
    expect(rows(record("work", {
      description: "Translated and expanded the engine notes.",
      endOn: "1852-11-27",
      isCurrent: false,
      organizationName: "Analytical Engines",
      startOn: "1833-06-05",
      title: "Mathematician",
    }))).toEqual({
      "Current role": "No",
      Details: "Translated and expanded the engine notes.",
      Ended: "Nov 27, 1852",
      Started: "Jun 5, 1833",
    });
    expect(rows(record("pets", { notes: "A shy cat." }))).toEqual({
      Notes: "A shy cat.",
    });
    expect(rows(record("contact-methods", {
      isPrimary: true,
      labelIds: [labelId],
      notes: "Best for arranging a visit.",
      typeId,
      value: "ada@example.test",
    }))).toEqual({
      Labels: "Personal",
      Notes: "Best for arranging a visit.",
      Primary: "Yes",
    });
    expect(rows(record("addresses", {
      city: "London",
      isPrimary: false,
      labelIds: [labelId],
    }))).toEqual({ Labels: "Personal", Primary: "No" });
    expect(factDetails(
      record("first-meeting", { introducedByPersonId: typeId }),
      [],
    )).toEqual([{
      href: `/app/people/${typeId}`,
      label: "Introduced by",
      value: "View person",
    }]);
    expect(factDetails(record("first-meeting", {}), [])).toEqual([]);
    expect(factDetails(record("food-preferences", {}), [])).toEqual([]);
  });

  it("APR-006 keeps a missing tag name distinct from an empty assignment", () => {
    expect(tagNames(
      record("tags", { tagIds: [labelId, "unresolved"] }),
      options,
    )).toEqual(["Personal", "Unavailable tag"]);
    expect(tagSummary(0)).toBe("No tags saved.");
    expect(tagSummary(1)).toBe("1 tag saved.");
    expect(tagSummary(12)).toBe("12 tags saved.");
  });

  it("merges options so each id appears once with its latest name", () => {
    expect(mergeOptions(
      [{ id: typeId, name: "Old" }],
      [{ id: typeId, name: "Email" }, { id: labelId, name: "Personal" }],
    )).toEqual([{ id: typeId, name: "Email" }, {
      id: labelId,
      name: "Personal",
    }]);
  });

  it("only trusts a later canonical person revision", () => {
    expect(isLaterRevision("2026-08-16T12:00:00.000001Z", revision)).toBe(true);
    expect(isLaterRevision(revision, revision)).toBe(false);
    expect(isLaterRevision("2026-08-16T11:00:00.000000Z", revision)).toBe(
      false,
    );
    expect(isLaterRevision("2026-08-16T13:00:00.000Z", revision)).toBe(false);
  });

  it("APR-006 labels a bounded page as a preview and keeps a known total", () => {
    expect(pageSummary("pets", { count: 0, paged: false })).toBe(
      "No pets saved.",
    );
    expect(pageSummary("pets", { count: 2, paged: false })).toBe("2 saved.");
    expect(pageSummary("pets", { count: 50, paged: true })).toBe(
      "Showing 50 on this page.",
    );
    expect(pageSummary("pets", { count: 1, paged: true, total: 2 })).toBe(
      "Showing 1 of 2 saved.",
    );
    expect(railPresentation({ count: 0, paged: false })).toEqual({
      count: 0,
      empty: true,
      scope: "total",
    });
    expect(railPresentation({ count: 50, paged: true })).toEqual({
      count: 50,
      empty: false,
      scope: "page",
    });
    expect(railPresentation({ count: 1, paged: true, total: 2 })).toEqual({
      count: 2,
      empty: false,
      scope: "total",
    });
  });
});
