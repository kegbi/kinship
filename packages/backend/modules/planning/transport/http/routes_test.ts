import type { ReminderManagement, TaskManagement } from "../../public.ts";
import type {
  TodayAttention,
  TodayReminders,
  TodayTasks,
} from "../../../../read-models/today/public.ts";
import { createPlanningRoutes } from "./routes.ts";
import { assert, assertStatus } from "../../../../testing/assert.ts";
import * as fixtures from "../../../../testing/fixtures.ts";

const taskId = "00000000-0000-4000-8000-000000000900";
const personId = fixtures.personId();
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
const actor = fixtures.sessionActor({ workspaceName: "Circle" });

function services(overrides: Partial<TaskManagement> = {}) {
  const tasks = {
    get: () => Promise.resolve({ status: "ready" as const, task }),
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

Deno.test("task automation grants independently admit token-only reads, creates and edits", async () => {
  const calls: string[] = [];
  const current = {
    ...services(),
    apiTokens: {
      authenticate: (token: string, scope: string) => {
        calls.push(scope);
        return Promise.resolve(
          token === scope
            ? {
              actor,
              status: "authenticated" as const,
              tokenId: "00000000-0000-4000-8000-0000000000aa",
            }
            : { status: "invalid" as const },
        );
      },
    },
    tasks: {
      ...services().tasks,
      get: () => Promise.resolve({ status: "ready" as const, task }),
    },
  };
  const app = createPlanningRoutes(current);
  const requests = [
    ["GET", "/api/v1/tasks", "tasks:read", undefined],
    ["GET", `/api/v1/tasks/${taskId}`, "tasks:read", undefined],
    ["POST", "/api/v1/tasks", "tasks:create", {
      requestId: taskId,
      title: "Call Ada",
    }],
    ["PATCH", `/api/v1/tasks/${taskId}`, "tasks:write", {
      expectedUpdatedAt: task.updatedAt,
      description: null,
      dueAt: null,
    }],
    ["PUT", `/api/v1/tasks/${taskId}/completion`, "tasks:write", {
      completed: false,
    }],
  ] as const;
  for (const [method, path, grant, body] of requests) {
    const send = (authorization: string, cookie?: string) =>
      app.request(`http://localhost${path}`, {
        method,
        headers: {
          authorization,
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const accepted = await send(`Bearer ${grant}`);
    assertStatus(
      accepted,
      method === "POST" ? 201 : 200,
      `${method} ${path} bearer-only`,
    );
    assert(
      accepted.headers.get("cache-control") === "private, no-store",
      "task response is private",
    );
    for (
      const wrong of [
        "tasks:read",
        "tasks:create",
        "tasks:write",
        "people:read",
      ].filter((scope) => scope !== grant)
    ) {
      assertStatus(
        await send(`Bearer ${wrong}`, headers.cookie),
        401,
        "a wrong grant never borrows cookies",
      );
    }
    for (
      const invalid of [
        "",
        "Basic token",
        "Bearer malformed",
        "Bearer expired",
        "Bearer revoked",
      ]
    ) {
      assertStatus(
        await send(invalid, headers.cookie),
        401,
        "a present invalid credential never borrows cookies",
      );
    }
    if (method !== "GET") {
      for (const origin of [undefined, "http://attacker.test"]) {
        assertStatus(
          await app.request(`http://localhost${path}`, {
            method,
            headers: {
              cookie: headers.cookie,
              "content-type": "application/json",
              ...(origin ? { origin } : {}),
            },
            body: JSON.stringify(body),
          }),
          403,
          "cookie writes require the exact Origin",
        );
      }
    }
  }
  assert(
    calls.includes("tasks:create") && calls.includes("tasks:write") &&
      calls.includes("tasks:read"),
    "each grant checked explicitly",
  );
  assertStatus(
    await createPlanningRoutes(services()).request(
      "http://localhost/api/v1/tasks",
      {
        headers: {
          authorization: "Bearer unavailable",
          cookie: headers.cookie,
        },
      },
    ),
    401,
    "missing token authority cannot borrow cookie",
  );
  assertStatus(
    await createPlanningRoutes({
      ...current,
      apiTokens: { authenticate: () => Promise.reject(new Error("offline")) },
    }).request("http://localhost/api/v1/tasks", {
      headers: { authorization: "Bearer valid", cookie: headers.cookie },
    }),
    401,
    "token outage cannot borrow cookie",
  );
  for (
    const path of [
      "/api/v1/today/tasks",
      "/api/v1/today/attention",
      `/api/v1/people/${personId}/reminders`,
    ]
  ) {
    const response = await app.request(`http://localhost${path}`, {
      headers: { authorization: "Bearer tasks:read" },
    });
    assert(
      response.status !== 200,
      "unrelated planning routes remain session-only",
    );
  }
});

Deno.test("task detail reuses get and filtered listing forwards dueBefore", async () => {
  const seen: unknown[] = [];
  const detailServices = {
    ...services(),
    tasks: {
      ...services({
        list: (_actor, input) => {
          seen.push(input);
          return Promise.resolve({ status: "ready", items: [] });
        },
      }).tasks,
      get: (_actor: unknown, id: string) => {
        seen.push(id);
        return Promise.resolve({ status: "ready" as const, task });
      },
    },
  };
  const app = createPlanningRoutes(detailServices);
  assertStatus(
    await app.request(`http://localhost/api/v1/tasks/${taskId}`, { headers }),
    200,
  );
  const dueBefore = "2026-10-25T12:00:00+02:00";
  assertStatus(
    await app.request(
      `http://localhost/api/v1/tasks?dueBefore=${
        encodeURIComponent(dueBefore)
      }&limit=1&cursor=bound`,
      { headers },
    ),
    200,
  );
  assert(
    seen[0] === taskId &&
      (seen[1] as { dueBefore?: string }).dueBefore === dueBefore,
    "existing use cases receive detail ID and instant",
  );
  assertStatus(
    await app.request("http://localhost/api/v1/tasks?dueBefore=2026-10-25", {
      headers,
    }),
    400,
  );
  assertStatus(
    await app.request("http://localhost/api/v1/tasks/invalid", { headers }),
    400,
  );
  for (
    const [status, expected] of [["forbidden", 403], ["not-found", 404], [
      "validation-error",
      400,
    ]] as const
  ) {
    const tasks = {
      ...services().tasks,
      get: () => Promise.resolve({ status }),
    };
    assertStatus(
      await createPlanningRoutes({ ...services(), tasks }).request(
        `http://localhost/api/v1/tasks/${taskId}`,
        { headers },
      ),
      expected,
    );
  }
  const tasks = {
    ...services().tasks,
    get: () => Promise.reject(new Error("offline")),
  };
  assertStatus(
    await createPlanningRoutes({ ...services(), tasks }).request(
      `http://localhost/api/v1/tasks/${taskId}`,
      { headers },
    ),
    503,
  );
});

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
  assertStatus(created, 201);
  assert(
    listed.status === 200 && changed.status === 200,
    "task list/change failed",
  );
  assertStatus(completed, 200, "idempotent completion failed");
  assertStatus(today, 200, "Today task projection failed");
  assert(received.length === 3, "task inputs were not forwarded");
});

Deno.test("TODAY-001 HTTP returns only a closed bounded attention projection", async () => {
  const value = {
    attention: {
      nextSevenDays: [],
      overdue: [{
        dueAt: task.dueAt,
        id: task.id,
        kind: "task" as const,
        person: task.person,
        title: task.title,
      }],
      today: [{
        dueAt: task.dueAt,
        id: crypto.randomUUID(),
        kind: "important-date" as const,
        occursOn: "2026-08-18",
        person: task.person,
        title: "Ada's birthday",
      }, {
        dueAt: task.dueAt,
        id: crypto.randomUUID(),
        kind: "life-event" as const,
        occursOn: "2026-08-18",
        person: task.person,
        title: "Ada moved",
      }],
    },
    date: "2026-08-18",
    status: "ready" as const,
    timezone: "Europe/Belgrade",
    upcoming: [],
  };
  const app = createPlanningRoutes({
    ...services(),
    todayAttention: { get: () => Promise.resolve(value) } as TodayAttention,
  });
  const forbiddenApp = createPlanningRoutes({
    ...services(),
    todayAttention: {
      get: () => Promise.resolve({ status: "forbidden" }),
    } as TodayAttention,
  });
  const ready = await app.request(
    "http://localhost/api/v1/today/attention",
    { headers },
  );
  const forbidden = await forbiddenApp.request(
    "http://localhost/api/v1/today/attention",
    { headers },
  );
  const body = await ready.json() as {
    readonly attention?: {
      readonly today?: readonly { readonly kind?: string }[];
    };
  };
  assert(
    ready.status === 200 && forbidden.status === 403 &&
      body.attention?.today?.[0]?.kind === "important-date" &&
      body.attention?.today?.[1]?.kind === "life-event",
    `attention returned ${ready.status}/${forbidden.status}`,
  );
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
  assertStatus(badOrigin, 403, "cross-origin task mutation was accepted");
  const noSession = await createPlanningRoutes({
    ...services(),
    protectedSessions: { resolve: () => Promise.resolve(undefined) },
  }).request("http://localhost/api/v1/tasks", { headers });
  assertStatus(noSession, 401, "task list accepted a missing session");
  const outage = await createPlanningRoutes(services({
    list: () => Promise.reject(new Error("offline")),
  })).request("http://localhost/api/v1/tasks", { headers });
  assertStatus(outage, 503, "task outage was concealed");
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
    acknowledgeOccurrence: () =>
      Promise.resolve({ status: "not-found" as const }),
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
    deliveryChanged: () => Promise.resolve(),
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
          reminders: [{
            attemptCount: 1,
            deliverAt: reminder.nextOccurrence!.deliverAt,
            id: reminder.nextOccurrence!.id,
            nextAttemptAt: "2026-10-25T01:30:00.000000Z",
            person: { archived: false, id: personId, name: "Ada Lovelace" },
            status: "retry" as const,
            title: reminder.title,
          }],
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
  const todayBody = await today.json() as {
    readonly reminders?: readonly { readonly nextAttemptAt?: string }[];
  };
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
    listed.status === 200 && today.status === 200 && disabled.status === 200 &&
      todayBody.reminders?.[0]?.nextAttemptAt ===
        "2026-10-25T01:30:00.000000Z",
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

Deno.test("PLANNING-002 HTTP degrades each absent region without touching the others", async () => {
  const app = createPlanningRoutes(services());
  const writes = [
    {
      body: JSON.stringify({
        anchorOn: "2026-10-25",
        personId,
        recurrenceInterval: 1,
        recurrenceUnit: "year",
        requestId: crypto.randomUUID(),
        sendTime: "02:30",
        title: "Birthday call",
      }),
      code: "reminders_unavailable",
      detail: "Nothing was saved.",
      method: "POST",
      path: "http://localhost/api/v1/reminders",
    },
    {
      body: JSON.stringify({
        intervalCount: 1,
        intervalUnit: "month",
        personId,
        requestId: crypto.randomUUID(),
      }),
      code: "reminders_unavailable",
      detail: "Nothing was saved.",
      method: "POST",
      path: "http://localhost/api/v1/stay-in-touch-cadences",
    },
    {
      body: JSON.stringify({ active: false }),
      code: "reminders_unavailable",
      detail: "Nothing was changed.",
      method: "PUT",
      path: `http://localhost/api/v1/reminders/${taskId}/active`,
    },
  ];
  for (const write of writes) {
    const response = await app.request(write.path, {
      body: write.body,
      headers,
      method: write.method,
    });
    const body = await response.json() as {
      readonly code: string;
      readonly detail: string;
    };
    assertStatus(response, 503, `${write.method} ${write.path}`);
    assert(
      body.code === write.code && body.detail === write.detail,
      `${write.method} ${write.path} says what was not saved`,
    );
    const foreign = await app.request(write.path, {
      body: write.body,
      headers: { ...headers, origin: "http://attacker.test" },
      method: write.method,
    });
    assertStatus(
      foreign,
      503,
      `${write.method} ${write.path} reports the outage before the origin`,
    );
  }

  const listed = await app.request(
    `http://localhost/api/v1/people/${personId}/reminders`,
    { headers },
  );
  const badPerson = await app.request(
    "http://localhost/api/v1/people/not-a-uuid/reminders",
    { headers },
  );
  const todayReminders = await app.request(
    "http://localhost/api/v1/today/reminders",
    { headers },
  );
  const attention = await app.request(
    "http://localhost/api/v1/today/attention",
    { headers },
  );
  assertStatus(listed, 503, "the person reminder section degrades");
  assert(
    (await listed.json() as { readonly detail: string }).detail ===
      "Other person sections remain available.",
    "and says the rest of the person is still there",
  );
  assertStatus(badPerson, 503, "an outage outranks an unparsable person");
  assertStatus(todayReminders, 503, "the Today reminder region degrades");
  assertStatus(attention, 503, "the Today attention region degrades");
  assertStatus(
    await app.request("http://localhost/api/v1/tasks", { headers }),
    200,
    "and tasks are unaffected",
  );
});

Deno.test("PLANNING-002 HTTP refuses a malformed reminder, cadence, and active state", async () => {
  const reminders = {
    createCadence: () => Promise.resolve({ status: "created" as const }),
    createReminder: () => Promise.resolve({ status: "created" as const }),
    interactionRecorded: () => Promise.resolve(),
    listPerson: () => Promise.resolve({ status: "ready" as const }),
    setActive: () => Promise.resolve({ status: "saved" as const }),
  } as unknown as ReminderManagement;
  const app = createPlanningRoutes({ ...services(), reminders });
  const refusals = [
    {
      body: JSON.stringify({ title: "Birthday call" }),
      code: "reminder_request_invalid",
      method: "POST",
      path: "http://localhost/api/v1/reminders",
    },
    {
      body: JSON.stringify({ intervalUnit: "fortnight" }),
      code: "cadence_request_invalid",
      method: "POST",
      path: "http://localhost/api/v1/stay-in-touch-cadences",
    },
    {
      body: JSON.stringify({ active: "maybe" }),
      code: "reminder_request_invalid",
      method: "PUT",
      path: `http://localhost/api/v1/reminders/${taskId}/active`,
    },
  ];
  for (const refusal of refusals) {
    const response = await app.request(refusal.path, {
      body: refusal.body,
      headers,
      method: refusal.method,
    });
    const body = await response.json() as { readonly code: string };
    assertStatus(response, 400, `${refusal.method} ${refusal.path}`);
    assert(
      body.code === refusal.code,
      `${refusal.method} ${refusal.path} reports ${refusal.code}`,
    );
  }
  const badPerson = await app.request(
    "http://localhost/api/v1/people/not-a-uuid/reminders",
    { headers },
  );
  assertStatus(badPerson, 400, "an unparsable person is a rejected query");
  assert(
    (await badPerson.json() as { readonly code: string }).code ===
      "reminder_query_invalid",
    "and says so",
  );
});

Deno.test("[GAP-023] HTTP pages a person's reminders and bounds every list", async () => {
  const received: unknown[] = [];
  const reminders = {
    listPerson: (_actor: unknown, _personId: string, input: unknown) => {
      received.push(input);
      return Promise.resolve(
        (input as { readonly cursor?: string }).cursor === "foreign"
          ? { status: "validation-error" as const }
          : {
            cadences: [],
            nextCursor: "next-reminder-page",
            reminders: [],
            status: "ready" as const,
          },
      );
    },
  } as unknown as ReminderManagement;
  const app = createPlanningRoutes({ ...services(), reminders });
  const path = `http://localhost/api/v1/people/${personId}/reminders`;
  const first = await app.request(path, { headers });
  const body = await first.json() as { readonly nextCursor?: string };
  assert(
    first.status === 200 && body.nextCursor === "next-reminder-page",
    "the reminder continuation was not published",
  );
  const second = await app.request(`${path}?limit=4&cursor=resume`, {
    headers,
  });
  assert(second.status === 200, "a continued reminder page was refused");
  assert(
    JSON.stringify(received) ===
      JSON.stringify([{ limit: 20 }, { cursor: "resume", limit: 4 }]),
    "the default and the requested page reached the use case",
  );
  for (const query of ["limit=0", "limit=51", "cursor=foreign"]) {
    const refused = await app.request(`${path}?${query}`, { headers });
    assert(
      refused.status === 400 &&
        (await refused.json() as { readonly code?: string }).code ===
          "reminder_query_invalid",
      `${query} was not refused as a reminder query`,
    );
  }
  const taskInputs: unknown[] = [];
  const tasks = createPlanningRoutes(services({
    list: ((_actor, input) => {
      taskInputs.push(input);
      return Promise.resolve({ items: [], status: "ready" });
    }) as TaskManagement["list"],
  }));
  const defaulted = await tasks.request("http://localhost/api/v1/tasks", {
    headers,
  });
  const widest = await tasks.request("http://localhost/api/v1/tasks?limit=50", {
    headers,
  });
  const tooWide = await tasks.request(
    "http://localhost/api/v1/tasks?limit=51",
    { headers },
  );
  assert(
    defaulted.status === 200 && widest.status === 200 &&
      (taskInputs[0] as { readonly limit?: number }).limit === 20 &&
      (taskInputs[1] as { readonly limit?: number }).limit === 50,
    "the task page did not default to twenty and accept fifty",
  );
  assert(
    tooWide.status === 400 &&
      (await tooWide.json() as { readonly code?: string }).code ===
        "task_query_invalid",
    "a task page beyond fifty was accepted",
  );
});

Deno.test("[AUD-W3] HTTP answers a person's reminders for an unknown person with 404 person_not_found", async () => {
  const reminders = {
    listPerson: () => Promise.resolve({ status: "not-found" as const }),
  } as unknown as ReminderManagement;
  const app = createPlanningRoutes({ ...services(), reminders });
  const answered = await app.request(
    `http://localhost/api/v1/people/${personId}/reminders`,
    { headers },
  );
  const problem = await answered.json() as { readonly code?: string };
  assert(
    answered.status === 404 && problem.code === "person_not_found",
    `an unknown person's reminders answered ${answered.status} ${problem.code}`,
  );
});

Deno.test("[PLANNING-003] REL-088 HTTP acknowledges an undelivered reminder and refuses everything else", async () => {
  const occurrenceId = crypto.randomUUID();
  const asked: unknown[] = [];
  let answer: Awaited<ReturnType<ReminderManagement["acknowledgeOccurrence"]>> =
    { occurrenceId, status: "acknowledged" };
  const reminders = {
    acknowledgeOccurrence: (
      current: { readonly memberId: string; readonly workspaceId: string },
      id: string,
    ) => {
      asked.push([current.memberId, current.workspaceId, id]);
      return Promise.resolve(answer);
    },
  } as unknown as ReminderManagement;
  const app = createPlanningRoutes({ ...services(), reminders });
  const path =
    `http://localhost/api/v1/reminder-occurrences/${occurrenceId}/acknowledgement`;
  const put = (init: RequestInit = {}, at = path) =>
    app.request(at, { headers, method: "PUT", ...init });
  const code = async (response: Response) =>
    (await response.json() as { readonly code?: string }).code;

  const acknowledged = await put();
  assertStatus(acknowledged, 200, "an undelivered reminder was acknowledged");
  assert(
    JSON.stringify(await acknowledged.json()) ===
        JSON.stringify({ occurrenceId, status: "acknowledged" }) &&
      acknowledged.headers.get("Cache-Control") === "private, no-store",
    "the acknowledgement answer is not the contract's",
  );
  assert(
    JSON.stringify(asked) ===
      JSON.stringify([[actor.memberId, actor.workspaceId, occurrenceId]]),
    `the use case was asked ${JSON.stringify(asked)}`,
  );

  answer = { status: "not-found" };
  const foreign = await put();
  assertStatus(foreign, 404, "another member's or workspace's occurrence");
  assert(await code(foreign) === "reminder_not_found", "and says so");

  answer = { status: "stale" };
  const stale = await put();
  assertStatus(stale, 409, "an occurrence that is not undelivered");
  assert(await code(stale) === "reminder_occurrence_stale", "and says so");

  answer = { status: "forbidden" };
  const forbidden = await put();
  assertStatus(forbidden, 403, "a revoked member");
  assert(await code(forbidden) === "reminders_forbidden", "and says so");

  const calls = asked.length;
  const badOrigin = await put({
    headers: { ...headers, origin: "http://attacker.test" },
  });
  assertStatus(badOrigin, 403, "a foreign origin");
  const badId = await put(
    {},
    "http://localhost/api/v1/reminder-occurrences/not-a-uuid/acknowledgement",
  );
  assertStatus(badId, 400, "an unparsable occurrence");
  assert(await code(badId) === "reminder_request_invalid", "and says so");
  assert(asked.length === calls, "a refused request reached the use case");

  const failing = createPlanningRoutes({
    ...services(),
    reminders: {
      acknowledgeOccurrence: () => Promise.reject(new Error("offline")),
    } as unknown as ReminderManagement,
  });
  const outage = await failing.request(path, { headers, method: "PUT" });
  const missing = await createPlanningRoutes(services()).request(path, {
    headers,
    method: "PUT",
  });
  for (const response of [outage, missing]) {
    assertStatus(response, 503, "an unavailable reminders service");
    assert(
      (await response.json() as { readonly detail?: string }).detail ===
        "Nothing was changed.",
      "and says nothing changed",
    );
  }
});
