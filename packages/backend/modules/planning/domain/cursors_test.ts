import { assert, assertEquals } from "../../../testing/assert.ts";
import { signCursor } from "../../../shared-kernel/pagination.ts";
import {
  decodeTaskCursor,
  encodeTaskCursor,
  TASK_CURSOR_DOMAIN,
  type TaskCursorKeyset,
  type TaskCursorScope,
} from "./cursors.ts";
import type { TaskListAnchor } from "./task_rules.ts";

const keyset: TaskCursorKeyset = {
  activeVersion: 1,
  keys: new Map([[1, new Uint8Array(32).fill(7)]]),
};
const otherKeyset: TaskCursorKeyset = {
  activeVersion: 1,
  keys: new Map([[1, new Uint8Array(32).fill(9)]]),
};

const workspaceId = "10000000-0000-4000-8000-000000000001";
const anchor: TaskListAnchor = {
  dueAt: "2026-05-04T09:00:00.000000Z",
  id: "10000000-0000-4000-8000-000000000004",
  status: "open",
  updatedAt: "2026-01-01T00:00:00.000000Z",
};

function scope(overrides: Partial<TaskCursorScope> = {}): TaskCursorScope {
  return {
    dueBefore: null,
    personId: null,
    statusFilter: null,
    workspaceId,
    ...overrides,
  };
}

Deno.test("[GAP-016] a task cursor round trips through its own codec", async () => {
  assertEquals(TASK_CURSOR_DOMAIN, "kinship.planning.task-cursor.v1");
  const cursor = await encodeTaskCursor(scope(), anchor, keyset);
  assertEquals(await decodeTaskCursor(cursor, scope(), keyset), anchor);
  const undated: TaskListAnchor = {
    id: anchor.id,
    status: "completed",
    updatedAt: anchor.updatedAt,
  };
  assertEquals(
    await decodeTaskCursor(
      await encodeTaskCursor(scope(), undated, keyset),
      scope(),
      keyset,
    ),
    undated,
    "a task with no due time carries none back",
  );
});

Deno.test("[GAP-016] a cursor minted for another question is refused", async () => {
  const cursor = await encodeTaskCursor(
    scope({
      dueBefore: "2026-06-01T00:00:00.000Z",
      personId: "p",
      statusFilter: "open",
    }),
    anchor,
    keyset,
  );
  for (
    const other of [
      scope(),
      scope({ workspaceId: "10000000-0000-4000-8000-00000000000f" }),
      scope({
        dueBefore: "2026-06-01T00:00:00.000Z",
        personId: "q",
        statusFilter: "open",
      }),
      scope({
        dueBefore: "2026-07-01T00:00:00.000Z",
        personId: "p",
        statusFilter: "open",
      }),
      scope({
        dueBefore: "2026-06-01T00:00:00.000Z",
        personId: "p",
        statusFilter: "cancelled",
      }),
    ]
  ) {
    assertEquals(
      await decodeTaskCursor(cursor, other, keyset),
      undefined,
      "a cursor may not widen the listing it resumes",
    );
  }
});

Deno.test("[GAP-016] an unsigned, foreign, or malformed cursor reads as nothing", async () => {
  assertEquals(await decodeTaskCursor("forged", scope(), keyset), undefined);
  assertEquals(
    await decodeTaskCursor(
      await encodeTaskCursor(scope(), anchor, otherKeyset),
      scope(),
      keyset,
    ),
    undefined,
    "a cursor signed with another key is not this service's",
  );
  assertEquals(
    await decodeTaskCursor(
      await signCursor("kinship.planning.other.v1", {
        ...scope(),
        dueAt: null,
        id: anchor.id,
        status: "open",
        updatedAt: anchor.updatedAt,
        version: 1,
      }, keyset),
      scope(),
      keyset,
    ),
    undefined,
    "a cursor minted for another listing may not be replayed here",
  );
  assertEquals(
    await decodeTaskCursor(
      await signCursor(TASK_CURSOR_DOMAIN, "not an object", keyset),
      scope(),
      keyset,
    ),
    undefined,
  );
  assertEquals(
    await decodeTaskCursor(
      await signCursor(TASK_CURSOR_DOMAIN, null, keyset),
      scope(),
      keyset,
    ),
    undefined,
  );
});

Deno.test("[GAP-016] a signed body carrying a broken anchor is still refused", async () => {
  const body = {
    ...scope(),
    dueAt: null as unknown,
    id: anchor.id as unknown,
    status: "open" as unknown,
    updatedAt: anchor.updatedAt as unknown,
    version: 1 as unknown,
  };
  const broken: Record<string, unknown>[] = [
    { ...body, version: 2 },
    { ...body, id: "not-a-uuid" },
    { ...body, id: 5 },
    { ...body, status: "archived" },
    { ...body, updatedAt: 5 },
    { ...body, updatedAt: "never" },
    { ...body, dueAt: "never" },
    { ...body, dueAt: 5 },
  ];
  for (const candidate of broken) {
    assertEquals(
      await decodeTaskCursor(
        await signCursor(TASK_CURSOR_DOMAIN, candidate, keyset),
        scope(),
        keyset,
      ),
      undefined,
      `${JSON.stringify(candidate)} is not a usable anchor`,
    );
  }
  assert(
    await decodeTaskCursor(
      await signCursor(TASK_CURSOR_DOMAIN, body, keyset),
      scope(),
      keyset,
    ) !== undefined,
    "the unbroken body is the control",
  );
});
