import { describe, expect, it } from "vitest";
import {
  canonicalUuid,
  localDateTime,
  parseLocalInstant,
  profilePersonId,
} from "./shared.ts";

const id = "00000000-0000-4000-8000-000000000100";

describe("interaction helpers", () => {
  it("spells a local date-time as a datetime-local field shows it", () => {
    const date = new Date(2026, 7, 16, 18, 15);
    expect(localDateTime(date)).toBe("2026-08-16T18:15");
    expect(localDateTime()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("reads the instant a datetime-local value names, or nothing", () => {
    expect(parseLocalInstant("2026-08-16T18:15")).toBe(
      new Date(2026, 7, 16, 18, 15).toISOString(),
    );
    for (const value of ["", "not a time", null, undefined]) {
      expect(parseLocalInstant(value)).toBeUndefined();
    }
  });

  it("names the person a profile or activity-report path is about", () => {
    expect(profilePersonId(`/app/people/${id}`)).toBe(id);
    expect(profilePersonId(`/app/people/${id}/activity-report/`)).toBe(id);
    expect(profilePersonId("/app/people")).toBeUndefined();
    expect(profilePersonId(`/app/people/${id}/audit`)).toBeUndefined();
  });

  it("canonicalizes only a real UUID", () => {
    expect(canonicalUuid(id.toUpperCase())).toBe(id);
    expect(canonicalUuid("not-a-uuid")).toBeUndefined();
    const derived = "8e5213b9-8cee-8024-8aed-45319d1b7d1b";
    expect(canonicalUuid(derived.toUpperCase())).toBe(derived);
    expect(canonicalUuid("8e5213b9-8cee-9024-8aed-45319d1b7d1b"))
      .toBeUndefined();
  });
});
