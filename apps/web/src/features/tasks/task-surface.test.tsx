// @vitest-environment happy-dom
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buttonVariants } from "@/components/ui/variants.ts";
import { mountUnsavedChangesGuard } from "../../lib/unsaved-changes.ts";
import { expectNoAxeViolations } from "../../testing/a11y.ts";
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
  sectionProps,
  workspaceSession,
} from "../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSection,
  mountSettled,
} from "../../testing/render.tsx";
import {
  mountPersonTasks,
  mountTasksPage,
  PERSON_TASKS_ISLAND,
  TASKS_PAGE_ISLAND,
} from "./task-surface.tsx";
import { TASK_CHANGED_EVENT } from "./tasks.ts";

const { person: personId } = ids;
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

const TASKS = "GET /api/v1/tasks";
const CREATE = "POST /api/v1/tasks";
const CHANGE = "PATCH /api/v1/tasks/:taskId";
const COMPLETION = "PUT /api/v1/tasks/:taskId/completion";
const PEOPLE = "GET /api/v1/people";
const SESSION = "GET /api/v1/session";
const PREFERENCES = "GET /api/v1/settings/preferences";

const listed = (items: readonly object[], nextCursor?: string) =>
  jsonResponse({
    items,
    status: "ready",
    ...(nextCursor ? { nextCursor } : {}),
  });
const saved = (value: object = task) =>
  jsonResponse({ status: "saved", task: value });
const directory = (people: readonly object[] = [], nextCursor?: string) =>
  jsonResponse({
    lifecycle: "active",
    people,
    status: "ready",
    ...(nextCursor ? { nextCursor } : {}),
  });

/** The person card as `TasksSection.astro` draws it before it hydrates. */
function personShell(): void {
  drawShell(`
    <nav><ul><li><a data-section-link="tasks" href="?section=tasks">Tasks</a></li></ul></nav>
    <main id="person-profile-ready">
      <section id="profile-section-tasks" class="profile-section-card tasks-section-card" data-profile-section="tasks" data-section-state="loading" tabindex="-1" aria-labelledby="profile-section-tasks-heading">
        <header class="profile-section-heading">
          <div class="profile-section-title"><h3 id="profile-section-tasks-heading">Tasks</h3></div>
          <button data-task-add class="profile-section-cta" type="button" hidden>Add task</button>
        </header>
        <p data-task-state class="section-state"><span class="sr-only">Loading tasks…</span></p>
        <button data-task-retry type="button" hidden>Retry tasks</button>
        <form method="post" data-task-form hidden novalidate></form>
        <div class="task-columns"></div>
      </section>
    </main>`);
}

/** The `/app/tasks` page as `pages/app/tasks/index.astro` draws it. */
function pageShell(): void {
  drawShell(`
    <main id="main-content" class="page-frame tasks-page" tabindex="-1">
      <header class="page-heading">
        <div><h1>Tasks</h1></div>
        <button data-task-add type="button" disabled>Add task</button>
      </header>
      <div class="contents" data-task-surface>
        <p data-task-state class="section-state" role="status" aria-live="polite">Loading tasks…</p>
      </div>
    </main>`);
}

function mountPerson(
  overrides: { archived?: boolean; hidden?: boolean } = {},
) {
  return mountSection(
    mountPersonTasks,
    sectionProps({
      archived: overrides.archived ?? false,
      initial: personProfile({
        person: {
          profileSections: overrides.hidden
            ? [{ id: "tasks", status: "hidden" }]
            : [],
        },
      }),
      preferences: preferences(),
    }),
    element("#person-profile-ready"),
  );
}

const mountPage = () => mountSettled(() => mountTasksPage());

/** The page's context routes: a session, preferences, and people. */
function pageRoutes(people: Response = directory()) {
  return {
    [SESSION]: jsonResponse(workspaceSession()),
    [PREFERENCES]: jsonResponse({
      preferences: preferences(),
      status: "ready",
    }),
    [PEOPLE]: people,
  };
}

const form = () => element<HTMLFormElement>("[data-task-form]");
const formState = () => element("[data-task-form-state]");
const stateLine = () => element("[data-task-state]");
const add = () => element<HTMLButtonElement>("[data-task-add]");
const listOf = (column: "open" | "completed" | "cancelled") =>
  element<HTMLUListElement>(`[data-task-${column}-list]`);
const rowOf = (column: "open" | "completed" | "cancelled", title: string) =>
  within(listOf(column)).getByText(title).closest("li")!;
const titleField = () =>
  within(form()).getByLabelText<HTMLInputElement>("Title");
const writes = (api: ReturnType<typeof stubApi>) =>
  api.requests().filter((request) => request.method !== "GET");

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("PLANNING-001 task surface island", () => {
  it("does nothing when its regions are absent", async () => {
    drawShell('<main id="person-profile-ready"></main>');
    const api = stubApi();
    await mountPerson();
    await mountPage();
    expect(api.fetch).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe("");
  });

  it("hides the card and its directory link when the module is off", async () => {
    personShell();
    const api = stubApi();
    await mountPerson({ hidden: true });
    const section = element("#profile-section-tasks");
    expect(section.hidden).toBe(true);
    expect(section.dataset.sectionState).toBe("hidden");
    expect(
      element('[data-section-link="tasks"]').closest("li")!.hidden,
    ).toBe(true);
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("REL-045 never reveals Retry tasks without wiring it when the session is unavailable", async () => {
    pageShell();
    let sessionAvailable = false;
    stubApi({
      ...pageRoutes(),
      [SESSION]: () =>
        sessionAvailable
          ? jsonResponse(workspaceSession())
          : problemResponse(503),
      [TASKS]: listed([]),
    });
    await mountPage();
    const retry = within(element("main")).getByRole("button", {
      name: "Retry tasks",
    });
    expect(stateLine().textContent).toBe(
      "Tasks are unavailable. Sign in again or retry.",
    );
    expect(add().disabled).toBe(true);

    sessionAvailable = true;
    fireEvent.click(retry);
    await waitFor(() =>
      expect(stateLine().textContent).toBe("No tasks in this view.")
    );
    expect(retry.hidden).toBe(true);
    expect(add().disabled).toBe(false);
  });

  it("keeps Add task unavailable until its action is wired", async () => {
    expect(readFileSync("apps/web/src/pages/app/tasks/index.astro", "utf8"))
      .toMatch(/<button data-task-add[^>]*\sdisabled>/);
    pageShell();
    const session = deferred<Response>();
    stubApi({
      ...pageRoutes(),
      [SESSION]: () => session.promise,
      [TASKS]: listed([]),
    });
    const mounted = mountPending(() => mountTasksPage());
    expect(element("main").dataset.island).toBeUndefined();
    expect(element("[data-task-surface]").dataset.island).toBe(
      TASKS_PAGE_ISLAND,
    );
    expect(document.querySelectorAll("[data-task-add]")).toHaveLength(1);
    expect(add().disabled).toBe(true);
    await act(async () => {
      session.resolve(jsonResponse(workspaceSession()));
      await mounted;
    });
    expect(add().disabled).toBe(false);
    expect(add().className).toBe(buttonVariants());
    fireEvent.click(add());
    expect(form().hidden).toBe(false);
    expect(document.activeElement).toBe(titleField());
    await expectNoAxeViolations(element("main"));
  });

  it("loads a person task, creates a task, and completes idempotently", async () => {
    personShell();
    mountUnsavedChangesGuard({
      confirmMessage: "Discard?",
      root: document.body,
    });
    const changed = vi.fn();
    globalThis.addEventListener(TASK_CHANGED_EVENT, changed);
    const api = stubApi({
      [CREATE]: jsonResponse({ status: "created", task }, 201),
      [COMPLETION]: saved({ ...task, status: "completed" }),
      [TASKS]: [listed([task]), listed([task]), listed([])],
    });
    await mountPerson();
    const section = element("#profile-section-tasks");
    expect(section.dataset.island).toBe(PERSON_TASKS_ISLAND);
    expect(section.dataset.sectionState).toBe("ready");
    expect(section.firstElementChild?.localName).toBe("header");
    expect(add().className).toBe(
      buttonVariants({ className: "profile-section-cta" }),
    );
    expect(listOf("open").textContent).toContain("Call Ada");
    expect(stateLine().textContent).toBe("1 task.");
    expect(Object.fromEntries(api.requests()[0]!.url.searchParams)).toEqual({
      limit: "50",
      personId,
    });
    await expectNoAxeViolations(section);
    fireEvent.click(add());
    fireEvent.input(titleField(), { target: { value: "Send Ada notes" } });
    expect(
      within(form()).queryByLabelText("Person (optional)"),
    ).toBeNull();
    fireEvent.submit(form());
    await waitFor(() => expect(api.calls()).toHaveLength(3));
    expect(api.bodies()[0]).toMatchObject({
      personId,
      title: "Send Ada notes",
    });
    await waitFor(() => expect(formState().textContent).toBe("Task created."));
    expect(form().hidden).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    fireEvent.click(
      within(listOf("open")).getByRole("button", { name: "Complete" }),
    );
    await waitFor(() => expect(api.calls()).toHaveLength(5));
    expect(api.requests()[1]?.method).toBe("POST");
    expect(api.requests()[3]?.method).toBe("PUT");
    expect(changed).toHaveBeenCalledTimes(2);
    globalThis.removeEventListener(TASK_CHANGED_EVENT, changed);
  });

  it.each(
    [
      ["completes", "open", "completed", true, "Task completed."],
      ["reopens", "completed", "open", false, "Task reopened."],
    ] as const,
  )(
    "%s a task row before the mutation resolves",
    async (_label, initialStatus, destination, completed, notice) => {
      personShell();
      const mutation = deferred<Response>();
      const reconciled = { ...task, status: destination };
      const api = stubApi({
        [COMPLETION]: () => mutation.promise,
        [TASKS]: [
          listed([{ ...task, status: initialStatus }]),
          listed([reconciled]),
        ],
      });
      await mountPerson();
      const control = within(listOf(initialStatus)).getByRole<
        HTMLButtonElement
      >("button", { name: completed ? "Complete" : "Reopen" });

      fireEvent.click(control);

      expect(listOf(initialStatus).children).toHaveLength(0);
      const row = rowOf(destination, "Call Ada");
      expect(row.getAttribute("aria-busy")).toBe("true");
      const moved = within(row).getByRole<HTMLButtonElement>("button", {
        name: completed ? "Complete" : "Reopen",
      });
      expect(moved.disabled).toBe(true);
      expect(formState().textContent).toBe(
        completed ? "Completing task…" : "Reopening task…",
      );
      expect(api.bodies()).toEqual([{ completed }]);

      await act(async () => {
        mutation.resolve(saved(reconciled));
        await mutation.promise;
      });
      await waitFor(() => expect(api.calls()).toHaveLength(3));
      await waitFor(() =>
        expect(
          within(rowOf(destination, "Call Ada")).getAllByRole<
            HTMLButtonElement
          >("button")[0]!.disabled,
        ).toBe(false)
      );
      expect(rowOf(destination, "Call Ada").hasAttribute("aria-busy")).toBe(
        false,
      );
      expect(formState().textContent).toBe(notice);
    },
  );

  it.each(
    [
      [
        "a server failure",
        problemResponse(503),
        "Task state could not be changed.",
      ],
      [
        "an unreachable server",
        unreachable,
        "Task state could not be changed.",
      ],
      [
        "an archived-person rejection",
        problemResponse(409, {
          code: "archived_write_rejected",
          detail: "Restore the person first.",
        }),
        "Restore the linked person before changing this task.",
      ],
    ] as const,
  )(
    "restores the exact task row after %s",
    async (_label, failure, message) => {
      personShell();
      const mutation = deferred<void>();
      const laterTask = {
        ...task,
        id: "00000000-0000-4000-8000-000000000901",
        title: "Later task",
      };
      stubApi({
        [COMPLETION]: async (request) => {
          await mutation.promise;
          return typeof failure === "function" ? failure(request) : failure;
        },
        [TASKS]: listed([task, laterTask]),
      });
      await mountPerson();
      const before = listOf("open").innerHTML;
      fireEvent.click(
        within(rowOf("open", "Call Ada")).getByRole("button", {
          name: "Complete",
        }),
      );
      const moving = rowOf("completed", "Call Ada");
      expect(moving.getAttribute("aria-busy")).toBe("true");
      for (
        const button of within(moving).getAllByRole<HTMLButtonElement>(
          "button",
        )
      ) expect(button.disabled).toBe(true);
      expect(within(listOf("open")).queryByText("Call Ada")).toBeNull();

      await act(async () => {
        mutation.resolve();
        await mutation.promise;
      });

      await waitFor(() => expect(formState().textContent).toBe(message));
      expect(listOf("completed").children).toHaveLength(0);
      expect(listOf("open").innerHTML).toBe(before);
      expect(
        [...listOf("open").children].map((row) =>
          row.querySelector("h3")?.textContent
        ),
      ).toEqual(["Call Ada", "Later task"]);
    },
  );

  it("edits global tasks and keeps archived person tasks read-only", async () => {
    pageShell();
    const api = stubApi({
      ...pageRoutes(directory([{
        givenName: "Ada",
        id: personId,
        isPartial: false,
        isStarred: false,
        lifecycle: "active",
      }])),
      [CHANGE]: saved({ ...task, title: "Updated" }),
      [TASKS]: listed([task]),
    });
    await mountPage();
    const edit = within(listOf("open")).getByRole("button", {
      name: "Edit task",
    });
    expect(edit.className).toBe(buttonVariants({ variant: "outline" }));
    fireEvent.click(edit);
    expect(titleField().value).toBe("Call Ada");
    fireEvent.input(titleField(), { target: { value: "Updated" } });
    fireEvent.submit(form());
    await waitFor(() => expect(formState().textContent).toBe("Task saved."));
    expect(api.requests().find((request) => request.method === "PATCH")?.params)
      .toEqual({ taskId });
    expect(element("[data-task-cancel]").className).toBe(buttonVariants());

    personShell();
    stubApi({
      [TASKS]: listed([{
        ...task,
        person: { ...task.person, archived: true },
      }]),
    });
    await mountPerson({ archived: true });
    expect(add().hidden).toBe(true);
    expect(within(listOf("open")).queryByRole("button")).toBeNull();
    expect(listOf("open").textContent).toContain("Ada Lovelace (archived)");
  });

  it("blocks a delayed double-submit while one create request is pending", async () => {
    personShell();
    const api = stubApi({
      [CREATE]: () => new Promise<Response>(() => undefined),
      [TASKS]: listed([]),
    });
    await mountPerson();
    fireEvent.click(add());
    fireEvent.input(titleField(), { target: { value: "One task" } });
    fireEvent.submit(form());
    fireEvent.submit(form());
    expect(writes(api)).toHaveLength(1);
    expect(formState().textContent).toBe("Creating task…");
    expect(add().disabled).toBe(true);
    expect(form().hasAttribute("inert")).toBe(true);
  });

  it("asks for a title before saving anything", async () => {
    personShell();
    const api = stubApi({ [TASKS]: listed([]) });
    await mountPerson();
    fireEvent.click(add());
    fireEvent.input(titleField(), { target: { value: "   " } });
    fireEvent.submit(form());
    expect(formState().textContent).toBe("Add a task title.");
    expect(writes(api)).toHaveLength(0);
  });

  it("reuses one create request id after an ambiguous failure", async () => {
    personShell();
    const api = stubApi({
      [CREATE]: [unreachable, jsonResponse({ status: "created", task }, 201)],
      [TASKS]: [listed([]), listed([task])],
    });
    await mountPerson();
    fireEvent.click(add());
    fireEvent.input(titleField(), { target: { value: "Retry me" } });
    fireEvent.submit(form());
    await waitFor(() =>
      expect(formState().textContent).toBe(
        "Task could not be saved. Review the fields and retry.",
      )
    );
    fireEvent.submit(form());
    await waitFor(() => expect(api.calls()).toHaveLength(4));
    const [first, second] = api.bodies() as { requestId: string }[];
    expect(second!.requestId).toBe(first!.requestId);
  });

  it("says an archived person's task is read-only when a save is refused", async () => {
    personShell();
    stubApi({
      [CREATE]: problemResponse(409, { code: "archived_write_rejected" }),
      [TASKS]: listed([]),
    });
    await mountPerson();
    fireEvent.click(add());
    fireEvent.input(titleField(), { target: { value: "Too late" } });
    fireEvent.submit(form());
    await waitFor(() =>
      expect(formState().textContent).toBe("Archived people are read-only.")
    );
    expect(form().hidden).toBe(false);
  });

  it("keeps a completed task completed through edit and reopens only explicitly", async () => {
    personShell();
    const completed = { ...task, status: "completed" };
    const updated = { ...completed, title: "Updated completed task" };
    const reopened = { ...updated, status: "open" };
    const api = stubApi({
      [CHANGE]: saved(updated),
      [COMPLETION]: saved(reopened),
      [TASKS]: [listed([completed]), listed([updated]), listed([reopened])],
    });
    await mountPerson();
    fireEvent.click(
      within(listOf("completed")).getByRole("button", { name: "Edit task" }),
    );
    fireEvent.input(titleField(), {
      target: { value: "Updated completed task" },
    });
    fireEvent.submit(form());
    await waitFor(() => expect(api.calls()).toHaveLength(3));
    expect(api.bodies()[0]).not.toHaveProperty("status");
    await waitFor(() =>
      expect(listOf("completed").textContent).toContain(
        "Updated completed task",
      )
    );
    fireEvent.click(
      within(listOf("completed")).getByRole("button", { name: "Reopen" }),
    );
    await waitFor(() => expect(api.calls()).toHaveLength(5));
    expect(api.bodies()[1]).toEqual({ completed: false });
    await waitFor(() =>
      expect(listOf("open").textContent).toContain("Updated completed task")
    );
  });

  it("renders cancelled tasks truthfully and reopens them explicitly", async () => {
    personShell();
    const cancelled = { ...task, status: "cancelled" };
    const reopened = { ...task, status: "open" };
    const api = stubApi({
      [COMPLETION]: saved(reopened),
      [TASKS]: [listed([cancelled]), listed([reopened])],
    });
    await mountPerson();
    const row = rowOf("cancelled", "Call Ada");
    const reopen = within(row).getAllByRole("button")[0]!;
    expect(reopen.textContent).toBe("Reopen");
    fireEvent.click(reopen);
    expect(rowOf("open", "Call Ada").getAttribute("aria-busy")).toBe("true");
    await waitFor(() => expect(api.calls()).toHaveLength(3));
    expect(api.bodies()[0]).toEqual({ completed: false });
    await waitFor(() =>
      expect(listOf("open").textContent).toContain("Call Ada")
    );
  });

  it("preserves due precision on title-only edit and sends deliberate due edits", async () => {
    personShell();
    const precise = { ...task, dueAt: "2026-08-20T09:00:30.500Z" };
    const renamed = { ...precise, title: "Precise renamed" };
    const moved = { ...renamed, dueAt: "2026-08-21T10:15:00.000Z" };
    const api = stubApi({
      [CHANGE]: [saved(renamed), saved(moved)],
      [TASKS]: [listed([precise]), listed([renamed]), listed([moved])],
    });
    await mountPerson();
    fireEvent.click(
      within(listOf("open")).getByRole("button", { name: "Edit task" }),
    );
    fireEvent.input(titleField(), { target: { value: "Precise renamed" } });
    fireEvent.submit(form());
    await waitFor(() => expect(api.calls()).toHaveLength(3));
    expect(api.bodies()[0]).not.toHaveProperty("dueAt");
    expect(api.bodies()[0]).toMatchObject({
      description: null,
      expectedUpdatedAt: task.updatedAt,
      status: "open",
      title: "Precise renamed",
    });
    expect(api.bodies()[0]).not.toHaveProperty("personId");

    await waitFor(() =>
      expect(listOf("open").textContent).toContain("Precise renamed")
    );
    fireEvent.click(
      within(listOf("open")).getByRole("button", { name: "Edit task" }),
    );
    const due = within(form()).getByLabelText<HTMLInputElement>(
      "Due time (optional)",
    );
    fireEvent.input(due, { target: { value: "2026-08-21T10:15" } });
    fireEvent.submit(form());
    await waitFor(() => expect(api.calls()).toHaveLength(5));
    expect((api.bodies()[1] as { dueAt: string }).dueAt).toBe(
      new Date("2026-08-21T10:15").toISOString(),
    );
  });

  it("loads task 101 through continuation without losing person filters", async () => {
    pageShell();
    const later = {
      ...task,
      id: "00000000-0000-4000-8000-000000000901",
      title: "Task 101",
    };
    const api = stubApi({
      ...pageRoutes(),
      [`${TASKS}?cursor=task-cursor`]: listed([later]),
      [TASKS]: listed([task], "task-cursor"),
    });
    await mountPage();
    const more = element<HTMLButtonElement>('[data-load-more="tasks"]');
    expect(more.hidden).toBe(false);
    expect(more.getAttribute("aria-controls")).toBe("open-tasks");
    fireEvent.click(more);
    await waitFor(() =>
      expect(listOf("open").textContent).toContain("Task 101")
    );
    expect(api.calls().at(-1)).toContain("cursor=task-cursor");
    expect(listOf("open").textContent).toContain("Call Ada");
    expect(stateLine().textContent).toBe("2 tasks.");
    expect(more.hidden).toBe(true);
  });

  it("reads the view again when a filter changes", async () => {
    pageShell();
    const api = stubApi({
      ...pageRoutes(),
      [TASKS]: listed([task]),
    });
    await mountPage();
    fireEvent.change(element("[data-task-status-filter]"), {
      target: { value: "open" },
    });
    const query = () =>
      Object.fromEntries(api.requests().at(-1)!.url.searchParams);
    await waitFor(() =>
      expect(query()).toEqual({ limit: "50", status: "open" })
    );
    await waitFor(() => expect(stateLine().textContent).toBe("1 task."));
    fireEvent.change(element("[data-task-person-filter]"), {
      target: { value: personId },
    });
    await waitFor(() =>
      expect(query()).toEqual({ limit: "50", personId, status: "open" })
    );
  });

  it("refreshes a completion and a save with the filters in force when they answer", async () => {
    pageShell();
    const completion = deferred<Response>();
    const change = deferred<Response>();
    const api = stubApi({
      ...pageRoutes(),
      [COMPLETION]: () => completion.promise,
      [CHANGE]: () => change.promise,
      [TASKS]: listed([task]),
    });
    await mountPage();
    const query = () =>
      Object.fromEntries(api.requests().at(-1)!.url.searchParams);
    fireEvent.click(
      within(listOf("open")).getByRole("button", { name: "Complete" }),
    );
    fireEvent.change(element("[data-task-status-filter]"), {
      target: { value: "cancelled" },
    });
    await waitFor(() =>
      expect(query()).toEqual({ limit: "50", status: "cancelled" })
    );
    await act(async () => {
      completion.resolve(saved({ ...task, status: "completed" }));
      await completion.promise;
    });
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    await waitFor(() =>
      expect(query()).toEqual({ limit: "50", status: "cancelled" })
    );
    expect(api.requests().at(-1)!.method).toBe("GET");

    await waitFor(() =>
      expect(
        within(listOf("open")).queryByRole("button", {
          name: "Edit task",
        }),
      ).not.toBeNull()
    );
    fireEvent.click(
      within(listOf("open")).getByRole("button", { name: "Edit task" }),
    );
    fireEvent.submit(form());
    fireEvent.change(element("[data-task-person-filter]"), {
      target: { value: personId },
    });
    await act(async () => {
      change.resolve(saved());
      await change.promise;
    });
    await waitFor(() =>
      expect(stateLine().textContent).not.toBe("Loading tasks…")
    );
    expect(query()).toEqual({ limit: "50", personId, status: "cancelled" });
  });

  it("keeps the task controls locked and Load more hidden until a save's refresh lands", async () => {
    pageShell();
    let reads = 0;
    const refresh = deferred<Response>();
    const api = stubApi({
      ...pageRoutes(),
      [CREATE]: jsonResponse({ status: "created", task }, 201),
      [TASKS]: () => (++reads === 1 ? listed([task], "next") : refresh.promise),
    });
    await mountPage();
    fireEvent.click(add());
    fireEvent.change(titleField(), { target: { value: "First" } });
    fireEvent.submit(form());
    await waitFor(() => expect(form().hidden).toBe(true));
    expect(add().disabled).toBe(true);
    expect(element('[data-load-more="tasks"]').hidden).toBe(true);

    await act(async () => {
      refresh.resolve(listed([task], "next"));
      await refresh.promise;
    });
    await waitFor(() => expect(add().disabled).toBe(false));
    expect(element('[data-load-more="tasks"]').hidden).toBe(false);
    fireEvent.click(add());
    fireEvent.change(titleField(), { target: { value: "Second" } });
    fireEvent.submit(form());
    await waitFor(() =>
      expect(writes(api).filter((call) => call.method === "POST"))
        .toHaveLength(2)
    );
  });

  it("hides Load more while a completion is in flight", async () => {
    pageShell();
    const completion = deferred<Response>();
    const api = stubApi({
      ...pageRoutes(),
      [COMPLETION]: () => completion.promise,
      [`${TASKS}?cursor=next`]: listed([{
        ...task,
        id: "other",
        title: "Later",
      }]),
      [TASKS]: [
        listed([task], "next"),
        listed([{ ...task, status: "completed" }]),
      ],
    });
    await mountPage();
    fireEvent.click(
      within(listOf("open")).getByRole("button", { name: "Complete" }),
    );
    expect(element('[data-load-more="tasks"]').hidden).toBe(true);
    await act(async () => {
      completion.resolve(saved({ ...task, status: "completed" }));
      await completion.promise;
    });
    await waitFor(() =>
      expect(listOf("completed").textContent).toContain("Call Ada")
    );
    expect(api.calls().filter((call) => call.includes("cursor=next")))
      .toHaveLength(0);
  });

  it("separates paged active choices from historical unavailable filters", async () => {
    pageShell();
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
    const api = stubApi({
      [`${PEOPLE}?cursor=people-cursor`]: directory([active51]),
      ...pageRoutes(directory(people, "people-cursor")),
      [TASKS]: listed([historical]),
    });
    await mountPage();
    const item = rowOf("open", historical.title);
    expect(item.textContent).toContain("Deleted/Unavailable person");
    expect(item.textContent).not.toContain("(archived)");
    expect(within(item).queryByRole("button")).toBeNull();
    const historicalFilter = element<HTMLSelectElement>(
      "[data-task-person-filter]",
    );
    fireEvent.click(add());
    const writable = within(form()).getByLabelText<HTMLSelectElement>(
      "Person (optional)",
    );
    expect(writable.querySelector(`[value='${unavailableId}']`)).toBeNull();
    expect(historicalFilter.querySelector(`[value='${unavailableId}']`)).not
      .toBeNull();
    fireEvent.click(
      within(element("main")).getByRole("button", {
        name: "Load more people",
      }),
    );
    await waitFor(() =>
      expect(writable.querySelector(`[value='${active51.id}']`)).not.toBeNull()
    );
    expect(api.calls().at(-1)).toContain("cursor=people-cursor");
    expect(historicalFilter.querySelector(`[value='${active51.id}']`)).not
      .toBeNull();
    expect(element("[data-task-people-more]").hidden).toBe(true);
  });

  it("preserves an active task link outside the first directory page on edit", async () => {
    pageShell();
    const api = stubApi({
      ...pageRoutes(),
      [CHANGE]: saved(),
      [TASKS]: listed([task]),
    });
    await mountPage();
    fireEvent.click(
      within(listOf("open")).getByRole("button", { name: "Edit task" }),
    );
    const select = within(form()).getByLabelText<HTMLSelectElement>(
      "Person (optional)",
    );
    expect(select.value).toBe(personId);
    fireEvent.input(titleField(), { target: { value: "Keep Ada" } });
    fireEvent.submit(form());
    await waitFor(() => expect(writes(api)).toHaveLength(1));
    expect(api.bodies()[0]).toMatchObject({ personId, title: "Keep Ada" });
  });

  it("cancels an edit back to Add task and says when the list fails", async () => {
    personShell();
    stubApi({ [TASKS]: [listed([task]), problemResponse(503), listed([])] });
    await mountPerson();
    fireEvent.click(add());
    fireEvent.click(within(form()).getByRole("button", { name: "Cancel" }));
    expect(form().hidden).toBe(true);
    expect(document.activeElement).toBe(add());
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: true, personId },
        }),
      );
    });
    expect(add().hidden).toBe(true);
    const retry = element<HTMLButtonElement>("[data-task-retry]");
    await waitFor(() =>
      expect(stateLine().textContent).toBe(
        "Tasks could not be loaded. Saved tasks are unchanged.",
      )
    );
    expect(element("#profile-section-tasks").dataset.sectionState).toBe(
      "error",
    );
    expect(retry.hidden).toBe(false);
    expect(listOf("open").textContent).toContain("Call Ada");
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: false, personId },
        }),
      );
    });
    await waitFor(() =>
      expect(stateLine().textContent).toBe("No tasks in this view.")
    );
    expect(add().hidden).toBe(false);
    expect(retry.hidden).toBe(true);
  });
});

describe("REL-052 person tasks status lines", () => {
  // Mounted during the initial fan-out, the line waits for the workspace's
  // promotion (UXD-003B); mounted after it, the line is its own live region
  // from the first commit.
  it.each([false, true])(
    "owns the card's and the form's live regions from the first commit only once states are live (%s)",
    async (live) => {
      personShell();
      const answer = deferred<Response>();
      stubApi({ [TASKS]: answer.promise });
      const settled = mountPending(() =>
        mountPersonTasks(
          element("#person-profile-ready"),
          sectionProps({ preferences: preferences(), statesLive: () => live }),
        )
      );
      const lines = [stateLine(), formState()];
      for (const line of lines) {
        expect(line.getAttribute("role")).toBe(live ? "status" : null);
        expect(line.getAttribute("aria-live")).toBe(live ? "polite" : null);
      }
      await act(async () => {
        answer.resolve(listed([]));
        await settled;
      });
      expect(lines.map((line) => line.isConnected)).toEqual([true, true]);
    },
  );
});
