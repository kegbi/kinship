// @vitest-environment happy-dom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatInstant } from "../../lib/time-presentation.ts";
import { clearToasts } from "../../lib/toasts.ts";
import { mountUnsavedChangesGuard } from "../../lib/unsaved-changes.ts";
import {
  setFirstMeetingDate,
  setFirstMeetingPlace,
  setLastContact,
  setNextReminder,
  setStayInTouch,
  setTagPreview,
  setVitalStat,
  tagPreview,
} from "../../features/person/profile-summary.ts";
import type {
  PersonProfile,
  SectionProps,
} from "../../features/person/section-mounts.ts";
import { SECTION_REQUEST_EVENT } from "../../features/person/sections.ts";
import { mountPersonHero, personHeroMount } from "./mount.tsx";

const personId = "00000000-0000-4000-8000-000000000100";
const workspaceId = "00000000-0000-4000-8000-000000000003";
const revision = "2026-08-15T08:00:00.000000Z";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => resolve = done);
  return { promise, resolve };
}

/** The hero as the static shell draws it, every wired control disabled. */
function markup(): HTMLElement {
  document.body.innerHTML = `
    <ul id="app-toasts" aria-live="polite" aria-label="Notifications"></ul>
    <section id="person-profile-ready">
      <header class="person-profile-hero">
        <div class="contents" data-person-hero>
          <h1 id="person-profile-name" tabindex="-1"><span class="sr-only">Loading person…</span></h1>
        </div>
        <div data-person-profile-actions role="group" aria-label="Person actions">
          <button data-person-interaction-capture data-quick-capture data-interaction-intended-kind="activity" type="button">Log interaction</button>
          <div class="contents" data-person-menu-slot>
            <div class="person-menu" role="group" aria-label="Person menu">
              <button id="person-menu-toggle" type="button" aria-label="Open person menu" aria-expanded="false" aria-controls="person-menu" disabled>…</button>
              <div id="person-menu" hidden><button id="person-edit-open" type="button" disabled>Edit person</button></div>
            </div>
          </div>
        </div>
        <div class="contents" data-person-vitals-slot><dl data-person-vital-stats></dl></div>
        <div class="person-hero-tags" data-profile-fact-section="tags">
          <span class="contents" data-person-tags-slot><ul id="person-profile-tags"></ul></span>
          <button data-profile-fact-add type="button" hidden>Edit tags</button>
        </div>
        <div class="contents" data-person-lifecycle-slot>
          <p id="person-lifecycle-status"></p>
          <form id="person-edit-form" data-profile-section="identity-summary" hidden></form>
        </div>
      </header>
      <div class="contents" data-person-archived-slot>
        <aside data-person-archived-banner hidden><button id="person-restore" type="button" disabled>Restore person</button></aside>
      </div>
      <div class="zone-switcher">
        <div data-zone-mini-identity hidden><span data-zone-mini-avatar></span><span data-zone-mini-name></span></div>
      </div>
    </section>`;
  return document.querySelector("#person-profile-ready")!;
}

function profile(
  overrides: {
    readonly person?: Record<string, unknown>;
    readonly dueInformation?: Record<string, unknown>;
    readonly status?: "archived" | "ready";
  } = {},
): PersonProfile {
  return {
    dueInformation: {
      detail: "No due information.",
      openTaskCount: 0,
      status: "ready",
      ...overrides.dueInformation,
    },
    person: {
      familyName: "Lovelace",
      givenName: "Ada",
      id: personId,
      isDeceased: false,
      isPartial: false,
      isSelf: false,
      isStarred: false,
      profileSections: [],
      tagCount: 0,
      tags: [],
      updatedAt: revision,
      ...overrides.person,
    },
    status: overrides.status ?? "ready",
  } as unknown as PersonProfile;
}

const utc = {
  contactNameOrder: "given_family_nickname",
  effectiveTimezone: "UTC",
  locale: "en",
} as unknown as NonNullable<SectionProps["preferences"]>;

const mounted: Array<() => void> = [];

async function mount(
  answer: PersonProfile = profile(),
  preferences: SectionProps["preferences"] = utc,
): Promise<HTMLElement> {
  const root = document.querySelector<HTMLElement>("#person-profile-ready")!;
  await act(async () => {
    mounted.push(
      await mountPersonHero(root, {
        archived: answer.status === "archived",
        initial: answer,
        personId,
        preferences,
        workspaceId,
      }),
    );
  });
  return root;
}

const text = (selector: string) =>
  document.querySelector(selector)?.textContent;
const menuButton = () =>
  screen.getByRole("button", { name: "Open person menu" });
const heading = () => screen.getByRole("heading", { level: 1 });

async function openMenu() {
  if (menuButton().getAttribute("aria-expanded") !== "true") {
    await userEvent.setup().click(menuButton());
  }
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  act(() => {
    for (const unmount of mounted.splice(0)) unmount();
  });
  cleanup();
  clearToasts();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.title = "";
});

describe("PEOPLE-001 person hero island", () => {
  it("renders the identity, breadcrumb, badges, and description in place of the skeleton", async () => {
    markup();
    const hero = document.querySelector<HTMLElement>("[data-person-hero]")!;
    await mount(profile({
      person: {
        description: "Mathematician and correspondent.",
        isDeceased: true,
        isPartial: true,
        isSelf: true,
        isStarred: true,
        nickname: "Enchantress of Numbers",
      },
    }));

    expect(hero.dataset.island).toBe("person-hero");
    expect(hero.hasAttribute("data-island-ready")).toBe(true);
    expect(heading().id).toBe("person-profile-name");
    expect(heading().textContent).toBe(
      "Ada Lovelace “Enchantress of Numbers”",
    );
    expect(text("[data-person-breadcrumb-name]")).toBe(
      "Ada Lovelace “Enchantress of Numbers”",
    );
    expect(text("#person-profile-nickname")).toBe("“Enchantress of Numbers”");
    expect(
      document.querySelector<HTMLElement>("#person-profile-nickname")?.hidden,
    ).toBe(true);
    expect(text("#person-profile-avatar")).toBe("AL");
    const badges = screen.getByRole("group", { name: "Person states" });
    for (
      const badge of [
        "Identity saved",
        "Favorite",
        "Your person record",
        "Deceased",
        "Partial identity · unknown values preserved",
      ]
    ) {
      expect(within(badges).getByText(badge).hidden).toBe(false);
    }
    expect(
      within(badges).getByText("Archived person · read-only").hidden,
    ).toBe(true);
    expect(text("[data-profile-description]")).toBe(
      "Mathematician and correspondent.",
    );
    expect(text("[data-zone-mini-avatar]")).toBe("AL");
    expect(text("[data-zone-mini-name]")).toBe(
      "Ada Lovelace “Enchantress of Numbers”",
    );
    expect(document.title).toBe(
      "Ada Lovelace “Enchantress of Numbers” — Kinship",
    );
    // One identity editor: the island's replaced the shell's.
    expect(document.querySelectorAll("#person-edit-form")).toHaveLength(1);
    expect(document.querySelectorAll("#person-menu-toggle")).toHaveLength(1);
  });

  it("owns nothing without the profile answer or the hero's slots", async () => {
    const root = markup();
    const withoutProfile = await mountPersonHero(root, {
      archived: false,
      personId,
      workspaceId,
    });
    withoutProfile();
    document.querySelector("[data-person-vitals-slot]")?.remove();
    const withoutSlot = await mountPersonHero(root, {
      archived: false,
      initial: profile(),
      personId,
      workspaceId,
    });
    withoutSlot();
    expect(
      document.querySelector("[data-person-hero]")?.hasAttribute(
        "data-island",
      ),
    ).toBe(false);
    expect(text("#person-profile-name")).toBe("Loading person…");
  });

  it("APR-008 applies membership name order and honest placeholders", async () => {
    markup();
    await mount(
      profile({ person: { familyName: undefined, givenName: "" } }),
      { ...utc, contactNameOrder: "family_given_nickname" },
    );
    expect(heading().textContent).toBe("Unnamed person");
    expect(text("#person-profile-avatar")).toBe("?");
    expect(text("[data-profile-description]")).toBe("No description saved.");
    act(() => {
      for (const unmount of mounted.splice(0)) unmount();
    });
    markup();
    await mount(profile(), {
      ...utc,
      contactNameOrder: "family_given_nickname",
    });
    expect(heading().textContent).toBe("Lovelace Ada");
    expect(document.title).toBe("Lovelace Ada — Kinship");
  });

  it("UXD-002A renders honest vital stats from the profile answer", async () => {
    markup();
    await mount(profile({
      dueInformation: {
        nextReminderAt: "2026-08-30T09:00:00.000Z",
        openTaskCount: 3,
        stayInTouchAt: "2026-09-01T09:00:00.000Z",
      },
      person: { lastContactAt: "2026-08-29T09:00:00.000Z" },
    }));
    const vitals = document.querySelector<HTMLElement>(
      "[data-person-vital-stats]",
    )!;
    expect(vitals.contains(document.querySelector("#person-profile-due-state")))
      .toBe(true);
    expect(text('[data-person-vital-value="birthday"]')).toBe("Not recorded");
    expect(text("[data-profile-last-contact]")).toBe(
      formatInstant("2026-08-29T09:00:00.000Z", utc),
    );
    expect(text('[data-person-vital-value="next-reminder"]')).toBe(
      formatInstant("2026-08-30T09:00:00.000Z", utc),
    );
    // Open tasks never stand in for a cadence (APR-006).
    expect(text("#person-profile-due-state")).toBe("Loading cadence…");
    expect(text('[data-person-vital-value="work"]')).toBe("Not recorded");
    expect(text('[data-person-vital-value="first-meeting"]')).toBe(
      "Not recorded",
    );
    expect(
      [...vitals.querySelectorAll("a")].map((link) =>
        link.getAttribute("href")
      ),
    ).toEqual([
      "?section=important-dates",
      "?section=activities",
      "?section=reminders",
      "?section=stay-in-touch",
      "?section=work",
      "?section=first-meeting",
    ]);

    act(() => {
      for (const unmount of mounted.splice(0)) unmount();
    });
    markup();
    await mount(profile());
    expect(text("[data-profile-last-contact]")).toBe("None recorded");
    expect(text('[data-person-vital-value="next-reminder"]')).toBe(
      "Not recorded",
    );
    expect(text("#person-profile-due-state")).toBe("Not set");
  });

  it("GAP-029 renders a vital published in the mount's own task by the next microtask", async () => {
    markup();
    const root = document.querySelector<HTMLElement>("#person-profile-ready")!;
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      const mounting = mountPersonHero(root, {
        archived: false,
        initial: profile(),
        personId,
        preferences: utc,
        workspaceId,
      });
      // A section publishing before the hero's effects have run, and with no
      // act to flush React: only microtasks pass before the assertion.
      setVitalStat("work", "Engineer");
      mounted.push(await mounting);
      await Promise.resolve();
      await Promise.resolve();
      expect(text('[data-person-vital-value="work"]')).toBe("Engineer");
    } finally {
      environment.IS_REACT_ACT_ENVIRONMENT = true;
    }
  });

  it("UXD-002B shows each vital a section publishes, preferring a first-meeting date to its place", async () => {
    markup();
    await mount();
    act(() => {
      setVitalStat("birthday", "Age 34 · March 12, 1992");
      setVitalStat("work", "Engineer");
      setFirstMeetingPlace("Analytical Society");
      setLastContact("Yesterday");
      setNextReminder("Refreshing…");
      setStayInTouch("Every 1 month");
    });
    await waitFor(() =>
      expect(text('[data-person-vital-value="birthday"]')).toBe(
        "Age 34 · March 12, 1992",
      )
    );
    expect(text('[data-person-vital-value="work"]')).toBe("Engineer");
    expect(text('[data-person-vital-value="first-meeting"]')).toBe(
      "Analytical Society",
    );
    expect(text("[data-profile-last-contact]")).toBe("Yesterday");
    expect(text('[data-person-vital-value="next-reminder"]')).toBe(
      "Refreshing…",
    );
    expect(text("#person-profile-due-state")).toBe("Every 1 month");
    act(() => setFirstMeetingDate("June 5, 1833"));
    await waitFor(() =>
      expect(text('[data-person-vital-value="first-meeting"]')).toBe(
        "June 5, 1833",
      )
    );
    act(() => {
      setFirstMeetingDate(undefined);
      setVitalStat("work", "");
    });
    await waitFor(() =>
      expect(text('[data-person-vital-value="first-meeting"]')).toBe(
        "Analytical Society",
      )
    );
    expect(text('[data-person-vital-value="work"]')).toBe("Not recorded");
    act(() => {
      setFirstMeetingPlace(undefined);
      document.dispatchEvent(new CustomEvent("person-hero-facts-changed"));
    });
    await waitFor(() =>
      expect(text('[data-person-vital-value="first-meeting"]')).toBe(
        "Not recorded",
      )
    );
  });

  it("previews the profile's tags, then what the tags section publishes", async () => {
    markup();
    await mount(profile({
      person: {
        tagCount: 9,
        tags: Array.from({ length: 8 }, (_, index) => ({
          id: crypto.randomUUID(),
          name: `Tag ${index}`,
        })),
      },
    }));
    const tags = screen.getByRole("list", { name: "Person tags" });
    expect(tags.children).toHaveLength(9);
    expect(tags.lastElementChild?.textContent).toBe("+1 more");
    // The tags editor beside the preview stays its section's.
    expect(
      document.querySelector('[data-profile-fact-section="tags"] > button'),
    ).not.toBeNull();

    act(() => setTagPreview(tagPreview([])));
    await waitFor(() => expect(tags.textContent).toBe("No tags saved"));
    expect(tags.firstElementChild?.className).toBe("profile-tag-empty");
    act(() => setTagPreview(tagPreview(["Friend", "Colleague"])));
    await waitFor(() => expect(tags.textContent).toBe("FriendColleague"));
    act(() => setTagPreview(undefined));
    await waitFor(() => expect(tags.hidden).toBe(true));
  });

  it("PEOPLE-006 hides the tag preview for a disabled module", async () => {
    markup();
    await mount(profile({
      person: { profileSections: [{ id: "tags", status: "hidden" }] },
    }));
    expect(
      document.querySelector<HTMLElement>("#person-profile-tags")?.hidden,
    ).toBe(true);
  });

  it("REL-039 enables the person menu once wired and toggles it", async () => {
    markup();
    expect(
      document.querySelector<HTMLButtonElement>("#person-menu-toggle")
        ?.disabled,
    ).toBe(true);
    await mount();
    const toggle = menuButton();
    expect((toggle as HTMLButtonElement).disabled).toBe(false);
    const menu = document.querySelector<HTMLElement>("#person-menu")!;
    expect(menu.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const user = userEvent.setup();
    await user.click(toggle);
    expect(menu.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    for (const name of ["Edit person", "Archive person", "Delete person"]) {
      const control = within(menu).getByRole("button", { name });
      expect((control as HTMLButtonElement).disabled).toBe(false);
    }
    expect(
      within(menu).getByRole("link", { name: "Export vCard" })
        .getAttribute("href"),
    ).toBe(`/api/v1/people/${personId}/vcard?workspaceId=${workspaceId}`);
    expect(
      [...menu.children].map((item) => item.textContent),
    ).toEqual([
      "Edit person",
      "Export vCard",
      "Archive person",
      "Audit history",
      "Delete person",
    ]);
    await user.click(toggle);
    expect(menu.hidden).toBe(true);
    await user.click(toggle);
    await user.click(within(menu).getByRole("link", { name: "Export vCard" }));
    expect(menu.hidden).toBe(true);
  });

  it("UXD-002A2 asks the section navigation for Audit history and closes the menu", async () => {
    markup();
    await mount();
    const requested = vi.fn();
    document.addEventListener(SECTION_REQUEST_EVENT, requested);
    await openMenu();
    await userEvent.setup().click(
      screen.getByRole("button", { name: "Audit history" }),
    );
    document.removeEventListener(SECTION_REQUEST_EVENT, requested);
    expect((requested.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      sectionId: "audit-summary",
      view: "admin",
    });
    expect(document.querySelector<HTMLElement>("#person-menu")?.hidden).toBe(
      true,
    );
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
  });
});

describe("PEOPLE-004 person lifecycle in the hero", () => {
  it("APR-008 renames the page title in the same commit as the heading", async () => {
    markup();
    await mount();
    const user = userEvent.setup();
    await openMenu();
    await user.click(screen.getByRole("button", { name: "Edit person" }));
    const form = screen.getByRole("form", { name: "Edit person" });
    const family = within(form).getByRole("textbox", { name: "Family name" });
    await user.clear(family);
    await user.type(family, "Byron");
    vi.mocked(fetch).mockResolvedValueOnce(response({
      person: {
        familyName: "Byron",
        givenName: "Ada",
        id: personId,
        isPartial: false,
        lifecycle: "active",
        updatedAt: "2026-08-15T09:00:00.000000Z",
      },
      status: "updated",
    }));
    // The answer lands outside React's act, as in the browser, and the
    // scheduler yields after every task, as it does on a busy page: whatever
    // the heading shows when it changes, the title must already say too.
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    let clock = performance.now();
    const time = vi.spyOn(performance, "now").mockImplementation(() =>
      clock += 50
    );
    const titles: string[] = [];
    const observer = new MutationObserver(() => {
      if (heading().textContent === "Ada Byron") titles.push(document.title);
    });
    observer.observe(heading(), {
      characterData: true,
      childList: true,
      subtree: true,
    });
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      (form as HTMLFormElement).requestSubmit();
      await vi.waitFor(() => expect(titles.length).toBeGreaterThan(0));
    } finally {
      environment.IS_REACT_ACT_ENVIRONMENT = true;
      observer.disconnect();
      time.mockRestore();
    }
    expect(titles[0]).toBe("Ada Byron — Kinship");
  });

  it("edits the identity, announces the revision, and focuses the renamed heading", async () => {
    const root = markup();
    await mount();
    const fetchMock = vi.mocked(fetch);
    const revisions = vi.fn();
    document.addEventListener("person-revision-changed", revisions);
    const user = userEvent.setup();
    await openMenu();
    await user.click(screen.getByRole("button", { name: "Edit person" }));
    const form = screen.getByRole("form", { name: "Edit person" });
    expect(form.hidden).toBe(false);
    expect(form.dataset.profileSection).toBe("identity-summary");
    expect(document.activeElement).toBe(
      within(form).getByRole("textbox", { name: "Given name" }),
    );
    expect(document.querySelector<HTMLElement>("#person-menu")?.hidden).toBe(
      true,
    );
    const family = within(form).getByRole("textbox", { name: "Family name" });
    await user.clear(family);
    await user.type(family, "Byron");
    await user.click(within(form).getByRole("checkbox"));
    fetchMock.mockResolvedValueOnce(response({
      person: {
        familyName: "Byron",
        givenName: "Ada",
        id: personId,
        isPartial: true,
        lifecycle: "active",
        updatedAt: "2026-08-15T09:00:00.000000Z",
      },
      status: "updated",
    }));
    await user.click(within(form).getByRole("button", { name: "Save person" }));

    await waitFor(() => expect(heading().textContent).toBe("Ada Byron"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/v1/people/${personId}`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      expectedUpdatedAt: revision,
      familyName: "Byron",
      givenName: "Ada",
      isPartial: true,
      middleName: "",
      nickname: "",
    });
    expect(document.activeElement).toBe(heading());
    expect(form.hidden).toBe(true);
    expect(text("#person-lifecycle-status")).toBe("Person identity updated.");
    expect(
      screen.getByText("Partial identity · unknown values preserved").hidden,
    ).toBe(false);
    expect(document.title).toBe("Ada Byron — Kinship");
    expect(root.querySelector('[data-profile-field="familyName"]')?.textContent)
      .toBe("Byron");
    expect((revisions.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      personUpdatedAt: "2026-08-15T09:00:00.000000Z",
    });
    document.removeEventListener("person-revision-changed", revisions);
  });

  it("names a revision another section published and shows a refused save", async () => {
    markup();
    await mount();
    const fetchMock = vi.mocked(fetch);
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-revision-changed", {
          detail: { personUpdatedAt: "2026-08-16T08:00:00.000000Z" },
        }),
      );
      document.dispatchEvent(new CustomEvent("person-revision-changed"));
    });
    const user = userEvent.setup();
    await openMenu();
    await user.click(screen.getByRole("button", { name: "Edit person" }));
    fetchMock.mockResolvedValueOnce(response({
      detail: "The person changed. Reload before saving.",
      errors: { givenName: "Given name is required." },
      status: 409,
      title: "Conflict",
      type: "about:blank",
    }, 409));
    await user.click(screen.getByRole("button", { name: "Save person" }));
    await waitFor(() =>
      expect(text("#person-lifecycle-status")).toBe(
        "The person changed. Reload before saving.",
      )
    );
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).expectedUpdatedAt,
    ).toBe("2026-08-16T08:00:00.000000Z");
    expect(
      screen.getByRole("textbox", { name: /Given name/ })
        .getAttribute("aria-invalid"),
    ).toBe("true");
    expect(screen.getByText("Given name is required.")).toBeTruthy();
    expect(screen.getByRole("form", { name: "Edit person" }).hidden).toBe(
      false,
    );

    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await user.click(screen.getByRole("button", { name: "Save person" }));
    await waitFor(() =>
      expect(text("#person-lifecycle-status")).toBe(
        "Person update is temporarily unavailable.",
      )
    );
  });

  it("APR-001 explicitly discards the identity draft on Cancel", async () => {
    const root = markup();
    mountUnsavedChangesGuard({ confirmMessage: "Discard?", root });
    await mount();
    const user = userEvent.setup();
    await openMenu();
    await user.click(screen.getByRole("button", { name: "Edit person" }));
    const given = screen.getByRole("textbox", { name: "Given name" });
    await user.clear(given);
    await user.type(given, "Augusta");
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    globalThis.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    // Cancel discards through the form's native reset, the event the
    // unsaved-changes guard takes as an explicit discard.
    const reset = vi.fn();
    root.addEventListener("reset", reset);
    await user.click(screen.getByRole("button", { name: "Cancel edit" }));
    root.removeEventListener("reset", reset);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLElement>("#person-edit-form")?.hidden)
      .toBe(true);
    expect((given as HTMLInputElement).value).toBe("Ada");
    expect(text("#person-lifecycle-status")).toBe(
      "Edit cancelled. No changes were saved.",
    );
    // Focus returns to Edit person, in the menu it was opened from.
    expect(document.querySelector<HTMLElement>("#person-menu")?.hidden).toBe(
      false,
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Edit person" }),
    );
    // Reopening starts from the saved identity, not the discarded draft.
    await user.click(screen.getByRole("button", { name: "Edit person" }));
    expect(
      (screen.getByRole("textbox", { name: "Given name" }) as HTMLInputElement)
        .value,
    ).toBe("Ada");
  });

  it("archives with an undo toast, then restores from the banner", async () => {
    markup();
    await mount();
    const fetchMock = vi.mocked(fetch);
    const lifecycle = vi.fn();
    document.addEventListener("person-lifecycle-changed", lifecycle);
    const archiving = deferred<Response>();
    fetchMock.mockReturnValueOnce(archiving.promise);
    const user = userEvent.setup();
    await openMenu();
    await user.click(screen.getByRole("button", { name: "Archive person" }));
    // The lifecycle actions wait while the transition is in flight.
    expect(
      document.querySelector<HTMLButtonElement>("#person-restore")?.disabled,
    ).toBe(true);
    await act(async () => {
      archiving.resolve(response({
        person: {
          givenName: "Ada",
          id: personId,
          isPartial: false,
          lifecycle: "archived",
          updatedAt: "2026-08-15T10:00:00.000000Z",
        },
        status: "archived",
      }));
      await archiving.promise;
    });
    await waitFor(() =>
      expect(screen.getByText("Archived person · read-only").hidden).toBe(
        false,
      )
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/v1/people/${personId}/archive`,
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      expectedUpdatedAt: revision,
    });
    expect((lifecycle.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      archived: true,
      personId,
      personUpdatedAt: "2026-08-15T10:00:00.000000Z",
      state: "archived",
    });
    expect(document.activeElement).toBe(heading());
    const banner = document.querySelector<HTMLElement>(
      "[data-person-archived-banner]",
    )!;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain(
      "This person is archived. Editing is disabled.",
    );
    // Editing and archiving leave the menu; the controls stay addressable.
    expect(document.querySelector<HTMLElement>("#person-edit-open")?.hidden)
      .toBe(true);
    expect(document.querySelector<HTMLElement>("#person-archive")?.hidden)
      .toBe(true);
    const toasts = within(document.querySelector<HTMLElement>("#app-toasts")!);
    expect(
      toasts.getByText("Person archived. They now appear in Archived people."),
    ).toBeTruthy();

    // Undo restores with the revision the archive answered.
    fetchMock.mockResolvedValueOnce(response({
      person: {
        givenName: "Ada",
        id: personId,
        isPartial: false,
        lifecycle: "active",
        updatedAt: "2026-08-15T11:00:00.000000Z",
      },
      status: "restored",
    }));
    await user.click(toasts.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(banner.hidden).toBe(true));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/v1/people/${personId}/restore`,
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      expectedUpdatedAt: "2026-08-15T10:00:00.000000Z",
    });
    expect(
      toasts.getByText("Person restored. They now appear in People."),
    ).toBeTruthy();
    expect((lifecycle.mock.calls[1]?.[0] as CustomEvent).detail.state).toBe(
      "active",
    );
    document.removeEventListener("person-lifecycle-changed", lifecycle);
  });

  it("distinguishes an archived person as read-only and restores from the banner", async () => {
    markup();
    await mount(profile({ status: "archived" }));
    const banner = document.querySelector<HTMLElement>(
      "[data-person-archived-banner]",
    )!;
    expect(banner.hidden).toBe(false);
    expect(screen.getByText("Archived person · read-only").hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("#person-edit-open")?.hidden)
      .toBe(true);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(response({
      detail: "The person changed.",
      status: 409,
      title: "Conflict",
      type: "about:blank",
    }, 409)).mockRejectedValueOnce(new TypeError("offline"));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Restore person" }));
    await waitFor(() =>
      expect(text("#person-lifecycle-status")).toBe("The person changed.")
    );
    expect(banner.hidden).toBe(false);
    await user.click(screen.getByRole("button", { name: "Restore person" }));
    await waitFor(() =>
      expect(text("#person-lifecycle-status")).toBe(
        "Person restore is temporarily unavailable.",
      )
    );
    expect(
      (screen.getByRole("button", {
        name: "Restore person",
      }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  async function openDeletion(): Promise<HTMLElement> {
    const user = userEvent.setup();
    await openMenu();
    await user.click(screen.getByRole("button", { name: "Delete person" }));
    return await screen.findByRole("dialog", { name: "Delete this person?" });
  }

  const impactAnswer = (updatedAt = "2026-08-15T12:00:00.000000Z") =>
    response({
      impact: {
        confirmation: "DELETE Ada Lovelace",
        dependentRecordPolicy: "retained",
        person: {
          givenName: "Ada",
          id: personId,
          isPartial: false,
          lifecycle: "active",
          updatedAt,
        },
      },
      status: "ready",
    });

  it("deletes after the confirmation, once however often it is pressed", async () => {
    const root = markup();
    const navigate = vi.fn();
    await act(async () => {
      mounted.push(
        await personHeroMount(navigate)(root, {
          archived: false,
          initial: profile(),
          personId,
          preferences: utc,
          workspaceId,
        }),
      );
    });
    const fetchMock = vi.mocked(fetch);
    const impact = deferred<Response>();
    fetchMock.mockReturnValueOnce(impact.promise);
    const dialog = await openDeletion();
    expect(dialog.textContent).toContain("Loading deletion impact…");
    const confirm = within(dialog).getByRole("button", {
      name: "Confirm delete",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await act(async () => {
      impact.resolve(impactAnswer());
      await impact.promise;
    });
    await waitFor(() =>
      expect(dialog.textContent).toContain("Related records are retained")
    );
    expect(dialog.textContent).toContain("DELETE Ada Lovelace");
    const confirmation = within(dialog).getByLabelText("Confirmation");
    expect(document.activeElement).toBe(confirmation);
    expect(confirm.disabled).toBe(false);

    const user = userEvent.setup();
    const deleted = deferred<Response>();
    fetchMock.mockReturnValueOnce(deleted.promise);
    await user.type(confirmation, "DELETE Ada Lovelace");
    await user.dblClick(confirm);
    await act(async () => {
      deleted.resolve(response({
        next: "/app/people",
        personId,
        status: "deleted",
      }));
      await deleted.promise;
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/app/people"));
    const deletes = fetchMock.mock.calls.filter(([, init]) =>
      init?.method === "DELETE"
    );
    expect(deletes).toHaveLength(1);
    expect(JSON.parse(String(deletes[0]?.[1]?.body))).toEqual({
      confirmation: "DELETE Ada Lovelace",
      expectedUpdatedAt: "2026-08-15T12:00:00.000000Z",
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Delete this person?" }))
        .toBeNull()
    );
  });

  it("keeps a refused delete in the dialog with its confirmation for a retry", async () => {
    markup();
    await mount();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(impactAnswer());
    const dialog = await openDeletion();
    const confirmation = await within(dialog).findByLabelText("Confirmation");
    await waitFor(() => expect(document.activeElement).toBe(confirmation));
    const user = userEvent.setup();
    const confirm = within(dialog).getByRole("button", {
      name: "Confirm delete",
    }) as HTMLButtonElement;
    // An empty confirmation is refused before anything is sent.
    await user.click(confirm);
    await waitFor(() =>
      expect(confirmation.getAttribute("aria-invalid")).toBe("true")
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(response({
      detail: "The confirmation does not match.",
      status: 422,
      title: "Invalid",
      type: "about:blank",
    }, 422)).mockRejectedValueOnce(new TypeError("offline"));
    await user.type(confirmation, "DELETE Ada");
    await user.click(confirm);
    await waitFor(() =>
      expect(dialog.textContent).toContain("The confirmation does not match.")
    );
    expect(document.activeElement).toBe(confirmation);
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    await waitFor(() =>
      expect(dialog.textContent).toContain(
        "Person deletion is temporarily unavailable.",
      )
    );
  });

  it("[PEOPLE-004] cancels deletion by button or Escape and returns focus to Delete person", async () => {
    markup();
    await mount();
    const fetchMock = vi.mocked(fetch);
    const stale = deferred<Response>();
    fetchMock.mockReturnValueOnce(stale.promise);
    const user = userEvent.setup();
    let dialog = await openDeletion();
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel delete" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Delete this person?" }))
        .toBeNull()
    );
    expect(text("#person-lifecycle-status")).toBe(
      "Delete cancelled. No changes were made.",
    );
    expect(document.querySelector<HTMLElement>("#person-menu")?.hidden).toBe(
      false,
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Delete person" }),
      )
    );
    // The impact answering after the cancel is ignored.
    await act(async () => {
      stale.resolve(impactAnswer());
      await stale.promise;
    });

    fetchMock.mockResolvedValueOnce(response({
      detail: "Deletion impact is unavailable.",
      status: 503,
      title: "Unavailable",
      type: "about:blank",
    }, 503));
    dialog = await openDeletion();
    await waitFor(() =>
      expect(dialog.textContent).toContain("Deletion impact is unavailable.")
    );
    expect(
      (within(dialog).getByRole("button", {
        name: "Confirm delete",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Delete this person?" }))
        .toBeNull()
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE"))
      .toBe(false);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Delete person" }),
      )
    );

    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    dialog = await openDeletion();
    await waitFor(() =>
      expect(dialog.textContent).toContain(
        "Deletion impact is temporarily unavailable.",
      )
    );
  });
});
