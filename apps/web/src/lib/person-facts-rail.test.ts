// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import {
  setFirstMeetingDate,
  setFirstMeetingPlace,
  setRailCount,
  setRailEmpty,
  setVitalStat,
} from "./person-facts-rail.ts";

afterEach(() => {
  document.body.replaceChildren();
});

describe("UXD-002B person facts rail writer", () => {
  it("is a no-op when an optional rail or vital slot is absent", () => {
    expect(() => {
      setRailCount("contact-methods", 1);
      setRailEmpty("contact-methods", true);
      setVitalStat("work", "Engineer");
      setFirstMeetingDate("June 5, 1833");
      setFirstMeetingPlace("Analytical Society");
    }).not.toThrow();
  });

  it("writes and clears counts and the collapsed-empty state", () => {
    document.body.innerHTML = `
      <section data-profile-section="contact-methods">
        <span data-profile-rail-count hidden></span>
      </section>`;

    setRailCount("contact-methods", 0);
    setRailEmpty("contact-methods", true);

    const section = document.querySelector<HTMLElement>(
      '[data-profile-section="contact-methods"]',
    )!;
    const count = section.querySelector<HTMLElement>(
      "[data-profile-rail-count]",
    )!;
    expect(count.hidden).toBe(false);
    expect(count.textContent).toBe("0");
    expect(section.dataset.railEmpty).toBe("true");

    setRailCount("contact-methods", undefined);
    setRailEmpty("contact-methods", false);

    expect(count.hidden).toBe(true);
    expect(count.textContent).toBe("");
    expect(section.hasAttribute("data-rail-empty")).toBe(false);
  });

  it("keeps honest vital fallbacks and prefers a first-meeting date to its place", () => {
    document.body.innerHTML = `
      <span data-person-vital-value="birthday">Not recorded</span>
      <span data-person-vital-value="work">Not recorded</span>
      <span data-person-vital-value="first-meeting">Not recorded</span>`;

    setVitalStat("birthday", "Age 34 · March 12, 1992");
    setVitalStat("work", undefined);
    setFirstMeetingPlace("Analytical Society");
    setFirstMeetingDate("June 5, 1833");

    expect(
      document.querySelector('[data-person-vital-value="birthday"]')
        ?.textContent,
    ).toBe("Age 34 · March 12, 1992");
    expect(
      document.querySelector('[data-person-vital-value="work"]')?.textContent,
    ).toBe("Not recorded");
    expect(
      document.querySelector('[data-person-vital-value="first-meeting"]')
        ?.textContent,
    ).toBe("June 5, 1833");

    setFirstMeetingDate(undefined);
    expect(
      document.querySelector('[data-person-vital-value="first-meeting"]')
        ?.textContent,
    ).toBe("Analytical Society");
    setFirstMeetingPlace(undefined);
    expect(
      document.querySelector('[data-person-vital-value="first-meeting"]')
        ?.textContent,
    ).toBe("Not recorded");
  });
});
