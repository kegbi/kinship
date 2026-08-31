// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { readApplicationStylesheet } from "./application-stylesheet.test-helper.ts";
import { mountTaskSurface, mountTodayTasks } from "./tasks.ts";

const applicationCss = readApplicationStylesheet();
const todayPage = readFileSync("apps/web/src/pages/app.astro", "utf8");

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

const workspaceId = "00000000-0000-4000-8000-000000000003";
const personId = "00000000-0000-4000-8000-000000000100";
const taskId = "00000000-0000-4000-8000-000000000900";
const task = {
  createdAt: "2026-08-18T10:00:00.000Z",
  dueAt: "2026-08-20T09:00:00.000Z",
  id: taskId,
  person: { archived: false, id: personId, name: "Ada Lovelace" },
  status: "open",
  title: "Call Ada",
  updatedAt: "2026-08-18T10:00:00.000Z",
};
const session = {
  member: { id: "member", role: "member" },
  principal: { userId: "user" },
  status: "authenticated",
  workspace: { id: workspaceId, name: "Circle" },
  workspaces: [{ id: workspaceId, name: "Circle" }],
};

function surfaceMarkup(global = false): void {
  document.body.innerHTML = `
    <p data-task-state></p><button data-task-retry hidden>Retry</button>
    <button data-task-add>Add task</button>
    ${
    global
      ? '<select data-task-status-filter><option value="">All</option><option value="open">Open</option></select><select data-task-person-filter><option value="">All</option></select><button data-task-people-more>Load more people</button>'
      : ""
  }
    <form data-task-form hidden>
      <input name="title"><textarea name="description"></textarea><input name="dueAt" type="datetime-local">
      ${
    global
      ? '<select name="personId"><option value="">Workspace</option></select>'
      : ""
  }
      <select name="status"><option value="open">Open</option><option value="cancelled">Cancelled</option></select>
      <p data-task-form-state></p><button type="submit">Save</button><button data-task-cancel type="button">Cancel</button>
    </form>
    <ul data-task-open-list></ul><ul data-task-completed-list></ul><ul data-task-cancelled-list></ul><button data-task-more>Load more tasks</button>`;
}

function todayMarkup(): void {
  document.body.innerHTML =
    `<time data-today-date>Loading date…</time><p id="today-attention-state"></p><button id="today-attention-retry" class="today-touch-target" type="button" hidden>Retry</button><div id="today-onboarding" hidden></div><ul id="today-overdue-list"></ul><ul id="today-due-today-list"></ul><ul id="today-next-seven-list"></ul><p id="today-upcoming-state"></p><ul id="today-upcoming-list"></ul><button id="today-upcoming-retry" class="today-touch-target" type="button" hidden>Retry upcoming</button><p id="secondary">Preserved</p>`;
}

function attention(
  overdue: readonly unknown[] = [],
  upcoming: readonly unknown[] = [],
) {
  return {
    attention: { nextSevenDays: [], overdue, today: [] },
    date: "2026-08-18",
    status: "ready",
    timezone: "Europe/Belgrade",
    upcoming,
  };
}

function todayFetch(...results: Array<Response | Promise<Response>>) {
  let index = 0;
  return vi.fn((input: string | URL | Request, init?: RequestInit) =>
    String(input).includes("/session")
      ? Promise.resolve(response(session))
      : init?.method === "PUT"
      ? Promise.resolve(response({ status: "saved", task }))
      : Promise.resolve(results[index++])
  );
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => resolve = done);
  return { promise, resolve };
}

function reconnect(): void {
  globalThis.dispatchEvent(new CustomEvent("kinship:today-reconnect-recorded"));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("PLANNING-001 task browser behavior", () => {
  it("does nothing when task regions are absent", async () => {
    await mountTaskSurface({ workspaceId });
    await mountTodayTasks();
    expect(document.body.textContent).toBe("");
  });

  it("loads a person task, creates a task, and completes idempotently", async () => {
    surfaceMarkup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [task], status: "ready" }))
      .mockResolvedValueOnce(response({ status: "created", task }, 201))
      .mockResolvedValueOnce(response({ items: [task], status: "ready" }))
      .mockResolvedValueOnce(
        response({ status: "saved", task: { ...task, status: "completed" } }),
      )
      .mockResolvedValueOnce(response({ items: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountTaskSurface({ personId, workspaceId });
    expect(document.querySelector("[data-task-open-list]")?.textContent)
      .toContain("Call Ada");
    document.querySelector<HTMLButtonElement>("[data-task-add]")!.click();
    const form = document.querySelector<HTMLFormElement>("[data-task-form]")!;
    (form.elements.namedItem("title") as HTMLInputElement).value =
      "Send Ada notes";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    document.querySelector<HTMLButtonElement>("[data-task-open-list] button")!
      .click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({ method: "PUT" });
  });

  it.each(
    [
      ["completes", "open", "completed", true],
      ["reopens", "completed", "open", false],
    ] as const,
  )(
    "%s a task row before the mutation resolves",
    async (_label, initialStatus, optimisticList, completed) => {
      surfaceMarkup();
      const mutation = deferredResponse();
      const initial = { ...task, status: initialStatus };
      const reconciled = { ...task, status: optimisticList };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(
          response({ items: [initial], status: "ready" }),
        )
        .mockReturnValueOnce(mutation.promise)
        .mockResolvedValueOnce(
          response({ items: [reconciled], status: "ready" }),
        );
      vi.stubGlobal("fetch", fetchMock);
      await mountTaskSurface({ personId, workspaceId });
      const source = document.querySelector<HTMLUListElement>(
        `[data-task-${initialStatus === "open" ? "open" : "completed"}-list]`,
      )!;
      const destination = document.querySelector<HTMLUListElement>(
        `[data-task-${optimisticList}-list]`,
      )!;
      const row = source.querySelector<HTMLLIElement>("li")!;
      const control = row.querySelector<HTMLButtonElement>("button")!;
      const controlText = control.textContent;

      control.click();

      expect(source.contains(row)).toBe(false);
      expect(destination.firstElementChild).toBe(row);
      expect(control.disabled).toBe(true);
      expect(control.textContent).toBe(controlText);
      expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
        completed,
      });

      mutation.resolve(response({ status: "saved", task: reconciled }));
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      await vi.waitFor(() => expect(control.disabled).toBe(false));
      expect(destination.textContent).toContain(task.title);
      expect(destination.querySelector<HTMLButtonElement>("button")?.disabled)
        .toBe(false);
    },
  );

  it.each([
    [
      "a server failure",
      response({}, 503),
      "Task state could not be changed.",
    ],
    [
      "an archived-person rejection",
      response({
        code: "archived_write_rejected",
        detail: "Restore the person first.",
        status: 409,
        title: "Archived person is read-only",
        type: "about:blank",
      }, 409),
      "Restore the linked person before changing this task.",
    ],
  ])(
    "restores the exact task row after %s",
    async (_label, failure, message) => {
      surfaceMarkup();
      const mutation = deferredResponse();
      const laterTask = {
        ...task,
        id: "00000000-0000-4000-8000-000000000901",
        title: "Later task",
      };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(
          response({ items: [task, laterTask], status: "ready" }),
        )
        .mockReturnValueOnce(mutation.promise);
      vi.stubGlobal("fetch", fetchMock);
      await mountTaskSurface({ personId, workspaceId });
      const openList = document.querySelector<HTMLUListElement>(
        "[data-task-open-list]",
      )!;
      const completedList = document.querySelector<HTMLUListElement>(
        "[data-task-completed-list]",
      )!;
      const row = openList.firstElementChild as HTMLLIElement;
      const nextRow = row.nextElementSibling;
      const control = row.querySelector<HTMLButtonElement>("button")!;
      const editControl = row.querySelectorAll<HTMLButtonElement>("button")[1]!;
      const priorPresentation = row.innerHTML;

      control.click();

      expect(completedList.firstElementChild).toBe(row);
      expect(control.disabled).toBe(true);
      expect(editControl.disabled).toBe(true);
      expect(row.getAttribute("aria-busy")).toBe("true");
      mutation.resolve(failure);

      await vi.waitFor(() => expect(control.disabled).toBe(false));
      expect(openList.firstElementChild).toBe(row);
      expect(row.nextElementSibling).toBe(nextRow);
      expect(editControl.disabled).toBe(false);
      expect(row.hasAttribute("aria-busy")).toBe(false);
      expect(row.innerHTML).toBe(priorPresentation);
      expect(completedList.children).toHaveLength(0);
      expect(document.querySelector("[data-task-form-state]")?.textContent)
        .toBe(message);
    },
  );

  it("edits global tasks and keeps archived person tasks read-only", async () => {
    surfaceMarkup(true);
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({
          lifecycle: "active",
          people: [{
            givenName: "Ada",
            id: personId,
            isPartial: false,
            isStarred: false,
            lifecycle: "active",
          }],
          status: "ready",
        }))
        .mockResolvedValueOnce(response({ items: [task], status: "ready" }))
        .mockResolvedValueOnce(
          response({ status: "saved", task: { ...task, title: "Updated" } }),
        )
        .mockResolvedValueOnce(response({ items: [task], status: "ready" })),
    );
    await mountTaskSurface({ workspaceId });
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      "[data-task-open-list] button",
    );
    expect(buttons[1]?.classList.contains("button-secondary")).toBe(true);
    buttons[1]!.click();
    const form = document.querySelector<HTMLFormElement>("[data-task-form]")!;
    (form.elements.namedItem("title") as HTMLInputElement).value = "Updated";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("[data-task-form-state]")?.textContent)
        .toContain("saved")
    );

    surfaceMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        response({
          items: [{ ...task, person: { ...task.person, archived: true } }],
          status: "ready",
        }),
      ),
    );
    await mountTaskSurface({ archived: true, personId, workspaceId });
    expect(document.querySelector<HTMLButtonElement>("[data-task-add]")?.hidden)
      .toBe(true);
    expect(document.querySelector("[data-task-open-list] button")).toBeNull();
  });

  it("blocks a delayed double-submit while one create request is pending", async () => {
    surfaceMarkup();
    const pending = new Promise<Response>(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [], status: "ready" }))
      .mockReturnValueOnce(pending);
    vi.stubGlobal("fetch", fetchMock);
    await mountTaskSurface({ personId, workspaceId });
    document.querySelector<HTMLButtonElement>("[data-task-add]")!.click();
    const form = document.querySelector<HTMLFormElement>("[data-task-form]")!;
    (form.elements.namedItem("title") as HTMLInputElement).value = "One task";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    expect(
      fetchMock.mock.calls.filter((call) => call[1]?.method === "POST"),
    ).toHaveLength(1);
  });

  it("reuses one create request id after an ambiguous failure", async () => {
    surfaceMarkup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [], status: "ready" }))
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(response({ status: "created", task }, 201))
      .mockResolvedValueOnce(response({ items: [task], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountTaskSurface({ personId, workspaceId });
    document.querySelector<HTMLButtonElement>("[data-task-add]")!.click();
    const form = document.querySelector<HTMLFormElement>("[data-task-form]")!;
    (form.elements.namedItem("title") as HTMLInputElement).value = "Retry me";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("[data-task-form-state]")?.textContent)
        .toContain("retry")
    );
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const posts = fetchMock.mock.calls.filter((call) =>
      call[1]?.method === "POST"
    );
    expect(posts).toHaveLength(2);
    const first = JSON.parse(String(posts[0]?.[1]?.body));
    const second = JSON.parse(String(posts[1]?.[1]?.body));
    expect(second.requestId).toBe(first.requestId);
  });

  it("keeps a completed task completed through edit and reopens only explicitly", async () => {
    surfaceMarkup();
    const completed = { ...task, status: "completed" };
    const updated = { ...completed, title: "Updated completed task" };
    const reopened = { ...updated, status: "open" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [completed], status: "ready" }))
      .mockResolvedValueOnce(response({ status: "saved", task: updated }))
      .mockResolvedValueOnce(response({ items: [updated], status: "ready" }))
      .mockResolvedValueOnce(response({ status: "saved", task: reopened }))
      .mockResolvedValueOnce(response({ items: [reopened], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountTaskSurface({ personId, workspaceId });
    const completedItem = document.querySelector<HTMLElement>(
      "[data-task-completed-list] li",
    )!;
    completedItem.querySelectorAll<HTMLButtonElement>("button")[1]!.click();
    const form = document.querySelector<HTMLFormElement>("[data-task-form]")!;
    (form.elements.namedItem("title") as HTMLInputElement).value =
      "Updated completed task";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const patchBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(patchBody).not.toHaveProperty("status");
    expect(document.querySelector("[data-task-completed-list]")?.textContent)
      .toContain("Updated completed task");
    document.querySelector<HTMLButtonElement>(
      "[data-task-completed-list] button",
    )!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      completed: false,
    });
    expect(document.querySelector("[data-task-open-list]")?.textContent)
      .toContain("Updated completed task");
  });

  it("renders cancelled tasks truthfully and reopens them explicitly", async () => {
    surfaceMarkup();
    const cancelled = { ...task, status: "cancelled" };
    const reopened = { ...task, status: "open" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [cancelled], status: "ready" }))
      .mockResolvedValueOnce(response({ status: "saved", task: reopened }))
      .mockResolvedValueOnce(response({ items: [reopened], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountTaskSurface({ personId, workspaceId });
    const cancelledItem = document.querySelector<HTMLElement>(
      "[data-task-cancelled-list] li",
    )!;
    expect(cancelledItem.textContent).toContain("Call Ada");
    expect(cancelledItem.querySelector("button")?.textContent).toBe("Reopen");
    cancelledItem.querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      completed: false,
    });
    expect(document.querySelector("[data-task-open-list]")?.textContent)
      .toContain("Call Ada");
  });

  it("preserves due precision on title-only edit and sends deliberate due edits", async () => {
    surfaceMarkup();
    const precise = { ...task, dueAt: "2026-08-20T09:00:30.500Z" };
    const renamed = { ...precise, title: "Precise renamed" };
    const moved = { ...renamed, dueAt: "2026-08-21T10:15:00.000Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [precise], status: "ready" }))
      .mockResolvedValueOnce(response({ status: "saved", task: renamed }))
      .mockResolvedValueOnce(response({ items: [renamed], status: "ready" }))
      .mockResolvedValueOnce(response({ status: "saved", task: moved }))
      .mockResolvedValueOnce(response({ items: [moved], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountTaskSurface({ personId, workspaceId });
    document.querySelectorAll<HTMLButtonElement>(
      "[data-task-open-list] button",
    )[1]!.click();
    const form = document.querySelector<HTMLFormElement>("[data-task-form]")!;
    (form.elements.namedItem("title") as HTMLInputElement).value =
      "Precise renamed";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).not
      .toHaveProperty("dueAt");

    document.querySelectorAll<HTMLButtonElement>(
      "[data-task-open-list] button",
    )[1]!.click();
    const due = form.elements.namedItem("dueAt") as HTMLInputElement;
    due.value = "2026-08-21T10:15";
    due.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)).dueAt).toBe(
      new Date("2026-08-21T10:15").toISOString(),
    );
  });

  it("loads task 101 through continuation without losing person filters", async () => {
    surfaceMarkup(true);
    const later = {
      ...task,
      id: "00000000-0000-4000-8000-000000000901",
      title: "Task 101",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        response({ lifecycle: "active", people: [], status: "ready" }),
      )
      .mockResolvedValueOnce(
        response({ items: [task], nextCursor: "task-cursor", status: "ready" }),
      )
      .mockResolvedValueOnce(response({ items: [later], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountTaskSurface({ workspaceId });
    document.querySelector<HTMLButtonElement>("[data-task-more]")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-task-open-list]")?.textContent)
        .toContain("Task 101")
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      "cursor=task-cursor",
    );
    expect(document.querySelector("[data-task-open-list]")?.textContent)
      .toContain("Task 101");
    expect(document.querySelector("[data-task-open-list]")?.textContent)
      .toContain("Call Ada");
  });

  it("separates paged active choices from historical unavailable filters", async () => {
    surfaceMarkup(true);
    const people = Array.from({ length: 50 }, (_, index) => ({
      givenName: `Person ${index + 1}`,
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      isPartial: false,
      isStarred: false,
      lifecycle: "active",
    }));
    const unavailableId = "00000000-0000-4000-8000-000000000777";
    const historical = {
      ...task,
      person: {
        archived: true,
        id: unavailableId,
        name: "Deleted/Unavailable person",
        unavailable: true,
      },
    };
    const active51 = {
      givenName: "Reachable 51",
      id: "00000000-0000-4000-8000-000000000051",
      isPartial: false,
      isStarred: false,
      lifecycle: "active",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        response({
          lifecycle: "active",
          nextCursor: "people-cursor",
          people,
          status: "ready",
        }),
      )
      .mockResolvedValueOnce(response({ items: [historical], status: "ready" }))
      .mockResolvedValueOnce(
        response({ lifecycle: "active", people: [active51], status: "ready" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await mountTaskSurface({ workspaceId });
    const item = document.querySelector<HTMLElement>(
      "[data-task-open-list] li",
    )!;
    expect(item.textContent).toContain("Deleted/Unavailable person");
    expect(item.textContent).not.toContain("(archived)");
    expect(item.querySelector("button")).toBeNull();
    const writable = document.querySelector<HTMLSelectElement>(
      "[name=personId]",
    )!;
    const historicalFilter = document.querySelector<HTMLSelectElement>(
      "[data-task-person-filter]",
    )!;
    expect(writable.querySelector(`[value='${unavailableId}']`)).toBeNull();
    expect(historicalFilter.querySelector(`[value='${unavailableId}']`)).not
      .toBeNull();
    document.querySelector<HTMLButtonElement>("[data-task-people-more]")!
      .click();
    await vi.waitFor(() =>
      expect(writable.querySelector(`[value='${active51.id}']`)).not.toBeNull()
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      "cursor=people-cursor",
    );
    expect(writable.querySelector(`[value='${active51.id}']`)).not.toBeNull();
    expect(historicalFilter.querySelector(`[value='${active51.id}']`)).not
      .toBeNull();
  });

  it("preserves an active task link outside the first directory page on edit", async () => {
    surfaceMarkup(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        response({ lifecycle: "active", people: [], status: "ready" }),
      )
      .mockResolvedValueOnce(response({ items: [task], status: "ready" }))
      .mockResolvedValueOnce(response({ status: "saved", task }))
      .mockResolvedValueOnce(response({ items: [task], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountTaskSurface({ workspaceId });
    document.querySelectorAll<HTMLButtonElement>(
      "[data-task-open-list] button",
    )[1]!.click();
    const form = document.querySelector<HTMLFormElement>("[data-task-form]")!;
    const select = form.elements.namedItem("personId") as HTMLSelectElement;
    expect(select.value).toBe(personId);
    (form.elements.namedItem("title") as HTMLInputElement).value = "Keep Ada";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const body = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(body.personId).toBe(personId);
  });

  it("renders and completes one coherent server-clock Today snapshot", async () => {
    todayMarkup();
    document.body.style.width = "320px";
    const dueAt = "2026-03-08T06:30:00.000Z";
    const longTitle = "T".repeat(500);
    const unavailableLongTitle = "U".repeat(500);
    const active = {
      dueAt,
      id: task.id,
      kind: "task",
      person: task.person,
      title: task.title,
    };
    const items = [
      active,
      {
        ...active,
        id: crypto.randomUUID(),
        person: { ...task.person, archived: true },
        title: "Archived",
      },
      {
        ...active,
        id: crypto.randomUUID(),
        person: { ...task.person, unavailable: true },
        title: "Unavailable",
      },
      {
        ...active,
        id: crypto.randomUUID(),
        person: { ...task.person, unavailable: true },
        title: unavailableLongTitle,
      },
      {
        ...active,
        id: crypto.randomUUID(),
        person: undefined,
        title: "Workspace",
      },
      {
        ...active,
        id: crypto.randomUUID(),
        kind: "reminder",
        occursOn: "2026-03-08",
        reminderStatus: "pending",
        title: "Direct reminder",
      },
      {
        ...active,
        id: crypto.randomUUID(),
        kind: "important-date",
        occursOn: "2026-03-08",
        reminderStatus: "pending",
        title: "Birthday",
      },
      {
        ...active,
        id: crypto.randomUUID(),
        kind: "life-event",
        occursOn: "2026-03-08",
        reminderStatus: "pending",
        title: "Moved home",
      },
      {
        ...active,
        id: crypto.randomUUID(),
        kind: "reminder",
        occursOn: "2026-03-08",
        person: undefined,
        reminderStatus: "pending",
        title: "Imported personless reminder",
      },
      {
        ...active,
        id: crypto.randomUUID(),
        kind: "important-date",
        occursOn: "2026-03-08",
        person: undefined,
        reminderStatus: "pending",
        title: "Imported personless date",
      },
      {
        ...active,
        id: crypto.randomUUID(),
        title: longTitle,
      },
    ];
    const cadences = [
      {
        ...active,
        id: crypto.randomUUID(),
        kind: "cadence",
        lastContactedAt: dueAt,
        title: "Contacted",
      },
      {
        ...active,
        id: crypto.randomUUID(),
        kind: "cadence",
        person: { ...task.person, archived: true },
        title: "Never contacted",
      },
    ];
    const fetchMock = todayFetch(
      response({
        ...attention([...items, ...cadences], [...items, ...cadences]),
        date: "2026-03-07",
        timezone: "America/New_York",
      }),
      response({
        ...attention(),
        date: "2026-03-07",
        timezone: "America/New_York",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayTasks();
    const snapshotCalls = () =>
      fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes("/today/attention")
      );
    const row = (selector: string, title: string) =>
      [...document.querySelectorAll<HTMLElement>(`${selector} li`)]
        .find((item) => item.textContent?.includes(title))!;
    expect(snapshotCalls()).toHaveLength(1);
    for (const selector of ["#today-overdue-list", "#today-upcoming-list"]) {
      expect(
        row(selector, task.title).querySelector("a")?.getAttribute("href"),
      ).toBe(
        `/app/people/${personId}?section=tasks`,
      );
      expect(
        row(selector, "Archived").querySelector("a")?.getAttribute("href"),
      ).toBe(
        `/app/people/${personId}?section=tasks`,
      );
      expect(row(selector, "Unavailable").textContent).toContain(
        "Ada Lovelace",
      );
      expect(row(selector, "Unavailable").querySelector("a,button")).toBeNull();
      expect(
        row(selector, "Workspace").querySelector("a")?.getAttribute("href"),
      ).toBe("/app/tasks");
      expect(
        row(selector, "Direct reminder").querySelector("a")?.getAttribute(
          "href",
        ),
      ).toContain("?section=reminders");
      expect(
        row(selector, "Birthday").querySelector("a")?.getAttribute("href"),
      ).toContain("?section=important-dates");
      expect(
        row(selector, "Moved home").querySelector("a")?.getAttribute("href"),
      ).toContain("?section=life-events");
      expect(
        row(selector, "Contacted").querySelector("a")?.getAttribute("href"),
      ).toContain("?section=stay-in-touch");
      for (
        const title of [
          "Imported personless reminder",
          "Imported personless date",
        ]
      ) {
        const personless = row(selector, title);
        expect(personless.querySelector("a,button")).toBeNull();
        expect(personless.querySelector(".attention-title")?.tagName).toBe(
          "P",
        );
      }
    }
    expect(row("#today-overdue-list", "Contacted").textContent).toContain(
      "Last contact",
    );
    expect(row("#today-overdue-list", "Never contacted").textContent).toContain(
      "No contact recorded",
    );
    const style = document.createElement("style");
    style.textContent = applicationCss;
    document.head.append(style);
    const targets = [
      document.querySelector<HTMLElement>("#today-attention-retry")!,
      document.querySelector<HTMLElement>("#today-upcoming-retry")!,
      ...document.querySelectorAll<HTMLElement>(
        "#today-overdue-list a, #today-upcoming-list a",
      ),
    ];
    for (const target of targets) {
      const computed = getComputedStyle(target);
      expect(target.classList).toContain("today-touch-target");
      expect(computed.minHeight).toBe("44px");
      expect(computed.minWidth).toBe("44px");
      expect(computed.maxInlineSize).toBe("100%");
      expect(computed.width).not.toBe("100%");
    }
    const longLink = row("#today-overdue-list", longTitle)
      .querySelector<HTMLAnchorElement>("a")!;
    const longStyle = getComputedStyle(longLink);
    expect(longLink.textContent).toHaveLength(500);
    expect(longLink.tabIndex).toBe(0);
    expect(longLink.classList).toContain("attention-title");
    expect(longStyle.display).toBe("inline-flex");
    expect(longStyle.whiteSpace).toBe("normal");
    expect(longStyle.overflowWrap).toBe("anywhere");
    for (const selector of ["#today-overdue-list", "#today-upcoming-list"]) {
      const unavailableTitle = row(selector, unavailableLongTitle)
        .querySelector<HTMLElement>(".attention-title")!;
      const unavailableStyle = getComputedStyle(unavailableTitle);
      expect(unavailableTitle.tagName).toBe("P");
      expect(unavailableTitle.textContent).toHaveLength(500);
      expect(unavailableTitle.querySelector("a,button")).toBeNull();
      expect(unavailableTitle.classList).not.toContain("today-touch-target");
      expect(unavailableTitle.tabIndex).toBe(-1);
      expect(unavailableStyle.maxInlineSize).toBe("100%");
      expect(unavailableStyle.whiteSpace).toBe("normal");
      expect(unavailableStyle.overflowWrap).toBe("anywhere");
      expect(unavailableStyle.minHeight).not.toBe("44px");
      expect(unavailableStyle.minWidth).not.toBe("44px");
    }
    const ordinaryHeading = document.createElement("h3");
    ordinaryHeading.textContent = "Ordinary heading";
    document.body.append(ordinaryHeading);
    expect(ordinaryHeading.classList).not.toContain("today-touch-target");
    expect(getComputedStyle(ordinaryHeading).maxInlineSize).not.toBe("100%");
    expect(
      targets.slice(0, 2).every((target) =>
        target instanceof HTMLButtonElement && target.type === "button" &&
        target.hidden
      ),
    ).toBe(true);
    expect(todayPage.match(/today-touch-target/g)).toHaveLength(8);
    expect(todayPage).toMatch(
      /id="today-cadences-retry" class="button-secondary today-touch-target" type="button" hidden>Retry reconnect suggestions<\/button>/,
    );
    expect(todayPage).toMatch(
      /id="today-reminders-retry" class="button-secondary today-touch-target" type="button" hidden>Retry reminder state<\/button>/,
    );
    expect(
      document.querySelector("[data-today-date]")?.getAttribute("datetime"),
    ).toBe("2026-03-07");
    expect(document.body.textContent).toContain(
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/New_York",
      }).format(new Date(dueAt)),
    );
    document.querySelector<HTMLButtonElement>("#today-overdue-list button")!
      .click();
    await vi.waitFor(() =>
      expect(document.activeElement?.id).toBe("today-attention-state")
    );
    expect(snapshotCalls()).toHaveLength(2);
    expect(document.querySelectorAll(".attention-item")).toHaveLength(0);
    expect(document.querySelector("#secondary")?.textContent).toBe("Preserved");
    expect(applicationCss).toMatch(
      /\.form-actions button\s*\{[^}]*min-height:\s*46px/s,
    );
  });

  it("settles an invalid runtime timezone honestly and preserves the last good date", async () => {
    todayMarkup();
    const good = attention([{
      dueAt: task.dueAt,
      id: task.id,
      kind: "task",
      person: task.person,
      title: task.title,
    }]);
    const invalid = { ...good, timezone: "Definitely/Not_A_Zone" };
    vi.stubGlobal(
      "fetch",
      todayFetch(response(invalid), response(good), response(invalid)),
    );

    await mountTodayTasks();
    const date = document.querySelector<HTMLTimeElement>("[data-today-date]")!;
    expect(date.textContent).toBe("Date unavailable");
    expect(date.hasAttribute("datetime")).toBe(false);
    expect(document.querySelectorAll(".attention-item")).toHaveLength(0);
    expect(
      document.querySelector<HTMLButtonElement>("#today-attention-retry")!
        .hidden,
    ).toBe(false);
    expect(document.getElementById("today-upcoming-retry")!.hidden).toBe(false);
    expect(document.getElementById("today-upcoming-state")!.textContent)
      .toMatch(/could not be loaded/i);

    document.querySelector<HTMLButtonElement>("#today-attention-retry")!
      .click();
    await vi.waitFor(() => expect(date.dateTime).toBe(good.date));
    const lastGoodText = date.textContent;
    expect(document.querySelectorAll(".attention-item")).toHaveLength(1);

    document.querySelector<HTMLButtonElement>("#today-attention-retry")!
      .click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>("#today-attention-retry")!
          .hidden,
      ).toBe(false)
    );
    expect(date.dateTime).toBe(good.date);
    expect(date.textContent).toBe(lastGoodText);
    expect(document.querySelectorAll(".attention-item")).toHaveLength(1);
  });

  it("settles the Today date when the initial workspace session is unavailable", async () => {
    todayMarkup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, 503)));
    await mountTodayTasks();
    const date = document.querySelector<HTMLTimeElement>("[data-today-date]")!;
    expect(date.textContent).toBe("Date unavailable");
    expect(date.hasAttribute("datetime")).toBe(false);
    expect(document.body.textContent).not.toContain("Loading");
  });

  it("keeps the last coherent snapshot when Intl formatting fails after validation", async () => {
    todayMarkup();
    const preserved = attention([{
      dueAt: task.dueAt,
      id: task.id,
      kind: "task",
      person: task.person,
      title: "Preserved task",
    }]);
    const newer = attention([{
      dueAt: task.dueAt,
      id: crypto.randomUUID(),
      kind: "task",
      title: "Must not partially render",
    }]);
    vi.stubGlobal(
      "fetch",
      todayFetch(response(preserved), response(newer)),
    );
    await mountTodayTasks();
    const date = document.querySelector<HTMLTimeElement>("[data-today-date]")!;
    const lastDate = date.textContent;
    const NativeDateTimeFormat = Intl.DateTimeFormat;
    let calls = 0;
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      (function (
        locales?: Intl.LocalesArgument,
        options?: Intl.DateTimeFormatOptions,
      ) {
        calls += 1;
        if (calls === 2) throw new RangeError("formatter unavailable");
        return new NativeDateTimeFormat(locales, options);
      }) as typeof Intl.DateTimeFormat,
    );

    document.querySelector<HTMLButtonElement>("#today-attention-retry")!
      .click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>("#today-attention-retry")!
          .hidden,
      ).toBe(false)
    );
    expect(document.body.textContent).toContain("Preserved task");
    expect(document.body.textContent).not.toContain(
      "Must not partially render",
    );
    expect(date.textContent).toBe(lastDate);
    expect(date.dateTime).toBe(preserved.date);
  });

  it("serializes Today completion across failure, success, and a later failure", async () => {
    todayMarkup();
    const first = deferredResponse();
    const second = deferredResponse();
    const third = deferredResponse();
    const firstTask = {
      dueAt: task.dueAt,
      id: task.id,
      kind: "task",
      title: "First task",
    };
    const secondTask = {
      ...firstTask,
      id: crypto.randomUUID(),
      title: "Second task",
    };
    const mutations = [first.promise, second.promise, third.promise];
    const snapshots = [
      response(attention([firstTask, secondTask])),
      response(attention([firstTask])),
    ];
    let mutationIndex = 0;
    let snapshotIndex = 0;
    const fetchMock = vi.fn((
      input: string | URL | Request,
      init?: RequestInit,
    ) =>
      String(input).includes("/session")
        ? Promise.resolve(response(session))
        : init?.method === "PUT"
        ? mutations[mutationIndex++]!
        : Promise.resolve(snapshots[snapshotIndex++]!)
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayTasks();
    const button = (title: string) =>
      [...document.querySelectorAll<HTMLElement>("#today-overdue-list li")]
        .find((item) => item.textContent?.includes(title))!
        .querySelector<HTMLButtonElement>("button")!;
    const mutationCalls = () =>
      fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT").length;

    const firstButton = button("First task");
    const secondButton = button("Second task");
    firstButton.click();
    expect([firstButton.disabled, secondButton.disabled]).toEqual([true, true]);
    document.getElementById("today-attention-retry")!.click();
    document.getElementById("today-upcoming-retry")!.click();
    secondButton.click();
    firstButton.click();
    expect(mutationCalls()).toBe(1);
    first.resolve(response({}, 503));
    await vi.waitFor(() => expect(firstButton.disabled).toBe(false));
    expect(secondButton.disabled).toBe(false);
    expect(document.activeElement).toBe(firstButton);

    secondButton.click();
    secondButton.click();
    expect(mutationCalls()).toBe(2);
    expect([firstButton.disabled, secondButton.disabled]).toEqual([true, true]);
    second.resolve(response({ status: "saved", task }));
    await vi.waitFor(() =>
      expect(document.body.textContent).not.toContain("Second task")
    );
    expect(mutationCalls()).toBe(2);
    expect(
      fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes("/today/attention")
      ),
    ).toHaveLength(2);
    expect(button("First task").disabled).toBe(false);
    expect(document.activeElement?.id).toBe("today-attention-state");

    const liveFirst = button("First task");
    liveFirst.click();
    liveFirst.click();
    expect(mutationCalls()).toBe(3);
    third.resolve(response({}, 503));
    await vi.waitFor(() => expect(liveFirst.disabled).toBe(false));
    expect(document.activeElement).toBe(liveFirst);
  });

  it("keeps a failed completion terminal and retries the owning mutation", async () => {
    todayMarkup();
    const first = deferredResponse();
    const second = deferredResponse();
    const item = {
      dueAt: task.dueAt,
      id: task.id,
      kind: "task",
      title: "Retry this task",
    };
    const mutations = [first.promise, second.promise];
    const snapshots = [
      response(attention([item], [item])),
      response(attention()),
    ];
    let mutationIndex = 0;
    let snapshotIndex = 0;
    const fetchMock = vi.fn((
      input: string | URL | Request,
      init?: RequestInit,
    ) =>
      String(input).includes("/session")
        ? Promise.resolve(response(session))
        : init?.method === "PUT"
        ? mutations[mutationIndex++]!
        : Promise.resolve(snapshots[snapshotIndex++]!)
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayTasks();
    const complete = () =>
      document.querySelector<HTMLButtonElement>(
        "#today-overdue-list button[data-today-complete]",
      )!;
    const optimisticRow = complete().closest("li")!;
    const optimisticControl = complete();
    optimisticControl.click();
    expect(optimisticControl.disabled).toBe(true);
    expect(optimisticRow.hidden).toBe(true);
    expect(document.querySelector("#today-attention-state")?.textContent)
      .toBe("Completing task…");
    first.resolve(response({}, 503));
    await vi.waitFor(() => expect(complete().disabled).toBe(false));
    expect(complete()).toBe(optimisticControl);
    expect(complete().closest("li")).toBe(optimisticRow);
    expect(optimisticRow.hidden).toBe(false);
    expect(document.querySelector("#today-attention-state")?.textContent)
      .toMatch(/1 relationship priority.*could not be completed/i);
    expect(document.activeElement).toBe(complete());
    expect(
      document.querySelector<HTMLButtonElement>("#today-attention-retry")!
        .hidden,
    ).toBe(true);
    expect(document.getElementById("today-upcoming-retry")!.hidden).toBe(true);

    const successfulControl = complete();
    const successfulRow = successfulControl.closest("li")!;
    successfulControl.click();
    expect(successfulControl.disabled).toBe(true);
    expect(successfulRow.hidden).toBe(true);
    second.resolve(response({ status: "saved", task }));
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".attention-item")).toHaveLength(0)
    );
    expect(successfulControl.disabled).toBe(false);
    expect(document.querySelector("#today-attention-state")?.textContent)
      .toMatch(/All clear/i);
    expect(document.activeElement?.id).toBe("today-attention-state");
  });

  it("keeps confirmed completion ownership until a causal snapshot removes it", async () => {
    todayMarkup();
    const mutation = deferredResponse();
    const refresh = deferredResponse();
    const firstTask = {
      dueAt: task.dueAt,
      id: task.id,
      kind: "task",
      title: "Completed stale task",
    };
    const secondTask = {
      ...firstTask,
      id: crypto.randomUUID(),
      title: "Other live task",
    };
    const snapshots = [
      Promise.resolve(response(attention([firstTask, secondTask]))),
      refresh.promise,
      Promise.resolve(response(attention([firstTask, secondTask]))),
      Promise.resolve(response(attention())),
    ];
    let snapshotIndex = 0;
    const fetchMock = vi.fn((
      input: string | URL | Request,
      init?: RequestInit,
    ) =>
      String(input).includes("/session")
        ? Promise.resolve(response(session))
        : init?.method === "PUT"
        ? mutation.promise
        : snapshots[snapshotIndex++]!
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayTasks();
    const rows = () => [
      ...document.querySelectorAll<HTMLElement>("#today-overdue-list li"),
    ];
    const button = (title: string) =>
      rows().find((item) => item.textContent?.includes(title))!
        .querySelector<HTMLButtonElement>("button")!;
    const snapshotCalls = () =>
      fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes("/today/attention")
      ).length;
    const staleButton = button("Completed stale task");
    const otherButton = button("Other live task");
    staleButton.click();
    expect([staleButton.disabled, otherButton.disabled]).toEqual([true, true]);
    expect(
      document.querySelector<HTMLButtonElement>("#today-attention-retry")!
        .hidden,
    )
      .toBe(true);
    mutation.resolve(response({ status: "saved", task }));
    await vi.waitFor(() => expect(snapshotCalls()).toBe(2));
    document.querySelector<HTMLButtonElement>("#today-attention-retry")!
      .click();
    await Promise.resolve();
    expect(snapshotCalls()).toBe(2);
    expect([staleButton.disabled, otherButton.disabled]).toEqual([true, true]);
    refresh.resolve(response({}, 503));
    await vi.waitFor(() =>
      expect(document.activeElement?.id).toBe("today-attention-state")
    );
    expect(
      document.querySelector<HTMLButtonElement>("#today-attention-retry")!
        .hidden,
    ).toBe(false);
    expect(staleButton.disabled).toBe(true);
    expect(otherButton.disabled).toBe(true);
    otherButton.click();
    expect(
      fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT"),
    ).toHaveLength(1);
    document.querySelector<HTMLButtonElement>("#today-attention-retry")!
      .click();
    await vi.waitFor(() => expect(snapshotCalls()).toBe(3));
    expect(staleButton.disabled).toBe(true);
    expect(otherButton.disabled).toBe(true);
    document.querySelector<HTMLButtonElement>("#today-attention-retry")!
      .click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".attention-item")).toHaveLength(0)
    );
  });

  it("makes an obsolete pending completion inert after remount", async () => {
    todayMarkup();
    const obsolete = deferredResponse();
    const oldTask = {
      dueAt: task.dueAt,
      id: task.id,
      kind: "task",
      title: "Obsolete task",
    };
    const currentTask = {
      ...oldTask,
      id: crypto.randomUUID(),
      title: "Current task",
    };
    const snapshots = [
      response(attention([oldTask])),
      response(attention([currentTask])),
      response(attention([currentTask])),
    ];
    let snapshotIndex = 0;
    const fetchMock = vi.fn((
      input: string | URL | Request,
      init?: RequestInit,
    ) =>
      String(input).includes("/session")
        ? Promise.resolve(response(session))
        : init?.method === "PUT"
        ? obsolete.promise
        : Promise.resolve(snapshots[snapshotIndex++]!)
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayTasks();
    document.querySelector<HTMLButtonElement>("#today-overdue-list button")!
      .click();
    await mountTodayTasks();
    obsolete.resolve(response({}, 503));
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Current task")
    );
    expect(document.body.textContent).not.toContain("Obsolete task");
    await vi.waitFor(() =>
      expect(document.body.textContent).toMatch(/could not be completed/i)
    );
    expect(
      document.querySelector<HTMLButtonElement>("#today-attention-retry")!
        .hidden,
    ).toBe(false);
    expect(document.activeElement?.id).not.toBe("today-attention-state");
    document.querySelector<HTMLButtonElement>("#today-attention-retry")!
      .click();
    await vi.waitFor(() =>
      expect(document.body.textContent).not.toMatch(/could not be completed/i)
    );
  });

  it("isolates workspace failures and prunes them when the principal changes", async () => {
    todayMarkup();
    const otherWorkspaceId = "00000000-0000-4000-8000-000000000004";
    const failed = deferredResponse();
    const itemFor = (id: string, title: string) => ({
      dueAt: task.dueAt,
      id,
      kind: "task",
      title,
    });
    const first = itemFor(task.id, "First workspace task");
    const second = itemFor(crypto.randomUUID(), "Second workspace task");
    let active = {
      ...session,
      workspace: session.workspace,
      workspaces: [session.workspace, {
        id: otherWorkspaceId,
        name: "Other",
      }],
    };
    const fetchMock = vi.fn((
      input: string | URL | Request,
      init?: RequestInit,
    ) =>
      String(input).includes("/session")
        ? Promise.resolve(response(active))
        : init?.method === "PUT"
        ? failed.promise
        : Promise.resolve(response(attention([
          active.workspace.id === workspaceId ? first : second,
        ])))
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayTasks();
    document.querySelector<HTMLButtonElement>("[data-today-complete]")!
      .click();
    active = {
      ...active,
      workspace: { id: otherWorkspaceId, name: "Other" },
    };
    await mountTodayTasks();
    expect(document.body.textContent).toContain("Second workspace task");
    expect(
      document.querySelector<HTMLButtonElement>("[data-today-complete]")!
        .disabled,
    ).toBe(false);
    failed.resolve(response({}, 503));
    await Promise.resolve();
    expect(document.body.textContent).not.toMatch(/could not be completed/i);
    expect(document.activeElement?.id).not.toBe("today-attention-state");

    active = { ...active, workspace: session.workspace };
    await mountTodayTasks();
    expect(document.body.textContent).toMatch(/could not be completed/i);
    expect(document.activeElement?.id).not.toBe("today-attention-state");
    active = {
      ...active,
      principal: { userId: "different-user" },
      workspace: { id: otherWorkspaceId, name: "Other" },
      workspaces: [{ id: otherWorkspaceId, name: "Other" }],
    };
    await mountTodayTasks();
    active = {
      ...active,
      workspace: session.workspace,
      workspaces: [session.workspace, active.workspace],
    };
    await mountTodayTasks();
    expect(document.body.textContent).not.toMatch(/could not be completed/i);
  });

  it("keeps region retry failures isolated and refreshes both on success", async () => {
    todayMarkup();
    const preserved = {
      dueAt: task.dueAt,
      id: task.id,
      kind: "task",
      title: "Preserved",
    };
    const refreshed = { ...preserved, title: "Refreshed" };
    const fetchMock = todayFetch(
      response(attention([preserved], [preserved])),
      response({}, 503),
      response(attention([refreshed], [refreshed])),
      response({}, 503),
      response(attention([preserved], [preserved])),
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayTasks();
    document.querySelector<HTMLButtonElement>("#today-attention-retry")!
      .click();
    await vi.waitFor(() =>
      expect(document.querySelector("#today-attention-state")?.textContent)
        .toMatch(/could not be loaded/i)
    );
    expect(document.querySelector("#today-upcoming-state")?.textContent)
      .toMatch(/1 upcoming item/i);
    document.querySelector<HTMLButtonElement>("#today-attention-retry")!
      .click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Refreshed")
    );
    expect(document.activeElement?.id).toBe("today-attention-state");
    document.querySelector<HTMLButtonElement>("#today-upcoming-retry")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#today-upcoming-state")?.textContent)
        .toMatch(/could not be loaded/i)
    );
    expect(document.querySelector("#today-overdue-list")?.textContent)
      .toContain("Refreshed");
    fetchMock.mockResolvedValueOnce(response({}, 503));
    document.querySelector<HTMLButtonElement>("[data-today-complete]")!
      .click();
    await vi.waitFor(() =>
      expect(document.querySelector("#today-attention-state")?.textContent)
        .toMatch(/could not be completed/i)
    );
    expect(document.querySelector("#today-upcoming-state")?.textContent)
      .toMatch(/could not be loaded/i);
    expect(document.getElementById("today-upcoming-retry")!.hidden).toBe(false);
    document.querySelector<HTMLButtonElement>("#today-upcoming-retry")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#today-upcoming-state")?.textContent)
        .toMatch(/1 upcoming item/i)
    );
    expect(document.querySelector("#today-attention-state")?.textContent)
      .toMatch(/could not be completed/i);
    expect(document.getElementById("today-upcoming-retry")!.hidden).toBe(true);
    expect(document.activeElement?.id).toBe("today-upcoming-state");
  });

  it.each(
    [
      ["attention", "upcoming", "first", true, true],
      ["attention", "upcoming", "second", false, true],
      ["upcoming", "attention", "first", false, true],
      ["upcoming", "attention", "second", false, false],
    ] as const,
  )(
    "settles independent %s then %s retries (%s first, success %s/%s)",
    async (
      firstRegion,
      secondRegion,
      settles,
      firstSucceeds,
      secondSucceeds,
    ) => {
      todayMarkup();
      const first = deferredResponse();
      const second = deferredResponse();
      const base = {
        dueAt: task.dueAt,
        id: crypto.randomUUID(),
        kind: "task",
        title: "Base",
      };
      const fetchMock = todayFetch(
        response(attention(
          [{ ...base, title: "Attention base" }],
          [{ ...base, title: "Upcoming base" }],
        )),
        first.promise,
        second.promise,
      );
      vi.stubGlobal("fetch", fetchMock);
      await mountTodayTasks();
      const retry = (region: string) =>
        document.querySelector<HTMLButtonElement>(`#today-${region}-retry`)!;
      const list = (region: string) =>
        document.querySelector(
          region === "attention"
            ? "#today-overdue-list"
            : "#today-upcoming-list",
        )!;
      const result = (label: string, succeeds: boolean) =>
        succeeds
          ? response(attention(
            [{ ...base, title: `Attention ${label}` }],
            [{ ...base, title: `Upcoming ${label}` }],
          ))
          : response({}, 503);
      retry(firstRegion).click();
      retry(secondRegion).click();
      const resolutions = settles === "first"
        ? [[first, firstRegion, "first", firstSucceeds], [
          second,
          secondRegion,
          "second",
          secondSucceeds,
        ]] as const
        : [[second, secondRegion, "second", secondSucceeds], [
          first,
          firstRegion,
          "first",
          firstSucceeds,
        ]] as const;
      for (const [pending, region, label, succeeds] of resolutions) {
        pending.resolve(result(label, succeeds));
        await vi.waitFor(() =>
          expect(document.querySelector(`#today-${region}-state`)?.textContent)
            .not.toMatch(/Loading/i)
        );
      }
      for (
        const [region, label, succeeds] of [
          [firstRegion, "first", firstSucceeds],
          [secondRegion, "second", secondSucceeds],
        ] as const
      ) {
        expect(list(region).textContent).toContain(
          succeeds
            ? `${region === "attention" ? "Attention" : "Upcoming"} ${label}`
            : `${region === "attention" ? "Attention" : "Upcoming"} base`,
        );
        expect(retry(region).hidden).toBe(succeeds);
      }
      expect(document.activeElement?.id).toBe(
        `today-${secondRegion}-state`,
      );
    },
  );

  it("keeps the newest successful server date across independent settlement order", async () => {
    todayMarkup();
    const older = deferredResponse();
    const newer = deferredResponse();
    vi.stubGlobal(
      "fetch",
      todayFetch(response(attention()), older.promise, newer.promise),
    );
    await mountTodayTasks();
    document.querySelector<HTMLButtonElement>("#today-attention-retry")!
      .click();
    document.querySelector<HTMLButtonElement>("#today-upcoming-retry")!.click();
    newer.resolve(response({ ...attention(), date: "2026-08-20" }));
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLTimeElement>("[data-today-date]")?.dateTime,
      )
        .toBe("2026-08-20")
    );
    older.resolve(response({ ...attention(), date: "2026-08-19" }));
    await vi.waitFor(() =>
      expect(document.querySelector("#today-attention-state")?.textContent)
        .not.toMatch(/Loading/i)
    );
    expect(
      document.querySelector<HTMLTimeElement>("[data-today-date]")?.dateTime,
    )
      .toBe("2026-08-20");
  });

  it.each([200, 503])(
    "makes a superseded combined completion refresh (%s) inert",
    async (combinedStatus) => {
      todayMarkup();
      const mutation = deferredResponse();
      const combined = deferredResponse();
      const regional = deferredResponse();
      const current = {
        dueAt: task.dueAt,
        id: task.id,
        kind: "task",
        title: "Confirmed but stale",
      };
      const isolatedWorkspaceId = combinedStatus === 200
        ? "00000000-0000-4000-8000-000000000005"
        : "00000000-0000-4000-8000-000000000006";
      const isolatedSession = {
        ...session,
        workspace: { id: isolatedWorkspaceId, name: "Isolated" },
        workspaces: [{ id: isolatedWorkspaceId, name: "Isolated" }],
      };
      // A route-aware fixture keeps the mutation and projection interleaving explicit.
      let projection = 0;
      const fetchMock = vi.fn((
        input: string | URL | Request,
        init?: RequestInit,
      ) =>
        String(input).includes("/session")
          ? Promise.resolve(response(isolatedSession))
          : init?.method === "PUT"
          ? mutation.promise
          : [
            Promise.resolve(response(attention([current], [current]))),
            combined.promise,
            regional.promise,
          ][projection++]!
      );
      vi.stubGlobal("fetch", fetchMock);
      await mountTodayTasks();
      document.querySelector<HTMLButtonElement>("[data-today-complete]")!
        .click();
      mutation.resolve(response({ status: "saved", task }));
      await vi.waitFor(() =>
        expect(
          fetchMock.mock.calls.filter((call) =>
            String(call[0]).includes("/today/attention")
          ),
        ).toHaveLength(2)
      );
      document.querySelector<HTMLButtonElement>("#today-upcoming-retry")!
        .click();
      regional.resolve(response({
        ...attention([current], [{ ...current, title: "Current upcoming" }]),
        date: "2026-08-20",
      }));
      await vi.waitFor(() =>
        expect(document.querySelector("#today-upcoming-list")?.textContent)
          .toContain("Current upcoming")
      );
      combined.resolve(
        combinedStatus === 200
          ? response({ ...attention(), date: "2026-08-19" })
          : response({}, combinedStatus),
      );
      await vi.waitFor(() =>
        expect(document.body.textContent).not.toMatch(
          /Loading (relationship|upcoming)/,
        )
      );
      expect(document.querySelector("#today-overdue-list")?.textContent)
        .toContain("Confirmed but stale");
      expect(document.querySelector("#today-upcoming-list")?.textContent)
        .toContain("Current upcoming");
      expect(document.querySelector("#today-attention-state")?.textContent)
        .toMatch(/completion is confirmed/i);
      expect(
        document.querySelector<HTMLTimeElement>("[data-today-date]")?.dateTime,
      )
        .toBe("2026-08-20");
      expect(document.activeElement?.id).toBe("today-upcoming-state");
    },
  );

  it("owns reconnect refreshes before the initial await and across remounts", async () => {
    todayMarkup();
    const obsoleteInitial = deferredResponse();
    const obsoleteRemount = deferredResponse();
    const firstReconnect = deferredResponse();
    const remountedReconnect = deferredResponse();
    const projections = [
      obsoleteInitial.promise,
      firstReconnect.promise,
      obsoleteRemount.promise,
      remountedReconnect.promise,
    ];
    let projection = 0;
    const fetchMock = vi.fn((input: string | URL | Request) =>
      String(input).includes("/session")
        ? Promise.resolve(response(session))
        : projections[projection++]!
    );
    vi.stubGlobal("fetch", fetchMock);
    const projectionCalls = () =>
      fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes("/today/attention")
      ).length;

    const mounting = mountTodayTasks();
    await vi.waitFor(() => expect(projectionCalls()).toBe(1));
    reconnect();
    await vi.waitFor(() => expect(projectionCalls()).toBe(2));
    firstReconnect.resolve(response({
      ...attention([{
        dueAt: task.dueAt,
        id: task.id,
        kind: "task",
        title: "First reconnect",
      }]),
      date: "2026-08-19",
    }));
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("First reconnect")
    );
    obsoleteInitial.resolve(
      response({ ...attention(), date: "2026-08-17" }),
    );
    await mounting;
    expect(
      document.querySelector<HTMLTimeElement>("[data-today-date]")?.dateTime,
    )
      .toBe("2026-08-19");

    const remounting = mountTodayTasks();
    await vi.waitFor(() => expect(projectionCalls()).toBe(3));
    reconnect();
    await vi.waitFor(() => expect(projectionCalls()).toBe(4));
    remountedReconnect.resolve(response({
      ...attention([], [{
        dueAt: task.dueAt,
        id: task.id,
        kind: "task",
        title: "Owned reconnect",
      }]),
      date: "2026-08-21",
    }));
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Owned reconnect")
    );
    obsoleteRemount.resolve(
      response({ ...attention(), date: "2026-08-16" }),
    );
    await remounting;
    expect(
      document.querySelector<HTMLTimeElement>("[data-today-date]")?.dateTime,
    )
      .toBe("2026-08-21");
  });

  it.each(
    [
      ["attention", 503, 200],
      ["upcoming", 200, 503],
    ] as const,
  )(
    "makes the newest reconnect supersede an independent %s retry (%s then %s)",
    async (region, olderStatus, newerStatus) => {
      todayMarkup();
      const regional = deferredResponse();
      const olderReconnect = deferredResponse();
      const newerReconnect = deferredResponse();
      const fetchMock = todayFetch(
        response(attention([{
          dueAt: task.dueAt,
          id: task.id,
          kind: "task",
          title: "Attention base",
        }], [{
          dueAt: task.dueAt,
          id: task.id,
          kind: "task",
          title: "Upcoming base",
        }])),
        regional.promise,
        olderReconnect.promise,
        newerReconnect.promise,
      );
      vi.stubGlobal("fetch", fetchMock);
      const projectionCalls = () =>
        fetchMock.mock.calls.filter((call) =>
          String(call[0]).includes("/today/attention")
        ).length;
      await mountTodayTasks();
      const retry = document.querySelector<HTMLButtonElement>(
        `#today-${region}-retry`,
      )!;
      retry.focus();
      retry.click();
      await vi.waitFor(() => expect(projectionCalls()).toBe(2));
      reconnect();
      await vi.waitFor(() => expect(projectionCalls()).toBe(3));
      reconnect();
      await vi.waitFor(() => expect(projectionCalls()).toBe(4));
      regional.resolve(response({ ...attention(), date: "2026-08-18" }));
      const result = (status: number, label: string, date: string) =>
        status === 200
          ? response({
            ...attention([{
              dueAt: task.dueAt,
              id: task.id,
              kind: "task",
              title: `Attention ${label}`,
            }], [{
              dueAt: task.dueAt,
              id: task.id,
              kind: "task",
              title: `Upcoming ${label}`,
            }]),
            date,
          })
          : response({}, status);
      newerReconnect.resolve(result(newerStatus, "newest", "2026-08-21"));
      await vi.waitFor(() =>
        expect(document.body.textContent).not.toMatch(
          /Loading (relationship|upcoming)/,
        )
      );
      olderReconnect.resolve(result(olderStatus, "obsolete", "2026-08-20"));
      await Promise.resolve();
      if (newerStatus === 200) {
        expect(document.querySelector("#today-overdue-list")?.textContent)
          .toContain("Attention newest");
        expect(document.querySelector("#today-upcoming-list")?.textContent)
          .toContain("Upcoming newest");
        expect(
          document.querySelector<HTMLTimeElement>("[data-today-date]")
            ?.dateTime,
        )
          .toBe("2026-08-21");
      } else {
        expect(document.querySelector("#today-overdue-list")?.textContent)
          .toContain("Attention base");
        expect(document.querySelector("#today-upcoming-list")?.textContent)
          .toContain("Upcoming base");
        expect(document.getElementById("today-attention-retry")!.hidden)
          .toBe(false);
        expect(document.getElementById("today-upcoming-retry")!.hidden)
          .toBe(false);
      }
      expect(document.activeElement).toBe(retry);
    },
  );

  it.each(["confirmed", "failed"] as const)(
    "preserves task completion ownership when reconnect settles while PUT is %s",
    async (outcome) => {
      todayMarkup();
      const mutation = deferredResponse();
      const reconnectRefresh = deferredResponse();
      const completion = deferredResponse();
      const item = {
        dueAt: task.dueAt,
        id: task.id,
        kind: "task",
        person: task.person,
        title: "Completion owner",
      };
      const projections = [
        Promise.resolve(response(attention([item], [item]))),
        reconnectRefresh.promise,
        completion.promise,
      ];
      let projection = 0;
      const fetchMock = vi.fn((
        input: string | URL | Request,
        init?: RequestInit,
      ) =>
        String(input).includes("/session")
          ? Promise.resolve(response(session))
          : init?.method === "PUT"
          ? mutation.promise
          : projections[projection++]!
      );
      vi.stubGlobal("fetch", fetchMock);
      await mountTodayTasks();
      const complete = document.querySelector<HTMLButtonElement>(
        "[data-today-complete]",
      )!;
      complete.click();
      document.querySelector<HTMLAnchorElement>(".attention-title")!.focus();
      reconnect();
      await vi.waitFor(() => expect(projection).toBe(2));
      reconnectRefresh.resolve(response({
        ...attention([item], [item]),
        date: "2026-08-20",
      }));
      await vi.waitFor(() =>
        expect(
          document.querySelector<HTMLTimeElement>("[data-today-date]")
            ?.dateTime,
        ).toBe("2026-08-20")
      );
      expect(document.querySelector("#today-attention-state")?.textContent)
        .toBe("Completing task…");
      const liveComplete = document.querySelector<HTMLButtonElement>(
        "[data-today-complete]",
      )!;
      expect(liveComplete.disabled).toBe(true);
      expect(document.activeElement).toBe(
        document.querySelector<HTMLAnchorElement>(".attention-title"),
      );

      mutation.resolve(
        outcome === "confirmed"
          ? response({ status: "saved", task })
          : response({}, 503),
      );
      if (outcome === "confirmed") {
        await vi.waitFor(() => expect(projection).toBe(3));
        completion.resolve(response({
          ...attention(),
          date: "2026-08-22",
        }));
        await vi.waitFor(() =>
          expect(document.querySelectorAll(".attention-item")).toHaveLength(0)
        );
        expect(
          document.querySelector<HTMLTimeElement>("[data-today-date]")
            ?.dateTime,
        )
          .toBe("2026-08-22");
      } else {
        await vi.waitFor(() =>
          expect(document.querySelector("#today-attention-state")?.textContent)
            .toMatch(/could not be completed/i)
        );
        expect(document.activeElement).toBe(liveComplete);
      }
    },
  );

  it("does not restore an obsolete retry after a remount abort", async () => {
    todayMarkup();
    const obsolete = deferredResponse();
    const current = {
      dueAt: task.dueAt,
      id: task.id,
      kind: "task",
      title: "Current remount",
    };
    const fetchMock = todayFetch(
      response({}, 503),
      obsolete.promise,
      response({
        ...attention([current], [current]),
        date: "2026-08-19",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayTasks();
    document.querySelector<HTMLButtonElement>("#today-attention-retry")!
      .click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await mountTodayTasks();
    obsolete.resolve(response({
      ...attention(),
      date: "2026-08-17",
    }));
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Current remount")
    );
    expect(document.body.textContent).not.toMatch(/could not be loaded/i);
    expect(
      document.querySelector<HTMLTimeElement>("[data-today-date]")?.dateTime,
    ).toBe("2026-08-19");
    expect(
      document.querySelector<HTMLButtonElement>("#today-attention-retry")
        ?.hidden,
    )
      .toBe(true);
  });
});
