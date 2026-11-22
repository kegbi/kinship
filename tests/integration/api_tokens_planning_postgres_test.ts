/**
 * Personal tokens on the reminder routes and the three planning Today regions
 * (MCP-B5), through the deployment's real composition over PostgreSQL.
 *
 * `reminders:read`, `reminders:write`, and `today:read` each admit their own
 * routes and nothing else: no grant implies another, the task grants admit no
 * reminder or Today route, and the reminder and Today grants admit no task
 * route. A token acts only in its one workspace, a revoked or expired one is
 * refused, a present bearer never borrows the cookie, and every audit event a
 * bearer write causes names the token.
 */

import { assert } from "../../packages/backend/testing/assert.ts";
import type { HttpMethod, SignedInFixture } from "../support/api.ts";
import { composeTokenSuite } from "../support/tokens.ts";

const suite = composeTokenSuite();
const { api, register, sql, tokens } = suite;

type Route = readonly [HttpMethod, string, unknown, string];

function send(
  secret: string,
  path: string,
  method: HttpMethod = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return tokens.bearer(secret, path, { body, headers, method });
}

async function expect(response: Response, status: number, label: string) {
  const text = await response.text();
  assert(
    response.status === status,
    `${label}: expected ${status}, received ${response.status}: ${text}`,
  );
  return text ? JSON.parse(text) : undefined;
}

async function createPerson(fixture: SignedInFixture, givenName: string) {
  const response = await api.request(fixture, "/api/v1/people", "POST", {
    givenName,
    isPartial: false,
  });
  assert(response.status === 201, `${givenName} created: ${response.status}`);
  return (await response.json()).person.id as string;
}

/** Two days ahead, so the one-off occurrence lies inside every Today window. */
function soon(days: number): string {
  return Temporal.Now.instant().toZonedDateTimeISO("UTC").toPlainDate()
    .add({ days }).toString();
}

function reminderInput(personId: string, title: string) {
  return {
    anchorOn: soon(2),
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "none",
    requestId: crypto.randomUUID(),
    sendTime: "09:00",
    title,
  };
}

function cadenceInput(personId: string, intervalCount = 2) {
  return {
    intervalCount,
    intervalUnit: "week",
    personId,
    requestId: crypto.randomUUID(),
  };
}

async function reminderState(workspaceId: string) {
  return await sql<{ id: string; is_active: boolean; title: string }[]>`
    select id::text, is_active, title from crm.reminders
    where workspace_id = ${workspaceId}::uuid order by id`;
}

Deno.test("[MCP-B5] PostgreSQL reminder and Today tokens admit only their own planning routes", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`planning-${suffix}@example.test`, "Planning API");
  const foreign = await register(
    `planning-foreign-${suffix}@example.test`,
    "Foreign planning",
  );
  const personId = await createPerson(own, "Ada");
  const foreignPersonId = await createPerson(foreign, "Foreign person");
  const mint = (fixture: SignedInFixture, scopes: string[]) =>
    tokens.mint(fixture, scopes, { name: scopes.join(" + ") });
  const reader = await mint(own, ["reminders:read"]);
  const writer = await mint(own, ["reminders:write"]);
  const today = await mint(own, ["today:read"]);
  const tasksRead = await mint(own, ["tasks:read"]);
  const tasksCreate = await mint(own, ["tasks:create"]);
  const tasksWrite = await mint(own, ["tasks:write"]);
  const foreignWriter = await mint(foreign, ["reminders:write"]);
  const foreignReader = await mint(foreign, ["reminders:read"]);

  // A reminders:write token creates a reminder, retry-safe by requestId.
  const title = `Birthday call ${suffix}`;
  const input = reminderInput(personId, title);
  const created = await expect(
    await send(writer.secret, "/api/v1/reminders", "POST", input),
    201,
    "a reminders:write token creates a reminder",
  );
  const reminderId = created.reminder.id as string;
  assert(created.reminder.personId === personId, "for the person named");
  const replayed = await expect(
    await send(writer.secret, "/api/v1/reminders", "POST", input),
    201,
    "the same requestId and payload replays",
  );
  assert(replayed.reminder.id === reminderId, "a retry returns the original");
  const conflict = await expect(
    await send(writer.secret, "/api/v1/reminders", "POST", {
      ...input,
      title: `${title} changed`,
    }),
    409,
    "a changed payload under the same requestId conflicts",
  );
  assert(conflict.code === "reminder_request_conflict", "and says so");

  // It disables and re-enables the reminder, and sets the person's cadence.
  const disabled = await expect(
    await send(writer.secret, `/api/v1/reminders/${reminderId}/active`, "PUT", {
      active: false,
    }),
    200,
    "a reminders:write token disables the reminder",
  );
  assert(disabled.reminder.isActive === false, "the reminder is disabled");
  const enabled = await expect(
    await send(writer.secret, `/api/v1/reminders/${reminderId}/active`, "PUT", {
      active: true,
    }),
    200,
    "and re-enables it",
  );
  assert(
    enabled.reminder.isActive === true && enabled.reminder.nextOccurrence,
    "re-enabling regenerates the next occurrence",
  );
  const cadence = await expect(
    await send(
      writer.secret,
      "/api/v1/stay-in-touch-cadences",
      "POST",
      cadenceInput(personId),
    ),
    201,
    "a reminders:write token sets the cadence",
  );
  assert(
    cadence.cadence.personId === personId &&
      cadence.cadence.intervalCount === 2,
    "the cadence is the person's",
  );

  // A reminders:read token lists them for the person.
  const listed = await expect(
    await send(reader.secret, `/api/v1/people/${personId}/reminders`),
    200,
    "a reminders:read token lists the person's reminders",
  );
  assert(
    listed.reminders.some((item: { id: string }) => item.id === reminderId) &&
      listed.cadences.some((item: { id: string }) =>
        item.id === cadence.cadence.id
      ),
    "the listing holds the token-made reminder and cadence",
  );

  // A today:read token reads the three planning regions.
  const taskTitle = `Due task ${suffix}`;
  const task = await api.request(own, "/api/v1/tasks", "POST", {
    dueAt: `${soon(1)}T12:00:00.000Z`,
    personId,
    requestId: crypto.randomUUID(),
    title: taskTitle,
  });
  assert(task.status === 201, `cookie task created: ${task.status}`);
  const taskId = (await task.json()).task.id as string;
  const todayTasks = await expect(
    await send(today.secret, "/api/v1/today/tasks"),
    200,
    "a today:read token reads the due tasks",
  );
  assert(
    todayTasks.items.some((item: { id: string }) => item.id === taskId),
    "the due-task region holds the task",
  );
  const todayReminders = await expect(
    await send(today.secret, "/api/v1/today/reminders"),
    200,
    "a today:read token reads the reminder region",
  );
  assert(
    todayReminders.reminders.some((item: { title: string }) =>
      item.title === title
    ),
    "the reminder region holds the reminder",
  );
  const attention = await expect(
    await send(today.secret, "/api/v1/today/attention"),
    200,
    "a today:read token reads the attention queue",
  );
  assert(
    JSON.stringify(attention).includes(taskTitle),
    "the attention queue holds the due task",
  );

  // Every grant is independent: each token is refused everywhere else.
  const reminderRoutes: readonly Route[] = [
    [
      "GET",
      `/api/v1/people/${personId}/reminders`,
      undefined,
      "reminders:read",
    ],
    [
      "POST",
      "/api/v1/reminders",
      reminderInput(personId, `Refused ${suffix}`),
      "reminders:write",
    ],
    ["PUT", `/api/v1/reminders/${reminderId}/active`, {
      active: false,
    }, "reminders:write"],
    [
      "POST",
      "/api/v1/stay-in-touch-cadences",
      cadenceInput(personId, 9),
      "reminders:write",
    ],
  ];
  const todayRoutes: readonly Route[] = [
    ["GET", "/api/v1/today/attention", undefined, "today:read"],
    ["GET", "/api/v1/today/reminders", undefined, "today:read"],
    ["GET", "/api/v1/today/tasks", undefined, "today:read"],
  ];
  const taskRoutes: readonly Route[] = [
    ["GET", "/api/v1/tasks", undefined, "tasks:read"],
    ["GET", `/api/v1/tasks/${taskId}`, undefined, "tasks:read"],
    ["POST", "/api/v1/tasks", {
      requestId: crypto.randomUUID(),
      title: "Refused",
    }, "tasks:create"],
    ["PATCH", `/api/v1/tasks/${taskId}`, { title: "Refused" }, "tasks:write"],
    ["PUT", `/api/v1/tasks/${taskId}/completion`, {
      completed: true,
    }, "tasks:write"],
  ];
  const holders = [
    ["reminders:read", reader],
    ["reminders:write", writer],
    ["today:read", today],
    ["tasks:read", tasksRead],
    ["tasks:create", tasksCreate],
    ["tasks:write", tasksWrite],
  ] as const;
  const before = await reminderState(own.workspaceId);
  for (const [grant, holder] of holders) {
    for (
      const [method, path, body, scope] of [
        ...reminderRoutes,
        ...todayRoutes,
        ...taskRoutes,
      ]
    ) {
      if (scope === grant) continue;
      await expect(
        await send(holder.secret, path, method, body, { cookie: own.cookie }),
        401,
        `${grant} is refused on ${method} ${path}`,
      );
    }
  }
  assert(
    JSON.stringify(await reminderState(own.workspaceId)) ===
      JSON.stringify(before),
    "no refused token changed a reminder",
  );
  const unchangedTask =
    await (await api.request(own, `/api/v1/tasks/${taskId}`))
      .json();
  assert(
    unchangedTask.task.title === taskTitle &&
      unchangedTask.task.status === "open",
    "no refused token changed the task",
  );

  // Acknowledging an occurrence stays session-only for every planning grant.
  const occurrenceId = enabled.reminder.nextOccurrence.id as string;
  for (const [grant, holder] of holders) {
    await expect(
      await send(
        holder.secret,
        `/api/v1/reminder-occurrences/${occurrenceId}/acknowledgement`,
        "PUT",
        undefined,
        { origin: "http://localhost" },
      ),
      401,
      `${grant} cannot acknowledge an occurrence`,
    );
  }

  // A token of another workspace reaches none of this workspace's ids.
  await expect(
    await send(foreignReader.secret, `/api/v1/people/${personId}/reminders`),
    404,
    "a foreign reader cannot list this workspace's person",
  );
  await expect(
    await send(
      foreignWriter.secret,
      "/api/v1/reminders",
      "POST",
      reminderInput(personId, `Foreign ${suffix}`),
    ),
    404,
    "a foreign writer cannot remind about this workspace's person",
  );
  await expect(
    await send(
      foreignWriter.secret,
      `/api/v1/reminders/${reminderId}/active`,
      "PUT",
      { active: false },
    ),
    404,
    "a foreign writer cannot disable this workspace's reminder",
  );
  await expect(
    await send(
      foreignWriter.secret,
      "/api/v1/stay-in-touch-cadences",
      "POST",
      cadenceInput(personId, 5),
    ),
    404,
    "a foreign writer cannot set this workspace's cadence",
  );
  for (
    const [method, path, body] of [
      ["GET", `/api/v1/people/${personId}/reminders`, undefined],
      ["PUT", `/api/v1/reminders/${reminderId}/active`, { active: false }],
    ] as const
  ) {
    await expect(
      await send(
        method === "GET" ? foreignReader.secret : foreignWriter.secret,
        path,
        method,
        body,
        { "X-Workspace-Id": own.workspaceId },
      ),
      401,
      `a foreign token cannot ask for this workspace on ${method} ${path}`,
    );
  }
  assert(
    JSON.stringify(await reminderState(own.workspaceId)) ===
      JSON.stringify(before),
    "no foreign token changed a reminder",
  );
  const [foreignRows] = await sql<{ reminders: number; cadences: number }[]>`
    select
      (select count(*)::int from crm.reminders
        where workspace_id = ${foreign.workspaceId}::uuid) as reminders,
      (select count(*)::int from crm.stay_in_touch_cadences
        where workspace_id = ${foreign.workspaceId}::uuid) as cadences`;
  assert(
    foreignRows?.reminders === 0 && foreignRows.cadences === 0,
    "nothing was written in the foreign workspace",
  );
  const ownCadence = await expect(
    await send(reader.secret, `/api/v1/people/${personId}/reminders`),
    200,
    "the person's cadence is still listed",
  );
  assert(
    ownCadence.cadences.length === 1 &&
      ownCadence.cadences[0].intervalCount === 2,
    "no foreign or refused token replaced the cadence",
  );
  await expect(
    await send(
      foreignReader.secret,
      `/api/v1/people/${foreignPersonId}/reminders`,
    ),
    200,
    "the foreign reader still reads its own workspace",
  );

  // A present invalid bearer never borrows a valid session cookie.
  for (
    const [method, path, body] of [...reminderRoutes, ...todayRoutes]
  ) {
    await expect(
      await send("kin_pat_invalid", path, method, body, {
        cookie: own.cookie,
        origin: "http://localhost",
      }),
      401,
      `an invalid bearer with a cookie is refused on ${method} ${path}`,
    );
  }

  // Revoked and expired tokens are refused, cookie or not.
  const planning = ["reminders:read", "reminders:write", "today:read"];
  const expired = await mint(own, planning);
  await sql`update crm.api_tokens set expires_at = now() - interval '1 second'
    where id = ${expired.record.id}::uuid`;
  const revoked = await mint(own, planning);
  assert(
    (await api.request(
      own,
      `/api/v1/settings/api-tokens/${revoked.record.id}`,
      "DELETE",
    )).status === 200,
    "token revoked through the owning API",
  );
  for (const token of [expired, revoked]) {
    for (
      const [method, path, body] of [...reminderRoutes, ...todayRoutes]
    ) {
      await expect(
        await send(token.secret, path, method, body, { cookie: own.cookie }),
        401,
        `an expired or revoked token is refused on ${method} ${path}`,
      );
    }
  }

  // Every audit event the bearer writes caused names the token.
  const audit = await sql<
    { action: string; api_token_id: string | null; subject_id: string }[]
  >`select action, payload ->> 'apiTokenId' as api_token_id,
      subject_id::text
    from crm.audit_events
    where workspace_id = ${own.workspaceId}::uuid
      and subject_id in (${reminderId}::uuid, ${cadence.cadence.id}::uuid)`;
  const actions = new Set(audit.map((row) => row.action));
  assert(
    actions.has("planning.reminder-created") &&
      actions.has("planning.reminder-disabled") &&
      actions.has("planning.reminder-cadence-created") &&
      audit.every((row) => row.api_token_id === writer.record.id),
    `every bearer write's audit event names the token: ${
      JSON.stringify(audit)
    }`,
  );
});

Deno.test({
  name: "close planning token PostgreSQL fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await suite.close();
  },
});
