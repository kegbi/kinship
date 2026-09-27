/**
 * Tasks (split from `planning_postgres_test.ts`, GAP-035): global and person
 * task projections, due precision, paging, optimistic tokens, archived and
 * deleted person links, and a revoked member's writes.
 *
 * Its final test closes the app and pools it loaded from
 * `planning.test-helper.ts`.
 */

import {
  createReminderManagement,
  createTaskManagement,
  reminderAuditFrom,
  taskAuditFrom,
} from "../../packages/backend/modules/planning/public.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import { PostgresPeopleTransaction } from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import { PostgresRelationshipPersonBoundary } from "../../packages/backend/modules/people/adapters/postgres/relationship_person_boundary.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import {
  PostgresReminderRepository,
  PostgresReminderWorkspaceBoundary,
} from "../../packages/backend/modules/planning/adapters/postgres/reminder_repository.ts";
import { PostgresTaskRepository } from "../../packages/backend/modules/planning/adapters/postgres/task_repository.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  createPerson,
  createTask,
  deliveryConnection,
  register,
  request,
  revocableActor,
  sql,
} from "./planning.test-helper.ts";
import { closeResources } from "./planning.test-helper.ts";

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

  // A page holds at most fifty tasks since GAP-023, so the 52 are read as
  // the pages a client would follow.
  const globalPages: Response[] = [];
  const globalItems: {
    readonly id: string;
    readonly person?: { readonly archived: boolean; readonly id: string };
  }[] = [];
  let globalCursor: string | undefined;
  do {
    const page = await request(
      fixture,
      `/api/v1/tasks?limit=50${
        globalCursor ? `&cursor=${encodeURIComponent(globalCursor)}` : ""
      }`,
    );
    const pageBody = await page.json() as {
      readonly items: typeof globalItems;
      readonly nextCursor?: string;
    };
    globalPages.push(page);
    globalItems.push(...pageBody.items);
    globalCursor = pageBody.nextCursor;
  } while (globalCursor && globalPages.length < 5);
  const global = globalPages[0]!;
  const globalBody = { items: globalItems };
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
    globalPages.length === 2 &&
      globalPages.every((page) => page.status === 200) &&
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
  const tooWide = await request(fixture, "/api/v1/tasks?limit=100&status=open");
  assert(tooWide.status === 400, "a task page beyond fifty was served");
  const first = await request(fixture, "/api/v1/tasks?limit=50&status=open");
  const firstBody = await first.json() as {
    readonly items: readonly { readonly id: string }[];
    readonly nextCursor?: string;
  };
  assert(
    first.status === 200 && firstBody.items.length === 50 &&
      firstBody.nextCursor,
    "bounded task page omitted continuation",
  );
  const second = await request(
    fixture,
    `/api/v1/tasks?limit=50&status=open&cursor=${
      encodeURIComponent(firstBody.nextCursor)
    }`,
  );
  const secondBody = await second.json() as {
    readonly items: readonly { readonly id: string }[];
    readonly nextCursor?: string;
  };
  assert(
    second.status === 200 && secondBody.items.length === 50 &&
      secondBody.nextCursor,
    "the second full task page omitted its continuation",
  );
  const third = await request(
    fixture,
    `/api/v1/tasks?limit=50&status=open&cursor=${
      encodeURIComponent(secondBody.nextCursor)
    }`,
  );
  const thirdBody = await third.json() as {
    readonly items: readonly { readonly id: string }[];
    readonly nextCursor?: string;
  };
  assert(
    third.status === 200 && thirdBody.items.length === 1 &&
      !thirdBody.nextCursor &&
      new Set(
          [...firstBody.items, ...secondBody.items, ...thirdBody.items].map((
            item,
          ) => item.id),
        )
          .size === 101,
    "task 101 was unreachable or duplicated",
  );
  const filterMismatch = await request(
    fixture,
    `/api/v1/tasks?limit=50&status=completed&cursor=${
      encodeURIComponent(firstBody.nextCursor)
    }`,
  );
  const tampered = await request(
    fixture,
    `/api/v1/tasks?limit=50&status=open&cursor=${
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
    `/api/v1/tasks?limit=50&status=open&cursor=${
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
  name: "PLANNING-001 PostgreSQL tasks resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await closeResources();
  },
});
