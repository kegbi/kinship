// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPeopleProfile } from "./people-profile.ts";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

const workspaceId = "00000000-0000-4000-8000-000000000003";
const personId = "00000000-0000-4000-8000-000000000100";
const session = {
  member: { id: "member", role: "member" },
  principal: { userId: "user" },
  status: "authenticated",
  workspace: { id: workspaceId, name: "Circle" },
  workspaces: [{ id: workspaceId, name: "Circle" }],
};

function markup(path = `/app/people/${personId}`): void {
  history.replaceState({}, "", path);
  document.body.innerHTML = `
    <section id="person-profile-state" tabindex="-1"><h1>Opening person…</h1></section>
    <section id="person-profile-ready" hidden>
      <h1 id="person-profile-name" tabindex="-1"></h1>
      <div id="person-profile-avatar"></div>
      <p id="person-profile-archived" hidden></p>
      <p id="person-profile-partial" hidden></p>
      <p id="person-profile-favorite" hidden></p>
      <p id="person-profile-deceased" hidden></p>
      <p id="person-profile-self" hidden></p>
      <p data-profile-description></p>
      <ul id="person-profile-tags"></ul>
      <span data-profile-field="givenName"></span>
      <span data-profile-field="middleName"></span>
      <span data-profile-field="familyName"></span>
      <span data-profile-field="nickname"></span>
      <p id="person-profile-due-state"></p>
      <button id="person-edit-open" type="button">Edit person</button>
      <button id="person-archive" type="button">Archive person</button>
      <button id="person-restore" type="button" hidden>Restore person</button>
      <button id="person-delete-open" type="button">Delete person</button>
      <p id="person-lifecycle-status"></p>
      <form id="person-edit-form" hidden>
        <input name="givenName"><input name="middleName"><input name="familyName"><input name="nickname"><input name="isPartial" type="checkbox">
        <button type="submit">Save person</button><button id="person-edit-cancel" type="button">Cancel edit</button>
      </form>
      <dialog id="person-delete-dialog">
        <form id="person-delete-form">
          <p id="person-delete-impact"></p><input id="person-delete-confirmation">
          <button type="submit">Confirm delete</button><button id="person-delete-cancel" type="button">Cancel delete</button>
        </form>
      </dialog>
      <nav id="person-profile-sections">
        <a href="?section=important-dates" data-section-link="important-dates">Important dates</a>
        <a href="?section=documents" data-section-link="documents">Documents</a>
        <a href="?section=photos" data-section-link="photos">Photos</a>
      </nav>
      <section id="profile-section-important-dates" data-profile-section="important-dates" tabindex="-1"><h2>Important dates</h2></section>
      <section id="profile-section-documents" data-profile-section="documents" data-load-mode="independent" tabindex="-1"><h2>Documents</h2></section>
      <section id="profile-section-photos" data-profile-section="photos" data-load-mode="independent" tabindex="-1"><h2>Photos</h2></section>
    </section>`;
}

function interactionSectionMarkup(): void {
  document.querySelector("#person-profile-sections")?.insertAdjacentHTML(
    "beforeend",
    `<li><a href="?section=activities" data-section-link="activities">Activities</a></li>
     <li><a href="?section=notes" data-section-link="notes">Notes</a></li>`,
  );
  document.querySelector("#person-profile-ready")?.insertAdjacentHTML(
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

function reminderSectionMarkup(): void {
  document.querySelector("#person-profile-sections")?.insertAdjacentHTML(
    "beforeend",
    `<a href="?section=reminders" data-section-link="reminders">Reminders</a>`,
  );
  document.querySelector("#person-profile-ready")?.insertAdjacentHTML(
    "beforeend",
    `<section data-profile-section="reminders" tabindex="-1">
       <form data-reminder-form>
         <input name="title"><button type="submit">Save reminder</button>
       </form>
     </section>
     <section data-person-audit-summary>
       <p data-person-audit-state></p><span data-person-audit-badge></span>
       <ol data-person-audit-list></ol><a data-person-audit-link></a>
       <button data-person-audit-retry type="button">Retry audit</button>
     </section>`,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
  document.body.innerHTML = "";
});

describe("PEOPLE-001 canonical person identity shell", () => {
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
      expect(
        document.querySelector<HTMLElement>("#person-profile-ready")?.hidden,
      )
        .toBe(false);
    });
    expect(
      fetchMock.mock.calls.some(([url, init]) =>
        init?.method === "POST" && String(url).endsWith("/view")
      ),
    ).toBe(true);
    releaseSecondary(undefined as never);
    await mounting;
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/v1/people/${personId}`,
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
            givenName: "Ada",
            id: personId,
            isDeceased: true,
            isPartial: false,
            isSelf: false,
            isStarred: true,
            tagCount: 0,
            tags: [],
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
    expect(document.activeElement).toBe(
      document.querySelector("#profile-section-documents"),
    );

    document.querySelector<HTMLAnchorElement>(
      '[data-section-link="photos"]',
    )?.click();
    expect(location.search).toBe("?section=photos");
    expect(document.activeElement).toBe(
      document.querySelector("#profile-section-photos"),
    );
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
      expect(document.querySelector("[data-person-audit-state]")?.textContent)
        .toContain("Loading")
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
    expect(location.search).toBe("?section=photos");
    expect(photos?.getAttribute("aria-current")).toBe("location");

    history.back();
    await vi.waitFor(() => expect(location.search).toBe(""));
    expect(document.querySelectorAll("[data-section-link][aria-current]"))
      .toHaveLength(0);
    expect(document.activeElement).toBe(heading);

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
  });

  it("INTERACTION-001 reconciles hidden interaction deep links before initial and history focus", async () => {
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
    const heading = document.querySelector("#person-profile-name");
    expect(document.activeElement).toBe(heading);
    expect(document.querySelectorAll("[data-section-link][aria-current]"))
      .toHaveLength(0);

    history.pushState({}, "", `?section=notes`);
    history.pushState({}, "", `?section=documents`);
    globalThis.dispatchEvent(new PopStateEvent("popstate"));
    expect(document.activeElement).toBe(
      document.querySelector('[data-profile-section="documents"]'),
    );
    history.back();
    await vi.waitFor(() => expect(location.search).toBe("?section=notes"));
    expect(document.activeElement).toBe(heading);
    expect(document.querySelectorAll("[data-section-link][aria-current]"))
      .toHaveLength(0);
    history.forward();
    await vi.waitFor(() => expect(location.search).toBe("?section=documents"));
    expect(document.activeElement).toBe(
      document.querySelector('[data-profile-section="documents"]'),
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
    markup();
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
    expect(
      fetchMock.mock.calls.some(([url, init]) =>
        init?.method === "POST" && String(url).endsWith("/view")
      ),
    ).toBe(true);
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
    document.querySelector<HTMLButtonElement>("#person-archive")?.click();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLElement>("#person-restore")?.hidden)
        .toBe(false)
    );
    expect(JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body))).toEqual({
      expectedUpdatedAt: factRevision,
    });
    expect(document.querySelector<HTMLElement>("#person-edit-open")?.hidden)
      .toBe(true);
    expect(lifecycleEvents[0]).toEqual({
      archived: true,
      personId,
      personUpdatedAt: archived.updatedAt,
      state: "archived",
    });
    document.querySelector<HTMLButtonElement>("#person-restore")?.click();
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLElement>("#person-edit-open")?.hidden)
        .toBe(false)
    );
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
