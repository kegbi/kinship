// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPeopleProfile } from "./people-profile.ts";
import { clearToasts } from "./toasts.ts";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

const workspaceId = "00000000-0000-4000-8000-000000000003";
const personId = "00000000-0000-4000-8000-000000000100";
const firstRunPersonId = "00000000-0000-4000-8000-000000000101";
const session = {
  member: { id: "member", role: "member" },
  principal: { userId: "user" },
  status: "authenticated",
  workspace: { id: workspaceId, name: "Circle" },
  workspaces: [{ id: workspaceId, name: "Circle" }],
};

function markup(path = `/app/people/${personId}`): void {
  vi.stubGlobal(
    "requestIdleCallback",
    (callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 50 });
      return 1;
    },
  );
  history.replaceState({}, "", path);
  document.body.innerHTML = `
    <ul id="app-toasts" aria-live="polite" aria-label="Notifications"></ul>
    <section id="person-profile-state" tabindex="-1" hidden></section>
    <section id="person-profile-ready" aria-busy="true">
      <header class="person-profile-hero">
        <nav aria-label="Breadcrumb">
          <a href="/app/people">People</a><span aria-hidden="true">/</span>
          <span data-person-breadcrumb-name></span>
        </nav>
        <div id="person-profile-avatar"></div>
        <div>
          <h1 id="person-profile-name" tabindex="-1"><span class="skeleton skeleton-line skeleton-line-60" aria-hidden="true"></span><span class="sr-only">Loading person…</span></h1>
          <p id="person-profile-nickname" hidden></p>
          <div class="person-profile-badges" role="group" aria-label="Person states">
            <p class="state-badge calm">Identity saved</p>
            <p id="person-profile-favorite" hidden></p>
            <p id="person-profile-self" hidden></p>
            <p id="person-profile-deceased" hidden></p>
            <p id="person-profile-archived" hidden></p>
            <p id="person-profile-partial" hidden></p>
          </div>
          <p data-profile-description></p>
        </div>
        <div data-person-profile-actions role="group" aria-label="Person actions">
          <button data-person-interaction-capture data-quick-capture data-interaction-intended-kind="activity" type="button">Log interaction</button>
          <button data-person-interaction-capture data-quick-capture data-interaction-intended-kind="note" type="button">Add note</button>
          <div role="group" aria-label="Person menu">
            <button id="person-menu-toggle" type="button" aria-label="Open person menu" aria-expanded="false" aria-controls="person-menu"><span aria-hidden="true">…</span></button>
            <div id="person-menu" hidden>
              <button id="person-edit-open" type="button">Edit person</button>
              <a id="person-export-vcard" hidden>Export vCard</a>
              <button id="person-archive" type="button">Archive person</button>
              <button id="person-audit-history" type="button">Audit history</button>
              <button id="person-delete-open" type="button">Delete person</button>
            </div>
          </div>
        </div>
        <dl data-person-vital-stats>
          <div><dt>Age or birthday</dt><dd><a href="?section=important-dates" data-person-vital-value="birthday">Loading…</a></dd></div>
          <div><dt>Last contact</dt><dd><a href="?section=activities" data-profile-last-contact>Loading…</a></dd></div>
          <div><dt>Next reminder</dt><dd><a href="?section=reminders" data-person-vital-value="next-reminder">Loading…</a></dd></div>
          <div><dt>Stay in touch</dt><dd><a href="?section=stay-in-touch"><span id="person-profile-due-state"></span></a></dd></div>
          <div><dt>Work</dt><dd><a href="?section=work" data-person-vital-value="work">Loading…</a></dd></div>
          <div><dt>First met</dt><dd><a href="?section=first-meeting" data-person-vital-value="first-meeting">Loading…</a></dd></div>
        </dl>
        <div data-profile-fact-section="tags">
          <ul id="person-profile-tags"></ul>
        </div>
        <p id="person-lifecycle-status"></p>
        <form id="person-edit-form" data-profile-section="identity-summary" hidden>
          <span data-profile-field="givenName"></span>
          <span data-profile-field="middleName"></span>
          <span data-profile-field="familyName"></span>
          <span data-profile-field="nickname"></span>
          <span data-profile-field="gender"></span>
          <input name="givenName"><input name="middleName"><input name="familyName"><input name="nickname"><input name="isPartial" type="checkbox">
          <button type="submit">Save person</button><button id="person-edit-cancel" type="button">Cancel edit</button>
        </form>
        <dialog id="person-delete-dialog">
          <form id="person-delete-form">
            <p id="person-delete-impact"></p><input id="person-delete-confirmation">
            <button type="submit">Confirm delete</button><button id="person-delete-cancel" type="button">Cancel delete</button>
          </form>
        </dialog>
      </header>
      <aside data-person-archived-banner hidden>
        <p>This person is archived. Editing is disabled.</p>
        <button id="person-restore" type="button">Restore person</button>
      </aside>
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
            <button class="button-primary" data-zone-filter="all" type="button" aria-pressed="true">All</button>
            <button class="button-secondary" data-zone-filter="timeline" type="button" aria-pressed="false">Timeline</button>
            <button class="button-secondary" data-zone-filter="planning" type="button" aria-pressed="false">Planning</button>
            <button class="button-secondary" data-zone-filter="things" type="button" aria-pressed="false">Things</button>
            <button class="button-secondary" data-zone-filter="admin" type="button" aria-pressed="false">Admin</button>
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
    </section>`;
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
      <section data-profile-section="contact-methods" data-profile-fact-section="contact-methods" data-section-state="loading">
        <span data-profile-rail-count hidden></span>
        <p data-profile-fact-state></p><ul data-profile-fact-list></ul>
        <button data-profile-fact-add data-profile-fact-add-icon aria-label="Add contact methods"><span aria-hidden="true">+</span></button>
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
        `<section data-profile-section="${id}"><span data-profile-rail-count hidden></span></section>`
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
  readonly cadence: HTMLInputElement;
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
       <p data-cadence-state></p><ul data-cadence-list></ul>
       <form data-cadence-form><input name="intervalCount"><button type="submit">Save cadence</button></form>
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
    cadence: document.querySelector<HTMLInputElement>(
      '[data-cadence-form] input[name="intervalCount"]',
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
  return {
    dueInformation: {
      detail: "No due information.",
      openTaskCount: 0,
      status: "ready",
    },
    person: {
      familyName: "Profile",
      givenName: "Empty",
      id: personId,
      isDeceased: false,
      isPartial: false,
      isSelf: false,
      isStarred: false,
      profileSections: [],
      tagCount: 0,
      tags: [],
      updatedAt: "2026-08-15T08:00:00.000Z",
    },
    status: overrides.status ?? "ready",
    summary: { ...zeroSummary, ...overrides.summary },
  };
}

function stubReadyProfile(
  profileSections: readonly { readonly id: string; readonly status: string }[] =
    [],
  readySession: Record<string, unknown> = session,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(readySession))
    .mockResolvedValueOnce(response({
      dueInformation: {
        detail: "No due information.",
        openTaskCount: 0,
        status: "ready",
      },
      person: {
        familyName: "Lovelace",
        givenName: "Ada",
        id: personId,
        isDeceased: false,
        isPartial: false,
        isSelf: false,
        isStarred: false,
        profileSections,
        tagCount: 0,
        tags: [],
        updatedAt: "2026-08-15T08:00:00.000Z",
      },
      status: "ready",
    }))
    .mockResolvedValue(undefined as never);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  clearToasts();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
  document.body.innerHTML = "";
});

describe("PEOPLE-001 canonical person identity shell", () => {
  it("UXD-003B paints a busy shell before identity resolves and clears it with the hero", async () => {
    markup();
    let releaseProfile!: (value: Response) => void;
    const pendingProfile = new Promise<Response>((resolve) => {
      releaseProfile = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockReturnValueOnce(pendingProfile)
      .mockResolvedValue(undefined as never);
    vi.stubGlobal("fetch", fetchMock);

    const mounting = mountPeopleProfile();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
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

    releaseProfile(response({
      dueInformation: { detail: "No due information.", status: "ready" },
      person: {
        familyName: "Lovelace",
        givenName: "Ada",
        id: personId,
        isDeceased: false,
        isPartial: false,
        isSelf: false,
        isStarred: false,
        tagCount: 0,
        tags: [],
        updatedAt: "2026-08-15T08:00:00.000Z",
      },
      status: "ready",
    }));
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
    const fetchMock = vi.fn(
      (resource: string | URL | Request, init?: RequestInit) => {
        const url = String(resource);
        if (url.endsWith("/api/v1/session")) return response(session);
        if (url === `/api/v1/people/${personId}?include=summary`) {
          return response({
            dueInformation: { detail: "No due information.", status: "ready" },
            person: {
              familyName: "Lovelace",
              givenName: "Ada",
              id: personId,
              isDeceased: false,
              isPartial: false,
              isSelf: false,
              isStarred: false,
              tagCount: 0,
              tags: [],
              updatedAt: "2026-08-15T08:00:00.000Z",
            },
            status: "ready",
          });
        }
        if (url.endsWith(`/${personId}/files`)) {
          return response({ files: [], status: "ready" });
        }
        if (url.endsWith(`/${personId}/gifts`)) {
          return response({
            debts: [],
            gifts: [],
            status: "ready",
            supportedCurrencyCodes: ["USD"],
          });
        }
        if (url.includes(`/${personId}/audit`)) {
          return response({ items: [], status: "ready" });
        }
        if (init?.method === "POST" && url.endsWith(`/${personId}/view`)) {
          return response({ status: "recorded" });
        }
        return Promise.resolve(undefined as never);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await mountPeopleProfile();
    const count = (suffix: string) =>
      fetchMock.mock.calls.filter(([resource]) =>
        String(resource).includes(suffix)
      ).length;
    expect(zoneObserver.observed).toHaveLength(4);
    expect(count(`/${personId}/files`)).toBe(0);
    expect(count(`/${personId}/gifts`)).toBe(0);
    expect(count(`/${personId}/audit`)).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

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
    expect(fetchMock.mock.calls.map(([resource]) => String(resource))).toEqual([
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
    const fetchMock = vi.fn(
      (resource: string | URL | Request, init?: RequestInit) => {
        const url = String(resource);
        if (url.endsWith("/api/v1/session")) return response(session);
        if (url === `/api/v1/people/${personId}?include=summary`) {
          return response(zeroProfile());
        }
        if (url.endsWith(`/${personId}/archive`)) {
          return response({
            person: {
              familyName: "Profile",
              givenName: "Empty",
              id: personId,
              isPartial: false,
              lifecycle: "archived",
              updatedAt: archivedAt,
            },
            status: "archived",
          });
        }
        if (url.endsWith(`/${personId}/files`)) {
          return response({ files: [], status: "ready" });
        }
        if (url.endsWith(`/${personId}/gifts`)) {
          return response({
            debts: [],
            gifts: [],
            status: "ready",
            supportedCurrencyCodes: ["USD"],
          });
        }
        if (init?.method === "POST" && url.endsWith(`/${personId}/view`)) {
          return response({ status: "recorded" });
        }
        return Promise.resolve(undefined as never);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await mountPeopleProfile();
    document.querySelector<HTMLButtonElement>("#person-archive")?.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLElement>("[data-person-archived-banner]")
          ?.hidden,
      ).toBe(false)
    );

    zoneObserver.activate("things");
    const giftAdd = document.querySelector<HTMLButtonElement>(
      '[data-person-gifts="gift"] [data-gift-add]',
    );
    expect(giftAdd).not.toBeNull();
    await vi.waitFor(() => expect(giftAdd!.hidden).toBe(true));
  });

  it("UXD-003B activates a deep-linked zone without delaying section focus", async () => {
    markup(`/app/people/${personId}?section=photos`);
    deferredZoneMarkup();
    stubDeferredZoneObserver();
    const fetchMock = stubReadyProfile();

    await mountPeopleProfile();

    expect(document.activeElement).toBe(
      document.querySelector('[data-profile-section="photos"]'),
    );
    expect(
      fetchMock.mock.calls.filter(([resource]) =>
        String(resource).endsWith(`/${personId}/files`)
      ),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([resource]) =>
        String(resource).endsWith(`/${personId}/gifts`)
      ),
    ).toHaveLength(1);
  });

  it("UXD-003B activates the selected zone without fetching other deferred zones", async () => {
    markup(`/app/people/${personId}?view=admin`);
    deferredZoneMarkup();
    stubDeferredZoneObserver();
    const fetchMock = stubReadyProfile();

    await mountPeopleProfile();

    const requested = (suffix: string) =>
      fetchMock.mock.calls.filter(([resource]) =>
        String(resource).includes(suffix)
      );
    expect(requested(`/${personId}/audit`)).toHaveLength(1);
    expect(requested(`/${personId}/files`)).toHaveLength(0);
    expect(requested(`/${personId}/gifts`)).toHaveLength(0);
  });

  it("UXD-003B records the view through the timeout fallback", async () => {
    markup();
    vi.stubGlobal("requestIdleCallback", undefined);
    const fetchMock = stubReadyProfile();

    await mountPeopleProfile();

    expect(
      fetchMock.mock.calls.filter(([resource, init]) =>
        init?.method === "POST" &&
        String(resource).endsWith(`/${personId}/view`)
      ),
    ).toHaveLength(1);
  });

  it("UXD-003B promotes section states only after the initial fan-out settles", async () => {
    markup();
    deferredZoneMarkup();
    vi.stubGlobal("IntersectionObserver", undefined);
    let releaseFiles!: (value: Response) => void;
    const pendingFiles = new Promise<Response>((resolve) => {
      releaseFiles = resolve;
    });
    const fetchMock = vi.fn(
      (resource: string | URL | Request, init?: RequestInit) => {
        const url = String(resource);
        if (url.endsWith("/api/v1/session")) return response(session);
        if (url === `/api/v1/people/${personId}?include=summary`) {
          return response({
            dueInformation: { detail: "No due information.", status: "ready" },
            person: {
              givenName: "Ada",
              id: personId,
              isDeceased: false,
              isPartial: false,
              isSelf: false,
              isStarred: false,
              tagCount: 0,
              tags: [],
              updatedAt: "2026-08-15T08:00:00.000Z",
            },
            status: "ready",
          });
        }
        if (url.endsWith(`/${personId}/files`)) return pendingFiles;
        if (url.endsWith(`/${personId}/gifts`)) {
          return response({
            debts: [],
            gifts: [],
            status: "ready",
            supportedCurrencyCodes: [],
          });
        }
        if (url.includes(`/${personId}/audit`)) {
          return response({ items: [], status: "ready" });
        }
        if (init?.method === "POST" && url.endsWith(`/${personId}/view`)) {
          return response({ status: "recorded" });
        }
        return Promise.resolve(undefined as never);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const mounting = mountPeopleProfile();
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([resource]) =>
          String(resource).endsWith(`/${personId}/files`)
        ),
      ).toBe(true)
    );
    const states = [...document.querySelectorAll<HTMLElement>(
      ".section-state",
    )];
    expect(states.every((state) => !state.hasAttribute("role"))).toBe(true);

    releaseFiles(response({ files: [], status: "ready" }));
    await mounting;
    expect(states.every((state) => state.getAttribute("role") === "status"))
      .toBe(true);
    expect(
      states.every((state) => state.getAttribute("aria-live") === "polite"),
    )
      .toBe(true);
  });

  it("UXD-002B requests summary and seeds visible and hidden rail counts before fact refresh", async () => {
    markup();
    summaryRailMarkup();
    let releaseContact!: (value: Response) => void;
    const pendingContact = new Promise<Response>((resolve) => {
      releaseContact = resolve;
    });
    const fetchMock = vi.fn(
      (resource: string | URL | Request, init?: RequestInit) => {
        const url = String(resource);
        if (url.endsWith("/api/v1/session")) return response(session);
        if (url === `/api/v1/people/${personId}?include=summary`) {
          return response({
            dueInformation: {
              detail: "No due information.",
              openTaskCount: 0,
              status: "ready",
            },
            person: {
              givenName: "Ada",
              id: personId,
              isDeceased: false,
              isPartial: false,
              isSelf: false,
              isStarred: false,
              tagCount: 0,
              tags: [],
              updatedAt: "2026-08-15T08:00:00.000Z",
            },
            status: "ready",
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
          });
        }
        if (url.includes("/facts/contact-methods")) return pendingContact;
        if (init?.method === "POST" && url.endsWith("/view")) {
          return response({ status: "recorded" });
        }
        return Promise.resolve(undefined as never);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const mounting = mountPeopleProfile();
    await vi.waitFor(() =>
      expect(
        document.querySelector(
          '[data-profile-section="contact-methods"] [data-profile-rail-count]',
        )?.textContent,
      ).toBe("2")
    );
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

    releaseContact(response({
      options: [],
      personUpdatedAt: "2026-08-15T08:00:00.000Z",
      records: [],
      status: "ready",
    }));
    await mounting;
    expect(
      document.querySelector(
        '[data-profile-section="contact-methods"] [data-profile-rail-count]',
      )?.textContent,
    ).toBe("0");
    expect(
      document.querySelector<HTMLElement>(
        '[data-profile-section="contact-methods"]',
      )?.dataset.railEmpty,
    ).toBe("true");
  });

  it("UXD-002A names the breadcrumb and renders honest vital-stat values", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          dueInformation: {
            detail: "1 open task; next reminder tomorrow; stay in touch soon.",
            nextReminderAt: "2026-08-30T09:00:00.000Z",
            openTaskCount: 1,
            status: "ready",
            stayInTouchAt: "2026-09-01T09:00:00.000Z",
          },
          person: {
            familyName: "Lovelace",
            givenName: "Ada",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            lastContactAt: "2026-08-29T09:00:00.000Z",
            nickname: "Enchantress of Numbers",
            tagCount: 0,
            tags: [],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          status: "ready",
        })),
    );

    await mountPeopleProfile();

    expect(document.querySelector("[data-person-breadcrumb-name]")?.textContent)
      .toBe("Ada Lovelace");
    expect(document.querySelector("#person-profile-nickname")?.textContent)
      .toBe("“Enchantress of Numbers”");
    const badges = document.querySelector<HTMLElement>(
      ".person-profile-badges",
    );
    expect(badges?.getAttribute("role")).toBe("group");
    expect(badges?.getAttribute("aria-label")).toBe("Person states");
    const identitySaved = [...badges!.querySelectorAll<HTMLElement>("p")]
      .find((badge) => badge.textContent === "Identity saved");
    expect(identitySaved?.className).toBe("state-badge calm");
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
    let releaseSecondary!: (value: Response) => void;
    const pendingSecondary = new Promise<Response>((resolve) => {
      releaseSecondary = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        dueInformation: {
          detail: "Due information will become available with planning.",
          status: "unavailable",
        },
        person: {
          familyName: "Lovelace",
          givenName: "Ada",
          id: personId,
          isDeceased: false,
          isPartial: true,
          isSelf: false,
          isStarred: false,
          tagCount: 0,
          tags: [],
          updatedAt: "2026-08-15T08:00:00.000Z",
        },
        status: "ready",
      }))
      .mockImplementation((url, init) =>
        init?.method === "POST" && String(url).endsWith("/view")
          ? Promise.reject(new Error("recording unavailable"))
          : pendingSecondary
      );
    vi.stubGlobal("fetch", fetchMock);
    const mounting = mountPeopleProfile();
    await vi.waitFor(() => {
      expect(document.querySelector("#person-profile-name")?.textContent).toBe(
        "Ada Lovelace",
      );
    });
    expect(
      fetchMock.mock.calls.some(([url, init]) =>
        init?.method === "POST" && String(url).endsWith("/view")
      ),
    ).toBe(true);
    releaseSecondary(undefined as never);
    await mounting;
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/v1/people/${personId}?include=summary`,
    );
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
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
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("POST");
  });

  it("PEOPLE-006 hides the visible tag surface for a disabled module", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          dueInformation: {
            detail: "No due information.",
            status: "unavailable",
          },
          person: {
            givenName: "Ada",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            profileSections: [{ id: "tags", status: "hidden" }],
            tagCount: 0,
            tags: [],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          status: "ready",
        })),
    );

    await mountPeopleProfile();
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
    stubReadyProfile();

    await mountPeopleProfile();

    const zones = [...document.querySelectorAll<HTMLElement>("[data-zone]")];
    const all = document.querySelector<HTMLButtonElement>(
      '[data-zone-filter="all"]',
    )!;
    const planning = document.querySelector<HTMLButtonElement>(
      '[data-zone-filter="planning"]',
    )!;
    expect(location.search).toBe("?view=unknown");
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(all.classList.contains("button-primary")).toBe(true);
    expect(zones.every((zone) => !zone.hidden)).toBe(true);

    planning.click();
    expect(new URLSearchParams(location.search).get("view")).toBe("planning");
    expect(planning.getAttribute("aria-pressed")).toBe("true");
    expect(planning.classList.contains("button-primary")).toBe(true);
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
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({
          ...session,
          uiState: { personWorkspaceView: "timeline" },
        }))
        .mockResolvedValueOnce(response(zeroProfile()))
        .mockResolvedValue(undefined as never),
    );

    await mountPeopleProfile();

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
    stubReadyProfile([], {
      ...session,
      uiState: { personWorkspaceView: "timeline" },
    });

    await mountPeopleProfile();

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
    let releaseSession!: (value: Response) => void;
    const pendingSession = new Promise<Response>((resolve) => {
      releaseSession = resolve;
    });
    const fetchMock = vi.fn(
      (resource: string | URL | Request, _init?: RequestInit) => {
        const url = String(resource);
        if (url === "/api/v1/session") return pendingSession;
        if (url === `/api/v1/people/${personId}?include=summary`) {
          return response({
            dueInformation: {
              detail: "No due information.",
              openTaskCount: 0,
              status: "ready",
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
              updatedAt: "2026-08-15T08:00:00.000Z",
            },
            status: "ready",
          });
        }
        return Promise.resolve(undefined as never);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const mounting = mountPeopleProfile();
    document.querySelector<HTMLButtonElement>(
      '[data-zone-filter="planning"]',
    )?.click();
    const earlyState = {
      patchCount:
        fetchMock.mock.calls.filter(([resource, init]) =>
          String(resource) === "/api/v1/member/ui-state" &&
          init?.method === "PATCH"
        ).length,
      planningPressed: document.querySelector(
        '[data-zone-filter="planning"]',
      )?.getAttribute("aria-pressed"),
      search: location.search,
      visibleZones: [...document.querySelectorAll<HTMLElement>("[data-zone]")]
        .filter((zone) => !zone.hidden)
        .map((zone) => zone.dataset.zone),
    };
    releaseSession(response(session));
    await mounting;

    expect(earlyState).toEqual({
      patchCount: 0,
      planningPressed: "true",
      search: "?view=planning",
      visibleZones: ["planning"],
    });
    expect(
      fetchMock.mock.calls.filter(([resource, init]) =>
        String(resource) === "/api/v1/member/ui-state" &&
        init?.method === "PATCH"
      ),
    ).toHaveLength(0);
  });

  it.each([
    ["stored All", { ...session, uiState: { personWorkspaceView: "all" } }],
    ["an absent UI state", session],
  ])(
    "UXD-002C3 leaves a queryless URL untouched for %s",
    async (_name, value) => {
      markup();
      const replaceState = vi.spyOn(history, "replaceState");
      stubReadyProfile([], value);

      await mountPeopleProfile();

      expect(location.search).toBe("");
      expect(replaceState).not.toHaveBeenCalled();
    },
  );

  it("UXD-002C3 persists a selected zone and updates the existing session cache after success", async () => {
    markup();
    stubReadyProfile();
    await mountPeopleProfile();
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
    const postMountFetch = vi.fn(
      (resource: string | URL | Request, init?: RequestInit) =>
        String(resource) === "/api/v1/member/ui-state" &&
          init?.method === "PATCH"
          ? response({
            status: "ready",
            uiState: { personWorkspaceView: "timeline" },
          })
          : Promise.resolve(undefined as never),
    );
    vi.stubGlobal("fetch", postMountFetch);

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
    const patch = postMountFetch.mock.calls.find(([resource, init]) =>
      String(resource) === "/api/v1/member/ui-state" &&
      init?.method === "PATCH"
    );
    expect(patch?.[1]).toMatchObject({
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
    stubReadyProfile();
    await mountPeopleProfile();
    const cached = {
      savedAt: Date.now() - 12_000,
      session: {
        ...session,
        uiState: { personWorkspaceView: "planning" },
      },
    };
    sessionStorage.setItem("kinship.session", JSON.stringify(cached));
    const postMountFetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", postMountFetch);

    document.querySelector<HTMLButtonElement>('[data-zone-filter="all"]')
      ?.click();
    await vi.waitFor(() => expect(postMountFetch).toHaveBeenCalledTimes(1));

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
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response(zeroProfile()))
        .mockResolvedValue(undefined as never),
    );

    await mountPeopleProfile();

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
      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce(response(session))
          .mockResolvedValueOnce(response(value))
          .mockResolvedValue(undefined as never),
      );

      await mountPeopleProfile();

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
      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce(response(session))
          .mockResolvedValueOnce(response(zeroProfile()))
          .mockResolvedValue(undefined as never),
      );
      await mountPeopleProfile();

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
    let releaseReminders!: (value: Response) => void;
    const reminders = new Promise<Response>((resolve) => {
      releaseReminders = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response(zeroProfile()))
      .mockImplementation((url) =>
        String(url).includes(`/people/${firstRunPersonId}/reminders`)
          ? reminders
          : Promise.resolve(response({ status: "recorded" }))
      );
    vi.stubGlobal("fetch", fetchMock);

    const mounting = mountPeopleProfile();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    for (
      const action of document.querySelectorAll<HTMLButtonElement>(
        "[data-first-run-action]",
      )
    ) action.click();
    expect(firstMeetingClick).not.toHaveBeenCalled();
    expect(birthdayClick).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(controls.cadence);

    controls.firstMeeting.hidden = false;
    controls.birthday.hidden = false;
    releaseReminders(
      response({ cadences: [], reminders: [], status: "ready" }),
    );
    await mounting;
    await vi.waitFor(() => expect(firstMeetingClick).toHaveBeenCalledOnce());
    expect(birthdayClick).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(controls.cadence);
  });

  it("UXD-005B never clicks a hidden or disabled first-action control", async () => {
    markup(`/app/people/${firstRunPersonId}`);
    const controls = firstRunActionMarkup();
    const firstMeetingClick = vi.fn();
    const birthdayClick = vi.fn();
    controls.firstMeeting.addEventListener("click", firstMeetingClick);
    controls.birthday.addEventListener("click", birthdayClick);
    controls.birthday.hidden = false;
    controls.birthday.disabled = true;
    controls.cadence.disabled = true;
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response(zeroProfile()))
        .mockImplementation((url) =>
          String(url).includes(`/people/${firstRunPersonId}/reminders`)
            ? Promise.resolve(
              response({ cadences: [], reminders: [], status: "ready" }),
            )
            : Promise.resolve(response({ status: "recorded" }))
        ),
    );
    await mountPeopleProfile();

    for (
      const action of document.querySelectorAll<HTMLButtonElement>(
        "[data-first-run-action]",
      )
    ) action.click();
    await Promise.resolve();
    expect(firstMeetingClick).not.toHaveBeenCalled();
    expect(birthdayClick).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(controls.cadence);
  });

  it("PRF-001 aligns the shared navigator only when opening its directory", async () => {
    markup();
    stubReadyProfile();
    const navigation = document.querySelector("#person-profile-sections")!;
    const container = document.createElement("div");
    container.className = "person-workspace-navigation";
    const directory = document.createElement("details");
    navigation.replaceWith(container);
    container.append(directory);
    directory.append(navigation);
    const scroll = vi.fn();
    container.scrollIntoView = scroll;

    await mountPeopleProfile();
    directory.open = true;
    directory.dispatchEvent(new Event("toggle"));
    expect(scroll).toHaveBeenCalledWith({
      block: "start",
      behavior: "instant",
    });
    scroll.mockClear();
    directory.open = false;
    directory.dispatchEvent(new Event("toggle"));
    expect(scroll).not.toHaveBeenCalled();
  });

  it("PRF-001 closes the section directory before focusing the selected block", async () => {
    markup();
    stubReadyProfile();
    const navigation = document.querySelector("#person-profile-sections")!;
    const directory = document.createElement("details");
    directory.open = true;
    navigation.replaceWith(directory);
    directory.append(navigation);

    await mountPeopleProfile();
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
    stubReadyProfile();
    const pushState = vi.spyOn(history, "pushState");

    await mountPeopleProfile();

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
    stubReadyProfile();
    const pushState = vi.spyOn(history, "pushState");

    await mountPeopleProfile();
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

  it("UXD-002A2 toggles and closes the person menu and reveals Admin from Audit history", async () => {
    markup();
    stubReadyProfile();

    await mountPeopleProfile();

    const toggle = document.querySelector<HTMLButtonElement>(
      "#person-menu-toggle",
    )!;
    const menu = document.querySelector<HTMLElement>("#person-menu")!;
    expect(menu.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    toggle.click();
    expect(menu.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    toggle.click();
    expect(menu.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    toggle.click();
    document.querySelector<HTMLButtonElement>("#person-edit-open")?.click();
    expect(menu.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector<HTMLFormElement>("#person-edit-form")?.hidden)
      .toBe(false);
    expect(document.activeElement).toBe(
      document.querySelector<HTMLInputElement>(
        '#person-edit-form input[name="givenName"]',
      ),
    );

    toggle.click();
    const auditHistory = document.querySelector<HTMLButtonElement>(
      "#person-audit-history",
    )!;
    auditHistory.click();
    expect(menu.hidden).toBe(true);
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
    expect(auditHistory.closest("a")).toBeNull();
  });

  it("UXD-002C does not write history while popstate restores a section", async () => {
    markup();
    stubReadyProfile();
    await mountPeopleProfile();
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
    stubReadyProfile();
    const pushState = vi.spyOn(history, "pushState");
    const replaceState = vi.spyOn(history, "replaceState");

    await mountPeopleProfile();

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
    stubReadyProfile();

    await mountPeopleProfile();

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

    await mountPeopleProfile();

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
    stubReadyProfile();

    await mountPeopleProfile();

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
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          dueInformation: {
            detail: "Due information will become available with planning.",
            status: "unavailable",
          },
          person: {
            description: "Mathematician and correspondent.",
            familyName: "Lovelace",
            gender: "Woman",
            givenName: "Ada",
            id: personId,
            isDeceased: true,
            isPartial: false,
            isSelf: false,
            isStarred: true,
            lastContactAt: "2026-08-14T08:00:00.000Z",
            profileSections: [{ id: "documents", status: "ready" }],
            tagCount: 2,
            tags: [{
              id: "00000000-0000-4000-8000-000000000230",
              name: "Mathematics",
            }],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          status: "ready",
        })),
    );

    await mountPeopleProfile();

    expect(document.querySelector("[data-profile-description]")?.textContent)
      .toBe("Mathematician and correspondent.");
    expect(
      document.querySelector<HTMLElement>("#person-profile-favorite")?.hidden,
    ).toBe(false);
    expect(
      document.querySelector<HTMLElement>("#person-profile-deceased")?.hidden,
    ).toBe(false);
    expect(document.querySelector("#person-profile-due-state")?.textContent)
      .toContain("planning");
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
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          dueInformation: {
            detail: "No due information.",
            openTaskCount: 0,
            status: "ready",
          },
          person: {
            familyName: "Lovelace",
            givenName: "Ada",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            tagCount: 0,
            tags: [],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          status: "ready",
        })),
    );

    await mountPeopleProfile();

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
    let releaseSecondary!: (value: Response) => void;
    const pendingSecondary = new Promise<Response>((resolve) => {
      releaseSecondary = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({
          ...session,
          member: { ...session.member, role: "admin" },
        }))
        .mockResolvedValueOnce(response({
          dueInformation: {
            detail: "No due information.",
            status: "unavailable",
          },
          person: {
            givenName: "Ada",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            profileSections: [{ id: "documents", status: "hidden" }],
            tagCount: 1,
            tags: [{
              id: "00000000-0000-4000-8000-000000000230",
              name: "Friend",
            }],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          status: "ready",
        }))
        .mockImplementation((url, init) =>
          init?.method === "POST" && String(url).endsWith("/view")
            ? Promise.resolve(response({ status: "recorded" }))
            : pendingSecondary
        ),
    );

    const mounting = mountPeopleProfile();
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
      "Documents — turned off for this workspace.",
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
    releaseSecondary(undefined as never);
    await mounting;
    expect(document.activeElement).toBe(personalization);
  });

  it("UXD-006 does not describe a DOM-hidden visible module as turned off", async () => {
    markup(`/app/people/${personId}?section=documents`);
    reminderSectionMarkup();
    document.querySelector<HTMLElement>(
      '[data-profile-section="documents"]',
    )!.hidden = true;
    let resolveAudit!: (response: Response) => void;
    const delayedAudit = new Promise<Response>((resolve) => {
      resolveAudit = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          dueInformation: {
            detail: "No due information.",
            status: "unavailable",
          },
          person: {
            givenName: "Ada",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            profileSections: [{ id: "documents", status: "ready" }],
            tagCount: 0,
            tags: [],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          status: "ready",
        }))
        .mockImplementation((url, init) => {
          if (init?.method === "POST" && String(url).endsWith("/view")) {
            return Promise.resolve(response({ status: "recorded" }));
          }
          return String(url).includes("/audit")
            ? delayedAudit
            : Promise.resolve(undefined as never);
        }),
    );

    const mounting = mountPeopleProfile();
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
    resolveAudit(response({ items: [], status: "ready" }));
    await mounting;
    expect(document.activeElement).toBe(edit);
    expect(notice?.hidden).toBe(true);
  });

  it("PLANNING-002 does not steal reminder form focus after delayed profile reconciliation", async () => {
    markup(`/app/people/${personId}?section=reminders`);
    reminderSectionMarkup();
    let resolveReminders!: (response: Response) => void;
    const delayedReminders = new Promise<Response>((resolve) => {
      resolveReminders = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          dueInformation: {
            detail: "No due information.",
            status: "unavailable",
          },
          person: {
            givenName: "Ada",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            tagCount: 0,
            tags: [],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          status: "ready",
        }))
        .mockImplementation((url, init) => {
          if (init?.method === "POST" && String(url).endsWith("/view")) {
            return Promise.resolve(response({ status: "recorded" }));
          }
          return String(url).includes("/audit")
            ? delayedReminders
            : Promise.resolve(undefined as never);
        }),
    );

    const mounting = mountPeopleProfile();
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
    resolveReminders(response({
      items: [],
      status: "ready",
    }));
    await mounting;

    expect(document.activeElement).toBe(title);
    expect(title.value).toBe("Keep this draft");
  });

  it("[APP-003C] reconciles queryless and invalid section history", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          dueInformation: {
            detail: "Due information will become available with planning.",
            status: "unavailable",
          },
          person: {
            familyName: "Lovelace",
            givenName: "Ada",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            tagCount: 0,
            tags: [],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          status: "ready",
        })),
    );

    await mountPeopleProfile();
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
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          dueInformation: {
            detail: "No due information.",
            status: "unavailable",
          },
          person: {
            givenName: "Ada",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            profileSections: [
              { id: "activities", status: "hidden" },
              { id: "notes", status: "hidden" },
            ],
            tagCount: 0,
            tags: [],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          status: "ready",
        })),
    );

    await mountPeopleProfile();
    const notice = document.querySelector<HTMLElement>(
      "#person-profile-section-notice",
    );
    expect(document.activeElement).toBe(notice);
    expect(notice?.textContent).toContain(
      "Activities — turned off for this workspace.",
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
      "Notes — turned off for this workspace.",
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

  it("renders explicit not-found, forbidden, and unavailable states", async () => {
    for (
      const state of [
        { heading: "Person not found", status: 404 },
        { heading: "Person unavailable", status: 403 },
        { heading: "Person temporarily unavailable", status: 503 },
      ]
    ) {
      markup();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(
          response({ status: state.status }, state.status),
        );
      vi.stubGlobal(
        "fetch",
        fetchMock,
      );
      await mountPeopleProfile();
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
      expect(
        fetchMock.mock.calls.some(([url, init]) =>
          init?.method === "POST" && String(url).endsWith("/view")
        ),
      ).toBe(false);
    }

    markup("/app/people/not-a-person");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mountPeopleProfile();
    expect(document.querySelector("#person-profile-state h1")?.textContent)
      .toBe("Person not found");
    expect(fetchMock).not.toHaveBeenCalled();

    document.body.innerHTML = "<main></main>";
    await expect(mountPeopleProfile()).resolves.toBeUndefined();
  });

  it("distinguishes an archived canonical person as read-only", async () => {
    markup(`/app/people/${personId}?section=identity-summary`);
    document.querySelector("#person-profile-ready")?.insertAdjacentHTML(
      "beforeend",
      '<section data-profile-section="pets"><span data-profile-rail-count hidden></span></section>',
    );
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        dueInformation: {
          detail: "Due information will become available with planning.",
          status: "unavailable",
        },
        person: {
          givenName: "Harriet",
          id: personId,
          isDeceased: false,
          isPartial: false,
          isSelf: false,
          isStarred: false,
          tagCount: 0,
          tags: [],
          updatedAt: "2026-08-15T08:00:00.000Z",
        },
        status: "archived",
        summary: {
          primaryContactMethods: [],
          relationshipCounts: [],
          sectionCounts: [{ count: 0, id: "pets", status: "ready" }],
        },
      }));
    vi.stubGlobal(
      "fetch",
      fetchMock,
    );
    await mountPeopleProfile();
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
    expect(
      fetchMock.mock.calls.some(([url, init]) =>
        init?.method === "POST" && String(url).endsWith("/view")
      ),
    ).toBe(true);
    expect(
      document.querySelector<HTMLElement>('[data-profile-section="pets"]')
        ?.dataset.railEmpty,
    ).toBe("true");
  });

  it("[PEOPLE-004] edits, archives, restores, and cancels explicit deletion", async () => {
    markup();
    const initial = {
      dueInformation: { detail: "No due information.", status: "unavailable" },
      person: {
        familyName: "Lovelace",
        givenName: "Ada",
        id: personId,
        isDeceased: false,
        isPartial: false,
        isSelf: false,
        isStarred: false,
        tagCount: 0,
        tags: [],
        updatedAt: "2026-08-15T08:00:00.000Z",
      },
      status: "ready",
    };
    const edited = {
      familyName: "Byron",
      givenName: "Ada",
      id: personId,
      isPartial: false,
      lifecycle: "active",
      updatedAt: "2026-08-15T09:00:00.000Z",
    };
    const archived = {
      ...edited,
      lifecycle: "archived",
      updatedAt: "2026-08-15T10:00:00.000Z",
    };
    const restored = {
      ...edited,
      updatedAt: "2026-08-15T11:00:00.000Z",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response(initial))
      .mockResolvedValueOnce(response({ status: "recorded" }))
      .mockResolvedValueOnce(response({ person: edited, status: "updated" }))
      .mockResolvedValueOnce(response({ person: archived, status: "archived" }))
      .mockResolvedValueOnce(response({ person: restored, status: "restored" }))
      .mockResolvedValueOnce(response({
        impact: {
          confirmation: "DELETE Ada Byron",
          dependentRecordPolicy: "retained",
          person: restored,
        },
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);
    const lifecycleEvents: unknown[] = [];
    const recordLifecycle = (event: Event) =>
      lifecycleEvents.push((event as CustomEvent).detail);
    document.addEventListener("person-lifecycle-changed", recordLifecycle);
    await mountPeopleProfile();

    document.querySelector<HTMLButtonElement>("#person-menu-toggle")?.click();
    document.querySelector<HTMLButtonElement>("#person-edit-open")?.click();
    const editForm = document.querySelector<HTMLFormElement>(
      "#person-edit-form",
    )!;
    (editForm.elements.namedItem("familyName") as HTMLInputElement).value =
      "Byron";
    editForm.requestSubmit();
    await vi.waitFor(() =>
      expect(document.querySelector("#person-profile-name")?.textContent)
        .toBe("Ada Byron")
    );
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe("PATCH");

    const factRevision = "2026-08-15T09:00:00.000001Z";
    document.dispatchEvent(
      new CustomEvent("person-revision-changed", {
        detail: { personUpdatedAt: factRevision },
      }),
    );
    document.querySelector<HTMLButtonElement>("#person-menu-toggle")?.click();
    document.querySelector<HTMLButtonElement>("#person-archive")?.click();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLElement>("#person-restore")?.hidden)
        .toBe(false)
    );
    expect(
      document.querySelector<HTMLElement>("[data-person-archived-banner]")
        ?.hidden,
    ).toBe(false);
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({
      expectedUpdatedAt: factRevision,
    });
    expect(document.querySelector<HTMLElement>("#person-edit-open")?.hidden)
      .toBe(true);
    document.querySelector<HTMLButtonElement>("#person-menu-toggle")?.click();
    expect(document.querySelector<HTMLElement>("#person-menu")?.hidden).toBe(
      false,
    );
    expect(document.querySelector<HTMLElement>("#person-archive")?.hidden)
      .toBe(true);
    const controlsNamed = (name: string) =>
      [...document.querySelectorAll<HTMLElement>("button, a")].filter(
        (control) => control.textContent?.trim() === name,
      );
    for (
      const name of [
        "Edit person",
        "Archive person",
        "Restore person",
        "Delete person",
      ]
    ) {
      expect(controlsNamed(name)).toHaveLength(1);
    }
    expect(document.querySelector("#person-menu #person-restore")).toBeNull();
    expect(lifecycleEvents[0]).toEqual({
      archived: true,
      personId,
      personUpdatedAt: archived.updatedAt,
      state: "archived",
    });
    expect(document.querySelector("#app-toasts")?.textContent).toContain(
      "Person archived. They now appear in Archived people.",
    );
    const undo = document.querySelector<HTMLButtonElement>(
      "#app-toasts .app-toast-action",
    )!;
    expect(undo.textContent).toBe("Undo");
    undo.click();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLElement>("#person-edit-open")?.hidden)
        .toBe(false)
    );
    expect(fetchMock.mock.calls[5]?.[0]).toBe(
      `/api/v1/people/${personId}/restore`,
    );
    expect(
      document.querySelector<HTMLElement>("[data-person-archived-banner]")
        ?.hidden,
    ).toBe(true);
    expect(document.querySelector("#app-toasts")?.textContent).toContain(
      "Person restored. They now appear in People.",
    );
    expect(document.querySelector("#app-toasts .app-toast-action")).toBeNull();
    expect(lifecycleEvents[1]).toEqual({
      archived: false,
      personId,
      personUpdatedAt: restored.updatedAt,
      state: "active",
    });
    document.removeEventListener("person-lifecycle-changed", recordLifecycle);

    document.querySelector<HTMLButtonElement>("#person-delete-open")?.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#person-delete-impact")?.textContent)
        .toContain("Related records are retained")
    );
    document.querySelector<HTMLButtonElement>("#person-delete-cancel")?.click();
    expect(
      document.querySelector<HTMLDialogElement>("#person-delete-dialog")?.open,
    )
      .toBe(false);
    expect(document.activeElement).toBe(
      document.querySelector("#person-delete-open"),
    );
    expect(document.querySelector<HTMLElement>("#person-menu")?.hidden).toBe(
      false,
    );
    expect(document.querySelector("#person-lifecycle-status")?.textContent)
      .toContain("cancelled");
  });

  it("[PEOPLE-004] opens a native modal and Escape cancels without deleting", async () => {
    markup();
    const initial = {
      dueInformation: { detail: "No due information.", status: "unavailable" },
      person: {
        familyName: "Lovelace",
        givenName: "Ada",
        id: personId,
        isDeceased: false,
        isPartial: false,
        isSelf: false,
        isStarred: false,
        tagCount: 0,
        tags: [],
        updatedAt: "2026-08-15T08:00:00.000Z",
      },
      status: "ready",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response(initial))
      .mockResolvedValueOnce(response({ status: "recorded" }))
      .mockResolvedValueOnce(response({
        impact: {
          confirmation: "DELETE Ada Lovelace",
          dependentRecordPolicy: "retained",
          person: initial.person,
        },
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);
    await mountPeopleProfile();

    const trigger = document.querySelector<HTMLButtonElement>(
      "#person-delete-open",
    )!;
    trigger.focus();
    trigger.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#person-delete-impact")?.textContent)
        .toContain("Related records are retained")
    );
    const dialog = document.querySelector<HTMLDialogElement>(
      "#person-delete-dialog",
    )!;
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(
      document.querySelector("#person-delete-confirmation"),
    );
    const confirmation = document.querySelector<HTMLInputElement>(
      "#person-delete-confirmation",
    )!;
    confirmation.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Tab",
        shiftKey: true,
      }),
    );
    const cancelButton = document.querySelector<HTMLButtonElement>(
      "#person-delete-cancel",
    )!;
    expect(document.activeElement).toBe(cancelButton);
    cancelButton.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Tab",
      }),
    );
    expect(document.activeElement).toBe(confirmation);

    const cancel = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    ).toHaveLength(0);
  });

  it("[PEOPLE-004] keeps lifecycle failures recoverable in the profile shell", async () => {
    markup();
    const initial = {
      dueInformation: { detail: "No due information.", status: "unavailable" },
      person: {
        familyName: "Lovelace",
        givenName: "Ada",
        id: personId,
        isDeceased: false,
        isPartial: false,
        isSelf: false,
        isStarred: false,
        tagCount: 0,
        tags: [],
        updatedAt: "2026-08-15T08:00:00.000Z",
      },
      status: "ready",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response(initial))
      .mockResolvedValueOnce(response({ status: "recorded" }))
      .mockResolvedValueOnce(response({
        detail: "This person changed elsewhere. Reload and try again.",
        status: 409,
        title: "Person changed",
        type: "https://kinship.test/problems/person-stale",
      }, 409))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response({
        detail: "Deletion impact could not be loaded.",
        status: 503,
        title: "Temporarily unavailable",
        type: "https://kinship.test/problems/dependency-unavailable",
      }, 503));
    vi.stubGlobal("fetch", fetchMock);
    await mountPeopleProfile();

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
