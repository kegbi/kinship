// @vitest-environment happy-dom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatInstant } from "../../lib/time-presentation.ts";
import { clearToasts } from "../../features/shell/toasts/toasts.ts";
import { TOAST_REGION } from "../../testing/shell.ts";
import { mountUnsavedChangesGuard } from "../../lib/unsaved-changes.ts";
import {
  DATE_REQUEST_EVENT,
  setDeceasedDate,
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
  SectionMount,
  SectionProps,
} from "../../features/person/section-mounts.ts";
import { SECTION_REQUEST_EVENT } from "../../features/person/sections.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../testing/api.ts";
import {
  ids,
  personProfile,
  preferences,
  revision,
  sectionProps,
} from "../../testing/fixtures.ts";
import {
  adoptMount,
  drawShell,
  element,
  mountSection,
} from "../../testing/render.tsx";
import { mountPersonHero, personHeroMount } from "./mount.tsx";

const { person: personId, workspace: workspaceId } = ids;
const PERSON = "/api/v1/people/:personId";
const IMPACT = `GET ${PERSON}/deletion-impact`;

/** The hero as the static shell draws it, every wired control disabled. */
function markup(): HTMLElement {
  drawShell(`
    ${TOAST_REGION}
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
    </section>`);
  return element("#person-profile-ready");
}

/** Ada Lovelace's profile, overriding any part of it. */
const profile = (overrides: Parameters<typeof personProfile>[0] = {}) =>
  personProfile({
    ...overrides,
    person: { familyName: "Lovelace", ...overrides?.person },
  });

const utc = preferences();

/** The person a lifecycle answer carries. */
const personAnswer = (
  state: "active" | "archived",
  updatedAt: string,
  more: object = {},
) => ({
  givenName: "Ada",
  id: personId,
  isDeceased: false,
  isPartial: false,
  lifecycle: state,
  updatedAt,
  ...more,
});

/** A saved identity edit renaming Ada Byron. */
const updated = (isPartial: boolean) =>
  jsonResponse({
    person: personAnswer("active", "2026-08-15T09:00:00.000000Z", {
      familyName: "Byron",
      isPartial,
    }),
    status: "updated",
  });

function mount(
  answer: PersonProfile = profile(),
  prefs: SectionProps["preferences"] = utc,
  owner: SectionMount = mountPersonHero,
): Promise<() => void> {
  return mountSection(
    owner,
    sectionProps({
      archived: answer.status === "archived",
      initial: answer,
      preferences: prefs,
    }),
    element("#person-profile-ready"),
  );
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

afterEach(() => {
  clearToasts();
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
    const familyFirst = preferences({
      contactNameOrder: "family_given_nickname",
    });
    const unmount = await mount(
      // The bare fixture carries no family name.
      personProfile({ person: { givenName: "" } }),
      familyFirst,
    );
    expect(heading().textContent).toBe("Unnamed person");
    expect(text("#person-profile-avatar")).toBe("?");
    expect(text("[data-profile-description]")).toBe("No description saved.");
    unmount();
    markup();
    await mount(profile(), familyFirst);
    expect(heading().textContent).toBe("Lovelace Ada");
    expect(document.title).toBe("Lovelace Ada — Kinship");
  });

  it("UXD-002A renders honest vital stats from the profile answer", async () => {
    markup();
    const unmount = await mount(profile({
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

    unmount();
    markup();
    await mount(profile());
    expect(text("[data-profile-last-contact]")).toBe("None recorded");
    expect(text('[data-person-vital-value="next-reminder"]')).toBe(
      "Not recorded",
    );
    expect(text("#person-profile-due-state")).toBe("Not set");
  });

  it("GAP-029 renders a vital published in the mount's own task by the next microtask", async () => {
    const root = markup();
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      const mounting = mountPersonHero(
        root,
        sectionProps({ initial: profile(), preferences: utc }),
      );
      // A section publishing before the hero's effects have run, and with no
      // act to flush React: only microtasks pass before the assertion.
      setVitalStat("work", "Engineer");
      const unmount = await mounting;
      adoptMount(unmount);
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
      "Change avatar",
      "Export vCard",
      "Archive person",
      "Audit history",
      "Merge with another person…",
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
    stubApi({ [`PATCH ${PERSON}`]: updated(false) });
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
    await user.click(
      within(form).getByRole("checkbox", {
        name: "This is a partial identity",
      }),
    );
    const api = stubApi({ [`PATCH ${PERSON}`]: updated(true) });
    await user.click(within(form).getByRole("button", { name: "Save person" }));

    await waitFor(() => expect(heading().textContent).toBe("Ada Byron"));
    expect(api.calls()[0]).toBe(`PATCH /api/v1/people/${personId}`);
    expect(api.bodies()[0]).toEqual({
      description: "",
      expectedUpdatedAt: revision,
      familyName: "Byron",
      givenName: "Ada",
      isDeceased: false,
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
    const api = stubApi({
      [`PATCH ${PERSON}`]: [
        problemResponse(409, {
          detail: "The person changed. Reload before saving.",
          errors: { givenName: "Given name is required." },
          title: "Conflict",
        }),
        unreachable,
      ],
    });
    await user.click(screen.getByRole("button", { name: "Save person" }));
    await waitFor(() =>
      expect(text("#person-lifecycle-status")).toBe(
        "The person changed. Reload before saving.",
      )
    );
    expect(api.bodies()[0]).toMatchObject({
      expectedUpdatedAt: "2026-08-16T08:00:00.000000Z",
    });
    expect(
      screen.getByRole("textbox", { name: /Given name/ })
        .getAttribute("aria-invalid"),
    ).toBe("true");
    expect(screen.getByText("Given name is required.")).toBeTruthy();
    expect(screen.getByRole("form", { name: "Edit person" }).hidden).toBe(
      false,
    );

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
    const lifecycle = vi.fn();
    document.addEventListener("person-lifecycle-changed", lifecycle);
    const archiving = deferred<Response>();
    const api = stubApi({
      [`POST ${PERSON}/archive`]: archiving.promise,
      [`POST ${PERSON}/restore`]: jsonResponse({
        person: personAnswer("active", "2026-08-15T11:00:00.000000Z"),
        status: "restored",
      }),
    });
    const user = userEvent.setup();
    await openMenu();
    await user.click(screen.getByRole("button", { name: "Archive person" }));
    // The lifecycle actions wait while the transition is in flight.
    expect(
      document.querySelector<HTMLButtonElement>("#person-restore")?.disabled,
    ).toBe(true);
    await act(async () => {
      archiving.resolve(jsonResponse({
        person: personAnswer("archived", "2026-08-15T10:00:00.000000Z"),
        status: "archived",
      }));
      await archiving.promise;
    });
    await waitFor(() =>
      expect(screen.getByText("Archived person · read-only").hidden).toBe(
        false,
      )
    );
    expect(api.calls()[0]).toBe(`POST /api/v1/people/${personId}/archive`);
    expect(api.bodies()[0]).toEqual({ expectedUpdatedAt: revision });
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
    await user.click(toasts.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(banner.hidden).toBe(true));
    expect(api.calls()[1]).toBe(`POST /api/v1/people/${personId}/restore`);
    expect(api.bodies()[1]).toEqual({
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
    stubApi({
      [`POST ${PERSON}/restore`]: [
        problemResponse(409, {
          detail: "The person changed.",
          title: "Conflict",
        }),
        unreachable,
      ],
    });
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
    jsonResponse({
      impact: {
        confirmation: "DELETE Ada Lovelace",
        dependentRecordPolicy: "retained",
        person: personAnswer("active", updatedAt),
      },
      status: "ready",
    });

  it("deletes after the confirmation, once however often it is pressed", async () => {
    markup();
    const navigate = vi.fn();
    await mount(profile(), utc, personHeroMount(navigate));
    const impact = deferred<Response>();
    const deleted = deferred<Response>();
    const api = stubApi({
      [IMPACT]: impact.promise,
      [`DELETE ${PERSON}`]: deleted.promise,
    });
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
    await user.type(confirmation, "DELETE Ada Lovelace");
    await user.dblClick(confirm);
    await act(async () => {
      deleted.resolve(jsonResponse({
        next: "/app/people",
        personId,
        status: "deleted",
      }));
      await deleted.promise;
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/app/people"));
    const deletes = api.requests().filter(({ method }) => method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.body).toEqual({
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
    const api = stubApi({
      [IMPACT]: impactAnswer(),
      [`DELETE ${PERSON}`]: [
        problemResponse(422, {
          detail: "The confirmation does not match.",
          title: "Invalid",
        }),
        unreachable,
      ],
    });
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
    expect(api.fetch).toHaveBeenCalledTimes(1);
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
    const stale = deferred<Response>();
    const api = stubApi({
      [IMPACT]: [
        stale.promise,
        problemResponse(503, {
          detail: "Deletion impact is unavailable.",
          title: "Unavailable",
        }),
        unreachable,
      ],
    });
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
    expect(api.calls().some((call) => call.startsWith("DELETE"))).toBe(false);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Delete person" }),
      )
    );

    dialog = await openDeletion();
    await waitFor(() =>
      expect(dialog.textContent).toContain(
        "Deletion impact is temporarily unavailable.",
      )
    );
  });
});

describe("PEOPLE-007 person hero avatar", () => {
  const AVATAR = `${PERSON}/avatar`;
  const imageUrl = `/api/v1/people/${personId}/files/${personId}/content`;
  const png = () =>
    new File([new Uint8Array([0x89, 0x50])], "ada.png", {
      type: "image/png",
    });

  it("draws the avatar's colour behind the initials", async () => {
    markup();
    await mount(profile({ person: { avatar: { color: "#1f6f5c" } } }));
    const avatar = element("#person-profile-avatar");
    expect(avatar.textContent).toBe("AL");
    expect(avatar.style.backgroundColor).toBe("#1f6f5c");
    expect(avatar.getAttribute("aria-hidden")).toBe("true");
    expect(avatar.classList.contains("person-profile-avatar")).toBe(true);
  });

  it("uploads an avatar, holding its controls while it saves, and removes it", async () => {
    markup();
    await mount(profile({ person: { avatar: { color: "#1f6f5c" } } }));
    const user = userEvent.setup();
    await openMenu();
    await user.click(screen.getByRole("button", { name: "Change avatar" }));
    const form = screen.getByRole("form", { name: "Change avatar" });
    const input = within(form).getByLabelText("Avatar image");
    expect(form.hidden).toBe(false);
    expect(document.activeElement, "focused inside the opening click").toBe(
      input,
    );
    expect(within(form).queryByRole("button", { name: "Remove avatar" }))
      .toBeNull();

    const held = deferred<Response>();
    const api = stubApi({
      [`PUT ${AVATAR}`]: held.promise,
      [`DELETE ${AVATAR}`]: jsonResponse({
        avatar: { color: "#1f6f5c" },
        status: "removed",
      }),
    });
    await user.upload(input, png());
    await user.click(
      within(form).getByRole("button", { name: "Upload avatar" }),
    );
    await waitFor(() =>
      expect(text("#person-lifecycle-status")).toBe("Uploading avatar…")
    );
    expect(
      within(form).getByRole("button", { name: "Upload avatar" }),
    ).toHaveProperty("disabled", true);
    const [upload] = api.requests();
    expect(upload?.method).toBe("PUT");
    expect(upload?.headers.get("content-type")).toBe("image/png");
    expect(upload?.headers.get("X-File-Name")).toBe("ada.png");
    expect(upload?.headers.get("X-Workspace-Id")).toBe(workspaceId);
    await act(async () => {
      held.resolve(jsonResponse({
        avatar: { color: "#1f6f5c", imageUrl },
        status: "updated",
      }));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(text("#person-lifecycle-status")).toBe("Avatar updated.")
    );
    expect(form.hidden).toBe(true);
    expect(document.activeElement).toBe(heading());

    await openMenu();
    await user.click(screen.getByRole("button", { name: "Change avatar" }));
    await user.click(
      within(form).getByRole("button", { name: "Remove avatar" }),
    );
    await waitFor(() =>
      expect(text("#person-lifecycle-status")).toBe(
        "Avatar removed. Initials are shown instead.",
      )
    );
    expect(api.calls()).toContain(`DELETE /api/v1/people/${personId}/avatar`);
    expect(element("#person-profile-avatar").textContent).toBe("AL");
  });

  it("keeps a refused image in the editor with the problem's words", async () => {
    markup();
    await mount();
    const user = userEvent.setup();
    await openMenu();
    await user.click(screen.getByRole("button", { name: "Change avatar" }));
    const form = screen.getByRole("form", { name: "Change avatar" });
    await user.click(
      within(form).getByRole("button", { name: "Upload avatar" }),
    );
    expect(text("#person-lifecycle-status")).toBe("Choose an image to upload.");
    stubApi({
      [`PUT ${AVATAR}`]: problemResponse(413, {
        code: "avatar_too_large",
        detail: "Choose an image of 1 MB or less.",
      }),
    });
    await user.upload(within(form).getByLabelText("Avatar image"), png());
    await user.click(
      within(form).getByRole("button", { name: "Upload avatar" }),
    );
    await waitFor(() =>
      expect(text("#person-lifecycle-status")).toBe(
        "Choose an image of 1 MB or less.",
      )
    );
    expect(form.hidden).toBe(false);
    expect(
      within(form).getByRole("button", { name: "Upload avatar" }),
    ).toHaveProperty("disabled", false);

    await user.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(form.hidden).toBe(true);
    expect(text("#person-lifecycle-status")).toBe("Avatar unchanged.");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Change avatar" }),
    );
  });

  it("offers no avatar change for an archived person", async () => {
    markup();
    await mount(profile({ status: "archived" }));
    await openMenu();
    expect(
      screen.queryByRole("button", { name: "Change avatar" }),
    ).toBeNull();
  });
});

describe("GAP-047 the identity editor's breadth", () => {
  const woman = "00000000-0000-4000-8000-000000000301";
  const man = "00000000-0000-4000-8000-000000000302";
  const retired = "00000000-0000-4000-8000-000000000303";
  const genderOptions = [
    { archived: false, id: woman, name: "Woman" },
    { archived: false, id: man, name: "Man" },
  ];

  async function openEditor() {
    await openMenu();
    await userEvent.setup().click(
      screen.getByRole("button", { name: "Edit person" }),
    );
    return screen.getByRole("form", { name: "Edit person" });
  }

  it("edits the description, gender, and deceased state, then asks for the date of death", async () => {
    markup();
    await mount(profile({
      genderOptions,
      person: {
        description: "Mathematician",
        gender: "Woman",
        genderOptionId: woman,
      },
    }));
    const requests = vi.fn();
    document.addEventListener(DATE_REQUEST_EVENT, requests);
    const user = userEvent.setup();
    const form = await openEditor();
    const description = within(form).getByRole("textbox", {
      name: "Description",
    });
    expect(description).toHaveProperty("value", "Mathematician");
    const gender = within(form).getByRole("combobox", { name: "Gender" });
    expect(gender).toHaveProperty("value", woman);
    await user.clear(description);
    await user.type(description, "Wrote the first program");
    await user.selectOptions(gender, man);
    await user.click(
      within(form).getByRole("checkbox", { name: "This person has died" }),
    );
    const api = stubApi({
      [`PATCH ${PERSON}`]: jsonResponse({
        person: personAnswer("active", "2026-08-15T09:00:00.000000Z", {
          description: "Wrote the first program",
          familyName: "Lovelace",
          genderOptionId: man,
          isDeceased: true,
        }),
        status: "updated",
      }),
    });
    await user.click(within(form).getByRole("button", { name: "Save person" }));
    await waitFor(() => expect(form.hidden).toBe(true));
    expect(api.bodies()[0]).toMatchObject({
      description: "Wrote the first program",
      genderOptionId: man,
      isDeceased: true,
    });
    expect(text("[data-profile-description]")).toBe(
      "Wrote the first program",
    );
    expect(text('[data-profile-field="gender"]')).toBe("Man");
    expect(screen.getByText("Deceased", { exact: true }).hidden).toBe(false);
    expect(requests).toHaveBeenCalledOnce();
    expect((requests.mock.calls[0]![0] as CustomEvent).detail).toMatchObject({
      kind: "deceased",
    });
    // Nothing took the date of death, so focus stays in the hero.
    expect(document.activeElement).toBe(heading());
    document.removeEventListener(DATE_REQUEST_EVENT, requests);
  });

  it("shows the date of death and asks for none already recorded", async () => {
    markup();
    await mount(profile({ genderOptions }));
    act(() => setDeceasedDate("November 27 (year unknown)"));
    expect(
      document.querySelector<HTMLElement>("#person-profile-deceased-date")
        ?.hidden,
    ).toBe(true);
    const requests = vi.fn();
    document.addEventListener(DATE_REQUEST_EVENT, requests);
    const user = userEvent.setup();
    const form = await openEditor();
    await user.click(
      within(form).getByRole("checkbox", { name: "This person has died" }),
    );
    stubApi({
      [`PATCH ${PERSON}`]: jsonResponse({
        person: personAnswer("active", "2026-08-15T09:00:00.000000Z", {
          familyName: "Lovelace",
          isDeceased: true,
        }),
        status: "updated",
      }),
    });
    await user.click(within(form).getByRole("button", { name: "Save person" }));
    await waitFor(() => expect(form.hidden).toBe(true));
    expect(text("#person-profile-deceased-date")).toBe(
      "Date of death: November 27 (year unknown)",
    );
    expect(
      document.querySelector<HTMLElement>("#person-profile-deceased-date")
        ?.hidden,
    ).toBe(false);
    expect(requests).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(heading());
    document.removeEventListener(DATE_REQUEST_EVENT, requests);
  });

  it("offers an archived option only as the person's own, and says so", async () => {
    markup();
    await mount(profile({
      genderOptions: [
        ...genderOptions,
        { archived: true, id: retired, name: "Retired" },
      ],
      person: { gender: "Retired", genderOptionId: retired },
    }));
    const form = await openEditor();
    const gender = within(form).getByRole("combobox", { name: "Gender" });
    expect(gender).toHaveProperty("value", retired);
    expect(
      within(gender).getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Not set", "Woman", "Man", "Retired (archived)"]);
  });

  it("shows the refused option's field message", async () => {
    markup();
    await mount(profile({ genderOptions }));
    const user = userEvent.setup();
    const form = await openEditor();
    await user.selectOptions(
      within(form).getByRole("combobox", { name: "Gender" }),
      man,
    );
    stubApi({
      [`PATCH ${PERSON}`]: problemResponse(400, {
        detail: "Review the highlighted identity fields and try again.",
        errors: {
          genderOptionId:
            "That gender option was archived. Choose a current option.",
        },
      }),
    });
    await user.click(within(form).getByRole("button", { name: "Save person" }));
    await waitFor(() =>
      expect(
        within(form).getByText(
          "That gender option was archived. Choose a current option.",
        ),
      ).toBeTruthy()
    );
    expect(form.hidden).toBe(false);
  });

  it("keeps the hero whole when the sections behind its vitals are turned off", async () => {
    markup();
    await mount(profile({
      person: {
        profileSections: [
          { id: "work", status: "hidden" },
          { id: "first-meeting", status: "hidden" },
          { id: "activities", status: "hidden" },
        ],
      },
    }));
    const vitals = element("[data-person-vital-stats]");
    expect(vitals.textContent).not.toContain("Work");
    expect(vitals.textContent).not.toContain("First met");
    expect(vitals.querySelector('a[href="?section=activities"]')).toBeNull();
    expect(vitals.textContent).toContain("Last contact");
    expect(vitals.querySelector('a[href="?section=important-dates"]'))
      .not.toBeNull();
  });

  it("asks for no date of death when the person was already deceased", async () => {
    markup();
    await mount(profile({ genderOptions, person: { isDeceased: true } }));
    const requests = vi.fn();
    document.addEventListener(DATE_REQUEST_EVENT, requests);
    const user = userEvent.setup();
    const form = await openEditor();
    await user.type(
      within(form).getByRole("textbox", { name: "Description" }),
      "Remembered",
    );
    stubApi({
      [`PATCH ${PERSON}`]: jsonResponse({
        person: personAnswer("active", "2026-08-15T09:00:00.000000Z", {
          description: "Remembered",
          familyName: "Lovelace",
          isDeceased: true,
        }),
        status: "updated",
      }),
    });
    await user.click(within(form).getByRole("button", { name: "Save person" }));
    await waitFor(() => expect(form.hidden).toBe(true));
    expect(requests).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(heading());
    document.removeEventListener(DATE_REQUEST_EVENT, requests);
  });

  it("leaves an unchanged gender out of the save, so it is never cleared", async () => {
    markup();
    // The saved option is not among those offered, as when it sorts past
    // the list's cap: the select cannot show it.
    await mount(profile({
      genderOptions,
      person: { gender: "Unlisted", genderOptionId: retired },
    }));
    const user = userEvent.setup();
    const form = await openEditor();
    await user.type(
      within(form).getByRole("textbox", { name: "Nickname" }),
      "Addy",
    );
    const api = stubApi({
      [`PATCH ${PERSON}`]: jsonResponse({
        person: personAnswer("active", "2026-08-15T09:00:00.000000Z", {
          familyName: "Lovelace",
          genderOptionId: retired,
          nickname: "Addy",
        }),
        status: "updated",
      }),
    });
    await user.click(within(form).getByRole("button", { name: "Save person" }));
    await waitFor(() => expect(form.hidden).toBe(true));
    expect(api.bodies()[0]).not.toHaveProperty("genderOptionId");
    expect(api.bodies()[0]).toMatchObject({ nickname: "Addy" });
    expect(text('[data-profile-field="gender"]')).toBe("Unlisted");
  });

  it("keeps focus on the new place when the important dates take the date of death", async () => {
    markup();
    await mount(profile({ genderOptions }));
    const taker = document.createElement("button");
    document.body.append(taker);
    const take = (event: Event) => {
      taker.focus();
      (event as CustomEvent<{ readonly opened: () => void }>).detail.opened();
    };
    document.addEventListener(DATE_REQUEST_EVENT, take);
    const user = userEvent.setup();
    const form = await openEditor();
    await user.click(
      within(form).getByRole("checkbox", { name: "This person has died" }),
    );
    stubApi({
      [`PATCH ${PERSON}`]: jsonResponse({
        person: personAnswer("active", "2026-08-15T09:00:00.000000Z", {
          familyName: "Lovelace",
          isDeceased: true,
        }),
        status: "updated",
      }),
    });
    await user.click(within(form).getByRole("button", { name: "Save person" }));
    await waitFor(() => expect(form.hidden).toBe(true));
    expect(document.activeElement).toBe(taker);
    document.removeEventListener(DATE_REQUEST_EVENT, take);
  });
});

describe("PEOPLE-008 merge from the person menu", () => {
  const other = "00000000-0000-4000-8000-000000000200";

  it("finds the other person, keeps this one, says it cannot be undone, and lands on the kept person", async () => {
    markup();
    const navigate = vi.fn();
    await mount(profile(), utc, personHeroMount(navigate));
    const api = stubApi({
      "GET /api/v1/people": jsonResponse({
        lifecycle: "active",
        people: [{
          familyName: "Lovelace",
          givenName: "Ada",
          id: other,
          isPartial: false,
          isStarred: false,
          lifecycle: "active",
          tagCount: 0,
          tags: [],
        }],
        status: "ready",
      }),
      [`GET ${PERSON}/merge-preview`]: jsonResponse({
        conflicts: [{
          discarded: "12 March",
          fact: "birthday",
          kept: "10 December",
        }],
        conflictsDigest: "ef".repeat(32),
        duplicate: {
          familyName: "Lovelace",
          givenName: "Ada",
          id: other,
          isDeceased: false,
          isPartial: false,
          lifecycle: "active",
          updatedAt: "2026-08-15T11:00:00.000000Z",
        },
        moves: 2,
        primary: personAnswer("active", "2026-08-15T12:00:00.000000Z"),
        status: "ready",
      }),
      [`POST ${PERSON}/merge`]: jsonResponse({
        duplicateId: other,
        moved: 2,
        next: `/app/people/${personId}`,
        person: personAnswer("active", "2026-08-15T13:00:00.000000Z"),
        status: "merged",
      }),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open person menu" }));
    await user.click(
      screen.getByRole("button", { name: "Merge with another person…" }),
    );
    const dialog = within(
      await screen.findByRole("dialog", { name: "Merge two people?" }),
    );
    const search = dialog.getByLabelText("Find the person to merge with");
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(dialog.getByRole("button", { name: "Merge people" }))
      .toHaveProperty("disabled", true);
    await user.type(search, "Ada{Enter}");
    await user.click(
      await dialog.findByRole("button", { name: "Merge with Ada Lovelace" }),
    );
    expect(
      dialog.getByRole("radio", { name: "Keep Ada Lovelace (this person)" }),
    ).toHaveProperty("checked", true);
    expect(dialog.getByText("A merge cannot be undone.")).toBeTruthy();
    expect(
      await dialog.findByText(
        "Birthday — Kept: 10 December, discarded: 12 March",
      ),
    ).toBeTruthy();
    await user.click(dialog.getByRole("button", { name: "Merge people" }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(`/app/people/${personId}`)
    );
    const search_ = api.requests().find((entry) =>
      entry.url.pathname === "/api/v1/people"
    );
    expect(search_?.url.searchParams.get("excludePersonId")).toBe(personId);
    expect(search_?.url.searchParams.get("search")).toBe("Ada");
    const merged = api.requests().find((entry) => entry.method === "POST");
    expect(merged?.url.pathname).toBe(`/api/v1/people/${personId}/merge`);
    // The merge is confirmed against the revisions the preview read, the
    // chosen person's included, not the revision the hero holds.
    expect(merged?.body).toEqual({
      confirmed: true,
      conflictsDigest: "ef".repeat(32),
      duplicateId: other,
      duplicateRevision: "2026-08-15T11:00:00.000000Z",
      primaryRevision: "2026-08-15T12:00:00.000000Z",
    });
  });

  it("cancels back to the menu and offers no merge for an archived person", async () => {
    markup();
    await mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open person menu" }));
    const open = screen.getByRole("button", {
      name: "Merge with another person…",
    });
    await user.click(open);
    const dialog = await screen.findByRole("dialog", {
      name: "Merge two people?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel merge" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Merge two people?" }))
        .toBeNull()
    );
    expect(element("#person-lifecycle-status").textContent).toBe(
      "Merge cancelled. No changes were made.",
    );
    await waitFor(() => expect(document.activeElement).toBe(open));

    markup();
    await mount(profile({ status: "archived" }));
    expect(
      element<HTMLButtonElement>("#person-menu #person-merge-open").hidden,
    ).toBe(true);
  });
});

describe("PEOPLE-010 person hero star", () => {
  const STAR = `${PERSON}/star`;

  it("stars at once, holds the toggle while it saves, and unstars", async () => {
    markup();
    await mount(profile({ person: { isStarred: false } }));
    const user = userEvent.setup();
    const star = screen.getByRole("button", { name: "Star" });
    expect(star.getAttribute("aria-pressed")).toBe("false");
    expect(element("#person-profile-favorite").hidden).toBe(true);
    const held = deferred<Response>();
    const api = stubApi({
      [`PUT ${STAR}`]: held.promise,
      [`DELETE ${STAR}`]: jsonResponse({ isStarred: false, status: "ready" }),
    });
    await user.click(star);
    expect(star.getAttribute("aria-pressed"), "optimistic").toBe("true");
    expect(star).toHaveProperty("disabled", true);
    expect(element("#person-profile-favorite").hidden).toBe(false);
    expect(text("#person-lifecycle-status")).toBe("Starring…");
    expect(api.requests()[0]?.headers.get("X-Workspace-Id")).toBe(
      workspaceId,
    );
    await act(async () => {
      held.resolve(jsonResponse({ isStarred: true, status: "ready" }));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(text("#person-lifecycle-status")).toBe(
        "Starred. Everyone in this workspace sees the star.",
      )
    );
    expect(star).toHaveProperty("disabled", false);
    await user.click(star);
    await waitFor(() =>
      expect(text("#person-lifecycle-status")).toBe("Star removed.")
    );
    expect(star.getAttribute("aria-pressed")).toBe("false");
    expect(api.calls()).toEqual([
      `PUT /api/v1/people/${personId}/star`,
      `DELETE /api/v1/people/${personId}/star`,
    ]);
  });

  it("puts the star back when the change is refused", async () => {
    markup();
    await mount(profile({ person: { isStarred: true } }));
    const user = userEvent.setup();
    stubApi({
      [`DELETE ${STAR}`]: problemResponse(503, {
        code: "person_star_unavailable",
        detail: "The star could not be changed right now.",
      }),
    });
    const star = screen.getByRole("button", { name: "Star" });
    await user.click(star);
    await waitFor(() =>
      expect(text("#person-lifecycle-status")).toBe(
        "The star could not be changed right now.",
      )
    );
    expect(star.getAttribute("aria-pressed"), "rolled back").toBe("true");
    expect(element("#person-profile-favorite").hidden).toBe(false);
  });

  it("puts the star back when the change gets no answer", async () => {
    markup();
    await mount(profile({ person: { isStarred: false } }));
    const user = userEvent.setup();
    stubApi({ [`PUT ${STAR}`]: unreachable });
    const star = screen.getByRole("button", { name: "Star" });
    await user.click(star);
    await waitFor(() =>
      expect(text("#person-lifecycle-status")).toBe(
        "The star could not be changed right now.",
      )
    );
    expect(star.getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps an archived person's star read-only", async () => {
    markup();
    await mount(profile({ person: { isStarred: true }, status: "archived" }));
    const star = screen.getByRole("button", { name: "Star" });
    expect(star).toHaveProperty("disabled", true);
    expect(star.getAttribute("aria-pressed")).toBe("true");
  });
});
