import { buildOpenApiDocument } from "./document.ts";
import type {
  Task,
  TaskChangeInput,
  TaskCreateInput,
} from "../../packages/contracts/generated/auth-client.ts";
import * as generatedClient from "../../packages/contracts/generated/auth-client.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("PLANNING-001 OpenAPI keeps task mutation and projection boundaries strict", () => {
  const document = buildOpenApiDocument() as unknown as {
    readonly paths: Readonly<
      Record<string, {
        readonly get?: {
          readonly parameters?: readonly { readonly name?: string }[];
        };
      }>
    >;
    readonly components: {
      readonly schemas: Readonly<
        Record<string, {
          readonly additionalProperties?: boolean;
          readonly oneOf?: readonly unknown[];
          readonly properties?: Readonly<
            Record<string, {
              readonly type?: string;
              readonly items?: { readonly $ref?: string };
              readonly maxItems?: number;
            }>
          >;
          readonly required?: readonly string[];
        }>
      >;
    };
  };
  for (
    const path of [
      "/api/v1/tasks",
      "/api/v1/tasks/{taskId}",
      "/api/v1/tasks/{taskId}/completion",
      "/api/v1/today/tasks",
    ]
  ) assert(Boolean(document.paths[path]), `${path} is not versioned`);
  for (
    const schema of [
      "TaskCreateInput",
      "TaskChangeInput",
      "TaskCompletionInput",
      "Task",
    ]
  ) {
    assert(
      document.components.schemas[schema]?.additionalProperties === false,
      `${schema} is not closed`,
    );
  }
  assert(
    document.components.schemas.TaskList?.properties?.items?.maxItems === 100 &&
      document.components.schemas.TaskList?.properties?.nextCursor?.type ===
        "string" &&
      document.components.schemas.TodayTasks?.properties?.items?.maxItems ===
        20 &&
      document.components.schemas.TodayTasks?.properties?.items?.items?.$ref ===
        "#/components/schemas/Task",
    "task projections are not bounded and shared",
  );
  assert(
    document.paths["/api/v1/tasks"]?.get?.parameters?.some((parameter) =>
      parameter.name === "cursor"
    ) &&
      document.components.schemas.TaskPerson?.properties?.unavailable?.type ===
        "boolean",
    "task continuation or unavailable-person projection is undocumented",
  );
  assert(
    document.components.schemas.TaskCreateInput?.required?.includes(
      "requestId",
    ) &&
      document.components.schemas.TaskChangeInput?.required?.includes(
        "expectedUpdatedAt",
      ),
    "task idempotency or optimistic change input is undocumented",
  );
  const create: TaskCreateInput = {
    personId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    title: "Call Ada",
  };
  const change: TaskChangeInput = {
    dueAt: null,
    expectedUpdatedAt: new Date().toISOString(),
    status: "cancelled",
  };
  const task = {
    createdAt: new Date().toISOString(),
    id: crypto.randomUUID(),
    status: "open",
    title: create.title,
    updatedAt: new Date().toISOString(),
  } satisfies Task;
  const unavailableTask = {
    ...task,
    person: {
      archived: true,
      id: crypto.randomUUID(),
      name: "Deleted/Unavailable person",
      unavailable: true,
    },
  } satisfies Task;
  assert(
    change.status === "cancelled" && task.status === "open" &&
      unavailableTask.person.unavailable,
    "compile fixtures lost",
  );
});

Deno.test("PLANNING-002 OpenAPI exposes bounded reminder and cadence contracts", () => {
  const document = buildOpenApiDocument() as unknown as {
    readonly paths: Readonly<Record<string, unknown>>;
    readonly components: {
      readonly schemas: Readonly<
        Record<string, {
          readonly additionalProperties?: boolean;
          readonly oneOf?: readonly unknown[];
          readonly properties?: Readonly<
            Record<string, {
              readonly maxItems?: number;
              readonly type?: string;
            }>
          >;
          readonly required?: readonly string[];
        }>
      >;
    };
  };
  for (
    const path of [
      "/api/v1/reminders",
      "/api/v1/reminders/{reminderId}/active",
      "/api/v1/stay-in-touch-cadences",
      "/api/v1/people/{personId}/reminders",
      "/api/v1/today/reminders",
    ]
  ) assert(Boolean(document.paths[path]), `${path} is not versioned`);
  for (
    const schema of [
      "ReminderCreateInput",
      "CadenceCreateInput",
      "Reminder",
      "ReminderOccurrence",
      "TodayReminders",
    ]
  ) {
    assert(
      document.components.schemas[schema]?.additionalProperties === false,
      `${schema} is not closed`,
    );
  }
  assert(
    document.components.schemas.ReminderCreateInput?.required?.includes(
      "requestId",
    ) &&
      document.components.schemas.CadenceCreateInput?.required?.includes(
        "requestId",
      ) &&
      document.components.schemas.TodayReminders?.properties?.reminders
          ?.maxItems === 100 &&
      document.components.schemas.TodayReminders?.properties?.cadences
          ?.maxItems === 100 &&
      document.components.schemas.TodayReminderItem?.properties?.nextAttemptAt
          ?.type === "string" &&
      document.components.schemas.TodayReminderItem?.oneOf?.length === 2,
    "reminder idempotency or Today bounds are undocumented",
  );
  const todayPerson = document.components.schemas.TodayReminderPerson;
  const reminderPerson = document.components.schemas.TodayReminderItem
    ?.properties?.person as { readonly $ref?: string } | undefined;
  const cadencePerson = document.components.schemas.TodayCadenceItem
    ?.properties?.person as { readonly $ref?: string } | undefined;
  assert(
    todayPerson?.additionalProperties === false &&
      todayPerson.required?.includes("archived") &&
      todayPerson.required.includes("id") &&
      todayPerson.required.includes("name") &&
      reminderPerson?.$ref ===
        "#/components/schemas/TodayReminderPerson" &&
      cadencePerson?.$ref === "#/components/schemas/TodayReminderPerson",
    "Today reminder person contract omits the archived lifecycle field",
  );
  const actualTodayPerson = {
    archived: true,
    id: crypto.randomUUID(),
    name: "Archived person",
  };
  const allowed = new Set(Object.keys(todayPerson.properties ?? {}));
  assert(
    todayPerson.required?.every((key) => key in actualTodayPerson) &&
      Object.keys(actualTodayPerson).every((key) => allowed.has(key)),
    "an actual Today person response does not satisfy its closed schema",
  );
});

Deno.test("PLANNING-002 generated client rejects loose Today reminder responses", () => {
  const parse = (generatedClient as unknown as {
    readonly parseTodayReminders?: (value: unknown) => unknown;
  }).parseTodayReminders;
  assert(
    typeof parse === "function",
    "Today reminder runtime validator is missing",
  );
  const valid = {
    cadences: [{
      dueAt: "2026-09-18T10:00:00.000000Z",
      id: crypto.randomUUID(),
      person: { archived: true, id: crypto.randomUUID(), name: "Ada" },
    }],
    reminders: [{
      attemptCount: 0,
      deliverAt: "2026-09-18T09:00:00.000000Z",
      id: crypto.randomUUID(),
      person: { archived: true, id: crypto.randomUUID(), name: "Ada" },
      status: "pending",
      title: "Birthday",
    }],
    status: "ready",
    timezone: "Europe/Belgrade",
  };
  parse(valid);
  parse({
    ...valid,
    reminders: [{
      ...valid.reminders[0],
      deliverAt: "2026-09-18T11:00:00.123456+02:00",
    }],
  });
  for (
    const status of [
      "pending",
      "claimed",
      "sent",
      "failed",
      "manual_attention",
    ]
  ) {
    parse({
      ...valid,
      reminders: [{ ...valid.reminders[0], status }],
    });
  }
  parse({
    ...valid,
    reminders: [{
      ...valid.reminders[0],
      nextAttemptAt: "2026-09-18T12:00:00.000000Z",
      status: "retry",
    }],
  });
  for (
    const invalid of [
      { ...valid, timezone: undefined },
      { ...valid, timezone: "Definitely/Not_A_Zone" },
      { ...valid, unexpected: true },
      {
        ...valid,
        reminders: [{
          ...valid.reminders[0],
          person: { id: crypto.randomUUID(), name: "Ada" },
        }],
      },
      {
        ...valid,
        cadences: [{
          ...valid.cadences[0]!,
          person: { ...valid.cadences[0]!.person, extra: true },
        }],
      },
      {
        ...valid,
        reminders: [{ ...valid.reminders[0], deliverAt: "2026-09-18" }],
      },
      {
        ...valid,
        reminders: [{ ...valid.reminders[0], status: "retry" }],
      },
      {
        ...valid,
        reminders: [{ ...valid.reminders[0], status: "cancelled" }],
      },
      {
        ...valid,
        reminders: [{ ...valid.reminders[0], status: "skipped" }],
      },
      {
        ...valid,
        reminders: [{
          ...valid.reminders[0],
          nextAttemptAt: "2026-09-18T12:00:00.000000Z",
          status: "pending",
        }],
      },
      {
        ...valid,
        reminders: [{
          ...valid.reminders[0],
          deliverAt: "2026-02-30T09:00:00Z",
        }],
      },
      {
        ...valid,
        reminders: [{
          ...valid.reminders[0],
          deliverAt: "2026-09-18T09:00:00",
        }],
      },
    ]
  ) {
    let rejected = false;
    try {
      parse(invalid);
    } catch {
      rejected = true;
    }
    assert(
      rejected,
      `loose Today response was accepted: ${JSON.stringify(invalid)}`,
    );
  }
  parse({ ...valid, timezone: "UTC" });
  parse({ ...valid, timezone: "America/New_York" });
});

Deno.test("PLANNING-002 generated Today request validates its HTTP response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(Response.json({
      cadences: [],
      reminders: [],
      status: "ready",
      timezone: "UTC",
      unexpected: true,
    }));
  let rejected = false;
  try {
    await generatedClient.getTodayReminders();
  } catch {
    rejected = true;
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert(rejected, "generated Today request returned an unvalidated response");
});

Deno.test("TODAY-001 contract is closed, bounded, and runtime validated", () => {
  const document = buildOpenApiDocument() as unknown as {
    readonly paths: Readonly<Record<string, unknown>>;
    readonly components: {
      readonly schemas: Readonly<
        Record<string, {
          readonly additionalProperties?: boolean;
          readonly properties?: Readonly<
            Record<string, { readonly maxItems?: number }>
          >;
        }>
      >;
    };
  };
  const schemas = document.components.schemas;
  assert(
    Boolean(document.paths["/api/v1/today/attention"]) &&
      schemas.TodayAttention?.additionalProperties === false &&
      schemas.TodayAttentionGroup?.additionalProperties === false &&
      schemas.TodayTaskAttentionItem?.additionalProperties === false &&
      schemas.TodayReminderAttentionItem?.additionalProperties === false &&
      schemas.TodayImportantDateAttentionItem?.additionalProperties === false &&
      schemas.TodayLifeEventAttentionItem?.additionalProperties === false &&
      schemas.TodayCadenceAttentionItem?.additionalProperties === false &&
      schemas.TodayAttention?.properties?.upcoming?.maxItems === 30,
    "Today attention OpenAPI boundary is loose or unbounded",
  );
  const parse = (generatedClient as unknown as {
    readonly parseTodayAttention: (value: unknown) => unknown;
  }).parseTodayAttention;
  const valid = {
    attention: {
      nextSevenDays: [],
      overdue: [],
      today: [{
        dueAt: "2026-08-18T08:00:00.000Z",
        id: crypto.randomUUID(),
        kind: "reminder",
        occursOn: "2026-08-18",
        person: { archived: false, id: crypto.randomUUID(), name: "Ada" },
        reminderStatus: "pending",
        title: "Call Ada",
      }, {
        dueAt: "2026-08-18T08:30:00.000Z",
        id: crypto.randomUUID(),
        kind: "life-event",
        occursOn: "2026-08-18",
        person: { archived: false, id: crypto.randomUUID(), name: "Ada" },
        reminderStatus: "pending",
        title: "Ada moved",
      }, {
        dueAt: "2026-08-18T09:00:00.000Z",
        id: crypto.randomUUID(),
        kind: "important-date",
        occursOn: "2026-08-18",
        person: { archived: false, id: crypto.randomUUID(), name: "Ada" },
        reminderStatus: "pending",
        title: "Ada's birthday",
      }],
    },
    date: "2026-08-18",
    status: "ready",
    timezone: "Europe/Belgrade",
    upcoming: [],
  };
  parse(valid);
  for (
    const invalid of [
      { ...valid, extra: true },
      {
        ...valid,
        attention: {
          ...valid.attention,
          today: [{ ...valid.attention.today[0], extra: true }],
        },
      },
      {
        ...valid,
        attention: {
          ...valid.attention,
          today: [{ ...valid.attention.today[1], occursOn: undefined }],
        },
      },
      {
        ...valid,
        attention: {
          ...valid.attention,
          today: [{ ...valid.attention.today[1], kind: "task" }],
        },
      },
      {
        ...valid,
        attention: {
          ...valid.attention,
          today: [{
            ...valid.attention.today[1],
            lastContactedAt: "2026-08-17T09:00:00.000Z",
          }],
        },
      },
      { ...valid, date: "2026-02-30" },
      { ...valid, timezone: "Definitely/Not_A_Zone" },
      {
        ...valid,
        upcoming: Array.from({ length: 31 }, () => valid.attention.today[0]),
      },
    ]
  ) {
    let rejected = false;
    try {
      parse(invalid);
    } catch {
      rejected = true;
    }
    assert(
      rejected,
      `loose Today attention response accepted: ${JSON.stringify(invalid)}`,
    );
  }
  parse({ ...valid, timezone: "UTC" });
  parse({ ...valid, timezone: "America/New_York" });
});
