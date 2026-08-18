import postgres from "postgres";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const password = "correct horse battery staple";

interface Fixture {
  readonly cookie: string;
  readonly memberId: string;
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
  return { cookie, memberId: body.member.id, workspaceId: body.workspace.id };
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

  const [globalList, personList, today] = await Promise.all([
    request(primary, "/api/v1/tasks"),
    request(primary, `/api/v1/tasks?personId=${ada}`),
    request(primary, "/api/v1/today/tasks"),
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
    mutation.status === 404 && detach.status === 404 && reassign.status === 404,
    "soft-deleted current person link escaped task read-only",
  );
});

Deno.test({
  name: "PLANNING-001 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql.end();
    await configured.close();
  },
});
