import { describe, expect, it } from "vitest";
import { resolveDevStaticShellRoute } from "./dev-static-shell-route.ts";

const personId = "123e4567-e89b-42d3-a456-426614174000";

describe("Astro development static-shell routing", () => {
  it.each([
    [`/app/people/${personId}`, "/internal/person-profile-shell"],
    [
      `/app/people/${personId}/activity-report?year=2026`,
      "/internal/activity-report-shell?year=2026",
    ],
    [`/app/people/${personId}/audit/`, "/internal/person-audit-shell"],
    [`/app/journal/${personId}`, "/internal/journal-item-shell"],
    [
      `/app/settings/import/${personId}`,
      "/internal/import-report-shell",
    ],
    ["/invite/private-token", "/internal/invite-shell"],
    ["/invite/continue", "/internal/invite-shell"],
  ])("maps %s to its reusable shell", (requested, expected) => {
    expect(resolveDevStaticShellRoute(requested)).toBe(expected);
  });

  it.each([
    "/app/people/new",
    "/app/people/not-a-uuid",
    `/app/people/${personId}/unknown`,
    "/internal/person-profile-shell",
    "/invite/",
    "/invite/token/extra",
  ])("leaves ordinary and internal paths unchanged: %s", (requested) => {
    expect(resolveDevStaticShellRoute(requested)).toBeUndefined();
  });
});

describe("MCP-R3 static-shell routing for derived identifiers", () => {
  // People DAV sync or a retry-safe create made, and journal posts created
  // with a requestId, carry the version 8 identifier the backend derives.
  const derived = "8e5213b9-8cee-8024-8aed-45319d1b7d1b";
  const timeOrdered = "017F22E2-79B0-7CC3-98C4-DC0C0C07398F";

  it.each([derived, timeOrdered])("maps every page keyed by %s", (id) => {
    expect(resolveDevStaticShellRoute(`/app/people/${id}`)).toBe(
      "/internal/person-profile-shell",
    );
    expect(resolveDevStaticShellRoute(`/app/people/${id}/audit`)).toBe(
      "/internal/person-audit-shell",
    );
    expect(resolveDevStaticShellRoute(`/app/people/${id}/activity-report`))
      .toBe("/internal/activity-report-shell");
    expect(resolveDevStaticShellRoute(`/app/journal/${id}`)).toBe(
      "/internal/journal-item-shell",
    );
    expect(resolveDevStaticShellRoute(`/app/settings/import/${id}`)).toBe(
      "/internal/import-report-shell",
    );
  });

  it.each([
    "8e5213b9-8cee-9024-8aed-45319d1b7d1b",
    "8e5213b9-8cee-0024-8aed-45319d1b7d1b",
    "8e5213b9-8cee-8024-caed-45319d1b7d1b",
    "8e5213b9-8cee-8024-8aed-45319d1b7d1",
  ])("still refuses the malformed identifier %s", (id) => {
    expect(resolveDevStaticShellRoute(`/app/people/${id}`)).toBeUndefined();
    expect(resolveDevStaticShellRoute(`/app/journal/${id}`)).toBeUndefined();
  });
});
