/**
 * JOURNAL-002 against PostgreSQL: a person's life events are recorded,
 * edited, and removed through the journal facade, stay inside the actor's
 * workspace, and are audited on the person.
 */

import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  createLifeEventManagement,
  lifeEventAuditFrom,
} from "../../packages/backend/modules/journal/public.ts";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { PostgresLifeEventRepository } from "../../packages/backend/modules/journal/adapters/postgres/life_event_repository.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import { PostgresPeopleTransaction } from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import { PostgresRelationshipPersonBoundary } from "../../packages/backend/modules/people/adapters/postgres/relationship_person_boundary.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import { PostgresLifeEventWorkspaceBoundary } from "../../packages/backend/modules/workspaces/adapters/postgres/life_event_workspace_boundary.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  revocableActor,
  revokeMembership,
} from "../support/database.ts";
import { apiSupport, type SignedInFixture } from "../support/api.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl);
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const api = apiSupport(configured.app, mail, sql);

interface LifeEventBody {
  readonly event: {
    readonly date: {
      readonly day?: number;
      readonly happenedAt?: string;
      readonly month?: number;
      readonly precision: string;
      readonly year?: number;
    };
    readonly id: string;
    readonly name?: string;
    readonly typeId?: string;
    readonly typeName?: string;
    readonly updatedAt: string;
  };
  readonly status: string;
}

interface Problem {
  readonly code?: string;
  readonly errors?: Readonly<Record<string, string>>;
}

async function person(fixture: SignedInFixture, givenName: string) {
  const created = await api.request(fixture, "/api/v1/people", "POST", {
    givenName,
    isPartial: false,
  });
  assert(created.status === 201, `${givenName} is created`);
  return (await created.json() as { person: { id: string } }).person.id;
}

async function lifeEventType(
  workspaceId: string,
  name: string,
  archived = false,
) {
  const [row] = await sql<{ readonly id: string }[]>`
    insert into crm.life_event_types (workspace_id, name, is_archived)
    values (${workspaceId}::uuid, ${name}, ${archived})
    returning id::text
  `;
  return row!.id;
}

async function lifeEventCount(personId: string) {
  const [row] = await sql<{ readonly count: number }[]>`
    select count(*)::int as count from crm.life_events
    where person_id = ${personId}::uuid
  `;
  return row!.count;
}

Deno.test("[JOURNAL-002] PostgreSQL life events: record, edit, remove, audit, and tenant isolation", async () => {
  const suffix = crypto.randomUUID();
  const primary = await api.register(
    `life-events-${suffix}@example.test`,
    "Life events",
  );
  const foreign = await api.register(
    `life-events-foreign-${suffix}@example.test`,
    "Foreign life events",
  );
  const personId = await person(primary, "Ada");
  const foreignPersonId = await person(foreign, "Private");
  const moveType = await lifeEventType(primary.workspaceId, "Relocation");
  const retiredType = await lifeEventType(
    primary.workspaceId,
    "Retired type",
    true,
  );
  const foreignType = await lifeEventType(foreign.workspaceId, "Foreign type");
  const path = `/api/v1/people/${personId}/life-events`;

  const created = await api.request(primary, path, "POST", {
    month: 6,
    name: " Moved to Lisbon ",
    precision: "year_month",
    typeId: moveType,
    year: 2019,
  });
  const createdBody = await created.json() as LifeEventBody;
  assert(
    created.status === 201 && createdBody.event.name === "Moved to Lisbon" &&
      createdBody.event.typeName === "Relocation" &&
      createdBody.event.date.year === 2019 &&
      createdBody.event.date.day === undefined,
    `a life event is recorded: ${JSON.stringify(createdBody)}`,
  );
  const eventId = createdBody.event.id;

  const listed = await api.request(primary, path, "GET");
  const listedBody = await listed.json() as {
    readonly events: readonly {
      readonly id: string;
      readonly typeId?: string;
      readonly updatedAt: string;
    }[];
    readonly types: readonly { readonly id: string }[];
  };
  assert(
    listed.status === 200 && listedBody.events[0]?.id === eventId &&
      listedBody.events[0]?.typeId === moveType &&
      listedBody.events[0]?.updatedAt === createdBody.event.updatedAt &&
      JSON.stringify(listedBody.types.map((type) => type.id)) ===
        JSON.stringify([moveType]),
    `the person's page reads the event and only current local types: ${
      JSON.stringify(listedBody)
    }`,
  );

  const edited = await api.request(primary, `${path}/${eventId}`, "PATCH", {
    expectedUpdatedAt: createdBody.event.updatedAt,
    name: "Moved to Porto",
    precision: "year",
    year: 2020,
  });
  const editedBody = await edited.json() as LifeEventBody;
  assert(
    edited.status === 200 && editedBody.event.name === "Moved to Porto" &&
      editedBody.event.typeId === undefined &&
      editedBody.event.date.month === undefined,
    `the event is replaced: ${JSON.stringify(editedBody)}`,
  );
  const stale = await api.request(primary, `${path}/${eventId}`, "PATCH", {
    expectedUpdatedAt: createdBody.event.updatedAt,
    name: "Lost update",
    precision: "unknown",
  });
  assert(
    stale.status === 409 &&
      (await stale.json() as Problem).code === "life_event_stale",
    "an edit against an old revision is refused",
  );

  const invalid = await api.request(primary, path, "POST", {
    month: 2,
    name: "Contradiction",
    precision: "year",
  });
  const invalidBody = await invalid.json() as Problem;
  assert(
    invalid.status === 400 && invalidBody.code === "validation_failed" &&
      invalidBody.errors?.year === "Enter year for year precision." &&
      invalidBody.errors?.month ===
        "Remove month; it contradicts year precision.",
    `contradictory components are named: ${JSON.stringify(invalidBody)}`,
  );
  const retired = await api.request(primary, path, "POST", {
    precision: "unknown",
    typeId: retiredType,
  });
  assert(
    retired.status === 400 &&
      (await retired.json() as Problem).errors?.typeId ===
        "This life-event type is archived. Choose another type.",
    "an archived type is not offered for a new event",
  );

  // Cross-workspace negatives: nothing of the other workspace is reachable.
  const foreignTyped = await api.request(primary, path, "POST", {
    precision: "unknown",
    typeId: foreignType,
  });
  assert(
    foreignTyped.status === 400 &&
      (await foreignTyped.json() as Problem).errors?.typeId ===
        "Choose a life-event type from this workspace.",
    "another workspace's type is refused",
  );
  const onForeignPerson = await api.request(
    primary,
    `/api/v1/people/${foreignPersonId}/life-events`,
    "POST",
    { name: "Intrusion", precision: "unknown" },
  );
  const foreignEdit = await api.request(
    foreign,
    `${path}/${eventId}`,
    "PATCH",
    {
      expectedUpdatedAt: editedBody.event.updatedAt,
      name: "Hijacked",
      precision: "unknown",
    },
  );
  const foreignDelete = await api.request(
    foreign,
    `/api/v1/people/${foreignPersonId}/life-events/${eventId}`,
    "DELETE",
    { expectedUpdatedAt: editedBody.event.updatedAt },
  );
  for (const refused of [onForeignPerson, foreignEdit, foreignDelete]) {
    assert(
      refused.status === 404 &&
        (await refused.json() as Problem).code === "life_event_not_found",
      "another workspace's person and event are concealed",
    );
  }
  assert(
    await lifeEventCount(foreignPersonId) === 0 &&
      await lifeEventCount(personId) === 1,
    "no cross-workspace row was written",
  );
  const [survivor] = await sql<{ readonly name: string }[]>`
    select name from crm.life_events where id = ${eventId}::uuid
  `;
  assert(survivor?.name === "Moved to Porto", "the event was not hijacked");

  // An archived person is read-only; a module turned off refuses writes.
  await sql`update crm.people set archived_at = now()
    where id = ${personId}::uuid`;
  const archived = await api.request(primary, path, "POST", {
    name: "Too late",
    precision: "unknown",
  });
  assert(
    archived.status === 409 &&
      (await archived.json() as Problem).code === "archived_write_rejected",
    "an archived person's life events are read-only",
  );
  await sql`update crm.people set archived_at = null
    where id = ${personId}::uuid`;
  await sql`
    insert into crm.workspace_profile_modules (workspace_id, key, is_active)
    values (${primary.workspaceId}::uuid, 'life-events', false)
  `;
  const hidden = await api.request(primary, path, "POST", {
    name: "Hidden",
    precision: "unknown",
  });
  assert(
    hidden.status === 403 &&
      (await hidden.json() as Problem).code === "life_events_forbidden",
    "a workspace that turned life events off refuses writes",
  );
  await sql`
    delete from crm.workspace_profile_modules
    where workspace_id = ${primary.workspaceId}::uuid and key = 'life-events'
  `;

  const deleted = await api.request(primary, `${path}/${eventId}`, "DELETE", {
    expectedUpdatedAt: editedBody.event.updatedAt,
  });
  assert(
    deleted.status === 200 &&
      JSON.stringify(await deleted.json()) ===
        JSON.stringify({ lifeEventId: eventId, status: "deleted" }) &&
      await lifeEventCount(personId) === 0,
    "the event is removed",
  );
  const audited = await sql<
    { readonly action: string; readonly person_id: string }[]
  >`
    select action, person_id::text from crm.audit_events
    where subject_type = 'life_event' and subject_id = ${eventId}::uuid
    order by created_at, action
  `;
  assert(
    JSON.stringify(audited.map((row) => row.action)) === JSON.stringify([
          "journal.life-event-created",
          "journal.life-event-updated",
          "journal.life-event-deleted",
        ]) && audited.every((row) => row.person_id === personId),
    `each write is audited on the person: ${JSON.stringify(audited)}`,
  );
});

Deno.test("[JOURNAL-002] PostgreSQL keeps an imported instant only while its date is unchanged", async () => {
  const suffix = crypto.randomUUID();
  const owner = await api.register(
    `life-events-instant-${suffix}@example.test`,
    "Imported life events",
  );
  const personId = await person(owner, "Imported");
  const [imported] = await sql<{ readonly id: string }[]>`
    insert into crm.life_events (
      workspace_id, person_id, name, year, month, day, happened_at, precision
    ) values (
      ${owner.workspaceId}::uuid, ${personId}::uuid, 'Born', 1990, 3, 4,
      '1990-03-04T10:15:00Z', 'full'
    ) returning id::text
  `;
  const path = `/api/v1/people/${personId}/life-events/${imported!.id}`;
  const listed = await api.request(
    owner,
    `/api/v1/people/${personId}/life-events`,
    "GET",
  );
  const revision = (await listed.json() as {
    readonly events: readonly { readonly updatedAt: string }[];
  }).events[0]!.updatedAt;
  const renamed = await api.request(owner, path, "PATCH", {
    day: 4,
    expectedUpdatedAt: revision,
    month: 3,
    name: "Born in Leeds",
    precision: "full",
    year: 1990,
  });
  const renamedBody = await renamed.json() as LifeEventBody;
  assert(
    renamed.status === 200 &&
      renamedBody.event.date.happenedAt === "1990-03-04T10:15:00.000000Z",
    `renaming keeps the recorded instant: ${JSON.stringify(renamedBody)}`,
  );
  const moved = await api.request(owner, path, "PATCH", {
    day: 5,
    expectedUpdatedAt: renamedBody.event.updatedAt,
    month: 3,
    name: "Born in Leeds",
    precision: "full",
    year: 1990,
  });
  const movedBody = await moved.json() as LifeEventBody;
  const [row] = await sql<{ readonly happened_at: Date | null }[]>`
    select happened_at from crm.life_events where id = ${imported!.id}::uuid
  `;
  assert(
    moved.status === 200 && movedBody.event.date.happenedAt === undefined &&
      movedBody.event.date.day === 5 && row?.happened_at === null,
    "moving the date drops an instant that no longer describes it",
  );
});

Deno.test("[JOURNAL-002] PostgreSQL removing a life event deletes only the reminders attached to it", async () => {
  const suffix = crypto.randomUUID();
  const owner = await api.register(
    `life-events-reminders-${suffix}@example.test`,
    "Life-event reminders",
  );
  const personId = await person(owner, "Reminded");
  const path = `/api/v1/people/${personId}/life-events`;
  const created = await api.request(owner, path, "POST", {
    day: 4,
    month: 3,
    name: "Anniversary",
    precision: "month_day",
  });
  const event = (await created.json() as LifeEventBody).event;
  const kept = await api.request(owner, path, "POST", {
    name: "Kept milestone",
    precision: "unknown",
  });
  const keptEvent = (await kept.json() as LifeEventBody).event;
  const [attached, siblingOnEvent, personal] = await sql<
    { readonly id: string }[]
  >`
    insert into crm.reminders (
      workspace_id, person_id, life_event_id, target_kind, title, anchor_on
    ) values
      (${owner.workspaceId}::uuid, ${personId}::uuid, ${event.id}::uuid,
        'life_event', 'Attached', '2027-03-04'),
      (${owner.workspaceId}::uuid, ${personId}::uuid, ${keptEvent.id}::uuid,
        'life_event', 'Other event', '2027-03-04'),
      (${owner.workspaceId}::uuid, ${personId}::uuid, null,
        'person', 'Person reminder', '2027-03-04')
    returning id::text
  `;
  const removed = await api.request(owner, `${path}/${event.id}`, "DELETE", {
    expectedUpdatedAt: event.updatedAt,
  });
  const remaining = (await sql<{ readonly id: string }[]>`
    select id::text from crm.reminders
    where id in (${attached!.id}::uuid, ${siblingOnEvent!.id}::uuid,
      ${personal!.id}::uuid)
  `).map((row) => row.id).sort();
  assert(
    removed.status === 200 &&
      JSON.stringify(remaining) ===
        JSON.stringify([siblingOnEvent!.id, personal!.id].sort()),
    `only the removed event's reminder is gone: ${JSON.stringify(remaining)}`,
  );
});

Deno.test("[JOURNAL-002] PostgreSQL offers at most 100 current types; an event keeps one past the cap", async () => {
  const suffix = crypto.randomUUID();
  const owner = await api.register(
    `life-events-types-${suffix}@example.test`,
    "Many life-event types",
  );
  const personId = await person(owner, "Typed");
  await sql`
    insert into crm.life_event_types (workspace_id, name, sort_order)
    select ${owner.workspaceId}::uuid, 'Type ' || lpad(n::text, 3, '0'), n
    from generate_series(1, 101) as n
  `;
  const [last] = await sql<{ readonly id: string }[]>`
    select id::text from crm.life_event_types
    where workspace_id = ${owner.workspaceId}::uuid and name = 'Type 101'
  `;
  const path = `/api/v1/people/${personId}/life-events`;
  const created = await api.request(owner, path, "POST", {
    precision: "unknown",
    typeId: last!.id,
  });
  const listed = await api.request(owner, path, "GET");
  const body = await listed.json() as {
    readonly events: readonly { readonly typeName?: string }[];
    readonly types: readonly { readonly id: string }[];
  };
  assert(
    created.status === 201 && body.types.length === 100 &&
      !body.types.some((type) => type.id === last!.id) &&
      body.events[0]?.typeName === "Type 101",
    "the vocabulary is capped while a type past the cap still names its event",
  );
});

Deno.test({
  name:
    "[JOURNAL-002] PostgreSQL a member writes life events and a revoked member cannot",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        sql,
        `life-event-revocation-${crypto.randomUUID()}`,
        { role: "member" as const },
      );
      const lifeEvents = createLifeEventManagement({
        actors: new PostgresActorRevalidation(),
        audit: lifeEventAuditFrom(new PostgresAuditEventRecorder()),
        clock: { now: () => new Date() },
        ids: { create: () => crypto.randomUUID() },
        people: new PostgresRelationshipPersonBoundary(),
        repository: new PostgresLifeEventRepository(),
        transaction: new PostgresPeopleTransaction(connection.db),
        workspace: new PostgresLifeEventWorkspaceBoundary(),
      });

      const allowed = await lifeEvents.create(actor, actor.personId, {
        name: "Allowed milestone",
        precision: "year",
        year: 2001,
      });
      assert(
        allowed.status === "created",
        "the member role holds journal.write for life events",
      );

      await revokeMembership(sql, actor.memberId);

      const refusedCreate = await lifeEvents.create(actor, actor.personId, {
        name: "Refused milestone",
        precision: "unknown",
      });
      const refusedDelete = await lifeEvents.delete(
        actor,
        actor.personId,
        allowed.event.id,
        { expectedUpdatedAt: allowed.event.updatedAt },
      );
      assert(
        refusedCreate.status === "forbidden" &&
          refusedDelete.status === "forbidden",
        "a revoked member still wrote a life event",
      );
      assert(
        await lifeEventCount(actor.personId) === 1,
        "a revoked member changed the person's life events",
      );
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name: "JOURNAL-002 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await configured.close();
    await sql.end();
  },
});
