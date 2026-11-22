/**
 * Deleting a task, editing and deleting a reminder, and deleting a cadence
 * (MCP-D2), through the deployment's real composition over PostgreSQL, by
 * cookie and by personal token.
 *
 * Each operation takes the revision its caller read, changes nothing in
 * another workspace, keeps every delivered or in-flight reminder occurrence,
 * refuses a reminder an important date owns, and is audited with the token
 * that made it. The last tests interleave the delivery worker with an edit
 * and a delete: an in-flight effect survives the delete, and a top-up that
 * reads a reminder while an edit is replacing its future waits for the edit
 * instead of minting the old schedule.
 */

import {
  createReminderDeliveryWorker,
  reminderDeliveryAuditFrom,
  type ReminderDeliveryProvider,
} from "../../packages/backend/modules/planning/public.ts";
import { InAppReminderDelivery } from "../../packages/backend/modules/planning/adapters/in_app/reminder_delivery.ts";
import {
  PostgresInAppReminderEffectStore,
  PostgresReminderDeliveryRepository,
} from "../../packages/backend/modules/planning/adapters/postgres/reminder_repository.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import { PostgresPeopleTransaction } from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import { PostgresReminderDeliveryPreferences } from "../../packages/backend/modules/workspaces/adapters/postgres/reminder_delivery_preferences.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  type HttpMethod,
  sessionCookie,
  type SignedInFixture,
} from "../support/api.ts";
import {
  addMembership,
  requireWorkerDatabaseUrl,
} from "../support/database.ts";
import { composeTokenSuite } from "../support/tokens.ts";

const suite = composeTokenSuite();
const { api, register, sql, tokens } = suite;
const workerConnection = connectDatabase(requireWorkerDatabaseUrl());
const deliveryRepository = new PostgresReminderDeliveryRepository(
  workerConnection.db,
  new PostgresActorRevalidation(),
  new PostgresReminderDeliveryPreferences(),
);

interface Reminder {
  readonly id: string;
  readonly nextOccurrence?: { readonly id: string };
  readonly recurrenceUnit: string;
  readonly title: string;
  readonly updatedAt: string;
}

async function expect(response: Response, status: number, label: string) {
  const text = await response.text();
  assert(
    response.status === status,
    `${label}: expected ${status}, received ${response.status}: ${text}`,
  );
  return text ? JSON.parse(text) : undefined;
}

function cookie(
  fixture: SignedInFixture,
  path: string,
  method: HttpMethod = "GET",
  body?: unknown,
) {
  return api.request(fixture, path, method, body);
}

function bearer(
  secret: string,
  path: string,
  method: HttpMethod = "GET",
  body?: unknown,
) {
  return tokens.bearer(secret, path, { body, method });
}

async function createPerson(fixture: SignedInFixture, givenName: string) {
  const created = await expect(
    await cookie(fixture, "/api/v1/people", "POST", {
      givenName,
      isPartial: false,
    }),
    201,
    `${givenName} created`,
  );
  return created.person.id as string;
}

/** A local date `days` from today, in UTC as the fixtures' zone reads it. */
function soon(days: number): string {
  return Temporal.Now.instant().toZonedDateTimeISO("UTC").toPlainDate()
    .add({ days }).toString();
}

async function createReminder(
  fixture: SignedInFixture,
  personId: string,
  title: string,
  recurrenceUnit = "week",
  requestId: string = crypto.randomUUID(),
): Promise<Reminder> {
  const created = await expect(
    await cookie(fixture, "/api/v1/reminders", "POST", {
      anchorOn: soon(2),
      personId,
      recurrenceInterval: 1,
      recurrenceUnit,
      requestId,
      sendTime: "09:00",
      title,
    }),
    201,
    `${title} created`,
  );
  return created.reminder as Reminder;
}

async function personReminders(fixture: SignedInFixture, personId: string) {
  return await expect(
    await cookie(fixture, `/api/v1/people/${personId}/reminders`),
    200,
    "the person's reminders are read",
  ) as {
    readonly cadences: readonly { id: string; updatedAt: string }[];
    readonly reminders: readonly Reminder[];
  };
}

async function occurrences(reminderId: string) {
  return await sql<{
    readonly claim_token: string | null;
    readonly id: string;
    readonly occurs_on: string;
    readonly provider_effect_at: string | null;
    readonly status: string;
    readonly title_snapshot: string | null;
  }[]>`
    select id::text, occurs_on::text, status, title_snapshot,
      claim_token::text, provider_effect_at::text
    from crm.reminder_occurrences
    where reminder_id = ${reminderId}::uuid
    order by occurs_on, channel, id`;
}

/** Marks one occurrence delivered and confirmed, as the worker would. */
async function markSent(occurrenceId: string) {
  await sql`
    update crm.reminder_occurrences set status = 'sent', sent_at = now(),
      attempt_count = 1, provider_result_state = 'confirmed',
      provider_receipt = ${`test:${occurrenceId}`}, provider_effect_at = now(),
      visible_at = now(), updated_at = now()
    where id = ${occurrenceId}::uuid`;
}

/** Leaves one occurrence claimed by a worker that has not finished it. */
async function markClaimed(occurrenceId: string) {
  await sql`
    update crm.reminder_occurrences set status = 'claimed',
      claim_token = gen_random_uuid(), claim_owner = 'mcp-d2-in-flight',
      lease_expires_at = now() + interval '10 minutes', attempt_count = 1,
      last_attempt_at = now(), updated_at = now()
    where id = ${occurrenceId}::uuid`;
}

async function audit(workspaceId: string, subjectId: string) {
  return await sql<{
    readonly action: string;
    readonly api_token_id: string | null;
    readonly payload_action: string | null;
    readonly request_id: string | null;
  }[]>`
    select action, payload ->> 'apiTokenId' as api_token_id,
      payload ->> 'action' as payload_action,
      payload ->> 'requestId' as request_id
    from crm.audit_events
    where workspace_id = ${workspaceId}::uuid
      and subject_id = ${subjectId}::uuid
    order by occurred_at, id`;
}

Deno.test("[MCP-D2] PostgreSQL deletes a task by revision, hides it everywhere, and spends its request", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`task-delete-${suffix}@example.test`, "Tasks");
  const foreign = await register(
    `task-delete-foreign-${suffix}@example.test`,
    "Foreign tasks",
  );
  const personId = await createPerson(own, "Ada");
  const title = `Delete me ${suffix}`;
  const input = {
    dueAt: `${soon(1)}T12:00:00.000Z`,
    personId,
    requestId: crypto.randomUUID(),
    title,
  };
  const created = await expect(
    await cookie(own, "/api/v1/tasks", "POST", input),
    201,
    "the task is created",
  );
  const taskId = created.task.id as string;
  const revision = { expectedUpdatedAt: created.task.updatedAt as string };
  const today = await expect(
    await cookie(own, "/api/v1/today/tasks"),
    200,
    "Today is read",
  );
  const found = await expect(
    await cookie(own, `/api/v1/search?q=${encodeURIComponent(title)}`),
    200,
    "the workspace is searched",
  );
  assert(
    JSON.stringify(today).includes(title) &&
      JSON.stringify(found.groups).includes(taskId),
    "the task is due Today and found by search first",
  );

  await expect(
    await cookie(foreign, `/api/v1/tasks/${taskId}`, "DELETE", revision),
    404,
    "another workspace's member cannot delete it",
  );
  const reminderWriter = await tokens.mint(own, ["reminders:write"]);
  await expect(
    await bearer(
      reminderWriter.secret,
      `/api/v1/tasks/${taskId}`,
      "DELETE",
      revision,
    ),
    401,
    "reminders:write does not delete tasks",
  );
  const stale = await expect(
    await cookie(own, `/api/v1/tasks/${taskId}`, "DELETE", {
      expectedUpdatedAt: "2025-01-01T00:00:00.000Z",
    }),
    409,
    "a stale revision is refused",
  );
  assert(stale.code === "task_stale", "and names the stale task");
  const [kept] = await sql<{ deleted: boolean }[]>`
    select deleted_at is not null as deleted from crm.tasks
    where id = ${taskId}::uuid`;
  assert(kept?.deleted === false, "nothing refused deleted the task");

  const deleted = await expect(
    await cookie(own, `/api/v1/tasks/${taskId}`, "DELETE", revision),
    200,
    "the member deletes the task by cookie",
  );
  assert(
    deleted.status === "deleted" && deleted.taskId === taskId,
    "the delete names the task",
  );
  await expect(
    await cookie(own, `/api/v1/tasks/${taskId}`),
    404,
    "the deleted task is not found",
  );
  for (
    const path of [
      "/api/v1/tasks",
      "/api/v1/today/tasks",
      "/api/v1/today/attention",
      `/api/v1/search?q=${encodeURIComponent(title)}`,
    ]
  ) {
    const read = await expect(await cookie(own, path), 200, path);
    // The search echoes its query, so only its groups are looked at.
    assert(
      !JSON.stringify(read.groups ?? read).includes(title),
      `${path} leaves it out`,
    );
  }
  await expect(
    await cookie(own, `/api/v1/tasks/${taskId}`, "DELETE", revision),
    404,
    "deleting it again answers not found",
  );
  const retried = await expect(
    await cookie(own, "/api/v1/tasks", "POST", input),
    409,
    "retrying the create of a deleted task",
  );
  assert(
    retried.code === "task_request_deleted",
    "is refused rather than recreated or replayed",
  );
  const [rows] = await sql<{ count: number }[]>`
    select count(*)::int from crm.tasks where id = ${taskId}::uuid`;
  assert(rows?.count === 1, "the soft-deleted row keeps its identifier");

  const writer = await tokens.mint(own, ["tasks:write"]);
  const second = await expect(
    await cookie(own, "/api/v1/tasks", "POST", {
      requestId: crypto.randomUUID(),
      title: `Token delete ${suffix}`,
    }),
    201,
    "a second task is created",
  );
  await expect(
    await bearer(writer.secret, `/api/v1/tasks/${second.task.id}`, "DELETE", {
      expectedUpdatedAt: second.task.updatedAt,
    }),
    200,
    "a tasks:write token deletes a task with no cookie or Origin",
  );
  const byCookie = await audit(own.workspaceId, taskId);
  const byToken = await audit(own.workspaceId, second.task.id);
  assert(
    byCookie.at(-1)?.payload_action === "deleted" &&
      byCookie.at(-1)?.api_token_id === null &&
      byCookie.at(-1)?.request_id !== null &&
      byToken.at(-1)?.payload_action === "deleted" &&
      byToken.at(-1)?.api_token_id === writer.record.id,
    `each delete is audited with its correlation: ${
      JSON.stringify({ byCookie, byToken })
    }`,
  );
});

Deno.test("[MCP-D2] PostgreSQL edits a reminder, replacing only unattempted future work", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`reminder-edit-${suffix}@example.test`, "Edit");
  const foreign = await register(
    `reminder-edit-foreign-${suffix}@example.test`,
    "Foreign edit",
  );
  const personId = await createPerson(own, "Grace");
  const reminder = await createReminder(own, personId, `Weekly ${suffix}`);
  const before = await occurrences(reminder.id);
  assert(before.length === 8, `a weekly window is minted: ${before.length}`);
  const sent = before[0]!;
  const inFlight = before[1]!;
  await markSent(sent.id);
  await markClaimed(inFlight.id);
  const [claimed] = await occurrences(reminder.id).then((rows) =>
    rows.filter((row) => row.id === inFlight.id)
  );
  const writer = await tokens.mint(own, ["reminders:write"]);
  const tasksWriter = await tokens.mint(own, ["tasks:write"]);
  const edit = {
    expectedUpdatedAt: reminder.updatedAt,
    recurrenceUnit: "day",
    sendTime: "10:30",
    title: `Daily ${suffix}`,
  };
  await expect(
    await bearer(
      tasksWriter.secret,
      `/api/v1/reminders/${reminder.id}`,
      "PATCH",
      edit,
    ),
    401,
    "tasks:write does not edit reminders",
  );
  await expect(
    await cookie(foreign, `/api/v1/reminders/${reminder.id}`, "PATCH", edit),
    404,
    "another workspace's member cannot edit it",
  );
  const edited = await expect(
    await bearer(
      writer.secret,
      `/api/v1/reminders/${reminder.id}`,
      "PATCH",
      edit,
    ),
    200,
    "a reminders:write token edits the reminder",
  );
  assert(
    edited.status === "saved" && edited.reminder.recurrenceUnit === "day" &&
      edited.reminder.title === edit.title &&
      edited.reminder.sendTime === "10:30:00" &&
      edited.reminder.nextOccurrence,
    `the reminder carries its new schedule: ${JSON.stringify(edited)}`,
  );
  const after = await occurrences(reminder.id);
  const kept = after.find((row) => row.id === sent.id);
  const flying = after.find((row) => row.id === inFlight.id);
  assert(
    kept?.status === "sent" && kept.title_snapshot === `Weekly ${suffix}` &&
      kept.provider_effect_at !== null,
    `the delivered occurrence keeps its evidence: ${JSON.stringify(kept)}`,
  );
  assert(
    flying?.status === "claimed" &&
      flying.claim_token === claimed?.claim_token,
    `the in-flight claim is left to its worker: ${JSON.stringify(flying)}`,
  );
  // The daily window from now covers the eight days from the anchor: the
  // first is the delivered date, which keeps its row, and the rest are minted
  // afresh. The in-flight date is the eighth, so it keeps its claim; the old
  // weekly dates after it stay cancelled.
  const daily = Array.from({ length: 8 }, (_, index) => soon(2 + index));
  const pending = after.filter((row) => row.status === "pending");
  assert(
    JSON.stringify(pending.map((row) => row.occurs_on)) ===
        JSON.stringify(
          daily.filter((date) =>
            date !== sent.occurs_on && date !== inFlight.occurs_on
          ),
        ) &&
      pending.every((row) => row.title_snapshot === edit.title) &&
      after.filter((row) => row.status === "cancelled").every((row) =>
        !daily.includes(row.occurs_on)
      ),
    `the future is a fresh daily window under the new title: ${
      JSON.stringify(after)
    }`,
  );
  const [times] = await sql<{ wrong: number }[]>`
    select count(*)::int as wrong
    from crm.reminder_occurrences occurrence
    join crm.workspace_settings setting
      on setting.workspace_id = ${own.workspaceId}::uuid
    left join crm.member_preferences preference
      on preference.member_id = occurrence.member_id
    where occurrence.reminder_id = ${reminder.id}::uuid
      and occurrence.status = 'pending'
      and (occurrence.deliver_at at time zone coalesce(
        preference.timezone, setting.default_timezone, 'UTC'))::time
        <> '10:30'::time`;
  assert(times?.wrong === 0, "every pending occurrence is sent at 10:30");
  const stale = await expect(
    await cookie(own, `/api/v1/reminders/${reminder.id}`, "PATCH", edit),
    409,
    "the revision the edit replaced is refused",
  );
  assert(stale.code === "reminder_stale", "and named stale");
  const listed = await personReminders(own, personId);
  assert(
    listed.reminders.some((item) =>
      item.id === reminder.id && item.title === edit.title
    ),
    "the person's reminders show the edit",
  );
  const audited = await audit(own.workspaceId, reminder.id);
  assert(
    audited.some((row) =>
      row.action === "planning.reminder-edited" &&
      row.api_token_id === writer.record.id
    ),
    `the edit is audited with its token: ${JSON.stringify(audited)}`,
  );
});

Deno.test("[MCP-D2] PostgreSQL deletes a reminder, stopping its future and keeping its evidence", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`reminder-delete-${suffix}@example.test`, "Del");
  const foreign = await register(
    `reminder-delete-foreign-${suffix}@example.test`,
    "Foreign delete",
  );
  const personId = await createPerson(own, "Mary");
  const requestId = crypto.randomUUID();
  const title = `Remove ${suffix}`;
  const reminder = await createReminder(
    own,
    personId,
    title,
    "week",
    requestId,
  );
  const [first] = await occurrences(reminder.id);
  await markSent(first!.id);
  const revision = { expectedUpdatedAt: reminder.updatedAt };
  await expect(
    await cookie(
      foreign,
      `/api/v1/reminders/${reminder.id}`,
      "DELETE",
      revision,
    ),
    404,
    "another workspace's member cannot delete it",
  );
  assert(
    (await occurrences(reminder.id)).filter((row) => row.status === "pending")
      .length === 7,
    "the refused delete cancelled nothing",
  );
  const deleted = await expect(
    await cookie(own, `/api/v1/reminders/${reminder.id}`, "DELETE", revision),
    200,
    "the member deletes the reminder by cookie",
  );
  assert(
    deleted.status === "deleted" && deleted.reminderId === reminder.id,
    "the delete names the reminder",
  );
  const after = await occurrences(reminder.id);
  assert(
    after.length === 8 &&
      after.find((row) => row.id === first!.id)?.status === "sent" &&
      after.filter((row) => row.status === "cancelled").length === 7,
    `delivered evidence is kept and future work cancelled: ${
      JSON.stringify(after)
    }`,
  );
  const [row] = await sql<{ deleted: boolean; is_active: boolean }[]>`
    select deleted_at is not null as deleted, is_active from crm.reminders
    where id = ${reminder.id}::uuid`;
  assert(
    row?.deleted === true && row.is_active === false,
    "the definition is soft-deleted and disabled",
  );
  const listed = await personReminders(own, personId);
  assert(
    !listed.reminders.some((item) => item.id === reminder.id),
    "it leaves the person's reminders",
  );
  const today = await expect(
    await cookie(own, "/api/v1/today/reminders"),
    200,
    "Today's reminders are read",
  );
  assert(!JSON.stringify(today).includes(title), "and Today's");
  await expect(
    await cookie(own, `/api/v1/reminders/${reminder.id}`, "DELETE", revision),
    404,
    "deleting it again answers not found",
  );
  await expect(
    await cookie(own, `/api/v1/reminders/${reminder.id}`, "PATCH", {
      ...revision,
      title: "Revived",
    }),
    404,
    "a deleted reminder cannot be edited",
  );
  const retried = await expect(
    await cookie(own, "/api/v1/reminders", "POST", {
      anchorOn: soon(2),
      personId,
      recurrenceInterval: 1,
      recurrenceUnit: "week",
      requestId,
      sendTime: "09:00",
      title,
    }),
    409,
    "retrying the create of a deleted reminder",
  );
  assert(retried.code === "reminder_request_deleted", "is refused");

  const writer = await tokens.mint(own, ["reminders:write"]);
  const second = await createReminder(own, personId, `Token ${suffix}`);
  await expect(
    await bearer(writer.secret, `/api/v1/reminders/${second.id}`, "DELETE", {
      expectedUpdatedAt: second.updatedAt,
    }),
    200,
    "a reminders:write token deletes a reminder",
  );
  const audited = await audit(own.workspaceId, second.id);
  assert(
    audited.at(-1)?.action === "planning.reminder-deleted" &&
      audited.at(-1)?.api_token_id === writer.record.id,
    `the token delete is audited with its token: ${JSON.stringify(audited)}`,
  );
});

Deno.test("[MCP-D2] PostgreSQL refuses to edit or delete a reminder its important date owns", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`reminder-managed-${suffix}@example.test`, "Mgd");
  const personId = await createPerson(own, "Ada");
  const date = Temporal.PlainDate.from(soon(10));
  await expect(
    await cookie(own, `/api/v1/people/${personId}/dates`, "POST", {
      day: date.day,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "birthday",
      month: date.month,
      precision: "month_day",
    }),
    201,
    "the birthday is recorded",
  );
  const [managed] = await sql<
    { id: string; target_kind: string; updated_at: string }[]
  >`
    select id::text, target_kind, updated_at::text from crm.reminders
    where person_id = ${personId}::uuid and deleted_at is null`;
  assert(managed?.target_kind === "person_date", "the date owns a reminder");
  const listed = await personReminders(own, personId);
  const revision = listed.reminders.find((item) => item.id === managed.id)
    ?.updatedAt;
  assert(revision, "the person's reminders list it");
  const before = await occurrences(managed.id);
  for (
    const [method, body] of [
      ["PATCH", { expectedUpdatedAt: revision, title: "Party" }],
      ["DELETE", { expectedUpdatedAt: revision }],
    ] as const
  ) {
    const refused = await expect(
      await cookie(own, `/api/v1/reminders/${managed.id}`, method, body),
      409,
      `${method} on the birthday reminder`,
    );
    assert(
      refused.code === "reminder_managed_by_source",
      `${method} tells the caller to change the date instead`,
    );
  }
  const [after] = await sql<{ deleted: boolean; updated_at: string }[]>`
    select deleted_at is not null as deleted, updated_at::text
    from crm.reminders where id = ${managed.id}::uuid`;
  assert(
    after?.deleted === false && after.updated_at === managed.updated_at &&
      JSON.stringify(await occurrences(managed.id)) === JSON.stringify(before),
    "the refused writes changed nothing",
  );
});

Deno.test("[MCP-D2] PostgreSQL deletes a cadence that an interaction does not bring back", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`cadence-delete-${suffix}@example.test`, "Cad");
  const foreign = await register(
    `cadence-delete-foreign-${suffix}@example.test`,
    "Foreign cadence",
  );
  const personId = await createPerson(own, "Grace");
  const writer = await tokens.mint(own, ["reminders:write"]);
  const created = await expect(
    await bearer(writer.secret, "/api/v1/stay-in-touch-cadences", "POST", {
      intervalCount: 1,
      intervalUnit: "day",
      personId,
      requestId: crypto.randomUUID(),
    }),
    201,
    "a reminders:write token sets the cadence",
  );
  const cadenceId = created.cadence.id as string;
  const call = async () =>
    await expect(
      await cookie(own, "/api/v1/interactions", "POST", {
        calledAt: new Date().toISOString(),
        contactWasCaller: false,
        content: `Caught up ${suffix}`,
        kind: "call",
        personId,
        requestId: crypto.randomUUID(),
      }),
      201,
      "a call is recorded",
    );
  await call();
  const moved = (await personReminders(own, personId)).cadences[0];
  assert(
    moved?.id === cadenceId && moved.updatedAt !== created.cadence.updatedAt,
    "the interaction moved the cadence's revision",
  );
  const stale = await expect(
    await bearer(
      writer.secret,
      `/api/v1/stay-in-touch-cadences/${cadenceId}`,
      "DELETE",
      { expectedUpdatedAt: created.cadence.updatedAt },
    ),
    409,
    "the revision before the interaction is refused",
  );
  assert(stale.code === "reminder_stale", "and named stale");
  await expect(
    await cookie(
      foreign,
      `/api/v1/stay-in-touch-cadences/${cadenceId}`,
      "DELETE",
      {
        expectedUpdatedAt: moved.updatedAt,
      },
    ),
    404,
    "another workspace's member cannot delete it",
  );
  const deleted = await expect(
    await bearer(
      writer.secret,
      `/api/v1/stay-in-touch-cadences/${cadenceId}`,
      "DELETE",
      { expectedUpdatedAt: moved.updatedAt },
    ),
    200,
    "the token deletes the cadence at its current revision",
  );
  assert(
    deleted.status === "deleted" && deleted.cadenceId === cadenceId,
    "the delete names the cadence",
  );
  assert(
    (await personReminders(own, personId)).cadences.length === 0,
    "the person keeps no cadence",
  );
  await call();
  const [left] = await sql<{ cadences: number; receipts: number }[]>`
    select
      (select count(*)::int from crm.stay_in_touch_cadences
        where person_id = ${personId}::uuid) as cadences,
      (select count(*)::int from crm.stay_in_touch_cadence_requests
        where cadence_id = ${cadenceId}::uuid) as receipts`;
  assert(
    left?.cadences === 0 && left.receipts === 0,
    `a later interaction does not bring it back: ${JSON.stringify(left)}`,
  );
  for (const path of ["/api/v1/today/reminders", "/api/v1/today/attention"]) {
    const read = await expect(await cookie(own, path), 200, path);
    assert(!JSON.stringify(read).includes(cadenceId), `${path} leaves it out`);
  }
  await expect(
    await cookie(own, `/api/v1/stay-in-touch-cadences/${cadenceId}`, "DELETE", {
      expectedUpdatedAt: moved.updatedAt,
    }),
    404,
    "deleting it again answers not found",
  );
  const audited = await audit(own.workspaceId, cadenceId);
  assert(
    audited.at(-1)?.action === "planning.reminder-cadence-deleted" &&
      audited.at(-1)?.api_token_id === writer.record.id,
    `the cadence delete is audited with its token: ${JSON.stringify(audited)}`,
  );
});

Deno.test("[MCP-D2] PostgreSQL keeps an in-flight durable effect across a reminder delete", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`reminder-race-${suffix}@example.test`, "Race");
  const personId = await createPerson(own, "Ada");
  const reminder = await createReminder(own, personId, `Race ${suffix}`);
  const occurrenceId = reminder.nextOccurrence!.id;
  // Due long ago, so this tick claims it before anything else due.
  await sql`
    update crm.reminder_occurrences
    set deliver_at = now() - interval '3650 days'
    where id = ${occurrenceId}::uuid`;
  const durable = new InAppReminderDelivery(
    new PostgresInAppReminderEffectStore(workerConnection.db, {
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
  const provider: ReminderDeliveryProvider = {
    async deliver(command) {
      const result = await durable.deliver(command);
      if (command.occurrenceId === occurrenceId) {
        observedEffect();
        await deliveryReleased;
      }
      return result;
    },
    reconcile: (command) => durable.reconcile(command),
  };
  const worker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider,
    repository: deliveryRepository,
    transaction: new PostgresPeopleTransaction(workerConnection.db),
  });
  const tick = worker.tick({ limit: 1, owner: "mcp-d2-delete-race" });
  await Promise.race([
    effectRecorded,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("effect barrier timed out")), 5_000)
    ),
  ]);
  const [inFlight] = (await occurrences(reminder.id)).filter((row) =>
    row.id === occurrenceId
  );
  const deleted = await cookie(
    own,
    `/api/v1/reminders/${reminder.id}`,
    "DELETE",
    { expectedUpdatedAt: reminder.updatedAt },
  );
  resumeDelivery();
  const result = await tick;
  const [after] = await sql<{
    audits: number;
    provider_effect_at: string | null;
    status: string;
    visible_at: string | null;
  }[]>`
    select occurrence.status, occurrence.provider_effect_at::text,
      occurrence.visible_at::text,
      (select count(*)::int from crm.audit_events event
        where event.subject_id = occurrence.id
          and event.action = 'planning.reminder-delivered') as audits
    from crm.reminder_occurrences occurrence
    where occurrence.id = ${occurrenceId}::uuid`;
  const pending = (await occurrences(reminder.id)).filter((row) =>
    row.status === "pending"
  );
  assert(
    inFlight?.status === "claimed" && inFlight.provider_effect_at !== null,
    `the effect was in flight when the delete ran: ${JSON.stringify(inFlight)}`,
  );
  assert(
    deleted.status === 200 && result.results[0]?.status === "sent" &&
      after?.status === "sent" && after.provider_effect_at !== null &&
      after.visible_at !== null && after.audits === 1 && pending.length === 0,
    `the delete neither lost nor repeated the in-flight delivery: ${
      JSON.stringify({ after, pending, result, status: deleted.status })
    }`,
  );
});

Deno.test("[MCP-D2] PostgreSQL a top-up waits for an edit rather than minting the old schedule", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`reminder-topup-${suffix}@example.test`, "Top");
  const personId = await createPerson(own, "Grace");
  const reminder = await createReminder(
    own,
    personId,
    `Daily ${suffix}`,
    "day",
  );
  const window = await occurrences(reminder.id);
  // One date left ahead makes the window short, so a replenishment refills it.
  await sql`
    delete from crm.reminder_occurrences
    where reminder_id = ${reminder.id}::uuid and id <> ${window[0]!.id}::uuid`;
  const anchor = soon(3);
  // An edit to a weekly schedule, held open: the reminder row changed and its
  // unattempted future cancelled, exactly as `editReminder` leaves them
  // before it mints the new window and commits.
  let commitEdit!: () => void;
  const editHeld = new Promise<void>((resolve) => {
    commitEdit = resolve;
  });
  let editStarted!: (pid: number) => void;
  const started = new Promise<number>((resolve) => {
    editStarted = resolve;
  });
  const edit = sql.begin(async (transaction) => {
    await transaction`
      update crm.reminders set recurrence_unit = 'week',
        anchor_on = ${anchor}::date, updated_at = now()
      where id = ${reminder.id}::uuid`;
    await transaction`
      update crm.reminder_occurrences set status = 'cancelled',
        updated_at = now()
      where reminder_id = ${reminder.id}::uuid and status = 'pending'
        and attempt_count = 0`;
    const [backend] = await transaction<{ pid: number }[]>`
      select pg_backend_pid() as pid`;
    editStarted(backend!.pid);
    await editHeld;
  });
  const editPid = await started;
  let replenished = false;
  const replenish = deliveryRepository.replenish({ now: new Date() }).then(
    () => {
      replenished = true;
    },
  );
  // The top-up either finishes on its own, having read the old schedule, or
  // is seen waiting on a lock the held edit holds.
  const deadline = Date.now() + 10_000;
  let waiting = false;
  while (!replenished && !waiting && Date.now() < deadline) {
    const [lock] = await sql<{ waiting: boolean }[]>`
      select exists (
        select 1 from pg_locks
        where not granted and ${editPid}::int = any(pg_blocking_pids(pid))
      ) as waiting`;
    waiting = lock?.waiting === true;
    if (!waiting) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  commitEdit();
  await edit;
  await replenish;
  const pending = (await occurrences(reminder.id)).filter((row) =>
    row.status === "pending"
  );
  const offSchedule = pending.filter((row) =>
    Temporal.PlainDate.from(anchor).until(
          Temporal.PlainDate.from(row.occurs_on),
        ).days % 7 !== 0
  );
  assert(
    waiting,
    "the top-up waited for the edit instead of reading the old schedule",
  );
  assert(
    pending.length > 0 && offSchedule.length === 0,
    `the refilled window follows the edited weekly schedule: ${
      JSON.stringify(pending)
    }`,
  );
});

/**
 * A second member of `owner`'s workspace, signed in there: registered with a
 * workspace of their own, then added to this one and signed into it.
 */
async function joinedMember(
  owner: SignedInFixture,
  email: string,
): Promise<SignedInFixture> {
  const joined = await register(email, "Elsewhere");
  const memberId = await addMembership(
    sql,
    joined.userId,
    owner.workspaceId,
    "member",
  );
  const signed = await api.signIn(email, { workspaceId: owner.workspaceId });
  const cookie = sessionCookie(signed);
  assert(signed.status === 200 && cookie, `${email} signs in to the workspace`);
  return {
    cookie,
    memberId,
    role: "member",
    userId: joined.userId,
    workspaceId: owner.workspaceId,
  };
}

/** One member's occurrences of a reminder, with their local send time. */
async function memberOccurrences(reminderId: string, memberId: string) {
  return await sql<{
    readonly id: string;
    readonly local_time: string;
    readonly occurs_on: string;
    readonly status: string;
    readonly title_snapshot: string | null;
  }[]>`
    select occurrence.id::text, occurrence.occurs_on::text, occurrence.status,
      occurrence.title_snapshot,
      to_char(occurrence.deliver_at at time zone coalesce(
        preference.timezone, setting.default_timezone, 'UTC'), 'HH24:MI')
        as local_time
    from crm.reminder_occurrences occurrence
    join crm.reminders reminder on reminder.id = occurrence.reminder_id
    join crm.workspace_settings setting
      on setting.workspace_id = reminder.workspace_id
    left join crm.member_preferences preference
      on preference.member_id = occurrence.member_id
    where occurrence.reminder_id = ${reminderId}::uuid
      and occurrence.member_id = ${memberId}::uuid
    order by occurrence.occurs_on, occurrence.channel, occurrence.id`;
}

/**
 * Asserts a member's pending occurrences are exactly `dates`, once each,
 * under `title` at `time`: nothing pending from another schedule, and no
 * date twice.
 */
async function assertWindow(
  reminderId: string,
  member: SignedInFixture,
  dates: readonly string[],
  title: string,
  time: string,
  label: string,
) {
  const rows = await memberOccurrences(reminderId, member.memberId);
  const pending = rows.filter((row) => row.status === "pending");
  assert(
    JSON.stringify(pending.map((row) => row.occurs_on)) ===
        JSON.stringify(dates) &&
      pending.every((row) =>
        row.title_snapshot === title && row.local_time === time
      ),
    `${label}: expected ${JSON.stringify(dates)} under ${title} at ${time}, ` +
      `found ${JSON.stringify(rows)}`,
  );
  return rows;
}

async function revision(
  fixture: SignedInFixture,
  personId: string,
  id: string,
) {
  const listed = await personReminders(fixture, personId);
  const reminder = listed.reminders.find((item) => item.id === id);
  assert(reminder, "the reminder is listed");
  return reminder.updatedAt;
}

Deno.test("[MCP-D2] PostgreSQL refills every member after another member re-enables or edits a reminder", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(
    `reminder-members-${suffix}@example.test`,
    "Two",
  );
  const other = await joinedMember(
    owner,
    `reminder-members-other-${suffix}@example.test`,
  );
  const personId = await createPerson(owner, "Grace");
  const weeklyTitle = `Weekly ${suffix}`;
  const reminder = await createReminder(owner, personId, weeklyTitle);
  const weekly = Array.from({ length: 8 }, (_, index) => soon(2 + 7 * index));
  await assertWindow(
    reminder.id,
    owner,
    weekly,
    weeklyTitle,
    "09:00",
    "the creator's weekly window",
  );

  // Disabling cancels everybody's waiting work; re-enabling by the other
  // member gives the creator their window back, not only the other member.
  await expect(
    await cookie(other, `/api/v1/reminders/${reminder.id}/active`, "PUT", {
      active: false,
    }),
    200,
    "the other member disables the reminder",
  );
  await expect(
    await cookie(other, `/api/v1/reminders/${reminder.id}/active`, "PUT", {
      active: true,
    }),
    200,
    "and enables it again",
  );
  for (const member of [owner, other]) {
    await assertWindow(
      reminder.id,
      member,
      weekly,
      weeklyTitle,
      "09:00",
      `after re-enabling, ${member === owner ? "the creator" : "the other"}`,
    );
  }

  // The creator's first date is delivered; the other member then edits the
  // schedule. Every member's waiting work moves onto the daily schedule under
  // the new title and time, and the delivered date is not minted again.
  const [first] = await memberOccurrences(reminder.id, owner.memberId);
  await markSent(first!.id);
  const dailyTitle = `Daily ${suffix}`;
  await expect(
    await cookie(other, `/api/v1/reminders/${reminder.id}`, "PATCH", {
      expectedUpdatedAt: await revision(other, personId, reminder.id),
      recurrenceUnit: "day",
      sendTime: "10:30",
      title: dailyTitle,
    }),
    200,
    "the other member edits the schedule",
  );
  const daily = Array.from({ length: 8 }, (_, index) => soon(2 + index));
  const ownerRows = await assertWindow(
    reminder.id,
    owner,
    daily.slice(1),
    dailyTitle,
    "10:30",
    "the creator follows the other member's edit",
  );
  assert(
    ownerRows.find((row) => row.id === first!.id)?.status === "sent" &&
      ownerRows.filter((row) => row.occurs_on === first!.occurs_on).length ===
        1,
    `the delivered date keeps its one row: ${JSON.stringify(ownerRows)}`,
  );
  await assertWindow(
    reminder.id,
    other,
    daily,
    dailyTitle,
    "10:30",
    "the editor's own window",
  );

  // The worker's next replenishment finds both windows full.
  await deliveryRepository.replenish({ now: new Date() });
  await assertWindow(
    reminder.id,
    owner,
    daily.slice(1),
    dailyTitle,
    "10:30",
    "the creator after a replenishment",
  );
  await assertWindow(
    reminder.id,
    other,
    daily,
    dailyTitle,
    "10:30",
    "the editor after a replenishment",
  );

  // A member left with only cancelled rows on the dates their schedule keeps
  // is short, not full, and the worker revives those never-attempted rows.
  await sql`
    update crm.reminder_occurrences set status = 'cancelled',
      updated_at = now()
    where reminder_id = ${reminder.id}::uuid
      and member_id = ${owner.memberId}::uuid and status = 'pending'`;
  await deliveryRepository.replenish({ now: new Date() });
  await assertWindow(
    reminder.id,
    owner,
    daily.slice(1),
    dailyTitle,
    "10:30",
    "the worker revives the creator's cancelled dates",
  );
});

Deno.test("[MCP-D2] PostgreSQL a yearly reminder another member edits keeps the creator's window", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(
    `reminder-yearly-${suffix}@example.test`,
    "Year",
  );
  const other = await joinedMember(
    owner,
    `reminder-yearly-other-${suffix}@example.test`,
  );
  const personId = await createPerson(owner, "Ada");
  const title = `Yearly ${suffix}`;
  const reminder = await createReminder(owner, personId, title, "year");
  const years = (anchor: string) =>
    Array.from(
      { length: 8 },
      (_, index) =>
        Temporal.PlainDate.from(anchor).add({ years: index }).toString(),
    );
  await assertWindow(
    reminder.id,
    owner,
    years(soon(2)),
    title,
    "09:00",
    "the creator's yearly window",
  );
  const anchorOn = soon(40);
  await expect(
    await cookie(other, `/api/v1/reminders/${reminder.id}`, "PATCH", {
      anchorOn,
      expectedUpdatedAt: await revision(other, personId, reminder.id),
    }),
    200,
    "the other member moves the anniversary",
  );
  await assertWindow(
    reminder.id,
    owner,
    years(anchorOn),
    title,
    "09:00",
    "the creator's years move with the edit",
  );

  // Eight cancelled years of the old date are still ahead. They are not a
  // window: a creator down to one new date is short, and is refilled on the
  // new date rather than waiting years for the old ones to pass.
  await sql`
    delete from crm.reminder_occurrences
    where reminder_id = ${reminder.id}::uuid
      and member_id = ${owner.memberId}::uuid and status = 'pending'
      and occurs_on > ${anchorOn}::date`;
  await deliveryRepository.replenish({ now: new Date() });
  const rows = await assertWindow(
    reminder.id,
    owner,
    years(anchorOn),
    title,
    "09:00",
    "the worker refills the creator's yearly window",
  );
  assert(
    rows.filter((row) => row.status === "cancelled").every((row) =>
      years(soon(2)).includes(row.occurs_on)
    ),
    `the old years stay cancelled: ${JSON.stringify(rows)}`,
  );
});

Deno.test({
  name: "close planning edit and delete PostgreSQL fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await workerConnection.destroy();
    await suite.close();
  },
});
