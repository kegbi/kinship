/**
 * The person lifecycle (split from `people_postgres_test.ts`, GAP-035):
 * archive, restore, and delete, versioned edits, and a revoked member's
 * writes.
 *
 * Its final test closes the app and pools it loaded from
 * `people.test-helper.ts`.
 */

import { PostgresReminderDeliveryPreferences } from "../../packages/backend/modules/workspaces/adapters/postgres/reminder_delivery_preferences.ts";
import {
  createImportantDateManagement,
  createPersonLifecycle,
  type PeopleActor,
} from "../../packages/backend/modules/people/public.ts";
import {
  importantDateAuditFrom,
  personLifecycleAuditFrom,
} from "../../packages/backend/modules/people/public.ts";
import { relationshipAuditFrom } from "../../packages/backend/modules/relationships/public.ts";
import { createRelationshipManagement } from "../../packages/backend/modules/relationships/public.ts";
import { PostgresImportantDateRepository } from "../../packages/backend/modules/people/adapters/postgres/important_date_repository.ts";
import { PostgresPeopleTransaction } from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import { PostgresPersonLifecycleRepository } from "../../packages/backend/modules/people/adapters/postgres/person_lifecycle_repository.ts";
import { PostgresRelationshipPersonBoundary } from "../../packages/backend/modules/people/adapters/postgres/relationship_person_boundary.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import { PostgresGenderOptionBoundary } from "../../packages/backend/modules/workspaces/adapters/postgres/gender_option_boundary.ts";
import { PostgresRelationshipWorkspaceBoundary } from "../../packages/backend/modules/workspaces/adapters/postgres/relationship_workspace_boundary.ts";
import { PostgresRelationshipRepository } from "../../packages/backend/modules/relationships/adapters/postgres/relationship_repository.ts";
import { PostgresPersonDateReminderPublisher } from "../../packages/backend/modules/planning/adapters/postgres/person_date_reminders.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  actors,
  configured,
  createPerson,
  createStaleActorFixture,
  getPerson,
  importantDateRequest,
  people,
  peopleConnection,
  profileFacts,
  register,
  sql,
} from "./people.test-helper.ts";
import { closeResources } from "./people.test-helper.ts";
import { truncate } from "../support/database.ts";

Deno.test({
  name:
    "PEOPLE-004 PostgreSQL lifecycle is tenant-safe, atomic, auditable, and retains dependents",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await truncate(sql, ["crm.users", "crm.workspaces"]);
    const owner = await register(
      `lifecycle-owner-${crypto.randomUUID()}@example.test`,
      "Lifecycle circle",
    );
    const foreign = await register(
      `lifecycle-foreign-${crypto.randomUUID()}@example.test`,
      "Foreign lifecycle circle",
    );
    const created = await createPerson(owner, {
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    });
    const createdBody = await created.json() as {
      readonly person: { readonly id: string };
    };
    const personId = createdBody.person.id;
    const foreignPerson = await createPerson(foreign, {
      givenName: "Foreign",
      isPartial: false,
    });
    const foreignId = (await foreignPerson.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    await sql`
      insert into crm.person_dates (person_id, kind, precision)
      values (${personId}, 'custom', 'unknown')
    `;
    const headers = {
      "content-type": "application/json",
      cookie: owner.cookie,
      origin: "http://localhost",
      "X-Workspace-Id": owner.workspaceId,
    };
    const ready = await getPerson(owner, personId);
    const readyBody = await ready.json() as {
      readonly person: { readonly updatedAt: string };
    };
    const initialImpact = await configured.app.request(
      `http://localhost/api/v1/people/${personId}/deletion-impact`,
      {
        headers: {
          cookie: owner.cookie,
          "X-Workspace-Id": owner.workspaceId,
        },
      },
    );
    const initialImpactBody = await initialImpact.json() as {
      readonly impact: { readonly person: { readonly updatedAt: string } };
    };
    assert(
      initialImpactBody.impact.person.updatedAt === readyBody.person.updatedAt,
      `profile and lifecycle versions agree: ${readyBody.person.updatedAt} / ${initialImpactBody.impact.person.updatedAt}`,
    );
    const edited = await configured.app.request(
      `http://localhost/api/v1/people/${personId}`,
      {
        body: JSON.stringify({
          expectedUpdatedAt: readyBody.person.updatedAt,
          familyName: "Byron",
          givenName: "Ada",
          isPartial: false,
        }),
        headers,
        method: "PATCH",
      },
    );
    const editedBody = await edited.json() as {
      readonly person: { readonly updatedAt: string };
    };
    assert(
      edited.status === 200,
      `identity edit succeeds: ${edited.status} ${JSON.stringify(editedBody)}`,
    );

    const staleArchive = await configured.app.request(
      `http://localhost/api/v1/people/${personId}/archive`,
      {
        body: JSON.stringify({
          expectedUpdatedAt: readyBody.person.updatedAt,
        }),
        headers,
        method: "POST",
      },
    );
    assert(staleArchive.status === 409, "stale mutation is explicit");
    const archiveRequest = () =>
      configured.app.request(
        `http://localhost/api/v1/people/${personId}/archive`,
        {
          body: JSON.stringify({
            expectedUpdatedAt: editedBody.person.updatedAt,
          }),
          headers,
          method: "POST",
        },
      );
    const [archiveA, archiveB] = await Promise.all([
      archiveRequest(),
      archiveRequest(),
    ]);
    const archiveBody = await archiveA.clone().json() as {
      readonly person: { readonly updatedAt: string };
    };
    assert(
      archiveA.status === 200 && archiveB.status === 200,
      "overlapping archive requests serialize and replay idempotently",
    );
    const archivedEdit = await configured.app.request(
      `http://localhost/api/v1/people/${personId}`,
      {
        body: JSON.stringify({
          expectedUpdatedAt: archiveBody.person.updatedAt,
          familyName: "Blocked",
          givenName: "Ada",
          isPartial: false,
        }),
        headers,
        method: "PATCH",
      },
    );
    assert(
      archivedEdit.status === 409 &&
        (await archivedEdit.json() as { readonly code: string }).code ===
          "archived_write_rejected",
      "archived identity is read-only",
    );
    const restored = await configured.app.request(
      `http://localhost/api/v1/people/${personId}/restore`,
      {
        body: JSON.stringify({
          expectedUpdatedAt: archiveBody.person.updatedAt,
        }),
        headers,
        method: "POST",
      },
    );
    assert(restored.status === 200, "archived person restores");
    const impact = await configured.app.request(
      `http://localhost/api/v1/people/${personId}/deletion-impact`,
      { headers },
    );
    const impactBody = await impact.json() as {
      readonly impact: {
        readonly confirmation: string;
        readonly dependentRecordPolicy: string;
        readonly person: { readonly updatedAt: string };
      };
    };
    assert(
      impact.status === 200 &&
        impactBody.impact.dependentRecordPolicy === "retained",
      "impact exposes canonical dependent retention",
    );
    const cancelled = await configured.app.request(
      `http://localhost/api/v1/people/${personId}`,
      {
        body: JSON.stringify({
          confirmation: "wrong",
          expectedUpdatedAt: impactBody.impact.person.updatedAt,
        }),
        headers,
        method: "DELETE",
      },
    );
    assert(cancelled.status === 400, "incorrect confirmation changes nothing");
    const deleteRequest = () =>
      configured.app.request(
        `http://localhost/api/v1/people/${personId}`,
        {
          body: JSON.stringify({
            confirmation: impactBody.impact.confirmation,
            expectedUpdatedAt: impactBody.impact.person.updatedAt,
          }),
          headers,
          method: "DELETE",
        },
      );
    const deleted = await deleteRequest();
    const replayed = await deleteRequest();
    assert(
      deleted.status === 200 && replayed.status === 200 &&
        (await getPerson(owner, personId)).status === 404,
      "soft-delete is hidden and idempotent",
    );
    const [proof] = await sql<{
      readonly audit_count: number;
      readonly date_count: number;
      readonly deleted: boolean;
    }[]>`
      select
        person.deleted_at is not null as deleted,
        (select count(*)::int from crm.person_dates
          where person_id = ${personId}) as date_count,
        (select count(*)::int from crm.audit_events
          where person_id = ${personId}
            and action in (
              'people.person-updated', 'people.person-archived',
              'people.person-restored', 'people.person-deleted'
            )) as audit_count
      from crm.people person where person.id = ${personId}
    `;
    assert(
      proof?.deleted && proof.date_count === 1 && proof.audit_count === 4,
      "delete retains dependent history and each real change has one audit",
    );
    assert(
      (await configured.app.request(
            `http://localhost/api/v1/people/${foreignId}/deletion-impact`,
            { headers },
          )).status === 404 &&
        (await configured.app.request(
            `http://localhost/api/v1/people/${crypto.randomUUID()}/deletion-impact`,
            { headers },
          )).status === 404,
      "foreign and missing lifecycle identifiers are indistinguishable",
    );
  },
});

Deno.test({
  name:
    "PEOPLE-004 fixed-clock edits advance versions and retain exact audit identity",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await truncate(sql, ["crm.users", "crm.workspaces"]);
    const owner = await register(
      `lifecycle-clock-${crypto.randomUUID()}@example.test`,
      "Lifecycle clock circle",
    );
    const created = await createPerson(owner, {
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    });
    const personId = (await created.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    const [identity] = await sql<{ readonly user_id: string }[]>`
      select user_id::text from crm.workspace_members
      where id = ${owner.memberId}
    `;
    assert(identity, "fixed-clock lifecycle actor exists");
    const actor: PeopleActor = {
      memberId: owner.memberId,
      role: "owner",
      userId: identity.user_id,
      workspaceId: owner.workspaceId,
    };
    const fixedClock = new Date("2099-01-01T00:00:00.000Z");
    const lifecycle = createPersonLifecycle({
      actors,
      audit: personLifecycleAuditFrom(new PostgresAuditEventRecorder()),
      clock: { now: () => fixedClock },
      genders: new PostgresGenderOptionBoundary(),
      repository: new PostgresPersonLifecycleRepository(),
      transaction: new PostgresPeopleTransaction(peopleConnection.db),
    });
    const initial = await getPerson(owner, personId);
    const initialBody = await initial.json() as {
      readonly person: { readonly updatedAt: string };
    };

    const first = await lifecycle.edit(actor, personId, {
      expectedUpdatedAt: initialBody.person.updatedAt,
      familyName: "Byron",
      givenName: "Ada",
      isPartial: false,
    });
    assert(first.status === "updated", "first fixed-clock edit commits");
    const [firstProof] = await sql<{
      readonly family_name: string;
      readonly updated_at: string;
    }[]>`
      select family_name,
        to_char(updated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
      from crm.people where id = ${personId}
    `;
    assert(
      firstProof?.family_name === "Byron" &&
        firstProof.updated_at === first.person.updatedAt,
      "first intended identity and returned version are persisted",
    );

    const second = await lifecycle.edit(actor, personId, {
      expectedUpdatedAt: first.person.updatedAt,
      familyName: "King",
      givenName: "Ada",
      isPartial: false,
    });
    assert(second.status === "updated", "second fixed-clock edit commits");
    assert(
      second.person.updatedAt !== first.person.updatedAt &&
        second.person.updatedAt > first.person.updatedAt,
      "each fixed-clock mutation returns a unique strictly newer version",
    );

    const headers = {
      "content-type": "application/json",
      cookie: owner.cookie,
      origin: "http://localhost",
      "X-Workspace-Id": owner.workspaceId,
    };
    const replay = await configured.app.request(
      `http://localhost/api/v1/people/${personId}`,
      {
        body: JSON.stringify({
          expectedUpdatedAt: first.person.updatedAt,
          familyName: "Replay",
          givenName: "Ada",
          isPartial: false,
        }),
        headers,
        method: "PATCH",
      },
    );
    assert(replay.status === 409, "replaying the earlier token is stale");

    const [proof] = await sql<{
      readonly audit_count: number;
      readonly distinct_audit_count: number;
      readonly family_name: string;
      readonly version_is_newer: boolean;
    }[]>`
      select person.family_name,
        person.updated_at > ${first.person.updatedAt}::timestamptz
          as version_is_newer,
        (select count(*)::int from crm.audit_events
          where person_id = ${personId}
            and action = 'people.person-updated') as audit_count,
        (select count(distinct id)::int from crm.audit_events
          where person_id = ${personId}
            and action = 'people.person-updated') as distinct_audit_count
      from crm.people person where person.id = ${personId}
    `;
    assert(
      proof?.family_name === "King" && proof.version_is_newer,
      "the stale replay cannot alter the second committed identity or version",
    );
    assert(
      proof.audit_count === 2 && proof.distinct_audit_count === 2,
      "both intended fixed-clock edits are audited exactly once by distinct IDs",
    );
  },
});

Deno.test({
  name:
    "PEOPLE-004 archived people delete directly without losing archive history",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await truncate(sql, ["crm.users", "crm.workspaces"]);
    const owner = await register(
      `archived-delete-${crypto.randomUUID()}@example.test`,
      "Archived delete circle",
    );
    const otherOwner = await register(
      `archived-delete-other-${crypto.randomUUID()}@example.test`,
      "Other archived delete circle",
    );
    const created = await createPerson(owner, {
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    });
    const personId = (await created.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    const otherCreated = await createPerson(otherOwner, {
      familyName: "Contact",
      givenName: "Foreign",
      isPartial: false,
    });
    const otherPersonId = (await otherCreated.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    await sql`
      insert into crm.person_dates (person_id, kind, precision)
      values (${personId}, 'custom', 'unknown')
    `;
    const headers = {
      "content-type": "application/json",
      cookie: owner.cookie,
      origin: "http://localhost",
      "X-Workspace-Id": owner.workspaceId,
    };
    const readyBody = await (await getPerson(owner, personId)).json() as {
      readonly person: { readonly updatedAt: string };
    };
    const archived = await configured.app.request(
      `http://localhost/api/v1/people/${personId}/archive`,
      {
        body: JSON.stringify({
          expectedUpdatedAt: readyBody.person.updatedAt,
        }),
        headers,
        method: "POST",
      },
    );
    const archivedBody = await archived.json() as {
      readonly person: { readonly updatedAt: string };
    };
    assert(archived.status === 200, "fixture archives the person");
    const impact = await configured.app.request(
      `http://localhost/api/v1/people/${personId}/deletion-impact`,
      { headers },
    );
    const impactBody = await impact.json() as {
      readonly impact: {
        readonly confirmation: string;
        readonly person: { readonly updatedAt: string };
      };
    };
    assert(
      impact.status === 200 &&
        impactBody.impact.person.updatedAt === archivedBody.person.updatedAt,
      "deletion preview preserves the archived version",
    );

    const otherReady = await (await getPerson(otherOwner, otherPersonId))
      .json() as {
        readonly person: { readonly updatedAt: string };
      };
    const crossed = await configured.app.request(
      `http://localhost/api/v1/people/${otherPersonId}`,
      {
        body: JSON.stringify({
          confirmation: "DELETE Foreign Contact",
          expectedUpdatedAt: otherReady.person.updatedAt,
        }),
        headers,
        method: "DELETE",
      },
    );
    assert(crossed.status === 404, "cross-tenant delete remains hidden");

    const deleteRequest = () =>
      configured.app.request(
        `http://localhost/api/v1/people/${personId}`,
        {
          body: JSON.stringify({
            confirmation: impactBody.impact.confirmation,
            expectedUpdatedAt: impactBody.impact.person.updatedAt,
          }),
          headers,
          method: "DELETE",
        },
      );
    const deleted = await deleteRequest();
    assert(
      deleted.status === 200,
      `archived person deletes directly: ${deleted.status} ${await deleted
        .text()}`,
    );
    const replayed = await deleteRequest();
    assert(replayed.status === 200, "archived delete replay is idempotent");

    const [proof] = await sql<{
      readonly archived: boolean;
      readonly date_count: number;
      readonly delete_audit_count: number;
      readonly deleted: boolean;
      readonly other_unchanged: boolean;
      readonly other_delete_audit_count: number;
    }[]>`
      select
        person.archived_at is not null as archived,
        person.deleted_at is not null as deleted,
        other.archived_at is null and other.deleted_at is null
          as other_unchanged,
        (select count(*)::int from crm.person_dates
          where person_id = ${personId}) as date_count,
        (select count(*)::int from crm.audit_events
          where person_id = ${personId}
            and action = 'people.person-deleted') as delete_audit_count,
        (select count(*)::int from crm.audit_events
          where person_id = ${otherPersonId}
            and action = 'people.person-deleted') as other_delete_audit_count
      from crm.people person
      cross join crm.people other
      where person.id = ${personId} and other.id = ${otherPersonId}
    `;
    assert(
      proof?.archived && proof.deleted && proof.date_count === 1,
      "delete preserves archive history and dependent records",
    );
    assert(
      proof.delete_audit_count === 1,
      "delete and its replay create exactly one deletion audit",
    );
    assert(
      proof.other_unchanged && proof.other_delete_audit_count === 0,
      "cross-tenant person and audit history remain unchanged",
    );
  },
});

Deno.test({
  name:
    "GAP-008 a revoked member cannot write people, profile facts, dates, or relationships",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const actor = await createStaleActorFixture(
      `revalidation-${crypto.randomUUID()}`,
    );
    const [companion] = await sql<{ readonly id: string }[]>`
      insert into crm.people (workspace_id, created_by_member_id, given_name)
      values (${actor.workspaceId}, ${actor.memberId}, 'Companion')
      returning id::text
    `;
    assert(companion, "the revocation fixture has a second person");
    const importantDates = createImportantDateManagement({
      actors,
      audit: importantDateAuditFrom(new PostgresAuditEventRecorder()),
      clock: { now: () => new Date() },
      ids: { create: () => crypto.randomUUID() },
      publisher: new PostgresPersonDateReminderPublisher(
        actors,
        new PostgresReminderDeliveryPreferences(),
      ),
      repository: new PostgresImportantDateRepository(),
      transaction: new PostgresPeopleTransaction(peopleConnection.db),
    });
    const lifecycle = createPersonLifecycle({
      actors,
      audit: personLifecycleAuditFrom(new PostgresAuditEventRecorder()),
      clock: { now: () => new Date() },
      genders: new PostgresGenderOptionBoundary(),
      repository: new PostgresPersonLifecycleRepository(),
      transaction: new PostgresPeopleTransaction(peopleConnection.db),
    });
    const relationships = createRelationshipManagement({
      actors,
      audit: relationshipAuditFrom(new PostgresAuditEventRecorder()),
      clock: { now: () => new Date() },
      ids: { create: () => crypto.randomUUID() },
      people: new PostgresRelationshipPersonBoundary(),
      peopleCreation: people,
      repository: new PostgresRelationshipRepository(),
      transaction: new PostgresPeopleTransaction(peopleConnection.db),
      workspace: new PostgresRelationshipWorkspaceBoundary(),
    });

    // While the membership is active every surface answers normally, so the
    // refusals below can only come from the revocation.
    const beforeTypes = await relationships.listTypes(actor);
    assert(
      beforeTypes.status === "ready" && beforeTypes.options[0],
      "an active member sees the workspace relationship vocabulary",
    );
    const relationshipTypeId = beforeTypes.options[0].id;
    const beforeRead = await people.get(actor, actor.personId);
    assert(beforeRead.status === "ready", "an active member reads the person");

    await sql`
      update crm.workspace_members set left_at = now(), status = 'left'
      where id = ${actor.memberId}
    `;

    const created = await people.create(actor, {
      givenName: "Refused",
      isPartial: false,
    });
    const read = await people.get(actor, actor.personId);
    const edited = await lifecycle.edit(actor, actor.personId, {
      expectedUpdatedAt: new Date().toISOString(),
      givenName: "Refused",
      isPartial: false,
    });
    const archived = await lifecycle.archive(actor, actor.personId, {
      expectedUpdatedAt: new Date().toISOString(),
    });
    const dated = await importantDates.create(actor, actor.personId, {
      day: 4,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "birthday",
      month: 7,
      precision: "full",
      year: 1990,
    });
    const fact = await profileFacts.create(
      actor,
      actor.personId,
      "food-preferences",
      {
        expectedPersonUpdatedAt: new Date().toISOString(),
        foodPreferences: "Refused",
      },
    );
    const factList = await profileFacts.list(
      actor,
      actor.personId,
      "food-preferences",
      {},
    );
    const linked = await relationships.create(actor, actor.personId, {
      relationshipTypeId,
      targetPersonId: companion.id,
    });
    const listed = await relationships.list(actor, actor.personId);

    for (
      const [label, result] of [
        ["people.create", created],
        ["people.get", read],
        ["lifecycle.edit", edited],
        ["lifecycle.archive", archived],
        ["importantDates.create", dated],
        ["profileFacts.create", fact],
        ["profileFacts.list", factList],
        ["relationships.create", linked],
        ["relationships.list", listed],
      ] as const
    ) {
      assert(
        result.status === "forbidden",
        `${label} answered ${result.status} for a revoked member`,
      );
    }

    const [proof] = await sql<{
      readonly audits: number;
      readonly dates: number;
      readonly edges: number;
      readonly people: number;
    }[]>`
      select
        (select count(*)::int from crm.audit_events
          where workspace_id = ${actor.workspaceId}) audits,
        (select count(*)::int from crm.person_dates date
          join crm.people person on person.id = date.person_id
          where person.workspace_id = ${actor.workspaceId}) dates,
        (select count(*)::int from crm.relationships
          where workspace_id = ${actor.workspaceId}) edges,
        (select count(*)::int from crm.people
          where workspace_id = ${actor.workspaceId}) people
    `;
    assert(proof, "revocation proof is present");
    assert(
      proof.people === 2 && proof.dates === 0 && proof.edges === 0 &&
        proof.audits === 0,
      `a revoked member changed rows: ${JSON.stringify(proof)}`,
    );
    const [unchanged] = await sql<{ readonly given_name: string }[]>`
      select given_name from crm.people where id = ${actor.personId}
    `;
    assert(
      unchanged?.given_name === actor.personName,
      "a revoked member renamed the person",
    );
  },
});

Deno.test({
  name:
    "[GAP-047] PostgreSQL identity edits save the description, gender, and deceased state within the workspace",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const owner = await register(
      `identity-owner-${crypto.randomUUID()}@example.test`,
      "Identity circle",
    );
    const foreign = await register(
      `identity-foreign-${crypto.randomUUID()}@example.test`,
      "Foreign identity circle",
    );
    const created = await createPerson(owner, {
      givenName: "Ada",
      isPartial: false,
    });
    const personId = (await created.json() as {
      readonly person: { readonly id: string };
    }).person.id;
    const option = async (workspaceId: string, name: string, order: number) =>
      (await sql<{ readonly id: string }[]>`
        insert into crm.gender_options (workspace_id, name, sort_order)
        values (${workspaceId}, ${name}, ${order}) returning id::text
      `)[0]!.id;
    const woman = await option(owner.workspaceId, "Woman", 1);
    const other = await option(owner.workspaceId, "Another option", 2);
    const retired = await option(owner.workspaceId, "Retired option", 3);
    await sql`update crm.gender_options set is_archived = true
      where id = ${retired}`;
    const foreignOption = await option(foreign.workspaceId, "Elsewhere", 1);
    const revision = async () =>
      (await (await getPerson(owner, personId)).json() as {
        readonly person: { readonly updatedAt: string };
      }).person.updatedAt;
    const edit = async (
      fixture: typeof owner,
      body: Readonly<Record<string, unknown>>,
      expectedUpdatedAt?: string,
    ) =>
      await configured.app.request(
        `http://localhost/api/v1/people/${personId}`,
        {
          body: JSON.stringify({
            expectedUpdatedAt: expectedUpdatedAt ?? await revision(),
            givenName: "Ada",
            isPartial: false,
            ...body,
          }),
          headers: {
            "content-type": "application/json",
            cookie: fixture.cookie,
            origin: "http://localhost",
            "X-Workspace-Id": fixture.workspaceId,
          },
          method: "PATCH",
        },
      );
    const stored = async () =>
      (await sql<{
        readonly description: string | null;
        readonly gender_option_id: string | null;
        readonly is_deceased: boolean;
      }[]>`select description, gender_option_id::text, is_deceased
        from crm.people where id = ${personId}`)[0]!;

    const before = await revision();
    const saved = await edit(owner, {
      description: "  Wrote the first program  ",
      genderOptionId: woman,
      isDeceased: true,
    }, before);
    const savedBody = await saved.json() as {
      readonly person: {
        readonly description?: string;
        readonly genderOptionId?: string;
        readonly isDeceased: boolean;
      };
    };
    assert(
      saved.status === 200 &&
        savedBody.person.description === "Wrote the first program" &&
        savedBody.person.genderOptionId === woman &&
        savedBody.person.isDeceased,
      "the wider identity is saved and answered",
    );
    const row = await stored();
    assert(
      row.description === "Wrote the first program" &&
        row.gender_option_id === woman && row.is_deceased,
      "the person row holds the description, option, and deceased state",
    );
    const [audit] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'people.person-updated' and subject_id = ${personId}`;
    assert(audit?.count === 1, "the edit is audited under its existing name");
    assert(
      (await edit(owner, { description: "Late" }, before)).status === 409,
      "an edit composed against the old revision is refused",
    );

    const profile = await (await getPerson(owner, personId)).json() as {
      readonly genderOptions: readonly {
        readonly archived: boolean;
        readonly id: string;
      }[];
      readonly person: {
        readonly gender?: string;
        readonly genderOptionId?: string;
        readonly isDeceased: boolean;
      };
    };
    assert(
      profile.person.gender === "Woman" &&
        profile.person.genderOptionId === woman && profile.person.isDeceased,
      "the profile reads the saved identity back",
    );
    assert(
      profile.genderOptions.map((choice) => choice.id).join() ===
        `${woman},${other}`,
      "the editor is offered the current options, in order, and no archived one",
    );

    for (const genderOptionId of [foreignOption, retired]) {
      const refused = await edit(owner, { genderOptionId });
      const problem = await refused.json() as {
        readonly errors?: Readonly<Record<string, string>>;
      };
      assert(
        refused.status === 400 && problem.errors?.genderOptionId !== undefined,
        "a foreign or archived option is refused with a field error",
      );
    }
    assert((await stored()).gender_option_id === woman, "nothing changed");

    await sql`update crm.gender_options set is_archived = true
      where id = ${woman}`;
    assert(
      (await edit(owner, { genderOptionId: woman, givenName: "Augusta" }))
        .status === 200,
      "an option archived after it was chosen can be kept",
    );
    const keptProfile = await (await getPerson(owner, personId)).json() as {
      readonly genderOptions: readonly {
        readonly archived: boolean;
        readonly id: string;
      }[];
    };
    assert(
      keptProfile.genderOptions.some((choice) =>
        choice.id === woman && choice.archived
      ),
      "the person's own archived option stays offered so it can be kept",
    );

    // More current options than the editor lists: the person's own, sorted
    // past the cap, is still offered, once, so no edit clears it silently.
    await sql`update crm.gender_options set is_archived = false
      where id = ${woman}`;
    await sql`update crm.gender_options set sort_order = 1000
      where id = ${woman}`;
    await sql`insert into crm.gender_options (workspace_id, name, sort_order)
      select ${owner.workspaceId}, 'Filler ' || n, n
      from generate_series(1, 101) n`;
    const capped = await (await getPerson(owner, personId)).json() as {
      readonly genderOptions: readonly { readonly id: string }[];
    };
    assert(
      capped.genderOptions.filter((choice) => choice.id === woman).length ===
        1,
      "the person's own current option past the cap is offered exactly once",
    );

    assert((await edit(owner, {})).status === 200, "a names-only edit saves");
    const kept = await stored();
    assert(
      kept.description === "Wrote the first program" &&
        kept.gender_option_id === woman && kept.is_deceased,
      "fields an edit leaves out are kept",
    );
    const deceasedDate = await importantDateRequest(owner, personId, "POST", {
      day: 27,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "deceased",
      month: 11,
      precision: "month_day",
    });
    assert(
      deceasedDate.status === 201,
      "a date of death with an unknown year is recorded through the dates route",
    );
    assert(
      (await edit(owner, {
        description: "",
        genderOptionId: "",
        isDeceased: false,
      })).status === 200,
      "empty text and false clear the wider identity",
    );
    const cleared = await stored();
    const [dates] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.person_dates
      where person_id = ${personId} and kind = 'deceased'`;
    assert(
      cleared.description === null && cleared.gender_option_id === null &&
        !cleared.is_deceased && dates?.count === 1,
      "clearing deceased leaves the recorded date of death in place",
    );

    const concealed = await edit(foreign, { description: "Foreign" });
    assert(
      concealed.status === 404 && (await stored()).description === null,
      "another workspace cannot edit this person",
    );
  },
});

Deno.test({
  name: "PEOPLE-001 PostgreSQL lifecycle resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await closeResources();
  },
});
