import type {
  ReminderManagement,
  TaskManagement,
} from "../../packages/backend/modules/planning/public.ts";
import type {
  TodayReminders,
  TodayTasks,
} from "../../packages/backend/read-models/today/public.ts";
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

Deno.test("PLANNING-002 HTTP creates and lists reminders/cadences and exposes Today state", async () => {
  const reminder = {
    anchorOn: "2026-10-25",
    createdAt: "2026-08-18T10:00:00.000000Z",
    id: crypto.randomUUID(),
    isActive: true,
    nextOccurrence: {
      attemptCount: 0,
      deliverAt: "2026-10-25T00:30:00.000000Z",
      id: crypto.randomUUID(),
      occursOn: "2026-10-25",
      status: "pending" as const,
    },
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "year" as const,
    sendTime: "02:30:00",
    title: "Birthday call",
    updatedAt: "2026-08-18T10:00:00.000000Z",
  };
  const cadence = {
    id: crypto.randomUUID(),
    intervalCount: 1,
    intervalUnit: "month" as const,
    isActive: true,
    nextDueAt: "2026-09-18T10:00:00.000000Z",
    personId,
    updatedAt: "2026-08-18T10:00:00.000000Z",
  };
  const reminders = {
    createCadence: () =>
      Promise.resolve({ cadence, status: "created" as const }),
    createReminder: () =>
      Promise.resolve({ reminder, status: "created" as const }),
    interactionRecorded: () => Promise.resolve(),
    listPerson: () =>
      Promise.resolve({
        cadences: [cadence],
        reminders: [reminder],
        status: "ready" as const,
      }),
    setActive: () =>
      Promise.resolve({
        reminder: { ...reminder, isActive: false },
        status: "saved" as const,
      }),
    timezoneChanged: () => Promise.resolve(),
    workspaceTimezoneChanged: () => Promise.resolve(),
  } as ReminderManagement;
  const app = createPlanningRoutes({
    ...services(),
    reminders,
    todayReminders: {
      get: () =>
        Promise.resolve({
          cadences: [],
          reminders: [],
          status: "ready" as const,
          timezone: "Europe/Belgrade",
        }),
    } as TodayReminders,
  });
  const created = await app.request("http://localhost/api/v1/reminders", {
    body: JSON.stringify({
      anchorOn: reminder.anchorOn,
      personId,
      recurrenceInterval: 1,
      recurrenceUnit: "year",
      requestId: crypto.randomUUID(),
      sendTime: "02:30",
      title: reminder.title,
    }),
    headers,
    method: "POST",
  });
  const cadenceResponse = await app.request(
    "http://localhost/api/v1/stay-in-touch-cadences",
    {
      body: JSON.stringify({
        intervalCount: 1,
        intervalUnit: "month",
        personId,
        requestId: crypto.randomUUID(),
      }),
      headers,
      method: "POST",
    },
  );
  const listed = await app.request(
    `http://localhost/api/v1/people/${personId}/reminders`,
    { headers },
  );
  const today = await app.request("http://localhost/api/v1/today/reminders", {
    headers,
  });
  const disabled = await app.request(
    `http://localhost/api/v1/reminders/${reminder.id}/active`,
    {
      body: JSON.stringify({ active: false }),
      headers,
      method: "PUT",
    },
  );
  assert(
    created.status === 201 && cadenceResponse.status === 201,
    "reminder or cadence create failed",
  );
  assert(
    listed.status === 200 && today.status === 200 && disabled.status === 200,
    "reminder projections or disable failed",
  );
});

Deno.test("PLANNING-002 HTTP preserves origin, archive, and independent outage boundaries", async () => {
  const reminders = {
    createCadence: () =>
      Promise.resolve({ status: "archived-write-rejected" as const }),
    createReminder: () =>
      Promise.resolve({ status: "archived-write-rejected" as const }),
    interactionRecorded: () => Promise.resolve(),
    listPerson: () => Promise.reject(new Error("offline")),
    setActive: () => Promise.resolve({ status: "not-found" as const }),
  } as unknown as ReminderManagement;
  const app = createPlanningRoutes({ ...services(), reminders });
  const archived = await app.request("http://localhost/api/v1/reminders", {
    body: JSON.stringify({
      anchorOn: "2026-10-25",
      personId,
      recurrenceInterval: 1,
      recurrenceUnit: "year",
      requestId: crypto.randomUUID(),
      sendTime: "02:30",
      title: "Birthday call",
    }),
    headers,
    method: "POST",
  });
  const badOrigin = await app.request(
    "http://localhost/api/v1/stay-in-touch-cadences",
    {
      body: JSON.stringify({
        intervalCount: 1,
        intervalUnit: "month",
        personId,
        requestId: crypto.randomUUID(),
      }),
      headers: { ...headers, origin: "http://attacker.test" },
      method: "POST",
    },
  );
  const outage = await app.request(
    `http://localhost/api/v1/people/${personId}/reminders`,
    { headers },
  );
  const tasks = await app.request("http://localhost/api/v1/tasks", { headers });
  assert(
    archived.status === 409 && badOrigin.status === 403,
    "reminder write boundary failed",
  );
  assert(
    outage.status === 503 && tasks.status === 200,
    "reminder outage blanked another planning region",
  );
});
