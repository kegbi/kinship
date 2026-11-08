import { describe, expect, it } from "vitest";
import type { Task } from "../../../../../packages/contracts/generated/auth-client.ts";
import { formatInstant } from "../../lib/time-presentation.ts";
import {
  ARCHIVED_NOTICE,
  changeInput,
  createInput,
  directoryName,
  dueText,
  initialTaskState,
  localDateTime,
  TASK_CHANGED_EVENT,
  taskColumns,
  taskCount,
  taskMeta,
  taskMutable,
  taskReducer,
  type TaskState,
} from "./tasks.ts";

const utc = { effectiveTimezone: "UTC", locale: "en" };
const personId = "00000000-0000-4000-8000-000000000100";

function task(overrides: Partial<Task> = {}): Task {
  return {
    createdAt: "2026-08-18T10:00:00.000Z",
    dueAt: "2026-08-20T09:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000900",
    person: { archived: false, id: personId, name: "Ada Lovelace" },
    status: "open",
    title: "Call Ada",
    updatedAt: "2026-08-18T10:00:00.000Z",
    ...overrides,
  };
}

const values = {
  description: "",
  dueAt: "",
  personId: "",
  status: "open",
  title: "  Call Ada  ",
};

describe("PLANNING-001 task presentation", () => {
  it("keeps the frozen task-changed event name", () => {
    expect(TASK_CHANGED_EVENT).toBe("kinship:task-changed");
  });

  it("says when a task is due and whom it concerns", () => {
    expect(dueText(undefined, utc)).toBe("No due time");
    expect(taskMeta(task(), utc)).toBe(
      `Due ${formatInstant("2026-08-20T09:00:00.000Z", utc)} · Ada Lovelace`,
    );
    expect(
      taskMeta(
        task({ person: { archived: true, id: personId, name: "Ada" } }),
        utc,
      ),
    ).toContain("· Ada (archived)");
    expect(
      taskMeta(
        task({
          person: {
            archived: true,
            id: personId,
            name: "Deleted/Unavailable person",
            unavailable: true,
          },
        }),
        utc,
      ),
    ).not.toContain("(archived)");
    const { person: _person, ...workspace } = task();
    expect(taskMeta(workspace, undefined)).toBe(
      "Due Time unavailable · Workspace task",
    );
  });

  it("counts a view and names directory people", () => {
    expect(taskCount(0)).toBe("No tasks in this view.");
    expect(taskCount(1)).toBe("1 task.");
    expect(taskCount(3)).toBe("3 tasks.");
    expect(directoryName({ familyName: "Lovelace", givenName: "Ada" })).toBe(
      "Ada Lovelace",
    );
    expect(directoryName({})).toBe("Unnamed person");
  });

  it("shows an instant in a local datetime field and back", () => {
    expect(localDateTime(undefined)).toBe("");
    const local = localDateTime("2026-08-20T09:00:30.500Z");
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(new Date(local).toISOString()).toBe("2026-08-20T09:00:00.000Z");
  });

  it("puts each task in its column, and a moving one after the tasks there", () => {
    const open = task({ id: "open" });
    const done = task({ id: "done", status: "completed" });
    const dropped = task({ id: "dropped", status: "cancelled" });
    const later = task({ id: "later" });
    expect(taskColumns([open, done, dropped, later], {})).toEqual({
      cancelled: [dropped],
      completed: [done],
      open: [open, later],
    });
    const moving = taskColumns([open, done, dropped, later], {
      done: "open",
      open: "completed",
    });
    expect(moving.open.map((entry) => entry.id)).toEqual(["later", "done"]);
    expect(moving.completed.map((entry) => entry.id)).toEqual(["open"]);
  });

  it("offers controls only while the task and its person are writable", () => {
    expect(taskMutable(task(), false)).toBe(true);
    expect(taskMutable(task(), true)).toBe(false);
    expect(
      taskMutable(
        task({ person: { archived: true, id: personId, name: "A" } }),
        false,
      ),
    ).toBe(false);
  });
});

describe("PLANNING-001 task requests", () => {
  it("creates with only what was entered", () => {
    expect(createInput(values, undefined, "request")).toEqual({
      requestId: "request",
      title: "Call Ada",
    });
    expect(
      createInput(
        {
          ...values,
          description: " Notes ",
          dueAt: "2026-08-21T10:15",
          personId: "chosen",
        },
        undefined,
        "request",
      ),
    ).toEqual({
      description: "Notes",
      dueAt: new Date("2026-08-21T10:15").toISOString(),
      personId: "chosen",
      requestId: "request",
      title: "Call Ada",
    });
    expect(
      createInput({ ...values, personId: "chosen" }, personId, "request")
        .personId,
    ).toBe(personId);
  });

  it("preserves due precision and completion unless deliberately changed", () => {
    const completed = task({ status: "completed" });
    expect(
      changeInput(values, completed, { dueChanged: false, personFixed: true }),
    ).toEqual({
      description: null,
      expectedUpdatedAt: completed.updatedAt,
      title: "Call Ada",
    });
    expect(
      changeInput(
        { ...values, dueAt: "2026-08-21T10:15", status: "cancelled" },
        task(),
        { dueChanged: true, personFixed: false },
      ),
    ).toEqual({
      description: null,
      dueAt: new Date("2026-08-21T10:15").toISOString(),
      expectedUpdatedAt: task().updatedAt,
      personId: null,
      status: "cancelled",
      title: "Call Ada",
    });
    expect(
      changeInput(
        { ...values, description: " Kept ", personId: "chosen" },
        task(),
        { dueChanged: true, personFixed: false },
      ),
    ).toMatchObject({
      description: "Kept",
      dueAt: null,
      personId: "chosen",
      status: "open",
    });
  });
});

describe("GAP-031 task reducer", () => {
  const ready = (state: TaskState = initialTaskState(false)) =>
    taskReducer(
      taskReducer(
        taskReducer(state, {
          preferences: utc,
          type: "context",
          workspaceId: "workspace",
        }),
        {
          people: [{ id: "p1", name: "Person 1" }],
          peopleCursor: "people",
          type: "people",
        },
      ),
      { nextCursor: "next", reset: true, tasks: [task()], type: "loaded" },
    );

  it("FEQ-06 reads the directory's people once they are wanted, and again after a failure", () => {
    const start = initialTaskState(false);
    expect(start.peopleRead).toBe("idle");
    const wanted = taskReducer(start, { type: "people-wanted" });
    expect(wanted.peopleRead).toBe("wanted");
    expect(taskReducer(wanted, { type: "people-wanted" })).toBe(wanted);
    const loading = taskReducer(wanted, { type: "people-loading" });
    expect(loading.peopleRead).toBe("loading");
    expect(taskReducer(loading, { type: "people-wanted" })).toBe(loading);
    expect(taskReducer(loading, { type: "people-failed" }).peopleRead)
      .toBe("idle");
    const done = taskReducer(loading, { people: [], type: "people" });
    expect(done.peopleRead).toBe("done");
    expect(taskReducer(done, { type: "people-wanted" })).toBe(done);
  });

  it("resolves its context, then lists a page and its people", () => {
    const state = ready();
    expect(state).toMatchObject({
      nextCursor: "next",
      peopleCursor: "people",
      preferences: utc,
      status: "ready",
      workspaceId: "workspace",
    });
    expect(state.formChoices.map((choice) => choice.id)).toEqual([
      "p1",
      personId,
    ]);
    expect(state.filterChoices.map((choice) => choice.id)).toEqual([
      "p1",
      personId,
    ]);
    const withoutPreferences = taskReducer(initialTaskState(false), {
      type: "context",
      workspaceId: "workspace",
    });
    expect(withoutPreferences.preferences).toBeUndefined();
    expect(withoutPreferences.status).toBe("loading");
    expect(taskReducer(initialTaskState(false), { type: "unavailable" }).status)
      .toBe("unavailable");
  });

  it("continues a page, dedupes it, and forgets the cursor on a reset", () => {
    const state = ready();
    const continued = taskReducer(state, {
      reset: false,
      tasks: [task(), task({ id: "later" })],
      type: "loaded",
    });
    expect(continued.tasks.map((entry) => entry.id)).toEqual([
      task().id,
      "later",
    ]);
    expect(continued.nextCursor).toBeUndefined();
    const reloading = taskReducer(state, { reset: true, type: "loading" });
    expect(reloading.nextCursor).toBeUndefined();
    expect(reloading.tasks).toEqual(state.tasks);
    expect(taskReducer(state, { reset: false, type: "loading" }).nextCursor)
      .toBe("next");
    expect(taskReducer(state, { type: "failed" }).status).toBe("error");
  });

  it("keeps people past tasks name in the filter and only active ones linkable", () => {
    const state = taskReducer(ready(), {
      reset: true,
      tasks: [
        task({
          id: "historic",
          person: {
            archived: true,
            id: "gone",
            name: "Deleted/Unavailable person",
            unavailable: true,
          },
        }),
        (({ person: _person, ...workspace }) => workspace)(
          task({ id: "workspace" }),
        ),
      ],
      type: "loaded",
    });
    expect(state.filterChoices.map((choice) => choice.id)).toContain("gone");
    expect(state.formChoices.map((choice) => choice.id)).not.toContain("gone");
    const paged = taskReducer(state, {
      people: [{ id: "p51", name: "Reachable 51" }, { id: "p1", name: "x" }],
      type: "people",
    });
    expect(paged.peopleCursor).toBeUndefined();
    expect(paged.formChoices.filter((choice) => choice.id === "p1"))
      .toHaveLength(1);
    expect(paged.formChoices.at(-1)?.id).toBe("p51");
    const archived = taskReducer(
      taskReducer(initialTaskState(true), {
        type: "context",
        workspaceId: "workspace",
      }),
      { reset: true, tasks: [task()], type: "loaded" },
    );
    expect(archived.formChoices).toEqual([]);
  });

  it("opens, marks the due time changed, saves, and cancels the editor", () => {
    const opened = taskReducer(ready(), { requestId: "request", type: "open" });
    expect(opened.editor).toEqual({
      dueChanged: false,
      generation: 1,
      requestId: "request",
    });
    expect(opened.focus).toEqual({ target: "title", tick: 1 });
    const due = taskReducer(opened, { type: "due-changed" });
    expect(due.editor?.dueChanged).toBe(true);
    const editing = taskReducer(due, { task: task(), type: "open" });
    expect(editing.editor).toMatchObject({ dueChanged: false, generation: 2 });
    expect(editing.editor?.requestId).toBeUndefined();
    const saving = taskReducer(editing, { saving: true, type: "saving" });
    expect(saving.saving).toBe(true);
    const saved = taskReducer(saving, { notice: "Task saved.", type: "saved" });
    expect(saved.editor).toBeUndefined();
    expect(saved.notice).toBe("Task saved.");
    expect(taskReducer(saved, { type: "due-changed" })).toBe(saved);
    const cancelled = taskReducer(editing, { focus: true, type: "close" });
    expect(cancelled.editor).toBeUndefined();
    expect(cancelled.focus?.target).toBe("add");
    expect(taskReducer(editing, { type: "close" }).focus?.target).toBe(
      "title",
    );
  });

  it("moves a completing task and settles it", () => {
    const moving = taskReducer(ready(), {
      taskId: task().id,
      to: "completed",
      type: "move",
    });
    expect(moving.moving).toEqual({ [task().id]: "completed" });
    expect(
      taskReducer(moving, { taskId: task().id, type: "settle" }).moving,
    ).toEqual({});
  });

  it("filters, notices, and follows the person's lifecycle", () => {
    const filters = { personId: "p1", status: "open" };
    expect(taskReducer(ready(), { filters, type: "filter" }).filters).toBe(
      filters,
    );
    expect(
      taskReducer(ready(), { notice: "Add a task title.", type: "notice" })
        .notice,
    ).toBe("Add a task title.");
    expect(initialTaskState(true).notice).toBe(ARCHIVED_NOTICE);
    const editing = taskReducer(ready(), { type: "open" });
    const archived = taskReducer(editing, {
      archived: true,
      type: "lifecycle",
    });
    expect(archived).toMatchObject({ archived: true, notice: ARCHIVED_NOTICE });
    expect(archived.editor).toBeUndefined();
    expect(
      taskReducer(archived, { archived: false, type: "lifecycle" }).archived,
    ).toBe(false);
  });
});
