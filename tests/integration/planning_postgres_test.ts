import postgres from "postgres";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  type PeopleActor,
} from "../../packages/backend/modules/people/public.ts";
import {
  createReminderDeliveryWorker,
  createReminderManagement,
  createTaskManagement,
  InAppReminderDelivery,
  reminderAuditFrom,
  reminderDeliveryAuditFrom,
  type ReminderDeliveryProvider,
  taskAuditFrom,
} from "../../packages/backend/modules/planning/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import * as generatedPlanningClient from "../../packages/contracts/generated/auth-client.ts";
import {
  PostgresAuditEventRecorder,
} from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import {
  PostgresPeopleTransaction,
} from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import {
  PostgresRelationshipPersonBoundary,
} from "../../packages/backend/modules/people/adapters/postgres/relationship_person_boundary.ts";
import {
  PostgresActorRevalidation,
} from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import {
  PostgresInAppReminderEffectStore,
  PostgresReminderDeliveryRepository,
  PostgresReminderRepository,
  PostgresReminderWorkspaceBoundary,
} from "../../packages/backend/modules/planning/adapters/postgres/reminder_repository.ts";
import {
  PostgresTaskRepository,
} from "../../packages/backend/modules/planning/adapters/postgres/task_repository.ts";
import { assert } from "../../packages/backend/testing/assert.ts";

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const deliveryConnection = connectDatabase(databaseUrl);
const deliveryRepository = new PostgresReminderDeliveryRepository(
  deliveryConnection.db,
  new PostgresActorRevalidation(),
);
const deliveryTransaction = new PostgresPeopleTransaction(
  deliveryConnection.db,
);
const password = "correct horse battery staple";

class DurableFakeProvider implements ReminderDeliveryProvider {
  readonly effects = new Map<string, string>();
  throwAfterNextEffect = false;

  async deliver(command: Parameters<ReminderDeliveryProvider["deliver"]>[0]) {
    const existing = this.effects.get(command.idempotencyKey);
    if (existing) {
      return {
        receipt: existing,
        status: "confirmed" as const,
      };
    }
    const receipt = `fake:${command.occurrenceId}`;
    this.effects.set(command.idempotencyKey, receipt);
    await sql`
      update crm.reminder_occurrences set provider_receipt = ${receipt},
        provider_result_state = 'confirmed', provider_effect_at = now(),
        visible_at = now(), updated_at = now()
      where id = ${command.occurrenceId}::uuid
        and provider_idempotency_key = ${command.idempotencyKey}
    `;
    if (this.throwAfterNextEffect) {
      this.throwAfterNextEffect = false;
      throw new Error("effect committed before timeout");
    }
    return { receipt, status: "confirmed" as const };
  }

  reconcile(command: Parameters<ReminderDeliveryProvider["reconcile"]>[0]) {
    const receipt = this.effects.get(command.idempotencyKey);
    return Promise.resolve(
      receipt
        ? { receipt, status: "confirmed" as const }
        : { code: "not-found", status: "transient" as const },
    );
  }
}

interface Fixture {
  readonly cookie: string;
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

async function register(
  email: string,
  workspaceName: string,
): Promise<Fixture> {
  const registration = await configured.app.request(
    "http://localhost/api/v1/registrations",
    {
      body: JSON.stringify({
        email,
        firstName: "Planning",
        lastName: "Tester",
        password,
        workspaceName,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  assert(registration.status === 202, "planning fixture registers");
  const token = mail.latestToken(email);
  assert(token, "planning verification token captured");
  assert(
    (await configured.app.request(
      "http://localhost/api/v1/email-verifications",
      {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    )).status === 200,
    "planning fixture verifies",
  );
  const signed = await configured.app.request(
    "http://localhost/api/v1/sessions",
    {
      body: JSON.stringify({ email, password }),
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      method: "POST",
    },
  );
  const body = await signed.json() as {
    readonly member: { readonly id: string };
    readonly workspace: { readonly id: string };
  };
  const cookie = signed.headers.get("set-cookie")?.split(";")[0];
  assert(signed.status === 200 && cookie, "planning fixture signs in");
  const [identity] = await sql<{ readonly id: string }[]>`
    select id::text from crm.users where email = ${email}
  `;
  assert(identity, "planning fixture identity exists");
  return {
    cookie,
    memberId: body.member.id,
    role: "owner",
    userId: identity.id,
    workspaceId: body.workspace.id,
  };
}

function request(
  fixture: Fixture,
  path: string,
  method: "GET" | "PATCH" | "POST" | "PUT" = "GET",
  body?: unknown,
): Promise<Response> {
  return Promise.resolve(configured.app.request(`http://localhost${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      cookie: fixture.cookie,
      ...(method === "GET"
        ? {}
        : { "content-type": "application/json", origin: "http://localhost" }),
      "X-Workspace-Id": fixture.workspaceId,
    },
    method,
  }));
}

async function createPerson(
  fixture: Fixture,
  givenName: string,
): Promise<string> {
  const created = await request(fixture, "/api/v1/people", "POST", {
    givenName,
    isPartial: false,
  });
  const body = await created.json() as {
    readonly person: { readonly id: string };
  };
  assert(created.status === 201, `${givenName} created`);
  return body.person.id;
}

async function createTask(
  fixture: Fixture,
  title: string,
  personId?: string,
  dueAt?: string,
): Promise<{ readonly id: string; readonly updatedAt: string }> {
  const response = await request(fixture, "/api/v1/tasks", "POST", {
    ...(dueAt ? { dueAt } : {}),
    ...(personId ? { personId } : {}),
    requestId: crypto.randomUUID(),
    title,
  });
  const body = await response.json() as {
    readonly task: { readonly id: string; readonly updatedAt: string };
  };
  assert(
    response.status === 201,
    `${title} task created: ${JSON.stringify(body)}`,
  );
  return body.task;
}

Deno.test("PLANNING-001 PostgreSQL keeps global, person, Today, audit, and completion projections atomic", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(`planning-${suffix}@example.test`, "Planning");
  const foreign = await register(
    `planning-foreign-${suffix}@example.test`,
    "Foreign planning",
  );
  const ada = await createPerson(primary, "Ada");
  const outsider = await createPerson(foreign, "Outsider");
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + 2);
  const personTask = await createTask(
    primary,
    "Call Ada",
    ada,
    due.toISOString(),
  );
  const globalTask = await createTask(primary, "Review notes");

  const [globalList, personList, today, attention, foreignAttention] =
    await Promise.all([
      request(primary, "/api/v1/tasks"),
      request(primary, `/api/v1/tasks?personId=${ada}`),
      request(primary, "/api/v1/today/tasks"),
      request(primary, "/api/v1/today/attention"),
      request(foreign, "/api/v1/today/attention"),
    ]);
  const globalBody = await globalList.json() as {
    readonly items: readonly {
      readonly id: string;
      readonly person?: { readonly id: string };
    }[];
  };
  const personBody = await personList.json() as {
    readonly items: readonly { readonly id: string }[];
  };
  const todayBody = await today.json() as {
    readonly items: readonly { readonly id: string }[];
  };
  const attentionBody = await attention.json() as {
    readonly attention: {
      readonly nextSevenDays: readonly { readonly id: string }[];
    };
  };
  const foreignAttentionBody = await foreignAttention.json() as {
    readonly attention: {
      readonly nextSevenDays: readonly { readonly id: string }[];
    };
  };
  assert(
    globalList.status === 200 &&
      globalBody.items.some((item) => item.id === personTask.id) &&
      globalBody.items.some((item) => item.id === globalTask.id),
    "global task projection disagreed",
  );
  assert(
    personList.status === 200 && personBody.items.length === 1 &&
      personBody.items[0]?.id === personTask.id,
    "person task projection disagreed",
  );
  assert(
    today.status === 200 &&
      todayBody.items.some((item) => item.id === personTask.id),
    "Today omitted due task",
  );
  assert(
    attention.status === 200 &&
      attentionBody.attention.nextSevenDays.some((item) =>
        item.id === personTask.id
      ) &&
      !foreignAttentionBody.attention.nextSevenDays.some((item) =>
        item.id === personTask.id
      ),
    "unified Today omitted or cross-workspace leaked the due task",
  );

  const completed = await request(
    primary,
    `/api/v1/tasks/${personTask.id}/completion`,
    "PUT",
    { completed: true },
  );
  const completedBody = await completed.json() as {
    readonly status: string;
    readonly task: {
      readonly completedByMemberId?: string;
      readonly status: string;
      readonly updatedAt: string;
    };
  };
  const repeated = await request(
    primary,
    `/api/v1/tasks/${personTask.id}/completion`,
    "PUT",
    { completed: true },
  );
  const repeatedBody = await repeated.json() as {
    readonly status: string;
    readonly task: { readonly updatedAt: string };
  };
  assert(
    completed.status === 200 && completedBody.status === "saved" &&
      completedBody.task.status === "completed" &&
      completedBody.task.completedByMemberId === primary.memberId,
    "task completion was not attributed",
  );
  assert(
    repeated.status === 200 && repeatedBody.status === "unchanged" &&
      repeatedBody.task.updatedAt === completedBody.task.updatedAt,
    "repeated completion changed persistence",
  );

  const proof = await sql<{ audits: number; tasks: number }[]>`
    select
      (select count(*)::int from crm.tasks where id = ${personTask.id}::uuid) tasks,
      (select count(*)::int from crm.audit_events where subject_id = ${personTask.id}::uuid
        and action = 'planning.task-created-or-state-changed') audits
  `;
  assert(
    proof[0]?.tasks === 1 && proof[0].audits === 2,
    `task/audit atomicity failed: ${JSON.stringify(proof[0])}`,
  );

  const reopened = await request(
    primary,
    `/api/v1/tasks/${personTask.id}/completion`,
    "PUT",
    { completed: false },
  );
  const reopenedBody = await reopened.json() as {
    readonly task: {
      readonly completedAt?: string;
      readonly status: string;
      readonly updatedAt: string;
    };
  };
  assert(
    reopened.status === 200 && reopenedBody.task.status === "open" &&
      !reopenedBody.task.completedAt,
    "task did not reopen cleanly",
  );
  const changed = await request(
    primary,
    `/api/v1/tasks/${personTask.id}`,
    "PATCH",
    {
      dueAt: null,
      expectedUpdatedAt: reopenedBody.task.updatedAt,
      personId: null,
      title: "Call Ada tomorrow",
    },
  );
  const changedBody = await changed.json() as {
    readonly task: {
      readonly dueAt?: string;
      readonly person?: unknown;
      readonly title: string;
    };
  };
  assert(
    changed.status === 200 && changedBody.task.title === "Call Ada tomorrow" &&
      !changedBody.task.dueAt && !changedBody.task.person,
    "task change did not clear optional links",
  );

  const foreignLink = await request(
    primary,
    `/api/v1/tasks/${globalTask.id}`,
    "PATCH",
    {
      expectedUpdatedAt: globalTask.updatedAt,
      personId: outsider,
    },
  );
  const foreignMutation = await request(
    foreign,
    `/api/v1/tasks/${globalTask.id}/completion`,
    "PUT",
    { completed: true },
  );
  assert(
    foreignLink.status === 404 && foreignMutation.status === 404,
    "cross-workspace task/person boundary leaked",
  );
});

Deno.test("TODAY-001 PostgreSQL total-orders cross-kind UUID ties at both bounds", async () => {
  const fixture = await register(
    `today-order-${crypto.randomUUID()}@example.test`,
    "Today order",
  );
  const personId = await createPerson(fixture, "Tie person");
  const due = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString();
  const seed = async (count: number, before: string, at: string) => {
    const id = crypto.randomUUID();
    await sql`
      insert into crm.tasks (id, workspace_id, person_id, title, due_at, created_by_member_id)
      values (${id}::uuid, ${fixture.workspaceId}::uuid, ${personId}::uuid, 'Same title', ${at}::timestamptz, ${fixture.memberId}::uuid)
    `;
    await sql`
      insert into crm.tasks (workspace_id, person_id, title, due_at, created_by_member_id)
      select ${fixture.workspaceId}::uuid, ${personId}::uuid, 'Filler ' || n,
        ${before}::timestamptz, ${fixture.memberId}::uuid from generate_series(1, ${count}::int) n
    `;
    const reminder = await createReminder(fixture, personId, "Same title");
    await sql`
      update crm.reminder_occurrences set id = ${id}::uuid, deliver_at = ${at}::timestamptz, title_snapshot = 'Same title'
      where id = ${reminder.nextOccurrence!.id}::uuid
    `;
    return id;
  };
  const attentionTie = await seed(19, due(1), due(2));
  const upcomingTie = await seed(29, due(9), due(10));
  type Item = { readonly id: string; readonly kind: string };
  type Projection = {
    readonly attention: { readonly nextSevenDays: readonly Item[] };
    readonly upcoming: readonly Item[];
  };
  const read = async () =>
    await (await request(fixture, "/api/v1/today/attention"))
      .json() as Projection;
  const [first, replay] = await Promise.all([read(), read()]);
  const keys = (items: readonly Item[]) =>
    items.map((item) => `${item.kind}:${item.id}`);
  const attentionKeys = keys(first.attention.nextSevenDays);
  const upcomingKeys = keys(first.upcoming);
  assert(
    attentionKeys.length === 20 && upcomingKeys.length === 30 &&
      new Set(attentionKeys).size === 20 && new Set(upcomingKeys).size === 30 &&
      attentionKeys.includes(`reminder:${attentionTie}`) &&
      upcomingKeys.includes(`reminder:${upcomingTie}`) &&
      JSON.stringify(attentionKeys) ===
        JSON.stringify(keys(replay.attention.nextSevenDays)) &&
      JSON.stringify(upcomingKeys) === JSON.stringify(keys(replay.upcoming)),
    "Today cross-kind cutoff tie or lifecycle exclusion was unstable",
  );
});

Deno.test("TODAY-001 PostgreSQL never projects cross-workspace person links", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `today-person-tenant-${suffix}@example.test`,
    "Today person tenant",
  );
  const foreign = await register(
    `today-person-foreign-${suffix}@example.test`,
    "Today foreign person",
  );
  const foreignPersonId = await createPerson(foreign, "Foreign secret name");
  const deletedPersonId = await createPerson(fixture, "Deleted same workspace");
  const dueAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const directTaskId = crypto.randomUUID();
  const targetTaskId = crypto.randomUUID();
  const deletedTask = await createTask(
    fixture,
    "Same workspace deleted link",
    deletedPersonId,
    dueAt,
  );
  const foreignTask = await createTask(
    foreign,
    "Unrelated foreign workspace task",
    foreignPersonId,
    dueAt,
  );
  await sql`
    insert into crm.tasks (id, workspace_id, person_id, title, due_at,
      created_by_member_id)
    values
      (${directTaskId}::uuid, ${fixture.workspaceId}::uuid,
        ${foreignPersonId}::uuid, 'Foreign-linked direct task',
        ${dueAt}::timestamptz, ${fixture.memberId}::uuid),
      (${targetTaskId}::uuid, ${fixture.workspaceId}::uuid,
        ${foreignPersonId}::uuid, 'Foreign-linked target task', null,
        ${fixture.memberId}::uuid)
  `;
  await sql`
    update crm.people set deleted_at = now(), updated_at = now()
    where id = ${deletedPersonId}::uuid
  `;
  const targetReminderId = crypto.randomUUID();
  const targetOccurrenceId = crypto.randomUUID();
  const deletedTargetReminderId = crypto.randomUUID();
  const deletedTargetOccurrenceId = crypto.randomUUID();
  const earlierDueAt = new Date(Date.now() + 86_400_000).toISOString();
  await sql`
    insert into crm.reminders (id, workspace_id, task_id, target_kind, title,
      anchor_on, recurrence_unit, created_by_member_id)
    values
      (${targetReminderId}::uuid, ${fixture.workspaceId}::uuid,
        ${targetTaskId}::uuid, 'task', 'Foreign-linked target occurrence',
        ${dueAt.slice(0, 10)}::date, 'none', ${fixture.memberId}::uuid),
      (${deletedTargetReminderId}::uuid, ${fixture.workspaceId}::uuid,
        ${deletedTask.id}::uuid, 'task', 'Deleted person target occurrence',
        ${earlierDueAt.slice(0, 10)}::date, 'none', ${fixture.memberId}::uuid)
  `;
  await sql`
    insert into crm.reminder_occurrences (id, reminder_id, member_id,
      occurs_on, deliver_at, channel, status, title_snapshot)
    values
      (${targetOccurrenceId}::uuid, ${targetReminderId}::uuid,
        ${fixture.memberId}::uuid, ${dueAt.slice(0, 10)}::date,
        ${dueAt}::timestamptz, 'in_app', 'pending',
        'Foreign-linked target occurrence'),
      (${deletedTargetOccurrenceId}::uuid, ${deletedTargetReminderId}::uuid,
        ${fixture.memberId}::uuid, ${earlierDueAt.slice(0, 10)}::date,
        ${earlierDueAt}::timestamptz, 'in_app', 'pending',
        'Deleted person target occurrence')
  `;

  const response = await request(fixture, "/api/v1/today/attention");
  const body = await response.json() as {
    readonly attention: Readonly<
      Record<
        string,
        readonly {
          readonly id: string;
          readonly person?: {
            readonly id: string;
            readonly name: string;
            readonly unavailable?: boolean;
          };
        }[]
      >
    >;
    readonly upcoming: readonly {
      readonly id: string;
      readonly person?: {
        readonly id: string;
        readonly name: string;
        readonly unavailable?: boolean;
      };
    }[];
  };
  const items = [...Object.values(body.attention).flat(), ...body.upcoming];
  const direct = items.find((item) => item.id === directTaskId);
  const targeted = items.find((item) => item.id === targetTaskId);
  const deleted = items.find((item) => item.id === deletedTask.id);
  const serialized = JSON.stringify(body);
  assert(
    response.status === 200 && direct && !("person" in direct) && targeted &&
      !("person" in targeted) && deleted?.person?.id === deletedPersonId &&
      deleted.person.unavailable === true &&
      deleted.person.name === "Deleted/Unavailable person" &&
      !items.some((item) => item.id === foreignTask.id) &&
      !serialized.includes(foreignPersonId) &&
      !serialized.includes("Foreign secret name"),
    `Today leaked a cross-workspace person link: ${serialized}`,
  );
});

Deno.test("TODAY-001 PostgreSQL buckets retry attention by next attempt", async () => {
  const fixture = await register(
    `today-retry-due-${crypto.randomUUID()}@example.test`,
    "Today retry due",
  );
  const personId = await createPerson(fixture, "Retry attention person");
  const reminder = async (title: string) =>
    await createReminder(fixture, personId, title);
  const retryInside = await reminder("Retry inside");
  const retryOutside = await reminder("Retry outside");
  const pending = await reminder("Pending adjacent");
  const failed = await reminder("Failed adjacent");
  const manual = await reminder("Manual adjacent");
  const claimed = await reminder("Claimed excluded");
  const sent = await reminder("Sent excluded");
  const cancelled = await reminder("Cancelled excluded");
  const skipped = await reminder("Skipped excluded");
  const taskRetry = await reminder("Task retry inside");
  const taskId = crypto.randomUUID();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const nextDay = new Date(Date.now() + 86_400_000).toISOString();
  const nextTwoDays = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const nextThreeDays = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const afterWindow = new Date(Date.now() + 31 * 86_400_000).toISOString();
  await sql`
    insert into crm.tasks (id, workspace_id, person_id, title,
      created_by_member_id)
    values (${taskId}::uuid, ${fixture.workspaceId}::uuid, ${personId}::uuid,
      'Task retry inside', ${fixture.memberId}::uuid)
  `;
  await sql`
    update crm.reminders set target_kind = 'task', task_id = ${taskId}::uuid
    where id = ${taskRetry.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'retry', attempt_count = 1,
      deliver_at = ${yesterday}::timestamptz,
      next_attempt_at = ${nextTwoDays}::timestamptz
    where id = ${retryInside.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'retry', attempt_count = 1,
      deliver_at = ${nextDay}::timestamptz,
      next_attempt_at = ${afterWindow}::timestamptz
    where id = ${retryOutside.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'retry', attempt_count = 1,
      deliver_at = ${yesterday}::timestamptz,
      next_attempt_at = ${nextThreeDays}::timestamptz
    where id = ${taskRetry.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set deliver_at = ${nextDay}::timestamptz
    where id = ${pending.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'failed',
      deliver_at = ${yesterday}::timestamptz
    where id = ${failed.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'manual_attention',
      provider_result_state = 'ambiguous', deliver_at = ${yesterday}::timestamptz
    where id = ${manual.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'claimed',
      claim_token = gen_random_uuid(), claim_owner = 'today-test',
      lease_expires_at = now() + interval '1 hour'
    where id = ${claimed.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'sent', sent_at = now(),
      provider_result_state = 'confirmed', provider_receipt = 'today-test',
      provider_effect_at = now(), visible_at = now()
    where id = ${sent.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'cancelled'
    where id = ${cancelled.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'skipped'
    where id = ${skipped.nextOccurrence!.id}::uuid
  `;

  type Item = { readonly dueAt: string; readonly id: string };
  const response = await request(fixture, "/api/v1/today/attention");
  const body = await response.json() as {
    readonly attention: {
      readonly nextSevenDays: readonly Item[];
      readonly overdue: readonly Item[];
    };
    readonly upcoming: readonly Item[];
  };
  const all = [...Object.values(body.attention).flat(), ...body.upcoming];
  const next = body.attention.nextSevenDays;
  const overdue = body.attention.overdue;
  const retryItem = next.find((item) =>
    item.id === retryInside.nextOccurrence!.id
  );
  const taskItem = next.find((item) => item.id === taskId);
  const pendingItem = next.find((item) =>
    item.id === pending.nextOccurrence!.id
  );
  const failedItem = overdue.find((item) =>
    item.id === failed.nextOccurrence!.id
  );
  const manualItem = overdue.find((item) =>
    item.id === manual.nextOccurrence!.id
  );
  const excluded = [
    retryOutside,
    claimed,
    sent,
    cancelled,
    skipped,
  ].map((item) => item.nextOccurrence!.id);
  assert(
    response.status === 200 &&
      retryItem?.dueAt.startsWith(nextTwoDays.slice(0, 19)) &&
      taskItem?.dueAt.startsWith(nextThreeDays.slice(0, 19)) &&
      pendingItem?.dueAt.startsWith(nextDay.slice(0, 19)) &&
      failedItem?.dueAt.startsWith(yesterday.slice(0, 19)) &&
      manualItem?.dueAt.startsWith(yesterday.slice(0, 19)) &&
      excluded.every((id) => !all.some((item) => item.id === id)),
    `Today retry lifecycle used the wrong effective due: ${
      JSON.stringify(body)
    }`,
  );
});

Deno.test("TODAY-001 PostgreSQL projects every v6 reminder target through its authoritative owner", async () => {
  const fixture = await register(
    `today-targets-${crypto.randomUUID()}@example.test`,
    "Today targets",
  );
  const personId = await createPerson(fixture, "Target person");
  const deliverAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const anchorOn = deliverAt.slice(0, 10);
  const insertTask = async (title: string, dueAt?: string) => {
    const id = crypto.randomUUID();
    await sql`
      insert into crm.tasks (id, workspace_id, person_id, title, due_at, created_by_member_id)
      values (${id}::uuid, ${fixture.workspaceId}::uuid, ${personId}::uuid,
        ${title}, ${dueAt ?? null}::timestamptz, ${fixture.memberId}::uuid)
    `;
    return id;
  };
  const insertTarget = async (input: {
    readonly deliverAt?: string;
    readonly kind: "custom" | "life_event" | "person_date" | "task";
    readonly lifeEventId?: string;
    readonly occurrenceId?: string;
    readonly personDateId?: string;
    readonly personId?: string;
    readonly reminderId?: string;
    readonly taskId?: string;
    readonly title: string;
  }) => {
    const reminderId = input.reminderId ?? crypto.randomUUID();
    const occurrenceId = input.occurrenceId ?? crypto.randomUUID();
    const targetDeliverAt = input.deliverAt ?? deliverAt;
    await sql`
      insert into crm.reminders (id, workspace_id, person_id, person_date_id,
        life_event_id, task_id, target_kind, title, anchor_on,
        recurrence_unit, created_by_member_id)
      values (${reminderId}::uuid, ${fixture.workspaceId}::uuid,
        ${input.personId ?? null}::uuid, ${input.personDateId ?? null}::uuid,
        ${input.lifeEventId ?? null}::uuid, ${input.taskId ?? null}::uuid,
        ${input.kind}, ${input.title}, ${anchorOn}::date, 'none',
        ${fixture.memberId}::uuid)
    `;
    await sql`
      insert into crm.reminder_occurrences (id, reminder_id, member_id,
        occurs_on, deliver_at, channel, status, title_snapshot)
      values (${occurrenceId}::uuid, ${reminderId}::uuid,
        ${fixture.memberId}::uuid, ${anchorOn}::date, ${targetDeliverAt}::timestamptz,
        'in_app', 'pending', ${input.title})
    `;
    return { occurrenceId, reminderId };
  };

  const nullDueTask = await insertTask("Null due target");
  const farTask = await insertTask(
    "Far due target",
    new Date(Date.now() + 45 * 86_400_000).toISOString(),
  );
  const duplicateTask = await insertTask("Duplicate target", deliverAt);
  const stableSourceTask = await insertTask("Stable source target");
  const directPrecedenceTask = await insertTask(
    "Direct source wins",
    deliverAt,
  );
  const earlierOccurrenceTask = await insertTask(
    "Later direct source",
    new Date(new Date(deliverAt).getTime() + 60 * 60_000).toISOString(),
  );
  const completedTask = await insertTask("Completed target");
  const deletedTask = await insertTask("Deleted target");
  const nullDueOccurrence = await insertTarget({
    kind: "task",
    taskId: nullDueTask,
    title: "Null due occurrence",
  });
  await insertTarget({
    kind: "task",
    taskId: farTask,
    title: "Far due occurrence",
  });
  await insertTarget({
    kind: "task",
    taskId: duplicateTask,
    title: "Duplicate occurrence",
  });
  await insertTarget({
    kind: "task",
    occurrenceId: "00000000-0000-4000-8000-000000000022",
    reminderId: "00000000-0000-4000-8000-000000000032",
    taskId: stableSourceTask,
    title: "Larger source UUID",
  });
  await insertTarget({
    kind: "task",
    occurrenceId: "00000000-0000-4000-8000-000000000011",
    reminderId: "00000000-0000-4000-8000-000000000031",
    taskId: stableSourceTask,
    title: "Smaller source UUID",
  });
  await insertTarget({
    kind: "task",
    taskId: directPrecedenceTask,
    title: "Occurrence must lose equal due tie",
  });
  await insertTarget({
    kind: "task",
    taskId: earlierOccurrenceTask,
    title: "Earlier occurrence wins",
  });
  await insertTarget({
    kind: "task",
    taskId: completedTask,
    title: "Completed occurrence",
  });
  await insertTarget({
    kind: "task",
    taskId: deletedTask,
    title: "Deleted occurrence",
  });
  await sql`
    update crm.tasks set status = 'completed', completed_at = now()
    where id = ${completedTask}::uuid
  `;
  await sql`
    update crm.tasks set deleted_at = now() where id = ${deletedTask}::uuid
  `;

  const personDateId = crypto.randomUUID();
  await sql`
    insert into crm.person_dates (id, person_id, kind, month, day, precision)
    values (${personDateId}::uuid, ${personId}::uuid, 'birthday', 8, 22,
      'month_day')
  `;
  const important = await insertTarget({
    kind: "person_date",
    personDateId,
    title: "Authoritative important date",
  });
  const lifeEventId = crypto.randomUUID();
  await sql`
    insert into crm.life_events (id, workspace_id, person_id, name, precision)
    values (${lifeEventId}::uuid, ${fixture.workspaceId}::uuid,
      ${personId}::uuid, 'Moved home', 'unknown')
  `;
  const lifeEvent = await insertTarget({
    kind: "life_event",
    lifeEventId,
    title: "Authoritative life event",
  });
  const direct = await insertTarget({
    kind: "custom",
    personId,
    title: "Adjacent direct reminder",
  });

  type Item = {
    readonly dueAt: string;
    readonly id: string;
    readonly kind: string;
    readonly person?: { readonly id: string };
    readonly title: string;
  };
  const read = async () => {
    const response = await request(fixture, "/api/v1/today/attention");
    const body = await response.json() as {
      readonly attention: Readonly<Record<string, readonly Item[]>>;
      readonly upcoming: readonly Item[];
    };
    return { body, response };
  };
  const [{ body, response }, ...replays] = await Promise.all([
    read(),
    read(),
    read(),
  ]);
  const items = [...Object.values(body.attention).flat(), ...body.upcoming];
  const taskItems = items.filter((item) => item.kind === "task");
  const find = (kind: string, id: string) =>
    items.find((item) => item.kind === kind && item.id === id);
  assert(
    response.status === 200 &&
      find("task", nullDueTask)?.dueAt.startsWith(deliverAt.slice(0, 19)) &&
      find("task", farTask)?.title === "Far due occurrence" &&
      taskItems.filter((item) => item.id === duplicateTask).length === 1 &&
      find("task", stableSourceTask)?.title === "Smaller source UUID" &&
      find("task", directPrecedenceTask)?.title === "Direct source wins" &&
      find("task", earlierOccurrenceTask)?.title ===
        "Earlier occurrence wins" &&
      replays.every(({ body }) => {
        const replayItems = [
          ...Object.values(body.attention).flat(),
          ...body.upcoming,
        ];
        return replayItems.find((item) =>
          item.kind === "task" && item.id === stableSourceTask
        )?.title === "Smaller source UUID";
      }) &&
      !find("task", completedTask) && !find("task", deletedTask) &&
      find("important-date", important.occurrenceId)?.person?.id === personId &&
      find("life-event", lifeEvent.occurrenceId)?.person?.id === personId &&
      find("reminder", direct.occurrenceId)?.person?.id === personId &&
      find("task", nullDueTask)?.id !== nullDueOccurrence.occurrenceId,
    `v6 target projection was incomplete: ${JSON.stringify(items)}`,
  );
});

Deno.test("TODAY-001 PostgreSQL keeps timezone and rows in one repeatable snapshot", async () => {
  const runInterleaving = async (inherited: boolean) => {
    const fixture = await register(
      `today-snapshot-${inherited}-${crypto.randomUUID()}@example.test`,
      `Today snapshot ${inherited}`,
    );
    const personId = await createPerson(fixture, "Snapshot person");
    const reminder = await createReminder(fixture, personId, "Snapshot row");
    const occurrenceId = reminder.nextOccurrence?.id;
    assert(occurrenceId, "snapshot occurrence exists");
    const oldDueAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const newDueAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    await sql`
      update crm.workspace_settings set default_timezone = 'UTC'
      where workspace_id = ${fixture.workspaceId}::uuid
    `;
    await sql`
      insert into crm.member_preferences (member_id, timezone)
      values (${fixture.memberId}::uuid, ${inherited ? null : "UTC"})
      on conflict (member_id) do update set timezone = excluded.timezone
    `;
    await sql`
      update crm.reminder_occurrences set deliver_at = ${oldDueAt}::timestamptz,
        occurs_on = ${oldDueAt.slice(0, 10)}::date, channel = 'in_app',
        status = 'pending'
      where id = ${occurrenceId}::uuid
    `;

    const locker = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
    const observer = postgres(databaseUrl, {
      max: 1,
      onnotice: () => undefined,
    });
    let signalLocked!: (pid: number) => void;
    const locked = new Promise<number>((resolve) => signalLocked = resolve);
    let releaseLocker!: () => void;
    const release = new Promise<void>((resolve) => releaseLocker = resolve);
    const lockerWork = locker.begin(async (transaction) => {
      const [backend] = await transaction<{ readonly pid: number }[]>`
        select pg_backend_pid()::int as pid
      `;
      assert(backend, "locker backend PID exists");
      await transaction`
        select id from crm.reminder_occurrences
        where id = ${occurrenceId}::uuid for update
      `;
      await transaction`lock table crm.reminder_occurrences in access exclusive mode`;
      signalLocked(backend.pid);
      await release;
      if (inherited) {
        await transaction`
          update crm.workspace_settings set default_timezone = 'America/New_York'
          where workspace_id = ${fixture.workspaceId}::uuid
        `;
      } else {
        await transaction`
          update crm.member_preferences set timezone = 'America/New_York'
          where member_id = ${fixture.memberId}::uuid
        `;
      }
      await transaction`
        update crm.reminder_occurrences set deliver_at = ${newDueAt}::timestamptz,
          occurs_on = ${newDueAt.slice(0, 10)}::date
        where id = ${occurrenceId}::uuid
      `;
    });
    const lockerPid = await locked;
    const todayRequest = request(fixture, "/api/v1/today/attention");
    let blockedPid: number | undefined;
    for (let attempt = 0; attempt < 100 && !blockedPid; attempt += 1) {
      const [blocked] = await observer<{ readonly pid: number }[]>`
        select activity.pid::int
        from pg_stat_activity activity
        where ${lockerPid}::int = any(pg_blocking_pids(activity.pid))
          and activity.wait_event_type = 'Lock'
        order by activity.pid limit 1
      `;
      blockedPid = blocked?.pid;
      if (!blockedPid) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (blockedPid === undefined || blockedPid === lockerPid) {
      releaseLocker();
      await Promise.allSettled([lockerWork, todayRequest]);
      await Promise.all([locker.end(), observer.end()]);
      throw new Error(
        "Today backend did not reach the exact locker-owned relation barrier",
      );
    }
    releaseLocker();
    const response = await todayRequest;
    await lockerWork;
    const body = await response.json() as {
      readonly attention: Readonly<
        Record<
          string,
          readonly { readonly dueAt: string; readonly id: string }[]
        >
      >;
      readonly timezone: string;
      readonly upcoming: readonly {
        readonly dueAt: string;
        readonly id: string;
      }[];
    };
    const items = [...Object.values(body.attention).flat(), ...body.upcoming];
    const projected = items.find((item) => item.id === occurrenceId);
    assert(
      response.status === 200 && body.timezone === "UTC" &&
        projected?.dueAt.startsWith(oldDueAt.slice(0, 19)),
      `Today mixed timezone/row snapshots (${
        inherited ? "workspace" : "member"
      }): ${JSON.stringify(body)}`,
    );
    await Promise.all([locker.end(), observer.end()]);
  };
  await runInterleaving(false);
  await runInterleaving(true);
});

Deno.test("PLANNING-001 PostgreSQL keeps archived person tasks readable and rejects writes", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `planning-archive-${suffix}@example.test`,
    "Archived planning",
  );
  const personId = await createPerson(fixture, "Archive");
  const task = await createTask(fixture, "Historical task", personId);
  const detachTask = await createTask(fixture, "Archived detach", personId);
  const reassignTask = await createTask(
    fixture,
    "Archived reassign",
    personId,
  );
  const activeTarget = await createPerson(fixture, "Active target");
  const profile = await request(fixture, `/api/v1/people/${personId}`);
  const profileBody = await profile.json() as {
    readonly person: { readonly updatedAt: string };
  };
  const archived = await request(
    fixture,
    `/api/v1/people/${personId}/archive`,
    "POST",
    {
      expectedUpdatedAt: profileBody.person.updatedAt,
    },
  );
  assert(archived.status === 200, "person was not archived");
  const listed = await request(fixture, `/api/v1/tasks?personId=${personId}`);
  const listedBody = await listed.json() as {
    readonly items: readonly {
      readonly id: string;
      readonly person?: { readonly archived: boolean };
    }[];
  };
  const completion = await request(
    fixture,
    `/api/v1/tasks/${task.id}/completion`,
    "PUT",
    { completed: true },
  );
  const creation = await request(fixture, "/api/v1/tasks", "POST", {
    personId,
    requestId: crypto.randomUUID(),
    title: "Must reject",
  });
  const detach = await request(
    fixture,
    `/api/v1/tasks/${detachTask.id}`,
    "PATCH",
    { expectedUpdatedAt: detachTask.updatedAt, personId: null },
  );
  const reassign = await request(
    fixture,
    `/api/v1/tasks/${reassignTask.id}`,
    "PATCH",
    { expectedUpdatedAt: reassignTask.updatedAt, personId: activeTarget },
  );
  assert(
    listed.status === 200 &&
      listedBody.items.some((item) =>
        item.id === task.id && item.person?.archived === true
      ),
    "archived task history disappeared",
  );
  assert(
    completion.status === 409 && creation.status === 409 &&
      detach.status === 409 && reassign.status === 409,
    "archived current person link escaped task read-only",
  );
});

Deno.test("PLANNING-001 PostgreSQL preserves precise, millisecond, and null due values", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `planning-due-replay-${suffix}@example.test`,
    "Planning due replay",
  );
  const requestId = crypto.randomUUID();
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + 2);
  const dueAt = due.toISOString().replace(/\.\d{3}Z$/, ".123456Z");
  const input = { dueAt, requestId, title: "Precise replay" };
  const first = await request(fixture, "/api/v1/tasks", "POST", input);
  const firstBody = await first.json() as {
    readonly task?: {
      readonly dueAt?: string;
      readonly id: string;
      readonly updatedAt: string;
    };
  };
  const replay = await request(fixture, "/api/v1/tasks", "POST", input);
  const replayBody = await replay.json() as {
    readonly task?: { readonly dueAt?: string; readonly id: string };
  };
  const listed = await request(fixture, "/api/v1/tasks");
  const listedBody = await listed.json() as {
    readonly items: readonly { readonly dueAt?: string; readonly id: string }[];
  };
  const listedPrecise = listedBody.items.find((task) =>
    task.id === firstBody.task?.id
  );
  const millisecondAt = due.toISOString().replace(/\.\d{3}Z$/, ".789Z");
  const millisecond = await request(fixture, "/api/v1/tasks", "POST", {
    dueAt: millisecondAt,
    requestId: crypto.randomUUID(),
    title: "Millisecond due",
  });
  const millisecondBody = await millisecond.json() as {
    readonly task?: {
      readonly dueAt?: string;
      readonly id: string;
      readonly updatedAt: string;
    };
  };
  const cleared = millisecondBody.task
    ? await request(
      fixture,
      `/api/v1/tasks/${millisecondBody.task.id}`,
      "PATCH",
      {
        dueAt: null,
        expectedUpdatedAt: millisecondBody.task.updatedAt,
      },
    )
    : undefined;
  const clearedBody = cleared
    ? await cleared.json() as { readonly task?: { readonly dueAt?: string } }
    : undefined;
  const audits = firstBody.task
    ? await sql<{ readonly count: number }[]>`
      select count(*)::int count from crm.audit_events
      where subject_id = ${firstBody.task.id}::uuid
        and action = 'planning.task-created-or-state-changed'
    `
    : [];
  assert(
    first.status === 201 && replay.status === 201 && listed.status === 200 &&
      firstBody.task &&
      replayBody.task?.id === firstBody.task.id &&
      replayBody.task.dueAt === dueAt && firstBody.task.dueAt === dueAt &&
      listedPrecise?.dueAt === dueAt && millisecond.status === 201 &&
      millisecondBody.task?.dueAt ===
        millisecondAt.replace(".789Z", ".789000Z") &&
      cleared?.status === 200 && !clearedBody?.task?.dueAt &&
      audits[0]?.count === 1,
    `due value persistence was not exact: ${
      JSON.stringify({
        clearedBody,
        firstBody,
        firstStatus: first.status,
        listedPrecise,
        millisecondBody,
        replayBody,
        replayStatus: replay.status,
      })
    }`,
  );
});

Deno.test("PLANNING-001 PostgreSQL hydrates every person across a 51-task page", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `planning-page-${suffix}@example.test`,
    "Planning page",
  );
  const records = Array.from({ length: 52 }, (_, index) => ({
    personId: crypto.randomUUID(),
    taskId: crypto.randomUUID(),
    title: `Hydrated task ${String(index + 1).padStart(2, "0")}`,
  })).sort((left, right) => left.taskId.localeCompare(right.taskId));
  const archived = records.at(-1)!;
  await sql.begin(async (transaction) => {
    for (const [index, record] of records.entries()) {
      await transaction`
        insert into crm.people (
          id, workspace_id, created_by_member_id, given_name, archived_at
        ) values (
          ${record.personId}::uuid, ${fixture.workspaceId}::uuid,
          ${fixture.memberId}::uuid, ${`Person ${index + 1}`},
          ${record === archived ? new Date("2026-08-18T11:00:00.000Z") : null}
        )
      `;
      await transaction`
        insert into crm.tasks (
          id, workspace_id, person_id, title, status,
          created_by_member_id, created_at, updated_at
        ) values (
          ${record.taskId}::uuid, ${fixture.workspaceId}::uuid,
          ${record.personId}::uuid, ${record.title}, 'open',
          ${fixture.memberId}::uuid, '2026-08-18T10:00:00.000Z',
          '2026-08-18T10:00:00.000Z'
        )
      `;
    }
  });

  const global = await request(fixture, "/api/v1/tasks?limit=100");
  const globalBody = await global.json() as {
    readonly items: readonly {
      readonly id: string;
      readonly person?: { readonly archived: boolean; readonly id: string };
    }[];
  };
  const person = await request(
    fixture,
    `/api/v1/tasks?personId=${archived.personId}`,
  );
  const personBody = await person.json() as {
    readonly items: readonly {
      readonly id: string;
      readonly person?: { readonly archived: boolean; readonly id: string };
    }[];
  };
  const mutation = await request(
    fixture,
    `/api/v1/tasks/${archived.taskId}/completion`,
    "PUT",
    { completed: true },
  );
  assert(
    global.status === 200 && globalBody.items.length === 52 &&
      globalBody.items.every((item) => item.person) &&
      globalBody.items.find((item) => item.id === archived.taskId)?.person
          ?.archived === true,
    "global task 51+ lost its person or archived state",
  );
  assert(
    person.status === 200 && personBody.items.length === 1 &&
      personBody.items[0]?.id === archived.taskId &&
      personBody.items[0].person?.archived === true,
    "person projection disagreed with the global task page",
  );
  assert(mutation.status === 409, "archived task 51+ accepted mutation");

  const firstPeople = await request(fixture, "/api/v1/people?limit=50");
  const firstPeopleBody = await firstPeople.json() as {
    readonly nextCursor?: string;
    readonly people: readonly { readonly id: string }[];
  };
  assert(
    firstPeople.status === 200 && firstPeopleBody.people.length === 50 &&
      firstPeopleBody.nextCursor,
    "active person 51 had no directory continuation",
  );
  const laterPeople = await request(
    fixture,
    `/api/v1/people?limit=50&cursor=${
      encodeURIComponent(firstPeopleBody.nextCursor)
    }`,
  );
  const laterPeopleBody = await laterPeople.json() as {
    readonly people: readonly { readonly id: string }[];
  };
  const activePerson51 = laterPeopleBody.people[0];
  assert(
    laterPeople.status === 200 && laterPeopleBody.people.length === 1 &&
      activePerson51,
    "active person 51 was unreachable",
  );
  const createdFor51 = await createTask(
    fixture,
    "Task for active person 51",
    activePerson51.id,
  );
  const filtered51 = await request(
    fixture,
    `/api/v1/tasks?personId=${activePerson51.id}`,
  );
  const filtered51Body = await filtered51.json() as {
    readonly items: readonly { readonly id: string }[];
  };
  assert(
    filtered51.status === 200 &&
      filtered51Body.items.some((item) => item.id === createdFor51.id),
    "active person 51 could not be selected for create/filter",
  );
});

Deno.test("PLANNING-001 PostgreSQL continuation reaches task 101 and binds filters", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `planning-cursor-${suffix}@example.test`,
    "Planning cursor",
  );
  const records = Array.from({ length: 101 }, (_, index) => ({
    id: crypto.randomUUID(),
    title: `Cursor task ${String(index + 1).padStart(3, "0")}`,
  }));
  await sql.begin(async (transaction) => {
    for (const record of records) {
      await transaction`
        insert into crm.tasks (
          id, workspace_id, title, status, created_by_member_id,
          created_at, updated_at
        ) values (
          ${record.id}::uuid, ${fixture.workspaceId}::uuid, ${record.title},
          'open', ${fixture.memberId}::uuid, '2026-08-18T10:00:00.000Z',
          '2026-08-18T10:00:00.000Z'
        )
      `;
    }
  });
  const first = await request(fixture, "/api/v1/tasks?limit=100&status=open");
  const firstBody = await first.json() as {
    readonly items: readonly { readonly id: string }[];
    readonly nextCursor?: string;
  };
  assert(
    first.status === 200 && firstBody.items.length === 100 &&
      firstBody.nextCursor,
    "bounded task page omitted continuation",
  );
  const second = await request(
    fixture,
    `/api/v1/tasks?limit=100&status=open&cursor=${
      encodeURIComponent(firstBody.nextCursor)
    }`,
  );
  const secondBody = await second.json() as {
    readonly items: readonly { readonly id: string }[];
    readonly nextCursor?: string;
  };
  assert(
    second.status === 200 && secondBody.items.length === 1 &&
      !secondBody.nextCursor &&
      new Set([...firstBody.items, ...secondBody.items].map((item) => item.id))
          .size === 101,
    "task 101 was unreachable or duplicated",
  );
  const filterMismatch = await request(
    fixture,
    `/api/v1/tasks?limit=100&status=completed&cursor=${
      encodeURIComponent(firstBody.nextCursor)
    }`,
  );
  const tampered = await request(
    fixture,
    `/api/v1/tasks?limit=100&status=open&cursor=${
      encodeURIComponent(`${firstBody.nextCursor}x`)
    }`,
  );
  assert(
    filterMismatch.status === 409 && tampered.status === 409,
    "task cursor was not filter-bound and tamper-safe",
  );
  const anchorId = firstBody.items.at(-1)?.id;
  assert(anchorId, "task cursor anchor missing");
  await sql`
    update crm.tasks set updated_at = updated_at + interval '1 microsecond'
    where id = ${anchorId}::uuid
  `;
  const stale = await request(
    fixture,
    `/api/v1/tasks?limit=100&status=open&cursor=${
      encodeURIComponent(firstBody.nextCursor)
    }`,
  );
  assert(stale.status === 409, "mutated task anchor did not stale its cursor");
});

Deno.test("PLANNING-001 PostgreSQL advances each successful optimistic token", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `planning-token-${suffix}@example.test`,
    "Planning token",
  );
  const created = await createTask(fixture, "Fixed clock task");
  await sql`
    update crm.tasks set updated_at = '2099-01-01T00:00:00.000000Z'
    where id = ${created.id}::uuid
  `;
  const listed = await request(fixture, "/api/v1/tasks");
  const listedBody = await listed.json() as {
    readonly items: readonly {
      readonly id: string;
      readonly updatedAt: string;
    }[];
  };
  const original = listedBody.items.find((item) => item.id === created.id);
  assert(original, "future-token task missing");
  const first = await request(
    fixture,
    `/api/v1/tasks/${created.id}`,
    "PATCH",
    { expectedUpdatedAt: original.updatedAt, title: "First edit" },
  );
  const firstBody = await first.json() as {
    readonly task?: { readonly updatedAt: string };
  };
  assert(
    first.status === 200 && firstBody.task &&
      firstBody.task.updatedAt > original.updatedAt,
    "successful mutation did not advance the optimistic token",
  );
  const stale = await request(
    fixture,
    `/api/v1/tasks/${created.id}`,
    "PATCH",
    { expectedUpdatedAt: original.updatedAt, title: "Stale edit" },
  );
  const second = await request(
    fixture,
    `/api/v1/tasks/${created.id}`,
    "PATCH",
    { expectedUpdatedAt: firstBody.task.updatedAt, title: "Second edit" },
  );
  const secondBody = await second.json() as {
    readonly task?: { readonly updatedAt: string };
  };
  assert(
    stale.status === 409 && second.status === 200 && secondBody.task &&
      secondBody.task.updatedAt > firstBody.task.updatedAt,
    `consumed token remained reusable or fresh token failed: ${
      JSON.stringify({
        first: firstBody,
        second: secondBody,
        secondStatus: second.status,
        staleStatus: stale.status,
      })
    }`,
  );
});

Deno.test("PLANNING-001 PostgreSQL keeps soft-deleted person links unavailable and read-only", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `planning-deleted-${suffix}@example.test`,
    "Planning deleted",
  );
  const personId = await createPerson(fixture, "Delete later");
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + 2);
  const dueAt = due.toISOString().replace(/\.\d{3}Z$/, ".123456Z");
  const task = await createTask(
    fixture,
    "Historical deleted link",
    personId,
    dueAt,
  );
  const detachTask = await createTask(fixture, "Deleted detach", personId);
  const reassignTask = await createTask(
    fixture,
    "Deleted reassign",
    personId,
  );
  const activeTarget = await createPerson(fixture, "Still active");
  await sql`
    update crm.people set deleted_at = now(), updated_at = now()
    where id = ${personId}::uuid and workspace_id = ${fixture.workspaceId}::uuid
  `;
  const listed = await request(fixture, "/api/v1/tasks");
  const listedBody = await listed.json() as {
    readonly items: readonly {
      readonly id: string;
      readonly person?: {
        readonly archived: boolean;
        readonly id: string;
        readonly name: string;
        readonly unavailable?: boolean;
      };
    }[];
  };
  const historical = listedBody.items.find((item) => item.id === task.id);
  const mutation = await request(
    fixture,
    `/api/v1/tasks/${task.id}/completion`,
    "PUT",
    { completed: true },
  );
  const detach = await request(
    fixture,
    `/api/v1/tasks/${detachTask.id}`,
    "PATCH",
    { expectedUpdatedAt: detachTask.updatedAt, personId: null },
  );
  const reassign = await request(
    fixture,
    `/api/v1/tasks/${reassignTask.id}`,
    "PATCH",
    { expectedUpdatedAt: reassignTask.updatedAt, personId: activeTarget },
  );
  const today = await request(fixture, "/api/v1/today/tasks");
  const todayBody = await today.json() as {
    readonly items: readonly {
      readonly dueAt?: string;
      readonly id: string;
      readonly person?: {
        readonly archived: boolean;
        readonly id: string;
        readonly name: string;
        readonly unavailable?: boolean;
      };
    }[];
  };
  const todayHistorical = todayBody.items.find((item) => item.id === task.id);
  const attention = await request(fixture, "/api/v1/today/attention");
  const attentionBody = await attention.json() as {
    readonly attention: {
      readonly nextSevenDays: readonly {
        readonly id: string;
        readonly person?: { readonly unavailable?: boolean };
      }[];
    };
  };
  const attentionHistorical = attentionBody.attention.nextSevenDays.find((
    item,
  ) => item.id === task.id);
  assert(
    listed.status === 200 && historical?.person?.id === personId &&
      historical.person.unavailable === true && historical.person.archived &&
      historical.person.name === "Deleted/Unavailable person",
    "soft-deleted person link became an anonymous workspace task",
  );
  assert(
    today.status === 200 && todayHistorical?.dueAt === dueAt &&
      todayHistorical.person?.id === personId &&
      todayHistorical.person.unavailable === true &&
      todayHistorical.person.archived === true &&
      todayHistorical.person.name === "Deleted/Unavailable person",
    `Today lost unavailable link/precision: ${JSON.stringify(todayHistorical)}`,
  );
  assert(
    attention.status === 200 &&
      attentionHistorical?.person?.unavailable === true,
    "unified Today lost the soft-deleted task link",
  );
  assert(
    mutation.status === 404 && detach.status === 404 && reassign.status === 404,
    "soft-deleted current person link escaped task read-only",
  );
});

interface CreatedReminder {
  readonly reminder: {
    readonly id: string;
    readonly nextOccurrence?: {
      readonly deliverAt: string;
      readonly id: string;
      readonly occursOn: string;
    };
  };
}

function futureReminderAnchor(now = Temporal.Now.instant()): string {
  return now.toZonedDateTimeISO("UTC").toPlainDate().add({ days: 2 })
    .toString();
}

Deno.test("PLANNING-002 reminder fixture remains future at the UTC date boundary", () => {
  const now = Temporal.Instant.from("2026-08-22T23:02:00Z");
  const anchor = futureReminderAnchor(now);
  const deliverAt = Temporal.ZonedDateTime.from(
    `${anchor}T09:00[Pacific/Kiritimati]`,
  ).toInstant();
  assert(
    Temporal.Instant.compare(deliverAt, now) > 0,
    `${deliverAt} must remain future from ${now}`,
  );
});

async function createReminder(
  fixture: Fixture,
  personId: string,
  title: string,
): Promise<CreatedReminder["reminder"]> {
  const anchor = futureReminderAnchor();
  const created = await request(fixture, "/api/v1/reminders", "POST", {
    anchorOn: anchor,
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "none",
    requestId: crypto.randomUUID(),
    sendTime: "09:00",
    title,
  });
  const body = await created.json() as CreatedReminder;
  assert(
    created.status === 201 && body.reminder.nextOccurrence,
    `${title} reminder created: ${JSON.stringify(body)}`,
  );
  return body.reminder;
}

Deno.test("PLANNING-002 PostgreSQL keeps reminder delivery, tenancy, cadence, and audit replay-safe", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-${suffix}@example.test`,
    "Reminder planning",
  );
  const foreign = await register(
    `reminder-foreign-${suffix}@example.test`,
    "Foreign reminders",
  );
  const personId = await createPerson(fixture, "Reminder person");
  const otherPersonId = await createPerson(fixture, "Other reminder person");
  const foreignPersonId = await createPerson(foreign, "Foreign person");
  const forbidden = await request(fixture, "/api/v1/reminders", "POST", {
    anchorOn: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    personId: foreignPersonId,
    recurrenceInterval: 1,
    recurrenceUnit: "none",
    requestId: crypto.randomUUID(),
    sendTime: "09:00",
    title: "Cross tenant",
  });
  assert(
    forbidden.status === 404,
    "cross-workspace reminder person was accepted",
  );

  const cadenceRequestId = crypto.randomUUID();
  const cadencePayload = {
    intervalCount: 1,
    intervalUnit: "month",
    personId,
    requestId: cadenceRequestId,
  };
  const cadence = await request(
    fixture,
    "/api/v1/stay-in-touch-cadences",
    "POST",
    cadencePayload,
  );
  assert(cadence.status === 201, "stay-in-touch cadence created");
  assert(
    (await request(
      fixture,
      "/api/v1/stay-in-touch-cadences",
      "POST",
      cadencePayload,
    )).status === 201,
    "same cadence request did not replay",
  );
  assert(
    (await request(
      fixture,
      "/api/v1/stay-in-touch-cadences",
      "POST",
      { ...cadencePayload, intervalCount: 2 },
    )).status === 409,
    "changed cadence request replay was accepted",
  );
  assert(
    (await request(
      fixture,
      "/api/v1/stay-in-touch-cadences",
      "POST",
      { ...cadencePayload, personId: otherPersonId },
    )).status === 409,
    "cross-person cadence request reuse was accepted",
  );
  await sql`
    update crm.stay_in_touch_cadences set next_due_at = now() - interval '1 day'
    where person_id = ${personId}::uuid
  `;
  const attention = await request(fixture, "/api/v1/today/attention");
  const attentionBody = await attention.json() as {
    readonly attention: {
      readonly overdue: readonly {
        readonly id: string;
        readonly kind: string;
      }[];
    };
  };
  assert(
    attention.status === 200 &&
      attentionBody.attention.overdue.some((item) => item.kind === "cadence"),
    "due cadence was absent from unified Today attention",
  );
  const [cadenceAudit] = await sql<{ readonly count: number }[]>`
    select count(*)::int as count from crm.audit_events
    where workspace_id = ${fixture.workspaceId}::uuid
      and action = 'planning.reminder-cadence-created'
  `;
  assert(cadenceAudit?.count === 1, "cadence replay duplicated audit evidence");
  const [cadenceBefore] = await sql<{
    last_contacted_at: string | null;
    next_due_at: string;
    updated_at: string;
  }[]>`
    select last_contacted_at::text, next_due_at::text, updated_at::text
    from crm.stay_in_touch_cadences where person_id = ${personId}::uuid
  `;
  assert(cadenceBefore, "cadence persistence missing");
  const oldActivity = {
    happenedAt: new Date(Date.now() - 86_400_000).toISOString(),
    kind: "activity",
    participantIds: [personId],
    requestId: crypto.randomUUID(),
    summary: "Older imported contact",
  };
  assert(
    (await request(fixture, "/api/v1/interactions", "POST", oldActivity))
      .status === 201,
    "older activity recorded",
  );
  const [afterOld] = await sql<{
    last_contacted_at: string | null;
    next_due_at: string;
    updated_at: string;
  }[]>`
    select last_contacted_at::text, next_due_at::text, updated_at::text
    from crm.stay_in_touch_cadences where person_id = ${personId}::uuid
  `;
  assert(
    afterOld?.last_contacted_at === cadenceBefore.last_contacted_at &&
      afterOld?.next_due_at === cadenceBefore.next_due_at &&
      afterOld?.updated_at === cadenceBefore.updated_at,
    "older interaction regressed cadence",
  );
  const newerHappenedAt = new Date(Date.now() + 3_600_000).toISOString();
  const newerActivity = {
    happenedAt: newerHappenedAt,
    kind: "activity",
    participantIds: [personId],
    requestId: crypto.randomUUID(),
    summary: "Current contact",
  };
  assert(
    (await request(fixture, "/api/v1/interactions", "POST", newerActivity))
      .status === 201,
    "newer activity recorded",
  );
  const [afterNew] = await sql<{
    last_contacted_at: string | null;
    next_due_at: string;
    updated_at: string;
  }[]>`
    select last_contacted_at::text, next_due_at::text, updated_at::text
    from crm.stay_in_touch_cadences where person_id = ${personId}::uuid
  `;
  const replayActivity = {
    ...newerActivity,
    requestId: crypto.randomUUID(),
  };
  assert(
    (await request(fixture, "/api/v1/interactions", "POST", replayActivity))
      .status === 201,
    "equivalent contact replay recorded",
  );
  const [afterReplay] = await sql<{
    last_contacted_at: string | null;
    next_due_at: string;
    updated_at: string;
  }[]>`
    select last_contacted_at::text, next_due_at::text, updated_at::text
    from crm.stay_in_touch_cadences where person_id = ${personId}::uuid
  `;
  assert(
    afterNew !== undefined && afterReplay !== undefined &&
      afterNew.last_contacted_at !== null &&
      Date.parse(afterNew.last_contacted_at) === Date.parse(newerHappenedAt) &&
      afterReplay?.next_due_at === afterNew.next_due_at &&
      afterReplay.updated_at === afterNew.updated_at,
    `new/replayed interaction did not advance cadence monotonically: ${
      JSON.stringify({ afterNew, afterReplay, newerHappenedAt })
    }`,
  );

  const provider = new DurableFakeProvider();
  const worker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider,
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });
  const ambiguous = await createReminder(fixture, personId, "Ambiguous effect");
  const ambiguousOccurrence = ambiguous.nextOccurrence!.id;
  const inheritedTimezone = await request(
    fixture,
    "/api/v1/settings/workspace",
    "PUT",
    {
      defaultLocale: "en",
      defaultReminderTime: "09:00",
      defaultTimezone: "Europe/Belgrade",
      name: "Reminder workspace",
    },
  );
  const [inheritedRegenerated] = await sql<{ readonly deliver_at: string }[]>`
    select deliver_at::text from crm.reminder_occurrences
    where id = ${ambiguousOccurrence}::uuid
  `;
  assert(
    inheritedTimezone.status === 200 && inheritedRegenerated &&
      Date.parse(inheritedRegenerated.deliver_at) !==
        Date.parse(ambiguous.nextOccurrence!.deliverAt),
    "workspace default timezone did not regenerate inherited occurrence",
  );
  const changedTimezone = await request(
    fixture,
    "/api/v1/settings/preferences",
    "PUT",
    {
      contactNameOrder: "given_family_nickname",
      contactSortOrder: "given_name_asc",
      fluidLayout: false,
      locale: "en",
      measurementSystem: "metric",
      temperatureScale: "celsius",
      timezone: "America/New_York",
    },
  );
  const [regenerated] = await sql<{ readonly deliver_at: string }[]>`
    select deliver_at::text from crm.reminder_occurrences
    where id = ${ambiguousOccurrence}::uuid
  `;
  assert(
    changedTimezone.status === 200 && regenerated &&
      Date.parse(regenerated.deliver_at) !==
        Date.parse(ambiguous.nextOccurrence!.deliverAt),
    "effective timezone change did not regenerate the future occurrence",
  );
  const explicitDeliverAt = regenerated.deliver_at;
  const changedDefaultWithOverride = await request(
    fixture,
    "/api/v1/settings/workspace",
    "PUT",
    {
      defaultLocale: "en",
      defaultReminderTime: "09:00",
      defaultTimezone: "Asia/Tokyo",
      name: "Reminder workspace",
    },
  );
  const [afterDefaultWithOverride] = await sql<
    { readonly deliver_at: string }[]
  >`
    select deliver_at::text from crm.reminder_occurrences
    where id = ${ambiguousOccurrence}::uuid
  `;
  assert(
    changedDefaultWithOverride.status === 200 &&
      afterDefaultWithOverride?.deliver_at === explicitDeliverAt,
    "workspace default changed an explicit member timezone occurrence",
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id = ${ambiguousOccurrence}::uuid
  `;
  provider.throwAfterNextEffect = true;
  const first = await worker.tick({
    maxAttempts: 3,
    owner: "integration-a",
    retryBaseMilliseconds: 1_000,
  });
  assert(
    first.claimed === 1 && first.results[0]?.status === "retry",
    "ambiguous effect did not enter retry",
  );
  await sql`
    update crm.reminder_occurrences set next_attempt_at = now() - interval '1 second'
    where id = ${ambiguousOccurrence}::uuid
  `;
  const reconciled = await worker.tick({
    maxAttempts: 3,
    owner: "integration-b",
  });
  assert(
    reconciled.claimed === 1 && reconciled.results[0]?.status === "sent",
    "ambiguous effect did not reconcile",
  );

  const duplicate = await createReminder(
    fixture,
    personId,
    "Duplicate workers",
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id = ${duplicate.nextOccurrence!.id}::uuid
  `;
  const concurrent = await Promise.all([
    worker.tick({ owner: "integration-c" }),
    worker.tick({ owner: "integration-d" }),
  ]);
  assert(
    concurrent.reduce((sum, result) => sum + result.claimed, 0) === 1,
    "duplicate workers claimed one occurrence twice",
  );

  const unsupported = await createReminder(fixture, personId, "Legacy email");
  await sql`
    update crm.reminder_occurrences set channel = 'email',
      deliver_at = now() - interval '1 minute'
    where id = ${unsupported.nextOccurrence!.id}::uuid
  `;
  const unsupportedClaims = await deliveryRepository.claimDue({
    leaseExpiresAt: new Date(Date.now() + 30_000),
    limit: 10,
    now: new Date(),
    owner: "unsupported-channel-check",
  });
  assert(
    unsupportedClaims.every((claim) =>
      claim.id !== unsupported.nextOccurrence!.id
    ),
    "unsupported email occurrence was claimed",
  );

  const crash = await createReminder(fixture, personId, "Process death");
  const crashOccurrence = crash.nextOccurrence!.id;
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id = ${crashOccurrence}::uuid
  `;
  const [crashedClaim] = await deliveryRepository.claimDue({
    leaseExpiresAt: new Date(Date.now() + 30_000),
    limit: 1,
    now: new Date(),
    owner: "crashed-worker",
  });
  assert(
    crashedClaim?.id === crashOccurrence,
    "crashed process did not claim expected occurrence",
  );
  const durableEffects = new PostgresInAppReminderEffectStore(
    deliveryConnection.db,
    { now: () => new Date() },
  );
  const durableProvider = new InAppReminderDelivery(durableEffects);
  await durableProvider.deliver({
    idempotencyKey: crashedClaim.providerIdempotencyKey,
    occurrenceId: crashedClaim.id,
  });
  const [effectBeforeFinalize] = await sql<{
    readonly provider_effect_at: string | null;
    readonly provider_receipt: string | null;
    readonly provider_result_state: string;
    readonly status: string;
    readonly visible_at: string | null;
  }[]>`
    select status, provider_result_state, provider_receipt,
      provider_effect_at::text, visible_at::text
    from crm.reminder_occurrences where id = ${crashOccurrence}::uuid
  `;
  assert(
    effectBeforeFinalize?.status === "claimed" &&
      effectBeforeFinalize.provider_result_state === "confirmed" &&
      effectBeforeFinalize.provider_receipt !== null &&
      effectBeforeFinalize.provider_effect_at !== null &&
      effectBeforeFinalize.visible_at !== null,
    "in-app effect was not durable and visible before worker finalization",
  );
  const visiblePerson = await request(
    fixture,
    `/api/v1/people/${personId}/reminders`,
  );
  const visiblePersonBody = await visiblePerson.json() as {
    readonly reminders: readonly {
      readonly nextOccurrence?: {
        readonly id: string;
        readonly status: string;
        readonly visibleAt?: string;
      };
    }[];
  };
  const visibleToday = await request(fixture, "/api/v1/today/reminders");
  const visibleTodayBody = await visibleToday.json() as {
    readonly reminders: readonly {
      readonly id: string;
      readonly status: string;
      readonly visibleAt?: string;
    }[];
  };
  assert(
    visiblePerson.status === 200 &&
      visiblePersonBody.reminders.some((item) =>
        item.nextOccurrence?.id === crashOccurrence &&
        item.nextOccurrence.status === "claimed" &&
        item.nextOccurrence.visibleAt
      ) && visibleToday.status === 200 &&
      visibleTodayBody.reminders.some((item) =>
        item.id === crashOccurrence && item.status === "claimed" &&
        item.visibleAt
      ),
    `confirmed visible effect was hidden before worker finalization: ${
      JSON.stringify({ visiblePersonBody, visibleTodayBody })
    }`,
  );
  await sql`
    update crm.reminder_occurrences set lease_expires_at = now() - interval '1 second'
    where id = ${crashOccurrence}::uuid
  `;
  const durableWorker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider: durableProvider,
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });
  const recovered = await durableWorker.tick({ owner: "integration-recovery" });
  assert(
    recovered.claimed === 1 && recovered.results[0]?.status === "sent",
    "expired lease did not recover after process death",
  );

  const deliveryProof = await sql<{
    audits: number;
    attempts: number;
    status: string;
    visible_effects: number;
  }[]>`
    select occurrence.attempt_count as attempts, occurrence.status,
      case when occurrence.provider_effect_at is not null and occurrence.visible_at is not null then 1 else 0 end as visible_effects,
      (select count(*)::int from crm.audit_events audit
       where audit.subject_id = occurrence.id
         and audit.action = 'planning.reminder-delivered') as audits
    from crm.reminder_occurrences occurrence
    where occurrence.id = ${crashOccurrence}::uuid
  `;
  assert(
    deliveryProof[0]?.status === "sent" && deliveryProof[0].attempts === 2 &&
      deliveryProof[0].audits === 1 && deliveryProof[0].visible_effects === 1 &&
      provider.effects.size === 2,
    `delivery replay proof failed: ${
      JSON.stringify(deliveryProof[0])
    }, effects=${provider.effects.size}`,
  );
  const today = await request(fixture, "/api/v1/today/reminders");
  const todayBody = await today.json() as {
    readonly reminders: readonly {
      readonly id: string;
      readonly status: string;
      readonly visibleAt?: string;
    }[];
  };
  assert(
    today.status === 200 &&
      todayBody.reminders.some((item) =>
        item.id === crashOccurrence && item.status === "sent" && item.visibleAt
      ),
    "Today did not expose delivered in-app state",
  );
});

Deno.test("PLANNING-002 PostgreSQL replenishes ninth occurrence and enforces delivery lifecycle", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-rolling-${suffix}@example.test`,
    "Rolling reminders",
  );
  const personId = await createPerson(fixture, "Rolling person");
  assert(
    (await request(fixture, "/api/v1/settings/workspace", "PUT", {
      defaultLocale: "en",
      defaultReminderTime: "02:30",
      defaultTimezone: "Europe/Belgrade",
      name: "Rolling reminders",
    })).status === 200,
    "rolling fixture timezone saved",
  );
  const created = await request(fixture, "/api/v1/reminders", "POST", {
    anchorOn: "2026-10-20",
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "day",
    requestId: crypto.randomUUID(),
    sendTime: "02:30",
    title: "DST rolling reminder",
  });
  const createdBody = await created.json() as CreatedReminder;
  const reminderId = createdBody.reminder.id;
  assert(created.status === 201, "rolling reminder created");
  await sql`
    update crm.reminder_occurrences set status = 'sent', sent_at = deliver_at,
      provider_receipt = 'seed-receipt', provider_result_state = 'confirmed',
      provider_effect_at = deliver_at, visible_at = deliver_at
    where reminder_id = ${reminderId}::uuid and occurs_on = '2026-10-20'::date
  `;
  const rollingWorker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date("2026-10-20T03:00:00Z") },
    provider: new DurableFakeProvider(),
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });
  await Promise.all([
    rollingWorker.tick({ owner: "rolling-a" }),
    rollingWorker.tick({ owner: "rolling-b" }),
  ]);
  await rollingWorker.tick({ owner: "rolling-replay" });
  const [rolling] = await sql<{
    readonly count: number;
    readonly distinct_count: number;
    readonly ninth_at: string | null;
  }[]>`
    select count(*)::int as count,
      count(distinct (deliver_at, channel))::int as distinct_count,
      max(deliver_at)::text as ninth_at
    from crm.reminder_occurrences where reminder_id = ${reminderId}::uuid
  `;
  assert(
    rolling?.count === 9 && rolling.distinct_count === 9 &&
      rolling.ninth_at !== null &&
      Date.parse(rolling.ninth_at) === Date.parse("2026-10-28T01:30:00Z"),
    `rolling generation stopped or duplicated: ${JSON.stringify(rolling)}`,
  );
});

Deno.test("PLANNING-002 PostgreSQL excludes inactive delivery lifecycles", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-lifecycle-${suffix}@example.test`,
    "Reminder lifecycle",
  );
  const personId = await createPerson(fixture, "Lifecycle person");
  const archiveReminder = await createReminder(
    fixture,
    personId,
    "Archived lifecycle",
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id = ${archiveReminder.nextOccurrence!.id}::uuid
  `;
  await sql`update crm.people set archived_at = now() where id = ${personId}::uuid`;
  const archivedClaims = await deliveryRepository.claimDue({
    leaseExpiresAt: new Date(Date.now() + 30_000),
    limit: 100,
    now: new Date(),
    owner: "archived-lifecycle",
  });
  assert(
    archivedClaims.every((item) =>
      item.id !== archiveReminder.nextOccurrence!.id
    ),
    "archived person reminder was claimable",
  );
  await sql`
    update crm.people set archived_at = null, deleted_at = now()
    where id = ${personId}::uuid
  `;
  const deletedClaims = await deliveryRepository.claimDue({
    leaseExpiresAt: new Date(Date.now() + 30_000),
    limit: 100,
    now: new Date(),
    owner: "deleted-lifecycle",
  });
  assert(
    deletedClaims.every((item) =>
      item.id !== archiveReminder.nextOccurrence!.id
    ),
    "deleted person reminder was claimable",
  );
  await sql`update crm.people set deleted_at = null where id = ${personId}::uuid`;
  await sql`
    update crm.workspace_members set status = 'left', left_at = now()
    where id = ${fixture.memberId}::uuid
  `;
  const departedClaims = await deliveryRepository.claimDue({
    leaseExpiresAt: new Date(Date.now() + 30_000),
    limit: 100,
    now: new Date(),
    owner: "departed-lifecycle",
  });
  assert(
    departedClaims.every((item) =>
      item.id !== archiveReminder.nextOccurrence!.id
    ),
    "departed member reminder was claimable",
  );
  await sql`
    update crm.workspace_members set status = 'active', left_at = null
    where id = ${fixture.memberId}::uuid
  `;
  await sql`
    update crm.workspaces set status = 'suspended'
    where id = ${fixture.workspaceId}::uuid
  `;
  const inactiveWorkspaceClaims = await deliveryRepository.claimDue({
    leaseExpiresAt: new Date(Date.now() + 30_000),
    limit: 100,
    now: new Date(),
    owner: "workspace-lifecycle",
  });
  assert(
    inactiveWorkspaceClaims.every((item) =>
      item.id !== archiveReminder.nextOccurrence!.id
    ),
    "inactive workspace reminder was claimable",
  );
});

Deno.test("PLANNING-002 PostgreSQL scopes and retains cadence request history", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-history-${suffix}@example.test`,
    "Reminder history",
  );
  const foreign = await register(
    `reminder-history-foreign-${suffix}@example.test`,
    "Foreign reminder history",
  );
  const personId = await createPerson(fixture, "History person");
  const foreignPersonId = await createPerson(foreign, "Foreign history person");
  const requestA = crypto.randomUUID();
  const requestB = crypto.randomUUID();
  const payloadA = {
    intervalCount: 1,
    intervalUnit: "month",
    personId,
    requestId: requestA,
  };
  assert(
    (await request(
      fixture,
      "/api/v1/stay-in-touch-cadences",
      "POST",
      payloadA,
    )).status === 201,
    "first cadence request accepted",
  );
  assert(
    (await request(foreign, "/api/v1/stay-in-touch-cadences", "POST", {
      ...payloadA,
      personId: foreignPersonId,
    })).status === 201,
    "same cadence request UUID was not workspace scoped",
  );
  assert(
    (await request(fixture, "/api/v1/stay-in-touch-cadences", "POST", {
      ...payloadA,
      intervalCount: 2,
      requestId: requestB,
    })).status === 201,
    "second cadence request accepted",
  );
  const replayA = await request(
    fixture,
    "/api/v1/stay-in-touch-cadences",
    "POST",
    payloadA,
  );
  const [cadenceState] = await sql<{ readonly interval_count: number }[]>`
    select interval_count from crm.stay_in_touch_cadences
    where person_id = ${personId}::uuid
  `;
  assert(
    replayA.status === 201 && cadenceState?.interval_count === 2,
    `A-B-replay-A mutated cadence: ${JSON.stringify(cadenceState)}`,
  );
});

Deno.test("PLANNING-002 PostgreSQL projects one relevant occurrence from bounded history", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-projection-${suffix}@example.test`,
    "Reminder projection",
  );
  const personId = await createPerson(fixture, "Projection person");
  const reminder = await createReminder(
    fixture,
    personId,
    "Relevant occurrence",
  );
  const occurrenceId = reminder.nextOccurrence!.id;
  await sql`
    update crm.reminder_occurrences set deliver_at = now() + interval '1 day'
    where id = ${occurrenceId}::uuid
  `;
  await sql`
    insert into crm.reminder_occurrences (
      reminder_id, member_id, occurs_on, deliver_at, channel, status,
      sent_at, title_snapshot, body_snapshot, provider_receipt,
      provider_result_state, provider_effect_at, visible_at
    )
    select reminder_id, member_id, (current_date - generated)::date,
      now() - generated * interval '1 day', channel, 'sent',
      now() - generated * interval '1 day', title_snapshot, body_snapshot,
      'history-' || generated::text, 'confirmed',
      now() - generated * interval '1 day',
      now() - generated * interval '1 day'
    from crm.reminder_occurrences cross join generate_series(1, 150) generated
    where id = ${occurrenceId}::uuid
  `;
  const personResponse = await request(
    fixture,
    `/api/v1/people/${personId}/reminders`,
  );
  const personBody = await personResponse.json() as {
    readonly reminders: readonly {
      readonly id: string;
      readonly nextOccurrence?: { readonly id: string };
    }[];
  };
  const todayResponse = await request(fixture, "/api/v1/today/reminders");
  const todayBody = await todayResponse.json() as {
    readonly reminders: readonly {
      readonly id: string;
      readonly title: string;
    }[];
  };
  assert(
    personResponse.status === 200 &&
      personBody.reminders.find((item) => item.id === reminder.id)
          ?.nextOccurrence?.id === occurrenceId &&
      todayResponse.status === 200 &&
      todayBody.reminders.filter((item) => item.title === "Relevant occurrence")
          .length === 1 &&
      todayBody.reminders.length < 100,
    `stale sent history dominated or expanded reminder projections: ${
      JSON.stringify({
        personBody,
        relevantToday: todayBody.reminders.filter((item) =>
          item.title === "Relevant occurrence"
        ),
        todayCount: todayBody.reminders.length,
      })
    }`,
  );
});

Deno.test("PLANNING-002 PostgreSQL projects retry authority separately from original delivery", async () => {
  const fixture = await register(
    `reminder-retry-projection-${crypto.randomUUID()}@example.test`,
    "Reminder retry projection",
  );
  const personId = await createPerson(fixture, "Retry projection person");
  const retry = await createReminder(fixture, personId, "Retry authority");
  const pending = await createReminder(fixture, personId, "Pending authority");
  await sql`
    update crm.reminder_occurrences set status = 'retry', attempt_count = 1,
      deliver_at = now() + interval '1 hour',
      next_attempt_at = now() + interval '2 days'
    where id = ${retry.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'pending',
      deliver_at = now() + interval '3 hours', next_attempt_at = null
    where id = ${pending.nextOccurrence!.id}::uuid
  `;
  const response = await request(fixture, "/api/v1/today/reminders");
  const body = await response.json() as {
    readonly reminders: readonly {
      readonly deliverAt: string;
      readonly id: string;
      readonly nextAttemptAt?: string;
      readonly status: string;
    }[];
  };
  const retryItem = body.reminders.find((item) =>
    item.id === retry.nextOccurrence!.id
  );
  const pendingItem = body.reminders.find((item) =>
    item.id === pending.nextOccurrence!.id
  );
  assert(
    response.status === 200 && retryItem?.status === "retry" &&
      retryItem.nextAttemptAt !== undefined &&
      retryItem.nextAttemptAt !== retryItem.deliverAt &&
      pendingItem?.status === "pending" &&
      !("nextAttemptAt" in pendingItem),
    `retry/pending schedule authority leaked: ${JSON.stringify(body)}`,
  );
});

Deno.test("PLANNING-002 PostgreSQL timezone regeneration preserves actionability and attempts", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-timezone-${suffix}@example.test`,
    "Timezone reminders",
  );
  const personId = await createPerson(fixture, "Timezone person");
  const pastZone = "Pacific/Kiritimati";
  const futureZone = "America/Adak";
  const futureLocal = Temporal.Now.instant().add({ hours: 10 })
    .toZonedDateTimeISO(futureZone).toPlainDateTime();
  const occursOn = futureLocal.toPlainDate().toString();
  const sendTime = `${String(futureLocal.hour).padStart(2, "0")}:${
    String(futureLocal.minute).padStart(2, "0")
  }`;
  const preferencePayload = (timezone?: string) => ({
    contactNameOrder: "given_family_nickname",
    contactSortOrder: "given_name_asc",
    fluidLayout: false,
    locale: "en",
    measurementSystem: "metric",
    temperatureScale: "celsius",
    ...(timezone ? { timezone } : {}),
  });
  const workspacePayload = (timezone: string) => ({
    defaultLocale: "en",
    defaultReminderTime: "09:00",
    defaultTimezone: timezone,
    name: "Timezone reminders",
  });
  const state = async (occurrenceId: string) => {
    const [row] = await sql<{
      readonly attempt_count: number;
      readonly deliver_at: string;
      readonly error: string | null;
      readonly last_attempt_at: string | null;
      readonly next_attempt_at: string | null;
      readonly provider_result_state: string;
      readonly status: string;
    }[]>`
      select attempt_count, deliver_at::text, error,
        last_attempt_at::text, next_attempt_at::text,
        provider_result_state, status
      from crm.reminder_occurrences where id = ${occurrenceId}::uuid
    `;
    assert(row, `occurrence ${occurrenceId} missing`);
    return row;
  };
  const preparePending = async (
    reminderId: string,
    occurrenceId: string,
    timezone: string,
  ) => {
    await sql`
      update crm.reminders set send_time = ${sendTime}::time, updated_at = now()
      where id = ${reminderId}::uuid
    `;
    await sql`
      update crm.reminder_occurrences set
        occurs_on = ${occursOn}::date,
        deliver_at = (${occursOn}::date + ${sendTime}::time)
          at time zone ${timezone},
        status = 'pending', attempt_count = 0, last_attempt_at = null,
        next_attempt_at = null, claim_token = null, claim_owner = null,
        lease_expires_at = null, provider_result_state = 'unattempted',
        provider_receipt = null, provider_effect_at = null, visible_at = null,
        sent_at = null, error = null, updated_at = now()
      where id = ${occurrenceId}::uuid
    `;
  };
  const worker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider: new InAppReminderDelivery(
      new PostgresInAppReminderEffectStore(deliveryConnection.db, {
        now: () => new Date(),
      }),
    ),
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });

  assert(
    (await request(
      fixture,
      "/api/v1/settings/preferences",
      "PUT",
      preferencePayload(pastZone),
    )).status === 200,
    "initial member timezone saved",
  );
  const memberReminder = await createReminder(
    fixture,
    personId,
    "Member timezone direction",
  );
  const attemptedReminder = await createReminder(
    fixture,
    personId,
    "Attempted timezone state",
  );
  await preparePending(
    memberReminder.id,
    memberReminder.nextOccurrence!.id,
    pastZone,
  );
  await sql`
    update crm.reminder_occurrences set status = 'retry', attempt_count = 1,
      last_attempt_at = now(), next_attempt_at = now() + interval '2 days',
      deliver_at = now() + interval '1 day', error = 'keep-retry',
      provider_result_state = 'ambiguous', updated_at = now()
    where id = ${attemptedReminder.nextOccurrence!.id}::uuid
  `;
  const attemptedBefore = await state(attemptedReminder.nextOccurrence!.id);

  assert(
    (await request(
      fixture,
      "/api/v1/settings/preferences",
      "PUT",
      preferencePayload(futureZone),
    )).status === 200,
    "member timezone moved toward future",
  );
  const memberFuture = await state(memberReminder.nextOccurrence!.id);
  assert(
    memberFuture.status === "pending" &&
      Date.parse(memberFuture.deliver_at) > Date.now(),
    `past member occurrence was not moved into the future: ${
      JSON.stringify(memberFuture)
    }`,
  );
  assert(
    JSON.stringify(await state(attemptedReminder.nextOccurrence!.id)) ===
      JSON.stringify(attemptedBefore),
    "member timezone change reset attempted retry/ambiguous state",
  );
  assert(
    (await worker.tick({ owner: "member-future" })).claimed === 0,
    "future-regenerated member occurrence was claimed early",
  );

  assert(
    (await request(
      fixture,
      "/api/v1/settings/preferences",
      "PUT",
      preferencePayload(pastZone),
    )).status === 200,
    "member timezone moved toward past",
  );
  const memberPast = await state(memberReminder.nextOccurrence!.id);
  assert(
    memberPast.status === "pending" &&
      Date.parse(memberPast.deliver_at) <= Date.now(),
    `future member occurrence lost past-due actionability: ${
      JSON.stringify(memberPast)
    }`,
  );
  const memberDelivery = await worker.tick({ owner: "member-past" });
  assert(
    memberDelivery.claimed === 1 &&
      memberDelivery.results[0]?.id === memberReminder.nextOccurrence!.id,
    "past-regenerated member occurrence was not actionable",
  );

  assert(
    (await request(
          fixture,
          "/api/v1/settings/preferences",
          "PUT",
          preferencePayload(),
        )).status === 200 &&
      (await request(
          fixture,
          "/api/v1/settings/workspace",
          "PUT",
          workspacePayload(pastZone),
        )).status === 200,
    "inherited workspace timezone prepared",
  );
  const workspaceReminder = await createReminder(
    fixture,
    personId,
    "Workspace timezone direction",
  );
  await preparePending(
    workspaceReminder.id,
    workspaceReminder.nextOccurrence!.id,
    pastZone,
  );
  assert(
    (await request(
      fixture,
      "/api/v1/settings/workspace",
      "PUT",
      workspacePayload(futureZone),
    )).status === 200,
    "workspace timezone moved toward future",
  );
  const workspaceFuture = await state(workspaceReminder.nextOccurrence!.id);
  assert(
    workspaceFuture.status === "pending" &&
      Date.parse(workspaceFuture.deliver_at) > Date.now() &&
      (await worker.tick({ owner: "workspace-future" })).claimed === 0,
    `past inherited occurrence was claimable after moving future: ${
      JSON.stringify(workspaceFuture)
    }`,
  );
  assert(
    (await request(
      fixture,
      "/api/v1/settings/workspace",
      "PUT",
      workspacePayload(pastZone),
    )).status === 200,
    "workspace timezone moved toward past",
  );
  const workspacePast = await state(workspaceReminder.nextOccurrence!.id);
  const workspaceDelivery = await worker.tick({ owner: "workspace-past" });
  assert(
    workspacePast.status === "pending" &&
      Date.parse(workspacePast.deliver_at) <= Date.now() &&
      workspaceDelivery.claimed === 1 &&
      workspaceDelivery.results[0]?.id === workspaceReminder.nextOccurrence!.id,
    `future inherited occurrence lost actionability: ${
      JSON.stringify({ workspacePast, workspaceDelivery })
    }`,
  );
  assert(
    JSON.stringify(await state(attemptedReminder.nextOccurrence!.id)) ===
      JSON.stringify(attemptedBefore),
    "workspace timezone change reset attempted retry/ambiguous state",
  );
});

Deno.test("PLANNING-002 PostgreSQL keeps one stable calendar identity across timezone replenishment", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-identity-${suffix}@example.test`,
    "Identity reminders",
  );
  const personId = await createPerson(fixture, "Identity person");
  const pastZone = "Pacific/Kiritimati";
  const futureZone = "America/Adak";
  const preferencePayload = (timezone?: string) => ({
    contactNameOrder: "given_family_nickname",
    contactSortOrder: "given_name_asc",
    fluidLayout: false,
    locale: "en",
    measurementSystem: "metric",
    temperatureScale: "celsius",
    ...(timezone ? { timezone } : {}),
  });
  const workspacePayload = (timezone: string) => ({
    defaultLocale: "en",
    defaultReminderTime: "09:00",
    defaultTimezone: timezone,
    name: "Identity reminders",
  });
  const createDaily = async (title: string) => {
    const response = await request(fixture, "/api/v1/reminders", "POST", {
      anchorOn: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      personId,
      recurrenceInterval: 1,
      recurrenceUnit: "day",
      requestId: crypto.randomUUID(),
      sendTime: "09:00",
      title,
    });
    const body = await response.json() as CreatedReminder;
    assert(response.status === 201 && body.reminder.nextOccurrence, title);
    return body.reminder;
  };
  const markRetry = (occurrenceId: string) =>
    sql`
    update crm.reminder_occurrences set status = 'retry', attempt_count = 1,
      last_attempt_at = now(), next_attempt_at = now() + interval '1 day',
      provider_result_state = 'ambiguous', error = 'preserve-attempt',
      updated_at = now()
    where id = ${occurrenceId}::uuid
  `;
  const identityCount = async (reminderId: string, occursOn: string) => {
    const [row] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.reminder_occurrences
      where reminder_id = ${reminderId}::uuid
        and member_id = ${fixture.memberId}::uuid
        and occurs_on = ${occursOn}::date and channel = 'in_app'
    `;
    return row?.count ?? 0;
  };
  const managementRepository = new PostgresReminderRepository(
    new PostgresActorRevalidation(),
  );
  const worker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider: new InAppReminderDelivery(
      new PostgresInAppReminderEffectStore(deliveryConnection.db, {
        now: () => new Date(),
      }),
    ),
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });

  assert(
    (await request(
      fixture,
      "/api/v1/settings/preferences",
      "PUT",
      preferencePayload(pastZone),
    )).status === 200,
    "member identity timezone prepared",
  );
  const memberReminder = await createDaily("Member stable identity");
  const memberOccurrence = memberReminder.nextOccurrence!;
  await markRetry(memberOccurrence.id);
  assert(
    (await request(
      fixture,
      "/api/v1/settings/preferences",
      "PUT",
      preferencePayload(futureZone),
    )).status === 200,
    "member identity timezone changed",
  );
  await Promise.all([
    deliveryTransaction.run((transaction) =>
      managementRepository.regenerateForTimezone({
        memberId: fixture.memberId,
        now: new Date(),
        role: fixture.role,
        timezone: futureZone,
        transaction,
        userId: fixture.userId,
        workspaceId: fixture.workspaceId,
      })
    ),
    deliveryRepository.replenish({ now: new Date() }),
  ]);
  assert(
    await identityCount(memberReminder.id, memberOccurrence.occursOn) === 1,
    "member timezone replenishment duplicated one calendar occurrence",
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute',
      next_attempt_at = now() - interval '1 second'
    where reminder_id = ${memberReminder.id}::uuid
      and occurs_on = ${memberOccurrence.occursOn}::date
  `;
  assert(
    (await worker.tick({ maxAttempts: 1, owner: "member-identity" }))
      .claimed ===
      1,
    "member calendar identity was claimed more than once",
  );

  assert(
    (await request(
          fixture,
          "/api/v1/settings/preferences",
          "PUT",
          preferencePayload(),
        )).status === 200 &&
      (await request(
          fixture,
          "/api/v1/settings/workspace",
          "PUT",
          workspacePayload(pastZone),
        )).status === 200,
    "workspace identity timezone prepared",
  );
  const workspaceReminder = await createDaily("Workspace stable identity");
  const workspaceOccurrence = workspaceReminder.nextOccurrence!;
  await markRetry(workspaceOccurrence.id);
  assert(
    (await request(
      fixture,
      "/api/v1/settings/workspace",
      "PUT",
      workspacePayload(futureZone),
    )).status === 200,
    "workspace identity timezone changed",
  );
  await Promise.all([
    deliveryTransaction.run((transaction) =>
      managementRepository.regenerateForWorkspaceTimezone({
        now: new Date(),
        timezone: futureZone,
        transaction,
        workspaceId: fixture.workspaceId,
      })
    ),
    deliveryRepository.replenish({ now: new Date() }),
  ]);
  assert(
    await identityCount(workspaceReminder.id, workspaceOccurrence.occursOn) ===
      1,
    "workspace timezone replenishment duplicated one calendar occurrence",
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute',
      next_attempt_at = now() - interval '1 second'
    where reminder_id = ${workspaceReminder.id}::uuid
      and occurs_on = ${workspaceOccurrence.occursOn}::date
  `;
  assert(
    (await worker.tick({ maxAttempts: 1, owner: "workspace-identity" }))
      .claimed === 1,
    "workspace calendar identity was claimed more than once",
  );
});

Deno.test("PLANNING-002 PostgreSQL regeneration cannot overwrite a concurrent claim", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-race-${suffix}@example.test`,
    "Race reminders",
  );
  const personId = await createPerson(fixture, "Race person");
  const preferencePayload = (timezone?: string) => ({
    contactNameOrder: "given_family_nickname",
    contactSortOrder: "given_name_asc",
    fluidLayout: false,
    locale: "en",
    measurementSystem: "metric",
    temperatureScale: "celsius",
    ...(timezone ? { timezone } : {}),
  });
  const workspacePayload = (timezone: string) => ({
    defaultLocale: "en",
    defaultReminderTime: "09:00",
    defaultTimezone: timezone,
    name: "Race reminders",
  });
  const waitForClaimBlock = async (
    signal: AbortSignal,
    claimBackendPid: number,
  ) => {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      if (signal.aborted) return "cancelled" as const;
      const [row] = await sql<{ readonly waiting: boolean }[]>`
        select exists (
          select 1 from pg_stat_activity
          where pid <> pg_backend_pid() and state = 'active'
            and ${claimBackendPid}::int = any(pg_blocking_pids(pid))
        ) as waiting
      `;
      if (row?.waiting) return "lock" as const;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return "timeout" as const;
  };
  const race = async (
    occurrenceId: string,
    changeTimezone: () => Promise<Response>,
  ) => {
    await sql`
      update crm.reminder_occurrences set status = 'pending', attempt_count = 0,
        provider_result_state = 'unattempted', deliver_at = now() + interval '30 days',
        last_attempt_at = null, next_attempt_at = null, claim_token = null,
        claim_owner = null, lease_expires_at = null, error = null,
        updated_at = now()
      where id = ${occurrenceId}::uuid
    `;
    const [before] = await sql<{ readonly deliver_at: string }[]>`
      select deliver_at::text from crm.reminder_occurrences
      where id = ${occurrenceId}::uuid
    `;
    assert(before, "race occurrence missing");
    let locked!: () => void;
    const lockReady = new Promise<void>((resolve) => locked = resolve);
    let release!: () => void;
    const releaseLock = new Promise<void>((resolve) => release = resolve);
    let claimBackendPid = 0;
    const claim = sql.begin(async (transaction) => {
      const [backend] = await transaction<{ readonly pid: number }[]>`
        select pg_backend_pid()::int as pid
      `;
      assert(backend, "claim backend PID missing");
      claimBackendPid = backend.pid;
      await transaction`
        update crm.reminder_occurrences set status = 'claimed',
          attempt_count = 1, last_attempt_at = now(),
          claim_token = gen_random_uuid(), claim_owner = 'race-worker',
          lease_expires_at = now() + interval '1 minute', updated_at = now()
        where id = ${occurrenceId}::uuid
      `;
      locked();
      await releaseLock;
    });
    await lockReady;
    const changing = changeTimezone();
    const observationController = new AbortController();
    const first = await Promise.race([
      changing.then((response) => ({
        branch: "completed" as const,
        response,
      })),
      waitForClaimBlock(observationController.signal, claimBackendPid).then(
        (branch) => ({ branch }),
      ),
    ]);
    observationController.abort();
    try {
      if (first.branch === "timeout" || first.branch === "cancelled") {
        throw new Error(
          "regeneration stayed active without the exact claim backend blocker",
        );
      }
    } finally {
      release();
    }
    const [, response] = await Promise.all([
      claim,
      first.branch === "completed" ? Promise.resolve(first.response) : changing,
    ]);
    const [after] = await sql<{
      readonly attempt_count: number;
      readonly deliver_at: string;
      readonly status: string;
    }[]>`
      select attempt_count, deliver_at::text, status
      from crm.reminder_occurrences where id = ${occurrenceId}::uuid
    `;
    assert(
      response.status === 200 && after?.status === "claimed" &&
        after.attempt_count === 1 && after.deliver_at === before.deliver_at,
      `regeneration overwrote a concurrent claim: ${
        JSON.stringify({ after, before })
      }`,
    );
  };

  assert(
    (await request(
      fixture,
      "/api/v1/settings/preferences",
      "PUT",
      preferencePayload("Pacific/Kiritimati"),
    )).status === 200,
    "member race timezone prepared",
  );
  const memberReminder = await createReminder(fixture, personId, "Member race");
  await race(memberReminder.nextOccurrence!.id, () =>
    request(
      fixture,
      "/api/v1/settings/preferences",
      "PUT",
      preferencePayload("America/Adak"),
    ));

  assert(
    (await request(
          fixture,
          "/api/v1/settings/preferences",
          "PUT",
          preferencePayload(),
        )).status === 200 &&
      (await request(
          fixture,
          "/api/v1/settings/workspace",
          "PUT",
          workspacePayload("Pacific/Kiritimati"),
        )).status === 200,
    "workspace race timezone prepared",
  );
  const workspaceReminder = await createReminder(
    fixture,
    personId,
    "Workspace race",
  );
  await race(workspaceReminder.nextOccurrence!.id, () =>
    request(
      fixture,
      "/api/v1/settings/workspace",
      "PUT",
      workspacePayload("America/Adak"),
    ));
});

Deno.test("PLANNING-002 PostgreSQL important dates publish one deliverable in-app occurrence", async () => {
  const fixture = await register(
    `important-date-reminder-${crypto.randomUUID()}@example.test`,
    "Important-date reminders",
  );
  const personId = await createPerson(fixture, "Important date person");
  assert(
    (await request(fixture, "/api/v1/settings/workspace", "PUT", {
      defaultLocale: "en",
      defaultReminderTime: "12:00",
      defaultTimezone: "UTC",
      name: "Important-date reminders",
    })).status === 200,
    "important-date reminder settings saved",
  );
  const date = new Date(Date.now() + 7 * 86_400_000);
  const created = await request(
    fixture,
    `/api/v1/people/${personId}/dates`,
    "POST",
    {
      day: date.getUTCDate(),
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Deliverable anniversary",
      month: date.getUTCMonth() + 1,
      precision: "month_day",
    },
  );
  assert(created.status === 201, "important date created");
  const [occurrence] = await sql<{
    readonly channel: string;
    readonly id: string;
  }[]>`
    select occurrence.id::text, occurrence.channel
    from crm.reminder_occurrences occurrence
    join crm.reminders reminder on reminder.id = occurrence.reminder_id
    where reminder.person_id = ${personId}::uuid
      and reminder.target_kind = 'person_date'
      and occurrence.member_id = ${fixture.memberId}::uuid
  `;
  assert(
    occurrence?.channel === "in_app",
    `important-date publisher created unsupported channel: ${occurrence?.channel}`,
  );
  const directReminder = await createReminder(
    fixture,
    personId,
    "Direct reminder",
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 day'
    where id in (${occurrence.id}::uuid, ${
    directReminder.nextOccurrence!.id
  }::uuid)
  `;
  await sql`
    insert into crm.reminder_occurrences (
      reminder_id, member_id, occurs_on, deliver_at, channel, status,
      title_snapshot, created_at, updated_at
    )
    select reminder_id, member_id, occurs_on,
      now() - interval '1 minute', 'email', 'pending',
      title_snapshot, now(), now()
    from crm.reminder_occurrences where id = ${occurrence.id}::uuid
  `;
  const attention = await request(fixture, "/api/v1/today/attention");
  const attentionBody = await attention.json() as {
    readonly attention: {
      readonly overdue: readonly {
        readonly id: string;
        readonly kind: string;
      }[];
    };
  };
  assert(
    attention.status === 200 &&
      attentionBody.attention.overdue.filter((item) =>
          item.kind === "important-date" && item.id === occurrence.id
        ).length === 1 &&
      attentionBody.attention.overdue.filter((item) =>
          item.kind === "reminder" &&
          item.id === directReminder.nextOccurrence!.id
        ).length === 1,
    "direct and important-date reminders were conflated, missing, or duplicated",
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() + interval '1 day'
    where id = ${directReminder.nextOccurrence!.id}::uuid
  `;
  const provider = new InAppReminderDelivery(
    new PostgresInAppReminderEffectStore(
      deliveryConnection.db,
      { now: () => new Date() },
    ),
  );
  const worker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider,
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });
  const delivered = await worker.tick({ owner: "important-date-worker" });
  const rows = await sql<
    { readonly channel: string; readonly status: string }[]
  >`
    select channel, status from crm.reminder_occurrences
    where reminder_id = (
      select reminder_id from crm.reminder_occurrences
      where id = ${occurrence.id}::uuid
    ) order by channel
  `;
  assert(
    delivered.claimed === 1 &&
      rows.some((row) => row.channel === "in_app" && row.status === "sent") &&
      rows.some((row) => row.channel === "email" && row.status === "pending"),
    `important-date delivery or legacy-channel safety failed: ${
      JSON.stringify({ delivered, rows })
    }`,
  );
});

Deno.test("PLANNING-002 PostgreSQL uses workspace send time for null overrides", async () => {
  const fixture = await register(
    `default-send-time-${crypto.randomUUID()}@example.test`,
    "Default reminder time",
  );
  const personId = await createPerson(fixture, "Default-time person");
  const workspaceSettings = (timezone: string) => ({
    defaultLocale: "en",
    defaultReminderTime: "15:45",
    defaultTimezone: timezone,
    name: "Default reminder time",
  });
  assert(
    (await request(
      fixture,
      "/api/v1/settings/workspace",
      "PUT",
      workspaceSettings("UTC"),
    )).status === 200,
    "default reminder time saved",
  );
  const anchorOn = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const created = await request(fixture, "/api/v1/reminders", "POST", {
    anchorOn,
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "day",
    requestId: crypto.randomUUID(),
    sendTime: "09:00",
    title: "Inherited send time",
  });
  const body = await created.json() as CreatedReminder;
  assert(created.status === 201, "default-time reminder created");
  await sql`
    update crm.reminders set send_time = null
    where id = ${body.reminder.id}::uuid
  `;
  assert(
    (await request(
      fixture,
      "/api/v1/settings/workspace",
      "PUT",
      workspaceSettings("Europe/Belgrade"),
    )).status === 200,
    "workspace timezone regenerated null-override reminder",
  );
  const [workspaceProof] = await sql<{ readonly local_time: string }[]>`
    select to_char(deliver_at at time zone 'Europe/Belgrade', 'HH24:MI') local_time
    from crm.reminder_occurrences
    where reminder_id = ${body.reminder.id}::uuid
    order by occurs_on limit 1
  `;
  assert(
    workspaceProof?.local_time === "15:45",
    `workspace regeneration ignored default send time: ${
      JSON.stringify(workspaceProof)
    }`,
  );
  assert(
    (await request(fixture, "/api/v1/settings/preferences", "PUT", {
      contactNameOrder: "given_family_nickname",
      contactSortOrder: "given_name_asc",
      fluidLayout: false,
      locale: "en",
      measurementSystem: "metric",
      temperatureScale: "celsius",
      timezone: "America/New_York",
    })).status === 200,
    "member timezone regenerated null-override reminder",
  );
  const [memberProof] = await sql<{
    readonly last_occurs_on: string;
    readonly local_time: string;
  }[]>`
    select max(occurs_on)::text last_occurs_on,
      min(to_char(deliver_at at time zone 'America/New_York', 'HH24:MI')) local_time
    from crm.reminder_occurrences
    where reminder_id = ${body.reminder.id}::uuid
  `;
  assert(
    memberProof?.local_time === "15:45",
    `member regeneration ignored default send time: ${
      JSON.stringify(memberProof)
    }`,
  );
  const replenishFrom = new Date(`${memberProof.last_occurs_on}T23:59:59Z`);
  await deliveryRepository.replenish({ now: replenishFrom });
  const [rollingProof] = await sql<{ readonly valid: boolean }[]>`
    select bool_and(
      to_char(deliver_at at time zone 'America/New_York', 'HH24:MI') = '15:45'
    ) as valid
    from crm.reminder_occurrences
    where reminder_id = ${body.reminder.id}::uuid
      and occurs_on > ${memberProof.last_occurs_on}::date
  `;
  assert(
    rollingProof?.valid === true,
    `rolling replenishment ignored default send time: ${
      JSON.stringify(rollingProof)
    }`,
  );
});

Deno.test("PLANNING-002 PostgreSQL person reminder projection is member-scoped", async () => {
  const fixture = await register(
    `member-scope-${crypto.randomUUID()}@example.test`,
    "Member-scoped reminders",
  );
  const other = await register(
    `member-scope-other-${crypto.randomUUID()}@example.test`,
    "Other member workspace",
  );
  const personId = await createPerson(fixture, "Scoped reminder person");
  const reminder = await createReminder(fixture, personId, "Scoped reminder");
  const [membership] = await sql<{ readonly id: string }[]>`
    insert into crm.workspace_members (
      workspace_id, user_id, role, status, joined_at, created_at, updated_at
    ) values (
      ${fixture.workspaceId}::uuid, ${other.userId}::uuid, 'member', 'active',
      now(), now(), now()
    ) returning id::text
  `;
  assert(membership, "secondary membership created");
  const [foreignOccurrence] = await sql<{ readonly id: string }[]>`
    insert into crm.reminder_occurrences (
      reminder_id, member_id, occurs_on, deliver_at, channel, status,
      attempt_count, provider_result_state, error, title_snapshot,
      created_at, updated_at
    )
    select reminder_id, ${membership.id}::uuid, occurs_on,
      deliver_at - interval '1 day', channel, 'manual_attention', 1,
      'rejected', 'other member failure', title_snapshot, now(), now()
    from crm.reminder_occurrences where id = ${
    reminder.nextOccurrence!.id
  }::uuid
    returning id::text
  `;
  assert(foreignOccurrence, "secondary member occurrence created");
  const listed = await request(
    fixture,
    `/api/v1/people/${personId}/reminders`,
  );
  const listedBody = await listed.json() as {
    readonly reminders: readonly {
      readonly nextOccurrence?: {
        readonly id: string;
        readonly status: string;
      };
    }[];
  };
  assert(
    listed.status === 200 &&
      listedBody.reminders[0]?.nextOccurrence?.id ===
        reminder.nextOccurrence!.id &&
      listedBody.reminders[0]?.nextOccurrence?.status === "pending",
    `person reminder leaked another member state: ${
      JSON.stringify(listedBody)
    }`,
  );
});

Deno.test("PLANNING-002 PostgreSQL preserves every important-date lead rule through rolling delivery", async () => {
  const fixture = await register(
    `important-date-leads-${crypto.randomUUID()}@example.test`,
    "Important-date lead rules",
  );
  const personId = await createPerson(fixture, "Multiple lead person");
  await sql`
    insert into crm.reminder_rules (workspace_id, days_before)
    values (${fixture.workspaceId}::uuid, 0), (${fixture.workspaceId}::uuid, 7)
  `;
  const event = new Date(Date.now() + 30 * 86_400_000);
  const created = await request(
    fixture,
    `/api/v1/people/${personId}/dates`,
    "POST",
    {
      day: event.getUTCDate(),
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Two lead anniversary",
      month: event.getUTCMonth() + 1,
      precision: "month_day",
    },
  );
  assert(created.status === 201, "important date with two rules created");
  const initial = await sql<{
    readonly deliver_on: string;
    readonly id: string;
    readonly lead_time_days: number;
    readonly occurs_on: string;
    readonly reminder_id: string;
  }[]>`
    select occurrence.id::text, occurrence.reminder_id::text,
      occurrence.occurs_on::text, occurrence.lead_time_days,
      (occurrence.deliver_at at time zone 'UTC')::date::text as deliver_on
    from crm.reminder_occurrences occurrence
    join crm.reminders reminder on reminder.id = occurrence.reminder_id
    where reminder.person_id = ${personId}::uuid
      and reminder.target_kind = 'person_date'
      and occurrence.member_id = ${fixture.memberId}::uuid
    order by occurrence.lead_time_days
  `;
  assert(
    initial.length === 2 && initial[0]?.lead_time_days === 0 &&
      initial[1]?.lead_time_days === 7 &&
      initial[0].occurs_on === initial[1].occurs_on &&
      Temporal.PlainDate.from(initial[1].deliver_on).until(
          Temporal.PlainDate.from(initial[0].deliver_on),
        ).days === 7,
    `important-date lead identities collapsed: ${JSON.stringify(initial)}`,
  );
  const reminderId = initial[0].reminder_id;
  const firstOccursOn = initial[0].occurs_on;
  const replenishAt = new Date(`${firstOccursOn}T23:59:59Z`);
  await Promise.all([
    deliveryRepository.replenish({ now: replenishAt }),
    deliveryRepository.replenish({ now: replenishAt }),
  ]);
  const rolling = await sql<{
    readonly count: number;
    readonly lead_time_days: number;
  }[]>`
    select lead_time_days, count(*)::int as count
    from crm.reminder_occurrences
    where reminder_id = ${reminderId}::uuid
      and member_id = ${fixture.memberId}::uuid
      and occurs_on > ${firstOccursOn}::date
    group by lead_time_days order by lead_time_days
  `;
  assert(
    rolling.length === 2 && rolling[0]?.lead_time_days === 0 &&
      rolling[1]?.lead_time_days === 7 &&
      rolling[0].count === rolling[1].count && rolling[0].count > 0,
    `rolling generation lost or duplicated a lead rule: ${
      JSON.stringify(rolling)
    }`,
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id in (${initial[0].id}::uuid, ${initial[1].id}::uuid)
  `;
  const worker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider: new InAppReminderDelivery(
      new PostgresInAppReminderEffectStore(deliveryConnection.db, {
        now: () => new Date(),
      }),
    ),
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });
  await worker.tick({ limit: 100, owner: "important-date-leads" });
  const [delivered] = await sql<{ readonly count: number }[]>`
    select count(*)::int as count from crm.reminder_occurrences
    where id in (${initial[0].id}::uuid, ${initial[1].id}::uuid)
      and status = 'sent' and provider_effect_at is not null
  `;
  assert(
    delivered?.count === 2,
    "both important-date lead rules were not delivered once",
  );
});

Deno.test("PLANNING-002 PostgreSQL serializes horizon generation with effective timezone changes", async () => {
  const fixture = await register(
    `horizon-timezone-${crypto.randomUUID()}@example.test`,
    "Horizon timezone",
  );
  const personId = await createPerson(fixture, "Horizon person");
  const preferences = (timezone?: string) => ({
    contactNameOrder: "given_family_nickname",
    contactSortOrder: "given_name_asc",
    fluidLayout: false,
    locale: "en",
    measurementSystem: "metric",
    temperatureScale: "celsius",
    ...(timezone ? { timezone } : {}),
  });
  const workspace = (timezone: string) => ({
    defaultLocale: "en",
    defaultReminderTime: "09:00",
    defaultTimezone: timezone,
    name: "Horizon timezone",
  });
  const createDaily = async (title: string) => {
    const response = await request(fixture, "/api/v1/reminders", "POST", {
      anchorOn: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      personId,
      recurrenceInterval: 1,
      recurrenceUnit: "day",
      requestId: crypto.randomUUID(),
      sendTime: "09:00",
      title,
    });
    const body = await response.json() as CreatedReminder;
    assert(response.status === 201, `${title} created`);
    return body.reminder.id;
  };
  const lastOccursOn = async (reminderId: string) => {
    const [row] = await sql<{ readonly occurs_on: string }[]>`
      select max(occurs_on)::text as occurs_on from crm.reminder_occurrences
      where reminder_id = ${reminderId}::uuid
    `;
    assert(row?.occurs_on, "horizon fixture occurrence missing");
    return row.occurs_on;
  };
  const proveSerialized = async (
    reminderId: string,
    newTimezone: string,
    holdChange: (release: Promise<void>, changed: () => void) => Promise<void>,
  ) => {
    const previousLast = await lastOccursOn(reminderId);
    let changed!: () => void;
    const changedReady = new Promise<void>((resolve) => changed = resolve);
    let release!: () => void;
    const released = new Promise<void>((resolve) => release = resolve);
    const changing = holdChange(released, changed);
    await changedReady;
    const replenishing = deliveryRepository.replenish({
      now: new Date(`${previousLast}T23:59:59Z`),
    });
    const completedWhileUncommitted = await Promise.race([
      replenishing.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    release();
    await Promise.all([changing, replenishing]);
    assert(
      !completedWhileUncommitted,
      "horizon generation persisted an uncommitted old timezone",
    );
    const [proof] = await sql<{ readonly valid: boolean }[]>`
      select bool_and(
        to_char(deliver_at at time zone ${newTimezone}, 'HH24:MI') = '09:00'
      ) as valid
      from crm.reminder_occurrences
      where reminder_id = ${reminderId}::uuid
        and occurs_on > ${previousLast}::date
    `;
    assert(
      proof?.valid === true,
      `new horizon used stale timezone: ${JSON.stringify(proof)}`,
    );
  };

  assert(
    (await request(
      fixture,
      "/api/v1/settings/preferences",
      "PUT",
      preferences("Pacific/Kiritimati"),
    )).status === 200,
    "member horizon timezone prepared",
  );
  const memberReminder = await createDaily("Member horizon lock");
  await proveSerialized(
    memberReminder,
    "America/Adak",
    (release, changed) =>
      sql.begin(async (transaction) => {
        await transaction`
          update crm.member_preferences set timezone = 'America/Adak'
          where member_id = ${fixture.memberId}::uuid
        `;
        changed();
        await release;
      }),
  );

  assert(
    (await request(
          fixture,
          "/api/v1/settings/preferences",
          "PUT",
          preferences(),
        )).status === 200 &&
      (await request(
          fixture,
          "/api/v1/settings/workspace",
          "PUT",
          workspace("Pacific/Kiritimati"),
        )).status === 200,
    "inherited horizon timezone prepared",
  );
  const workspaceReminder = await createDaily("Workspace horizon lock");
  await proveSerialized(
    workspaceReminder,
    "America/Adak",
    (release, changed) =>
      sql.begin(async (transaction) => {
        await transaction`
          update crm.workspace_settings set default_timezone = 'America/Adak'
          where workspace_id = ${fixture.workspaceId}::uuid
        `;
        changed();
        await release;
      }),
  );
});

Deno.test("PLANNING-002 PostgreSQL regenerates inherited send time without resetting attempts", async () => {
  const fixture = await register(
    `default-time-change-${crypto.randomUUID()}@example.test`,
    "Default time change",
  );
  const personId = await createPerson(fixture, "Default-time regeneration");
  const workspace = (defaultReminderTime: string) => ({
    defaultLocale: "en",
    defaultReminderTime,
    defaultTimezone: "UTC",
    name: "Default time change",
  });
  assert(
    (await request(
      fixture,
      "/api/v1/settings/workspace",
      "PUT",
      workspace("09:00"),
    )).status === 200,
    "initial default reminder time saved",
  );
  const pending = await createReminder(
    fixture,
    personId,
    "Pending inherited time",
  );
  const attempted = await createReminder(
    fixture,
    personId,
    "Attempted inherited time",
  );
  await sql`
    update crm.reminders set send_time = null
    where id in (${pending.id}::uuid, ${attempted.id}::uuid)
  `;
  await sql`
    update crm.reminder_occurrences set status = 'retry', attempt_count = 1,
      provider_result_state = 'ambiguous', last_attempt_at = now(),
      next_attempt_at = now() + interval '1 day', error = 'preserve-attempt'
    where id = ${attempted.nextOccurrence!.id}::uuid
  `;
  const [attemptedBefore] = await sql<{
    readonly attempt_count: number;
    readonly deliver_at: string;
    readonly status: string;
  }[]>`
    select attempt_count, deliver_at::text, status
    from crm.reminder_occurrences where id = ${
    attempted.nextOccurrence!.id
  }::uuid
  `;
  assert(
    (await request(
      fixture,
      "/api/v1/settings/workspace",
      "PUT",
      workspace("15:45"),
    )).status === 200,
    "default reminder time changed",
  );
  const [pendingAfter] = await sql<{ readonly local_time: string }[]>`
    select to_char(deliver_at at time zone 'UTC', 'HH24:MI') as local_time
    from crm.reminder_occurrences where id = ${pending.nextOccurrence!.id}::uuid
  `;
  const [attemptedAfter] = await sql<{
    readonly attempt_count: number;
    readonly deliver_at: string;
    readonly status: string;
  }[]>`
    select attempt_count, deliver_at::text, status
    from crm.reminder_occurrences where id = ${
    attempted.nextOccurrence!.id
  }::uuid
  `;
  assert(
    pendingAfter?.local_time === "15:45",
    `default-time-only change did not regenerate pending work: ${
      JSON.stringify(pendingAfter)
    }`,
  );
  assert(
    JSON.stringify(attemptedAfter) === JSON.stringify(attemptedBefore),
    "default-time-only change reset attempted work",
  );
});

Deno.test("PLANNING-002 PostgreSQL validates an archived Today response at runtime", async () => {
  const fixture = await register(
    `today-runtime-${crypto.randomUUID()}@example.test`,
    "Today runtime contract",
  );
  const personId = await createPerson(fixture, "Archived Today person");
  const reminder = await createReminder(
    fixture,
    personId,
    "Archived Today reminder",
  );
  await sql`update crm.people set archived_at = now() where id = ${personId}::uuid`;
  const response = await request(fixture, "/api/v1/today/reminders");
  const body = await response.json();
  const parse = (generatedPlanningClient as unknown as {
    readonly parseTodayReminders?: (value: unknown) => unknown;
  }).parseTodayReminders;
  assert(
    response.status === 200,
    `archived Today HTTP response failed: ${JSON.stringify(body)}`,
  );
  assert(
    typeof parse === "function",
    "generated Today runtime validator missing",
  );
  const validated = parse(body) as {
    readonly reminders: readonly {
      readonly id: string;
      readonly person: { readonly archived: boolean; readonly id: string };
    }[];
  };
  const item = validated.reminders.find((entry) =>
    entry.id === reminder.nextOccurrence!.id
  );
  assert(
    item?.person.id === personId && item.person.archived === true,
    `archived Today response did not validate: ${JSON.stringify(body)}`,
  );
});

Deno.test("PLANNING-002 PostgreSQL reactivates future one-time and recurring reminders truthfully", async () => {
  const fixture = await register(
    `reminder-reactivation-${crypto.randomUUID()}@example.test`,
    "Reminder reactivation",
  );
  const personId = await createPerson(fixture, "Reactivation person");
  const futureAnchor = new Date(Date.now() + 2 * 86_400_000).toISOString()
    .slice(0, 10);
  const createDefinition = async (
    title: string,
    recurrenceUnit: "day" | "none",
    anchorOn = futureAnchor,
  ) => {
    const response = await request(fixture, "/api/v1/reminders", "POST", {
      anchorOn,
      personId,
      recurrenceInterval: 1,
      recurrenceUnit,
      requestId: crypto.randomUUID(),
      sendTime: "09:00",
      title,
    });
    const body = await response.json() as CreatedReminder;
    assert(response.status === 201, `${title} creation failed`);
    return body.reminder;
  };
  const worker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider: new DurableFakeProvider(),
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });

  for (
    const [title, recurrenceUnit] of [
      ["Reactivated one-time", "none"],
      ["Reactivated recurring", "day"],
    ] as const
  ) {
    const reminder = await createDefinition(title, recurrenceUnit);
    const originalOccurrence = reminder.nextOccurrence;
    assert(originalOccurrence, `${title} did not generate future work`);
    assert(
      (await request(
        fixture,
        `/api/v1/reminders/${reminder.id}/active`,
        "PUT",
        { active: false },
      )).status === 200,
      `${title} disable failed`,
    );
    const enabled = await request(
      fixture,
      `/api/v1/reminders/${reminder.id}/active`,
      "PUT",
      { active: true },
    );
    const enabledBody = await enabled.json() as {
      readonly reminder?: {
        readonly isActive: boolean;
        readonly nextOccurrence?: {
          readonly id: string;
          readonly status: string;
        };
      };
    };
    assert(
      enabled.status === 200 && enabledBody.reminder?.isActive === true &&
        enabledBody.reminder.nextOccurrence?.id === originalOccurrence.id &&
        enabledBody.reminder.nextOccurrence.status === "pending",
      `${title} public active:true response was not truthful: ${
        JSON.stringify(enabledBody)
      }`,
    );
    const [reactivated] = await sql<{
      readonly id: string;
      readonly status: string;
    }[]>`
      select id::text, status from crm.reminder_occurrences
      where reminder_id = ${reminder.id}::uuid
        and occurs_on = ${originalOccurrence.occursOn}::date
      order by id limit 1
    `;
    assert(
      reactivated?.id === originalOccurrence.id &&
        reactivated.status === "pending",
      `${title} did not reactivate its stable occurrence: ${
        JSON.stringify(reactivated)
      }`,
    );
    await sql`
      update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
      where id = ${originalOccurrence.id}::uuid
    `;
    const delivered = await worker.tick({
      owner: `reactivate-${recurrenceUnit}`,
    });
    const [final] = await sql<{ readonly status: string }[]>`
      select status from crm.reminder_occurrences
      where id = ${originalOccurrence.id}::uuid
    `;
    assert(
      delivered.results.some((result) =>
        result.id === originalOccurrence.id && result.status === "sent"
      ) && final?.status === "sent",
      `${title} active:true did not restore delivery`,
    );
  }

  const pastAnchor = new Date(Date.now() - 10 * 86_400_000).toISOString()
    .slice(0, 10);
  const past = await createDefinition("Past one-time", "none", pastAnchor);
  assert(!past.nextOccurrence, "past one-time reminder claimed ancient work");
  assert(
    (await request(
          fixture,
          `/api/v1/reminders/${past.id}/active`,
          "PUT",
          { active: false },
        )).status === 200 &&
      (await request(
          fixture,
          `/api/v1/reminders/${past.id}/active`,
          "PUT",
          { active: true },
        )).status === 200,
    "past one-time reminder state change failed",
  );
  const [pastCount] = await sql<{ readonly count: number }[]>`
    select count(*)::int as count from crm.reminder_occurrences
    where reminder_id = ${past.id}::uuid
  `;
  assert(
    pastCount?.count === 0,
    "reactivation silently scheduled an ancient one-time occurrence",
  );
});

Deno.test("PLANNING-002 PostgreSQL preserves an in-flight durable effect across disable", async () => {
  const fixture = await register(
    `reminder-disable-race-${crypto.randomUUID()}@example.test`,
    "Reminder disable race",
  );
  const personId = await createPerson(fixture, "Disable race person");
  const reminder = await createReminder(
    fixture,
    personId,
    "Disable after effect",
  );
  const occurrenceId = reminder.nextOccurrence!.id;
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id = ${occurrenceId}::uuid
  `;
  const durable = new InAppReminderDelivery(
    new PostgresInAppReminderEffectStore(deliveryConnection.db, {
      now: () => new Date(),
    }),
  );
  let observedEffect!: () => void;
  const effectRecorded = new Promise<void>((resolve) => {
    observedEffect = resolve;
  });
  let resumeDelivery!: () => void;
  const deliveryReleased = new Promise<void>((resolve) => {
    resumeDelivery = resolve;
  });
  const barrierProvider: ReminderDeliveryProvider = {
    async deliver(command) {
      const result = await durable.deliver(command);
      observedEffect();
      await deliveryReleased;
      return result;
    },
    reconcile: (command) => durable.reconcile(command),
  };
  const worker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider: barrierProvider,
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });
  const tick = worker.tick({ limit: 1, owner: "disable-effect-race" });
  await Promise.race([
    effectRecorded,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("provider effect barrier timed out")),
        5_000,
      )
    ),
  ]);
  const [beforeDisable] = await sql<{
    readonly claim_token: string | null;
    readonly provider_effect_at: string | null;
    readonly status: string;
  }[]>`
    select claim_token::text, provider_effect_at::text, status
    from crm.reminder_occurrences where id = ${occurrenceId}::uuid
  `;
  const disabled = await request(
    fixture,
    `/api/v1/reminders/${reminder.id}/active`,
    "PUT",
    { active: false },
  );
  resumeDelivery();
  const result = await tick;
  const [afterFinalize] = await sql<{
    readonly audits: number;
    readonly provider_effect_at: string | null;
    readonly status: string;
    readonly visible_at: string | null;
  }[]>`
    select occurrence.status, occurrence.provider_effect_at::text,
      occurrence.visible_at::text,
      (select count(*)::int from crm.audit_events audit
       where audit.subject_id = occurrence.id
         and audit.action = 'planning.reminder-delivered') as audits
    from crm.reminder_occurrences occurrence
    where occurrence.id = ${occurrenceId}::uuid
  `;
  const today = await request(fixture, "/api/v1/today/reminders");
  const todayBody = await today.json() as {
    readonly reminders: readonly {
      readonly id: string;
      readonly status: string;
      readonly visibleAt?: string;
    }[];
  };
  assert(
    beforeDisable?.status === "claimed" && beforeDisable.claim_token !== null &&
      beforeDisable.provider_effect_at !== null,
    `durable effect was not observed in-flight: ${
      JSON.stringify(beforeDisable)
    }`,
  );
  assert(
    disabled.status === 200 && result.results[0]?.status === "sent" &&
      afterFinalize?.status === "sent" &&
      afterFinalize.provider_effect_at !== null &&
      afterFinalize.visible_at !== null && afterFinalize.audits === 1,
    `disable invalidated durable effect finalization: ${
      JSON.stringify({ afterFinalize, result })
    }`,
  );
  assert(
    today.status === 200 &&
      todayBody.reminders.some((item) =>
        item.id === occurrenceId && item.status === "sent" && item.visibleAt
      ),
    "disabled definition hid its single confirmed in-app effect",
  );
});

Deno.test("PLANNING-002 PostgreSQL recovers an expired confirmed claim after disable", async () => {
  const fixture = await register(
    `reminder-disabled-recovery-${crypto.randomUUID()}@example.test`,
    "Disabled reminder recovery",
  );
  const personId = await createPerson(fixture, "Disabled recovery person");
  const anchorOn = new Date(Date.now() + 86_400_000).toISOString().slice(
    0,
    10,
  );
  const created = await request(fixture, "/api/v1/reminders", "POST", {
    anchorOn,
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "day",
    requestId: crypto.randomUUID(),
    sendTime: "09:00",
    title: "Recover after disable",
  });
  const createdBody = await created.json() as CreatedReminder;
  const reminder = createdBody.reminder;
  const occurrenceId = reminder.nextOccurrence?.id;
  assert(
    created.status === 201 && occurrenceId,
    "recurring recovery reminder missing",
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id = ${occurrenceId}::uuid
  `;
  const [claim] = await deliveryRepository.claimDue({
    leaseExpiresAt: new Date(Date.now() + 30_000),
    limit: 1,
    now: new Date(),
    owner: "dies-before-finalize",
  });
  assert(claim?.id === occurrenceId, "recovery occurrence was not claimed");
  const durable = new InAppReminderDelivery(
    new PostgresInAppReminderEffectStore(deliveryConnection.db, {
      now: () => new Date(),
    }),
  );
  const delivered = await durable.deliver({
    idempotencyKey: claim.providerIdempotencyKey,
    occurrenceId: claim.id,
  });
  assert(delivered.status === "confirmed", "durable effect was not recorded");
  assert(
    (await request(
      fixture,
      `/api/v1/reminders/${reminder.id}/active`,
      "PUT",
      { active: false },
    )).status === 200,
    "claimed reminder disable failed",
  );
  await sql`
    update crm.reminder_occurrences set lease_expires_at = now() - interval '1 second'
    where id = ${occurrenceId}::uuid
  `;
  const recoveryWorker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider: durable,
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });
  const recovered = await recoveryWorker.tick({
    limit: 20,
    owner: "disabled-reconciliation",
  });
  const [proof] = await sql<{
    readonly audits: number;
    readonly effects: number;
    readonly inactive_new_work: number;
    readonly sent: number;
  }[]>`
    select
      count(*) filter (where occurrence.status = 'sent')::int as sent,
      count(*) filter (where occurrence.provider_effect_at is not null)::int as effects,
      count(*) filter (where occurrence.status in ('pending','retry','claimed'))::int as inactive_new_work,
      (select count(*)::int from crm.audit_events audit
       where audit.subject_id = ${occurrenceId}::uuid
         and audit.action = 'planning.reminder-delivered') as audits
    from crm.reminder_occurrences occurrence
    where occurrence.reminder_id = ${reminder.id}::uuid
  `;
  const today = await request(fixture, "/api/v1/today/reminders");
  const todayBody = await today.json() as {
    readonly reminders: readonly {
      readonly id: string;
      readonly status: string;
      readonly visibleAt?: string;
    }[];
  };
  assert(
    recovered.claimed === 1 && recovered.results[0]?.id === occurrenceId &&
      recovered.results[0].status === "sent" && proof?.sent === 1 &&
      proof.effects === 1 && proof.audits === 1 &&
      proof.inactive_new_work === 0,
    `disabled confirmed claim did not reconcile exactly once: ${
      JSON.stringify({ proof, recovered })
    }`,
  );
  assert(
    today.status === 200 &&
      todayBody.reminders.some((item) =>
        item.id === occurrenceId && item.status === "sent" && item.visibleAt
      ),
    "recovered disabled effect was not visible on Today",
  );
});

Deno.test("PLANNING-002 PostgreSQL cancels an expired unattempted claim after disable", async () => {
  const fixture = await register(
    `reminder-disabled-unattempted-${crypto.randomUUID()}@example.test`,
    "Disabled unattempted reminder",
  );
  const personId = await createPerson(fixture, "Disabled unattempted person");
  const reminder = await createReminder(
    fixture,
    personId,
    "Cancel expired unattempted claim",
  );
  const occurrenceId = reminder.nextOccurrence!.id;
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id = ${occurrenceId}::uuid
  `;
  const [claim] = await deliveryRepository.claimDue({
    leaseExpiresAt: new Date(Date.now() + 30_000),
    limit: 1,
    now: new Date(),
    owner: "dies-before-provider-effect",
  });
  assert(claim?.id === occurrenceId, "unattempted occurrence was not claimed");
  assert(
    (await request(
      fixture,
      `/api/v1/reminders/${reminder.id}/active`,
      "PUT",
      { active: false },
    )).status === 200,
    "unattempted claimed reminder disable failed",
  );
  await sql`
    update crm.reminder_occurrences set lease_expires_at = now() - interval '1 second'
    where id = ${occurrenceId}::uuid
  `;

  const durable = new InAppReminderDelivery(
    new PostgresInAppReminderEffectStore(deliveryConnection.db, {
      now: () => new Date(),
    }),
  );
  let releaseStaleEffect!: () => void;
  const staleEffectReleased = new Promise<void>((resolve) => {
    releaseStaleEffect = resolve;
  });
  let observeStaleProcess!: () => void;
  const staleProcessObserved = new Promise<void>((resolve) => {
    observeStaleProcess = resolve;
  });
  const staleEffect = (async () => {
    observeStaleProcess();
    await staleEffectReleased;
    return await durable.deliver({
      idempotencyKey: claim.providerIdempotencyKey,
      occurrenceId: claim.id,
    });
  })();
  await staleProcessObserved;

  const maintenanceWorker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider: durable,
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });
  const maintained = await maintenanceWorker.tick({
    limit: 20,
    owner: "disabled-unattempted-maintenance",
  });
  releaseStaleEffect();
  const staleEffectResult = await staleEffect;
  const staleFinalize = await deliveryTransaction.run(async (transaction) =>
    await deliveryRepository.finalize({
      claimToken: claim.claimToken,
      error: "stale-process-finalize",
      id: claim.id,
      now: new Date(),
      providerResultState: "rejected",
      status: "failed",
      transaction,
    })
  );
  const [proof] = await sql<{
    readonly audits: number;
    readonly claim_owner: string | null;
    readonly claim_token: string | null;
    readonly effects: number;
    readonly lease_expires_at: string | null;
    readonly status: string;
  }[]>`
    select occurrence.status, occurrence.claim_token::text,
      occurrence.claim_owner, occurrence.lease_expires_at::text,
      (occurrence.provider_effect_at is not null)::int as effects,
      (select count(*)::int from crm.audit_events audit
       where audit.subject_id = occurrence.id
         and audit.action = 'planning.reminder-delivered') as audits
    from crm.reminder_occurrences occurrence
    where occurrence.id = ${occurrenceId}::uuid
  `;
  assert(
    maintained.claimed === 0 && proof?.status === "cancelled" &&
      proof.claim_token === null && proof.claim_owner === null &&
      proof.lease_expires_at === null && proof.effects === 0 &&
      proof.audits === 0,
    `expired unattempted disabled claim was not cleaned safely: ${
      JSON.stringify({ maintained, proof })
    }`,
  );
  assert(
    staleEffectResult.status === "rejected" && staleFinalize === false,
    `stale process retained effect/finalize authority: ${
      JSON.stringify({ staleEffectResult, staleFinalize })
    }`,
  );
});

/**
 * A workspace, member, and person written straight to PostgreSQL, so a test can
 * hold an actor context whose membership it revokes without touching sessions.
 */
async function revocableActor(
  name: string,
): Promise<PeopleActor & { readonly personId: string }> {
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const personId = crypto.randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`
      insert into crm.users (id, email, first_name, status)
      values (${userId}, ${`${name}@example.test`}, 'Planning', 'active')
    `;
    await transaction`
      insert into crm.workspaces (id, name, status, created_by_user_id)
      values (${workspaceId}, ${`${name} circle`}, 'active', ${userId})
    `;
    await transaction`
      insert into crm.workspace_members (
        id, workspace_id, user_id, role, status, joined_at
      ) values (
        ${memberId}, ${workspaceId}, ${userId}, 'member', 'active', now()
      )
    `;
    await transaction`
      insert into crm.people (
        id, workspace_id, created_by_member_id, given_name
      ) values (${personId}, ${workspaceId}, ${memberId}, 'Planning subject')
    `;
  });
  return { memberId, personId, role: "member", userId, workspaceId };
}

Deno.test({
  name: "GAP-008 a revoked member cannot write tasks or reminders",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const actor = await revocableActor(
      `planning-revocation-${crypto.randomUUID()}`,
    );
    const actors = new PostgresActorRevalidation();
    const transaction = new PostgresPeopleTransaction(deliveryConnection.db);
    const tasks = createTaskManagement({
      actors,
      audit: taskAuditFrom(new PostgresAuditEventRecorder()),
      clock: { now: () => new Date() },
      cursorKeyset: {
        activeVersion: 1,
        keys: new Map([[1, new Uint8Array(32).fill(0x52)]]),
      },
      people: new PostgresRelationshipPersonBoundary(),
      repository: new PostgresTaskRepository(),
      transaction,
    });
    const reminders = createReminderManagement({
      actors,
      audit: reminderAuditFrom(new PostgresAuditEventRecorder()),
      clock: { now: () => new Date() },
      people: new PostgresRelationshipPersonBoundary(),
      repository: new PostgresReminderRepository(actors),
      transaction,
      workspace: new PostgresReminderWorkspaceBoundary(),
    });

    // The same calls succeed while the membership is active.
    const allowed = await tasks.create(actor, {
      requestId: crypto.randomUUID(),
      title: "Allowed while active",
    });
    assert(
      allowed.status === "created",
      `an active member creates tasks: ${JSON.stringify(allowed)}`,
    );

    await sql`
      update crm.workspace_members set left_at = now(), status = 'left'
      where id = ${actor.memberId}
    `;

    const created = await tasks.create(actor, {
      requestId: crypto.randomUUID(),
      title: "Refused after revocation",
    });
    const changed = await tasks.change(actor, allowed.task.id, {
      expectedUpdatedAt: allowed.task.updatedAt,
      title: "Refused rename",
    });
    const listed = await tasks.list(actor, { limit: 10 });
    const read = await tasks.get(actor, allowed.task.id);
    const reminder = await reminders.createReminder(actor, {
      anchorOn: "2099-07-04",
      personId: actor.personId,
      recurrenceInterval: 1,
      recurrenceUnit: "year",
      requestId: crypto.randomUUID(),
      sendTime: "09:00",

      title: "Refused reminder",
    });
    const reminderList = await reminders.listPerson(actor, actor.personId);

    for (
      const [label, result] of [
        ["tasks.create", created],
        ["tasks.change", changed],
        ["tasks.list", listed],
        ["tasks.get", read],
        ["reminders.createReminder", reminder],
        ["reminders.listPerson", reminderList],
      ] as const
    ) {
      assert(
        result.status === "forbidden",
        `${label} answered ${result.status} for a revoked member`,
      );
    }

    const [proof] = await sql<{
      readonly reminders: number;
      readonly tasks: number;
      readonly title: string | null;
    }[]>`
      select
        (select count(*)::int from crm.tasks
          where workspace_id = ${actor.workspaceId}) tasks,
        (select count(*)::int from crm.reminders
          where workspace_id = ${actor.workspaceId}) reminders,
        (select title from crm.tasks where id = ${allowed.task.id}) title
    `;
    assert(proof, "planning revocation proof is present");
    assert(
      proof.tasks === 1 && proof.reminders === 0 &&
        proof.title === "Allowed while active",
      `a revoked member changed planning rows: ${JSON.stringify(proof)}`,
    );
  },
});

Deno.test({
  name: "PLANNING-001 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql.end();
    await configured.close();
    await deliveryConnection.destroy();
  },
});
