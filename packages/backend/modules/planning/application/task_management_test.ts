import { createTaskManagement } from "./task_management.ts";
import { assert } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import { fixedClock } from "../../../testing/fakes.ts";

const actor = fixtures.actor();
const personId = fixtures.personId();
const taskId = "00000000-0000-4000-8000-000000000900";
const cursorKeyset = {
  activeVersion: 1,
  keys: new Map([[1, new Uint8Array(32).fill(7)]]),
};

Deno.test("DAV task operations use the supplied owning transaction", async () => {
  const { management, seenTransactions } = dependencies();
  const transaction = { opaque: "dav-transaction" };
  const created = await management.create(actor, {
    requestId: taskId,
    title: "Synchronized task",
  }, transaction);
  assert(created.status === "created", "DAV task created");
  if (created.status !== "created") return;
  const saved = await management.change(actor, created.task.id, {
    expectedUpdatedAt: created.task.updatedAt,
    title: "Updated synchronized task",
  }, transaction);
  assert(saved.status === "saved", "DAV task updated");
  const completed = await management.setCompletion(
    actor,
    created.task.id,
    true,
    transaction,
  );
  assert(completed.status === "saved", "DAV task completed");
  const reopened = await management.setCompletion(
    actor,
    created.task.id,
    false,
    transaction,
  );
  assert(reopened.status === "saved", "DAV task reopened");
  assert(
    seenTransactions.every((value) => value === transaction.opaque),
    "all planning operations stay inside the supplied DAV transaction",
  );
});

function dependencies(
  personStatus: "archived" | "not-found" | "ready" = "ready",
  workspaceStatus: "forbidden" | "ready" = "ready",
) {
  let stored: {
    completedAt?: string;
    completedByMemberId?: string;
    createdAt: string;
    createdByMemberId: string;
    description?: string;
    dueAt?: string;
    id: string;
    personId?: string;
    status: "cancelled" | "completed" | "open";
    title: string;
    updatedAt: string;
  } | undefined;
  const auditActions: string[] = [];
  const seenTransactions: unknown[] = [];
  return {
    auditActions,
    management: createTaskManagement({
      actors: {
        revalidate: ({ transaction }) => {
          seenTransactions.push(transaction.opaque);
          return Promise.resolve(
            workspaceStatus === "ready"
              ? "active" as const
              : "revoked" as const,
          );
        },
      },
      audit: {
        assertPostcondition: () => Promise.resolve(),
        record: ({ action }: { readonly action: string }) => {
          auditActions.push(action);
          return Promise.resolve(crypto.randomUUID());
        },
      },
      clock: fixedClock("2026-08-18T10:00:00.000Z"),
      cursorKeyset,
      people: {
        inspect: () => Promise.resolve({ status: personStatus }),
        summarize: () =>
          Promise.resolve([{
            archived: personStatus === "archived",
            id: personId,
            name: "Ada Lovelace",
          }]),
      },
      repository: {
        assertPostcondition: () => Promise.resolve(),
        lockRequest: () => Promise.resolve(),
        create: (command) => {
          stored = {
            createdAt: (command.occurredAt as Date).toISOString(),
            createdByMemberId: actor.memberId,
            ...(command.description
              ? { description: command.description as string }
              : {}),
            ...(command.dueAt ? { dueAt: command.dueAt as string } : {}),
            id: command.id as string,
            ...(command.personId
              ? { personId: command.personId as string }
              : {}),
            status: "open",
            title: command.title as string,
            updatedAt: (command.occurredAt as Date).toISOString(),
          };
          return Promise.resolve(stored);
        },
        find: () =>
          Promise.resolve(
            stored
              ? { status: "found" as const, task: stored }
              : { status: "not-found" as const },
          ),
        list: () =>
          Promise.resolve({
            items: stored ? [stored] : [],
            status: "ready" as const,
          }),
        save: (command) => {
          if (!stored) return Promise.resolve(undefined);
          const {
            completedAt: _completedAt,
            completedByMemberId: _completedByMemberId,
            description: _description,
            dueAt: _dueAt,
            personId: _personId,
            ...required
          } = stored;
          const description = command.description === undefined
            ? stored.description
            : command.description ?? undefined;
          const dueAt = command.dueAt === undefined
            ? stored.dueAt
            : command.dueAt ?? undefined;
          const selectedPersonId = command.personId === undefined
            ? stored.personId
            : command.personId ?? undefined;
          stored = {
            ...required,
            ...(command.completedAt === null ? {} : command.completedAt
              ? {
                completedAt: (command.completedAt as Date).toISOString(),
                completedByMemberId: actor.memberId,
              }
              : {}),
            ...(description ? { description } : {}),
            ...(dueAt ? { dueAt } : {}),
            ...(selectedPersonId ? { personId: selectedPersonId } : {}),
            status: command.status ?? stored.status,
            title: command.title ?? stored.title,
            updatedAt: new Date(Math.max(
              (command.occurredAt as Date).getTime(),
              Date.parse(stored.updatedAt) + 1,
            )).toISOString(),
          };
          return Promise.resolve(stored);
        },
      },
      transaction: {
        run: <T>(work: (tx: { opaque: string }) => Promise<T>) =>
          work({ opaque: "tx" }),
      },
    }),
    seenTransactions,
  };
}

Deno.test("PLANNING-001 creates person and global tasks and completes/reopens idempotently", async () => {
  const { auditActions, management } = dependencies();
  const created = await management.create(actor, {
    description: "Bring the planning notes",
    dueAt: "2026-08-20T09:00:00.123456Z",
    personId,
    requestId: taskId,
    title: "Call Ada",
  });
  assert(created.status === "created", "person task was not created");
  assert(
    created.task.person?.name === "Ada Lovelace",
    "person was not projected",
  );
  assert(
    created.task.dueAt === "2026-08-20T09:00:00.123456Z",
    `precise due instant was truncated: ${created.task.dueAt}`,
  );

  const completed = await management.setCompletion(actor, taskId, true);
  const repeated = await management.setCompletion(actor, taskId, true);
  assert(completed.status === "saved", "task was not completed");
  assert(
    repeated.status === "unchanged",
    "repeated completion was not idempotent",
  );
  const reopened = await management.setCompletion(actor, taskId, false);
  assert(
    reopened.status === "saved" && reopened.task.status === "open",
    "task was not reopened",
  );

  const listed = await management.list(actor, { status: "open" });
  assert(
    listed.status === "ready" && listed.items.length === 1,
    "global projection disagreed",
  );
  assert(
    auditActions.join(",") === "created,completed,reopened",
    "idempotent replay emitted an audit event",
  );
});

Deno.test("PLANNING-001 keeps archived person tasks readable but rejects new writes", async () => {
  const { management } = dependencies("archived");
  const result = await management.create(actor, {
    personId,
    requestId: taskId,
    title: "Call Ada",
  });
  assert(
    result.status === "archived-write-rejected",
    "archived person accepted a task write",
  );
});

Deno.test("PLANNING-001 validates, replays creation, and rejects conflicting request reuse", async () => {
  const { management } = dependencies();
  const invalid = await management.create(actor, {
    requestId: "not-a-uuid",
    title: "   ",
  });
  assert(invalid.status === "validation-error", "invalid task was accepted");
  const input = { personId, requestId: taskId, title: "Call Ada" };
  const created = await management.create(actor, input);
  const replay = await management.create(actor, input);
  const conflict = await management.create(actor, {
    ...input,
    title: "Different",
  });
  assert(
    created.status === "created" && replay.status === "created",
    "task replay failed",
  );
  assert(
    conflict.status === "idempotency-conflict",
    "request reuse was not rejected",
  );
});

Deno.test("PLANNING-001 changes task details, clears person/due links, and preserves stale protection", async () => {
  const { management } = dependencies();
  const created = await management.create(actor, {
    dueAt: "2026-08-20T09:00:00.000Z",
    personId,
    requestId: taskId,
    title: "Call Ada",
  });
  assert(created.status === "created", "fixture task missing");
  const changed = await management.change(actor, created.task.id, {
    dueAt: null,
    expectedUpdatedAt: created.task.updatedAt,
    personId: null,
    status: "cancelled",
    title: "Call tomorrow",
  });
  assert(changed.status === "saved", "task details were not changed");
  assert(
    changed.task.title === "Call tomorrow" &&
      changed.task.status === "cancelled" && !changed.task.dueAt &&
      !changed.task.person,
    "changed task projection disagreed",
  );
  const stale = await management.change(actor, created.task.id, {
    expectedUpdatedAt: "2025-01-01T00:00:00.000Z",
    title: "Stale",
  });
  assert(stale.status === "stale", "stale task edit was accepted");
});

Deno.test("PLANNING-001 conceals missing people and rejects inactive workspace access", async () => {
  const missing = await dependencies("not-found").management.create(actor, {
    personId,
    requestId: taskId,
    title: "Missing",
  });
  const forbidden = await dependencies("ready", "forbidden").management.list(
    actor,
  );
  assert(missing.status === "not-found", "missing person was not concealed");
  assert(forbidden.status === "forbidden", "inactive membership read tasks");
});

Deno.test("PLANNING-001 hydrates every person in a bounded 100-task page", async () => {
  const id = (offset: number) =>
    `00000000-0000-4000-8000-${String(offset).padStart(12, "0")}`;
  const tasks = Array.from({ length: 51 }, (_, index) => ({
    createdAt: "2026-08-18T10:00:00.000Z",
    createdByMemberId: actor.memberId,
    id: id(900 + index),
    personId: id(100 + index),
    status: "open" as const,
    title: `Task ${index + 1}`,
    updatedAt: "2026-08-18T10:00:00.000Z",
  }));
  const archivedPersonId = tasks.at(-1)!.personId;
  const summarizeBatchSizes: number[] = [];
  const management = createTaskManagement({
    actors: { revalidate: () => Promise.resolve("active") },
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: () => Promise.resolve(id(9999)),
    },
    clock: fixedClock("2026-08-18T10:00:00.000Z"),
    cursorKeyset,
    people: {
      inspect: ({ personIds }) =>
        Promise.resolve({
          status: personIds.includes(archivedPersonId)
            ? "archived" as const
            : "ready" as const,
        }),
      summarize: ({ personIds }) => {
        summarizeBatchSizes.push(personIds.length);
        return Promise.resolve(
          personIds.slice(0, 50).map((personId) => ({
            archived: personId === archivedPersonId,
            id: personId,
            name: `Person ${personId.slice(-3)}`,
          })),
        );
      },
    },
    repository: {
      assertPostcondition: () => Promise.resolve(),
      create: () => Promise.resolve(undefined),
      find: ({ id: selectedId }) => {
        const selected = tasks.find((task) => task.id === selectedId);
        return Promise.resolve(
          selected
            ? { status: "found" as const, task: selected }
            : { status: "not-found" as const },
        );
      },
      list: ({ personId: selectedPersonId }) =>
        Promise.resolve({
          items: selectedPersonId
            ? tasks.filter((task) => task.personId === selectedPersonId)
            : tasks,
          status: "ready" as const,
        }),
      lockRequest: () => Promise.resolve(),
      save: () => Promise.resolve(undefined),
    },
    transaction: {
      run: <T>(work: (tx: { opaque: string }) => Promise<T>) =>
        work({ opaque: "tx" }),
    },
  });

  const global = await management.list(actor, { limit: 100 });
  const person = await management.list(actor, {
    personId: archivedPersonId,
  });
  const rejected = await management.setCompletion(
    actor,
    tasks.at(-1)!.id,
    true,
  );
  const detached = await management.change(actor, tasks.at(-1)!.id, {
    expectedUpdatedAt: tasks.at(-1)!.updatedAt,
    personId: null,
  });
  const reassigned = await management.change(actor, tasks.at(-1)!.id, {
    expectedUpdatedAt: tasks.at(-1)!.updatedAt,
    personId: tasks[0]!.personId,
  });
  assert(global.status === "ready", "global task page unavailable");
  assert(
    global.items.length === 51 && global.items.every((task) => task.person),
    "task 51+ lost its person summary",
  );
  assert(
    global.items.at(-1)?.person?.archived === true &&
      person.status === "ready" && person.items[0]?.person?.archived === true,
    "archived state disagreed between global and person projections",
  );
  assert(
    rejected.status === "archived-write-rejected",
    "task 51+ exposed mutation for an archived person",
  );
  assert(
    detached.status === "archived-write-rejected" &&
      reassigned.status === "archived-write-rejected",
    "archived current link escaped read-only through detach/reassignment",
  );
  assert(
    summarizeBatchSizes.join(",") === "50,1,1",
    `person summaries were not bounded constant batches: ${summarizeBatchSizes}`,
  );
});

Deno.test("PLANNING-001 advances optimistic tokens under a fixed clock", async () => {
  const { management } = dependencies();
  const created = await management.create(actor, {
    requestId: taskId,
    title: "First title",
  });
  assert(created.status === "created", "fixture task missing");
  const first = await management.change(actor, created.task.id, {
    expectedUpdatedAt: created.task.updatedAt,
    title: "Second title",
  });
  assert(first.status === "saved", "first fixed-clock edit failed");
  assert(
    first.task.updatedAt > created.task.updatedAt,
    "successful edit reused its optimistic token",
  );
  const replay = await management.change(actor, created.task.id, {
    expectedUpdatedAt: created.task.updatedAt,
    title: "Stale replay",
  });
  assert(replay.status === "stale", "consumed optimistic token was reusable");
  const second = await management.change(actor, created.task.id, {
    expectedUpdatedAt: first.task.updatedAt,
    title: "Third title",
  });
  assert(
    second.status === "saved" && second.task.updatedAt > first.task.updatedAt,
    "fresh optimistic token did not permit a monotonic second edit",
  );
});

Deno.test("PLANNING-001 concurrent person swaps use one canonical lock set", async () => {
  const personA = "00000000-0000-4000-8000-000000000101";
  const personB = "00000000-0000-4000-8000-000000000102";
  const taskA = "00000000-0000-4000-8000-000000000901";
  const taskB = "00000000-0000-4000-8000-000000000902";
  const stored = new Map([
    [taskA, {
      createdAt: "2026-08-18T10:00:00.000Z",
      createdByMemberId: actor.memberId,
      id: taskA,
      personId: personA,
      status: "open" as const,
      title: "Swap A",
      updatedAt: "2026-08-18T10:00:00.000Z",
    }],
    [taskB, {
      createdAt: "2026-08-18T10:00:00.000Z",
      createdByMemberId: actor.memberId,
      id: taskB,
      personId: personB,
      status: "open" as const,
      title: "Swap B",
      updatedAt: "2026-08-18T10:00:00.000Z",
    }],
  ]);
  const held = new Map<string, string>();
  const firstLocks = new Set<string>();
  const inspections: readonly string[][] = [];
  const mutableInspections = inspections as string[][];
  let releaseFirstLocks = () => {};
  const firstLocksReady = new Promise<void>((resolve) => {
    releaseFirstLocks = resolve;
  });
  const audits: string[] = [];
  const management = createTaskManagement({
    actors: { revalidate: () => Promise.resolve("active") },
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: ({ task }) => {
        audits.push(task.id);
        return Promise.resolve(crypto.randomUUID());
      },
    },
    clock: fixedClock("2026-08-18T10:00:00.001Z"),
    cursorKeyset,
    people: {
      inspect: async (command) => {
        const transactionId = (command.transaction as { opaque: string })
          .opaque;
        const ids = [...new Set(command.personIds)].sort();
        mutableInspections.push(ids);
        if (ids.length > 1) return { status: "ready" };
        const id = ids[0]!;
        const owner = held.get(id);
        if (owner && owner !== transactionId) {
          const error = new Error("deadlock detected");
          Object.assign(error, { code: "40P01" });
          throw error;
        }
        held.set(id, transactionId);
        if (!firstLocks.has(transactionId)) {
          firstLocks.add(transactionId);
          if (firstLocks.size === 2) releaseFirstLocks();
          await firstLocksReady;
        }
        return { status: "ready" };
      },
      summarize: (command) =>
        Promise.resolve(command.personIds.map((id) => ({
          archived: false,
          id,
          name: id === personA ? "Person A" : "Person B",
        }))),
    },
    repository: {
      assertPostcondition: () => Promise.resolve(),
      create: () => Promise.resolve(undefined),
      find: (command) => {
        const task = stored.get(command.id);
        return Promise.resolve(
          task
            ? { status: "found" as const, task }
            : { status: "not-found" as const },
        );
      },
      list: () => Promise.resolve({ items: [], status: "ready" }),
      lockRequest: () => Promise.resolve(),
      save: (command) => {
        const task = stored.get(command.id);
        if (!task) return Promise.resolve(undefined);
        const saved = {
          ...task,
          personId: typeof command.personId === "string"
            ? command.personId
            : task.personId,
          updatedAt: "2026-08-18T10:00:00.001Z",
        };
        stored.set(command.id, saved);
        return Promise.resolve(saved);
      },
    },
    transaction: {
      run: async <T>(work: (tx: { opaque: string }) => Promise<T>) => {
        const transaction = { opaque: crypto.randomUUID() };
        try {
          return await work(transaction);
        } finally {
          for (const [id, owner] of held) {
            if (owner === transaction.opaque) held.delete(id);
          }
        }
      },
    },
  });

  const outcomes = await Promise.allSettled([
    management.change(actor, taskA, {
      expectedUpdatedAt: stored.get(taskA)!.updatedAt,
      personId: personB,
    }),
    management.change(actor, taskB, {
      expectedUpdatedAt: stored.get(taskB)!.updatedAt,
      personId: personA,
    }),
  ]);
  const failures = outcomes.filter((outcome) => outcome.status === "rejected");
  assert(
    failures.length === 0 &&
      outcomes.every((outcome) =>
        outcome.status === "fulfilled" && outcome.value.status === "saved"
      ) && stored.get(taskA)?.personId === personB &&
      stored.get(taskB)?.personId === personA && audits.length === 2 &&
      mutableInspections.length === 2 &&
      mutableInspections.every((ids) =>
        ids.join(",") === `${personA},${personB}`
      ),
    `concurrent swap exposed non-canonical locks: ${
      JSON.stringify({
        audits,
        failures: failures.map((failure) =>
          failure.status === "rejected"
            ? {
              code: (failure.reason as { code?: string }).code,
              message: String(failure.reason),
            }
            : failure
        ),
        inspections: mutableInspections,
        tasks: [...stored.values()],
      })
    }`,
  );
});

Deno.test("PLANNING-001 preserves unavailable linked-person history as read-only", async () => {
  const linkedId = "00000000-0000-4000-8000-000000000777";
  const stored = {
    createdAt: "2026-08-18T10:00:00.000Z",
    createdByMemberId: actor.memberId,
    id: taskId,
    personId: linkedId,
    status: "open" as const,
    title: "Historical task",
    updatedAt: "2026-08-18T10:00:00.000Z",
  };
  const management = createTaskManagement({
    actors: { revalidate: () => Promise.resolve("active") },
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: () => Promise.resolve(crypto.randomUUID()),
    },
    clock: fixedClock("2026-08-18T10:00:00.000Z"),
    cursorKeyset,
    people: {
      inspect: () => Promise.resolve({ status: "not-found" }),
      summarize: () => Promise.resolve([]),
    },
    repository: {
      assertPostcondition: () => Promise.resolve(),
      create: () => Promise.resolve(undefined),
      find: () => Promise.resolve({ status: "found", task: stored }),
      list: () => Promise.resolve({ items: [stored], status: "ready" }),
      lockRequest: () => Promise.resolve(),
      save: () => Promise.resolve(undefined),
    },
    transaction: {
      run: <T>(work: (tx: { opaque: string }) => Promise<T>) =>
        work({ opaque: "tx" }),
    },
  });
  const listed = await management.list(actor);
  assert(listed.status === "ready", "historical task list failed");
  const person = listed.items[0]?.person as
    | {
      readonly archived?: boolean;
      readonly id?: string;
      readonly name?: string;
      readonly unavailable?: boolean;
    }
    | undefined;
  assert(
    person?.id === linkedId && person.unavailable === true &&
      person.archived === true && person.name === "Deleted/Unavailable person",
    "unavailable linked person became a mutable workspace task",
  );
  const detached = await management.change(actor, taskId, {
    expectedUpdatedAt: stored.updatedAt,
    personId: null,
  });
  const reassigned = await management.change(actor, taskId, {
    expectedUpdatedAt: stored.updatedAt,
    personId,
  });
  assert(
    detached.status === "not-found" && reassigned.status === "not-found",
    "unavailable current link escaped read-only through detach/reassignment",
  );
});

Deno.test("PLANNING-001 returns a bound continuation that reaches task 101", async () => {
  const id = (offset: number) =>
    `00000000-0000-4000-8000-${String(offset).padStart(12, "0")}`;
  const stored = Array.from({ length: 3 }, (_, index) => ({
    createdAt: "2026-08-18T10:00:00.000Z",
    createdByMemberId: actor.memberId,
    id: id(900 + index),
    status: "open" as const,
    title: `Task ${index + 99}`,
    updatedAt: `2026-08-18T10:00:0${index}.000Z`,
  }));
  const listCalls: unknown[] = [];
  const management = createTaskManagement(
    {
      audit: {
        assertPostcondition: () => Promise.resolve(),
        record: () => Promise.resolve(id(9999)),
      },
      clock: fixedClock("2026-08-18T10:00:00.000Z"),
      cursorKeyset,
      people: {
        inspect: () => Promise.resolve({ status: "ready" }),
        summarize: () => Promise.resolve([]),
      },
      repository: {
        assertPostcondition: () => Promise.resolve(),
        create: () => Promise.resolve(undefined),
        find: () => Promise.resolve({ status: "not-found" }),
        list: ((
          command: {
            readonly after?: { readonly id: string };
            readonly limit: number;
          },
        ) => {
          listCalls.push(command);
          const start = command.after
            ? stored.findIndex((task) => task.id === command.after?.id) + 1
            : 0;
          const items = stored.slice(start, start + command.limit);
          const final = items.at(-1);
          return Promise.resolve({
            items,
            ...(start + command.limit < stored.length && final
              ? {
                next: {
                  id: final.id,
                  status: final.status,
                  updatedAt: final.updatedAt,
                },
              }
              : {}),
            status: "ready",
          });
        }) as never,
        lockRequest: () => Promise.resolve(),
        save: () => Promise.resolve(undefined),
      },
      transaction: {
        run: <T>(work: (tx: { opaque: string }) => Promise<T>) =>
          work({ opaque: "tx" }),
      },
      actors: { revalidate: () => Promise.resolve("active") },
    } as unknown as Parameters<typeof createTaskManagement>[0],
  );
  const first = await management.list(actor, { limit: 2 });
  assert(first.status === "ready", "first task page failed");
  const cursor = (first as { readonly nextCursor?: string }).nextCursor;
  assert(
    first.items.length === 2 && cursor,
    "bounded first page omitted its continuation",
  );
  const mismatched = await (management.list as unknown as (
    selectedActor: Parameters<typeof management.list>[0],
    input: {
      readonly cursor: string;
      readonly limit: number;
      readonly status: "completed";
    },
  ) => ReturnType<typeof management.list>)(actor, {
    cursor,
    limit: 2,
    status: "completed",
  });
  const tampered = await (management.list as unknown as (
    selectedActor: Parameters<typeof management.list>[0],
    input: { readonly cursor: string; readonly limit: number },
  ) => ReturnType<typeof management.list>)(actor, {
    cursor: `${cursor}x`,
    limit: 2,
  });
  assert(
    mismatched.status === "stale-cursor" &&
      tampered.status === "stale-cursor" && listCalls.length === 1,
    "task continuation was not scope-bound and tamper-safe",
  );
  const second = await (management.list as unknown as (
    selectedActor: Parameters<typeof management.list>[0],
    input: { readonly cursor: string; readonly limit: number },
  ) => ReturnType<typeof management.list>)(actor, { cursor, limit: 2 });
  assert(
    second.status === "ready" && second.items[0]?.title === "Task 101" &&
      !(second as { readonly nextCursor?: string }).nextCursor,
    "continuation did not make task 101 reachable",
  );
  assert(
    Number(listCalls.length) === 2,
    "continuation did not reach repository",
  );
});
