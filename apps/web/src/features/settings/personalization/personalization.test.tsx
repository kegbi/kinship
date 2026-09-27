// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  type ApiRequest,
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import { workspaceSession } from "../../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../../testing/render.tsx";
import { requestWorkspaceChange } from "../../../lib/workspace-context.ts";
import {
  baselineOf,
  draftSnapshot,
  mountPersonalization,
  PERSONALIZATION_ISLAND,
  restore,
} from "./personalization.tsx";

const SESSION = "GET /api/v1/session";
const LIST = "GET /api/v1/settings/personalization/:section";
const CREATE = "POST /api/v1/settings/personalization/:section";
const UPDATE = "PATCH /api/v1/settings/personalization/:section/:id";
const DELETE = "DELETE /api/v1/settings/personalization/:section/:id";

const entry = (overrides: object = {}) => ({
  canDelete: true,
  id: "00000000-0000-4000-8000-000000000001",
  isActive: true,
  isDefault: false,
  name: "Close friends",
  referenceCount: 0,
  sortOrder: 0,
  updatedAt: "2026-08-17T10:00:00.000Z",
  ...overrides,
});
const trusted = entry({
  id: "00000000-0000-4000-8000-000000000002",
  name: "Trusted people",
  sortOrder: 1,
});
const listed = (section: string, entries: object[], extra: object = {}) =>
  jsonResponse({ entries, section, status: "ready", ...extra });
const unavailable = (detail: string) =>
  problemResponse(503, { code: "personalization_unavailable", detail });
const session = jsonResponse(workspaceSession());

function shell(section?: string): void {
  history.replaceState(
    {},
    "",
    section
      ? `/app/settings/personalization?section=${section}`
      : "/app/settings/personalization",
  );
  drawShell(
    '<main><div class="personalization-layout" data-personalization></div></main>',
  );
}

const mount = () => mountSettled(() => mountPersonalization());
const status = () => element("#personalization-status");
const dirty = () => element("#personalization-dirty");
const heading = () => element("#personalization-heading");
const list = () => element("#personalization-list");
const createForm = () => element<HTMLFormElement>("#personalization-create");
const createField = (name: string) =>
  createForm().elements.namedItem(name) as HTMLInputElement | null;
const input = (label: string) => screen.getByLabelText<HTMLInputElement>(label);
const rowOf = (label: string) => input(label).closest("li")!;
const button = (scope: HTMLElement, name: string) =>
  within(scope).getByRole<HTMLButtonElement>("button", { hidden: true, name });
const link = (section: string) =>
  element<HTMLAnchorElement>(`[data-personalization-section="${section}"]`);
const revertOf = (scope: HTMLElement) =>
  scope.querySelector<HTMLButtonElement>("[data-personalization-revert]")!;
const writes = (requests: readonly ApiRequest[]) =>
  requests.filter(({ method }) => method !== "GET");

function type(target: HTMLInputElement, value: string): void {
  act(() => {
    fireEvent.input(target, { target: { value } });
  });
}

function click(target: HTMLElement): void {
  act(() => {
    fireEvent.click(target);
  });
}

function submit(form: HTMLFormElement): void {
  act(() => {
    fireEvent.submit(form);
  });
}

async function pop(state: unknown, search: string): Promise<void> {
  await act(async () => {
    history.replaceState(state, "", search);
    dispatchEvent(new PopStateEvent("popstate", { state }));
    await Promise.resolve();
  });
}

const entryState = (index: number, section: string) => ({
  personalization: { index, section },
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
});

describe("WORKSPACE-003 personalization", () => {
  it("does nothing without its layout", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(PERSONALIZATION_ISLAND).toBe("settings-personalization");
  });

  it("prevents implicit row actions from discarding a dirty draft", async () => {
    shell("tags");
    const api = stubApi({
      [LIST]: listed("tags", [entry()]),
      [SESSION]: session,
      [UPDATE]: jsonResponse({
        entry: entry({ isActive: false }),
        status: "saved",
      }),
    });
    await mount();
    await expectNoAxeViolations(document.body);
    const name = input("Name for Close friends");
    const row = rowOf("Name for Close friends");
    type(name, "Inner circle");
    const disable = button(row, "Disable");
    const remove = button(row, "Delete");
    expect(disable.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    expect(disable.getAttribute("aria-describedby")).toBe(
      "personalization-dirty",
    );
    expect(disable.title).toBe(
      "Save or revert the active draft before using this action.",
    );
    click(disable);
    expect(writes(api.requests())).toEqual([]);
    expect(name.value).toBe("Inner circle");

    type(name, "Close friends");
    expect(disable.disabled).toBe(false);
    expect(remove.disabled).toBe(false);
    expect(disable.hasAttribute("aria-describedby")).toBe(false);
    click(disable);
    await waitFor(() => expect(status().textContent).toBe("Option updated."));
    expect(writes(api.requests()).map(({ body }) => body)).toEqual([{
      expectedUpdatedAt: entry().updatedAt,
      isActive: false,
    }]);
  });

  it("allows only the active dirty form to mutate and provides keyboard Revert", async () => {
    shell("tags");
    const api = stubApi({
      [LIST]: listed("tags", [entry(), trusted]),
      [SESSION]: session,
    });
    await mount();
    const close = input("Name for Close friends");
    const closeRow = rowOf("Name for Close friends");
    const trustedRow = rowOf("Name for Trusted people");
    const createSubmit = button(createForm(), "Create option");
    type(close, "Inner circle");
    expect(button(closeRow, "Save").disabled).toBe(false);
    expect(createSubmit.disabled).toBe(true);
    expect(button(trustedRow, "Save").disabled).toBe(true);
    submit(createForm());
    submit(trustedRow.querySelector("form")!);
    expect(writes(api.requests())).toEqual([]);
    expect(close.value).toBe("Inner circle");
    expect(dirty().textContent).toBe(
      "Finish or revert the active draft first.",
    );
    expect(document.activeElement).toBe(close);

    const revert = revertOf(closeRow);
    expect(revert.hidden).toBe(false);
    revert.focus();
    click(revert);
    expect(close.value).toBe("Close friends");
    expect(document.activeElement).toBe(close);
    expect(dirty().textContent).toBe("Changes reverted.");
    expect(revert.hidden).toBe(true);
    expect(createSubmit.disabled).toBe(false);
    expect(button(trustedRow, "Save").disabled).toBe(false);

    const createName = input("New option name");
    type(createName, "Draft tag");
    expect(createSubmit.disabled).toBe(false);
    expect(button(trustedRow, "Save").disabled).toBe(true);
    const createRevert = revertOf(createForm());
    expect(createRevert.hidden).toBe(false);
    click(createRevert);
    expect(createName.value).toBe("");

    type(close, "One");
    type(input("Name for Trusted people"), "Two");
    expect(button(closeRow, "Save").disabled).toBe(true);
    expect(revertOf(closeRow).hidden).toBe(false);
    expect(revertOf(trustedRow).hidden).toBe(true);
  });

  it("reports a committed Save refresh failure and retries authoritatively", async () => {
    shell("tags");
    const saved = entry({
      name: "Inner circle",
      updatedAt: "2026-08-17T10:01:00.000Z",
    });
    const api = stubApi({
      [LIST]: [
        listed("tags", [entry()]),
        unavailable("Refresh unavailable."),
        listed("tags", [saved]),
      ],
      [SESSION]: session,
      [UPDATE]: jsonResponse({ entry: saved, status: "saved" }),
    });
    await mount();
    const name = input("Name for Close friends");
    type(name, "Inner circle");
    submit(rowOf("Name for Close friends").querySelector("form")!);
    await waitFor(() =>
      expect(status().textContent).toBe(
        "Change saved, but this section could not be refreshed. Retry",
      )
    );
    expect(document.activeElement).toBe(status());
    expect(name.value).toBe("Inner circle");
    expect(name.disabled).toBe(false);
    expect(dirty().textContent).toBe("All changes saved.");
    expect(writes(api.requests()).map(({ body }) => body)).toEqual([{
      expectedUpdatedAt: entry().updatedAt,
      name: "Inner circle",
      sortOrder: 0,
    }]);
    click(button(status(), "Retry"));
    await waitFor(() =>
      expect(input("Name for Inner circle").value).toBe("Inner circle")
    );
    expect(status().textContent).toBe("Section refreshed.");
    expect(dirty().textContent).toBe("All changes saved.");
  });

  it("restores implicit controls after a committed refresh failure and Retry", async () => {
    shell("profile-modules");
    const tags = entry({ name: "Tags" });
    stubApi({
      [LIST]: [
        listed("profile-modules", [tags]),
        unavailable("Refresh unavailable."),
        unavailable("Still unavailable."),
        listed("profile-modules", [{ ...tags, isActive: false }]),
      ],
      [SESSION]: session,
      [UPDATE]: jsonResponse({ entry: tags, status: "saved" }),
    });
    await mount();
    const disable = button(list(), "Disable");
    click(disable);
    await waitFor(() =>
      expect(status().textContent).toContain(
        "Change saved, but this section could not be refreshed.",
      )
    );
    expect(disable.disabled).toBe(false);
    expect(status().textContent).not.toContain("Option updated.");
    click(button(status(), "Retry"));
    await waitFor(() =>
      expect(status().textContent).toBe(
        "Change saved, but this section could not be refreshed. Retry",
      )
    );
    click(button(status(), "Retry"));
    await waitFor(() => expect(button(list(), "Enable")).toBeTruthy());
    expect(status().textContent).toBe("Section refreshed.");
  });

  it("keeps workspace drafts until an accepted switch actually proceeds", async () => {
    shell("tags");
    stubApi({ [LIST]: listed("tags", [entry()]), [SESSION]: session });
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    await mount();
    const name = input("Name for Close friends");
    type(name, "Workspace draft");
    name.focus();
    const canceled = requestWorkspaceChange("workspace", "other-workspace");
    expect(canceled.allowed).toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      "You have unsaved personalization changes. Discard them and switch workspaces?",
    );
    expect(name.value).toBe("Workspace draft");
    expect(document.activeElement).toBe(name);
    expect(dirty().textContent).toBe("Unsaved changes.");

    confirm.mockReturnValue(true);
    const accepted = requestWorkspaceChange("workspace", "other-workspace");
    expect(accepted.allowed).toBe(true);
    expect(name.value).toBe("Workspace draft");
    expect(dirty().textContent).toBe("Unsaved changes.");
    const failedTargetUnload = new Event("beforeunload", { cancelable: true });
    dispatchEvent(failedTargetUnload);
    expect(failedTargetUnload.defaultPrevented).toBe(true);

    act(() => accepted.proceed());
    expect(dirty().textContent).toBe("Changes discarded for workspace switch.");
    const committedUnload = new Event("beforeunload", { cancelable: true });
    dispatchEvent(committedUnload);
    expect(committedUnload.defaultPrevented).toBe(false);
  });

  it("renders, navigates, edits, replaces, and announces API outcomes", async () => {
    shell("tags");
    const shared = entry({
      canDelete: false,
      id: "tags-shared",
      isDefault: true,
      name: "Shared",
      sortOrder: 2,
      updatedAt: "1970-01-01T00:00:00.000Z",
    });
    const close = entry({ referenceCount: 1 });
    let entries: object[] = [close, trusted, shared];
    const api = stubApi({
      [CREATE]: [
        problemResponse(409, {
          code: "personalization_duplicate",
          detail: "Choose a unique name in this workspace.",
        }),
        jsonResponse({ entry: trusted, status: "saved" }),
      ],
      [DELETE]: () => {
        entries = [trusted, shared];
        return jsonResponse({ id: close.id, status: "deleted" });
      },
      [LIST]: (request) =>
        request.params.section === "reminder-rules"
          ? listed("reminder-rules", [])
          : listed("tags", entries),
      [SESSION]: session,
      [UPDATE]: jsonResponse({ entry: close, status: "saved" }),
    });
    await mount();
    expect(heading().textContent).toBe("Tags");
    expect(link("tags").getAttribute("aria-current")).toBe("page");
    expect(list().querySelectorAll(".personalization-row")).toHaveLength(3);
    expect(list().textContent).toContain("Shared required option");
    expect(list().textContent).toContain("1 reference · Enabled");
    expect(list().textContent).toContain("0 references · Enabled · Default");
    const row = () => rowOf("Name for Close friends");
    submit(row().querySelector("form")!);
    await waitFor(() => expect(status().textContent).toBe("Option saved."));
    click(button(row(), "Disable"));
    await waitFor(() => expect(status().textContent).toBe("Option updated."));
    click(button(row(), "Replace and delete"));
    expect(status().textContent).toBe("1 references require a replacement.");
    expect(document.activeElement).toBe(status());
    within(row()).getByLabelText<HTMLSelectElement>(
      "Replacement for Close friends",
    ).value = trusted.id;
    click(button(row(), "Replace and delete"));
    await waitFor(() =>
      expect(status().textContent).toBe(
        "Option deleted; existing history was retained.",
      )
    );
    expect(list().textContent).not.toContain("Close friends");
    const removal = api.requests().find(({ method }) => method === "DELETE")!;
    expect(removal.url.searchParams.get("replacementId")).toBe(trusted.id);

    type(input("New option name"), "Trusted people");
    submit(createForm());
    await waitFor(() =>
      expect(status().textContent).toBe(
        "Choose a unique name in this workspace.",
      )
    );
    expect(input("New option name").value).toBe("Trusted people");
    submit(createForm());
    await waitFor(() => expect(status().textContent).toBe("Option created."));
    expect(input("New option name").value).toBe("");
    expect(
      api.requests().filter(({ method }) => method === "POST").map(({ body }) =>
        body
      ),
    ).toEqual([{ name: "Trusted people" }, { name: "Trusted people" }]);

    click(link("reminder-rules"));
    await waitFor(() => expect(heading().textContent).toBe("Reminder rules"));
    expect(location.search).toBe("?section=reminder-rules");
    expect(document.activeElement).toBe(heading());
    expect(link("reminder-rules").getAttribute("aria-current")).toBe("page");
    expect(link("tags").hasAttribute("aria-current")).toBe(false);
    expect(status().textContent).toBe(
      "No options yet. Create the first option for this workspace.",
    );
    const tags = entryState(2, "tags");
    await act(async () => {
      history.pushState(tags, "", "?section=tags");
      dispatchEvent(new PopStateEvent("popstate", { state: tags }));
      await Promise.resolve();
    });
    await waitFor(() => expect(heading().textContent).toBe("Tags"));
  });

  it("keeps the create form out of reach until its section has loaded", async () => {
    expect(
      readFileSync(
        "apps/web/src/pages/app/settings/personalization.astro",
        "utf8",
      ),
    ).toMatch(/<form method="post" id="personalization-create"[^>]*\shidden>/);
    shell();
    const answered = deferred<Response>();
    stubApi({
      [LIST]: listed("profile-modules", []),
      [SESSION]: answered.promise,
    });
    const settled = mountPending(() => mountPersonalization());
    expect(createForm().hidden).toBe(true);
    expect(status().textContent).toBe("Loading workspace personalization…");
    await act(async () => {
      answered.resolve(session);
      await settled;
    });
    expect(createForm().hidden).toBe(false);
    expect(input("New option name").disabled).toBe(false);
  });

  it("reports session and section loading failures without stale rows", async () => {
    shell();
    stubApi({ [SESSION]: unreachable });
    let unmount = await mount();
    expect(status().textContent).toBe("Your session could not be confirmed.");
    unmount();

    shell();
    stubApi({
      [LIST]: unavailable("Section unavailable."),
      [SESSION]: session,
    });
    unmount = await mount();
    expect(status().textContent).toBe("Section unavailable. Retry");
    expect(list().children).toHaveLength(0);
    unmount();

    shell();
    stubApi({ [LIST]: unreachable, [SESSION]: session });
    await mount();
    expect(status().textContent).toBe(
      "This section could not be loaded. Retry",
    );
  });

  it("keeps an initial failed section inert until Retry establishes a baseline", async () => {
    shell();
    const api = stubApi({
      [LIST]: [
        unavailable("Section unavailable."),
        listed("profile-modules", [entry()]),
      ],
      [SESSION]: session,
    });
    await mount();
    const name = input("New option name");
    const createSubmit = button(createForm(), "Create option");
    expect(name.disabled).toBe(true);
    expect(createSubmit.disabled).toBe(true);
    expect(createForm().hidden).toBe(true);
    expect(revertOf(createForm()).hidden).toBe(true);
    type(name, "No baseline draft");
    submit(createForm());
    expect(writes(api.requests())).toEqual([]);
    expect(dirty().textContent).toBe("All changes saved.");
    expect(status().textContent).toBe("Section unavailable. Retry");

    const retry = button(status(), "Retry");
    click(retry);
    expect(status().textContent).toBe("Loading profile modules…");
    await waitFor(() => expect(input("New option name").disabled).toBe(false));
    expect(input("New option name").value).toBe("");
    const rowName = input("Name for Close friends");
    type(rowName, "Inner circle");
    const rowRevert = revertOf(rowOf("Name for Close friends"));
    expect(rowRevert.hidden).toBe(false);
    rowRevert.focus();
    click(rowRevert);
    expect(rowName.value).toBe("Close friends");
    expect(document.activeElement).toBe(rowName);
    expect(dirty().textContent).toBe("Changes reverted.");
  });

  it("renders global vocabularies as explicitly read-only", async () => {
    shell("emotion-options");
    stubApi({
      [LIST]: listed("emotion-options", [{
        capabilities: {
          delete: false,
          disable: false,
          reorder: false,
          rename: false,
          replace: false,
          setDefault: false,
        },
        canDelete: false,
        id: "00000000-0000-4000-8000-000000000050",
        isActive: true,
        isDefault: false,
        kind: "named",
        name: "Joy",
        readOnly: true,
        referenceCount: 2,
        sortOrder: 10,
        updatedAt: "2026-08-16T10:00:00.000Z",
      }], { capabilities: { create: false }, readOnly: true }),
      [SESSION]: session,
    });
    await mount();
    expect(list().textContent).toContain("Joy");
    expect(list().textContent).toContain("Read-only shared option");
    expect(createForm().hidden).toBe(true);
    expect(list().querySelectorAll(".personalization-actions button"))
      .toHaveLength(0);
    expect(list().querySelectorAll("input")).toHaveLength(0);
  });

  it("describes an empty shared catalog without offering creation", async () => {
    shell("pet-categories");
    stubApi({
      [LIST]: listed("pet-categories", [], {
        capabilities: { create: false },
        readOnly: true,
      }),
      [SESSION]: session,
    });
    await mount();
    expect(status().textContent).toBe("No shared options are available.");
    expect(createForm().hidden).toBe(true);
  });

  it("keeps relationship direction labels separate in the edit form", async () => {
    shell("relationship-types");
    const api = stubApi({
      [CREATE]: jsonResponse({ entry: entry(), status: "saved" }),
      [LIST]: listed("relationship-types", [{
        capabilities: {
          delete: true,
          disable: true,
          reorder: true,
          rename: true,
          replace: true,
          setDefault: false,
        },
        canDelete: true,
        forwardLabel: "Mentor",
        id: "00000000-0000-4000-8000-000000000060",
        isActive: true,
        isDefault: false,
        kind: "relationship-type",
        name: "Mentor / Mentee",
        readOnly: false,
        referenceCount: 1,
        reverseLabel: "Mentee",
        sortOrder: 10,
        updatedAt: "2026-08-16T10:00:00.000Z",
      }], { capabilities: { create: true } }),
      [SESSION]: session,
    });
    await mount();
    expect(input("Forward label for Mentor / Mentee").value).toBe("Mentor");
    expect(input("Reverse label for Mentor / Mentee").value).toBe("Mentee");
    expect(input("Order for Mentor / Mentee").value).toBe("10");
    expect(createField("name")?.closest("label")?.hidden).toBe(true);
    expect(createField("name")?.disabled).toBe(true);
    type(createField("forwardLabel")!, " Parent ");
    type(createField("reverseLabel")!, " Child ");
    submit(createForm());
    await waitFor(() => expect(status().textContent).toBe("Option created."));
    expect(writes(api.requests()).map(({ body }) => body)).toEqual([{
      forwardLabel: "Parent",
      reverseLabel: "Child",
      sortOrder: 1,
    }]);
  });

  it("edits reminder lead time only when the value capability is declared", async () => {
    shell("reminder-rules");
    const reminder = {
      capabilities: {
        delete: true,
        disable: true,
        editValue: true,
        rename: false,
        reorder: false,
        replace: false,
        setDefault: false,
      },
      canDelete: true,
      daysBefore: 7,
      id: "00000000-0000-4000-8000-000000000030",
      isActive: true,
      isDefault: false,
      kind: "reminder-rule",
      name: "7 days before",
      readOnly: false,
      referenceCount: 0,
      sortOrder: 7,
      updatedAt: "2026-08-16T10:00:00.000Z",
    };
    const api = stubApi({
      [CREATE]: jsonResponse({ entry: reminder, status: "saved" }),
      [LIST]: [
        listed("reminder-rules", [reminder], {
          capabilities: { create: true },
        }),
        listed("reminder-rules", [
          { ...reminder, daysBefore: 3, name: "3 days before" },
        ], { capabilities: { create: true } }),
        listed("reminder-rules", [{ ...reminder, capabilities: undefined }]),
      ],
      [SESSION]: session,
      [UPDATE]: jsonResponse({ entry: reminder, status: "saved" }),
    });
    await mount();
    const days = input("Days before for 7 days before");
    expect(days.disabled).toBe(false);
    expect(
      within(rowOf("Days before for 7 days before")).queryByLabelText(
        "Order for 7 days before",
      ),
    ).toBeNull();
    expect(button(list(), "Save").textContent).toBe("Save");
    type(days, "3");
    expect(dirty().textContent).toBe("Unsaved changes.");
    submit(days.form!);
    await waitFor(() => expect(status().textContent).toBe("Option saved."));
    expect(dirty().textContent).toBe("All changes saved.");
    expect(writes(api.requests()).map(({ body }) => body)).toEqual([{
      daysBefore: 3,
      expectedUpdatedAt: reminder.updatedAt,
    }]);
    type(createField("daysBefore")!, "14");
    submit(createForm());
    await waitFor(() => expect(status().textContent).toBe("Option created."));
    expect(writes(api.requests()).at(-1)?.body).toEqual({ daysBefore: 14 });
    expect(input("Days before for 7 days before").disabled).toBe(true);
  });

  it("surfaces an actionable relationship replacement collision without clearing the form", async () => {
    shell("relationship-types");
    const relationship = (id: string, forward: string, reverse: string) => ({
      canDelete: true,
      forwardLabel: forward,
      id,
      isActive: true,
      isDefault: false,
      kind: "relationship-type",
      name: `${forward} / ${reverse}`,
      referenceCount: 1,
      reverseLabel: reverse,
      sortOrder: 0,
      updatedAt: "2026-08-16T10:00:00.000Z",
    });
    const source = relationship(
      "00000000-0000-4000-8000-000000000080",
      "Coach",
      "Student",
    );
    const target = relationship(
      "00000000-0000-4000-8000-000000000081",
      "Advisor",
      "Advisee",
    );
    stubApi({
      [DELETE]: problemResponse(409, {
        code: "personalization_replacement_conflict",
        detail:
          "Some of the same people already have both relationship types. Remove the duplicate relationship before replacing this option.",
      }),
      [LIST]: listed("relationship-types", [source, target]),
      [SESSION]: session,
    });
    await mount();
    const sourceRow = rowOf("Forward label for Coach / Student");
    within(sourceRow).getByLabelText<HTMLSelectElement>(
      "Replacement for Coach / Student",
    ).value = target.id;
    click(sourceRow.querySelector<HTMLButtonElement>("button:last-child")!);
    await waitFor(() => expect(status().textContent).toContain("same people"));
    expect(list().querySelectorAll(".personalization-row")).toHaveLength(2);
    expect(input("Forward label for Coach / Student").value).toBe("Coach");
  });

  it("guards link, back, and forward history with indexed stay and discard outcomes", async () => {
    shell("tags");
    const tag = entry({
      id: "00000000-0000-4000-8000-000000000070",
      name: "Friends",
    });
    const confirm = vi.fn(() => false);
    const go = vi.spyOn(history, "go").mockImplementation(() => undefined);
    vi.stubGlobal("confirm", confirm);
    stubApi({
      [LIST]: (request) =>
        request.params.section === "reminder-rules"
          ? listed("reminder-rules", [], { capabilities: { create: true } })
          : listed("tags", [tag]),
      [SESSION]: session,
    });
    await mount();
    expect(history.state.personalization).toEqual({
      index: 0,
      section: "tags",
    });
    const name = input("Name for Friends");
    type(name, "Closest friends");
    expect(dirty().textContent).toBe("Unsaved changes.");
    const unload = new Event("beforeunload", { cancelable: true });
    dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    click(link("reminder-rules"));
    expect(confirm).toHaveBeenLastCalledWith(
      "You have unsaved personalization changes. Discard them and continue?",
    );
    expect(location.search).toBe("?section=tags");
    expect(name.value).toBe("Closest friends");

    confirm.mockReturnValue(true);
    click(link("reminder-rules"));
    await waitFor(() => expect(heading().textContent).toBe("Reminder rules"));
    expect(location.search).toBe("?section=reminder-rules");
    expect(history.state.personalization).toEqual({
      index: 1,
      section: "reminder-rules",
    });
    expect(dirty().textContent).toBe("Changes discarded.");

    const days = createField("daysBefore")!;
    type(days, "14");
    confirm.mockReturnValue(false);
    const tags = entryState(0, "tags");
    const reminders = entryState(1, "reminder-rules");
    await pop(tags, "?section=tags");
    expect(go).toHaveBeenLastCalledWith(1);
    expect(heading().textContent).toBe("Reminder rules");
    expect(days.value).toBe("14");

    await pop(reminders, "?section=reminder-rules");
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(days.value).toBe("14");

    confirm.mockReturnValue(true);
    await pop(tags, "?section=tags");
    await waitFor(() => expect(heading().textContent).toBe("Tags"));
    expect(dirty().textContent).toBe("Changes discarded.");
    expect(document.activeElement).toBe(heading());

    const forwardName = input("Name for Friends");
    type(forwardName, "Forward draft");
    confirm.mockReturnValue(false);
    await pop(reminders, "?section=reminder-rules");
    expect(go).toHaveBeenLastCalledWith(-1);
    expect(forwardName.value).toBe("Forward draft");

    await pop(tags, "?section=tags");
    expect(confirm).toHaveBeenCalledTimes(5);
    expect(forwardName.value).toBe("Forward draft");

    confirm.mockReturnValue(true);
    await pop(reminders, "?section=reminder-rules");
    await waitFor(() => expect(heading().textContent).toBe("Reminder rules"));
    expect(dirty().textContent).toBe("Changes discarded.");
    const invalidDays = createField("daysBefore")!;
    type(invalidDays, "21");
    await pop({}, "?section=tags");
    expect(location.search).toBe("?section=reminder-rules");
    expect(invalidDays.value).toBe("21");
    expect(history.state.personalization).toEqual({
      index: 1,
      section: "reminder-rules",
    });
    await pop(entryState(1, "tags"), "?section=tags");
    expect(location.search).toBe("?section=reminder-rules");
    await pop(reminders, "?section=reminder-rules");
    expect(heading().textContent).toBe("Reminder rules");
  });

  it("returns to the entry a refused step left, once, and ignores that return", async () => {
    shell("tags");
    stubApi({
      [LIST]: (request) =>
        listed(request.params.section!, [
          entry({ name: `In ${request.params.section}` }),
        ]),
      [SESSION]: session,
    });
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const go = vi.spyOn(history, "go").mockImplementation(() => undefined);
    await mount();
    type(input("Name for In tags"), "Draft");
    await pop(entryState(3, "reminder-rules"), "?section=reminder-rules");
    expect(go).toHaveBeenLastCalledWith(-3);
    await pop(entryState(0, "tags"), "?section=tags");
    expect(location.search).toBe("?section=tags");
    expect(confirm).toHaveBeenCalledTimes(1);
    await pop(entryState(3, "reminder-rules"), "?section=reminder-rules");
    expect(go).toHaveBeenCalledTimes(2);
    await pop(entryState(5, "gender-options"), "?section=gender-options");
    expect(location.search).toBe("?section=tags");
    expect(history.state.personalization).toEqual({
      index: 0,
      section: "tags",
    });
    await pop(entryState(20_000, "tags"), "?section=tags");
    expect(location.search).toBe("?section=tags");
  });

  it("resets discarded create controls only after the target section loads", async () => {
    shell("relationship-types");
    let failTags = true;
    vi.stubGlobal("confirm", vi.fn(() => true));
    stubApi({
      [LIST]: (request) =>
        request.params.section === "tags" && failTags
          ? unavailable("Tags could not be loaded.")
          : listed(request.params.section!, [], {
            capabilities: { create: true },
          }),
      [SESSION]: session,
    });
    await mount();
    const forward = createField("forwardLabel")!;
    const reverse = createField("reverseLabel")!;
    type(forward, "Mentor");
    type(reverse, "Student");

    click(link("tags"));
    await waitFor(() =>
      expect(status().textContent).toBe("Tags could not be loaded. Retry")
    );
    expect(document.activeElement).toBe(status());
    expect(location.search).toBe("?section=tags");
    expect(history.state.personalization).toEqual({
      index: 1,
      section: "tags",
    });
    expect(forward.value).toBe("Mentor");
    expect(reverse.value).toBe("Student");
    expect(dirty().textContent).toBe("Unsaved changes.");

    failTags = false;
    click(link("reminder-rules"));
    await waitFor(() => expect(dirty().textContent).toBe("Changes discarded."));
    expect(createField("forwardLabel")).toBeNull();
    expect(createField("reverseLabel")).toBeNull();
    expect(createField("daysBefore")?.value).toBe("");
    expect(createField("name")?.value).toBe("");

    type(createField("daysBefore")!, "21");
    await pop(
      entryState(0, "relationship-types"),
      "?section=relationship-types",
    );
    await waitFor(() => expect(dirty().textContent).toBe("Changes discarded."));
    expect(createField("daysBefore")).toBeNull();
    expect(createField("forwardLabel")?.value).toBe("");
    expect(createField("reverseLabel")?.value).toBe("");

    type(createField("forwardLabel")!, "Parent");
    await pop(entryState(2, "reminder-rules"), "?section=reminder-rules");
    await waitFor(() => expect(dirty().textContent).toBe("Changes discarded."));
    expect(createField("daysBefore")?.value).toBe("");
  });

  it("retries a section that failed to open with the discard it was asked for", async () => {
    shell("tags");
    vi.stubGlobal("confirm", vi.fn(() => true));
    let failGender = true;
    stubApi({
      [LIST]: (request) =>
        request.params.section === "gender-options" && failGender
          ? unavailable("Gender options could not be loaded.")
          : listed(request.params.section!, [entry()]),
      [SESSION]: session,
    });
    await mount();
    type(input("Name for Close friends"), "Draft");
    click(link("gender-options"));
    await waitFor(() =>
      expect(status().textContent).toBe(
        "Gender options could not be loaded. Retry",
      )
    );
    failGender = false;
    click(button(status(), "Retry"));
    await waitFor(() => expect(heading().textContent).toBe("Gender options"));
    expect(dirty().textContent).toBe("Changes discarded.");
    expect(document.activeElement).toBe(heading());
  });

  it("keeps edited authoritative forms when link or back loading fails", async () => {
    shell("tags");
    const go = vi.spyOn(history, "go").mockImplementation(() => undefined);
    let failTags = false;
    const tag = entry({
      id: "00000000-0000-4000-8000-000000000072",
      name: "Friends",
    });
    const gender = entry({
      id: "00000000-0000-4000-8000-000000000073",
      name: "Custom",
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    stubApi({
      [LIST]: (request) => {
        const section = request.params.section;
        if (section === "reminder-rules") return Promise.reject(new Error("x"));
        if (section === "tags" && failTags) {
          return unavailable("Target section could not be loaded.");
        }
        return listed(section!, section === "tags" ? [tag] : [gender], {
          capabilities: { create: true },
        });
      },
      [SESSION]: session,
    });
    await mount();
    const tagName = input("Name for Friends");
    const createName = input("New option name");
    type(tagName, "Closest friends");
    type(createName, "Family");
    click(link("reminder-rules"));
    await waitFor(() =>
      expect(status().textContent).toBe(
        "This section could not be loaded. Retry",
      )
    );
    expect(location.search).toBe("?section=reminder-rules");
    expect(history.state.personalization).toEqual({
      index: 1,
      section: "reminder-rules",
    });
    expect(heading().textContent).toBe("Tags");
    expect(tagName.value).toBe("Closest friends");
    expect(tagName.disabled).toBe(false);
    expect(createName.value).toBe("Family");
    expect(createName.disabled).toBe(false);
    expect(dirty().textContent).toBe("Unsaved changes.");

    click(link("gender-options"));
    await waitFor(() => expect(dirty().textContent).toBe("Changes discarded."));
    const genderName = input("Name for Custom");
    type(genderName, "Individual");
    type(input("New option name"), "Another gender");
    failTags = true;
    await pop(entryState(0, "tags"), "?section=tags");
    await waitFor(() => expect(go).toHaveBeenLastCalledWith(2));
    await pop(entryState(2, "gender-options"), "?section=gender-options");
    expect(location.search).toBe("?section=gender-options");
    expect(heading().textContent).toBe("Gender options");
    expect(genderName.value).toBe("Individual");
    expect(genderName.disabled).toBe(false);
    expect(input("New option name").value).toBe("Another gender");
    expect(dirty().textContent).toBe("Unsaved changes.");
  });

  it("announces discard only after the authoritative target load wins", async () => {
    shell("tags");
    const target = deferred<Response>();
    stubApi({
      [LIST]: (request) =>
        request.params.section === "reminder-rules"
          ? target.promise
          : listed("tags", [], { capabilities: { create: true } }),
      [SESSION]: session,
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    await mount();
    type(input("New option name"), "Draft");
    click(link("reminder-rules"));
    expect(dirty().textContent).toBe("Unsaved changes.");
    const unload = new Event("beforeunload", { cancelable: true });
    dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await act(async () => {
      target.resolve(
        listed("reminder-rules", [], { capabilities: { create: true } }),
      );
      await target.promise;
    });
    await waitFor(() => expect(dirty().textContent).toBe("Changes discarded."));
    const cleanUnload = new Event("beforeunload", { cancelable: true });
    dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
    expect(heading().textContent).toBe("Reminder rules");
    const days = createField("daysBefore")!;
    act(() => {
      fireEvent.input(days);
      fireEvent.change(days);
    });
    expect(dirty().textContent).toBe("Changes discarded.");
    type(days, "7");
    expect(dirty().textContent).toBe("Unsaved changes.");
    expect(dirty().dataset.state).toBe("dirty");
    act(() => {
      fireEvent.change(days, { target: { value: "" } });
    });
    expect(dirty().textContent).toBe("All changes saved.");
    expect(dirty().dataset.state).toBe("saved");
  });

  it("makes stale mutation controls inert while a target section loads", async () => {
    shell("tags");
    const reminder = deferred<Response>();
    const tag = entry({
      id: "00000000-0000-4000-8000-000000000071",
      name: "Friends",
    });
    const api = stubApi({
      [LIST]: (request) =>
        request.params.section === "reminder-rules" ? reminder.promise : listed(
          request.params.section!,
          request.params.section === "tags" ? [tag] : [],
          { capabilities: { create: true } },
        ),
      [SESSION]: session,
    });
    await mount();
    const staleRow = rowOf("Name for Friends");
    click(link("reminder-rules"));
    expect(list().getAttribute("aria-busy")).toBe("true");
    expect(createForm().getAttribute("aria-busy")).toBe("true");
    expect(status().textContent).toBe("Loading reminder rules…");
    for (
      const control of document.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLButtonElement
      >(
        "#personalization-create input, #personalization-create button, #personalization-list input, #personalization-list select, #personalization-list button",
      )
    ) {
      expect(control.disabled).toBe(true);
    }
    submit(createForm());
    submit(staleRow.querySelector("form")!);
    click(button(staleRow, "Disable"));
    expect(writes(api.requests())).toEqual([]);

    click(link("relationship-types"));
    await waitFor(() => expect(createField("forwardLabel")).not.toBeNull());
    expect(list().getAttribute("aria-busy")).toBe("false");
    expect(createField("forwardLabel")?.disabled).toBe(false);
    expect(createField("reverseLabel")?.disabled).toBe(false);
    expect(button(createForm(), "Create option").disabled).toBe(false);

    await act(async () => {
      reminder.resolve(listed("reminder-rules", []));
      await reminder.promise;
    });
    expect(heading().textContent).toBe("Relationship types");
    expect(createField("daysBefore")).toBeNull();
    expect(createField("forwardLabel")).not.toBeNull();
  });

  it("discards a delayed response after section navigation", async () => {
    shell("tags");
    const initial = deferred<Response>();
    stubApi({
      [LIST]: (request) =>
        request.params.section === "tags"
          ? initial.promise
          : listed("reminder-rules", []),
      [SESSION]: session,
    });
    const settled = mountPending(() => mountPersonalization());
    await waitFor(() => expect(status().textContent).toBe("Loading tags…"));
    click(link("reminder-rules"));
    await waitFor(() =>
      expect(status().textContent).toBe(
        "No options yet. Create the first option for this workspace.",
      )
    );
    await act(async () => {
      initial.resolve(listed("tags", [entry({ name: "Late tag" })]));
      await settled;
    });
    expect(heading().textContent).toBe("Reminder rules");
    expect(list().children).toHaveLength(0);
    expect(status().textContent).toContain("No options yet");
  });

  it("keeps section navigation authoritative over a later refresh", async () => {
    shell("profile-modules");
    const mutation = deferred<Response>();
    const navigation = deferred<Response>();
    const tags = entry({ name: "Tags" });
    const reads: string[] = [];
    const api = stubApi({
      [LIST]: (request) => {
        reads.push(request.params.section!);
        if (request.params.section === "profile-modules") {
          return listed("profile-modules", [tags]);
        }
        return reads.filter((section) => section === "tags").length === 1
          ? navigation.promise
          : listed("tags", []);
      },
      [SESSION]: session,
      [UPDATE]: mutation.promise,
    });
    await mount();
    click(button(list(), "Disable"));
    await waitFor(() => expect(writes(api.requests())).toHaveLength(1));
    click(link("tags"));
    await act(async () => {
      mutation.resolve(jsonResponse({
        entry: { ...tags, isActive: false },
        status: "saved",
      }));
      await mutation.promise;
    });
    await waitFor(() =>
      expect(reads).toEqual(["profile-modules", "tags", "tags"])
    );
    await act(async () => {
      navigation.resolve(listed("tags", [entry({ name: "Stale" })]));
      await navigation.promise;
    });
    await waitFor(() => expect(list().getAttribute("aria-busy")).toBe("false"));
    expect(location.search).toBe("?section=tags");
    expect(history.state.personalization).toEqual({
      index: 1,
      section: "tags",
    });
    expect(heading().textContent).toBe("Tags");
    expect(list().textContent).not.toContain("Stale");
    expect(status().textContent).toBe("Option updated.");
    const requestCount = api.calls().length;
    link("tags").focus();
    click(link("tags"));
    expect(api.calls()).toHaveLength(requestCount);
    expect(document.activeElement).toBe(link("tags"));
    expect(status().textContent).toBe(
      "That personalization section is already open.",
    );
  });

  it("says why a row change or a creation was refused", async () => {
    shell("gender-options");
    const man = entry({ name: "Man" });
    const api = stubApi({
      [CREATE]: unreachable,
      [DELETE]: problemResponse(409, { detail: "Still in use." }),
      [LIST]: listed("gender-options", [man]),
      [SESSION]: session,
      [UPDATE]: [
        problemResponse(409, { detail: "Changed elsewhere." }),
        unreachable,
        unreachable,
      ],
    });
    await mount();
    const row = rowOf("Name for Man");
    submit(row.querySelector("form")!);
    await waitFor(() =>
      expect(status().textContent).toBe("Changed elsewhere.")
    );
    submit(row.querySelector("form")!);
    await waitFor(() =>
      expect(status().textContent).toBe("Option could not be saved.")
    );
    click(button(row, "Set default"));
    await waitFor(() =>
      expect(status().textContent).toBe("Default could not be updated.")
    );
    click(button(row, "Delete"));
    await waitFor(() => expect(status().textContent).toBe("Still in use."));
    type(input("New option name"), "Nonbinary");
    submit(createForm());
    await waitFor(() =>
      expect(status().textContent).toBe("Option could not be created.")
    );
    expect(writes(api.requests()).at(-1)?.body).toEqual({
      name: "Nonbinary",
      sortOrder: 1,
    });
  });

  it("sets a default and toggles an option, and names what failed", async () => {
    shell("gender-options");
    const woman = entry({ name: "Woman" });
    stubApi({
      [LIST]: listed("gender-options", [woman]),
      [SESSION]: session,
      [UPDATE]: [
        jsonResponse({ entry: woman, status: "saved" }),
        unreachable,
      ],
    });
    await mount();
    const row = rowOf("Name for Woman");
    click(button(row, "Set default"));
    await waitFor(() => expect(status().textContent).toBe("Default updated."));
    click(button(rowOf("Name for Woman"), "Disable"));
    await waitFor(() =>
      expect(status().textContent).toBe("Option could not be updated.")
    );
  });

  it("offers no creation for a shared vocabulary even if its form is submitted", async () => {
    shell("pet-categories");
    const api = stubApi({
      [LIST]: listed("pet-categories", [entry({ name: "Dog" })]),
      [SESSION]: session,
    });
    await mount();
    submit(createForm());
    expect(status().textContent).toBe("Option could not be created.");
    expect(writes(api.requests())).toEqual([]);
  });
});

describe("WORKSPACE-003 personalization drafts", () => {
  it("snapshots every named control, checkboxes by checked state", () => {
    drawShell(`<form>
      <input name="name" value="a">
      <select name="kind"><option value="x">X</option><option value="y">Y</option></select>
      <textarea name="note">n</textarea>
      <input name="on" type="checkbox">
      <input type="checkbox" value="unnamed">
      <button name="save" type="submit">Save</button>
    </form>`);
    const form = element<HTMLFormElement>("form");
    const baseline = draftSnapshot(form);
    const select = form.elements.namedItem("kind") as HTMLSelectElement;
    select.value = "y";
    expect(draftSnapshot(form)).not.toBe(baseline);
    select.value = "x";
    expect(draftSnapshot(form)).toBe(baseline);
    (form.elements.namedItem("note") as HTMLTextAreaElement).value = "m";
    expect(draftSnapshot(form)).not.toBe(baseline);
    (form.elements.namedItem("note") as HTMLTextAreaElement).value = "n";
    (form.elements.namedItem("on") as HTMLInputElement).checked = true;
    expect(draftSnapshot(form)).not.toBe(baseline);
    (form.elements.namedItem("on") as HTMLInputElement).checked = false;
    form.querySelector<HTMLInputElement>("[value=unnamed]")!.checked = true;
    expect(draftSnapshot(form)).toBe(baseline);
    const saved = baselineOf(form);
    select.value = "y";
    (form.elements.namedItem("on") as HTMLInputElement).checked = true;
    restore(saved);
    expect(select.value).toBe("x");
    expect((form.elements.namedItem("on") as HTMLInputElement).checked)
      .toBe(false);
    expect(draftSnapshot(form)).toBe(baseline);
  });
});
