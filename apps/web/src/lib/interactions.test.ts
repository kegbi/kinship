// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mountActivityReport,
  mountInteractionCapture,
  mountPersonInteractions,
  mountTodayInteractions,
} from "./interactions.ts";

import { getMemberPreferences } from "../../../../packages/contracts/generated/auth-client.ts";

vi.mock(
  "../../../../packages/contracts/generated/auth-client.ts",
  async (original) => ({
    ...await original<Record<string, unknown>>(),
    getMemberPreferences: vi.fn(),
  }),
);

beforeEach(() => {
  vi.mocked(getMemberPreferences).mockReset().mockResolvedValue({
    ok: true,
    value: {
      status: "ready",
      preferences: {
        effectiveTimezone: "UTC",
        contactNameOrder: "given_family_nickname",
        contactSortOrder: "given_name_asc",
        fluidLayout: false,
        locale: "en",
        measurementSystem: "metric",
        temperatureScale: "celsius",
      },
    },
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

const workspaceId = "00000000-0000-4000-8000-000000000003";
const personId = "00000000-0000-4000-8000-000000000100";
const otherId = "00000000-0000-4000-8000-000000000101";

function session() {
  return {
    member: { id: "member", role: "member" },
    principal: { userId: "user" },
    status: "authenticated",
    workspace: { id: workspaceId, name: "Circle" },
    workspaces: [{ id: workspaceId, name: "Circle" }],
  };
}

function captureMarkup(): void {
  document.body.innerHTML = `
    <button data-quick-capture data-interaction-intended-kind="activity" type="button">Log activity</button>
    <button data-quick-capture data-interaction-intended-kind="note" type="button">Add note</button>
    <dialog id="interaction-capture-dialog">
      <form id="interaction-capture-form">
        <select name="kind"><option value="activity">Activity</option><option value="note">Note</option></select>
        <input name="participantSearch" type="search">
        <select name="participantIds" multiple></select>
        <button data-participants-more type="button" hidden>More people</button>
        <label data-interaction-occurrence><input name="happenedAt" type="datetime-local" required aria-describedby="interaction-happened-at-error"></label>
        <small id="interaction-happened-at-error"></small>
        <div data-interaction-kind="activity">
          <input name="summary"><textarea name="description"></textarea>
          <input name="activityTypeSearch" type="search"><input name="emotionSearch" type="search">
          <select name="activityTypeId"></select><select name="emotionIds" multiple></select>
          <button data-activity-types-more type="button" hidden>More types</button>
          <button data-emotions-more type="button" hidden>More emotions</button>
        </div>
        <div data-interaction-kind="note" hidden>
          <textarea name="body"></textarea><input name="isFavorited" type="checkbox">
        </div>
        <p id="interaction-capture-status" role="status" aria-live="polite"></p>
        <button type="submit">Save interaction</button>
        <button data-interaction-cancel type="button">Cancel</button>
      </form>
    </dialog>`;
}

function readyPeople() {
  return response({
    lifecycle: "active",
    people: [{
      givenName: "Ada",
      id: personId,
      isPartial: false,
      isStarred: false,
      lifecycle: "active",
      tagCount: 0,
      tags: [],
    }],
    status: "ready",
  });
}

function readyInteractionOptions() {
  return response({
    activityTypes: [],
    availability: { activity: true, note: true },
    emotions: [],
    status: "ready",
  });
}

it("APR-008 applies saved name order to initial and searched capture participants", async () => {
  captureMarkup();
  vi.mocked(getMemberPreferences).mockResolvedValue({
    ok: true,
    value: {
      status: "ready",
      preferences: {
        effectiveTimezone: "UTC",
        contactNameOrder: "family_given_nickname",
        contactSortOrder: "family_name_asc",
        fluidLayout: false,
        locale: "en",
        measurementSystem: "metric",
        temperatureScale: "celsius",
      },
    },
  });
  const fetchMock = vi.fn().mockResolvedValueOnce(response(session()))
    .mockResolvedValueOnce(
      response({
        status: "ready",
        people: [{
          ...selectedDirectoryPerson(),
          givenName: "Grace",
          familyName: "Hopper",
        }],
      }),
    )
    .mockResolvedValueOnce(readyInteractionOptions());
  vi.stubGlobal("fetch", fetchMock);
  await mountInteractionCapture();
  await openReadyCapture("[data-quick-capture]");
  expect(document.querySelector('[name="participantIds"] option')?.textContent)
    .toBe("Hopper Grace");
  fetchMock.mockResolvedValueOnce(
    response({
      status: "ready",
      people: [{
        ...selectedDirectoryPerson(personId),
        givenName: "Ada",
        familyName: "Lovelace",
      }],
    }),
  );
  const search = document.querySelector<HTMLInputElement>(
    '[name="participantSearch"]',
  )!;
  search.value = "Ada";
  search.dispatchEvent(new Event("change"));
  await vi.waitFor(() =>
    expect(document.querySelector('[name="participantIds"]')?.textContent)
      .toContain("Lovelace Ada")
  );
  expect(getMemberPreferences).toHaveBeenCalledWith(workspaceId);
});

function selectedDirectoryPerson(
  id = otherId,
  lifecycle: "active" | "archived" = "active",
) {
  return {
    givenName: id === otherId ? "Grace" : "Ada",
    id,
    isPartial: false,
    isStarred: false,
    lifecycle,
    tagCount: 0,
    tags: [],
  };
}

function reconnectOpener(id = otherId): HTMLButtonElement {
  const opener = document.createElement("button");
  opener.type = "button";
  opener.disabled = true;
  opener.dataset.quickCapture = "";
  opener.dataset.todayReconnectCapture = "";
  opener.dataset.interactionIntendedKind = "activity";
  opener.dataset.interactionPersonId = id;
  opener.textContent = "Log interaction";
  document.body.append(opener);
  return opener;
}

function savedActivity(status = 201) {
  return response({
    record: {
      emotions: [],
      happenedAt: "2026-08-16T18:15:00.000Z",
      id: "activity",
      kind: "activity",
      participants: [{ id: personId, name: "Ada" }],
      summary: "Immutable intent",
    },
    status: "created",
  }, status);
}

async function prepareActivityCapture(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  await mountInteractionCapture();
  const form = document.querySelector<HTMLFormElement>(
    "#interaction-capture-form",
  )!;
  await openReadyCapture('[data-interaction-intended-kind="activity"]');
  (form.elements.namedItem("participantIds") as HTMLSelectElement).options[0]!
    .selected = true;
  (form.elements.namedItem("happenedAt") as HTMLInputElement).value =
    "2026-08-16T18:15";
  (form.elements.namedItem("summary") as HTMLInputElement).value =
    "Immutable intent";
  return form;
}

async function openReadyCapture(selector: string): Promise<void> {
  document.querySelector<HTMLButtonElement>(selector)!.click();
  const form = document.querySelector<HTMLFormElement>(
    "#interaction-capture-form",
  )!;
  await vi.waitFor(() => {
    expect(form.hasAttribute("aria-busy")).toBe(false);
    expect(
      form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
    ).toBe(false);
  });
}

function todayMarkup(): void {
  document.body.innerHTML = `
    <section id="today-favorite-notes-region" aria-labelledby="favorite-notes-heading">
      <h2 id="favorite-notes-heading">Favorite notes</h2>
      <p id="today-favorite-notes-state" aria-live="polite"></p>
      <ul id="today-favorite-notes"></ul>
      <button id="today-favorite-notes-retry" type="button" hidden>Retry favorite notes</button>
    </section>
    <section id="today-recent-activity-region" aria-labelledby="activity-heading">
      <h2 id="activity-heading">Recent activity</h2>
      <p id="today-recent-activity-state" aria-live="polite"></p>
      <ul id="today-recent-activity"></ul>
      <button id="today-recent-activity-retry" type="button" hidden>Retry recent activity</button>
    </section>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  void mountTodayInteractions();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
});

describe("INTERACTION-001 browser behavior", () => {
  it("does nothing when an interaction projection is absent from the page", async () => {
    document.body.innerHTML = "";
    await mountInteractionCapture();
    await mountTodayInteractions();
    await mountActivityReport();
    await mountPersonInteractions(personId, workspaceId, false, {
      activities: false,
      notes: false,
    });
    expect(document.body.textContent).toBe("");
  });

  it("refreshes only Recent for activity and both Today projections for note, including during initial load", async () => {
    todayMarkup();
    const favoriteInitial = deferred<Response>();
    const recentInitial = deferred<Response>();
    let favoriteCalls = 0;
    let recentCalls = 0;
    const item = (kind: "activity" | "note", label: string) =>
      kind === "activity"
        ? {
          emotions: [],
          happenedAt: "2026-08-22T10:00:00.000Z",
          id: crypto.randomUUID(),
          kind,
          participants: [{ id: personId, name: "Ada" }],
          summary: label,
        }
        : {
          body: label,
          createdAt: "2026-08-22T10:00:00.000Z",
          id: crypto.randomUUID(),
          isFavorited: true,
          kind,
          participants: [{ id: personId, name: "Ada" }],
        };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path.endsWith("/session")) {
          return Promise.resolve(response(session()));
        }
        if (path.endsWith("/favorite-notes")) {
          favoriteCalls += 1;
          return favoriteCalls === 1
            ? favoriteInitial.promise
            : Promise.resolve(response({
              items: [item("note", `Favorite ${favoriteCalls}`)],
              status: "ready",
            }));
        }
        recentCalls += 1;
        return recentCalls === 1
          ? recentInitial.promise
          : Promise.resolve(response({
            items: [item("activity", `Recent ${recentCalls}`)],
            status: "ready",
          }));
      }),
    );
    const mounting = mountTodayInteractions();
    await vi.waitFor(() =>
      expect([favoriteCalls, recentCalls]).toEqual([1, 1])
    );
    globalThis.dispatchEvent(
      new CustomEvent("kinship:interaction-created", {
        detail: { kind: "activity" },
      }),
    );
    await vi.waitFor(() => expect(recentCalls).toBe(2));
    expect(favoriteCalls).toBe(1);
    globalThis.dispatchEvent(
      new CustomEvent("kinship:interaction-created", {
        detail: { kind: "note" },
      }),
    );
    await vi.waitFor(() =>
      expect([favoriteCalls, recentCalls]).toEqual([2, 3])
    );
    favoriteInitial.resolve(response({
      items: [item("note", "Obsolete favorite")],
      status: "ready",
    }));
    recentInitial.resolve(response({
      items: [item("activity", "Obsolete recent")],
      status: "ready",
    }));
    await mounting;
    expect(document.body.textContent).not.toContain("Obsolete");
    expect(document.querySelector("#today-favorite-notes")?.textContent)
      .toContain("Favorite 2");
    expect(document.querySelector("#today-recent-activity")?.textContent)
      .toContain("Recent 3");
  });

  it("keeps the opened quick capture form gated until options are ready", async () => {
    captureMarkup();
    let releasePeople!: (value: Response) => void;
    let releaseOptions!: (value: Response) => void;
    const people = new Promise<Response>((resolve) => releasePeople = resolve);
    const options = new Promise<Response>((resolve) =>
      releaseOptions = resolve
    );
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockReturnValueOnce(people)
      .mockReturnValueOnce(options);
    vi.stubGlobal("fetch", fetchMock);
    await mountInteractionCapture();
    const opener = document.querySelector<HTMLButtonElement>(
      "[data-quick-capture]",
    )!;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(opener.disabled).toBe(false);
    opener.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const form = document.querySelector<HTMLFormElement>(
      "#interaction-capture-form",
    )!;
    expect(
      form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
    ).toBe(true);
    expect(form.elements.namedItem("participantIds")).toHaveProperty(
      "disabled",
      true,
    );
    expect(form.elements.namedItem("kind")).toHaveProperty("disabled", true);
    expect(
      form.querySelector<HTMLButtonElement>("[data-interaction-cancel]")
        ?.disabled,
    ).toBe(false);
    releasePeople(
      response({ lifecycle: "active", people: [], status: "ready" }),
    );
    releaseOptions(response({
      activityTypes: [],
      availability: { activity: true, note: true },
      emotions: [],
      status: "ready",
    }));
    await vi.waitFor(() =>
      expect(
        form.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(false)
    );
    expect(opener.disabled).toBe(false);
  });

  it("wires quick capture before loading and reuses first-open options", async () => {
    captureMarkup();
    const paths: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      paths.push(path);
      if (path.endsWith("/session")) {
        return Promise.resolve(response(session()));
      }
      if (path.endsWith("/people")) return Promise.resolve(readyPeople());
      if (path.endsWith("/interaction-options")) {
        return Promise.resolve(readyInteractionOptions());
      }
      throw new Error(`unexpected ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await mountInteractionCapture();

    const opener = document.querySelector<HTMLButtonElement>(
      '[data-interaction-intended-kind="activity"]',
    )!;
    expect(paths.filter((path) => path.endsWith("/people"))).toHaveLength(0);
    expect(paths.filter((path) => path.endsWith("/interaction-options")))
      .toHaveLength(0);
    expect(opener.disabled).toBe(false);
    expect(opener.dataset.interactionCaptureReady).toBe("true");

    opener.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    document.querySelector<HTMLButtonElement>("[data-interaction-cancel]")!
      .click();
    opener.click();
    await Promise.resolve();

    expect(paths.filter((path) => path.endsWith("/people"))).toHaveLength(1);
    expect(paths.filter((path) => path.endsWith("/interaction-options")))
      .toHaveLength(1);
  });

  it("fails session closed but keeps option failures retryable in the dialog", async () => {
    captureMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(response({
        detail: "Sign in",
        status: 401,
        title: "Unauthorized",
        type: "about:blank",
      }, 401)).mockResolvedValueOnce(response({
        detail: "Entry unavailable",
        status: 409,
        title: "Application entry unavailable",
        type: "about:blank",
      }, 409)),
    );
    await mountInteractionCapture();
    expect(document.querySelector("#interaction-capture-status")?.textContent)
      .toContain("Sign in again");
    expect(
      document.querySelector<HTMLButtonElement>("[data-quick-capture]")
        ?.disabled,
    ).toBe(true);

    captureMarkup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({
        detail: "Unavailable",
        status: 503,
        title: "Unavailable",
        type: "about:blank",
      }, 503))
      .mockResolvedValueOnce(response({
        activityTypes: [],
        availability: { activity: true, note: true },
        emotions: [],
        status: "ready",
      }))
      .mockResolvedValueOnce(readyPeople())
      .mockResolvedValueOnce(readyInteractionOptions());
    vi.stubGlobal("fetch", fetchMock);
    await mountInteractionCapture();
    const opener = document.querySelector<HTMLButtonElement>(
      "[data-quick-capture]",
    )!;
    expect(opener.disabled).toBe(false);
    opener.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#interaction-capture-status")?.textContent)
        .toContain("could not be loaded")
    );
    expect(
      document.querySelector<HTMLDialogElement>(
        "#interaction-capture-dialog",
      )?.open,
    ).toBe(true);
    expect(opener.disabled).toBe(false);
    expect(
      document.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(true);

    document.querySelector<HTMLButtonElement>("[data-interaction-cancel]")!
      .click();
    await openReadyCapture("[data-quick-capture]");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(opener.disabled).toBe(false);
  });

  it("keeps activity and note availability independent and removes occurrence time from notes", async () => {
    captureMarkup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({
        lifecycle: "active",
        people: [{
          givenName: "Ada",
          id: personId,
          isPartial: false,
          isStarred: false,
          lifecycle: "active",
          tagCount: 0,
          tags: [],
        }],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        activityTypes: [],
        availability: { activity: false, note: true },
        emotions: [],
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);
    await mountInteractionCapture();
    const form = document.querySelector<HTMLFormElement>(
      "#interaction-capture-form",
    )!;
    const kind = form.elements.namedItem("kind") as HTMLSelectElement;
    const happenedAt = form.elements.namedItem(
      "happenedAt",
    ) as HTMLInputElement;
    await openReadyCapture('[data-interaction-intended-kind="note"]');
    expect(kind.value).toBe("note");
    expect(kind.options[0]?.disabled).toBe(true);
    expect(kind.options[1]?.disabled).toBe(false);
    expect(happenedAt.disabled).toBe(true);
    expect(happenedAt.required).toBe(false);
    expect(happenedAt.closest("label")?.hidden).toBe(true);

    const noteOpener = document.querySelector<HTMLButtonElement>(
      '[data-interaction-intended-kind="note"]',
    )!;
    const activityOpener = document.querySelector<HTMLButtonElement>(
      '[data-interaction-intended-kind="activity"]',
    )!;
    expect(noteOpener.disabled).toBe(false);
    expect(activityOpener.disabled).toBe(false);
    expect(kind.value).toBe("note");
    const hiddenModuleReconnect = reconnectOpener();
    await vi.waitFor(() =>
      expect(hiddenModuleReconnect.dataset.interactionCaptureReady).toBe(
        "true",
      )
    );
    expect(hiddenModuleReconnect.disabled).toBe(false);

    captureMarkup();
    const activityOnly = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(
        response({ lifecycle: "active", people: [], status: "ready" }),
      )
      .mockResolvedValueOnce(response({
        activityTypes: [],
        availability: { activity: true, note: false },
        emotions: [],
        status: "ready",
      }));
    vi.stubGlobal("fetch", activityOnly);
    await mountInteractionCapture();
    await openReadyCapture('[data-interaction-intended-kind="activity"]');
    const activityOnlyKind = document.querySelector<HTMLSelectElement>(
      "[name=kind]",
    )!;
    expect(activityOnlyKind.value).toBe("activity");
    expect(activityOnlyKind.options[1]?.disabled).toBe(true);
    const unavailableNoteOpener = document.querySelector<HTMLButtonElement>(
      '[data-interaction-intended-kind="note"]',
    )!;
    expect(unavailableNoteOpener.disabled).toBe(false);
    document.querySelector<HTMLButtonElement>("[data-interaction-cancel]")!
      .click();
    unavailableNoteOpener.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#interaction-capture-status")?.textContent)
        .toContain("hidden in workspace personalization")
    );

    captureMarkup();
    const unavailable = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(
        response({ lifecycle: "active", people: [], status: "ready" }),
      )
      .mockResolvedValueOnce(response({
        activityTypes: [],
        availability: { activity: false, note: false },
        emotions: [],
        status: "ready",
      }));
    vi.stubGlobal("fetch", unavailable);
    await mountInteractionCapture();
    const unavailableOpener = document.querySelector<HTMLButtonElement>(
      "[data-quick-capture]",
    )!;
    expect(unavailableOpener.disabled).toBe(false);
    unavailableOpener.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#interaction-capture-status")?.textContent)
        .toContain("hidden in workspace personalization")
    );
    expect(
      document.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(true);
  });

  it("rejects a blank activity occurrence before saving without affecting notes", async () => {
    captureMarkup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({
        lifecycle: "active",
        people: [{
          givenName: "Ada",
          id: personId,
          isPartial: false,
          isStarred: false,
          lifecycle: "active",
          tagCount: 0,
          tags: [],
        }],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        activityTypes: [],
        availability: { activity: true, note: true },
        emotions: [],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        record: {
          body: "Safe note",
          createdAt: "2026-08-17T12:31:00.000Z",
          id: "note",
          isFavorited: false,
          kind: "note",
          participants: [{ id: personId, name: "Ada" }],
        },
        status: "created",
      }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await mountInteractionCapture();
    await openReadyCapture('[data-interaction-intended-kind="activity"]');
    const form = document.querySelector<HTMLFormElement>(
      "#interaction-capture-form",
    )!;
    const participants = form.elements.namedItem(
      "participantIds",
    ) as HTMLSelectElement;
    participants.options[0]!.selected = true;
    const happenedAt = form.elements.namedItem(
      "happenedAt",
    ) as HTMLInputElement;
    happenedAt.value = "";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#interaction-capture-status")?.textContent)
        .toContain("valid occurrence")
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(happenedAt.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(happenedAt);
    expect(
      form.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled,
    )
      .toBe(false);

    const kind = form.elements.namedItem("kind") as HTMLSelectElement;
    kind.value = "note";
    kind.dispatchEvent(new Event("change", { bubbles: true }));
    (form.elements.namedItem("body") as HTMLTextAreaElement).value =
      "Safe note";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await vi.waitFor(() =>
      expect(document.querySelector("#interaction-capture-status")?.textContent)
        .toContain("Note saved")
    );
  });

  it("opens profile-local capture with its explicit intended kind", async () => {
    captureMarkup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(
        response({ lifecycle: "active", people: [], status: "ready" }),
      )
      .mockResolvedValueOnce(response({
        activityTypes: [],
        availability: { activity: true, note: true },
        emotions: [],
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);
    await mountInteractionCapture();
    const kind = document.querySelector<HTMLSelectElement>("[name=kind]")!;

    await openReadyCapture('[data-interaction-intended-kind="note"]');
    expect(kind.value).toBe("note");
    expect(
      document.querySelector<HTMLDialogElement>(
        "#interaction-capture-dialog",
      )?.open,
    ).toBe(true);
    document.querySelector<HTMLButtonElement>(
      '[data-interaction-intended-kind="activity"]',
    )!.click();
    expect(kind.value).toBe("activity");
  });

  it("activates a ready profile-local opener once with Enter or Space", async () => {
    captureMarkup();
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    Object.defineProperty(
      document.querySelector("#interaction-capture-dialog"),
      "showModal",
      { configurable: true, value: showModal },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session()))
        .mockResolvedValueOnce(
          response({ lifecycle: "active", people: [], status: "ready" }),
        )
        .mockResolvedValueOnce(response({
          activityTypes: [],
          availability: { activity: true, note: true },
          emotions: [],
          status: "ready",
        })),
    );
    await mountInteractionCapture();
    const kind = document.querySelector<HTMLSelectElement>("[name=kind]")!;
    const noteOpener = document.querySelector<HTMLButtonElement>(
      '[data-interaction-intended-kind="note"]',
    )!;
    noteOpener.focus();
    const enter = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    });
    noteOpener.dispatchEvent(enter);
    noteOpener.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() =>
      expect(
        document.querySelector("#interaction-capture-form")?.hasAttribute(
          "aria-busy",
        ),
      ).toBe(false)
    );
    expect(enter.defaultPrevented).toBe(true);
    expect(kind.value).toBe("note");
    expect(showModal).toHaveBeenCalledTimes(1);

    document.querySelector<HTMLDialogElement>("#interaction-capture-dialog")!
      .removeAttribute("open");
    const activityOpener = document.querySelector<HTMLButtonElement>(
      '[data-interaction-intended-kind="activity"]',
    )!;
    const space = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: " ",
    });
    activityOpener.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    expect(kind.value).toBe("activity");
    expect(showModal).toHaveBeenCalledTimes(2);
  });

  it("handles native dialog Escape with clean, dirty, and saving capture state", async () => {
    captureMarkup();
    let releaseSave!: (value: Response) => void;
    const save = new Promise<Response>((resolve) => releaseSave = resolve);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({
        lifecycle: "active",
        people: [{
          givenName: "Ada",
          id: personId,
          isPartial: false,
          isStarred: false,
          lifecycle: "active",
          tagCount: 0,
          tags: [],
        }],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        activityTypes: [],
        availability: { activity: true, note: true },
        emotions: [],
        status: "ready",
      }))
      .mockReturnValueOnce(save);
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    await mountInteractionCapture();
    const opener = document.querySelector<HTMLButtonElement>(
      '[data-interaction-intended-kind="activity"]',
    )!;
    const dialog = document.querySelector<HTMLDialogElement>(
      "#interaction-capture-dialog",
    )!;
    const form = document.querySelector<HTMLFormElement>(
      "#interaction-capture-form",
    )!;
    const summary = form.elements.namedItem("summary") as HTMLInputElement;
    const participants = form.elements.namedItem(
      "participantIds",
    ) as HTMLSelectElement;

    await openReadyCapture('[data-interaction-intended-kind="activity"]');
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(confirm).not.toHaveBeenCalled();

    opener.click();
    summary.value = "Draft retained after Escape";
    summary.dispatchEvent(new Event("input", { bubbles: true }));
    summary.focus();
    confirm.mockReturnValueOnce(false);
    const rejected = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(rejected);
    expect(rejected.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);
    expect(summary.value).toBe("Draft retained after Escape");
    expect(document.activeElement).toBe(summary);

    confirm.mockReturnValueOnce(true);
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(dialog.open).toBe(false);
    expect(summary.value).toBe("");
    expect(document.activeElement).toBe(opener);

    opener.click();
    participants.options[0]!.selected = true;
    summary.value = "Saving cannot be escaped";
    summary.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const savingCancel = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(savingCancel);
    expect(savingCancel.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    releaseSave(response({
      record: {
        createdAt: "2026-08-17T12:31:00.000Z",
        emotions: [],
        happenedAt: "2026-08-17T12:30:00.000Z",
        id: "activity",
        kind: "activity",
        participants: [{ id: personId, name: "Ada" }],
        summary: "Saving cannot be escaped",
      },
      status: "created",
    }, 201));
    await vi.waitFor(() =>
      expect(document.querySelector("#interaction-capture-status")?.textContent)
        .toContain("Activity saved")
    );
    expect(dialog.open).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("keeps one pending capture owner through remounts and settles accepted once", async () => {
    captureMarkup();
    let releaseSave!: (value: Response) => void;
    const save = new Promise<Response>((resolve) => releaseSave = resolve);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(readyPeople())
      .mockResolvedValueOnce(readyInteractionOptions())
      .mockReturnValueOnce(save)
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(readyPeople())
      .mockResolvedValueOnce(readyInteractionOptions());
    const created = vi.fn();
    globalThis.addEventListener("kinship:interaction-created", created);
    const form = await prepareActivityCapture(fetchMock);
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await mountInteractionCapture();
    await mountInteractionCapture();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("[data-quick-capture]")]
        .every((button) => button.disabled),
    ).toBe(true);
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    document.querySelector<HTMLButtonElement>("[data-interaction-cancel]")!
      .click();
    document.querySelector<HTMLButtonElement>(
      '[data-interaction-intended-kind="note"]',
    )!.click();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(globalThis.dispatchEvent(
      new CustomEvent(
        "kinship:workspace-change-request",
        { cancelable: true },
      ),
    )).toBe(false);
    releaseSave(savedActivity());
    await vi.waitFor(() => expect(created).toHaveBeenCalledOnce());
    expect(document.querySelector("#interaction-capture-status")?.textContent)
      .toContain("Activity saved");
    await mountInteractionCapture();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(created).toHaveBeenCalledOnce();
    globalThis.removeEventListener("kinship:interaction-created", created);
  });

  it("replays an ambiguous remounted capture with its exact frozen intent", async () => {
    captureMarkup();
    let rejectSave!: (reason?: unknown) => void;
    const save = new Promise<Response>((_resolve, reject) =>
      rejectSave = reject
    );
    let releaseReplay!: (value: Response) => void;
    const replay = new Promise<Response>((resolve) => releaseReplay = resolve);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(readyPeople())
      .mockResolvedValueOnce(readyInteractionOptions())
      .mockReturnValueOnce(save)
      .mockReturnValueOnce(replay)
      .mockResolvedValueOnce(response({
        code: "archived_write_rejected",
        detail: "Restore the person first.",
        status: 409,
        title: "Archived person is read-only",
        type: "about:blank",
      }, 409))
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(readyPeople())
      .mockResolvedValueOnce(readyInteractionOptions());
    const created = vi.fn();
    globalThis.addEventListener("kinship:interaction-created", created);
    const form = await prepareActivityCapture(fetchMock);
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const first = JSON.parse(String(fetchMock.mock.calls[3]![1]?.body));
    await mountInteractionCapture();
    rejectSave(new Error("connection lost after dispatch"));
    await vi.waitFor(() =>
      expect(document.querySelector("#interaction-capture-status")?.textContent)
        .toContain("outcome is uncertain")
    );
    expect(created).not.toHaveBeenCalled();
    expect((form.elements.namedItem("summary") as HTMLInputElement).disabled)
      .toBe(true);
    expect(globalThis.dispatchEvent(
      new CustomEvent(
        "kinship:workspace-change-request",
        { cancelable: true },
      ),
    )).toBe(false);
    (form.elements.namedItem("summary") as HTMLInputElement).value = "Changed";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    const second = JSON.parse(String(fetchMock.mock.calls[4]![1]?.body));
    expect(second).toEqual(first);
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(5);
    releaseReplay(savedActivity(200));
    await vi.waitFor(() => expect(created).toHaveBeenCalledOnce());
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#interaction-capture-status")?.textContent)
        .toContain("Restore the person")
    );
    expect(JSON.parse(String(fetchMock.mock.calls[5]![1]?.body)).requestId)
      .not.toBe(first.requestId);
    expect(created).toHaveBeenCalledOnce();
    expect((form.elements.namedItem("summary") as HTMLInputElement).disabled)
      .toBe(false);
    await mountInteractionCapture();
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(created).toHaveBeenCalledOnce();
    globalThis.removeEventListener("kinship:interaction-created", created);
  });

  it("validates every dynamic reconnect open, owns ambiguous replay globally, and emits success once", async () => {
    captureMarkup();
    const firstWrite = deferred<Response>();
    const posted: unknown[] = [];
    let validations = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/session")) {
        return Promise.resolve(response(session()));
      }
      if (url.pathname.endsWith("/interaction-options")) {
        return Promise.resolve(readyInteractionOptions());
      }
      if (url.pathname.endsWith("/people")) {
        const selectedId = url.searchParams.get("selectedPersonId");
        if (!selectedId) return Promise.resolve(readyPeople());
        validations += 1;
        const selected = validations === 1
          ? selectedDirectoryPerson(otherId, "archived")
          : validations === 2
          ? selectedDirectoryPerson(personId)
          : validations === 3
          ? undefined
          : selectedDirectoryPerson(otherId);
        return Promise.resolve(response({
          lifecycle: "active",
          people: [],
          ...(selected ? { selected } : {}),
          status: "ready",
        }));
      }
      if (url.pathname.endsWith("/interactions") && init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)));
        return posted.length === 1
          ? firstWrite.promise
          : Promise.resolve(response({
            record: {
              emotions: [],
              happenedAt: "2026-08-22T12:00:00.000Z",
              id: "reconnect-activity",
              kind: "activity",
              participants: [{ id: otherId, name: "Grace" }],
              summary: "Caught up",
            },
            status: "replayed",
          }));
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const created = vi.fn();
    const reconnected = vi.fn();
    const events = new AbortController();
    globalThis.addEventListener("kinship:interaction-created", created, {
      signal: events.signal,
    });
    globalThis.addEventListener(
      "kinship:today-reconnect-recorded",
      reconnected,
      {
        signal: events.signal,
      },
    );
    await mountInteractionCapture();
    const status = document.querySelector<HTMLElement>(
      "#interaction-capture-status",
    )!;
    const form = document.querySelector<HTMLFormElement>(
      "#interaction-capture-form",
    )!;
    const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
    const cancel = form.querySelector<HTMLButtonElement>(
      "[data-interaction-cancel]",
    )!;
    const malformed = reconnectOpener("not-a-uuid");
    await vi.waitFor(() => expect(malformed.disabled).toBe(false));
    malformed.click();
    expect(validations).toBe(0);
    await vi.waitFor(() => expect(status.textContent).toMatch(/unavailable/i));
    expect(document.activeElement).toBe(status);
    expect(submit.disabled).toBe(true);
    cancel.click();

    const opener = reconnectOpener();
    await vi.waitFor(() => expect(opener.disabled).toBe(false));
    for (const count of [1, 2, 3]) {
      opener.click();
      await vi.waitFor(() => expect(validations).toBe(count));
      await vi.waitFor(() =>
        expect(status.textContent).toMatch(/unavailable/i)
      );
      expect(submit.disabled).toBe(true);
      expect(document.activeElement).toBe(status);
      cancel.click();
      expect(document.activeElement).toBe(opener);
    }
    opener.click();
    await vi.waitFor(() => expect(validations).toBe(4));
    await vi.waitFor(() => expect(submit.disabled).toBe(false));
    const participants = form.elements.namedItem(
      "participantIds",
    ) as HTMLSelectElement;
    expect([...participants.selectedOptions].map((entry) => entry.value))
      .toEqual([otherId]);
    const kind = form.elements.namedItem("kind") as HTMLSelectElement;
    expect([kind.value, kind.disabled]).toEqual(["activity", true]);
    (form.elements.namedItem("summary") as HTMLInputElement).value =
      "Caught up";
    (form.elements.namedItem("happenedAt") as HTMLInputElement).value =
      "2026-08-22T12:00";
    form.dispatchEvent(
      new SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
      }),
    );
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    const lateOpener = reconnectOpener(personId);
    await vi.waitFor(() =>
      expect(lateOpener.dataset.interactionCaptureReady).toBe("true")
    );
    expect(lateOpener.disabled).toBe(true);
    lateOpener.click();
    expect(validations).toBe(4);
    firstWrite.reject(new Error("connection lost after dispatch"));
    await vi.waitFor(() => expect(status.textContent).toMatch(/uncertain/i));
    expect([created.mock.calls.length, reconnected.mock.calls.length]).toEqual([
      0,
      0,
    ]);
    await mountInteractionCapture();
    (form.elements.namedItem("summary") as HTMLInputElement).value = "Tampered";
    form.dispatchEvent(
      new SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
      }),
    );
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]).toEqual(posted[0]);
    await vi.waitFor(() => expect(created).toHaveBeenCalledOnce());
    expect(reconnected).toHaveBeenCalledOnce();
    expect(reconnected.mock.calls[0]?.[0]).toMatchObject({
      detail: { personId: otherId },
    });
    expect(
      document.querySelector<HTMLDialogElement>(
        "#interaction-capture-dialog",
      )?.open,
    ).toBe(false);
    await mountInteractionCapture();
    expect([created.mock.calls.length, reconnected.mock.calls.length]).toEqual([
      1,
      1,
    ]);
    events.abort();
  });

  it("keeps a final reconnect lifecycle rejection open and read-only until cancel and revalidation", async () => {
    captureMarkup();
    let validations = 0;
    let writes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname.endsWith("/session")) {
          return Promise.resolve(response(session()));
        }
        if (url.pathname.endsWith("/interaction-options")) {
          return Promise.resolve(readyInteractionOptions());
        }
        if (url.pathname.endsWith("/people")) {
          if (!url.searchParams.has("selectedPersonId")) {
            return Promise.resolve(readyPeople());
          }
          validations += 1;
          return Promise.resolve(response({
            lifecycle: "active",
            people: [],
            selected: selectedDirectoryPerson(otherId),
            status: "ready",
          }));
        }
        if (url.pathname.endsWith("/interactions") && init?.method === "POST") {
          writes += 1;
          return Promise.resolve(response({
            code: "archived_write_rejected",
            detail:
              "Restore every selected person before recording an interaction.",
            status: 409,
            title: "Archived person is read-only",
            type: "about:blank",
          }, 409));
        }
        throw new Error(`Unexpected request ${url}`);
      }),
    );
    await mountInteractionCapture();
    const opener = reconnectOpener();
    await vi.waitFor(() => expect(opener.disabled).toBe(false));
    opener.click();
    const form = document.querySelector<HTMLFormElement>(
      "#interaction-capture-form",
    )!;
    const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
    await vi.waitFor(() => expect(submit.disabled).toBe(false));
    (form.elements.namedItem("summary") as HTMLInputElement).value = "Too late";
    (form.elements.namedItem("happenedAt") as HTMLInputElement).value =
      "2026-08-22T12:00";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(writes).toBe(1));
    await vi.waitFor(() =>
      expect(document.querySelector("#interaction-capture-status")?.textContent)
        .toContain("Restore every selected person")
    );
    expect(submit.disabled).toBe(true);
    expect(document.activeElement?.id).toBe("interaction-capture-status");
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    expect(writes).toBe(1);
    form.querySelector<HTMLButtonElement>("[data-interaction-cancel]")!.click();
    opener.click();
    await vi.waitFor(() => expect(validations).toBe(2));
    expect(writes).toBe(1);
  });

  it("searches bounded participant and vocabulary pages beyond the first page", async () => {
    captureMarkup();
    const beyond = "00000000-0000-4000-8000-000000000199";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({
        lifecycle: "active",
        nextCursor: "people-2",
        people: Array.from({ length: 20 }, (_, index) => ({
          givenName: `Person ${index}`,
          id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          isPartial: false,
          isStarred: false,
          lifecycle: "active",
          tagCount: 0,
          tags: [],
        })),
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        activityTypes: [],
        activityTypesNextCursor: "types-2",
        availability: { activity: true, note: true },
        emotions: [],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        lifecycle: "active",
        people: [{
          givenName: "Beyond",
          id: beyond,
          isPartial: false,
          isStarred: false,
          lifecycle: "active",
          tagCount: 0,
          tags: [],
        }],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        activityTypes: [{
          id: "00000000-0000-4000-8000-000000000299",
          name: "Beyond category",
        }],
        availability: { activity: true, note: true },
        emotions: [],
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);
    await mountInteractionCapture();
    await openReadyCapture('[data-interaction-intended-kind="activity"]');
    const participantSearch = document.querySelector<HTMLInputElement>(
      "[name=participantSearch]",
    )!;
    participantSearch.value = "Beyond";
    participantSearch.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() =>
      expect(
        [
          ...document.querySelector<HTMLSelectElement>("[name=participantIds]")!
            .options,
        ].some((entry) => entry.value === beyond),
      ).toBe(true)
    );
    expect(
      document.querySelector<HTMLSelectElement>("[name=participantIds]")
        ?.options.length,
    ).toBeLessThanOrEqual(70);
    const typeSearch = document.querySelector<HTMLInputElement>(
      "[name=activityTypeSearch]",
    )!;
    typeSearch.value = "Beyond category";
    typeSearch.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLSelectElement>("[name=activityTypeId]")
          ?.textContent,
      ).toContain("Beyond category")
    );
  });

  it("continues every bounded selector with its context cursor", async () => {
    captureMarkup();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/interaction-options")) {
        const continuedType = url.searchParams.get("activityTypeCursor");
        const continuedEmotion = url.searchParams.get("emotionCursor");
        return Promise.resolve(response({
          activityTypes: [{
            id: continuedType
              ? "00000000-0000-4000-8000-000000000202"
              : "00000000-0000-4000-8000-000000000201",
            name: continuedType ? "Type two" : "Type one",
          }],
          ...(continuedType ? {} : { activityTypesNextCursor: "types-2" }),
          availability: { activity: true, note: true },
          emotions: [{
            id: continuedEmotion
              ? "00000000-0000-4000-8000-000000000302"
              : "00000000-0000-4000-8000-000000000301",
            name: continuedEmotion ? "Emotion two" : "Emotion one",
          }],
          ...(continuedEmotion ? {} : { emotionsNextCursor: "emotions-2" }),
          status: "ready",
        }));
      }
      if (url.pathname.endsWith("/people")) {
        const continued = url.searchParams.get("cursor");
        return Promise.resolve(response({
          lifecycle: "active",
          ...(continued ? {} : { nextCursor: "people-2" }),
          people: [{
            givenName: continued ? "Person two" : "Person one",
            id: continued
              ? "00000000-0000-4000-8000-000000000102"
              : "00000000-0000-4000-8000-000000000101",
            isPartial: false,
            isStarred: false,
            lifecycle: "active",
            tagCount: 0,
            tags: [],
          }],
          status: "ready",
        }));
      }
      return Promise.resolve(response(session()));
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountInteractionCapture();
    await openReadyCapture('[data-interaction-intended-kind="activity"]');
    document.querySelector<HTMLButtonElement>("[data-participants-more]")!
      .click();
    document.querySelector<HTMLButtonElement>("[data-activity-types-more]")!
      .click();
    document.querySelector<HTMLButtonElement>("[data-emotions-more]")!.click();
    await vi.waitFor(() => {
      const urls = fetchMock.mock.calls.map(([input]) => String(input));
      expect(urls.some((url) => url.includes("cursor=people-2"))).toBe(true);
      expect(urls.some((url) => url.includes("activityTypeCursor=types-2")))
        .toBe(true);
      expect(urls.some((url) => url.includes("emotionCursor=emotions-2"))).toBe(
        true,
      );
    });
  });

  it("ignores initial selector pages from an older aborted mount", async () => {
    captureMarkup();
    let resolveOldPeople!: (value: Response) => void;
    let resolveOldOptions!: (value: Response) => void;
    const oldPeople = new Promise<Response>((resolve) => {
      resolveOldPeople = resolve;
    });
    const oldOptions = new Promise<Response>((resolve) => {
      resolveOldOptions = resolve;
    });
    let peopleCalls = 0;
    let optionCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/people")) {
        peopleCalls += 1;
        if (peopleCalls === 1) return oldPeople;
        return Promise.resolve(response({
          lifecycle: "active",
          people: [{
            givenName: "Newest person",
            id: "00000000-0000-4000-8000-000000000111",
            isPartial: false,
            isStarred: false,
            lifecycle: "active",
            tagCount: 0,
            tags: [],
          }],
          status: "ready",
        }));
      }
      if (url.pathname.endsWith("/interaction-options")) {
        optionCalls += 1;
        if (optionCalls === 1) return oldOptions;
        return Promise.resolve(response({
          activityTypes: [{
            id: "00000000-0000-4000-8000-000000000211",
            name: "Newest type",
          }],
          availability: { activity: true, note: true },
          emotions: [{
            id: "00000000-0000-4000-8000-000000000311",
            name: "Newest emotion",
          }],
          status: "ready",
        }));
      }
      return Promise.resolve(response(session()));
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountInteractionCapture();
    document.querySelector<HTMLButtonElement>(
      '[data-interaction-intended-kind="activity"]',
    )!.click();
    await vi.waitFor(() => {
      expect(peopleCalls).toBe(1);
      expect(optionCalls).toBe(1);
    });
    await mountInteractionCapture();
    await openReadyCapture('[data-interaction-intended-kind="activity"]');
    resolveOldPeople(response({
      lifecycle: "active",
      people: [{
        givenName: "Stale person",
        id: "00000000-0000-4000-8000-000000000112",
        isPartial: false,
        isStarred: false,
        lifecycle: "active",
        tagCount: 0,
        tags: [],
      }],
      status: "ready",
    }));
    resolveOldOptions(response({
      activityTypes: [{
        id: "00000000-0000-4000-8000-000000000212",
        name: "Stale type",
      }],
      availability: { activity: true, note: true },
      emotions: [{
        id: "00000000-0000-4000-8000-000000000312",
        name: "Stale emotion",
      }],
      status: "ready",
    }));
    await Promise.resolve();
    expect(document.querySelector("[name=participantIds]")?.textContent)
      .toContain("Newest person");
    expect(document.querySelector("[name=activityTypeId]")?.textContent)
      .toContain("Newest type");
    expect(document.querySelector("[name=emotionIds]")?.textContent)
      .toContain("Newest emotion");
    expect(document.body.textContent).not.toContain("Stale person");
    expect(document.body.textContent).not.toContain("Stale type");
    expect(document.body.textContent).not.toContain("Stale emotion");
  });

  it("keeps every selector on its newest search when older searches and continuations settle later", async () => {
    captureMarkup();
    type Deferred = {
      promise: Promise<Response>;
      reject: (reason?: unknown) => void;
      resolve: (value: Response) => void;
    };
    const deferred = (): Deferred => {
      let resolve!: (value: Response) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<Response>((accept, decline) => {
        resolve = accept;
        reject = decline;
      });
      return { promise, reject, resolve };
    };
    const pending = new Map<string, Deferred>();
    const personPage = (name: string, nextCursor?: string) =>
      response({
        lifecycle: "active",
        ...(nextCursor ? { nextCursor } : {}),
        people: [{
          givenName: name,
          id: `00000000-0000-4000-8000-${
            name.charCodeAt(0).toString().padStart(12, "0")
          }`,
          isPartial: false,
          isStarred: false,
          lifecycle: "active",
          tagCount: 0,
          tags: [],
        }],
        status: "ready",
      });
    const vocabularyPage = (
      target: "type" | "emotion",
      name: string,
      nextCursor?: string,
    ) =>
      response({
        activityTypes: target === "type"
          ? [{
            id: `00000000-0000-4000-8001-${
              name.charCodeAt(0).toString().padStart(12, "0")
            }`,
            name,
          }]
          : [],
        ...(target === "type" && nextCursor
          ? { activityTypesNextCursor: nextCursor }
          : {}),
        availability: { activity: true, note: true },
        emotions: target === "emotion"
          ? [{
            id: `00000000-0000-4000-8002-${
              name.charCodeAt(0).toString().padStart(12, "0")
            }`,
            name,
          }]
          : [],
        ...(target === "emotion" && nextCursor
          ? { emotionsNextCursor: nextCursor }
          : {}),
        status: "ready",
      });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/people")) {
        const search = url.searchParams.get("search");
        const cursor = url.searchParams.get("cursor") ?? "";
        if (!search) return Promise.resolve(personPage("Initial"));
        const entry = deferred();
        pending.set(`people:${search}:${cursor}`, entry);
        return entry.promise;
      }
      if (url.pathname.endsWith("/interaction-options")) {
        const typeSearch = url.searchParams.get("activityTypeSearch");
        const emotionSearch = url.searchParams.get("emotionSearch");
        if (!typeSearch && !emotionSearch) {
          return Promise.resolve(vocabularyPage("type", "Initial type"));
        }
        const target = typeSearch ? "type" : "emotion";
        const search = typeSearch ?? emotionSearch!;
        const cursor = url.searchParams.get(
          target === "type" ? "activityTypeCursor" : "emotionCursor",
        ) ?? "";
        const entry = deferred();
        pending.set(`${target}:${search}:${cursor}`, entry);
        return entry.promise;
      }
      return Promise.resolve(response(session()));
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountInteractionCapture();
    await openReadyCapture('[data-interaction-intended-kind="activity"]');

    const searches = {
      emotion: document.querySelector<HTMLInputElement>(
        "[name=emotionSearch]",
      )!,
      people: document.querySelector<HTMLInputElement>(
        "[name=participantSearch]",
      )!,
      type: document.querySelector<HTMLInputElement>(
        "[name=activityTypeSearch]",
      )!,
    };
    for (const [target, input] of Object.entries(searches)) {
      input.value = "Old";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.value = "New";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await vi.waitFor(() => expect(pending.has(`${target}:New:`)).toBe(true));
    }
    pending.get("people:New:")!.resolve(personPage("New person", "people-2"));
    pending.get("type:New:")!.resolve(
      vocabularyPage("type", "New type", "types-2"),
    );
    pending.get("emotion:New:")!.resolve(
      vocabularyPage("emotion", "New emotion", "emotions-2"),
    );
    await vi.waitFor(() => {
      expect(document.querySelector("[name=participantIds]")?.textContent)
        .toContain("New person");
      expect(document.querySelector("[name=activityTypeId]")?.textContent)
        .toContain("New type");
      expect(document.querySelector("[name=emotionIds]")?.textContent)
        .toContain("New emotion");
    });
    pending.get("people:Old:")!.resolve(personPage("Old person", "old-2"));
    pending.get("type:Old:")!.resolve(
      vocabularyPage("type", "Old type", "old-2"),
    );
    pending.get("emotion:Old:")!.resolve(
      vocabularyPage("emotion", "Old emotion", "old-2"),
    );
    await Promise.resolve();
    expect(document.querySelector("[name=participantIds]")?.textContent)
      .not.toContain("Old person");
    expect(document.querySelector("[name=activityTypeId]")?.textContent)
      .not.toContain("Old type");
    expect(document.querySelector("[name=emotionIds]")?.textContent)
      .not.toContain("Old emotion");

    const moreButtons = {
      emotion: document.querySelector<HTMLButtonElement>(
        "[data-emotions-more]",
      )!,
      people: document.querySelector<HTMLButtonElement>(
        "[data-participants-more]",
      )!,
      type: document.querySelector<HTMLButtonElement>(
        "[data-activity-types-more]",
      )!,
    };
    for (const [target, input] of Object.entries(searches)) {
      input.value = "Uncommitted";
      moreButtons[target as keyof typeof moreButtons].click();
      await Promise.resolve();
      expect(
        [...pending.keys()].some((key) =>
          key.startsWith(`${target}:Uncommitted:`)
        ),
      ).toBe(false);
      input.value = "New";
    }
    document.querySelector<HTMLButtonElement>("[data-participants-more]")!
      .click();
    document.querySelector<HTMLButtonElement>("[data-activity-types-more]")!
      .click();
    document.querySelector<HTMLButtonElement>("[data-emotions-more]")!.click();
    await vi.waitFor(() => {
      expect(pending.has("people:New:people-2")).toBe(true);
      expect(pending.has("type:New:types-2")).toBe(true);
      expect(pending.has("emotion:New:emotions-2")).toBe(true);
    });
    for (const input of Object.values(searches)) {
      input.value = "Final";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await vi.waitFor(() => {
      expect(pending.has("people:Final:")).toBe(true);
      expect(pending.has("type:Final:")).toBe(true);
      expect(pending.has("emotion:Final:")).toBe(true);
    });
    pending.get("people:Final:")!.resolve(
      personPage("Final person", "people-final"),
    );
    pending.get("type:Final:")!.resolve(
      vocabularyPage("type", "Final type", "types-final"),
    );
    pending.get("emotion:Final:")!.resolve(
      vocabularyPage("emotion", "Final emotion", "emotions-final"),
    );
    pending.get("people:New:people-2")!.reject(new Error("stale outage"));
    pending.get("type:New:types-2")!.resolve(
      vocabularyPage("type", "Stale continued type"),
    );
    pending.get("emotion:New:emotions-2")!.reject(new Error("stale outage"));
    await vi.waitFor(() => {
      expect(document.querySelector("[name=participantIds]")?.textContent)
        .toContain("Final person");
      expect(document.querySelector("[name=activityTypeId]")?.textContent)
        .toContain("Final type");
      expect(document.querySelector("[name=emotionIds]")?.textContent)
        .toContain("Final emotion");
      expect(
        document.querySelector<HTMLButtonElement>("[data-participants-more]")
          ?.hidden,
      ).toBe(false);
      expect(
        document.querySelector<HTMLButtonElement>("[data-activity-types-more]")
          ?.hidden,
      ).toBe(false);
      expect(
        document.querySelector<HTMLButtonElement>("[data-emotions-more]")
          ?.hidden,
      ).toBe(false);
    });
  });

  it("quick capture records a multi-person activity with actual time and options", async () => {
    captureMarkup();
    const timelineChanged = vi.fn();
    document.addEventListener("person-timeline-changed", timelineChanged, {
      once: true,
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({
        lifecycle: "active",
        people: [
          {
            givenName: "Ada",
            id: personId,
            isPartial: false,
            isStarred: false,
            lifecycle: "active",
            tagCount: 0,
            tags: [],
          },
          {
            givenName: "Grace",
            id: otherId,
            isPartial: false,
            isStarred: false,
            lifecycle: "active",
            tagCount: 0,
            tags: [],
          },
        ],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        activityTypes: [{
          id: "00000000-0000-4000-8000-000000000200",
          name: "Meal",
        }],
        availability: { activity: true, note: true },
        emotions: [{ id: "00000000-0000-4000-8000-000000000300", name: "Joy" }],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        record: {
          emotions: [],
          happenedAt: "2026-08-16T18:15:00.000Z",
          id: "record",
          kind: "activity",
          participants: [
            { id: personId, name: "Ada" },
            { id: otherId, name: "Grace" },
          ],
          summary: "Dinner together",
        },
        status: "created",
      }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await mountInteractionCapture();
    await openReadyCapture("[data-quick-capture]");
    const form = document.querySelector<HTMLFormElement>(
      "#interaction-capture-form",
    )!;
    const participants = form.elements.namedItem(
      "participantIds",
    ) as HTMLSelectElement;
    participants.options[0]!.selected = true;
    participants.options[1]!.selected = true;
    (form.elements.namedItem("happenedAt") as HTMLInputElement).value =
      "2026-08-16T18:15";
    (form.elements.namedItem("summary") as HTMLInputElement).value =
      "Dinner together";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const request = fetchMock.mock.calls[3]![1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.participantIds).toEqual([personId, otherId]);
    expect(body.happenedAt).toContain("2026-08-16T");
    await vi.waitFor(() =>
      expect(document.querySelector("#interaction-capture-status")?.textContent)
        .toContain("saved")
    );
    expect(
      (timelineChanged.mock.calls[0]?.[0] as CustomEvent).detail,
    ).toEqual({ personIds: [personId, otherId] });
  });

  it("records one favorite note and validates participants without sending", async () => {
    captureMarkup();
    const created = vi.fn();
    globalThis.addEventListener("kinship:interaction-created", created, {
      once: true,
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({
        lifecycle: "active",
        people: [
          {
            givenName: "Ada",
            id: personId,
            isPartial: false,
            isStarred: false,
            lifecycle: "active",
            tagCount: 0,
            tags: [],
          },
          {
            givenName: "Grace",
            id: otherId,
            isPartial: false,
            isStarred: false,
            lifecycle: "active",
            tagCount: 0,
            tags: [],
          },
        ],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        activityTypes: [],
        availability: { activity: true, note: true },
        emotions: [],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        record: { id: "note", kind: "note" },
        status: "created",
      }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await mountInteractionCapture();
    await openReadyCapture('[data-interaction-intended-kind="activity"]');
    const form = document.querySelector<HTMLFormElement>(
      "#interaction-capture-form",
    )!;
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    expect(document.querySelector("#interaction-capture-status")?.textContent)
      .toContain("Choose at least one");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const participants = form.elements.namedItem(
      "participantIds",
    ) as HTMLSelectElement;
    participants.options[0]!.selected = true;
    participants.options[1]!.selected = true;
    const kind = form.elements.namedItem("kind") as HTMLSelectElement;
    kind.value = "note";
    kind.dispatchEvent(new Event("change", { bubbles: true }));
    expect(participants.multiple).toBe(false);
    expect(participants.selectedOptions).toHaveLength(1);
    (form.elements.namedItem("body") as HTMLTextAreaElement).value =
      "Keep this context";
    (form.elements.namedItem("isFavorited") as HTMLInputElement).checked = true;
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const request = fetchMock.mock.calls[3]![1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      body: "Keep this context",
      isFavorited: true,
      kind: "note",
      personId,
      requestId: expect.any(String),
    });
    await vi.waitFor(() => expect(created).toHaveBeenCalledOnce());
  });

  it("isolates a favorite-note outage and retries only that region", async () => {
    todayMarkup();
    const note = {
      body: "Pinned context",
      createdAt: "2026-08-17T12:30:00.000Z",
      id: "note",
      isFavorited: true,
      kind: "note",
      participants: [{ id: personId, name: "Ada Lovelace" }],
    };
    const activity = {
      emotions: [],
      happenedAt: "2026-08-17T12:31:00.000Z",
      id: "activity",
      kind: "activity",
      participants: [{ id: personId, name: "Ada Lovelace" }],
      summary: "Shared lunch",
    };
    let favoriteCalls = 0;
    let recentCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path.endsWith("/favorite-notes")) {
          favoriteCalls += 1;
          return Promise.resolve(
            favoriteCalls === 1
              ? response({
                detail: "offline",
                status: 503,
                title: "Unavailable",
              }, 503)
              : response({ items: [note], status: "ready" }),
          );
        }
        if (path.endsWith("/recent-activity")) {
          recentCalls += 1;
          return Promise.resolve(
            response({ items: [activity], status: "ready" }),
          );
        }
        return Promise.resolve(response(session()));
      }),
    );
    await mountTodayInteractions();
    expect(document.querySelector("#today-favorite-notes-state")?.textContent)
      .toContain("could not be loaded");
    expect(document.querySelector("#today-recent-activity")?.textContent)
      .toContain("Shared lunch");
    const retry = document.querySelector<HTMLButtonElement>(
      "#today-favorite-notes-retry",
    )!;
    expect(retry.hidden).toBe(false);
    retry.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#today-favorite-notes")?.textContent)
        .toContain("Pinned context")
    );
    expect(favoriteCalls).toBe(2);
    expect(recentCalls).toBe(1);
  });

  it("isolates a recent-activity outage and retries only that region", async () => {
    todayMarkup();
    const note = {
      body: "Preserved favorite",
      createdAt: "2026-08-17T12:30:00.000Z",
      id: "note",
      isFavorited: true,
      kind: "note",
      participants: [{ id: personId, name: "Ada Lovelace" }],
    };
    let favoriteCalls = 0;
    let recentCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path.endsWith("/favorite-notes")) {
          favoriteCalls += 1;
          return Promise.resolve(response({ items: [note], status: "ready" }));
        }
        if (path.endsWith("/recent-activity")) {
          recentCalls += 1;
          return Promise.resolve(
            recentCalls === 1
              ? response({
                detail: "offline",
                status: 503,
                title: "Unavailable",
              }, 503)
              : response({ items: [], status: "ready" }),
          );
        }
        return Promise.resolve(response(session()));
      }),
    );
    await mountTodayInteractions();
    expect(document.querySelector("#today-favorite-notes")?.textContent)
      .toContain("Preserved favorite");
    expect(document.querySelector("#today-recent-activity-state")?.textContent)
      .toContain("could not be loaded");
    document.querySelector<HTMLButtonElement>(
      "#today-recent-activity-retry",
    )!.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector("#today-recent-activity-state")?.textContent,
      )
        .toContain("No activities or notes")
    );
    expect(favoriteCalls).toBe(1);
    expect(recentCalls).toBe(2);
  });

  it("hides empty favorite notes and reveals a later nonempty refresh without stale overwrite", async () => {
    todayMarkup();
    let favoriteCalls = 0;
    let releaseOlder!: (value: Response) => void;
    const older = new Promise<Response>((resolve) => releaseOlder = resolve);
    const note = (body: string) => ({
      body,
      createdAt: "2026-08-17T12:30:00.000Z",
      id: body,
      isFavorited: true,
      kind: "note",
      participants: [{ id: personId, name: "Ada Lovelace" }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path.endsWith("/favorite-notes")) {
          favoriteCalls += 1;
          if (favoriteCalls === 1) {
            return Promise.resolve(response({ items: [], status: "ready" }));
          }
          if (favoriteCalls === 2) return older;
          return Promise.resolve(response({
            items: [note("Newest favorite")],
            status: "ready",
          }));
        }
        if (path.endsWith("/recent-activity")) {
          return Promise.resolve(response({ items: [], status: "ready" }));
        }
        return Promise.resolve(response(session()));
      }),
    );
    await mountTodayInteractions();
    const region = document.querySelector<HTMLElement>(
      "#today-favorite-notes-region",
    )!;
    expect(region.hidden).toBe(true);
    expect(region.getAttribute("aria-labelledby")).toBe(
      "favorite-notes-heading",
    );
    expect(
      document.querySelector<HTMLElement>("#today-recent-activity-region")
        ?.hidden,
    ).toBe(false);
    globalThis.dispatchEvent(new CustomEvent("kinship:interaction-created"));
    await vi.waitFor(() => expect(favoriteCalls).toBe(2));
    globalThis.dispatchEvent(new CustomEvent("kinship:interaction-created"));
    await vi.waitFor(() =>
      expect(document.querySelector("#today-favorite-notes")?.textContent)
        .toContain("Newest favorite")
    );
    expect(region.hidden).toBe(false);
    releaseOlder(response({
      items: [note("Older favorite")],
      status: "ready",
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector("#today-favorite-notes")?.textContent)
      .not.toContain("Older favorite");
  });

  it("renders retained activity with redacted participants safely", async () => {
    todayMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path.endsWith("/favorite-notes")) {
          return Promise.resolve(response({ items: [], status: "ready" }));
        }
        if (path.endsWith("/recent-activity")) {
          return Promise.resolve(response({
            items: [{
              activityType: "Collaboration",
              emotions: [],
              happenedAt: "2026-06-01T09:00:00.000Z",
              id: crypto.randomUUID(),
              kind: "activity",
              participants: [],
              summary: "Retained redacted activity",
            }],
            status: "ready",
          }));
        }
        return Promise.resolve(response(session()));
      }),
    );
    await mountTodayInteractions();
    const text =
      document.querySelector("#today-recent-activity")?.textContent ?? "";
    expect(text).toContain("Retained redacted activity");
    expect(text).toContain("Category: Collaboration");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("Deleted private identity");
  });

  it("UXD-009 renders favorite notes, chronological activity, and the report breadcrumb", async () => {
    todayMarkup();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<nav aria-label="Breadcrumb">
        <a href="/app/people">People</a><span aria-hidden="true">/</span>
        <a data-breadcrumb-person href="/app/people">Loading person…</a><span aria-hidden="true">/</span>
        <span aria-current="page">Activity report</span>
      </nav>
      <p id="activity-report-state"></p><h1 id="activity-report-heading"></h1><ul id="activity-report-list"></ul><button id="activity-report-more" hidden></button>`,
    );
    const note = {
      body: "Prefers quiet mornings",
      createdAt: "2026-08-17T12:30:00.000Z",
      id: "note",
      isFavorited: true,
      kind: "note",
      participants: [{ id: personId, name: "Ada Lovelace" }],
    };
    let reportCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path.endsWith("/favorite-notes")) {
        return Promise.resolve(response({ items: [note], status: "ready" }));
      }
      if (path.endsWith("/recent-activity")) {
        return Promise.resolve(response({
          items: [note, { ...note, id: "note-2" }],
          status: "ready",
        }));
      }
      if (path.endsWith("/activity-report")) {
        reportCalls += 1;
        return Promise.resolve(response({
          items: reportCalls === 1
            ? [note]
            : [{ ...note, body: "Second page", id: "note-2" }],
          ...(reportCalls === 1 ? { nextCursor: "report-2" } : {}),
          person: { id: personId, name: "Ada Lovelace" },
          status: "ready",
        }));
      }
      return Promise.resolve(response(session()));
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayInteractions();
    await mountActivityReport(personId);
    expect(document.querySelector("#today-favorite-notes")?.textContent)
      .toContain("quiet mornings");
    expect(document.querySelector("#today-recent-activity")?.textContent)
      .toContain("Ada Lovelace");
    expect(document.querySelector("#activity-report-heading")?.textContent)
      .toContain("Ada Lovelace");
    const personCrumb = document.querySelector("[data-breadcrumb-person]");
    expect({
      href: personCrumb?.getAttribute("href"),
      tagName: personCrumb?.tagName,
      text: personCrumb?.textContent,
    }).toEqual({
      href: `/app/people/${personId}`,
      tagName: "A",
      text: "Ada Lovelace",
    });
    document.querySelector<HTMLButtonElement>("#activity-report-more")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#activity-report-list")?.textContent)
        .toContain("Second page")
    );
  });

  it("appends one bounded report continuation and retires its consumed cursor", async () => {
    document.body.innerHTML =
      `<p id="activity-report-state"></p><h1 id="activity-report-heading"></h1><ol id="activity-report-list"></ol><button id="activity-report-more" hidden>Load more</button>`;
    const note = (index: number) => ({
      body: `Paged note ${String(index).padStart(2, "0")}`,
      createdAt: "2026-08-17T12:30:00.000Z",
      id: `00000000-0000-8000-8000-${String(index).padStart(12, "0")}`,
      isFavorited: false,
      kind: "note" as const,
      participants: [{ id: personId, name: "Ada Lovelace" }],
    });
    const reportUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname.endsWith("/activity-report")) {
          reportUrls.push(url);
          const continued = url.searchParams.get("cursor") === "report-2";
          return Promise.resolve(response({
            items: continued
              ? [note(0)]
              : Array.from({ length: 20 }, (_, index) => note(20 - index)),
            ...(continued ? {} : { nextCursor: "report-2" }),
            person: { id: personId, name: "Ada Lovelace" },
            status: "ready",
          }));
        }
        return Promise.resolve(response(session()));
      }),
    );
    await mountActivityReport(personId);
    const list = document.querySelector<HTMLOListElement>(
      "#activity-report-list",
    )!;
    const more = document.querySelector<HTMLButtonElement>(
      "#activity-report-more",
    )!;
    expect(list.children).toHaveLength(20);
    expect(more.hidden).toBe(false);
    more.click();
    await vi.waitFor(() => expect(list.children).toHaveLength(21));
    expect(reportUrls).toHaveLength(2);
    expect(reportUrls[1]?.searchParams.get("cursor")).toBe("report-2");
    expect(list.textContent).toContain("Paged note 00");
    expect(
      new Set([...list.children].map((entry) => entry.textContent)).size,
    ).toBe(21);
    expect(more.hidden).toBe(true);
    expect(document.querySelector("#activity-report-state")?.textContent)
      .toBe("21 recorded items.");
  });

  it("UXD-009 keeps a failed activity-report crumb truthful and tenant-concealing", async () => {
    todayMarkup();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<nav aria-label="Breadcrumb">
        <a href="/app/people">People</a><span aria-hidden="true">/</span>
        <a data-breadcrumb-person href="/app/people/${personId}"><span data-slot="skeleton" aria-hidden="true"></span><span class="sr-only">Loading person…</span></a><span aria-hidden="true">/</span>
        <span aria-current="page">Activity report</span>
      </nav>
      <p id="activity-report-state"></p><h1 id="activity-report-heading"></h1><ul id="activity-report-list"></ul>`,
    );
    const unauthorized = response({
      detail: "Sign in",
      status: 401,
      title: "Unauthorized",
      type: "about:blank",
    }, 401);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unauthorized)
      .mockResolvedValueOnce(response({
        detail: "Entry unavailable",
        status: 409,
        title: "Application entry unavailable",
        type: "about:blank",
      }, 409))
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({
        detail: "Missing",
        status: 404,
        title: "Not found",
        type: "about:blank",
      }, 404));
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayInteractions();
    expect(document.querySelector("#today-favorite-notes-state")?.textContent)
      .toContain("unavailable");
    expect(document.querySelector("#today-recent-activity-state")?.textContent)
      .toContain("unavailable");
    history.replaceState(
      {},
      "",
      "/app/people/example/activity-report?year=2026",
    );
    await mountActivityReport(personId);
    expect(document.querySelector("#activity-report-state")?.textContent)
      .toContain("not found in this workspace");
    const personCrumb = document.querySelector<HTMLAnchorElement>(
      "[data-breadcrumb-person]",
    );
    expect({
      href: personCrumb?.getAttribute("href"),
      text: personCrumb?.textContent,
    }).toEqual({
      href: `/app/people/${personId}`,
      text: "Person",
    });
  });

  it("keeps report access loss and a real empty period distinct", async () => {
    document.body.innerHTML = `
      <p id="activity-report-state"></p><h1 id="activity-report-heading"></h1><ul id="activity-report-list"></ul>`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        detail: "Sign in",
        status: 401,
        title: "Unauthorized",
        type: "about:blank",
      }, 401))
      .mockResolvedValueOnce(response({
        detail: "Entry unavailable",
        status: 409,
        title: "Application entry unavailable",
        type: "about:blank",
      }, 409))
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({
        items: [],
        person: { id: personId, name: "Ada Lovelace" },
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);
    await mountActivityReport(personId);
    expect(document.querySelector("#activity-report-state")?.textContent)
      .toContain("unavailable");
    await mountActivityReport(personId);
    expect(document.querySelector("#activity-report-state")?.textContent)
      .toContain("No activities or notes for this period");
  });

  it("distinguishes empty Today from a retryable projection outage", async () => {
    todayMarkup();
    let outage = true;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (
        path.endsWith("/favorite-notes") ||
        path.endsWith("/recent-activity")
      ) {
        return Promise.resolve(
          outage
            ? response({
              detail: "Try again",
              status: 503,
              title: "Unavailable",
              type: "about:blank",
            }, 503)
            : response({ items: [], status: "ready" }),
        );
      }
      return Promise.resolve(response(session()));
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayInteractions();
    expect(document.querySelector("#today-favorite-notes-state")?.textContent)
      .toContain("could not be loaded");
    expect(document.querySelector("#today-recent-activity-state")?.textContent)
      .toContain("could not be loaded");
    outage = false;
    await mountTodayInteractions();
    expect(
      document.querySelector<HTMLElement>("#today-favorite-notes-region")
        ?.hidden,
    ).toBe(true);
    expect(document.querySelector("#today-recent-activity-state")?.textContent)
      .toContain("No activities or notes");
  });

  it("keeps projection listeners through two captures and prevents an older Today load from overwriting", async () => {
    todayMarkup();
    document.body.insertAdjacentHTML(
      "beforeend",
      `
      <p id="activity-report-state"></p><h1 id="activity-report-heading"></h1><ul id="activity-report-list"></ul><button id="activity-report-more"></button>
      <p id="person-activities-state"></p><ul id="person-activities-list"></ul>
      <p id="person-notes-state"></p><ul id="person-notes-list"></ul>`,
    );
    let todayCalls = 0;
    let reportCalls = 0;
    let releaseOlder!: (value: Response) => void;
    const older = new Promise<Response>((resolve) => releaseOlder = resolve);
    const interaction = (label: string) => ({
      emotions: [],
      happenedAt: "2026-08-17T12:30:00.000Z",
      id: crypto.randomUUID(),
      kind: "activity",
      participants: [{ id: personId, name: "Ada Lovelace" }],
      summary: label,
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path.endsWith("/favorite-notes")) {
        return Promise.resolve(response({ items: [], status: "ready" }));
      }
      if (path.endsWith("/recent-activity")) {
        todayCalls += 1;
        if (todayCalls === 2) return older;
        const item = interaction(`Today ${todayCalls}`);
        return Promise.resolve(
          response({
            items: [item],
            status: "ready",
          }),
        );
      }
      if (path.endsWith("/activity-report")) {
        reportCalls += 1;
        const item = interaction(`Report ${reportCalls}`);
        return Promise.resolve(
          response({
            items: [item],
            person: { id: personId, name: "Ada" },
            status: "ready",
          }),
        );
      }
      return Promise.resolve(response(session()));
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayInteractions();
    await mountActivityReport(personId);
    await mountPersonInteractions(personId, workspaceId, false, {
      activities: false,
      notes: false,
    });
    globalThis.dispatchEvent(new CustomEvent("kinship:interaction-created"));
    await vi.waitFor(() => expect(todayCalls).toBe(2));
    globalThis.dispatchEvent(new CustomEvent("kinship:interaction-created"));
    await vi.waitFor(() =>
      expect(document.querySelector("#today-recent-activity")?.textContent)
        .toContain("Today 3")
    );
    await vi.waitFor(() => expect(reportCalls).toBeGreaterThanOrEqual(6));
    releaseOlder(response({
      items: [interaction("Older response")],
      status: "ready",
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector("#today-recent-activity")?.textContent)
      .toContain("Today 3");
    expect(document.querySelector("#activity-report-list")?.textContent)
      .toContain("Report");
    expect(document.querySelector("#person-activities-state")?.textContent)
      .toBe("1 recent activity. Listed in the timeline above.");
  });

  it("renders person activity and note sections with archive and hidden states", async () => {
    document.body.innerHTML = `
      <section data-profile-section="activities">
        <p id="person-activities-state"></p><ul id="person-activities-list"></ul>
      </section>
      <section data-profile-section="notes">
        <p id="person-notes-state"></p><ul id="person-notes-list"></ul>
      </section>
      <button data-person-interaction-capture></button>
      <a data-activity-report-link href="/app/people"></a>`;
    const activity = {
      happenedAt: "2026-08-17T12:30:00.000Z",
      id: "activity",
      kind: "activity",
      participants: [{ id: personId, name: "Ada Lovelace" }],
      summary: "Shared lunch",
    };
    const note = {
      body: "Prefers tea",
      createdAt: "2026-08-17T12:31:00.000Z",
      id: "note",
      isFavorited: false,
      kind: "note",
      participants: [{ id: personId, name: "Ada Lovelace" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(response({
        items: [activity, note],
        person: { id: personId, name: "Ada Lovelace" },
        status: "ready",
      })),
    );
    await mountPersonInteractions(personId, workspaceId, true, {
      activities: false,
      notes: true,
    });
    expect(document.querySelector("#person-activities-state")?.textContent)
      .toBe("1 recent activity. Listed in the timeline above.");
    expect(
      document.querySelector<HTMLElement>('[data-profile-section="notes"]')
        ?.dataset.sectionState,
    ).toBe("hidden");
    expect(document.querySelector("#person-notes-state")?.textContent)
      .toContain("hidden");
    expect(
      document.querySelector<HTMLButtonElement>(
        "[data-person-interaction-capture]",
      )?.hidden,
    ).toBe(true);
    expect(
      document.querySelector<HTMLAnchorElement>("[data-activity-report-link]")
        ?.pathname,
    ).toBe(`/app/people/${personId}/activity-report`);
  });

  it("loads kind-scoped profile sections so a page of newer notes cannot conceal an activity", async () => {
    document.body.innerHTML = `
      <section data-profile-section="activities" data-section-state="loading">
        <p id="person-activities-state"></p><ul id="person-activities-list" hidden></ul>
      </section>
      <section data-profile-section="notes" data-section-state="loading">
        <p id="person-notes-state"></p><ul id="person-notes-list" hidden></ul>
      </section>`;
    const requestedKinds: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        const kind = url.searchParams.get("kind") ?? "";
        requestedKinds.push(kind);
        return Promise.resolve(response({
          items: kind === "activity"
            ? [{
              emotions: [],
              happenedAt: "2026-08-17T12:30:00.000Z",
              id: "activity",
              kind: "activity",
              participants: [{ id: personId, name: "Ada Lovelace" }],
              summary: "Shared lunch",
            }]
            : Array.from({ length: 20 }, (_, index) => ({
              body: `Newer note ${index}`,
              createdAt: "2026-08-17T12:31:00.000Z",
              id: `note-${index}`,
              isFavorited: false,
              kind: "note",
              participants: [{ id: personId, name: "Ada Lovelace" }],
            })),
          nextCursor: kind === "note" ? "more-notes" : undefined,
          person: { id: personId, name: "Ada Lovelace" },
          status: "ready",
        }));
      }),
    );

    await mountPersonInteractions(personId, workspaceId, false, {
      activities: false,
      notes: false,
    });

    expect(requestedKinds.sort()).toEqual(["activity", "note"]);
    const activities = document.querySelector<HTMLElement>(
      '[data-profile-section="activities"]',
    )!;
    const activityList = document.querySelector<HTMLUListElement>(
      "#person-activities-list",
    )!;
    expect(activityList.hidden).toBe(true);
    expect(activityList.children).toHaveLength(0);
    expect(document.querySelector("#person-activities-state")?.textContent)
      .toBe("1 recent activity. Listed in the timeline above.");
    expect(activities.dataset.sectionState).toBe("ready");
    const notes = document.querySelector<HTMLElement>(
      '[data-profile-section="notes"]',
    )!;
    const noteList = document.querySelector<HTMLUListElement>(
      "#person-notes-list",
    )!;
    expect(noteList.hidden).toBe(true);
    expect(noteList.children).toHaveLength(0);
    expect(document.querySelector("#person-notes-state")?.textContent)
      .toBe("20 recent notes. Listed in the timeline above.");
    expect(notes.dataset.sectionState).toBe("ready");
  });

  it("renders successful activity and note projections independently when the other request fails", async () => {
    document.body.innerHTML = `
      <section data-profile-section="activities" data-section-state="loading">
        <p id="person-activities-state"></p><ul id="person-activities-list"><li>Saved activity</li></ul>
        <button id="person-activities-retry" aria-controls="person-activities-list" hidden>Retry activities</button>
      </section>
      <section data-profile-section="notes" data-section-state="loading">
        <p id="person-notes-state"></p><ul id="person-notes-list"><li>Saved note</li></ul>
        <button id="person-notes-retry" aria-controls="person-notes-list" hidden>Retry notes</button>
      </section>`;
    const interaction = (kind: "activity" | "note", label: string) =>
      kind === "activity"
        ? {
          activityType: "Shared meal",
          emotions: [{ id: "emotion-joy", name: "Joy" }],
          happenedAt: "2026-08-17T12:30:00.000Z",
          id: label,
          kind,
          participants: [{ id: personId, name: "Ada Lovelace" }],
          summary: label,
        }
        : {
          body: label,
          createdAt: "2026-08-17T12:31:00.000Z",
          id: label,
          isFavorited: false,
          kind,
          participants: [{ id: personId, name: "Ada Lovelace" }],
        };
    const result = (kind: "activity" | "note", label: string) =>
      response({
        items: [interaction(kind, label)],
        person: { id: personId, name: "Ada Lovelace" },
        status: "ready",
      });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const kind = new URL(String(input), "http://localhost").searchParams
          .get(
            "kind",
          );
        return Promise.resolve(
          kind === "activity"
            ? response(
              { detail: "offline", status: 503, title: "Unavailable" },
              503,
            )
            : result("note", "Fresh note"),
        );
      }),
    );
    await mountPersonInteractions(personId, workspaceId, false, {
      activities: false,
      notes: false,
    });
    expect(document.querySelector("#person-activities-state")?.textContent)
      .toContain("could not be loaded");
    expect(
      document.querySelector('[data-profile-section="activities"]')
        ?.getAttribute("data-section-state"),
    ).toBe("error");
    expect(document.querySelector("#person-activities-state")?.textContent)
      .toBe("Activities could not be loaded. Saved activity is unchanged.");
    expect(
      document.querySelector<HTMLButtonElement>("#person-activities-retry")
        ?.hidden,
    ).toBe(false);
    expect(document.querySelector("#person-notes-state")?.textContent)
      .toBe("1 recent note. Listed in the timeline above.");
    expect(
      document.querySelector('[data-profile-section="notes"]')?.getAttribute(
        "data-section-state",
      ),
    ).toBe("ready");

    const firstFetch = fetch as ReturnType<typeof vi.fn>;
    firstFetch.mockImplementation((input: RequestInfo | URL) => {
      const kind = new URL(String(input), "http://localhost").searchParams.get(
        "kind",
      );
      return Promise.resolve(
        result(kind as "activity" | "note", "Retried activity"),
      );
    });
    document.querySelector<HTMLButtonElement>("#person-activities-retry")!
      .click();
    expect(
      document.querySelector('[data-profile-section="activities"]')
        ?.getAttribute("data-section-state"),
    ).toBe("loading");
    await vi.waitFor(() =>
      expect(document.querySelector("#person-activities-state")?.textContent)
        .toBe("1 recent activity. Listed in the timeline above.")
    );
    expect(document.querySelector("#person-activities-state")?.textContent)
      .toBe("1 recent activity. Listed in the timeline above.");
    expect(
      document.querySelector('[data-profile-section="activities"]')
        ?.getAttribute("data-section-state"),
    ).toBe("ready");
    expect(
      document.querySelector('[data-profile-section="activities"]')
        ?.getAttribute("data-section-state"),
    ).toBe("ready");
    expect(document.querySelector("#person-notes-state")?.textContent)
      .toBe("1 recent note. Listed in the timeline above.");

    let noteAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const kind = new URL(String(input), "http://localhost").searchParams
          .get(
            "kind",
          );
        if (kind === "note") noteAttempts += 1;
        return Promise.resolve(
          kind === "note" && noteAttempts === 1
            ? response(
              { detail: "offline", status: 503, title: "Unavailable" },
              503,
            )
            : result(
              kind as "activity" | "note",
              kind === "note" ? "Retried note" : "Fresh activity",
            ),
        );
      }),
    );
    await mountPersonInteractions(personId, workspaceId, false, {
      activities: false,
      notes: false,
    });
    expect(document.querySelector("#person-activities-state")?.textContent)
      .toBe("1 recent activity. Listed in the timeline above.");
    expect(document.querySelector("#person-notes-state")?.textContent)
      .toContain("could not be loaded");
    expect(
      document.querySelector('[data-profile-section="notes"]')?.getAttribute(
        "data-section-state",
      ),
    ).toBe("error");
    expect(document.querySelector("#person-notes-state")?.textContent)
      .toBe("Notes could not be loaded. Saved notes are unchanged.");
    expect(
      document.querySelector<HTMLButtonElement>("#person-notes-retry")?.hidden,
    ).toBe(false);
    document.querySelector<HTMLButtonElement>("#person-notes-retry")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#person-notes-state")?.textContent)
        .toBe("1 recent note. Listed in the timeline above.")
    );
    expect(document.querySelector("#person-activities-state")?.textContent)
      .toBe("1 recent activity. Listed in the timeline above.");
    expect(
      document.querySelector('[data-profile-section="activities"]')
        ?.getAttribute("data-section-state"),
    ).toBe("ready");
  });

  it("keeps a newer profile retry when an older retry resolves last", async () => {
    document.body.innerHTML = `
      <section data-profile-section="activities" data-section-state="loading">
        <p id="person-activities-state"></p><ul id="person-activities-list"></ul>
        <button id="person-activities-retry" aria-controls="person-activities-list" hidden>Retry activities</button>
      </section>
      <section data-profile-section="notes" data-section-state="loading">
        <p id="person-notes-state"></p><ul id="person-notes-list"></ul>
        <button id="person-notes-retry" aria-controls="person-notes-list" hidden>Retry notes</button>
      </section>`;
    let releaseOlder!: (value: Response) => void;
    const older = new Promise<Response>((resolve) => releaseOlder = resolve);
    let activityCalls = 0;
    const page = (label: string, count: number) =>
      response({
        items: Array.from({ length: count }, (_, index) => ({
          emotions: [],
          happenedAt: "2026-08-17T12:30:00.000Z",
          id: `${label}-${index}`,
          kind: "activity",
          participants: [{ id: personId, name: "Ada Lovelace" }],
          summary: `${label} ${index}`,
        })),
        person: { id: personId, name: "Ada Lovelace" },
        status: "ready",
      });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const kind = new URL(String(input), "http://localhost").searchParams
          .get(
            "kind",
          );
        if (kind === "note") {
          return Promise.resolve(response({
            items: [],
            person: { id: personId, name: "Ada" },
            status: "ready",
          }));
        }
        activityCalls += 1;
        if (activityCalls === 1) {
          return Promise.resolve(
            response(
              { detail: "offline", status: 503, title: "Unavailable" },
              503,
            ),
          );
        }
        if (activityCalls === 2) return older;
        return Promise.resolve(page("Newest retry", 2));
      }),
    );
    await mountPersonInteractions(personId, workspaceId, false, {
      activities: false,
      notes: false,
    });
    const retry = document.querySelector<HTMLButtonElement>(
      "#person-activities-retry",
    )!;
    retry.click();
    expect(
      document.querySelector('[data-profile-section="activities"]')
        ?.getAttribute("data-section-state"),
    ).toBe("loading");
    retry.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#person-activities-state")?.textContent)
        .toBe("2 recent activities. Listed in the timeline above.")
    );
    releaseOlder(page("Older retry", 1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector("#person-activities-state")?.textContent)
      .toBe("2 recent activities. Listed in the timeline above.");
    expect(
      document.querySelector('[data-profile-section="activities"]')
        ?.getAttribute("data-section-state"),
    ).toBe("ready");
    expect(
      document.querySelector('[data-profile-section="notes"]')?.getAttribute(
        "data-section-state",
      ),
    ).toBe("ready");
  });

  it("returns only the retried profile section from loading to error", async () => {
    document.body.innerHTML = `
      <section data-profile-section="activities" data-section-state="loading">
        <p id="person-activities-state"></p><ul id="person-activities-list"></ul>
        <button id="person-activities-retry" aria-controls="person-activities-list" hidden>Retry activities</button>
      </section>
      <section data-profile-section="notes" data-section-state="loading">
        <p id="person-notes-state"></p><ul id="person-notes-list"></ul>
        <button id="person-notes-retry" aria-controls="person-notes-list" hidden>Retry notes</button>
      </section>`;
    let releaseRetry!: (value: Response) => void;
    const retryResponse = new Promise<Response>((resolve) => {
      releaseRetry = resolve;
    });
    let activityCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const kind = new URL(String(input), "http://localhost").searchParams
          .get("kind");
        if (kind === "note") {
          return Promise.resolve(response({
            items: [],
            person: { id: personId, name: "Ada" },
            status: "ready",
          }));
        }
        activityCalls += 1;
        if (activityCalls === 2) return retryResponse;
        return Promise.resolve(response(
          { detail: "offline", status: 503, title: "Unavailable" },
          503,
        ));
      }),
    );
    await mountPersonInteractions(personId, workspaceId, false, {
      activities: false,
      notes: false,
    });
    const activitySection = document.querySelector<HTMLElement>(
      '[data-profile-section="activities"]',
    )!;
    const noteSection = document.querySelector<HTMLElement>(
      '[data-profile-section="notes"]',
    )!;
    expect(activitySection.dataset.sectionState).toBe("error");
    expect(noteSection.dataset.sectionState).toBe("ready");
    document.querySelector<HTMLButtonElement>("#person-activities-retry")!
      .click();
    expect(activitySection.dataset.sectionState).toBe("loading");
    expect(noteSection.dataset.sectionState).toBe("ready");
    releaseRetry(response(
      { detail: "still offline", status: 503, title: "Unavailable" },
      503,
    ));
    await vi.waitFor(() =>
      expect(activitySection.dataset.sectionState).toBe("error")
    );
    expect(noteSection.dataset.sectionState).toBe("ready");
  });

  it("prevents an older overlapping profile projection from replacing both newer sections", async () => {
    document.body.innerHTML = `
      <p id="person-activities-state"></p><ul id="person-activities-list"></ul>
      <p id="person-notes-state"></p><ul id="person-notes-list"></ul>`;
    let releaseActivity!: (value: Response) => void;
    let releaseNote!: (value: Response) => void;
    const olderActivity = new Promise<Response>((resolve) =>
      releaseActivity = resolve
    );
    const olderNote = new Promise<Response>((resolve) => releaseNote = resolve);
    let calls = 0;
    const result = (
      kind: "activity" | "note",
      label: string,
      count: number,
    ) =>
      response({
        items: Array.from({ length: count }, (_, index) =>
          kind === "activity"
            ? {
              happenedAt: "2026-08-17T12:30:00.000Z",
              id: `${label}-${index}`,
              kind,
              participants: [{ id: personId, name: "Ada Lovelace" }],
              summary: `${label} ${index}`,
            }
            : {
              body: `${label} ${index}`,
              createdAt: "2026-08-17T12:31:00.000Z",
              id: `${label}-${index}`,
              isFavorited: false,
              kind,
              participants: [{ id: personId, name: "Ada Lovelace" }],
            }),
        person: { id: personId, name: "Ada Lovelace" },
        status: "ready",
      });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (
        url.pathname.endsWith("/favorite-notes") ||
        url.pathname.endsWith("/recent-activity")
      ) {
        return Promise.resolve(response({
          items: [],
          status: "ready",
        }));
      }
      if (!url.pathname.endsWith("/activity-report")) {
        return Promise.resolve(response(session()));
      }
      const kind = url.searchParams.get("kind") as "activity" | "note";
      if (!url.pathname.includes(otherId)) {
        return Promise.resolve(response({
          items: [],
          person: { id: personId, name: "Ada Lovelace" },
          status: "ready",
        }));
      }
      calls += 1;
      if (calls === 3) return olderActivity;
      if (calls === 4) return olderNote;
      return Promise.resolve(
        result(kind, calls <= 2 ? "Initial" : "Newest", calls <= 2 ? 1 : 2),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountPersonInteractions(otherId, workspaceId, false, {
      activities: false,
      notes: false,
    });
    globalThis.dispatchEvent(new CustomEvent("kinship:interaction-created"));
    await vi.waitFor(() => expect(calls).toBe(4));
    globalThis.dispatchEvent(new CustomEvent("kinship:interaction-created"));
    await vi.waitFor(() =>
      expect(document.querySelector("#person-activities-state")?.textContent)
        .toBe("2 recent activities. Listed in the timeline above.")
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#person-notes-state")?.textContent)
        .toBe("2 recent notes. Listed in the timeline above.")
    );
    releaseActivity(result("activity", "Older", 3));
    releaseNote(result("note", "Older", 3));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector("#person-activities-state")?.textContent)
      .toBe("2 recent activities. Listed in the timeline above.");
    expect(document.querySelector("#person-notes-state")?.textContent)
      .toBe("2 recent notes. Listed in the timeline above.");
  });

  it("hides each disabled profile interaction card and keeps the other intended action", async () => {
    document.body.innerHTML = `
      <nav><ul>
        <li><a data-section-link="activities"></a></li>
        <li><a data-section-link="notes"></a></li>
      </ul></nav>
      <section data-profile-section="activities">
        <p id="person-activities-state"></p><ul id="person-activities-list"></ul>
        <button data-person-interaction-capture data-interaction-intended-kind="activity"></button>
      </section>
      <section data-profile-section="notes">
        <p id="person-notes-state"></p><ul id="person-notes-list"></ul>
        <button data-person-interaction-capture data-interaction-intended-kind="note"></button>
      </section>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        items: [],
        person: { id: personId, name: "Ada Lovelace" },
        status: "ready",
      })),
    );

    await mountPersonInteractions(personId, workspaceId, false, {
      activities: true,
      notes: false,
    });
    expect(
      document.querySelector<HTMLElement>(
        '[data-profile-section="activities"]',
      )?.hidden,
    ).toBe(true);
    expect(
      document.querySelector('[data-profile-section="activities"]')
        ?.getAttribute("data-section-state"),
    ).toBe("hidden");
    expect(
      document.querySelector<HTMLElement>('[data-section-link="activities"]')
        ?.closest("li")?.hidden,
    ).toBe(true);
    expect(
      document.querySelector<HTMLElement>('[data-profile-section="notes"]')
        ?.hidden,
    ).toBe(false);
    expect(
      document.querySelector('[data-profile-section="notes"]')?.getAttribute(
        "data-section-state",
      ),
    ).toBe("ready");
    expect(
      document.querySelector<HTMLButtonElement>(
        '[data-interaction-intended-kind="note"]',
      )?.hidden,
    ).toBe(false);
  });

  it("keeps profile interaction shortcuts aligned with matching lifecycle events", async () => {
    document.body.innerHTML = `
      <section data-profile-section="activities">
        <p id="person-activities-state"></p><ul id="person-activities-list"></ul>
        <button data-person-interaction-capture data-interaction-intended-kind="activity">Log activity</button>
      </section>
      <section data-profile-section="notes">
        <p id="person-notes-state"></p><ul id="person-notes-list"></ul>
        <button data-person-interaction-capture data-interaction-intended-kind="note">Add note</button>
      </section>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        items: [],
        person: { id: personId, name: "Ada Lovelace" },
        status: "ready",
      })),
    );
    const activity = document.querySelector<HTMLButtonElement>(
      '[data-interaction-intended-kind="activity"]',
    )!;
    const note = document.querySelector<HTMLButtonElement>(
      '[data-interaction-intended-kind="note"]',
    )!;
    const lifecycle = (targetPersonId: string, archived: boolean) =>
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: {
            archived,
            personId: targetPersonId,
            state: archived ? "archived" : "active",
          },
        }),
      );

    await mountPersonInteractions(personId, workspaceId, false, {
      activities: false,
      notes: true,
    });
    expect(activity.hidden).toBe(false);
    expect(activity.disabled).toBe(false);
    expect(note.hidden).toBe(true);
    expect(note.disabled).toBe(true);
    lifecycle(otherId, true);
    expect(activity.hidden).toBe(false);
    lifecycle(personId, true);
    lifecycle(personId, true);
    expect(activity.hidden).toBe(true);
    expect(activity.disabled).toBe(true);
    expect(note.hidden).toBe(true);
    expect(note.disabled).toBe(true);
    lifecycle(personId, false);
    expect(activity.hidden).toBe(false);
    expect(activity.disabled).toBe(false);
    expect(note.hidden).toBe(true);
    expect(note.disabled).toBe(true);

    await mountPersonInteractions(otherId, workspaceId, true, {
      activities: false,
      notes: true,
    });
    expect(activity.hidden).toBe(true);
    expect(activity.disabled).toBe(true);
    lifecycle(otherId, false);
    expect(activity.hidden).toBe(false);
    expect(activity.disabled).toBe(false);
    expect(note.hidden).toBe(true);
    expect(note.disabled).toBe(true);
    lifecycle(personId, true);
    expect(activity.hidden).toBe(false);
    expect(activity.disabled).toBe(false);
  });

  it("contains person projection outages without replacing saved data", async () => {
    document.body.innerHTML = `
      <p id="person-activities-state"></p><ul id="person-activities-list"><li>Saved activity</li></ul>
      <p id="person-notes-state"></p><ul id="person-notes-list"><li>Saved note</li></ul>`;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")));
    await mountPersonInteractions(personId, workspaceId, false, {
      activities: false,
      notes: false,
    });
    expect(document.querySelector("#person-activities-state")?.textContent)
      .toContain("could not be loaded");
    expect(document.querySelector("#person-activities-list")?.textContent)
      .toContain("Saved activity");
  });

  it("keeps dirty capture during workspace switch and leaves failures retryable", async () => {
    captureMarkup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(
        response({
          lifecycle: "active",
          people: [{
            givenName: "Ada",
            id: personId,
            isPartial: false,
            isStarred: false,
            lifecycle: "active",
            tagCount: 0,
            tags: [],
          }],
          status: "ready",
        }),
      )
      .mockResolvedValueOnce(
        response({
          activityTypes: [],
          availability: { activity: true, note: true },
          emotions: [],
          status: "ready",
        }),
      )
      .mockResolvedValueOnce(
        response({
          code: "unavailable",
          detail: "Try again",
          status: 503,
          title: "Unavailable",
          type: "about:blank",
        }, 503),
      )
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    await mountInteractionCapture();
    await openReadyCapture("[data-quick-capture]");
    const summary = document.querySelector<HTMLInputElement>("[name=summary]")!;
    summary.value = "Unsaved";
    summary.dispatchEvent(new Event("input", { bubbles: true }));
    const switchEvent = new CustomEvent("kinship:workspace-change-request", {
      cancelable: true,
    });
    expect(globalThis.dispatchEvent(switchEvent)).toBe(false);
    const form = document.querySelector<HTMLFormElement>(
      "#interaction-capture-form",
    )!;
    (form.elements.namedItem("participantIds") as HTMLSelectElement).options[0]!
      .selected = true;
    (form.elements.namedItem("happenedAt") as HTMLInputElement).value =
      "2026-08-16T18:15";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const firstAttempt = JSON.parse(String(fetchMock.mock.calls[3]![1]?.body));
    await vi.waitFor(() =>
      expect(
        (form.querySelector("button[type=submit]") as HTMLButtonElement)
          .disabled,
      )
        .toBe(false)
    );
    expect(summary.value).toBe("Unsaved");
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(JSON.parse(String(fetchMock.mock.calls[4]![1]?.body))).toEqual(
      firstAttempt,
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#interaction-capture-status")?.textContent)
        .toContain("outcome is uncertain")
    );
  });
});
