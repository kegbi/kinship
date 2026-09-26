// @vitest-environment happy-dom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CapturedProfileSummary,
  captureProfileSummary,
} from "../profile-summary.test-helper.ts";
import {
  block,
  fact,
  factRead,
  mountFacts,
  nextRevision,
  personId,
  railBlock,
  response,
  revision,
  shell,
  stubFetch,
  unmountFacts,
} from "./facts.test-helper.ts";
import { mountFirstMeeting } from "./first-meeting.tsx";

const introducerId = "00000000-0000-4000-8000-000000000450";

let summary: CapturedProfileSummary;
beforeEach(() => {
  summary = captureProfileSummary();
});
afterEach(() => {
  summary.stop();
  unmountFacts();
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const section = () => within(block("first-meeting"));

describe("GAP-029 first meeting island", () => {
  it("[PEOPLE-006] saves where they met with an introducer found by search", async () => {
    shell(railBlock("first-meeting"));
    let saved: object | undefined;
    const fetch = stubFetch((url, init) => {
      if (url.pathname === "/api/v1/people") {
        return response({
          people: url.searchParams.get("search") === "Charles"
            ? [{
              familyName: "Babbage",
              givenName: "Charles",
              id: introducerId,
            }]
            : [],
          status: "ready",
        });
      }
      if (init?.method === "POST") {
        saved = fact("first-meeting", {
          introducedByPersonId: introducerId,
          notes: "Introduced while discussing mathematics",
          placeText: "London salon",
        });
        return response({
          personUpdatedAt: nextRevision,
          record: saved,
          status: "saved",
        });
      }
      return factRead(saved ? [saved] : []);
    });
    await mountFacts(mountFirstMeeting);
    const root = block("first-meeting");
    expect(root.dataset.island).toBe("person-fact-first-meeting");
    expect(root.hasAttribute("data-island-ready")).toBe(true);
    expect(root.dataset.sectionState).toBe("ready");
    expect(
      section().getByRole("heading", { level: 3, name: "First meeting" }),
    ).toBeTruthy();
    expect(root.querySelector("[data-profile-fact-state]")?.textContent)
      .toBe("No first meeting saved.");
    expect(summary.railEmpty("first-meeting")).toBe(true);

    const user = userEvent.setup();
    await user.click(
      section().getByRole("button", { name: "Add first meeting" }),
    );
    const place = section().getByLabelText("Where or how you first met");
    await waitFor(() => expect(document.activeElement).toBe(place));
    await user.type(section().getByLabelText("Search people"), "Charles");
    await user.click(section().getByRole("button", { name: "Search people" }));
    const introducer = section().getByLabelText("Introduced by");
    await waitFor(() =>
      expect(
        within(introducer).getByRole("option", { name: "Charles Babbage" }),
      )
        .toBeTruthy()
    );
    await user.selectOptions(introducer, introducerId);
    await user.type(place, "London salon");
    await user.type(
      section().getByLabelText("First meeting story"),
      "Introduced while discussing mathematics",
    );
    await user.click(
      section().getByRole("button", { name: "Save profile fact" }),
    );

    const state = root.querySelector<HTMLElement>("[data-profile-fact-state]")!;
    await waitFor(() => expect(state.textContent).toBe("Profile fact saved."));
    await waitFor(() => expect(document.activeElement).toBe(state));
    expect(fetch.bodies()).toEqual([{
      expectedPersonUpdatedAt: revision,
      introducedByPersonId: introducerId,
      notes: "Introduced while discussing mathematics",
      placeText: "London salon",
      section: "first-meeting",
    }]);
    expect(fetch.calls()).toEqual([
      `GET /api/v1/people/${personId}/facts/first-meeting`,
      `GET /api/v1/people?excludePersonId=${personId}&limit=20`,
      `GET /api/v1/people?excludePersonId=${personId}&limit=20&search=Charles`,
      `POST /api/v1/people/${personId}/facts/first-meeting`,
      `GET /api/v1/people/${personId}/facts/first-meeting`,
    ]);
    expect(root.textContent).toContain(
      "London salon — Introduced while discussing mathematics",
    );
    expect(
      section().getByRole("link", { name: "View person" }).getAttribute(
        "href",
      ),
    ).toBe(`/app/people/${introducerId}`);
    expect(
      section().getByRole("button", { name: "Edit first meeting" }),
    ).toBeTruthy();
    expect(summary.vital("first-meeting")).toBe("London salon");
    expect(summary.railCount("first-meeting")).toBe("1");
    expect(block("first-meeting").querySelector("form")!.hidden).toBe(true);
  });

  it("refuses a first meeting with no context on its place field", async () => {
    shell(railBlock("first-meeting"));
    const fetch = stubFetch((url) =>
      url.pathname === "/api/v1/people"
        ? response({ people: [], status: "ready" })
        : factRead([])
    );
    await mountFacts(mountFirstMeeting);
    const user = userEvent.setup();
    await user.click(
      section().getByRole("button", { name: "Add first meeting" }),
    );
    const place = section().getByLabelText("Where or how you first met");
    await user.click(
      section().getByRole("button", { name: "Save profile fact" }),
    );
    await waitFor(() => expect(document.activeElement).toBe(place));
    expect(place.getAttribute("aria-invalid")).toBe("true");
    expect(
      block("first-meeting").querySelector("[data-profile-fact-field-error]")
        ?.textContent,
    ).toBe("Enter first-meeting details.");
    expect(screen.getByRole("alert").textContent).toBe(
      "Correct the highlighted profile details before saving.",
    );
    expect(fetch.calls().some((call) => call.startsWith("POST"))).toBe(false);
  });

  it("fails closed when an existing introducer outside the first page cannot be found again", async () => {
    shell(railBlock("first-meeting"));
    const fetch = stubFetch((url) => {
      if (url.pathname === "/api/v1/people") {
        return url.searchParams.get("selectedPersonId") === introducerId
          ? response({ status: 503, title: "Unavailable" }, 503)
          : response({ people: [], status: "ready" });
      }
      return factRead([
        fact("first-meeting", {
          introducedByPersonId: introducerId,
          notes: "Story",
        }),
      ]);
    });
    await mountFacts(mountFirstMeeting);
    const user = userEvent.setup();
    await user.click(
      section().getByRole("button", { name: "Edit first meeting" }),
    );
    const state = block("first-meeting").querySelector(
      "[data-profile-fact-state]",
    )!;
    await waitFor(() =>
      expect(state.textContent).toBe(
        "Current introducer could not be verified. No changes were saved.",
      )
    );
    expect(block("first-meeting").querySelector("form")!.hidden).toBe(true);
    expect(fetch.calls().some((call) => call.startsWith("POST"))).toBe(false);
    expect(fetch.calls().some((call) => call.startsWith("PUT"))).toBe(false);
  });

  it("edits a saved first meeting with its introducer found again, and clears its vital when the module goes", async () => {
    shell(railBlock("first-meeting"));
    let status: "ready" | "hidden" = "ready";
    const record = fact("first-meeting", {
      introducedByPersonId: introducerId,
      placeText: "Royal Society",
    });
    const fetch = stubFetch((url) => {
      if (url.pathname === "/api/v1/people") {
        return response({
          people: [],
          selected: {
            familyName: "Babbage",
            givenName: "Charles",
            id: introducerId,
          },
          status: "ready",
        });
      }
      return factRead(status === "ready" ? [record] : [], { status });
    });
    await mountFacts(mountFirstMeeting);
    expect(summary.vital("first-meeting")).toBe("Royal Society");
    const user = userEvent.setup();
    await user.click(
      section().getByRole("button", { name: "Edit first meeting" }),
    );
    const introducer = section().getByLabelText<HTMLSelectElement>(
      "Introduced by",
    );
    await waitFor(() => expect(introducer.value).toBe(introducerId));
    expect(
      within(introducer).getByRole("option", { name: "Charles Babbage" }),
    ).toBeTruthy();
    expect(
      section().getByLabelText<HTMLInputElement>("Where or how you first met")
        .value,
    ).toBe("Royal Society");
    expect(fetch.calls()[1]).toBe(
      `GET /api/v1/people?excludePersonId=${personId}&limit=20&selectedPersonId=${introducerId}`,
    );
    await user.click(section().getByRole("button", { name: "Cancel" }));
    status = "hidden";
    const { act } = await import("@testing-library/react");
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: false },
        }),
      );
    });
    await waitFor(() =>
      expect(block("first-meeting").dataset.sectionState).toBe("hidden")
    );
    expect(summary.vital("first-meeting")).toBe("Not recorded");
    expect(summary.railCount("first-meeting")).toBeUndefined();
  });

  it("clamps a long story and names the section after its More control", async () => {
    shell(railBlock("first-meeting"));
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    stubFetch(() =>
      factRead([
        fact("first-meeting", {
          notes:
            "Introduced while discussing mathematics and analytical engines",
          placeText: "London salon",
        }),
      ])
    );
    await mountFacts(mountFirstMeeting);
    const story = block("first-meeting").querySelector<HTMLElement>(
      "[data-profile-fact-list] p",
    )!;
    expect(story.className).toBe("profile-rail-clamped-summary");
    Object.defineProperties(story, {
      clientHeight: { configurable: true, value: 32 },
      scrollHeight: { configurable: true, value: 64 },
    });
    const { act } = await import("@testing-library/react");
    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
    const more = section().getByRole("button", { name: "More first meeting" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await userEvent.setup().click(more);
    expect(story.dataset.expanded).toBe("true");
    expect(
      section().getByRole("button", { name: "Less first meeting" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });
});
