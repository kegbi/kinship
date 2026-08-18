// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountTaskSurface, mountTodayTasks } from "./tasks.ts";

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

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("isolates Today task errors and completes due tasks", async () => {
    document.body.innerHTML =
      `<p id="today-tasks-state"></p><ul id="today-tasks-list"></ul><button id="today-tasks-retry" hidden>Retry</button>`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({ items: [task], status: "ready" }))
      .mockResolvedValueOnce(
        response({ status: "saved", task: { ...task, status: "completed" } }),
      )
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({ items: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayTasks();
    expect(document.querySelector("#today-tasks-list")?.textContent).toContain(
      "Call Ada",
    );
    document.querySelector<HTMLButtonElement>("#today-tasks-list button")!
      .click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));

    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(
          response({
            code: "offline",
            detail: "Offline",
            status: 503,
            title: "Offline",
            type: "about:blank",
          }, 503),
        ),
    );
    await mountTodayTasks();
    expect(document.querySelector("#today-tasks-state")?.textContent).toContain(
      "Other Today regions",
    );
    expect(
      document.querySelector<HTMLButtonElement>("#today-tasks-retry")?.hidden,
    ).toBe(false);
  });

  it("keeps an unavailable Today person link visible and read-only", async () => {
    document.body.innerHTML =
      `<p id="today-tasks-state"></p><ul id="today-tasks-list"></ul><button id="today-tasks-retry" hidden>Retry</button>`;
    const unavailable = {
      ...task,
      dueAt: "2026-08-20T09:00:30.123456Z",
      person: {
        archived: false,
        id: personId,
        name: "Deleted/Unavailable person",
        unavailable: true,
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(
        response({ items: [unavailable], status: "ready" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayTasks();
    const item = document.querySelector<HTMLElement>("#today-tasks-list li")!;
    expect(item.textContent).toContain("Deleted/Unavailable person");
    expect(item.querySelector("button")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
