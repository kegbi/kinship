import { assertEquals } from "../../../testing/assert.ts";
import {
  type ChangeTaskInput,
  completionTarget,
  type CreateTaskInput,
  dueBeforeFilter,
  MAXIMUM_DESCRIPTION_LENGTH,
  MAXIMUM_TITLE_LENGTH,
  type StoredTask,
  targetPersonId,
  TASK_ID_NAMESPACE,
  taskChangeIsUnchanged,
  taskMatchesCreate,
  taskPageLimit,
  validateChangeTask,
  validateCreateTask,
} from "./task_rules.ts";

const personId = "10000000-0000-4000-8000-000000000001";
const otherPersonId = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const taskId = "10000000-0000-4000-8000-000000000004";
const memberId = "10000000-0000-4000-8000-000000000005";
const updatedAt = "2026-01-01T00:00:00.000000Z";

function task(overrides: Partial<StoredTask> = {}): StoredTask {
  return {
    createdAt: updatedAt,
    createdByMemberId: memberId,
    id: taskId,
    status: "open",
    title: "Call Ada",
    updatedAt,
    ...overrides,
  };
}

function change(overrides: Partial<ChangeTaskInput> = {}): ChangeTaskInput {
  return { expectedUpdatedAt: updatedAt, ...overrides };
}

Deno.test("[GAP-016] a well-formed task proposal is trimmed and canonicalized", () => {
  assertEquals(TASK_ID_NAMESPACE, "kinship.planning.task-id.v1");
  assertEquals(MAXIMUM_TITLE_LENGTH, 500);
  assertEquals(MAXIMUM_DESCRIPTION_LENGTH, 10_000);
  const input: CreateTaskInput = {
    description: "  with a note  ",
    dueAt: "2026-05-04T09:00:00Z",
    personId: personId.toUpperCase(),
    requestId: requestId.toUpperCase(),
    title: "  Call Ada  ",
  };
  assertEquals(validateCreateTask(input), {
    description: "with a note",
    dueAt: "2026-05-04T09:00:00.000000Z",
    errors: {},
    personId,
    requestId,
    title: "Call Ada",
  });
});

Deno.test("[GAP-016] a task proposal names every field it rejects", () => {
  assertEquals(
    validateCreateTask({
      description: "x".repeat(10_001),
      dueAt: "whenever",
      personId: "nobody",
      requestId: "nothing",
      title: "   ",
    }).errors,
    {
      title: "Add a title of at most 500 characters.",
      description: "Description must be at most 10,000 characters.",
      dueAt: "Choose a valid due time.",
      requestId: "Use a canonical request identifier.",
      personId: "Choose a person from this workspace.",
    },
  );
  assertEquals(
    validateCreateTask({ requestId, title: "x".repeat(501) }).errors.title,
    "Add a title of at most 500 characters.",
  );
  assertEquals(
    validateCreateTask({ personId: "", requestId, title: "Call" }).errors,
    {},
    "an empty person identifier is no person at all, not a bad one",
  );
});

Deno.test("[GAP-016] a replayed request matches only the task the same member proposed", () => {
  const checked = validateCreateTask({
    description: "with a note",
    personId,
    requestId,
    title: "Call Ada",
  });
  const same = task({ description: "with a note", personId });
  assertEquals(taskMatchesCreate(same, checked, memberId), true);
  assertEquals(
    taskMatchesCreate(same, checked, "10000000-0000-4000-8000-00000000000f"),
    false,
    "another member's task is never this member's replay",
  );
  for (
    const different of [
      task({ description: "with a note", personId, title: "Call Grace" }),
      task({ personId }),
      task({ description: "with a note" }),
      task({
        description: "with a note",
        dueAt: "2026-05-04T09:00:00.000000Z",
        personId,
      }),
    ]
  ) {
    assertEquals(taskMatchesCreate(different, checked, memberId), false);
  }
});

Deno.test("[GAP-016] a change keeps every patch field three-valued", () => {
  assertEquals(
    validateChangeTask(taskId, change({ description: null, dueAt: null })),
    {
      description: null,
      dueAt: null,
      errors: {},
      id: taskId,
      title: undefined,
    },
  );
  assertEquals(
    validateChangeTask(taskId, change()),
    {
      description: undefined,
      dueAt: undefined,
      errors: {},
      id: taskId,
      title: undefined,
    },
    "a silent patch leaves every field alone",
  );
  assertEquals(
    validateChangeTask(taskId, change({ title: "  Renamed  " })).title,
    "Renamed",
  );
});

Deno.test("[GAP-016] a change names every field it rejects", () => {
  assertEquals(
    validateChangeTask("not-a-task", {
      description: "x".repeat(10_001),
      dueAt: "whenever",
      expectedUpdatedAt: "never",
      personId: "nobody",
      title: "   ",
    }).errors,
    {
      taskId: "Use a canonical task identifier.",
      expectedUpdatedAt: "Refresh this task before saving.",
      title: "Add a title of at most 500 characters.",
      description: "Description must be at most 10,000 characters.",
      dueAt: "Choose a valid due time.",
      personId: "Choose a person from this workspace.",
    },
  );
  assertEquals(
    validateChangeTask("not-a-task", change()).id,
    undefined,
  );
});

Deno.test("[GAP-016] the person a change points at follows the patch", () => {
  const linked = task({ personId });
  assertEquals(targetPersonId(linked, undefined), personId, "silent keeps it");
  assertEquals(targetPersonId(linked, null), undefined, "null clears it");
  assertEquals(
    targetPersonId(linked, otherPersonId.toUpperCase()),
    otherPersonId,
    "a named person is canonicalized",
  );
  assertEquals(targetPersonId(task(), undefined), undefined);
});

Deno.test("[GAP-016] a change that asks for what is already true changes nothing", () => {
  const linked = task({
    description: "note",
    dueAt: "2026-05-04T09:00:00Z",
    personId,
  });
  assertEquals(
    taskChangeIsUnchanged(
      linked,
      validateChangeTask(taskId, change()),
      change(),
      personId,
    ),
    true,
    "a silent patch is unchanged",
  );
  assertEquals(
    taskChangeIsUnchanged(
      linked,
      validateChangeTask(taskId, change({ title: "Call Ada" })),
      change({ title: "Call Ada" }),
      personId,
    ),
    true,
    "the same title is unchanged",
  );
  for (
    const patch of [
      change({ title: "Call Grace" }),
      change({ description: "other" }),
      change({ description: null }),
      change({ dueAt: null }),
      change({ dueAt: "2026-06-04T09:00:00Z" }),
      change({ personId: null }),
      change({ status: "cancelled" }),
    ]
  ) {
    assertEquals(
      taskChangeIsUnchanged(
        linked,
        validateChangeTask(taskId, patch),
        patch,
        targetPersonId(linked, patch.personId),
      ),
      false,
      `${JSON.stringify(patch)} changes the task`,
    );
  }
  assertEquals(
    taskChangeIsUnchanged(
      task(),
      validateChangeTask(taskId, change({ description: null })),
      change({ description: null }),
      undefined,
    ),
    true,
    "clearing a field that is already clear changes nothing",
  );
});

Deno.test("[GAP-016] a completion toggle names its target status and its audit action", () => {
  assertEquals(completionTarget(true), {
    action: "completed",
    status: "completed",
  });
  assertEquals(completionTarget(false), { action: "reopened", status: "open" });
});

Deno.test("[GAP-016] a listing clamps its page and canonicalizes its due-before bound", () => {
  // GAP-023 aligned the page with every other list: twenty by default and
  // never more than fifty.
  assertEquals(taskPageLimit(undefined), 20);
  assertEquals(taskPageLimit(0), 1);
  assertEquals(taskPageLimit(50), 50);
  assertEquals(taskPageLimit(101), 50);
  assertEquals(taskPageLimit(20.9), 20);
  assertEquals(
    dueBeforeFilter("2026-05-04T09:00:00+02:00"),
    "2026-05-04T07:00:00.000Z",
  );
  assertEquals(dueBeforeFilter(undefined), undefined);
  assertEquals(dueBeforeFilter(""), undefined);
  assertEquals(dueBeforeFilter("whenever"), undefined);
});
