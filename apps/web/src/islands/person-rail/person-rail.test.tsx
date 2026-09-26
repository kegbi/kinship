// @vitest-environment happy-dom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setRailCount,
  setRailEmpty,
} from "../../features/person/profile-summary.ts";
import type {
  PersonProfile,
  SectionProps,
} from "../../features/person/section-mounts.ts";
import { RAIL_SECTION_ORDER } from "../../features/person/sections.ts";
import { mountPersonRail } from "./mount.tsx";

const personId = "00000000-0000-4000-8000-000000000100";
const workspaceId = "00000000-0000-4000-8000-000000000300";

/** The facts column as the static shell draws it. */
function markup(ids: readonly string[] = RAIL_SECTION_ORDER): void {
  document.body.innerHTML = `
    <main>
      <section class="profile-facts-column" aria-labelledby="profile-facts-heading">
        <header class="profile-facts-heading">
          <h2 id="profile-facts-heading">Profile facts</h2>
          <p>The people, places, and details that matter.</p>
        </header>
        <div class="profile-facts-rail">
          ${
    ids.map((id) =>
      `<section class="profile-section-card profile-rail-block" data-profile-section="${id}">
              <header class="profile-section-heading"><h3>${id}</h3><span class="contents" data-rail-count-slot><span class="profile-rail-count" data-profile-rail-count hidden></span></span></header>
            </section>`
    ).join("")
  }
        </div>
      </section>
    </main>`;
}

function props(
  sectionCounts: readonly Record<string, unknown>[] = [],
): SectionProps {
  return {
    archived: false,
    initial: {
      dueInformation: { detail: "", openTaskCount: 0, status: "ready" },
      person: {} as PersonProfile["person"],
      status: "ready",
      summary: {
        primaryContactMethods: [],
        relationshipCounts: [],
        sectionCounts,
      },
    } as unknown as PersonProfile,
    personId,
    workspaceId,
  };
}

const mounted: Array<() => void> = [];

async function mount(sectionProps: SectionProps = props()): Promise<void> {
  await act(async () => {
    mounted.push(await mountPersonRail(document.body, sectionProps));
  });
}

const block = (id: string) =>
  document.querySelector<HTMLElement>(`[data-profile-section="${id}"]`)!;
const chip = (id: string) =>
  block(id).querySelectorAll<HTMLElement>("[data-profile-rail-count]");

afterEach(() => {
  act(() => {
    for (const unmount of mounted.splice(0)) unmount();
  });
  cleanup();
  document.body.innerHTML = "";
});

describe("GAP-028 profile facts rail island", () => {
  it("UXD-002B seeds visible and hidden counts from the profile summary", async () => {
    markup();
    await mount(props([
      { count: 2, id: "contact-methods", status: "ready" },
      { count: 3, id: "relationships", status: "ready" },
      { id: "addresses", status: "hidden" },
      { count: 1, id: "work", status: "ready" },
      { count: 0, id: "pets", status: "ready" },
      { count: 0, id: "notes", status: "ready" },
    ]));

    const heading = document.querySelector<HTMLElement>(
      ".profile-facts-heading",
    )!;
    expect(heading.dataset.island).toBe("person-rail");
    expect(heading.hasAttribute("data-island-ready")).toBe(true);
    expect(
      screen.getByRole("heading", { level: 2, name: "Profile facts" }).id,
    ).toBe("profile-facts-heading");
    // Each block holds exactly one chip: the island replaced the shell's.
    expect(chip("contact-methods")).toHaveLength(1);
    expect(chip("contact-methods")[0]?.textContent).toBe("2");
    expect(chip("contact-methods")[0]?.hidden).toBe(false);
    expect(chip("relationships")[0]?.textContent).toBe("3");
    expect(block("pets").dataset.railEmpty).toBe("true");
    expect(chip("pets")[0]?.textContent).toBe("0");
    expect(chip("addresses")[0]?.hidden).toBe(true);
    expect(chip("addresses")[0]?.textContent).toBe("");
    expect(block("addresses").hasAttribute("data-rail-empty")).toBe(false);
    // Blocks the summary does not count wait for their own load.
    expect(chip("important-dates")[0]?.hidden).toBe(true);
    expect(chip("stay-in-touch")[0]?.hidden).toBe(true);
  });

  it("folds in what each block publishes, from the moment it mounts", async () => {
    markup();
    // A block publishing in the same task as the mount is not lost: the
    // browser runs no `act`, so neither does this step.
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      const mounting = mountPersonRail(
        document.body,
        props([{ count: 2, id: "contact-methods", status: "ready" }]),
      );
      setRailCount("important-dates", 4);
      setRailEmpty("important-dates", false);
      mounted.push(await mounting);
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      environment.IS_REACT_ACT_ENVIRONMENT = true;
    }
    expect(chip("important-dates")[0]?.textContent).toBe("4");

    act(() => {
      setRailCount("contact-methods", 0);
      setRailEmpty("contact-methods", true);
    });
    expect(chip("contact-methods")[0]?.textContent).toBe("0");
    expect(block("contact-methods").dataset.railEmpty).toBe("true");

    act(() => {
      setRailCount("relationships", 20, "page");
    });
    expect(chip("relationships")[0]?.textContent).toBe("20 on this page");

    act(() => {
      setRailCount("contact-methods", undefined);
      setRailEmpty("contact-methods", false);
    });
    expect(chip("contact-methods")[0]?.hidden).toBe(true);
    expect(chip("contact-methods")[0]?.textContent).toBe("");
    expect(block("contact-methods").hasAttribute("data-rail-empty")).toBe(
      false,
    );
    // An event without a change is ignored.
    act(() => {
      document.dispatchEvent(new CustomEvent("person-rail-summary-changed"));
    });
    expect(chip("important-dates")[0]?.textContent).toBe("4");
  });

  it("owns only the blocks the shell drew, and nothing without a heading", async () => {
    markup(["work"]);
    await mount(props([{ count: 1, id: "work", status: "ready" }]));
    expect(chip("work")[0]?.textContent).toBe("1");

    act(() => {
      for (const unmount of mounted.splice(0)) unmount();
    });
    document.body.innerHTML = "<main></main>";
    const unmount = await mountPersonRail(document.body, {
      archived: false,
      personId,
      workspaceId,
    });
    expect(unmount).toBeTypeOf("function");
    unmount();
  });

  it("shows nothing it does not know when the profile has no summary", async () => {
    markup();
    await mount({ archived: false, personId, workspaceId });
    for (const id of RAIL_SECTION_ORDER) {
      expect(chip(id)[0]?.hidden).toBe(true);
      expect(block(id).hasAttribute("data-rail-empty")).toBe(false);
    }
  });
});
