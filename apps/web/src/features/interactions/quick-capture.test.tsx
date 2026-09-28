// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMemberPreferences,
  type ResolvedMemberPreferences,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  type ApiAnswer,
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  type StubbedApi,
  unreachable,
} from "../../testing/api.ts";
import { expectNoAxeViolations } from "../../testing/a11y.ts";
import { ids, preferences, workspaceSession } from "../../testing/fixtures.ts";
import {
  chooseOptions,
  drawShell,
  element,
  mountSettled,
} from "../../testing/render.tsx";
import { mountQuickCapture, QUICK_CAPTURE_ISLAND } from "./mount.tsx";

vi.mock(
  "../../../../../packages/contracts/generated/auth-client.ts",
  async (original) => ({
    ...await original<Record<string, unknown>>(),
    getMemberPreferences: vi.fn(),
  }),
);

const personId = ids.person;
const otherId = "00000000-0000-4000-8000-000000000101";
const SESSION = "GET /api/v1/session";
const PEOPLE = "GET /api/v1/people";
const OPTIONS = "GET /api/v1/interaction-options";
const SAVE = "POST /api/v1/interactions";
const session = workspaceSession({
  member: { id: ids.member, role: "member" },
});

const savedPreferences = (
  contactNameOrder: ResolvedMemberPreferences["contactNameOrder"],
) => ({
  ok: true as const,
  value: {
    preferences: preferences({ contactNameOrder }),
    status: "ready" as const,
  },
});

beforeEach(() => {
  vi.mocked(getMemberPreferences).mockReset().mockResolvedValue(
    savedPreferences("given_family_nickname"),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
});

function person(
  id: string,
  givenName: string,
  extra: Record<string, unknown> = {},
) {
  return {
    givenName,
    id,
    isPartial: false,
    isStarred: false,
    lifecycle: "active",
    tagCount: 0,
    tags: [],
    ...extra,
  };
}

const ada = () => person(personId, "Ada");
const grace = () => person(otherId, "Grace");

const peoplePage = (
  people: readonly unknown[] = [ada()],
  extra: Record<string, unknown> = {},
) => jsonResponse({ lifecycle: "active", people, status: "ready", ...extra });

const vocabulary = (extra: Record<string, unknown> = {}) =>
  jsonResponse({
    activityTypes: [],
    availability: { activity: true, note: true },
    emotions: [],
    status: "ready",
    ...extra,
  });

const savedActivity = (
  participants: readonly { readonly id: string; readonly name: string }[] = [
    { id: personId, name: "Ada" },
  ],
  status = 201,
) =>
  jsonResponse({
    record: {
      emotions: [],
      happenedAt: "2026-08-16T18:15:00.000Z",
      id: "00000000-0000-4000-8000-000000000900",
      kind: "activity",
      participants,
      summary: "Immutable intent",
    },
    status: "created",
  }, status);

const savedNote = () =>
  jsonResponse({
    record: {
      body: "Safe note",
      createdAt: "2026-08-17T12:31:00.000Z",
      id: "00000000-0000-4000-8000-000000000901",
      isFavorited: false,
      kind: "note",
      person: { id: personId, name: "Ada" },
    },
    status: "created",
  }, 201);

/** The page as the layout draws it, with a person page's two shortcuts. */
function shell(extra = ""): void {
  drawShell(`
    <header><button data-quick-capture data-interaction-capture-ready="false" type="button" aria-label="Quick capture" disabled>Quick capture</button></header>
    <main>
      <button data-quick-capture data-interaction-intended-kind="activity" type="button">Log activity</button>
      <button data-quick-capture data-interaction-intended-kind="note" type="button">Add note</button>
      ${extra}
    </main>
    <div class="contents" data-quick-capture-root></div>`);
}

function stub(routes: Record<string, ApiAnswer | readonly ApiAnswer[]>) {
  return stubApi({
    [SESSION]: jsonResponse(session),
    [PEOPLE]: peoplePage(),
    [OPTIONS]: vocabulary(),
    ...routes,
  });
}

const headerOpener = () =>
  element<HTMLButtonElement>("header [data-quick-capture]");
const activityOpener = () =>
  element<HTMLButtonElement>(
    'main [data-interaction-intended-kind="activity"]',
  );
const noteOpener = () =>
  element<HTMLButtonElement>('main [data-interaction-intended-kind="note"]');
const dialog = () => element("#interaction-capture-dialog");
const form = () => element<HTMLFormElement>("#interaction-capture-form");
const status = () => element("#interaction-capture-status");
const field = <T extends HTMLElement>(name: string) =>
  element<T>(`#interaction-capture-form [name="${name}"]`);
const kind = () => field<HTMLSelectElement>("kind");
const participants = () => field<HTMLSelectElement>("participantIds");
const happenedAt = () => field<HTMLInputElement>("happenedAt");
const summary = () => field<HTMLInputElement>("summary");
const submitButton = () =>
  element<HTMLButtonElement>('#interaction-capture-form [type="submit"]');
const cancel = () =>
  element<HTMLButtonElement>(
    "#interaction-capture-form [data-interaction-cancel]",
  );
const isOpen = () => !dialog().hidden;
const optionNames = (select: HTMLSelectElement) =>
  [...select.options].map((entry) => entry.textContent);
const chosen = (select: HTMLSelectElement) =>
  [...select.options].filter((entry) => entry.selected).map((entry) =>
    entry.value
  );
const saves = (api: StubbedApi) =>
  api.requests().filter((request) => request.method === "POST").map((
    request,
  ) => request.body as Record<string, unknown>);
const count = (api: StubbedApi, path: string) =>
  api.requests().filter((request) =>
    request.method === "GET" && request.url.pathname === path
  ).length;

/** Mounts Quick capture and waits until it has wired its openers. */
async function mountCapture(): Promise<() => void> {
  const unmount = await mountSettled(() =>
    Promise.resolve(mountQuickCapture())
  );
  await waitFor(() =>
    expect(headerOpener().dataset.interactionCaptureReady).toBe("true")
  );
  return unmount;
}

/** Opens with `opener` and waits until the draft can be saved. */
async function openReady(opener: HTMLButtonElement): Promise<void> {
  fireEvent.click(opener);
  await waitFor(() => {
    expect(form().hasAttribute("aria-busy")).toBe(false);
    expect(submitButton().disabled).toBe(false);
  });
}

const type = (target: HTMLElement, value: string) =>
  fireEvent.change(target, { target: { value } });
const search = (name: string, value: string) =>
  fireEvent.change(field(name), { target: { value } });
const submit = () => fireEvent.submit(form());

/** A reconnect opener as Today adds it once its list renders. */
function reconnectOpener(id = otherId): HTMLButtonElement {
  const opener = document.createElement("button");
  opener.type = "button";
  opener.disabled = true;
  opener.dataset.quickCapture = "";
  opener.dataset.todayReconnectCapture = "";
  opener.dataset.interactionIntendedKind = "activity";
  opener.dataset.interactionPersonId = id;
  opener.dataset.interactionCaptureReady = "false";
  opener.textContent = "Log interaction";
  document.querySelector("main")!.append(opener);
  return opener;
}

/** Opens for an activity with Ada chosen, at a fixed time. */
async function prepareActivity(): Promise<void> {
  await openReady(activityOpener());
  chooseOptions(participants(), [personId]);
  type(happenedAt(), "2026-08-16T18:15");
  type(summary(), "Immutable intent");
}

describe("INTERACTION-001 Quick capture", () => {
  it("REL-039 ships every static opener disabled until Quick capture wires it", () => {
    const sources = [
      "apps/web/src/layouts/ApplicationLayout.astro",
      "apps/web/src/components/person/PersonHero.astro",
      "apps/web/src/components/person/InteractionSection.astro",
      "apps/web/src/pages/internal/activity-report-shell.astro",
    ];
    for (const path of sources) {
      const openers = [
        ...readFileSync(path, "utf8").matchAll(/<button\b[^>]*>/g),
      ].map(([tag]) => tag).filter((tag) => /\bdata-quick-capture\b/.test(tag));
      expect(openers.length, path).toBeGreaterThan(0);
      for (const tag of openers) {
        expect(tag, path).toMatch(/\sdisabled[\s>]/);
        expect(tag, path).toContain('data-interaction-capture-ready="false"');
      }
    }
  });

  it("does nothing when the page has no Quick capture root", () => {
    drawShell("<main></main>");
    const api = stub({});
    const unmount = mountQuickCapture();
    unmount();
    expect(document.body.textContent).toBe("");
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("wires quick capture before loading and reuses first-open options", async () => {
    shell();
    const api = stub({});
    expect(headerOpener().disabled).toBe(true);
    await mountCapture();
    const root = element("[data-quick-capture-root]");
    expect(root.dataset.island).toBe(QUICK_CAPTURE_ISLAND);
    expect(root.hasAttribute("data-island-ready")).toBe(true);
    expect(count(api, "/api/v1/people")).toBe(0);
    expect(count(api, "/api/v1/interaction-options")).toBe(0);
    for (const opener of [headerOpener(), activityOpener(), noteOpener()]) {
      expect(opener.disabled).toBe(false);
      expect(opener.dataset.interactionCaptureReady).toBe("true");
    }
    expect(isOpen()).toBe(false);

    await openReady(activityOpener());
    expect(
      screen.getByRole("dialog", { name: "Record an activity or note" }),
    ).toBe(dialog());
    fireEvent.click(cancel());
    expect(isOpen()).toBe(false);
    fireEvent.click(activityOpener());
    await waitFor(() => expect(isOpen()).toBe(true));
    expect(count(api, "/api/v1/people")).toBe(1);
    expect(count(api, "/api/v1/interaction-options")).toBe(1);
    await expectNoAxeViolations(dialog());
  });

  it("disables an opener another surface hides, and leaves unchanged openers untouched", async () => {
    shell();
    stub({});
    await mountCapture();
    const writes: MutationRecord[] = [];
    const watch = new MutationObserver((records) => writes.push(...records));
    watch.observe(headerOpener(), { attributes: true });
    document.querySelector("main")!.append(document.createElement("p"));
    await waitFor(() => expect(noteOpener().disabled).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writes).toEqual([]);
    noteOpener().hidden = true;
    await waitFor(() => expect(noteOpener().disabled).toBe(true));
    noteOpener().hidden = false;
    await waitFor(() => expect(noteOpener().disabled).toBe(false));
    watch.disconnect();
  });

  it("APR-008 applies saved name order to initial and searched capture participants", async () => {
    shell();
    vi.mocked(getMemberPreferences).mockResolvedValue(
      savedPreferences("family_given_nickname"),
    );
    const api = stub({
      [PEOPLE]: [
        peoplePage([person(otherId, "Grace", { familyName: "Hopper" })]),
        peoplePage([person(personId, "Ada", { familyName: "Lovelace" })]),
      ],
    });
    await mountCapture();
    await openReady(headerOpener());
    expect(optionNames(participants())).toEqual(["Hopper Grace"]);
    search("participantSearch", "Ada");
    await waitFor(() =>
      expect(optionNames(participants())).toEqual(["Lovelace Ada"])
    );
    expect(getMemberPreferences).toHaveBeenCalledWith(ids.workspace);
    expect(api.calls()).toContain(
      "GET /api/v1/people?limit=20&search=Ada&starredFirst=true",
    );
  });

  it("PEOPLE-007 draws each chosen participant with their avatar", async () => {
    shell();
    stub({
      [PEOPLE]: peoplePage([
        person(personId, "Ada", {
          avatar: { color: "#1f6f5c" },
          familyName: "Lovelace",
        }),
        grace(),
      ]),
    });
    await mountCapture();
    await openReady(headerOpener());
    const strip = () =>
      element("#interaction-capture-form [data-participants-chosen]");
    expect(strip().hidden).toBe(true);
    chooseOptions(participants(), [personId, otherId]);
    await waitFor(() => expect(strip().hidden).toBe(false));
    expect(strip().getAttribute("aria-label")).toBe("Chosen participants");
    const avatars = [
      ...strip().querySelectorAll<HTMLElement>("[data-slot=avatar]"),
    ];
    expect(avatars.map((avatar) => avatar.textContent)).toEqual(["AL", "G"]);
    expect(avatars[0]!.style.backgroundColor).toBe("#1f6f5c");
    expect(strip().textContent).toContain("Ada Lovelace");
  });

  it("keeps the opened quick capture form gated until options are ready", async () => {
    shell();
    const people = deferred<Response>();
    const options = deferred<Response>();
    const api = stub({ [OPTIONS]: options.promise, [PEOPLE]: people.promise });
    await mountCapture();
    expect(api.calls()).toEqual(["GET /api/v1/session"]);
    fireEvent.click(headerOpener());
    await waitFor(() => expect(api.calls()).toHaveLength(3));
    expect(isOpen()).toBe(true);
    expect(form().getAttribute("aria-busy")).toBe("true");
    expect(status().textContent).toBe("Loading quick capture options…");
    expect(submitButton().disabled).toBe(true);
    expect(participants().disabled).toBe(true);
    expect(kind().disabled).toBe(true);
    expect(cancel().disabled).toBe(false);
    people.resolve(peoplePage([]));
    options.resolve(vocabulary());
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    expect(kind().disabled).toBe(false);
    expect(document.activeElement).toBe(kind());
    expect(headerOpener().disabled).toBe(false);
  });

  it("fails session closed but keeps option failures retryable in the dialog", async () => {
    shell();
    stubApi({
      [SESSION]: problemResponse(401),
      "POST /api/v1/application-entry": problemResponse(409),
    });
    const unmount = await mountSettled(() =>
      Promise.resolve(mountQuickCapture())
    );
    await waitFor(() =>
      expect(status().textContent).toContain("Sign in again")
    );
    expect(headerOpener().disabled).toBe(true);
    expect(headerOpener().dataset.interactionCaptureReady).toBe("false");
    unmount();

    shell();
    const api = stub({
      [OPTIONS]: [problemResponse(503), vocabulary(), vocabulary()],
      [PEOPLE]: [peoplePage(), peoplePage()],
    });
    await mountCapture();
    fireEvent.click(headerOpener());
    await waitFor(() =>
      expect(status().textContent).toBe(
        "Quick capture options could not be loaded. Close and open Quick capture to try again.",
      )
    );
    expect(isOpen()).toBe(true);
    expect(document.activeElement).toBe(status());
    expect(headerOpener().disabled).toBe(false);
    expect(submitButton().disabled).toBe(true);
    fireEvent.click(cancel());
    await openReady(headerOpener());
    expect(api.calls()).toHaveLength(5);
  });

  it("says Quick capture is unavailable when the session cannot be reached", async () => {
    shell();
    stubApi({ [SESSION]: unreachable });
    await mountSettled(() => Promise.resolve(mountQuickCapture()));
    await waitFor(() =>
      expect(status().textContent).toBe(
        "Quick capture is temporarily unavailable.",
      )
    );
    expect(headerOpener().disabled).toBe(true);
    fireEvent.click(headerOpener());
    expect(isOpen()).toBe(false);
  });

  it("keeps activity and note availability independent and removes occurrence time from notes", async () => {
    shell();
    stub({
      [OPTIONS]: vocabulary({ availability: { activity: false, note: true } }),
    });
    await mountCapture();
    await openReady(noteOpener());
    expect(kind().value).toBe("note");
    expect(kind().options[0]!.disabled).toBe(true);
    expect(kind().options[1]!.disabled).toBe(false);
    expect(happenedAt().disabled).toBe(true);
    expect(happenedAt().required).toBe(false);
    expect(happenedAt().closest("label")!.hidden).toBe(true);
    expect(participants().multiple).toBe(false);
    expect(noteOpener().disabled).toBe(false);
    expect(activityOpener().disabled).toBe(false);
    const hiddenModuleReconnect = reconnectOpener();
    await waitFor(() =>
      expect(hiddenModuleReconnect.dataset.interactionCaptureReady).toBe(
        "true",
      )
    );
    expect(hiddenModuleReconnect.disabled).toBe(false);
  });

  it("explains a kind turned off in personalization and allows only Cancel", async () => {
    shell();
    stub({
      [OPTIONS]: vocabulary({ availability: { activity: true, note: false } }),
    });
    await mountCapture();
    await openReady(activityOpener());
    expect(kind().value).toBe("activity");
    expect(kind().options[1]!.disabled).toBe(true);
    fireEvent.click(cancel());
    expect(noteOpener().disabled).toBe(false);
    fireEvent.click(noteOpener());
    await waitFor(() =>
      expect(status().textContent).toBe(
        "This interaction kind is hidden in workspace personalization.",
      )
    );
    expect(submitButton().disabled).toBe(true);
    expect(summary().disabled).toBe(true);
    expect(cancel().disabled).toBe(false);
    fireEvent.click(cancel());
  });

  it("explains that both kinds are turned off in personalization", async () => {
    shell();
    stub({
      [OPTIONS]: vocabulary({ availability: { activity: false, note: false } }),
    });
    await mountCapture();
    fireEvent.click(headerOpener());
    await waitFor(() =>
      expect(status().textContent).toContain(
        "hidden in workspace personalization",
      )
    );
    expect(submitButton().disabled).toBe(true);
  });

  it("rejects a blank activity occurrence before saving without affecting notes", async () => {
    shell();
    const api = stub({ [SAVE]: savedNote() });
    await mountCapture();
    await openReady(activityOpener());
    chooseOptions(participants(), [personId]);
    type(happenedAt(), "");
    submit();
    await waitFor(() =>
      expect(status().textContent).toBe(
        "Enter a valid occurrence date and time.",
      )
    );
    expect(saves(api)).toHaveLength(0);
    expect(happenedAt().getAttribute("aria-invalid")).toBe("true");
    expect(element("#interaction-happened-at-error").textContent).toBe(
      "Enter a valid occurrence date and time.",
    );
    expect(document.activeElement).toBe(happenedAt());
    expect(submitButton().disabled).toBe(false);

    fireEvent.change(kind(), { target: { value: "note" } });
    expect(happenedAt().hasAttribute("aria-invalid")).toBe(false);
    type(field("body"), "Safe note");
    submit();
    await waitFor(() => expect(status().textContent).toBe("Note saved."));
    expect(saves(api)).toEqual([{
      body: "Safe note",
      isFavorited: false,
      kind: "note",
      personId,
      requestId: expect.any(String),
    }]);
  });

  it("opens profile-local capture with its explicit intended kind", async () => {
    shell();
    stub({});
    await mountCapture();
    await openReady(noteOpener());
    expect(kind().value).toBe("note");
    expect(isOpen()).toBe(true);
    fireEvent.click(activityOpener());
    await waitFor(() => expect(kind().value).toBe("activity"));
  });

  it("activates a ready profile-local opener once with Enter or Space", async () => {
    shell();
    const api = stub({});
    await mountCapture();
    noteOpener().focus();
    expect(fireEvent.keyDown(noteOpener(), { key: "Enter" })).toBe(false);
    fireEvent.click(noteOpener());
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    expect(kind().value).toBe("note");
    expect(count(api, "/api/v1/people")).toBe(1);
    fireEvent.keyDown(noteOpener(), { key: "Enter", repeat: true });

    fireEvent.click(cancel());
    expect(fireEvent.keyDown(activityOpener(), { key: " " })).toBe(false);
    await waitFor(() => expect(isOpen()).toBe(true));
    expect(kind().value).toBe("activity");
    fireEvent.click(cancel());
    fireEvent.keyDown(activityOpener(), { key: "Tab" });
    fireEvent.keyDown(activityOpener(), { key: " ", repeat: true });
    expect(isOpen()).toBe(false);
  });

  it("handles Escape with clean, dirty, and saving capture state", async () => {
    shell();
    const save = deferred<Response>();
    const api = stub({ [SAVE]: save.promise });
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    await mountCapture();
    const escape = () =>
      fireEvent.keyDown(document.activeElement!, {
        key: "Escape",
      });

    await openReady(activityOpener());
    escape();
    await waitFor(() => expect(isOpen()).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(activityOpener()));
    expect(confirm).not.toHaveBeenCalled();

    await openReady(activityOpener());
    type(summary(), "Draft retained after Escape");
    summary().focus();
    confirm.mockReturnValueOnce(false);
    escape();
    expect(confirm).toHaveBeenCalledWith("Discard this unsaved interaction?");
    expect(isOpen()).toBe(true);
    expect(summary().value).toBe("Draft retained after Escape");
    expect(document.activeElement).toBe(summary());

    confirm.mockReturnValueOnce(true);
    escape();
    await waitFor(() => expect(isOpen()).toBe(false));
    expect(summary().value).toBe("");
    await waitFor(() => expect(document.activeElement).toBe(activityOpener()));

    await openReady(activityOpener());
    chooseOptions(participants(), [personId]);
    type(summary(), "Saving cannot be escaped");
    submit();
    await waitFor(() => expect(saves(api)).toHaveLength(1));
    confirm.mockClear();
    fireEvent.keyDown(summary(), { key: "Escape" });
    fireEvent.click(cancel());
    expect(isOpen()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    save.resolve(savedActivity());
    await waitFor(() => expect(status().textContent).toBe("Activity saved."));
    expect(isOpen()).toBe(true);
    expect(document.activeElement).toBe(submitButton());
    expect(saves(api)).toHaveLength(1);
  });

  it("keeps one pending capture owner when mounted again and settles accepted once", async () => {
    shell();
    const save = deferred<Response>();
    const api = stub({ [SAVE]: save.promise });
    const created = vi.fn();
    const timeline = vi.fn();
    globalThis.addEventListener("kinship:interaction-created", created);
    document.addEventListener("person-timeline-changed", timeline);
    await mountCapture();
    await prepareActivity();
    submit();
    await waitFor(() => expect(saves(api)).toHaveLength(1));
    expect(mountQuickCapture()).toBeTypeOf("function");
    expect(api.calls().filter((call) => call.includes("session")))
      .toHaveLength(1);
    await waitFor(() =>
      expect(
        [...document.querySelectorAll<HTMLButtonElement>(
          "[data-quick-capture]",
        )]
          .every((button) => button.disabled),
      ).toBe(true)
    );
    expect(status().textContent).toBe("Saving interaction…");
    submit();
    fireEvent.click(cancel());
    fireEvent.click(noteOpener());
    expect(saves(api)).toHaveLength(1);
    expect(globalThis.dispatchEvent(
      new CustomEvent("kinship:workspace-change-request", { cancelable: true }),
    )).toBe(false);
    save.resolve(savedActivity());
    await waitFor(() => expect(created).toHaveBeenCalledOnce());
    expect(status().textContent).toBe("Activity saved.");
    expect((created.mock.calls[0]![0] as CustomEvent).detail).toMatchObject({
      kind: "activity",
      summary: "Immutable intent",
    });
    expect((timeline.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      personIds: [personId],
    });
    await waitFor(() => expect(headerOpener().disabled).toBe(false));
    expect(globalThis.dispatchEvent(
      new CustomEvent("kinship:workspace-change-request", { cancelable: true }),
    )).toBe(true);
    globalThis.removeEventListener("kinship:interaction-created", created);
    document.removeEventListener("person-timeline-changed", timeline);
  });

  it("replays an ambiguous capture with its exact frozen intent", async () => {
    shell();
    const lost = deferred<Response>();
    const replay = deferred<Response>();
    const api = stub({
      [SAVE]: [
        lost.promise,
        replay.promise,
        problemResponse(409, { detail: "Restore the person first." }),
      ],
    });
    const created = vi.fn();
    globalThis.addEventListener("kinship:interaction-created", created);
    await mountCapture();
    await prepareActivity();
    submit();
    await waitFor(() => expect(saves(api)).toHaveLength(1));
    const [first] = saves(api);
    lost.reject(new Error("connection lost after dispatch"));
    await waitFor(() =>
      expect(status().textContent).toBe(
        "The save outcome is uncertain. Retry this exact interaction.",
      )
    );
    expect(created).not.toHaveBeenCalled();
    expect(summary().disabled).toBe(true);
    expect(submitButton().disabled).toBe(false);
    expect(cancel().disabled).toBe(true);
    expect(globalThis.dispatchEvent(
      new CustomEvent("kinship:workspace-change-request", { cancelable: true }),
    )).toBe(false);
    type(summary(), "Changed");
    submit();
    await waitFor(() => expect(saves(api)).toHaveLength(2));
    expect(saves(api)[1]).toEqual(first);
    submit();
    expect(saves(api)).toHaveLength(2);
    replay.resolve(savedActivity(undefined, 200));
    await waitFor(() => expect(created).toHaveBeenCalledOnce());
    type(summary(), "Next");
    submit();
    await waitFor(() =>
      expect(status().textContent).toBe("Restore the person first.")
    );
    expect(saves(api)[2]!["requestId"]).not.toBe(first!["requestId"]);
    expect(created).toHaveBeenCalledOnce();
    expect(summary().disabled).toBe(false);
    expect(document.activeElement).toBe(submitButton());
    globalThis.removeEventListener("kinship:interaction-created", created);
  });

  it("keeps dirty capture during workspace switch and leaves failures retryable", async () => {
    shell();
    const api = stub({ [SAVE]: [problemResponse(503), unreachable] });
    await mountCapture();
    await openReady(headerOpener());
    type(summary(), "Unsaved");
    expect(globalThis.dispatchEvent(
      new CustomEvent("kinship:workspace-change-request", { cancelable: true }),
    )).toBe(false);
    chooseOptions(participants(), [personId]);
    type(happenedAt(), "2026-08-16T18:15");
    submit();
    await waitFor(() => expect(saves(api)).toHaveLength(1));
    const [firstAttempt] = saves(api);
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    expect(summary().value).toBe("Unsaved");
    submit();
    await waitFor(() => expect(saves(api)).toHaveLength(2));
    expect(saves(api)[1]).toEqual(firstAttempt);
    await waitFor(() =>
      expect(status().textContent).toContain("outcome is uncertain")
    );
  });

  it("validates every dynamic reconnect open, owns ambiguous replay globally, and emits success once", async () => {
    shell();
    const firstWrite = deferred<Response>();
    let validations = 0;
    const api = stub({
      [SAVE]: [
        firstWrite.promise,
        savedActivity([{ id: otherId, name: "Grace" }], 200),
      ],
    });
    api.route(PEOPLE, ({ url }) => {
      const selectedId = url.searchParams.get("selectedPersonId");
      if (!selectedId || url.searchParams.get("limit") !== "1") {
        return peoplePage();
      }
      validations += 1;
      const selected = validations === 1
        ? person(otherId, "Grace", { lifecycle: "archived" })
        : validations === 2
        ? ada()
        : validations === 3
        ? undefined
        : grace();
      return peoplePage([], selected ? { selected } : {});
    });
    const created = vi.fn();
    const reconnected = vi.fn();
    globalThis.addEventListener("kinship:interaction-created", created);
    globalThis.addEventListener(
      "kinship:today-reconnect-recorded",
      reconnected,
    );
    await mountCapture();

    const malformed = reconnectOpener("not-a-uuid");
    await waitFor(() => expect(malformed.disabled).toBe(false));
    fireEvent.click(malformed);
    await waitFor(() =>
      expect(status().textContent).toBe(
        "Quick capture for this person is unavailable. The reconnect list is unchanged.",
      )
    );
    expect(validations).toBe(0);
    expect(document.activeElement).toBe(status());
    expect(submitButton().disabled).toBe(true);
    fireEvent.click(cancel());

    const opener = reconnectOpener();
    await waitFor(() => expect(opener.disabled).toBe(false));
    for (const attempt of [1, 2, 3]) {
      fireEvent.click(opener);
      await waitFor(() => expect(validations).toBe(attempt));
      await waitFor(() => expect(status().textContent).toMatch(/unavailable/i));
      expect(submitButton().disabled).toBe(true);
      expect(document.activeElement).toBe(status());
      fireEvent.click(cancel());
      await waitFor(() => expect(document.activeElement).toBe(opener));
    }
    fireEvent.click(opener);
    await waitFor(() => expect(validations).toBe(4));
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    expect(chosen(participants())).toEqual([otherId]);
    expect([kind().value, kind().disabled]).toEqual(["activity", true]);
    expect(document.activeElement).toBe(summary());
    type(summary(), "Caught up");
    type(happenedAt(), "2026-08-22T12:00");
    submit();
    await waitFor(() => expect(saves(api)).toHaveLength(1));
    const lateOpener = reconnectOpener(personId);
    await waitFor(() =>
      expect(lateOpener.dataset.interactionCaptureReady).toBe("true")
    );
    expect(lateOpener.disabled).toBe(true);
    fireEvent.click(lateOpener);
    expect(validations).toBe(4);
    firstWrite.reject(new Error("connection lost after dispatch"));
    await waitFor(() => expect(status().textContent).toMatch(/uncertain/i));
    expect([created.mock.calls.length, reconnected.mock.calls.length]).toEqual([
      0,
      0,
    ]);
    type(summary(), "Tampered");
    submit();
    await waitFor(() => expect(saves(api)).toHaveLength(2));
    expect(saves(api)[1]).toEqual(saves(api)[0]);
    expect(saves(api)[0]).toMatchObject({
      participantIds: [otherId],
      summary: "Caught up",
    });
    await waitFor(() => expect(created).toHaveBeenCalledOnce());
    expect(reconnected).toHaveBeenCalledOnce();
    expect((reconnected.mock.calls[0]![0] as CustomEvent).detail)
      .toMatchObject({ personId: otherId });
    await waitFor(() => expect(isOpen()).toBe(false));
    expect(summary().value).toBe("");
    expect([created.mock.calls.length, reconnected.mock.calls.length]).toEqual([
      1,
      1,
    ]);
    globalThis.removeEventListener("kinship:interaction-created", created);
    globalThis.removeEventListener(
      "kinship:today-reconnect-recorded",
      reconnected,
    );
  });

  it("keeps a final reconnect lifecycle rejection open and read-only until cancel and revalidation", async () => {
    shell();
    vi.stubGlobal("confirm", vi.fn(() => true));
    let validations = 0;
    const api = stub({
      [SAVE]: problemResponse(409, {
        code: "archived_write_rejected",
        detail:
          "Restore every selected person before recording an interaction.",
      }),
    });
    api.route(PEOPLE, ({ url }) => {
      if (!url.searchParams.has("selectedPersonId")) return peoplePage();
      validations += 1;
      return peoplePage([], { selected: grace() });
    });
    await mountCapture();
    const opener = reconnectOpener();
    await waitFor(() => expect(opener.disabled).toBe(false));
    fireEvent.click(opener);
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    type(summary(), "Too late");
    type(happenedAt(), "2026-08-22T12:00");
    submit();
    await waitFor(() =>
      expect(status().textContent).toBe(
        "Restore every selected person before recording an interaction.",
      )
    );
    expect(saves(api)).toHaveLength(1);
    expect(submitButton().disabled).toBe(true);
    expect(document.activeElement).toBe(status());
    submit();
    expect(saves(api)).toHaveLength(1);
    fireEvent.click(cancel());
    fireEvent.click(opener);
    await waitFor(() => expect(validations).toBe(2));
    expect(saves(api)).toHaveLength(1);
  });

  it("drops a reconnect check answered after its open was dismissed", async () => {
    shell();
    const check = deferred<Response>();
    const api = stub({});
    api.route(
      PEOPLE,
      ({ url }) =>
        url.searchParams.has("selectedPersonId") ? check.promise : peoplePage(),
    );
    await mountCapture();
    const opener = reconnectOpener();
    await waitFor(() => expect(opener.disabled).toBe(false));
    fireEvent.click(opener);
    await waitFor(() =>
      expect(status().textContent).toBe("Checking reconnect person…")
    );
    expect(form().getAttribute("aria-busy")).toBe("true");
    fireEvent.click(cancel());
    check.resolve(peoplePage([], { selected: grace() }));
    await waitFor(() => expect(isOpen()).toBe(false));
    await Promise.resolve();
    expect(chosen(participants())).toEqual([]);
  });

  it("searches bounded participant and vocabulary pages beyond the first page", async () => {
    shell();
    const beyond = "00000000-0000-4000-8000-000000000199";
    stub({
      [OPTIONS]: [
        vocabulary({ activityTypesNextCursor: "types-2" }),
        vocabulary({
          activityTypes: [{
            id: "00000000-0000-4000-8000-000000000299",
            name: "Beyond category",
          }],
        }),
      ],
      [PEOPLE]: [
        peoplePage(
          Array.from({ length: 20 }, (_, index) =>
            person(
              `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
              `Person ${index}`,
            )),
          { nextCursor: "people-2" },
        ),
        peoplePage([person(beyond, "Beyond")]),
      ],
    });
    await mountCapture();
    await openReady(activityOpener());
    expect(element("[data-participants-more]").hidden).toBe(false);
    search("participantSearch", "Beyond");
    expect(element("[data-participants-more]").hidden).toBe(true);
    await waitFor(() =>
      expect(
        [...participants().options].some((entry) => entry.value === beyond),
      )
        .toBe(true)
    );
    expect(participants().options.length).toBeLessThanOrEqual(70);
    search("activityTypeSearch", "Beyond category");
    await waitFor(() =>
      expect(field("activityTypeId").textContent).toContain("Beyond category")
    );
  });

  it("continues every bounded selector with its context cursor", async () => {
    shell();
    const api = stub({
      [OPTIONS]: ({ url }) => {
        const continuedType = url.searchParams.get("activityTypeCursor");
        const continuedEmotion = url.searchParams.get("emotionCursor");
        return vocabulary({
          activityTypes: [{
            id: continuedType
              ? "00000000-0000-4000-8000-000000000202"
              : "00000000-0000-4000-8000-000000000201",
            name: continuedType ? "Type two" : "Type one",
          }],
          ...(continuedType ? {} : { activityTypesNextCursor: "types-2" }),
          emotions: [{
            id: continuedEmotion
              ? "00000000-0000-4000-8000-000000000302"
              : "00000000-0000-4000-8000-000000000301",
            name: continuedEmotion ? "Emotion two" : "Emotion one",
          }],
          ...(continuedEmotion ? {} : { emotionsNextCursor: "emotions-2" }),
        });
      },
      [PEOPLE]: ({ url }) => {
        const continued = url.searchParams.get("cursor");
        return peoplePage([
          person(
            continued
              ? "00000000-0000-4000-8000-000000000102"
              : "00000000-0000-4000-8000-000000000101",
            continued ? "Person two" : "Person one",
          ),
        ], continued ? {} : { nextCursor: "people-2" });
      },
    });
    await mountCapture();
    await openReady(activityOpener());
    const typeSelect = field<HTMLSelectElement>("activityTypeId");
    fireEvent.change(typeSelect, {
      target: { value: "00000000-0000-4000-8000-000000000201" },
    });
    fireEvent.click(element("[data-participants-more]"));
    fireEvent.click(element("[data-activity-types-more]"));
    fireEvent.click(element("[data-emotions-more]"));
    await waitFor(() => {
      expect(api.calls()).toContain(
        "GET /api/v1/people?cursor=people-2&limit=20&starredFirst=true",
      );
      expect(api.calls()).toContain(
        "GET /api/v1/interaction-options?activityTypeCursor=types-2&limit=20",
      );
      expect(api.calls()).toContain(
        "GET /api/v1/interaction-options?emotionCursor=emotions-2&limit=20",
      );
    });
    await waitFor(() =>
      expect(optionNames(typeSelect)).toEqual([
        "No category",
        "Type two",
        "Type one",
      ])
    );
    expect(typeSelect.value).toBe("00000000-0000-4000-8000-000000000201");
    expect(optionNames(participants())).toEqual(["Person two"]);
    expect(element("[data-participants-more]").hidden).toBe(true);
  });

  it("ignores the options an earlier open asked for", async () => {
    shell();
    const stalePeople = deferred<Response>();
    const staleOptions = deferred<Response>();
    stub({
      [OPTIONS]: [
        staleOptions.promise,
        vocabulary({
          activityTypes: [{
            id: "00000000-0000-4000-8000-000000000211",
            name: "Newest type",
          }],
          emotions: [{
            id: "00000000-0000-4000-8000-000000000311",
            name: "Newest emotion",
          }],
        }),
      ],
      [PEOPLE]: [
        stalePeople.promise,
        peoplePage([
          person("00000000-0000-4000-8000-000000000111", "Newest person"),
        ]),
      ],
    });
    await mountCapture();
    fireEvent.click(activityOpener());
    await waitFor(() => expect(isOpen()).toBe(true));
    fireEvent.click(cancel());
    await openReady(activityOpener());
    stalePeople.resolve(
      peoplePage([
        person("00000000-0000-4000-8000-000000000112", "Stale person"),
      ]),
    );
    staleOptions.resolve(vocabulary({
      activityTypes: [{
        id: "00000000-0000-4000-8000-000000000212",
        name: "Stale type",
      }],
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(participants().textContent).toContain("Newest person");
    expect(field("activityTypeId").textContent).toContain("Newest type");
    expect(field("emotionIds").textContent).toContain("Newest emotion");
    expect(document.body.textContent).not.toContain("Stale");
  });

  it("keeps every selector on its newest search when older searches and continuations settle later", async () => {
    shell();
    const pending = new Map<string, ReturnType<typeof deferred<Response>>>();
    const hold = (key: string) => {
      const entry = deferred<Response>();
      pending.set(key, entry);
      return entry.promise;
    };
    const idOf = (name: string, block: string) =>
      `00000000-0000-4000-${block}-${
        name.charCodeAt(0).toString().padStart(12, "0")
      }`;
    const personPage = (name: string, nextCursor?: string) =>
      peoplePage(
        [person(idOf(name, "8000"), name)],
        nextCursor ? { nextCursor } : {},
      );
    const vocabularyPage = (
      target: "type" | "emotion",
      name: string,
      nextCursor?: string,
    ) =>
      vocabulary(
        target === "type"
          ? {
            activityTypes: [{ id: idOf(name, "8001"), name }],
            ...(nextCursor ? { activityTypesNextCursor: nextCursor } : {}),
          }
          : {
            emotions: [{ id: idOf(name, "8002"), name }],
            ...(nextCursor ? { emotionsNextCursor: nextCursor } : {}),
          },
      );
    stub({
      [OPTIONS]: ({ url }) => {
        const typeSearch = url.searchParams.get("activityTypeSearch");
        const emotionSearch = url.searchParams.get("emotionSearch");
        if (!typeSearch && !emotionSearch) {
          return vocabularyPage("type", "Initial type");
        }
        const target = typeSearch ? "type" : "emotion";
        const cursor = url.searchParams.get(
          target === "type" ? "activityTypeCursor" : "emotionCursor",
        ) ?? "";
        return hold(`${target}:${typeSearch ?? emotionSearch}:${cursor}`);
      },
      [PEOPLE]: ({ url }) => {
        const term = url.searchParams.get("search");
        if (!term) return personPage("Initial");
        return hold(`people:${term}:${url.searchParams.get("cursor") ?? ""}`);
      },
    });
    await mountCapture();
    await openReady(activityOpener());
    const searches = {
      emotion: "emotionSearch",
      people: "participantSearch",
      type: "activityTypeSearch",
    } as const;
    const selects = {
      emotion: () => field("emotionIds"),
      people: () => participants(),
      type: () => field("activityTypeId"),
    } as const;
    const more = {
      emotion: () => element<HTMLButtonElement>("[data-emotions-more]"),
      people: () => element<HTMLButtonElement>("[data-participants-more]"),
      type: () => element<HTMLButtonElement>("[data-activity-types-more]"),
    } as const;
    for (const [target, name] of Object.entries(searches)) {
      search(name, "Old");
      search(name, "New");
      await waitFor(() => expect(pending.has(`${target}:New:`)).toBe(true));
    }
    pending.get("people:New:")!.resolve(personPage("New person", "people-2"));
    pending.get("type:New:")!.resolve(
      vocabularyPage("type", "New type", "types-2"),
    );
    pending.get("emotion:New:")!.resolve(
      vocabularyPage("emotion", "New emotion", "emotions-2"),
    );
    await waitFor(() => {
      expect(selects.people().textContent).toContain("New person");
      expect(selects.type().textContent).toContain("New type");
      expect(selects.emotion().textContent).toContain("New emotion");
    });
    pending.get("people:Old:")!.resolve(personPage("Old person", "old-2"));
    pending.get("type:Old:")!.resolve(
      vocabularyPage("type", "Old type", "old-2"),
    );
    pending.get("emotion:Old:")!.resolve(
      vocabularyPage("emotion", "Old emotion", "old-2"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const select of Object.values(selects)) {
      expect(select().textContent).not.toContain("Old");
    }

    for (const [target, name] of Object.entries(searches)) {
      field<HTMLInputElement>(name).value = "Uncommitted";
      fireEvent.click(more[target as keyof typeof more]());
      await Promise.resolve();
      expect(
        [...pending.keys()].some((key) =>
          key.startsWith(`${target}:Uncommitted:`)
        ),
      ).toBe(false);
      field<HTMLInputElement>(name).value = "New";
    }
    for (const button of Object.values(more)) fireEvent.click(button());
    await waitFor(() => {
      expect(pending.has("people:New:people-2")).toBe(true);
      expect(pending.has("type:New:types-2")).toBe(true);
      expect(pending.has("emotion:New:emotions-2")).toBe(true);
    });
    for (const name of Object.values(searches)) search(name, "Final");
    await waitFor(() => {
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
    await waitFor(() => {
      expect(selects.people().textContent).toContain("Final person");
      expect(selects.type().textContent).toContain("Final type");
      expect(selects.emotion().textContent).toContain("Final emotion");
      for (const button of Object.values(more)) {
        expect(button().hidden).toBe(false);
      }
    });
    expect(selects.type().textContent).not.toContain("Stale");

    field<HTMLInputElement>("participantSearch").value = "Typed later";
    pending.clear();
    search("participantSearch", "Answered");
    await waitFor(() => expect(pending.has("people:Answered:")).toBe(true));
    field<HTMLInputElement>("participantSearch").value = "Typed later";
    pending.get("people:Answered:")!.resolve(personPage("Answered person"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(selects.people().textContent).not.toContain("Answered person");
  });

  it("quick capture records a multi-person activity with actual time and options", async () => {
    shell();
    const timelineChanged = vi.fn();
    document.addEventListener("person-timeline-changed", timelineChanged, {
      once: true,
    });
    const api = stub({
      [OPTIONS]: vocabulary({
        activityTypes: [{
          id: "00000000-0000-4000-8000-000000000200",
          name: "Meal",
        }],
        emotions: [{ id: "00000000-0000-4000-8000-000000000300", name: "Joy" }],
      }),
      [PEOPLE]: peoplePage([ada(), grace()]),
      [SAVE]: savedActivity([
        { id: personId, name: "Ada" },
        { id: otherId, name: "Grace" },
      ]),
    });
    await mountCapture();
    await openReady(headerOpener());
    const dialogView = within(dialog());
    chooseOptions(participants(), [personId, otherId]);
    type(dialogView.getByLabelText("When it happened"), "2026-08-16T18:15");
    type(dialogView.getByLabelText("Summary"), "Dinner together");
    fireEvent.change(dialogView.getByLabelText("Activity type"), {
      target: { value: "00000000-0000-4000-8000-000000000200" },
    });
    chooseOptions(dialogView.getByLabelText("Emotions (optional)"), [
      "00000000-0000-4000-8000-000000000300",
    ]);
    type(dialogView.getByLabelText("Details (optional)"), "Talked shop");
    expect(dialogView.getByRole("button", { name: "Save interaction" }))
      .toBe(submitButton());
    submit();
    await waitFor(() => expect(saves(api)).toHaveLength(1));
    const [body] = saves(api);
    expect(body).toMatchObject({
      activityTypeId: "00000000-0000-4000-8000-000000000200",
      description: "Talked shop",
      emotionIds: ["00000000-0000-4000-8000-000000000300"],
      kind: "activity",
      participantIds: [personId, otherId],
      summary: "Dinner together",
    });
    expect(String(body!["happenedAt"])).toContain("2026-08-16T");
    await waitFor(() => expect(status().textContent).toBe("Activity saved."));
    expect((timelineChanged.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      personIds: [personId, otherId],
    });
  });

  it("records one favorite note and validates participants without sending", async () => {
    shell();
    const created = vi.fn();
    globalThis.addEventListener("kinship:interaction-created", created, {
      once: true,
    });
    const timelineChanged = vi.fn();
    document.addEventListener("person-timeline-changed", timelineChanged, {
      once: true,
    });
    const api = stub({
      [PEOPLE]: peoplePage([ada(), grace()]),
      [SAVE]: jsonResponse({
        record: {
          body: "Keep this context",
          createdAt: "2026-08-17T12:31:00.000Z",
          id: "00000000-0000-4000-8000-000000000901",
          isFavorited: true,
          kind: "note",
        },
        status: "created",
      }, 201),
    });
    await mountCapture();
    await openReady(activityOpener());
    submit();
    expect(status().textContent).toBe("Choose at least one participant.");
    expect(document.activeElement).toBe(participants());
    expect(saves(api)).toHaveLength(0);

    chooseOptions(participants(), [personId, otherId]);
    fireEvent.change(kind(), { target: { value: "note" } });
    expect(participants().multiple).toBe(false);
    expect(chosen(participants())).toEqual([personId]);
    const dialogView = within(dialog());
    type(
      dialogView.getByRole("textbox", { name: "Note" }),
      "Keep this context",
    );
    fireEvent.click(
      dialogView.getByRole("checkbox", {
        name: "Keep this note in Today favorites",
      }),
    );
    submit();
    await waitFor(() => expect(saves(api)).toHaveLength(1));
    expect(saves(api)[0]).toEqual({
      body: "Keep this context",
      isFavorited: true,
      kind: "note",
      personId,
      requestId: expect.any(String),
    });
    await waitFor(() => expect(created).toHaveBeenCalledOnce());
    expect(status().textContent).toBe("Note saved.");
    expect((timelineChanged.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      personIds: [],
    });
  });

  it("chooses the person a profile page is about in every fresh draft", async () => {
    history.replaceState({}, "", `/app/people/${otherId}`);
    shell();
    vi.stubGlobal("confirm", vi.fn(() => true));
    const api = stub({
      [PEOPLE]: peoplePage([ada()], { selected: grace() }),
    });
    await mountCapture();
    await openReady(noteOpener());
    expect(participants().value).toBe(otherId);
    expect(api.calls()).toContain(
      `GET /api/v1/people?limit=20&selectedPersonId=${otherId}&starredFirst=true`,
    );
    chooseOptions(participants(), [personId]);
    fireEvent.click(cancel());
    await openReady(noteOpener());
    expect(participants().value).toBe(otherId);
    expect(optionNames(participants())).toEqual(["", "Ada", "Grace"]);
  });
});
