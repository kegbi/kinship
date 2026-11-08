// @vitest-environment happy-dom
import { formatInstant } from "../../lib/time-presentation.ts";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mountPersonWorkspace,
  SECTION_NOTICE_LINK_TEMPLATE_ID,
} from "./workspace.ts";
import {
  RAIL_MOUNT,
  SECTION_MOUNTS,
  TAGS_MOUNT,
  TIMELINE_MOUNT,
} from "./section-mounts.ts";
import { clearToasts } from "../shell/toasts/toasts.ts";
import { TOAST_REGION } from "../../testing/shell.ts";

import {
  badgeVariants,
  segmentVariants,
} from "../../components/ui/variants.ts";
import {
  type ApiHandler,
  type ApiRoutes,
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  type StubbedApi,
  unreachable,
} from "../../testing/api.ts";
import {
  ids,
  personProfile,
  preferences,
  workspaceSession,
} from "../../testing/fixtures.ts";
import { adoptMount, drawShell } from "../../testing/render.tsx";

const segment = segmentVariants();

// The page keeps no handle on the islands it mounts, so each is handed to the
// test's teardown here: every island a test mounted is unmounted when it
// ends, and none renders into a later test or after the document is gone
// (REL-071).
vi.mock("../../islands/core/index.ts", async (original) => {
  const core = await original<typeof import("../../islands/core/index.ts")>();
  return {
    ...core,
    mountIsland: (...args: Parameters<typeof core.mountIsland>) =>
      adoptMount(core.mountIsland(...args)),
  };
});

beforeEach(async () => {
  // Every owner's code finishes loading before the page mounts (REL-071).
  // Vitest's module runner can hand a second `import()` of a module still
  // evaluating its first one back half-initialised, where a browser waits,
  // so a test must not depend on an earlier one having warmed that code.
  await Promise.all(
    [
      ...Object.values(SECTION_MOUNTS),
      RAIL_MOUNT,
      TAGS_MOUNT,
      TIMELINE_MOUNT,
    ].map((owner) => owner.load()),
  );
});

const { person: personId, workspace: workspaceId } = ids;
const firstRunPersonId = "00000000-0000-4000-8000-000000000101";
const session = workspaceSession({
  member: { id: ids.member, role: "member" },
});

const SESSION = "GET /api/v1/session";
const PROFILE = "GET /api/v1/people/:personId";
const VIEW = "POST /api/v1/people/:personId/view";
const VIEWED = `POST /api/v1/people/${personId}/view`;
const FILES = "GET /api/v1/people/:personId/files";
const GIFTS = "GET /api/v1/people/:personId/gifts";
const AUDIT = "GET /api/v1/people/:personId/audit";
const UI_STATE = "PATCH /api/v1/member/ui-state";
const REMINDERS = "* /api/v1/people/:personId/reminders";
const REST = "* /api/v1/*";
const recorded = jsonResponse({ status: "recorded" });
const noFiles = jsonResponse({ files: [], status: "ready" });
const noAudit = jsonResponse({ items: [], status: "ready" });
const noReminders = jsonResponse({
  cadences: [],
  reminders: [],
  status: "ready",
});
const noGifts = (supportedCurrencyCodes: readonly string[] = ["USD"]) =>
  jsonResponse({
    debts: [],
    defaultCurrencyCode: "USD",
    gifts: [],
    recurringDebts: [],
    status: "ready",
    supportedCurrencyCodes,
  });

/**
 * Ada's profile read, with no family name unless `person` names one. The
 * overrides are loose on purpose: the page also meets states the contract
 * types do not list (due information "unavailable", retired section ids).
 */
function profileOf(
  person: Record<string, unknown> = {},
  rest: {
    readonly dueInformation?: Record<string, unknown>;
    readonly status?: "ready" | "archived";
    readonly summary?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  const base = personProfile();
  return {
    ...base,
    dueInformation: {
      ...base.dueInformation,
      detail: "No due information.",
      ...rest.dueInformation,
    },
    person: { ...base.person, ...person },
    status: rest.status ?? base.status,
    ...(rest.summary ? { summary: rest.summary } : {}),
  };
}

const lovelace = { familyName: "Lovelace" } as const;
const unavailableDue = {
  detail: "Due information will become available with planning.",
  status: "unavailable",
} as const;

/**
 * Answers the page's session and profile reads, then `routes`; anything else
 * fails as an unreachable server would unless `routes` answers `REST`.
 */
function stubProfile(
  profile: unknown = profileOf(lovelace),
  { [REST]: rest = unreachable, ...routes }: ApiRoutes = {},
): StubbedApi {
  return stubApi({
    [SESSION]: jsonResponse(session),
    [PROFILE]: jsonResponse(profile),
    ...routes,
    [REST]: rest,
  });
}

/** Holds every request until `released`, then fails it as unreachable. */
const heldUntil = (released: Promise<void>): ApiHandler => (request) =>
  released.then(() => unreachable(request));

/** Each request line naming `suffix`. */
const requested = (api: StubbedApi, suffix: string) =>
  api.calls().filter((call) => call.includes(suffix));

function markup(path = `/app/people/${personId}`): void {
  vi.stubGlobal(
    "requestIdleCallback",
    (callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 50 });
      return 1;
    },
  );
  history.replaceState({}, "", path);
  drawShell(`
    ${TOAST_REGION}
    <section id="person-profile-state" tabindex="-1" hidden>
      <p class="eyebrow">Person workspace</p><h1 data-profile-state-heading></h1>
      <p data-profile-state-detail></p><a data-profile-state-link href="/app"></a>
    </section>
    <template id="${SECTION_NOTICE_LINK_TEMPLATE_ID}"><a href="/app/settings/personalization?section=profile-modules">Open personalization</a></template>
    <section id="person-profile-ready" aria-busy="true">
      <header class="person-profile-hero">
        <div class="contents" data-person-hero>
          <h1 id="person-profile-name" tabindex="-1"><span class="skeleton skeleton-line skeleton-line-60" aria-hidden="true"></span><span class="sr-only">Loading person…</span></h1>
        </div>
        <div data-person-profile-actions role="group" aria-label="Person actions">
          <button data-person-interaction-capture data-quick-capture data-interaction-intended-kind="activity" type="button">Log interaction</button>
          <button data-person-interaction-capture data-quick-capture data-interaction-intended-kind="note" type="button">Add note</button>
          <div class="contents" data-person-menu-slot>
            <div role="group" aria-label="Person menu">
              <button id="person-menu-toggle" type="button" disabled aria-label="Open person menu" aria-expanded="false" aria-controls="person-menu"><span aria-hidden="true">…</span></button>
              <div id="person-menu" hidden>
                <button id="person-edit-open" type="button" disabled>Edit person</button>
                <button id="person-archive" type="button" disabled>Archive person</button>
                <button id="person-audit-history" type="button" disabled>Audit history</button>
                <button id="person-delete-open" type="button" disabled>Delete person</button>
              </div>
            </div>
          </div>
        </div>
        <div class="contents" data-person-vitals-slot><dl data-person-vital-stats></dl></div>
        <div class="person-hero-tags">
          <span class="contents" data-person-tags-slot><ul id="person-profile-tags"></ul></span>
        </div>
        <div class="contents" data-person-lifecycle-slot>
          <p id="person-lifecycle-status"></p>
          <form id="person-edit-form" data-profile-section="identity-summary" hidden></form>
        </div>
      </header>
      <div class="contents" data-person-archived-slot>
        <aside data-person-archived-banner hidden>
          <button id="person-restore" type="button" disabled>Restore person</button>
        </aside>
      </div>
      <nav id="person-profile-sections">
        <ul>
          <li><a href="?section=identity-summary" data-section-link="identity-summary">Identity summary</a></li>
          <li><a href="?section=important-dates" data-section-link="important-dates">Important dates</a></li>
          <li><a href="?section=documents" data-section-link="documents">Documents</a></li>
          <li><a href="?section=photos" data-section-link="photos">Photos</a></li>
          <li><a href="?section=audit-summary" data-section-link="audit-summary">Audit summary</a></li>
        </ul>
        <p id="person-profile-section-notice" role="status" tabindex="-1" hidden></p>
      </nav>
      <section id="profile-section-important-dates" data-profile-section="important-dates" tabindex="-1"><h2>Important dates</h2></section>
       <div class="profile-section-list">
         <div class="zone-switcher">
          <div data-zone-mini-identity aria-hidden="true" hidden>
            <span data-zone-mini-avatar></span><span data-zone-mini-name></span>
          </div>
          <div role="group" aria-label="Filter person sections">
            <button class="${segment}" data-zone-filter="all" type="button" aria-pressed="true">All</button>
            <button class="${segment}" data-zone-filter="timeline" type="button" aria-pressed="false">Timeline</button>
            <button class="${segment}" data-zone-filter="planning" type="button" aria-pressed="false">Planning</button>
            <button class="${segment}" data-zone-filter="things" type="button" aria-pressed="false">Things</button>
            <button class="${segment}" data-zone-filter="admin" type="button" aria-pressed="false">Admin</button>
           </div>
         </div>
        <section id="person-first-run" class="person-first-run" aria-labelledby="person-first-run-heading" hidden>
          <h2 id="person-first-run-heading">Start this person's story</h2>
          <p>Nothing is recorded for this person yet. These three make everything else useful.</p>
          <div class="person-first-run-actions" role="group" aria-label="First actions">
            <button class="button-primary" data-first-run-action="first-meeting" type="button">Log how you met</button>
            <button class="button-secondary" data-first-run-action="important-dates" type="button">Add a birthday</button>
            <button class="button-secondary" data-first-run-action="stay-in-touch" type="button">Set a stay-in-touch cadence</button>
          </div>
          <button class="button-secondary" data-first-run-dismiss type="button">Show all sections</button>
        </section>
         <section class="person-zone" data-zone="timeline" aria-labelledby="person-zone-timeline-heading">
          <h2 id="person-zone-timeline-heading">Timeline</h2>
          <p class="section-state" data-test-section-state>Loading timeline…</p>
        </section>
        <section class="person-zone" data-zone="planning" aria-labelledby="person-zone-planning-heading">
          <h2 id="person-zone-planning-heading">Planning</h2>
        </section>
        <section class="person-zone" data-zone="things" aria-labelledby="person-zone-things-heading">
          <h2 id="person-zone-things-heading">Things</h2>
          <section id="profile-section-documents" data-profile-section="documents" tabindex="-1"><h3>Documents</h3></section>
          <section id="profile-section-photos" data-profile-section="photos" tabindex="-1"><h3>Photos</h3></section>
        </section>
        <section class="person-zone" data-zone="admin" aria-labelledby="person-zone-admin-heading">
          <h2 id="person-zone-admin-heading">Admin</h2>
          <section id="profile-section-audit-summary" data-profile-section="audit-summary" tabindex="-1"><h3>Audit summary</h3></section>
        </section>
      </div>
    </section>`);
}

function deferredZoneMarkup(): void {
  for (const [id, kind] of [["documents", "document"], ["photos", "photo"]]) {
    const root = document.querySelector<HTMLElement>(
      `[data-profile-section="${id}"]`,
    )!;
    root.dataset.personFiles = kind;
    root.dataset.sectionState = "loading";
    root.insertAdjacentHTML(
      "beforeend",
      `<span data-file-badge></span><p data-file-state class="section-state"></p>
       <button data-file-refresh type="button" hidden>Retry</button>
       <ul data-file-list></ul><button data-file-add type="button">Add</button>
       <form data-file-form hidden><input name="title"><input name="file" type="file"><button data-file-cancel type="button">Cancel</button></form>`,
    );
  }
  document.querySelector('[data-zone="things"]')?.insertAdjacentHTML(
    "beforeend",
    [["gifts", "gift"], ["debts", "debt"]].map(([id, kind]) =>
      `<section data-profile-section="${id}" data-person-gifts="${kind}" data-section-state="loading">
           <span data-gift-badge></span><p data-gift-state class="section-state"></p>
           <button data-gift-retry type="button" hidden>Retry</button>
           <ul data-gift-list></ul><button data-gift-add type="button">Add</button>
           <form data-gift-form hidden><button data-gift-cancel type="button">Cancel</button></form>
         </section>`
    ).join(""),
  );
  const audit = document.querySelector<HTMLElement>(
    '[data-profile-section="audit-summary"]',
  )!;
  audit.dataset.personAuditSummary = "";
  audit.insertAdjacentHTML(
    "beforeend",
    `<span data-person-audit-badge></span><p data-person-audit-state class="section-state"></p>
     <ol data-person-audit-list></ol><a data-person-audit-link></a>
     <button data-person-audit-retry type="button" hidden>Retry</button>`,
  );
}

function stubDeferredZoneObserver(): {
  readonly activate: (
    zone: "timeline" | "planning" | "things" | "admin",
  ) => void;
  readonly observed: readonly Element[];
} {
  let zoneCallback: IntersectionObserverCallback | undefined;
  let zoneObserver: IntersectionObserver | undefined;
  const observed: Element[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      readonly root = null;
      readonly rootMargin: string;
      readonly thresholds = [0];

      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        this.rootMargin = options?.rootMargin ?? "0px";
        if (this.rootMargin === "400px") {
          zoneCallback = callback;
          zoneObserver = this as unknown as IntersectionObserver;
        }
      }

      disconnect = vi.fn();
      observe = (target: Element) => {
        if (this.rootMargin === "400px") observed.push(target);
      };
      takeRecords = () => [];
      unobserve = vi.fn();
    },
  );
  return {
    activate(zone) {
      const target = document.querySelector<HTMLElement>(
        `[data-zone="${zone}"]`,
      )!;
      zoneCallback?.(
        [{
          isIntersecting: true,
          target,
        } as unknown as IntersectionObserverEntry],
        zoneObserver!,
      );
    },
    observed,
  };
}

function interactionSectionMarkup(): void {
  document.querySelector("#person-profile-sections ul")?.insertAdjacentHTML(
    "beforeend",
    `<li><a href="?section=activities" data-section-link="activities">Activities</a></li>
     <li><a href="?section=notes" data-section-link="notes">Notes</a></li>`,
  );
  document.querySelector('[data-zone="timeline"]')?.insertAdjacentHTML(
    "beforeend",
    `<section data-profile-section="activities" tabindex="-1">
       <p id="person-activities-state"></p><ul id="person-activities-list"></ul>
       <button id="person-activities-retry" type="button" hidden>Retry activities</button>
     </section>
     <section data-profile-section="notes" tabindex="-1">
       <p id="person-notes-state"></p><ul id="person-notes-list"></ul>
       <button id="person-notes-retry" type="button" hidden>Retry notes</button>
     </section>`,
  );
}

function summaryRailMarkup(): void {
  document.querySelector("#person-profile-ready")?.insertAdjacentHTML(
    "beforeend",
    `
      <header class="profile-facts-heading"><h2 id="profile-facts-heading">Profile facts</h2></header>
      <section data-profile-section="contact-methods" data-profile-fact-section="contact-methods" data-section-state="loading">
        <header class="profile-section-heading">
          <h3>Contact methods</h3>
          <span data-rail-count-slot><span data-profile-rail-count hidden></span></span>
          <button data-profile-fact-add data-profile-fact-add-icon aria-label="Add contact methods"><span aria-hidden="true">+</span></button>
        </header>
        <p data-profile-fact-state></p><ul data-profile-fact-list></ul>
        <form data-profile-fact-form></form>
      </section>
      ${
      [
        "relationships",
        "addresses",
        "work",
        "pets",
        "food-preferences",
        "first-meeting",
      ].map((id) =>
        `<section data-profile-section="${id}"><span data-rail-count-slot><span data-profile-rail-count hidden></span></span></section>`
      ).join("")
    }`,
  );
}

function reminderSectionMarkup(): void {
  document.querySelector("#person-profile-sections ul")?.insertAdjacentHTML(
    "beforeend",
    `<li><a href="?section=reminders" data-section-link="reminders">Reminders</a></li>`,
  );
  document.querySelector('[data-zone="planning"]')?.insertAdjacentHTML(
    "beforeend",
    `<section data-profile-section="reminders" tabindex="-1">
       <form data-reminder-form>
         <input name="title"><button type="submit">Save reminder</button>
       </form>
     </section>`,
  );
  document.querySelector('[data-zone="admin"]')?.insertAdjacentHTML(
    "beforeend",
    `<section data-person-audit-summary>
       <p data-person-audit-state></p><span data-person-audit-badge></span>
       <ol data-person-audit-list></ol><a data-person-audit-link></a>
       <button data-person-audit-retry type="button">Retry audit</button>
     </section>`,
  );
}

function firstRunActionMarkup(): {
  readonly birthday: HTMLButtonElement;
  readonly cadenceAdd: HTMLButtonElement;
  readonly firstMeeting: HTMLButtonElement;
} {
  document.querySelector("#person-profile-sections ul")?.insertAdjacentHTML(
    "beforeend",
    `<li><a href="?section=first-meeting" data-section-link="first-meeting">First meeting</a></li>
     <li><a href="?section=stay-in-touch" data-section-link="stay-in-touch">Stay in touch</a></li>
     <li><a href="?section=reminders" data-section-link="reminders">Reminders</a></li>`,
  );
  document.querySelector("#profile-section-important-dates")
    ?.insertAdjacentHTML(
      "beforeend",
      '<button id="important-date-add" type="button" hidden>Add important date</button>',
    );
  document.querySelector("#person-profile-ready")?.insertAdjacentHTML(
    "beforeend",
    `<section data-profile-section="first-meeting" tabindex="-1">
       <button data-profile-fact-add type="button" hidden>Add first meeting</button>
     </section>
     <section data-profile-section="stay-in-touch" tabindex="-1">
       <header><h3>Stay in touch</h3><button data-cadence-add type="button" aria-label="Add stay-in-touch cadence" hidden>+</button></header>
       <p data-cadence-state></p><ul data-cadence-list></ul>
       <form data-cadence-form hidden><input name="intervalCount"><button type="submit">Save cadence</button></form>
     </section>`,
  );
  document.querySelector('[data-zone="planning"]')?.insertAdjacentHTML(
    "beforeend",
    `<section data-profile-section="reminders" tabindex="-1">
       <p data-reminder-state></p><ul data-reminder-list></ul>
       <form data-reminder-form><input name="title"><button type="submit">Save reminder</button></form>
     </section>`,
  );
  return {
    birthday: document.querySelector<HTMLButtonElement>(
      "#important-date-add",
    )!,
    cadenceAdd: document.querySelector<HTMLButtonElement>(
      "[data-cadence-add]",
    )!,
    firstMeeting: document.querySelector<HTMLButtonElement>(
      '[data-profile-section="first-meeting"] [data-profile-fact-add]',
    )!,
  };
}

const zeroSummary = {
  primaryContactMethods: [],
  relationshipCounts: [],
  sectionCounts: [
    { count: 0, id: "contact-methods", status: "ready" },
    { count: 0, id: "addresses", status: "ready" },
    { count: 0, id: "first-meeting", status: "ready" },
    { count: 0, id: "relationships", status: "ready" },
    { count: 0, id: "work", status: "ready" },
    { count: 0, id: "food-preferences", status: "ready" },
    { count: 0, id: "pets", status: "ready" },
    { id: "tags", status: "hidden" },
    { count: 0, id: "notes", status: "ready" },
    { count: 0, id: "activities", status: "ready" },
    { count: 0, id: "conversations", status: "ready" },
    { count: 0, id: "calls", status: "ready" },
    { count: 0, id: "tasks", status: "ready" },
    { count: 0, id: "life-events", status: "ready" },
  ],
} as const;

function zeroProfile(
  overrides: {
    readonly status?: "archived" | "ready";
    readonly summary?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return profileOf({ familyName: "Profile", givenName: "Empty" }, {
    status: overrides.status ?? "ready",
    summary: { ...zeroSummary, ...overrides.summary },
  });
}

it("APR-008 applies membership name order to profile heading, breadcrumb, mini identity and title", async () => {
  markup();
  const api = stubProfile(undefined, {
    [SESSION]: jsonResponse(workspaceSession({
      member: { id: ids.member, role: "member" },
      preferences: preferences({
        contactNameOrder: "family_given_nickname",
        contactSortOrder: "family_name_asc",
      }),
    })),
  });
  await mountPersonWorkspace();
  // The order comes with the session, so the person's read is the page's
  // first after it (AUD-F3, FER-04).
  expect(api.calls().slice(0, 2)).toEqual([
    SESSION,
    `GET /api/v1/people/${personId}?include=summary`,
  ]);
  expect(requested(api, "/settings/")).toEqual([]);
  expect(document.querySelector("#person-profile-name")?.textContent).toBe(
    "Lovelace Ada",
  );
  expect(document.querySelector("[data-person-breadcrumb-name]")?.textContent)
    .toBe("Lovelace Ada");
  expect(document.querySelector("[data-zone-mini-name]")?.textContent).toBe(
    "Lovelace Ada",
  );
  expect(document.title).toBe("Lovelace Ada — Kinship");
  document.querySelector<HTMLButtonElement>("#person-edit-open")!.click();
  const form = document.querySelector<HTMLFormElement>("#person-edit-form")!;
  (form.elements.namedItem("familyName") as HTMLInputElement).value = "Byron";
  api.route(
    "PATCH /api/v1/people/:personId",
    jsonResponse({
      status: "updated",
      person: {
        id: personId,
        givenName: "Ada",
        familyName: "Byron",
        isPartial: false,
        updatedAt: "2026-08-15T09:00:00.000Z",
      },
    }),
  );
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(document.querySelector("#person-profile-name")?.textContent).toBe(
      "Byron Ada",
    )
  );
  expect(document.title).toBe("Byron Ada — Kinship");
});

it.each([0, 3])(
  "APR-006 keeps %i open tasks out of the cadence hero",
  async (openTaskCount) => {
    markup();
    stubProfile({
      ...zeroProfile(),
      dueInformation: {
        detail:
          `${openTaskCount} open tasks · next reminder 2026-09-20T07:00:00.000000Z`,
        nextReminderAt: "2026-09-20T07:00:00.000000Z",
        openTaskCount,
        status: "ready",
      },
    });
    await mountPersonWorkspace();
    expect(document.querySelector("#person-profile-due-state")?.textContent)
      .toBe("Not set");
    expect(
      document.querySelector('[data-person-vital-value="next-reminder"]')
        ?.textContent,
    )
      .toBe(
        formatInstant("2026-09-20T07:00:00.000000Z", {
          locale: "en",
          effectiveTimezone: "UTC",
        }),
      );
  },
);

afterEach(() => {
  clearToasts();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
});

describe("PEOPLE-001 canonical person identity shell", () => {
  it("UXD-003B paints a busy shell before identity resolves and clears it with the hero", async () => {
    markup();
    const profile = deferred<Response>();
    const api = stubProfile(undefined, { [PROFILE]: profile.promise });

    const mounting = mountPersonWorkspace();
    await vi.waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
    const ready = document.querySelector<HTMLElement>(
      "#person-profile-ready",
    )!;
    expect(ready.hidden).toBe(false);
    expect(ready.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector<HTMLElement>("#person-profile-state")?.hidden)
      .toBe(true);
    expect(document.querySelector("#person-profile-name")?.textContent).toBe(
      "Loading person…",
    );
    expect(document.querySelector("#person-profile-name .skeleton")).not
      .toBeNull();

    profile.resolve(jsonResponse(profileOf(lovelace)));
    await mounting;
    expect(ready.hasAttribute("aria-busy")).toBe(false);
    expect(document.querySelector("#person-profile-name")?.textContent).toBe(
      "Ada Lovelace",
    );
  });

  it("UXD-003B defers Things and Admin, settles Things sections, activates each once, and records the view when idle", async () => {
    markup();
    deferredZoneMarkup();
    const zoneObserver = stubDeferredZoneObserver();
    let idleCallback: IdleRequestCallback | undefined;
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: IdleRequestCallback) => {
        idleCallback = callback;
        return 1;
      }),
    );
    const api = stubProfile(undefined, {
      [FILES]: noFiles,
      [GIFTS]: noGifts(),
      [AUDIT]: noAudit,
      [VIEW]: recorded,
    });

    await mountPersonWorkspace();
    const count = (suffix: string) => requested(api, suffix).length;
    expect(zoneObserver.observed).toHaveLength(4);
    expect(count(`/${personId}/files`)).toBe(0);
    expect(count(`/${personId}/gifts`)).toBe(0);
    expect(count(`/${personId}/audit`)).toBe(0);
    expect(api.fetch).toHaveBeenCalledTimes(2);
    const thingsSections = [...document.querySelectorAll<HTMLElement>(
      '[data-zone="things"] [data-profile-section]',
    )];
    expect(thingsSections).toHaveLength(4);
    expect(
      thingsSections.every((section) =>
        section.dataset.sectionState === "loading"
      ),
    ).toBe(true);

    idleCallback?.({
      didTimeout: false,
      timeRemaining: () => 50,
    });
    await vi.waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(3));

    zoneObserver.activate("things");
    await vi.waitFor(() => {
      expect(count(`/${personId}/files`)).toBe(1);
      expect(count(`/${personId}/gifts`)).toBe(1);
      expect(
        thingsSections.filter((section) =>
          section.dataset.sectionState === "loading"
        ),
      ).toHaveLength(0);
    });
    document.querySelector<HTMLButtonElement>(
      '[data-zone-filter="things"]',
    )?.click();
    document.querySelector<HTMLButtonElement>(
      '[data-zone-filter="things"]',
    )?.click();
    await Promise.resolve();
    expect(count(`/${personId}/files`)).toBe(1);
    expect(count(`/${personId}/gifts`)).toBe(1);

    zoneObserver.activate("admin");
    await vi.waitFor(() => expect(count(`/${personId}/audit`)).toBe(1));
    const requests = api.fetch.mock.calls.map(([resource]) => String(resource));
    // The Things zone's two owners load their code and fetch in parallel, so
    // their order is not fixed (GAP-028); every other request is.
    expect([
      ...requests.slice(0, 3),
      ...requests.slice(3, 5).sort(),
      ...requests.slice(5),
    ]).toEqual([
      "/api/v1/session",
      `/api/v1/people/${personId}?include=summary`,
      `/api/v1/people/${personId}/view`,
      `/api/v1/people/${personId}/files`,
      `/api/v1/people/${personId}/gifts`,
      "/api/v1/member/ui-state",
      "/api/v1/member/ui-state",
      `/api/v1/people/${personId}/audit?limit=3`,
    ]);
  });

  it("REL-021 gives a deferred Things mount the current archived state", async () => {
    markup();
    deferredZoneMarkup();
    const zoneObserver = stubDeferredZoneObserver();
    const archivedAt = "2026-08-15T09:00:00.000Z";
    stubProfile(zeroProfile(), {
      "POST /api/v1/people/:personId/archive": jsonResponse({
        person: {
          familyName: "Profile",
          givenName: "Empty",
          id: personId,
          isPartial: false,
          lifecycle: "archived",
          updatedAt: archivedAt,
        },
        status: "archived",
      }),
      [FILES]: noFiles,
      [GIFTS]: noGifts(),
      [VIEW]: recorded,
    });

    await mountPersonWorkspace();
    document.querySelector<HTMLButtonElement>("#person-archive")?.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLElement>("[data-person-archived-banner]")
          ?.hidden,
      ).toBe(false)
    );

    zoneObserver.activate("things");
    // The gifts island (GAP-026) replaces the shell's markup when it mounts,
    // so the control is looked up in what it rendered.
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-person-gifts="gift"]')
          ?.hasAttribute("data-island-ready"),
      ).toBe(true)
    );
    const giftAdd = document.querySelector<HTMLButtonElement>(
      '[data-person-gifts="gift"] [data-gift-add]',
    );
    expect(giftAdd).not.toBeNull();
    expect(giftAdd!.hidden).toBe(true);
  });

  it("UXD-003B activates a deep-linked zone without delaying section focus", async () => {
    markup(`/app/people/${personId}?section=photos`);
    deferredZoneMarkup();
    stubDeferredZoneObserver();
    const api = stubProfile();

    await mountPersonWorkspace();

    expect(document.activeElement).toBe(
      document.querySelector('[data-profile-section="photos"]'),
    );
    expect(requested(api, `/${personId}/files`)).toHaveLength(1);
    expect(requested(api, `/${personId}/gifts`)).toHaveLength(1);
  });

  it("UXD-003B activates the selected zone without fetching other deferred zones", async () => {
    markup(`/app/people/${personId}?view=admin`);
    deferredZoneMarkup();
    stubDeferredZoneObserver();
    const api = stubProfile();

    await mountPersonWorkspace();

    expect(requested(api, `/${personId}/audit`)).toHaveLength(1);
    expect(requested(api, `/${personId}/files`)).toHaveLength(0);
    expect(requested(api, `/${personId}/gifts`)).toHaveLength(0);
  });

  it("UXD-003B records the view through the timeout fallback", async () => {
    markup();
    vi.stubGlobal("requestIdleCallback", undefined);
    const api = stubProfile();

    await mountPersonWorkspace();

    expect(requested(api, VIEWED))
      .toHaveLength(1);
  });

  it("UXD-003B promotes section states only after the initial fan-out settles", async () => {
    markup();
    deferredZoneMarkup();
    vi.stubGlobal("IntersectionObserver", undefined);
    const files = deferred<Response>();
    const api = stubProfile(profileOf(), {
      [FILES]: files.promise,
      [GIFTS]: noGifts([]),
      [AUDIT]: noAudit,
      [VIEW]: recorded,
    });

    const mounting = mountPersonWorkspace();
    await vi.waitFor(() =>
      expect(requested(api, `/${personId}/files`)).not.toHaveLength(0)
    );
    // The hero's lifecycle status line is a live region from the start.
    const states = [...document.querySelectorAll<HTMLElement>(
      ".section-state:not(#person-lifecycle-status)",
    )];
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((state) => !state.hasAttribute("role"))).toBe(true);

    files.resolve(noFiles);
    await mounting;
    expect(states.every((state) => state.getAttribute("role") === "status"))
      .toBe(true);
    expect(
      states.every((state) => state.getAttribute("aria-live") === "polite"),
    )
      .toBe(true);
  });

  it("REL-052 keeps a live region on the state lines of zones opened after the fan-out settles", async () => {
    markup();
    deferredZoneMarkup();
    const zoneObserver = stubDeferredZoneObserver();
    const api = stubProfile(undefined, {
      [FILES]: noFiles,
      [GIFTS]: noGifts(),
      [AUDIT]: noAudit,
      [VIEW]: recorded,
    });

    await mountPersonWorkspace();
    zoneObserver.activate("things");
    zoneObserver.activate("admin");
    await vi.waitFor(() => {
      expect(requested(api, `/${personId}/files`)).toHaveLength(1);
      expect(requested(api, `/${personId}/gifts`)).toHaveLength(1);
      expect(requested(api, `/${personId}/audit`)).toHaveLength(1);
    });
    const states = [...document.querySelectorAll<HTMLElement>(
      "[data-file-state], [data-gift-state], [data-person-audit-state]",
    )];
    expect(states).toHaveLength(5);
    for (const state of states) {
      expect(state.getAttribute("role")).toBe("status");
      expect(state.getAttribute("aria-live")).toBe("polite");
    }
  });

  it("UXD-002B requests summary and seeds visible and hidden rail counts before fact refresh", async () => {
    markup();
    summaryRailMarkup();
    const contact = deferred<Response>();
    stubProfile(
      profileOf({}, {
        summary: {
          primaryContactMethods: [],
          relationshipCounts: [],
          sectionCounts: [
            { count: 2, id: "contact-methods", status: "ready" },
            { count: 3, id: "relationships", status: "ready" },
            { id: "addresses", status: "hidden" },
            { count: 1, id: "work", status: "ready" },
            { count: 0, id: "pets", status: "ready" },
            { count: 4, id: "food-preferences", status: "ready" },
            { count: 0, id: "first-meeting", status: "ready" },
          ],
        },
      }),
      {
        "GET /api/v1/people/:personId/facts/contact-methods": contact.promise,
        [VIEW]: recorded,
      },
    );

    const mounting = mountPersonWorkspace();
    await vi.waitFor(() =>
      expect(
        document.querySelector(
          '[data-profile-section="contact-methods"] [data-profile-rail-count]',
        )?.textContent,
      ).toBe("2")
    );
    // The rail island (GAP-028) owns the counts, seeded from the summary.
    expect(
      document.querySelector(
        '.profile-facts-heading[data-island="person-rail"][data-island-ready]',
      ),
    ).not.toBeNull();
    expect(
      document.querySelector<HTMLElement>(
        '[data-profile-section="pets"]',
      )?.dataset.railEmpty,
    ).toBe("true");
    const hiddenCount = document.querySelector<HTMLElement>(
      '[data-profile-section="addresses"] [data-profile-rail-count]',
    )!;
    expect(hiddenCount.hidden).toBe(true);
    expect(hiddenCount.textContent).toBe("");
    expect(
      document.querySelector('[data-profile-section="addresses"]')
        ?.hasAttribute("data-rail-empty"),
    ).toBe(false);

    contact.resolve(jsonResponse({
      options: [],
      personUpdatedAt: "2026-08-15T08:00:00.000Z",
      records: [],
      status: "ready",
    }));
    await mounting;
    // The rail island renders the refreshed count on its next commit.
    await vi.waitFor(() =>
      expect(
        document.querySelector(
          '[data-profile-section="contact-methods"] [data-profile-rail-count]',
        )?.textContent,
      ).toBe("0")
    );
    expect(
      document.querySelector<HTMLElement>(
        '[data-profile-section="contact-methods"]',
      )?.dataset.railEmpty,
    ).toBe("true");
  });

  it("UXD-002A names the breadcrumb and renders honest vital-stat values", async () => {
    markup();
    stubProfile(profileOf({
      ...lovelace,
      lastContactAt: "2026-08-29T09:00:00.000Z",
      nickname: "Enchantress of Numbers",
    }, {
      dueInformation: {
        detail: "1 open task; next reminder tomorrow; stay in touch soon.",
        nextReminderAt: "2026-08-30T09:00:00.000Z",
        openTaskCount: 1,
        stayInTouchAt: "2026-09-01T09:00:00.000Z",
      },
    }));

    await mountPersonWorkspace();

    expect(document.querySelector("[data-person-breadcrumb-name]")?.textContent)
      .toBe("Ada Lovelace “Enchantress of Numbers”");
    expect(document.querySelector("#person-profile-nickname")?.textContent)
      .toBe("“Enchantress of Numbers”");
    expect(
      document.querySelector<HTMLElement>("#person-profile-nickname")?.hidden,
    ).toBe(true);
    const badges = document.querySelector<HTMLElement>(
      ".person-profile-badges",
    );
    expect(badges?.getAttribute("role")).toBe("group");
    expect(badges?.getAttribute("aria-label")).toBe("Person states");
    const identitySaved = [...badges!.querySelectorAll<HTMLElement>("p")]
      .find((badge) => badge.textContent === "Identity saved");
    expect(identitySaved?.className).toBe(
      badgeVariants({ variant: "secondary" }),
    );
    expect(identitySaved?.hidden).toBe(false);
    expect(
      document.querySelector('[data-person-vital-value="birthday"]')
        ?.textContent,
    ).toBe("Not recorded");
    expect(
      document.querySelector('[data-person-vital-value="next-reminder"]')
        ?.textContent,
    ).not.toBe("Not recorded");
    expect(
      document.querySelector('[data-person-vital-value="work"]')?.textContent,
    ).toBe("Not recorded");
    expect(
      document.querySelector('[data-person-vital-value="first-meeting"]')
        ?.textContent,
    ).toBe("Not recorded");
    expect(
      document.querySelector("[data-person-vital-stats]")?.contains(
        document.querySelector("#person-profile-due-state"),
      ),
    ).toBe(true);
    expect(
      document.querySelector<HTMLElement>("[data-person-archived-banner]")
        ?.hidden,
    ).toBe(true);
    expect(document.querySelector("[data-person-audit-history]")).toBeNull();
  });

  it("loads a partial identity through the generated active-workspace client", async () => {
    markup();
    reminderSectionMarkup();
    const secondary = deferred<void>();
    const api = stubProfile(
      profileOf({ ...lovelace, isPartial: true }, {
        dueInformation: unavailableDue,
      }),
      { [VIEW]: unreachable, [REST]: heldUntil(secondary.promise) },
    );
    const mounting = mountPersonWorkspace();
    await vi.waitFor(() => {
      expect(document.querySelector("#person-profile-name")?.textContent).toBe(
        "Ada Lovelace",
      );
    });
    expect(requested(api, VIEWED)).not
      .toHaveLength(0);
    secondary.resolve();
    await mounting;
    expect(api.fetch.mock.calls[1]?.[0]).toBe(
      `/api/v1/people/${personId}?include=summary`,
    );
    expect(api.fetch.mock.calls[1]?.[1]?.headers).toEqual({
      "X-Workspace-Id": workspaceId,
      "content-type": "application/json",
    });
    expect(
      document.querySelector("#person-profile-ready")?.hasAttribute(
        "hidden",
      ),
    ).toBe(false);
    expect(document.querySelector("#person-profile-name")?.textContent).toBe(
      "Ada Lovelace",
    );
    expect(
      document.querySelector('[data-profile-field="nickname"]')?.textContent,
    ).toBe("Unknown");
    expect(
      document.querySelector("#person-profile-partial")?.hasAttribute(
        "hidden",
      ),
    ).toBe(false);
    expect(api.fetch.mock.calls[2]?.[1]?.method).toBe("POST");
  });

  it("PEOPLE-006 hides the visible tag surface for a disabled module", async () => {
    markup();
    // The tags editor (GAP-029) mounts over its block and, with the module
    // off, hides it without reading any tags.
    document.querySelector(".person-hero-tags")?.setAttribute(
      "data-profile-fact-section",
      "tags",
    );
    stubProfile(
      profileOf({ profileSections: [{ id: "tags", status: "hidden" }] }, {
        dueInformation: { status: "unavailable" },
      }),
    );

    await mountPersonWorkspace();
    expect(
      document.querySelector<HTMLElement>("#person-profile-tags")?.hidden,
    ).toBe(true);
    expect(
      document.querySelector<HTMLElement>(
        '[data-profile-fact-section="tags"]',
      )?.hidden,
    ).toBe(true);
  });

  it("UXD-002C defaults invalid and missing views to All, filters zones, and restores popstate", async () => {
    markup(`/app/people/${personId}?view=unknown`);
    stubProfile();

    await mountPersonWorkspace();

    const zones = [...document.querySelectorAll<HTMLElement>("[data-zone]")];
    const all = document.querySelector<HTMLButtonElement>(
      '[data-zone-filter="all"]',
    )!;
    const planning = document.querySelector<HTMLButtonElement>(
      '[data-zone-filter="planning"]',
    )!;
    expect(location.search).toBe("?view=unknown");
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(all.className).toBe(segment);
    expect(zones.every((zone) => !zone.hidden)).toBe(true);

    planning.click();
    expect(new URLSearchParams(location.search).get("view")).toBe("planning");
    expect(planning.getAttribute("aria-pressed")).toBe("true");
    expect(planning.className).toBe(segment);
    expect(
      document.querySelector<HTMLElement>('[data-zone="planning"]')?.hidden,
    ).toBe(false);
    expect(
      zones.filter((zone) => zone.dataset.zone !== "planning").every((zone) =>
        zone.hidden
      ),
    ).toBe(true);
    expect(
      document.querySelector<HTMLElement>(
        '[data-profile-section="important-dates"]',
      )?.hidden,
    ).toBe(false);

    history.replaceState({}, "", `/app/people/${personId}`);
    globalThis.dispatchEvent(new PopStateEvent("popstate"));
    expect(location.search).toBe("");
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(zones.every((zone) => !zone.hidden)).toBe(true);
  });

  it("UXD-002C3 restores a stored Timeline view without a history navigation or first-run card", async () => {
    markup();
    const replaceState = vi.spyOn(history, "replaceState");
    stubProfile(zeroProfile(), {
      [SESSION]: jsonResponse({
        ...session,
        uiState: { personWorkspaceView: "timeline" },
      }),
    });

    await mountPersonWorkspace();

    expect(location.search).toBe("?view=timeline");
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('[data-zone-filter="timeline"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      document.querySelector<HTMLElement>('[data-zone="timeline"]')?.hidden,
    ).toBe(false);
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-zone]")]
        .filter((zone) => zone.dataset.zone !== "timeline")
        .every((zone) => zone.hidden),
    ).toBe(true);
    expect(document.querySelector<HTMLElement>("#person-first-run")?.hidden)
      .toBe(true);
  });

  it("UXD-002C3 keeps an explicit Planning deep link ahead of stored Timeline", async () => {
    markup(`/app/people/${personId}?view=planning`);
    const replaceState = vi.spyOn(history, "replaceState");
    stubProfile(undefined, {
      [SESSION]: jsonResponse({
        ...session,
        uiState: { personWorkspaceView: "timeline" },
      }),
    });

    await mountPersonWorkspace();

    expect(location.search).toBe("?view=planning");
    expect(replaceState).not.toHaveBeenCalled();
    expect(
      document.querySelector('[data-zone-filter="planning"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      document.querySelector<HTMLElement>('[data-zone="planning"]')?.hidden,
    ).toBe(false);
  });

  it("UXD-002C3 filters immediately without persisting a click before the session resolves", async () => {
    markup();
    const pendingSession = deferred<Response>();
    const api = stubProfile(undefined, {
      [SESSION]: pendingSession.promise,
    });

    const mounting = mountPersonWorkspace();
    document.querySelector<HTMLButtonElement>(
      '[data-zone-filter="planning"]',
    )?.click();
    const earlyState = {
      patchCount: requested(api, UI_STATE).length,
      planningPressed: document.querySelector(
        '[data-zone-filter="planning"]',
      )?.getAttribute("aria-pressed"),
      search: location.search,
      visibleZones: [...document.querySelectorAll<HTMLElement>("[data-zone]")]
        .filter((zone) => !zone.hidden)
        .map((zone) => zone.dataset.zone),
    };
    pendingSession.resolve(jsonResponse(session));
    await mounting;

    expect(earlyState).toEqual({
      patchCount: 0,
      planningPressed: "true",
      search: "?view=planning",
      visibleZones: ["planning"],
    });
    expect(requested(api, UI_STATE)).toHaveLength(0);
  });

  it.each([
    ["stored All", { ...session, uiState: { personWorkspaceView: "all" } }],
    ["an absent UI state", session],
  ])(
    "UXD-002C3 leaves a queryless URL untouched for %s",
    async (_name, value) => {
      markup();
      const replaceState = vi.spyOn(history, "replaceState");
      stubProfile(undefined, { [SESSION]: jsonResponse(value) });

      await mountPersonWorkspace();

      expect(location.search).toBe("");
      expect(replaceState).not.toHaveBeenCalled();
    },
  );

  it("UXD-002C3 persists a selected zone and updates the existing session cache after success", async () => {
    markup();
    const api = stubProfile();
    await mountPersonWorkspace();
    const savedAt = Date.now() - 12_000;
    sessionStorage.setItem(
      "kinship.session",
      JSON.stringify({
        savedAt,
        session: {
          ...session,
          uiState: { personWorkspaceView: "planning" },
        },
      }),
    );
    api.route(
      UI_STATE,
      jsonResponse({
        status: "ready",
        uiState: { personWorkspaceView: "timeline" },
      }),
    );

    document.querySelector<HTMLButtonElement>(
      '[data-zone-filter="timeline"]',
    )?.click();

    await vi.waitFor(() => {
      expect(
        JSON.parse(sessionStorage.getItem("kinship.session") ?? "null"),
      ).toEqual({
        savedAt,
        session: {
          ...session,
          uiState: { personWorkspaceView: "timeline" },
        },
      });
    });
    const patch = api.requests().find(({ method, url }) =>
      `${method} ${url.pathname}` === UI_STATE
    );
    expect(patch?.init).toMatchObject({
      body: JSON.stringify({ personWorkspaceView: "timeline" }),
      headers: {
        "content-type": "application/json",
        "X-Workspace-Id": workspaceId,
      },
      method: "PATCH",
    });
  });

  it("UXD-002C3 keeps a rejected preference save invisible and leaves the cache honest", async () => {
    markup(`/app/people/${personId}?view=planning`);
    const api = stubProfile();
    await mountPersonWorkspace();
    const mounted = api.calls().length;
    const cached = {
      savedAt: Date.now() - 12_000,
      session: {
        ...session,
        uiState: { personWorkspaceView: "planning" },
      },
    };
    sessionStorage.setItem("kinship.session", JSON.stringify(cached));

    // The save fails: nothing but the mount's reads is answered.
    document.querySelector<HTMLButtonElement>('[data-zone-filter="all"]')
      ?.click();
    await vi.waitFor(() => expect(api.calls().slice(mounted)).toHaveLength(1));

    expect(location.search).toBe("?view=all");
    expect(
      document.querySelector('[data-zone-filter="all"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-zone]")].every(
        (zone) => !zone.hidden,
      ),
    ).toBe(true);
    expect(document.querySelectorAll("#app-toasts > li")).toHaveLength(0);
    expect(JSON.parse(sessionStorage.getItem("kinship.session") ?? "null"))
      .toEqual(cached);
  });

  it("UXD-005B replaces empty stream zones and restores them on dismissal", async () => {
    markup(`/app/people/${personId}?section=important-dates`);
    stubProfile(zeroProfile());

    await mountPersonWorkspace();

    const card = document.querySelector<HTMLElement>("#person-first-run")!;
    const switcher = document.querySelector<HTMLElement>(".zone-switcher")!;
    const zones = [...document.querySelectorAll<HTMLElement>("[data-zone]")];
    expect(card.hidden).toBe(false);
    expect(switcher.hidden).toBe(true);
    expect(zones.every((zone) => zone.hidden)).toBe(true);

    document.querySelector<HTMLButtonElement>("[data-first-run-dismiss]")
      ?.click();
    expect(card.hidden).toBe(true);
    expect(switcher.hidden).toBe(false);
    expect(zones.every((zone) => !zone.hidden)).toBe(true);
  });

  it.each([
    [
      "a populated summary",
      `/app/people/${personId}`,
      zeroProfile({
        summary: {
          sectionCounts: [
            ...zeroSummary.sectionCounts.slice(0, -1),
            { count: 1, id: "life-events", status: "ready" },
          ],
        },
      }),
    ],
    [
      "a stay-in-touch cadence",
      `/app/people/${personId}`,
      zeroProfile({ summary: { stayInTouchAt: "2026-09-01T09:00:00Z" } }),
    ],
    [
      "a next reminder",
      `/app/people/${personId}`,
      zeroProfile({ summary: { nextReminderAt: "2026-09-01T09:00:00Z" } }),
    ],
    [
      "an archived person",
      `/app/people/${personId}`,
      zeroProfile({ status: "archived" }),
    ],
    [
      "a filtered view",
      `/app/people/${personId}?view=planning`,
      zeroProfile(),
    ],
    [
      "a stream-section deep link",
      `/app/people/${personId}?section=photos`,
      zeroProfile(),
    ],
  ])(
    "UXD-005B does not present first-run for %s",
    async (_name, path, value) => {
      markup(path);
      stubProfile(value);

      await mountPersonWorkspace();

      expect(document.querySelector<HTMLElement>("#person-first-run")?.hidden)
        .toBe(true);
      expect(document.querySelector<HTMLElement>(".zone-switcher")?.hidden)
        .toBe(false);
    },
  );

  it.each(["section", "filter"])(
    "UXD-005B exits first-run through %s navigation",
    async (path) => {
      markup();
      stubProfile(zeroProfile());
      await mountPersonWorkspace();

      if (path === "section") {
        document.querySelector<HTMLAnchorElement>(
          '[data-section-link="photos"]',
        )?.click();
        expect(document.activeElement).toBe(
          document.querySelector('[data-profile-section="photos"]'),
        );
      } else {
        document.querySelector<HTMLButtonElement>(
          '[data-zone-filter="planning"]',
        )?.click();
        expect(
          document.querySelector<HTMLElement>('[data-zone="planning"]')
            ?.hidden,
        ).toBe(false);
        expect(
          [...document.querySelectorAll<HTMLElement>("[data-zone]")]
            .filter((zone) => zone.dataset.zone !== "planning")
            .every((zone) => zone.hidden),
        ).toBe(true);
      }
      expect(document.querySelector<HTMLElement>("#person-first-run")?.hidden)
        .toBe(true);
      expect(document.querySelector<HTMLElement>(".zone-switcher")?.hidden)
        .toBe(false);
    },
  );

  it("UXD-005B waits for the eager rail before opening all three first actions", async () => {
    markup(`/app/people/${firstRunPersonId}`);
    const controls = firstRunActionMarkup();
    const firstMeetingClick = vi.fn();
    const birthdayClick = vi.fn();
    controls.firstMeeting.addEventListener("click", firstMeetingClick);
    controls.birthday.addEventListener("click", birthdayClick);
    const reminders = deferred<Response>();
    const api = stubProfile(zeroProfile(), {
      [REMINDERS]: reminders.promise,
      [REST]: recorded,
    });

    const mounting = mountPersonWorkspace();
    await vi.waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(4));
    for (
      const action of document.querySelectorAll<HTMLButtonElement>(
        "[data-first-run-action]",
      )
    ) action.click();
    expect(firstMeetingClick).not.toHaveBeenCalled();
    expect(birthdayClick).not.toHaveBeenCalled();
    expect(controls.cadenceAdd.hidden).toBe(true);

    controls.firstMeeting.hidden = false;
    controls.birthday.hidden = false;
    reminders.resolve(noReminders);
    await mounting;
    await vi.waitFor(() => expect(firstMeetingClick).toHaveBeenCalledOnce());
    expect(birthdayClick).toHaveBeenCalledOnce();
    // The reminders island (GAP-031) owns the stay-in-touch block; its add
    // control opens the cadence editor with focus in the cadence field.
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector(
          '[data-cadence-form] input[name="intervalCount"]',
        ),
      )
    );
  });

  it("REL-049 opens the cadence editor from the stay-in-touch first action", async () => {
    markup(`/app/people/${firstRunPersonId}`);
    firstRunActionMarkup();
    stubProfile(zeroProfile(), {
      [REMINDERS]: noReminders,
      [REST]: recorded,
    });
    await mountPersonWorkspace();

    document.querySelector<HTMLButtonElement>(
      '[data-first-run-action="stay-in-touch"]',
    )!.click();
    // The reminders island owns the block; its add control opens the editor
    // and moves focus into the cadence field.
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector(
          '[data-cadence-form] input[name="intervalCount"]',
        ),
      )
    );
    expect(
      document.querySelector<HTMLFormElement>("[data-cadence-form]")?.hidden,
    ).toBe(false);
  });

  it.each([
    {
      action: "first-meeting",
      block:
        `<section id="profile-section-first-meeting" data-profile-section="first-meeting" data-profile-fact-section="first-meeting" data-section-state="loading" tabindex="-1">
         <header><h3>First meeting</h3><span data-rail-count-slot><span data-profile-rail-count hidden></span></span>
           <button data-profile-fact-add type="button" aria-label="Add first meeting" hidden>+</button></header>
         <p data-profile-fact-state></p><ul data-profile-fact-list></ul>
         <form data-profile-fact-form hidden novalidate></form>
       </section>`,
      form: "[data-profile-fact-form]",
      path: "/facts/first-meeting",
      read: "GET /api/v1/people/:personId/facts/first-meeting",
      // The editor offers the people who could have introduced them.
      routes: {
        "GET /api/v1/people": jsonResponse({ people: [], status: "ready" }),
      },
      answer: () =>
        jsonResponse({
          options: [],
          personUpdatedAt: "2026-08-16T12:00:00.000000Z",
          records: [],
          status: "ready",
        }),
    },
    {
      action: "important-dates",
      block:
        `<section id="profile-section-important-dates" data-profile-section="important-dates" data-section-state="loading" tabindex="-1">
         <header><h3>Important dates</h3><span data-rail-count-slot><span data-profile-rail-count hidden></span></span>
           <button id="important-date-add" type="button" aria-label="Add important date" hidden>+</button></header>
         <p id="important-dates-state"></p><ul id="important-dates-list"></ul>
         <form id="important-date-form" hidden novalidate></form>
       </section>`,
      form: "#important-date-form",
      path: "/dates",
      read: "GET /api/v1/people/:personId/dates",
      routes: {},
      answer: () => jsonResponse({ dates: [], status: "ready" }),
    },
  ])(
    "REL-074 opens the $action editor from its first action clicked while the rail reads",
    async ({ action, answer, block, form, path, read, routes }) => {
      markup(`/app/people/${firstRunPersonId}`);
      document.querySelector("#profile-section-important-dates")?.remove();
      document.querySelector("#person-profile-ready")?.insertAdjacentHTML(
        "beforeend",
        block,
      );
      const held = deferred<Response>();
      const api = stubProfile(zeroProfile(), {
        ...routes,
        [read]: held.promise,
        [REST]: recorded,
      });

      const mounting = mountPersonWorkspace();
      await vi.waitFor(() => expect(requested(api, path)).toHaveLength(1));
      document.querySelector<HTMLButtonElement>(
        `[data-first-run-action="${action}"]`,
      )!.click();
      // The island's read answers while the action waits for the rail: the
      // island's add control, drawn by that answer, opens its editor.
      held.resolve(answer());
      await mounting;
      await vi.waitFor(() =>
        expect(document.querySelector<HTMLFormElement>(form)?.hidden).toBe(
          false,
        )
      );
    },
  );

  it("UXD-005B never clicks a hidden or disabled first-action control", async () => {
    markup(`/app/people/${firstRunPersonId}`);
    const controls = firstRunActionMarkup();
    const firstMeetingClick = vi.fn();
    const birthdayClick = vi.fn();
    controls.firstMeeting.addEventListener("click", firstMeetingClick);
    controls.birthday.addEventListener("click", birthdayClick);
    controls.birthday.hidden = false;
    controls.birthday.disabled = true;
    // Without its reminder form the reminders island stays unmounted, so the
    // shell's cadence add control stays hidden and its editor closed.
    document.querySelector("[data-reminder-form]")?.remove();
    const cadenceClick = vi.fn();
    controls.cadenceAdd.addEventListener("click", cadenceClick);
    stubProfile(zeroProfile(), {
      [REMINDERS]: noReminders,
      [REST]: recorded,
    });
    await mountPersonWorkspace();

    for (
      const action of document.querySelectorAll<HTMLButtonElement>(
        "[data-first-run-action]",
      )
    ) action.click();
    await Promise.resolve();
    expect(firstMeetingClick).not.toHaveBeenCalled();
    expect(birthdayClick).not.toHaveBeenCalled();
    expect(cadenceClick).not.toHaveBeenCalled();
  });

  it("PRF-001 opens the section directory in place, within the room it has", async () => {
    markup();
    stubProfile();
    const navigation = document.querySelector<HTMLElement>(
      "#person-profile-sections",
    )!;
    const container = document.createElement("div");
    container.className = "person-workspace-navigation";
    const directory = document.createElement("details");
    navigation.replaceWith(container);
    container.append(directory);
    directory.append(navigation);
    const scroll = vi.fn();
    container.scrollIntoView = scroll;
    directory.scrollIntoView = scroll;
    vi.spyOn(globalThis, "innerHeight", "get").mockReturnValue(700);
    Object.defineProperty(navigation, "scrollHeight", { value: 400 });
    const barAt = (top: number) =>
      vi.spyOn(container, "getBoundingClientRect").mockReturnValue(
        { bottom: top + 60, top } as DOMRect,
      );

    await mountPersonWorkspace();
    barAt(100);
    directory.open = true;
    directory.dispatchEvent(new Event("toggle"));
    expect(scroll).not.toHaveBeenCalled();
    expect(directory.dataset.placement).toBe("below");
    expect(directory.style.getPropertyValue("--directory-room")).toBe("532px");

    directory.open = false;
    directory.dispatchEvent(new Event("toggle"));
    barAt(560);
    directory.open = true;
    directory.dispatchEvent(new Event("toggle"));
    expect(scroll).not.toHaveBeenCalled();
    expect(directory.dataset.placement).toBe("above");
    expect(directory.style.getPropertyValue("--directory-room")).toBe("552px");

    // Scrolling while it is open keeps it within the room it now has.
    barAt(100);
    globalThis.dispatchEvent(new Event("scroll"));
    expect(directory.dataset.placement).toBe("below");
    expect(directory.style.getPropertyValue("--directory-room")).toBe("532px");
    expect(scroll).not.toHaveBeenCalled();
  });

  it("PRF-001 closes the section directory on an outside click or Escape", async () => {
    markup();
    stubProfile();
    const navigation = document.querySelector("#person-profile-sections")!;
    const directory = document.createElement("details");
    const summary = document.createElement("summary");
    navigation.replaceWith(directory);
    directory.append(summary, navigation);
    const outside = document.createElement("button");
    document.body.append(outside);
    await mountPersonWorkspace();
    const link = document.querySelector<HTMLAnchorElement>(
      '[data-section-link="photos"]',
    )!;

    directory.open = true;
    link.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(directory.open).toBe(true);
    outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(directory.open).toBe(false);

    directory.open = true;
    link.focus();
    link.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
    );
    expect(directory.open).toBe(false);
    expect(document.activeElement).toBe(summary);

    // The page moving focus elsewhere (settling after load) leaves it open.
    directory.open = true;
    outside.focus();
    expect(directory.open).toBe(true);
  });

  it("PRF-001 briefly marks the section a link brought the member to", async () => {
    markup();
    stubProfile();
    await mountPersonWorkspace();
    const photos = document.querySelector<HTMLElement>(
      '[data-profile-section="photos"]',
    )!;
    const documents = document.querySelector<HTMLElement>(
      '[data-profile-section="documents"]',
    )!;

    document.querySelector<HTMLAnchorElement>('[data-section-link="photos"]')
      ?.click();
    expect(photos.hasAttribute("data-section-arrived")).toBe(true);

    document.querySelector<HTMLAnchorElement>(
      '[data-section-link="documents"]',
    )?.click();
    expect(photos.hasAttribute("data-section-arrived")).toBe(false);
    expect(documents.hasAttribute("data-section-arrived")).toBe(true);

    await vi.waitFor(
      () => expect(documents.hasAttribute("data-section-arrived")).toBe(false),
      { timeout: 3000 },
    );
  });

  it("PRF-001 closes the section directory before focusing the selected block", async () => {
    markup();
    stubProfile();
    const navigation = document.querySelector("#person-profile-sections")!;
    const directory = document.createElement("details");
    directory.open = true;
    navigation.replaceWith(directory);
    directory.append(navigation);

    await mountPersonWorkspace();
    document.querySelector<HTMLAnchorElement>('[data-section-link="photos"]')
      ?.click();

    expect(directory.open).toBe(false);
    expect(document.activeElement).toBe(
      document.querySelector('[data-profile-section="photos"]'),
    );
    expect(new URLSearchParams(location.search).get("section")).toBe("photos");
  });

  it("UXD-002C writes one history entry when section navigation changes zones", async () => {
    markup();
    stubProfile();
    const pushState = vi.spyOn(history, "pushState");

    await mountPersonWorkspace();

    document.querySelector<HTMLButtonElement>(
      '[data-zone-filter="planning"]',
    )?.click();
    pushState.mockClear();
    document.querySelector<HTMLAnchorElement>(
      '[data-section-link="photos"]',
    )?.click();

    expect(pushState).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(location.search).get("section")).toBe("photos");
    expect(new URLSearchParams(location.search).get("view")).toBe("things");
  });

  it("UXD-002C keeps All visible when section navigation does not need a zone change", async () => {
    markup();
    stubProfile();
    const pushState = vi.spyOn(history, "pushState");

    await mountPersonWorkspace();
    pushState.mockClear();
    document.querySelector<HTMLAnchorElement>(
      '[data-section-link="photos"]',
    )?.click();

    expect(pushState).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(location.search).get("section")).toBe("photos");
    expect(new URLSearchParams(location.search).has("view")).toBe(false);
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-zone]")].every(
        (zone) => !zone.hidden,
      ),
    ).toBe(true);
    expect(
      document.querySelector('[data-zone-filter="all"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
  });

  it("UXD-002A2 reveals Admin and focuses the audit summary from the hero's Audit history", async () => {
    // The hero island draws and toggles the menu (islands/person-hero); the
    // page's navigation answers its Audit history request.
    markup();
    stubProfile();

    await mountPersonWorkspace();

    const toggle = document.querySelector<HTMLButtonElement>(
      "#person-menu-toggle",
    )!;
    const menu = document.querySelector<HTMLElement>("#person-menu")!;
    toggle.click();
    await vi.waitFor(() => expect(menu.hidden).toBe(false));
    const auditHistory = document.querySelector<HTMLButtonElement>(
      "#person-audit-history",
    )!;
    auditHistory.click();
    await vi.waitFor(() => expect(menu.hidden).toBe(true));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(new URLSearchParams(location.search).get("section")).toBe(
      "audit-summary",
    );
    expect(new URLSearchParams(location.search).get("view")).toBe("admin");
    expect(
      document.querySelector<HTMLElement>('[data-zone="admin"]')?.hidden,
    ).toBe(false);
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-zone]")]
        .filter((zone) => zone.dataset.zone !== "admin")
        .every((zone) => zone.hidden),
    ).toBe(true);
    expect(document.activeElement).toBe(
      document.querySelector('[data-profile-section="audit-summary"]'),
    );
    expect(auditHistory.closest("a")).toBeNull();
    // A request the navigation cannot place changes nothing.
    document.dispatchEvent(
      new CustomEvent("person-section-requested", {
        detail: { sectionId: "notes", view: "everything" },
      }),
    );
    document.dispatchEvent(new CustomEvent("person-section-requested"));
    expect(new URLSearchParams(location.search).get("section")).toBe(
      "audit-summary",
    );
  });

  it("UXD-002C does not write history while popstate restores a section", async () => {
    markup();
    stubProfile();
    await mountPersonWorkspace();
    history.replaceState(
      {},
      "",
      `/app/people/${personId}?section=photos&view=planning`,
    );
    const pushState = vi.spyOn(history, "pushState");
    const replaceState = vi.spyOn(history, "replaceState");

    globalThis.dispatchEvent(new PopStateEvent("popstate"));

    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLElement>('[data-zone="things"]')?.hidden,
    ).toBe(false);
    expect(document.activeElement).toBe(
      document.querySelector('[data-profile-section="photos"]'),
    );
  });

  it("UXD-002C activates the mapped zone before focusing a section deep link", async () => {
    markup(`/app/people/${personId}?view=planning&section=photos`);
    stubProfile();
    const pushState = vi.spyOn(history, "pushState");
    const replaceState = vi.spyOn(history, "replaceState");

    await mountPersonWorkspace();

    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(location.search).get("view")).toBe("things");
    expect(
      document.querySelector<HTMLElement>('[data-zone="things"]')?.hidden,
    ).toBe(false);
    expect(document.activeElement).toBe(
      document.querySelector('[data-profile-section="photos"]'),
    );
    expect(
      document.querySelector('[data-section-link="photos"]')?.getAttribute(
        "aria-current",
      ),
    ).toBe("location");
  });

  it("UXD-002C does not let missing filter chrome gate the person page", async () => {
    markup();
    document.querySelector(".profile-section-list")?.remove();
    stubProfile();

    await mountPersonWorkspace();

    expect(
      document.querySelector<HTMLElement>("#person-profile-ready")?.hidden,
    ).toBe(false);
    expect(document.querySelector("#person-profile-name")?.textContent).toBe(
      "Ada Lovelace",
    );
  });

  it("UXD-002C renders page errors without filter chrome", async () => {
    markup("/app/people/not-a-person-id");
    document.querySelector(".profile-section-list")?.remove();

    await mountPersonWorkspace();

    expect(document.querySelector("#person-profile-state h1")?.textContent)
      .toBe("Person not found");
  });

  it("UXD-002C shows the mini identity only after the hero leaves view", async () => {
    let callback!: IntersectionObserverCallback;
    const observe = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        readonly root = null;
        readonly rootMargin: string;
        readonly thresholds = [0];

        constructor(
          next: IntersectionObserverCallback,
          options?: IntersectionObserverInit,
        ) {
          this.rootMargin = options?.rootMargin ?? "0px";
          if (this.rootMargin === "0px") callback = next;
        }
        disconnect = vi.fn();
        observe = (target: Element) => {
          if (this.rootMargin === "0px") observe(target);
        };
        takeRecords = () => [];
        unobserve = vi.fn();
      },
    );
    markup();
    stubProfile();

    await mountPersonWorkspace();

    const mini = document.querySelector<HTMLElement>(
      "[data-zone-mini-identity]",
    )!;
    const observer = {} as IntersectionObserver;
    expect(observe).toHaveBeenCalledWith(
      document.querySelector(".person-profile-hero"),
    );
    callback(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      observer,
    );
    expect(mini.hidden).toBe(false);
    expect(mini.getAttribute("aria-hidden")).toBe("true");
    expect(mini.querySelector("[data-zone-mini-avatar]")?.textContent).toBe(
      "AL",
    );
    expect(mini.querySelector("[data-zone-mini-name]")?.textContent).toBe(
      "Ada Lovelace",
    );
    callback([{ isIntersecting: true } as IntersectionObserverEntry], observer);
    expect(mini.hidden).toBe(true);
  });

  it("[APP-003C] renders orientation first and focuses stable section deep links", async () => {
    markup(`/app/people/${personId}?section=documents`);
    stubProfile(profileOf({
      ...lovelace,
      description: "Mathematician and correspondent.",
      gender: "Woman",
      isDeceased: true,
      isStarred: true,
      lastContactAt: "2026-08-14T08:00:00.000Z",
      profileSections: [{ id: "documents", status: "ready" }],
      tagCount: 2,
      tags: [{
        id: "00000000-0000-4000-8000-000000000230",
        name: "Mathematics",
      }],
    }, { dueInformation: unavailableDue }));

    await mountPersonWorkspace();

    expect(document.querySelector("[data-profile-description]")?.textContent)
      .toBe("Mathematician and correspondent.");
    expect(
      document.querySelector<HTMLElement>("#person-profile-favorite")?.hidden,
    ).toBe(false);
    expect(
      document.querySelector<HTMLElement>("#person-profile-deceased")?.hidden,
    ).toBe(false);
    expect(document.querySelector("#person-profile-due-state")?.textContent)
      .toBe("Not set");
    expect(document.querySelector('[data-profile-field="gender"]')?.textContent)
      .toBe("Woman");
    expect(document.querySelector("[data-profile-last-contact]")?.textContent)
      .not.toBe("None recorded");
    expect(document.querySelector("#person-profile-tags")?.textContent)
      .toContain("+1 more");
    expect(
      document.querySelector<HTMLAnchorElement>("#person-export-vcard")?.href,
    ).toContain(`/api/v1/people/${personId}/vcard`);
    expect(document.activeElement).toBe(
      document.querySelector("#profile-section-documents"),
    );
    expect(
      document.querySelector<HTMLElement>("#person-profile-section-notice")
        ?.hidden,
    ).toBe(true);

    document.querySelector<HTMLAnchorElement>(
      '[data-section-link="photos"]',
    )?.click();
    expect(new URLSearchParams(location.search).get("section")).toBe("photos");
    expect(new URLSearchParams(location.search).has("view")).toBe(false);
    expect(document.activeElement).toBe(
      document.querySelector("#profile-section-photos"),
    );
  });

  it("UXD-002A opens and focuses the edit affordance for the absorbed identity deep link", async () => {
    markup(`/app/people/${personId}?view=planning&section=identity-summary`);
    stubProfile();

    await mountPersonWorkspace();

    const editForm = document.querySelector<HTMLFormElement>(
      "#person-edit-form",
    )!;
    expect(editForm.hidden).toBe(false);
    expect(document.activeElement).toBe(
      editForm.elements.namedItem("givenName"),
    );
    expect(
      document.querySelector('[data-section-link="identity-summary"]')
        ?.getAttribute("aria-current"),
    ).toBe("location");
    expect(new URLSearchParams(location.search).get("view")).toBe("admin");
  });

  it("UXD-006 explains an admin deep link to a personalization-hidden section", async () => {
    markup(`/app/people/${personId}?view=planning&section=documents`);
    reminderSectionMarkup();
    const secondary = deferred<void>();
    stubProfile(
      profileOf({
        profileSections: [{ id: "documents", status: "hidden" }],
        tagCount: 1,
        tags: [{
          id: "00000000-0000-4000-8000-000000000230",
          name: "Friend",
        }],
      }, { dueInformation: { status: "unavailable" } }),
      {
        [SESSION]: jsonResponse({
          ...session,
          member: { ...session.member, role: "admin" },
        }),
        [VIEW]: recorded,
        [REST]: heldUntil(secondary.promise),
      },
    );

    const mounting = mountPersonWorkspace();
    await vi.waitFor(() =>
      expect(document.querySelector("#person-profile-name")?.textContent).toBe(
        "Ada",
      )
    );
    expect(
      document.querySelector<HTMLAnchorElement>(
        '[data-section-link="documents"]',
      )?.closest<HTMLElement>("li")?.hidden,
    ).toBe(true);
    const notice = document.querySelector<HTMLElement>(
      "#person-profile-section-notice",
    );
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.hidden).toBe(false);
    expect(notice?.textContent).toContain(
      "Documents — this section is hidden in this workspace.",
    );
    expect(notice?.querySelector("a")?.textContent).toBe(
      "Open personalization",
    );
    expect(notice?.querySelector("a")?.getAttribute("href")).toBe(
      "/app/settings/personalization?section=profile-modules",
    );
    expect(new URLSearchParams(location.search).get("view")).toBe("planning");
    expect(
      document.querySelector<HTMLElement>('[data-zone="planning"]')?.hidden,
    ).toBe(false);
    expect(
      document.querySelector<HTMLElement>('[data-zone="things"]')?.hidden,
    ).toBe(true);
    expect(document.activeElement).toBe(notice);
    const personalization = notice?.querySelector<HTMLAnchorElement>("a");
    personalization?.focus();
    secondary.resolve();
    await mounting;
    expect(document.activeElement).toBe(personalization);
  });

  it("REL-075 keeps focus on a button the reader chose before a hidden-section deep link settles", async () => {
    markup(`/app/people/${personId}?section=documents`);
    deferredZoneMarkup();
    // Every zone activates at once, and the photos read holds the workspace
    // short of settling until the reader has chosen a control.
    vi.stubGlobal("IntersectionObserver", undefined);
    const files = deferred<Response>();
    const api = stubProfile(
      profileOf({ profileSections: [{ id: "documents", status: "hidden" }] }),
      {
        [FILES]: files.promise,
        [GIFTS]: noGifts([]),
        [AUDIT]: noAudit,
        [VIEW]: recorded,
      },
    );

    const mounting = mountPersonWorkspace();
    await vi.waitFor(() =>
      expect(requested(api, `/${personId}/files`)).not.toHaveLength(0)
    );
    const notice = document.querySelector<HTMLElement>(
      "#person-profile-section-notice",
    )!;
    expect(document.activeElement).toBe(notice);
    const logInteraction = document.querySelector<HTMLButtonElement>(
      '[data-quick-capture][data-interaction-intended-kind="activity"]',
    )!;
    logInteraction.focus();
    expect(document.activeElement).toBe(logInteraction);
    files.resolve(noFiles);
    await mounting;

    expect(document.activeElement).toBe(logInteraction);
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toBe(
      "Documents — this section is hidden in this workspace. A workspace owner or admin can turn this section back on.",
    );
  });

  it("UXD-006 does not describe a DOM-hidden visible module as turned off", async () => {
    markup(`/app/people/${personId}?section=documents`);
    reminderSectionMarkup();
    document.querySelector<HTMLElement>(
      '[data-profile-section="documents"]',
    )!.hidden = true;
    const audit = deferred<Response>();
    stubProfile(
      profileOf({ profileSections: [{ id: "documents", status: "ready" }] }, {
        dueInformation: { status: "unavailable" },
      }),
      { [VIEW]: recorded, [AUDIT]: audit.promise },
    );

    const mounting = mountPersonWorkspace();
    await vi.waitFor(() =>
      expect(document.querySelector("#person-profile-name")?.textContent).toBe(
        "Ada",
      )
    );
    const notice = document.querySelector<HTMLElement>(
      "#person-profile-section-notice",
    );
    expect(notice?.hidden).toBe(true);
    expect(document.activeElement).toBe(
      document.querySelector("#person-profile-name"),
    );

    const edit = document.querySelector<HTMLButtonElement>("#person-edit-open");
    edit?.focus();
    audit.resolve(noAudit);
    await mounting;
    expect(document.activeElement).toBe(edit);
    expect(notice?.hidden).toBe(true);
  });

  it("UXD-006 keeps focus on a control the reader chose while the workspace settles without a section", async () => {
    markup(`/app/people/${personId}`);
    firstRunActionMarkup();
    const reminders = deferred<Response>();
    stubProfile(profileOf({}, { dueInformation: { status: "unavailable" } }), {
      [VIEW]: recorded,
      [REMINDERS]: reminders.promise,
    });

    const mounting = mountPersonWorkspace();
    await vi.waitFor(() =>
      expect(document.querySelector("#person-profile-name")?.textContent).toBe(
        "Ada",
      )
    );
    const edit = document.querySelector<HTMLButtonElement>(
      "#person-edit-open",
    )!;
    edit.focus();
    reminders.resolve(noReminders);
    await mounting;

    expect(document.activeElement).toBe(edit);
    expect(document.activeElement).not.toBe(
      document.querySelector("#person-profile-name"),
    );
  });

  it("PLANNING-002 does not steal reminder form focus after delayed profile reconciliation", async () => {
    markup(`/app/people/${personId}?section=reminders`);
    reminderSectionMarkup();
    const delayedAudit = deferred<Response>();
    stubProfile(profileOf({}, { dueInformation: { status: "unavailable" } }), {
      [VIEW]: recorded,
      [AUDIT]: delayedAudit.promise,
    });

    const mounting = mountPersonWorkspace();
    await vi.waitFor(() =>
      expect(document.querySelector("#person-profile-name")?.textContent).toBe(
        "Ada",
      )
    );
    const title = document.querySelector<HTMLInputElement>(
      '[data-reminder-form] [name="title"]',
    )!;
    title.focus();
    title.value = "Keep this draft";
    delayedAudit.resolve(noAudit);
    await mounting;

    expect(document.activeElement).toBe(title);
    expect(title.value).toBe("Keep this draft");
  });

  it("REL-045 never moves a deep-linked section the reader can already see once every zone settles", async () => {
    markup(`/app/people/${personId}?section=documents`);
    const documents = document.querySelector<HTMLElement>(
      "#profile-section-documents",
    )!;
    const scroll = vi.fn();
    documents.scrollIntoView = scroll;
    // The reader sees the section, and may be pressing something inside it.
    documents.getBoundingClientRect = () => new DOMRect(0, 120, 600, 300);
    stubProfile();

    await mountPersonWorkspace();

    // The page placed the section once, when it first showed, without an
    // animation still running when the reader reaches for its controls; the
    // last zone settling must not scroll the page under a pending click.
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({
      behavior: "instant",
      block: "start",
    });
    expect(document.activeElement).toBe(documents);

    // A section the reader picks still glides into place.
    const photos = document.querySelector<HTMLElement>(
      "#profile-section-photos",
    )!;
    const glide = vi.fn();
    photos.scrollIntoView = glide;
    document.querySelector<HTMLAnchorElement>('[data-section-link="photos"]')
      ?.click();
    expect(glide).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("REL-046 glides a section the reader picks from script, and jumps when they prefer reduced motion", async () => {
    // The document no longer scrolls smoothly (REL-046), so the one glide the
    // workspace keeps asks for it, and honours a reduced-motion preference.
    for (const reduced of [false, true]) {
      markup();
      vi.stubGlobal("matchMedia", (query: string) => ({
        addEventListener: () => undefined,
        matches: reduced && query === "(prefers-reduced-motion: reduce)",
        media: query,
        removeEventListener: () => undefined,
      }));
      stubProfile();
      await mountPersonWorkspace();
      const photos = document.querySelector<HTMLElement>(
        "#profile-section-photos",
      )!;
      const glide = vi.fn();
      photos.scrollIntoView = glide;
      document.querySelector<HTMLAnchorElement>('[data-section-link="photos"]')
        ?.click();
      expect(glide).toHaveBeenCalledWith({
        behavior: reduced ? "instant" : "smooth",
        block: "start",
      });
    }
  });

  it("REL-046 marks the workspace settled only once its mount and its view record have finished", async () => {
    markup();
    let idle: IdleRequestCallback | undefined;
    vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
      idle = callback;
      return 1;
    });
    const recordView = deferred<Response>();
    stubProfile(undefined, { [VIEW]: recordView.promise });
    const ready = document.querySelector<HTMLElement>("#person-profile-ready")!;

    await mountPersonWorkspace();

    // Every section has answered, but the page still owes its view record: a
    // navigation now would cancel a request in flight (Linux WebKit then
    // stalled the next page's requests, REL-046).
    expect(ready.hasAttribute("data-workspace-settled")).toBe(false);
    idle?.({ didTimeout: false, timeRemaining: () => 50 });
    await Promise.resolve();
    expect(ready.hasAttribute("data-workspace-settled")).toBe(false);
    recordView.resolve(recorded);
    await vi.waitFor(() =>
      expect(ready.hasAttribute("data-workspace-settled")).toBe(true)
    );
  });

  it("REL-045 brings back a deep-linked section that drifted out of view, without animating", async () => {
    markup(`/app/people/${personId}?section=documents`);
    const documents = document.querySelector<HTMLElement>(
      "#profile-section-documents",
    )!;
    const scroll = vi.fn();
    documents.scrollIntoView = scroll;
    stubProfile();
    documents.getBoundingClientRect = () =>
      new DOMRect(0, innerHeight + 400, 600, 300);

    await mountPersonWorkspace();

    expect(scroll).toHaveBeenCalledTimes(2);
    for (const call of scroll.mock.calls) {
      expect(call).toEqual([{ behavior: "instant", block: "start" }]);
    }
  });

  it("[APP-003C] reconciles queryless and invalid section history", async () => {
    markup();
    stubProfile(profileOf(lovelace, { dueInformation: unavailableDue }));

    await mountPersonWorkspace();
    const heading = document.querySelector("#person-profile-name");
    const photos = document.querySelector<HTMLAnchorElement>(
      '[data-section-link="photos"]',
    );
    photos?.click();
    expect(new URLSearchParams(location.search).get("section")).toBe("photos");
    expect(new URLSearchParams(location.search).has("view")).toBe(false);
    expect(photos?.getAttribute("aria-current")).toBe("location");

    history.back();
    await vi.waitFor(() => expect(location.search).toBe(""));
    expect(document.querySelectorAll("[data-section-link][aria-current]"))
      .toHaveLength(0);
    expect(document.activeElement).toBe(heading);
    expect(
      document.querySelector<HTMLElement>("#person-profile-section-notice")
        ?.hidden,
    ).toBe(true);

    history.replaceState({}, "", `?section=not-a-section`);
    document.querySelector<HTMLAnchorElement>(
      '[data-section-link="documents"]',
    )?.click();
    history.back();
    await vi.waitFor(() =>
      expect(location.search).toBe("?section=not-a-section")
    );
    expect(document.querySelectorAll("[data-section-link][aria-current]"))
      .toHaveLength(0);
    expect(document.activeElement).toBe(heading);
    expect(
      document.querySelector<HTMLElement>("#person-profile-section-notice")
        ?.hidden,
    ).toBe(true);
  });

  it("INTERACTION-001 / UXD-006 explains member hidden links and clears the notice for visible history", async () => {
    markup(`/app/people/${personId}?section=activities`);
    interactionSectionMarkup();
    stubProfile(
      profileOf({
        profileSections: [
          { id: "activities", status: "hidden" },
          { id: "notes", status: "hidden" },
        ],
      }, { dueInformation: { status: "unavailable" } }),
    );

    await mountPersonWorkspace();
    const notice = document.querySelector<HTMLElement>(
      "#person-profile-section-notice",
    );
    expect(document.activeElement).toBe(notice);
    expect(notice?.textContent).toContain(
      "Activities — this section is hidden in this workspace.",
    );
    expect(notice?.textContent).toContain(
      "A workspace owner or admin can turn this section back on.",
    );
    expect(notice?.querySelector("a")).toBeNull();
    const currentUrl = location.href;
    expect(
      notice?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
    ).toBe(true);
    expect(location.href).toBe(currentUrl);
    expect(document.querySelectorAll("[data-section-link][aria-current]"))
      .toHaveLength(0);

    history.pushState({}, "", `?section=notes`);
    history.pushState({}, "", `?section=documents`);
    globalThis.dispatchEvent(new PopStateEvent("popstate"));
    expect(document.activeElement).toBe(
      document.querySelector('[data-profile-section="documents"]'),
    );
    expect(notice?.hidden).toBe(true);
    expect(
      document.querySelector('[data-section-link="documents"]')?.getAttribute(
        "aria-current",
      ),
    ).toBe("location");
    history.back();
    await vi.waitFor(() => expect(location.search).toBe("?section=notes"));
    expect(document.activeElement).toBe(notice);
    expect(notice?.hidden).toBe(false);
    expect(notice?.textContent).toContain(
      "Notes — this section is hidden in this workspace.",
    );
    expect(document.querySelectorAll("[data-section-link][aria-current]"))
      .toHaveLength(0);
    history.forward();
    await vi.waitFor(() => expect(location.search).toBe("?section=documents"));
    expect(document.activeElement).toBe(
      document.querySelector('[data-profile-section="documents"]'),
    );
    expect(notice?.hidden).toBe(true);
  });

  it("GAP-028 treats a section its owner reports turned off as hidden", async () => {
    markup();
    document.querySelector("#person-profile-sections ul")?.insertAdjacentHTML(
      "beforeend",
      '<li><a href="?section=life-events" data-section-link="life-events">Life events</a></li>',
    );
    document.querySelector('[data-zone="timeline"]')?.insertAdjacentHTML(
      "beforeend",
      '<section data-profile-section="life-events" tabindex="-1"></section>',
    );
    stubProfile();

    await mountPersonWorkspace();
    const link = document.querySelector<HTMLAnchorElement>(
      '[data-section-link="life-events"]',
    )!;
    expect(link.closest("li")?.hidden).toBe(false);
    document.dispatchEvent(
      new CustomEvent("person-section-hidden", {
        detail: { sectionId: "life-events" },
      }),
    );
    // Another report without a section id changes nothing.
    document.dispatchEvent(new CustomEvent("person-section-hidden"));
    expect(link.closest("li")?.hidden).toBe(true);

    history.pushState({}, "", `?section=life-events`);
    globalThis.dispatchEvent(new PopStateEvent("popstate"));
    const notice = document.querySelector<HTMLElement>(
      "#person-profile-section-notice",
    );
    expect(notice?.hidden).toBe(false);
    expect(notice?.textContent).toContain(
      "Life events — this section is hidden in this workspace.",
    );
  });

  it("renders explicit not-found, forbidden, and unavailable states", async () => {
    for (
      const state of [
        { heading: "Person not found", status: 404 },
        { heading: "Person unavailable", status: 403 },
        { heading: "Person temporarily unavailable", status: 503 },
      ]
    ) {
      markup();
      const api = stubProfile(undefined, {
        [PROFILE]: jsonResponse({ status: state.status }, state.status),
      });
      await mountPersonWorkspace();
      expect(document.querySelector("#person-profile-state h1")?.textContent)
        .toBe(state.heading);
      expect(
        document.querySelector<HTMLElement>("#person-profile-state")?.hidden,
      ).toBe(false);
      expect(
        document.querySelector<HTMLElement>("#person-profile-ready")?.hidden,
      ).toBe(true);
      expect(
        document.querySelector("#person-profile-ready")?.hasAttribute(
          "aria-busy",
        ),
      ).toBe(false);
      expect(requested(api, VIEWED)).toHaveLength(0);
    }

    markup("/app/people/not-a-person");
    const api = stubApi();
    await mountPersonWorkspace();
    expect(document.querySelector("#person-profile-state h1")?.textContent)
      .toBe("Person not found");
    expect(api.fetch).not.toHaveBeenCalled();

    drawShell("<main></main>");
    await expect(mountPersonWorkspace()).resolves.toBeUndefined();
  });

  it("distinguishes an archived canonical person as read-only", async () => {
    markup(`/app/people/${personId}?section=identity-summary`);
    document.querySelector("#person-profile-ready")?.insertAdjacentHTML(
      "beforeend",
      '<header class="profile-facts-heading"></header><section data-profile-section="pets"><span data-rail-count-slot><span data-profile-rail-count hidden></span></span></section>',
    );
    const api = stubProfile(profileOf({ givenName: "Harriet" }, {
      dueInformation: unavailableDue,
      status: "archived",
      summary: {
        primaryContactMethods: [],
        relationshipCounts: [],
        sectionCounts: [{ count: 0, id: "pets", status: "ready" }],
      },
    }));
    await mountPersonWorkspace();
    expect(
      document.querySelector("#person-profile-archived")?.hasAttribute(
        "hidden",
      ),
    ).toBe(false);
    const banner = document.querySelector<HTMLElement>(
      "[data-person-archived-banner]",
    );
    expect(banner?.hidden).toBe(false);
    expect(banner?.textContent).toContain(
      "This person is archived. Editing is disabled.",
    );
    expect(banner?.querySelector("#person-restore")).not.toBeNull();
    expect(
      document.querySelector<HTMLFormElement>("#person-edit-form")?.hidden,
    ).toBe(true);
    expect(document.activeElement).toBe(
      document.querySelector("#person-profile-name"),
    );
    expect(requested(api, VIEWED)).not.toHaveLength(0);
    expect(
      document.querySelector<HTMLElement>('[data-profile-section="pets"]')
        ?.dataset.railEmpty,
    ).toBe("true");
  });

  it("REL-039 keeps the person menu and lifecycle actions inert until the hero island wires them", async () => {
    markup();
    const staticToggle = document.querySelector<HTMLButtonElement>(
      "#person-menu-toggle",
    )!;
    const staticActions = [
      "#person-edit-open",
      "#person-archive",
      "#person-delete-open",
      "#person-restore",
    ].map((selector) => document.querySelector<HTMLButtonElement>(selector)!);
    const profile = deferred<Response>();
    const api = stubProfile(undefined, { [PROFILE]: profile.promise });

    const mounting = mountPersonWorkspace();
    await vi.waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
    // A click before the island is wired is refused visibly, not lost.
    expect(staticToggle.disabled).toBe(true);
    staticToggle.click();
    expect(staticToggle.getAttribute("aria-expanded")).toBe("false");
    expect(staticActions.map((action) => action.disabled)).toEqual([
      true,
      true,
      true,
      true,
    ]);

    profile.resolve(jsonResponse(zeroProfile()));
    await mounting;
    const hero = document.querySelector<HTMLElement>("[data-person-hero]")!;
    expect(hero.dataset.island).toBe("person-hero");
    expect(hero.hasAttribute("data-island-ready")).toBe(true);
    const toggle = document.querySelector<HTMLButtonElement>(
      "#person-menu-toggle",
    )!;
    expect(toggle).not.toBe(staticToggle);
    expect(toggle.disabled).toBe(false);
    expect(
      [
        "#person-edit-open",
        "#person-archive",
        "#person-delete-open",
        "#person-restore",
      ].map((selector) =>
        document.querySelector<HTMLButtonElement>(selector)!.disabled
      ),
    ).toEqual([false, false, false, false]);
  });

  it("REL-039 leaves lifecycle actions inert when the person cannot load", async () => {
    markup();
    stubProfile(undefined, { [PROFILE]: jsonResponse({ status: 404 }, 404) });
    await mountPersonWorkspace();
    expect(
      document.querySelector<HTMLButtonElement>("#person-delete-open")!
        .disabled,
    ).toBe(true);
  });

  it("[PEOPLE-004] keeps lifecycle failures recoverable in the profile shell", async () => {
    markup();
    stubProfile(
      profileOf(lovelace, { dueInformation: { status: "unavailable" } }),
      {
        [VIEW]: recorded,
        "PATCH /api/v1/people/:personId": problemResponse(409, {
          detail: "This person changed elsewhere. Reload and try again.",
          title: "Person changed",
          type: "https://kinship.test/problems/person-stale",
        }),
        "POST /api/v1/people/:personId/archive": unreachable,
        "GET /api/v1/people/:personId/deletion-impact": problemResponse(503, {
          detail: "Deletion impact could not be loaded.",
          title: "Temporarily unavailable",
          type: "https://kinship.test/problems/dependency-unavailable",
        }),
      },
    );
    await mountPersonWorkspace();

    const editForm = document.querySelector<HTMLFormElement>(
      "#person-edit-form",
    )!;
    editForm.requestSubmit();
    await vi.waitFor(() =>
      expect(document.querySelector("#person-lifecycle-status")?.textContent)
        .toContain("changed elsewhere")
    );

    document.querySelector<HTMLButtonElement>("#person-archive")?.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#person-lifecycle-status")?.textContent)
        .toContain("temporarily unavailable")
    );
    expect(
      document.querySelector<HTMLButtonElement>("#person-archive")?.disabled,
    )
      .toBe(false);

    document.querySelector<HTMLButtonElement>("#person-delete-open")?.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#person-delete-impact")?.textContent)
        .toContain("could not be loaded")
    );
  });
});

describe("GAP-033 person workspace renders only what the shell drew", () => {
  it("fills the shell's state region rather than building one", async () => {
    markup();
    const create = vi.spyOn(document, "createElement");
    stubProfile(undefined, {
      [PROFILE]: jsonResponse({ status: 404 }, 404),
    });
    await mountPersonWorkspace();
    const state = document.querySelector<HTMLElement>("#person-profile-state")!;
    expect(state.querySelector("[data-profile-state-heading]")?.textContent)
      .toBe("Person not found");
    expect(state.querySelector("[data-profile-state-detail]")?.textContent)
      .toContain("does not exist in the active workspace");
    const link = state.querySelector<HTMLAnchorElement>(
      "[data-profile-state-link]",
    )!;
    expect(link.textContent).toBe("Return to people");
    expect(link.getAttribute("href")).toBe("/app/people");
    expect(state.querySelectorAll("h1")).toHaveLength(1);
    expect(document.activeElement).toBe(state);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(
    [
      ["access-lost", "Person unavailable", "/app"],
      [
        "unavailable",
        "Person temporarily unavailable",
        `/app/people/${personId}`,
      ],
    ] as const,
  )(
    "reports a %s session in the state region",
    async (kind, heading, href) => {
      markup();
      stubApi({
        "POST /api/v1/application-entry": problemResponse(
          kind === "access-lost" ? 401 : 503,
        ),
        [SESSION]: problemResponse(401),
      });
      await mountPersonWorkspace();
      const state = document.querySelector("#person-profile-state")!;
      expect(state.querySelector("h1")?.textContent).toBe(heading);
      expect(
        state.querySelector("[data-profile-state-link]")?.getAttribute("href"),
      ).toBe(href);
    },
  );

  it("reports an unreachable person as temporarily unavailable", async () => {
    markup();
    stubProfile(undefined, { [PROFILE]: unreachable });
    await mountPersonWorkspace();
    expect(document.querySelector("#person-profile-state h1")?.textContent)
      .toBe("Person temporarily unavailable");
  });

  it("does nothing on a shell whose state region lost its copy", async () => {
    markup();
    document.querySelector("[data-profile-state-heading]")?.remove();
    const api = stubApi();
    await mountPersonWorkspace();
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("offers an admin no link when the shell lacks the personalization template", async () => {
    markup(`/app/people/${personId}?section=documents`);
    document.querySelector(`#${SECTION_NOTICE_LINK_TEMPLATE_ID}`)?.remove();
    stubProfile(
      profileOf({ profileSections: [{ id: "documents", status: "hidden" }] }),
      {
        [SESSION]: jsonResponse({
          ...session,
          member: { ...session.member, role: "owner" },
        }),
        [REST]: noFiles,
      },
    );
    await mountPersonWorkspace();
    const notice = document.querySelector<HTMLElement>(
      "#person-profile-section-notice",
    )!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toBe(
      "Documents — this section is hidden in this workspace.",
    );
    expect(notice.querySelector("a")).toBeNull();
  });

  it("ignores a first-run control naming no known action", async () => {
    markup();
    const stray = document.createElement("button");
    stray.dataset.firstRunAction = "unknown";
    document.querySelector(".person-first-run-actions")?.append(stray);
    stubProfile(zeroProfile(), { [REST]: noFiles });
    await mountPersonWorkspace();
    const before = document.activeElement;
    stray.click();
    await Promise.resolve();
    expect(document.activeElement).toBe(before);
  });
});

describe("GAP-047 turned-off sections and the section navigation", () => {
  /** Every visible navigation link, and whether its target is on the page. */
  function linkTargets(): readonly (readonly [string, boolean])[] {
    return [
      ...document.querySelectorAll<HTMLAnchorElement>("[data-section-link]"),
    ].filter((link) => !link.closest<HTMLElement>("li")!.hidden).map(
      (link) => {
        const id = link.dataset.sectionLink!;
        const target = document.querySelector<HTMLElement>(
          `[data-profile-section="${id}"]`,
        );
        return [
          id,
          target !== null && target.dataset.sectionState !== "hidden",
        ] as const;
      },
    );
  }

  it("draws no card and mounts no owner for a turned-off section", async () => {
    markup();
    summaryRailMarkup();
    interactionSectionMarkup();
    // Work drawn as fully as contact methods, so only its module keeps it off.
    const contacts = document.querySelector<HTMLElement>(
      '[data-profile-section="contact-methods"]',
    )!;
    document.querySelector('[data-profile-section="work"]')!.replaceWith(
      document.createRange().createContextualFragment(
        contacts.outerHTML.replaceAll("contact-methods", "work").replaceAll(
          "Contact methods",
          "Work",
        ),
      ),
    );
    const api = stubProfile(
      profileOf({
        profileSections: [
          { id: "work", status: "hidden" },
          { id: "notes", status: "hidden" },
          { id: "activities", status: "hidden" },
          { id: "life-events", status: "hidden" },
          { id: "calls", status: "hidden" },
          { id: "conversations", status: "hidden" },
        ],
      }, { dueInformation: unavailableDue }),
      { [VIEW]: recorded },
    );

    await mountPersonWorkspace();
    const work = document.querySelector<HTMLElement>(
      '[data-profile-section="work"]',
    )!;
    expect(work.hidden).toBe(true);
    expect(work.dataset.sectionState).toBe("hidden");
    expect(requested(api, "/facts/work")).toHaveLength(0);
    // Every timeline section is off, so neither the timeline nor the notes
    // and activities owner asks for anything.
    expect(requested(api, "/timeline")).toHaveLength(0);
    expect(requested(api, "/activities")).toHaveLength(0);
    expect(requested(api, "/notes")).toHaveLength(0);
    // A shown neighbour still loads.
    expect(requested(api, "/facts/contact-methods")).not.toHaveLength(0);
  });

  it("links only to sections the page shows", async () => {
    markup();
    summaryRailMarkup();
    // A link whose section the page never drew, and one the workspace hides.
    document.querySelector("#person-profile-sections ul")?.insertAdjacentHTML(
      "beforeend",
      `<li><a href="?section=gifts" data-section-link="gifts">Gifts</a></li>
       <li><a href="?section=work" data-section-link="work">Work</a></li>
       <li><a href="?section=pets" data-section-link="pets">Pets</a></li>`,
    );
    stubProfile(
      profileOf({ profileSections: [{ id: "work", status: "hidden" }] }, {
        dueInformation: unavailableDue,
      }),
      { [VIEW]: recorded },
    );

    await mountPersonWorkspace();
    const targets = linkTargets();
    expect(targets.map(([id]) => id)).toContain("pets");
    expect(targets.map(([id]) => id)).not.toContain("gifts");
    expect(targets.map(([id]) => id)).not.toContain("work");
    // No navigation target lacks a matching rendered section.
    expect(targets.filter(([, shown]) => !shown)).toEqual([]);
  });

  it("lands a deep link to a turned-off section on the quiet hidden state", async () => {
    markup(`/app/people/${personId}?section=work`);
    summaryRailMarkup();
    document.querySelector("#person-profile-sections ul")?.insertAdjacentHTML(
      "beforeend",
      `<li><a href="?section=work" data-section-link="work">Work</a></li>`,
    );
    stubProfile(
      profileOf({ profileSections: [{ id: "work", status: "hidden" }] }, {
        dueInformation: unavailableDue,
      }),
      { [VIEW]: recorded },
    );

    await mountPersonWorkspace();
    const notice = document.querySelector<HTMLElement>(
      "#person-profile-section-notice",
    )!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain(
      "Work — this section is hidden in this workspace.",
    );
    expect(document.activeElement).toBe(notice);
    expect(
      document.querySelector<HTMLElement>('[data-profile-section="work"]')
        ?.hidden,
    ).toBe(true);
  });
});
