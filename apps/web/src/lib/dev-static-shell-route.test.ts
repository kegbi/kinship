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
  ])("maps %s to its reusable shell", (requested, expected) => {
    expect(resolveDevStaticShellRoute(requested)).toBe(expected);
  });

  it.each([
    "/app/people/new",
    "/app/people/not-a-uuid",
    `/app/people/${personId}/unknown`,
    "/internal/person-profile-shell",
  ])("leaves ordinary and internal paths unchanged: %s", (requested) => {
    expect(resolveDevStaticShellRoute(requested)).toBeUndefined();
  });
});
