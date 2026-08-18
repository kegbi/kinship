import type { TaskManagement } from "../../packages/backend/modules/planning/public.ts";
import type { TodayTasks } from "../../packages/backend/read-models/today/public.ts";
import { createPlanningRoutes } from "./planning.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const taskId = "00000000-0000-4000-8000-000000000900";
const personId = "00000000-0000-4000-8000-000000000100";
const task = {
  createdAt: "2026-08-18T10:00:00.000Z",
  createdByMemberId: "00000000-0000-4000-8000-000000000002",
  dueAt: "2026-08-20T09:00:00.000Z",
  id: taskId,
  person: { archived: false, id: personId, name: "Ada Lovelace" },
  status: "open" as const,
  title: "Call Ada",
  updatedAt: "2026-08-18T10:00:00.000Z",
};
const actor = {
  accessibleWorkspaces: [],
  memberId: "00000000-0000-4000-8000-000000000002",
  role: "member" as const,
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000003",
  workspaceName: "Circle",
};

function services(overrides: Partial<TaskManagement> = {}) {
  const tasks = {
    change: () => Promise.resolve({ status: "saved" as const, task }),
    create: () => Promise.resolve({ status: "created" as const, task }),
    list: () => Promise.resolve({ items: [task], status: "ready" as const }),
    setCompletion: () => Promise.resolve({ status: "saved" as const, task }),
    ...overrides,
  } as TaskManagement;
  return {
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    protectedSessions: { resolve: () => Promise.resolve(actor) },
    tasks,
    todayTasks: {
      getDueTasks: () =>
        Promise.resolve({ items: [task], status: "ready" as const }),
    } as TodayTasks,
  };
}

const headers = {
  cookie: "kinship_session=test",
  "content-type": "application/json",
  origin: "http://localhost",
};

Deno.test("PLANNING-001 HTTP creates, lists, changes, completes, and projects tasks", async () => {
  const received: unknown[] = [];
  const current = services({
    change: (_actor, _id, input) => {
      received.push(input);
      return Promise.resolve({ status: "saved", task });
    },
    create: (_actor, input) => {
      received.push(input);
      return Promise.resolve({ status: "created", task });
    },
    setCompletion: (_actor, _id, completed) => {
      received.push(completed);
      return Promise.resolve({ status: "unchanged", task });
    },
  });
  const app = createPlanningRoutes(current);
  const created = await app.request("http://localhost/api/v1/tasks", {
    body: JSON.stringify({
      dueAt: task.dueAt,
      personId,
      requestId: taskId,
      title: "Call Ada",
    }),
    headers,
    method: "POST",
  });
  const listed = await app.request(
    `http://localhost/api/v1/tasks?status=open&personId=${personId}&limit=20`,
    { headers },
  );
  const changed = await app.request(`http://localhost/api/v1/tasks/${taskId}`, {
    body: JSON.stringify({
      expectedUpdatedAt: task.updatedAt,
      title: "Call Ada tomorrow",
    }),
    headers,
    method: "PATCH",
  });
  const completed = await app.request(
    `http://localhost/api/v1/tasks/${taskId}/completion`,
    { body: JSON.stringify({ completed: true }), headers, method: "PUT" },
  );
  const today = await app.request("http://localhost/api/v1/today/tasks", {
    headers,
  });
  assert(created.status === 201, `create returned ${created.status}`);
  assert(
    listed.status === 200 && changed.status === 200,
    "task list/change failed",
  );
  assert(completed.status === 200, "idempotent completion failed");
  assert(today.status === 200, "Today task projection failed");
  assert(received.length === 3, "task inputs were not forwarded");
});

Deno.test("PLANNING-001 HTTP maps security, archive, tenant, stale, and outage states", async () => {
  for (
    const [status, expected] of [
      ["forbidden", 403],
      ["not-found", 404],
      ["archived-write-rejected", 409],
      ["stale", 409],
      ["idempotency-conflict", 409],
    ] as const
  ) {
    const response = await createPlanningRoutes(services({
      create: () => Promise.resolve({ status }),
    })).request("http://localhost/api/v1/tasks", {
      body: JSON.stringify({ requestId: taskId, title: "Call Ada" }),
      headers,
      method: "POST",
    });
    assert(
      response.status === expected,
      `${status} mapped to ${response.status}`,
    );
  }
  const badOrigin = await createPlanningRoutes(services()).request(
    "http://localhost/api/v1/tasks",
    {
      body: JSON.stringify({ requestId: taskId, title: "Call Ada" }),
      headers: { ...headers, origin: "http://attacker.test" },
      method: "POST",
    },
  );
  assert(badOrigin.status === 403, "cross-origin task mutation was accepted");
  const noSession = await createPlanningRoutes({
    ...services(),
    protectedSessions: { resolve: () => Promise.resolve(undefined) },
  }).request("http://localhost/api/v1/tasks", { headers });
  assert(noSession.status === 401, "task list accepted a missing session");
  const outage = await createPlanningRoutes(services({
    list: () => Promise.reject(new Error("offline")),
  })).request("http://localhost/api/v1/tasks", { headers });
  assert(outage.status === 503, "task outage was concealed");
});

Deno.test("PLANNING-001 HTTP rejects loose payloads and isolates Today outages", async () => {
  const app = createPlanningRoutes({
    ...services(),
    todayTasks: {
      getDueTasks: () => Promise.reject(new Error("offline")),
    } as TodayTasks,
  });
  const invalid = await app.request("http://localhost/api/v1/tasks", {
    body: JSON.stringify({ requestId: taskId, title: "Call Ada", extra: true }),
    headers,
    method: "POST",
  });
  const emptyPatch = await app.request(
    `http://localhost/api/v1/tasks/${taskId}`,
    {
      body: JSON.stringify({ expectedUpdatedAt: task.updatedAt }),
      headers,
      method: "PATCH",
    },
  );
  const today = await app.request("http://localhost/api/v1/today/tasks", {
    headers,
  });
  const tasks = await app.request("http://localhost/api/v1/tasks", { headers });
  assert(
    invalid.status === 400 && emptyPatch.status === 400,
    "loose task payload was accepted",
  );
  assert(
    today.status === 503 && tasks.status === 200,
    "Today outage blanked task list",
  );
});

Deno.test("PLANNING-001 HTTP forwards task continuation and rejects stale cursors", async () => {
  const received: unknown[] = [];
  const app = createPlanningRoutes(services({
    list: ((_actor, input) => {
      received.push(input);
      return Promise.resolve({
        items: [task],
        nextCursor: "next-task-cursor",
        status: "ready",
      });
    }) as TaskManagement["list"],
  }));
  const page = await app.request(
    "http://localhost/api/v1/tasks?limit=1&status=open&cursor=signed-task-cursor",
    { headers },
  );
  const pageBody = await page.json() as { readonly nextCursor?: string };
  assert(
    page.status === 200 && pageBody.nextCursor === "next-task-cursor" &&
      (received[0] as { readonly cursor?: string }).cursor ===
        "signed-task-cursor",
    "task continuation was rejected or not forwarded",
  );
  const stale = await createPlanningRoutes(services({
    list: (() =>
      Promise.resolve({ status: "stale-cursor" })) as unknown as TaskManagement[
        "list"
      ],
  })).request(
    "http://localhost/api/v1/tasks?cursor=stale-signed-task-cursor",
    { headers },
  );
  const staleBody = await stale.json() as { readonly code?: string };
  assert(
    stale.status === 409 && staleBody.code === "task_cursor_stale",
    "stale task cursor was not explicit",
  );
});
