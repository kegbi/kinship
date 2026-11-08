/**
 * The person workspace and timeline read models (split from
 * `people_postgres_test.ts`, GAP-035), and a revoked member's reads.
 *
 * Its final test closes the app and pools it loaded from
 * `people.test-helper.ts`.
 */

import postgres from "postgres";
import { Kysely, sql as kyselySql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import { type ApplicationDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { createPeopleTagOptions } from "../../packages/backend/read-models/people-directory/public.ts";
import { createPersonProfile } from "../../packages/backend/read-models/person-profile/public.ts";
import { PostgresPeopleTransaction } from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import { PostgresPeopleDirectoryRepository } from "../../packages/backend/read-models/people-directory/adapters/postgres/people_directory_repository.ts";
import { PostgresPersonProfileRepository } from "../../packages/backend/read-models/person-profile/adapters/postgres/person_profile_repository.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import {
  CapturedVerificationMail,
  composeApiServices,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { fakeObjectStore } from "../../packages/backend/testing/fakes.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { apiSupport } from "../support/api.ts";
import {
  actors,
  createStaleActorFixture,
  databaseUrl,
  directory,
  getPerson,
  getPersonSummary,
  listPersonLifeEvents,
  listPersonTimeline,
  peopleConnection,
  personProfile,
  register,
  sql,
} from "./people.test-helper.ts";
import { closeResources } from "./people.test-helper.ts";
import {
  assertCrossWorkspaceRefused,
  revokeMembership,
  truncate,
} from "../support/database.ts";

Deno.test({
  name:
    "[APP-003C] real PostgreSQL person workspace is tenant-safe and lifecycle-aware",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await truncate(sql, ["crm.users", "crm.workspaces"]);
    const owner = await register(
      `profile-owner-${crypto.randomUUID()}@example.test`,
      "Profile circle",
    );
    const foreign = await register(
      `profile-foreign-${crypto.randomUUID()}@example.test`,
      "Foreign profile circle",
    );
    const personId = crypto.randomUUID();
    const foreignPersonId = crypto.randomUUID();
    const genderId = crypto.randomUUID();
    const foreignTagId = crypto.randomUUID();
    const lifeEventId = crypto.randomUUID();
    const reminderId = crypto.randomUUID();
    const activityId = crypto.randomUUID();
    const callId = crypto.randomUUID();
    const contactTypeIds = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ] as const;
    const relationshipTypeId = crypto.randomUUID();
    const relatedPersonIds = [
      crypto.randomUUID(),
      crypto.randomUUID(),
    ] as const;
    await sql.begin(async (transaction) => {
      await transaction`
        insert into crm.gender_options (id, workspace_id, name)
        values (${genderId}, ${owner.workspaceId}, 'Woman')
      `;
      await transaction`
        insert into crm.people (
          id, workspace_id, created_by_member_id, gender_option_id,
          given_name, family_name, description, food_preferences, is_starred,
          is_deceased
        ) values (
          ${personId}, ${owner.workspaceId}, ${owner.memberId}, ${genderId},
          'Ada', 'Lovelace', 'Mathematician and correspondent.', 'Tea', true,
          true
        )
      `;
      await transaction`
        insert into crm.people (
          id, workspace_id, created_by_member_id, given_name
        ) values
          (${relatedPersonIds[0]}, ${owner.workspaceId}, ${owner.memberId},
            'Charles'),
          (${relatedPersonIds[1]}, ${owner.workspaceId}, ${owner.memberId},
            'Mary')
      `;
      await transaction`
        update crm.workspace_members set self_person_id = ${personId}
        where id = ${owner.memberId}
      `;
      await transaction`
        insert into crm.tags (id, workspace_id, name, slug)
        select gen_random_uuid(), ${owner.workspaceId},
          'Profile ' || lpad(sequence::text, 2, '0'),
          'profile-' || lpad(sequence::text, 2, '0')
        from generate_series(1, 10) sequence
      `;
      await transaction`
        insert into crm.person_tags (person_id, tag_id, workspace_id)
        select ${personId}, tag.id,
        (select scope.workspace_id from crm.people scope where scope.id = ${personId}) from crm.tags tag
        where tag.workspace_id = ${owner.workspaceId}
      `;
      await transaction`
        insert into crm.people (
          id, workspace_id, created_by_member_id, given_name
        ) values (
          ${foreignPersonId}, ${foreign.workspaceId}, ${foreign.memberId},
          'Foreign'
        )
      `;
      await transaction`
        insert into crm.tags (id, workspace_id, name, slug)
        values (${foreignTagId}, ${foreign.workspaceId}, 'Private', 'private')
      `;
      // Schema v14 refuses this cross-workspace reference outright (ADR 0008).
      await assertCrossWorkspaceRefused(
        () =>
          transaction.savepoint((step) =>
            step`
        insert into crm.person_tags (person_id, tag_id, workspace_id)
        values (${personId}, ${foreignTagId}, (select scope.workspace_id from crm.people scope where scope.id = ${personId}::uuid))
      `
          ),
        "a tag link to another workspace's tag",
      );
      await transaction`
        insert into crm.contact_method_types (
          id, workspace_id, name, kind, protocol, sort_order
        ) values
          (${contactTypeIds[0]}, ${owner.workspaceId}, 'Email', 'email',
            'mailto', 1),
          (${contactTypeIds[1]}, ${owner.workspaceId}, 'Phone', 'phone',
            'tel', 2),
          (${contactTypeIds[2]}, ${owner.workspaceId}, 'Social', 'social',
            null, 3),
          (${contactTypeIds[3]}, ${owner.workspaceId}, 'Custom', 'custom',
            null, 4)
      `;
      await transaction`
        insert into crm.person_contact_methods (
          person_id, type_id, value, is_primary, sort_order
        , workspace_id) values
          (${personId}, ${
        contactTypeIds[0]
      }, 'ada@example.test', true, 1, (select scope.workspace_id from crm.people scope where scope.id = ${personId}::uuid)),
          (${personId}, ${
        contactTypeIds[1]
      }, '+381111111', true, 2, (select scope.workspace_id from crm.people scope where scope.id = ${personId}::uuid)),
          (${personId}, ${
        contactTypeIds[2]
      }, '@ada', true, 3, (select scope.workspace_id from crm.people scope where scope.id = ${personId}::uuid)),
          (${personId}, ${
        contactTypeIds[3]
      }, 'fourth', true, 4, (select scope.workspace_id from crm.people scope where scope.id = ${personId}::uuid))
      `;
      await transaction`
        insert into crm.relationship_types (
          id, workspace_id, forward_label, reverse_label, sort_order
        ) values (
          ${relationshipTypeId}, ${owner.workspaceId}, 'friend', 'friend', 1
        )
      `;
      await transaction`
        insert into crm.relationships (
          workspace_id, from_person_id, to_person_id, relationship_type_id
        ) values
          (${owner.workspaceId}, ${personId}, ${relatedPersonIds[0]},
            ${relationshipTypeId}),
          (${owner.workspaceId}, ${personId}, ${relatedPersonIds[1]},
            ${relationshipTypeId})
      `;
      await transaction`
        insert into crm.notes (
          workspace_id, person_id, body, created_by_member_id
        ) values
          (${owner.workspaceId}, ${personId}, 'First summary note',
            ${owner.memberId}),
          (${owner.workspaceId}, ${personId}, 'Second summary note',
            ${owner.memberId})
      `;
      await transaction`
        insert into crm.calls (
          id, workspace_id, person_id, called_at, created_by_member_id
        ) values (
          ${callId}, ${owner.workspaceId}, ${personId},
          '2026-08-18T09:00:00.000Z', ${owner.memberId}
        )
      `;
      await transaction`
        insert into crm.activities (
          id, workspace_id, summary, happened_at, created_by_member_id
        ) values (
          ${activityId}, ${owner.workspaceId}, 'Analytical engine review',
          '2026-08-19T09:00:00.000Z', ${owner.memberId}
        )
      `;
      await transaction`
        insert into crm.activity_participants (activity_id, person_id, workspace_id)
        values (${activityId}, ${personId}, (select scope.workspace_id from crm.activities scope where scope.id = ${activityId}::uuid))
      `;
      await transaction`
        insert into crm.tasks (
          workspace_id, person_id, title, status, created_by_member_id
        ) values (
          ${owner.workspaceId}, ${personId}, 'Review correspondence', 'open',
          ${owner.memberId}
        )
      `;
      await transaction`
        insert into crm.reminders (
          id, workspace_id, person_id, target_kind, title, anchor_on,
          created_by_member_id
        ) values (
          ${reminderId}, ${owner.workspaceId}, ${personId}, 'person',
          'Write to Ada', '2026-08-20', ${owner.memberId}
        )
      `;
      await transaction`
        insert into crm.reminder_occurrences (
          reminder_id, member_id, occurs_on, deliver_at, title_snapshot
        , workspace_id) values (
          ${reminderId}, ${owner.memberId}, '2026-08-20',
          '2026-08-20T09:00:00.000Z', 'Write to Ada'
        , (select scope.workspace_id from crm.reminders scope where scope.id = ${reminderId}::uuid))
      `;
      await transaction`
        insert into crm.stay_in_touch_cadences (
          person_id, interval_count, interval_unit, next_due_at
        , workspace_id) values (${personId}, 1, 'month', '2026-08-21T09:00:00.000Z', (select scope.workspace_id from crm.people scope where scope.id = ${personId}::uuid))
      `;
      await transaction`
        insert into crm.life_events (
          id, workspace_id, person_id, name, note, year, month, precision
        ) values (
          ${lifeEventId}, ${owner.workspaceId}, ${personId}, 'Published Notes',
          'The first published computer algorithm.', 1843, 12, 'year_month'
        ), (
          gen_random_uuid(), ${foreign.workspaceId}, ${foreignPersonId},
          'Private event', null, 1900, null, 'year'
        )
      `;
    });

    const ready = await getPerson(owner, personId);
    const readyBody = await ready.json() as {
      readonly dueInformation: {
        readonly nextReminderAt?: string;
        readonly openTaskCount: number;
        readonly stayInTouchAt?: string;
        readonly status: string;
      };
      readonly person: {
        readonly description?: string;
        readonly gender?: string;
        readonly isDeceased: boolean;
        readonly isSelf: boolean;
        readonly isStarred: boolean;
        readonly tagCount: number;
        readonly tags: readonly { readonly name: string }[];
      };
      readonly status: string;
    };
    assert(
      ready.status === 200 && readyBody.status === "ready" &&
        readyBody.person.description ===
          "Mathematician and correspondent." &&
        readyBody.person.gender === "Woman" && readyBody.person.isStarred &&
        readyBody.person.isDeceased && readyBody.person.isSelf,
      "active profile returns current-workspace orientation",
    );
    assert(
      readyBody.person.tags.length === 8 &&
        readyBody.person.tagCount === 10 &&
        readyBody.person.tags.every((tag) => tag.name !== "Private") &&
        readyBody.dueInformation.status === "ready" &&
        readyBody.dueInformation.openTaskCount === 1 &&
        readyBody.dueInformation.nextReminderAt?.startsWith(
            "2026-08-20T09:00:00",
          ) === true &&
        readyBody.dueInformation.stayInTouchAt?.startsWith(
            "2026-08-21T09:00:00",
          ) === true,
      "profile bounds tags and composes real planning orientation",
    );
    const summaryResponse = await getPersonSummary(owner, personId);
    const summaryBody = await summaryResponse.json() as {
      readonly dueInformation: {
        readonly nextReminderAt?: string;
        readonly stayInTouchAt?: string;
      };
      readonly summary: {
        readonly nextReminderAt?: string;
        readonly primaryContactMethods: readonly {
          readonly href?: string;
          readonly kind: string;
        }[];
        readonly relationshipCounts: readonly {
          readonly count: number;
          readonly label: string;
          readonly relationshipTypeId: string;
        }[];
        readonly sectionCounts: readonly {
          readonly count?: number;
          readonly id: string;
          readonly status: string;
        }[];
        readonly stayInTouchAt?: string;
      };
    };
    const sectionCount = (id: string) =>
      summaryBody.summary.sectionCounts.find((entry) => entry.id === id);
    assert(
      summaryResponse.status === 200 &&
        summaryBody.summary.sectionCounts.length === 14 &&
        new Set(summaryBody.summary.sectionCounts.map((entry) => entry.id))
            .size === 14 &&
        sectionCount("activities")?.count === 1 &&
        sectionCount("calls")?.count === 1 &&
        sectionCount("contact-methods")?.count === 4 &&
        sectionCount("food-preferences")?.count === 1 &&
        sectionCount("life-events")?.count === 1 &&
        sectionCount("notes")?.count === 2 &&
        sectionCount("relationships")?.count === 2 &&
        sectionCount("tags")?.count === 10 &&
        sectionCount("tasks")?.count === 1,
      "summary returns every stable section with tenant-local grouped counts",
    );
    assert(
      summaryBody.summary.primaryContactMethods.length === 3 &&
        summaryBody.summary.primaryContactMethods[0]?.href ===
          "mailto:ada@example.test" &&
        summaryBody.summary.primaryContactMethods[1]?.href ===
          "tel:+381111111" &&
        summaryBody.summary.relationshipCounts.length === 1 &&
        summaryBody.summary.relationshipCounts[0]?.relationshipTypeId ===
          relationshipTypeId &&
        summaryBody.summary.relationshipCounts[0]?.label === "friend" &&
        summaryBody.summary.relationshipCounts[0]?.count === 2 &&
        summaryBody.summary.nextReminderAt ===
          summaryBody.dueInformation.nextReminderAt &&
        summaryBody.summary.stayInTouchAt ===
          summaryBody.dueInformation.stayInTouchAt,
      "summary bounds actionable contacts, groups relationships, and reuses due state",
    );

    const [ownerUser] = await sql<{ readonly id: string }[]>`
      select user_id::text as id from crm.workspace_members
      where id = ${owner.memberId}
    `;
    assert(ownerUser, "owner user exists");
    let summaryQueryCount = 0;
    const observedClient = postgres(databaseUrl, {
      debug: () => {
        summaryQueryCount += 1;
      },
      max: 1,
      onnotice: () => undefined,
    });
    const observedDatabase = new Kysely<ApplicationDatabase>({
      dialect: new PostgresJSDialect({ postgres: observedClient }),
    });
    try {
      await kyselySql`select 1`.execute(observedDatabase);
      summaryQueryCount = 0;
      const observedProfile = createPersonProfile({
        actors,
        repository: new PostgresPersonProfileRepository(observedDatabase),
        transaction: new PostgresPeopleTransaction(observedDatabase),
      });
      const observedSummary = await observedProfile.get(
        {
          memberId: owner.memberId,
          role: "owner",
          userId: ownerUser.id,
          workspaceId: owner.workspaceId,
        },
        personId,
        { includeSummary: true },
      );
      assert(
        // The actor revalidation's transaction (begin with the workspace's
        // `set local`, one select, commit) and the summary's own read in the
        // same bracket around one statement (ADR 0008): 6, measured
        // 2026-11-08 (4 before schema v14).
        observedSummary.status === "ready" && summaryQueryCount === 6,
        `the complete summary is resolved by the actor revalidation and one tenant-safe SQL statement (${summaryQueryCount} sent)`,
      );
    } finally {
      await observedDatabase.destroy();
    }
    const history = await listPersonLifeEvents(owner, personId);
    const historyBody = await history.json() as {
      readonly events: readonly {
        readonly date: { readonly month?: number; readonly year?: number };
        readonly id: string;
        readonly name?: string;
      }[];
    };
    assert(
      history.status === 200 && historyBody.events.length === 1 &&
        historyBody.events[0]?.id === lifeEventId &&
        historyBody.events[0]?.name === "Published Notes" &&
        historyBody.events[0]?.date.year === 1843 &&
        historyBody.events[0]?.date.month === 12,
      "person-linked journal history is precise, bounded, and tenant-local",
    );
    await sql`
      insert into crm.workspace_profile_modules (workspace_id, key, is_active)
      values (${owner.workspaceId}, 'life-events', false)
      on conflict (workspace_id, key) do update set is_active = false,
        updated_at = now()
    `;
    const hiddenHistory = await listPersonLifeEvents(owner, personId);
    const hiddenHistoryBody = await hiddenHistory.json() as {
      readonly events: readonly unknown[];
      readonly status: string;
    };
    const [retainedLifeEvents] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.life_events
      where workspace_id = ${owner.workspaceId} and person_id = ${personId}
    `;
    assert(
      hiddenHistory.status === 200 && hiddenHistoryBody.status === "hidden" &&
        hiddenHistoryBody.events.length === 0 &&
        retainedLifeEvents?.count === 1,
      "disabled life-event history is concealed without deleting retained rows",
    );
    const hiddenSummary = await getPersonSummary(owner, personId);
    const hiddenSummaryBody = await hiddenSummary.json() as {
      readonly summary: {
        readonly sectionCounts: readonly {
          readonly count?: number;
          readonly id: string;
          readonly status: string;
        }[];
      };
    };
    const hiddenLifeEvents = hiddenSummaryBody.summary.sectionCounts.find(
      (entry) => entry.id === "life-events",
    );
    assert(
      hiddenSummary.status === 200 &&
        hiddenLifeEvents?.status === "hidden" &&
        !("count" in hiddenLifeEvents),
      "a hidden section omits its retained record count rather than reporting zero",
    );
    await sql`
      update crm.workspace_profile_modules set is_active = true,
        updated_at = now()
      where workspace_id = ${owner.workspaceId} and key = 'life-events'
    `;
    assert(
      (await getPerson(owner, foreignPersonId)).status === 404 &&
        (await getPersonSummary(owner, foreignPersonId)).status === 404 &&
        (await getPerson(owner, crypto.randomUUID())).status === 404 &&
        (await listPersonLifeEvents(owner, foreignPersonId)).status === 404 &&
        (await listPersonLifeEvents(owner, crypto.randomUUID())).status === 404,
      "foreign and missing person identifiers are indistinguishable across profile reads",
    );
    const forged = await personProfile.get(
      {
        memberId: owner.memberId,
        role: "owner",
        userId: ownerUser.id,
        workspaceId: foreign.workspaceId,
      },
      foreignPersonId,
      { includeSummary: true },
    );
    assert(
      forged.status === "forbidden",
      "forged active-workspace context is denied without identity disclosure",
    );
    const forgedHistory = await personProfile.listLifeEvents({
      memberId: owner.memberId,
      role: "owner",
      userId: ownerUser.id,
      workspaceId: foreign.workspaceId,
    }, foreignPersonId);
    assert(
      forgedHistory.status === "forbidden",
      "forged context is denied before life-event history lookup",
    );

    await sql`update crm.people set archived_at = now() where id = ${personId}`;
    const archived = await getPerson(owner, personId);
    assert(
      archived.status === 200 &&
        (await archived.json() as { readonly status: string }).status ===
          "archived",
      "archived person remains readable",
    );
    await sql`update crm.people set deleted_at = now() where id = ${personId}`;
    assert(
      (await getPerson(owner, personId)).status === 404,
      "soft-deleted person is not exposed",
    );
  },
});

Deno.test({
  name:
    "[UXD-002C2A] real PostgreSQL person timeline merges, pages, personalizes, and isolates tenants",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await truncate(sql, ["crm.users", "crm.workspaces"]);
    const owner = await register(
      `timeline-owner-${crypto.randomUUID()}@example.test`,
      "Timeline circle",
    );
    const foreign = await register(
      `timeline-foreign-${crypto.randomUUID()}@example.test`,
      "Foreign timeline circle",
    );
    const personId = "00000000-0000-4000-8000-000000000100";
    const foreignPersonId = "00000000-0000-4000-8000-000000000101";
    const participantId = "00000000-0000-4000-8000-000000000102";
    const activityId = "00000000-0000-4000-8000-000000000900";
    const noteId = "00000000-0000-4000-8000-000000000800";
    const callId = "00000000-0000-4000-8000-000000000700";
    const conversationId = "00000000-0000-4000-8000-000000000600";
    const happenedLifeEventId = "00000000-0000-4000-8000-000000000500";
    const unknownLifeEventId = "00000000-0000-4000-8000-000000000400";
    const partialLifeEventId = "00000000-0000-4000-8000-000000000300";
    const lifeEventTypeId = crypto.randomUUID();
    const activityTypeId = crypto.randomUUID();
    const activityEmotionId = crypto.randomUUID();
    const callEmotionId = crypto.randomUUID();
    const channelTypeId = crypto.randomUUID();
    const contactMethodId = crypto.randomUUID();
    const firstMessageId = crypto.randomUUID();
    const secondMessageId = crypto.randomUUID();
    const activityEmotionName = `Timeline delight ${activityEmotionId}`;
    const callEmotionName = `Timeline gratitude ${callEmotionId}`;

    await sql.begin(async (transaction) => {
      await transaction`
        insert into crm.people (
          id, workspace_id, created_by_member_id, given_name
        ) values
          (${personId}, ${owner.workspaceId}, ${owner.memberId}, 'Ada'),
          (${participantId}, ${owner.workspaceId}, ${owner.memberId}, 'Grace'),
          (${foreignPersonId}, ${foreign.workspaceId}, ${foreign.memberId},
            'Private')
      `;
      await transaction`
        insert into crm.workspace_profile_modules (
          workspace_id, key, is_active
        ) values
          (${owner.workspaceId}, 'activities', true),
          (${owner.workspaceId}, 'notes', true),
          (${owner.workspaceId}, 'calls', true),
          (${owner.workspaceId}, 'conversations', true),
          (${owner.workspaceId}, 'life-events', true)
        on conflict (workspace_id, key) do update set is_active = true,
          updated_at = now()
      `;
      await transaction`
        insert into crm.activity_types (id, workspace_id, name, sort_order)
        values (${activityTypeId}, ${owner.workspaceId}, 'Shared meal', 1)
      `;
      await transaction`
        insert into crm.emotion_options (id, name, sort_order) values
          (${activityEmotionId}, ${activityEmotionName}, 1),
          (${callEmotionId}, ${callEmotionName}, 2)
      `;
      await transaction`
        insert into crm.contact_method_types (id, workspace_id, name)
        values (${channelTypeId}, ${owner.workspaceId}, 'Email')
      `;
      await transaction`
        insert into crm.person_contact_methods (id, person_id, type_id, value, workspace_id)
        values (${contactMethodId}, ${personId}, ${channelTypeId},
          'ada@example.test', (select scope.workspace_id from crm.people scope where scope.id = ${personId}::uuid))
      `;
      await transaction`
        insert into crm.activities (
          id, workspace_id, summary, description, happened_at, activity_type_id,
          created_by_member_id
        ) values (
          ${activityId}, ${owner.workspaceId}, 'Analytical engine review',
          'Compared the latest plans.', '2026-08-25T12:00:00.000Z',
          ${activityTypeId}, ${owner.memberId}
        )
      `;
      await transaction`
        insert into crm.activity_participants (activity_id, person_id, workspace_id)
        values (${activityId}, ${personId}, (select scope.workspace_id from crm.activities scope where scope.id = ${activityId}::uuid)), (${activityId}, ${participantId}, (select scope.workspace_id from crm.activities scope where scope.id = ${activityId}::uuid))
      `;
      await transaction`
        insert into crm.activity_emotions (activity_id, emotion_id, workspace_id)
        values (${activityId}, ${activityEmotionId}, (select scope.workspace_id from crm.activities scope where scope.id = ${activityId}::uuid))
      `;
      await transaction`
        insert into crm.notes (
          id, workspace_id, person_id, body, created_by_member_id, created_at
        ) values (
          ${noteId}, ${owner.workspaceId}, ${personId},
          'A note sharing the call timestamp.', ${owner.memberId},
          '2026-08-24T12:00:00.000Z'
        )
      `;
      await transaction`
        insert into crm.calls (
          id, workspace_id, person_id, called_at, contact_was_caller, content,
          created_by_member_id
        ) values (
          ${callId}, ${owner.workspaceId}, ${personId},
          '2026-08-24T12:00:00.000Z', true, 'Discussed correspondence.',
          ${owner.memberId}
        )
      `;
      await transaction`
        insert into crm.call_emotions (call_id, emotion_id, workspace_id)
        values (${callId}, ${callEmotionId}, (select scope.workspace_id from crm.calls scope where scope.id = ${callId}::uuid))
      `;
      await transaction`
        insert into crm.conversation_threads (
          id, workspace_id, person_id, channel_type_id, contact_method_id,
          happened_at, title
        ) values (
          ${conversationId}, ${owner.workspaceId}, ${personId}, ${channelTypeId},
          ${contactMethodId},
          '2026-08-23T12:00:00.000Z', 'Letters about mathematics'
        )
      `;
      await transaction`
        insert into crm.messages (
          id, conversation_id, content, written_at, direction, author_member_id,
          created_at, updated_at
        , workspace_id) values
          (${secondMessageId}, ${conversationId}, 'Yes, at noon.',
            '2026-08-23T11:01:00.000Z', 'inbound', null,
            '2026-08-23T12:00:00.000Z', '2026-08-23T12:00:00.000Z', (select scope.workspace_id from crm.conversation_threads scope where scope.id = ${conversationId}::uuid)),
          (${firstMessageId}, ${conversationId}, 'Shall we meet?',
            '2026-08-23T11:00:00.000Z', 'outbound', ${owner.memberId},
            '2026-08-23T12:00:00.000Z', '2026-08-23T12:00:00.000Z', (select scope.workspace_id from crm.conversation_threads scope where scope.id = ${conversationId}::uuid))
      `;
      await transaction`
        insert into crm.life_event_types (id, workspace_id, name)
        values (${lifeEventTypeId}, ${owner.workspaceId}, 'Publication')
      `;
      await transaction`
        insert into crm.life_events (
          id, workspace_id, person_id, life_event_type_id, name, note, year,
          month, day, happened_at, precision, created_at
        ) values
          (${happenedLifeEventId}, ${owner.workspaceId}, ${personId},
            ${lifeEventTypeId}, 'Full dated event', 'Known timestamp', null,
            null, null, '2026-08-22T12:00:00.000Z', 'full',
            '2026-01-01T00:00:00.000Z'),
          (${unknownLifeEventId}, ${owner.workspaceId}, ${personId},
            ${lifeEventTypeId}, 'Undated event', 'Recorded without a date',
            null, null, null, null, 'unknown',
            '2026-08-21T12:00:00.000Z'),
          (${partialLifeEventId}, ${owner.workspaceId}, ${personId},
            ${lifeEventTypeId}, null, 'Known only to a month', 1843, 12, null,
            null, 'year_month', '2026-08-20T12:00:00.000Z')
      `;
    });

    const merged = await listPersonTimeline(owner, personId, "limit=50");
    const mergedBody = await merged.json() as {
      readonly items: readonly {
        readonly datePrecision: string;
        readonly activityType?: string;
        readonly channelType?: string;
        readonly contactMethod?: string;
        readonly contactWasCaller?: boolean;
        readonly emotions?: readonly {
          readonly id: string;
          readonly name: string;
        }[];
        readonly id: string;
        readonly kind: string;
        readonly messages?: readonly {
          readonly content: string;
          readonly direction: "inbound" | "outbound";
          readonly writtenAt: string;
        }[];
        readonly occurredAt: string;
        readonly participants?: readonly {
          readonly id: string;
          readonly name: string;
        }[];
        readonly title?: string;
      }[];
      readonly status: string;
    };
    assert(
      merged.status === 200 && mergedBody.status === "ready" &&
        mergedBody.items.map((item) => item.kind).join(",") ===
          "activity,note,call,conversation,life-event,life-event,life-event",
      "all five enabled kinds merge in reverse chronological keyset order",
    );
    const activity = mergedBody.items.find((item) => item.id === activityId);
    const call = mergedBody.items.find((item) => item.id === callId);
    const conversation = mergedBody.items.find((item) =>
      item.id === conversationId
    );
    const note = mergedBody.items.find((item) => item.id === noteId);
    const happened = mergedBody.items.find((item) =>
      item.id === happenedLifeEventId
    );
    const unknown = mergedBody.items.find((item) =>
      item.id === unknownLifeEventId
    );
    const partial = mergedBody.items.find((item) =>
      item.id === partialLifeEventId
    );
    assert(
      activity?.activityType === "Shared meal" &&
        JSON.stringify(activity.participants) === JSON.stringify([
            { id: personId, name: "Ada" },
            { id: participantId, name: "Grace" },
          ]) &&
        activity.emotions?.[0]?.id === activityEmotionId &&
        activity.emotions[0].name === activityEmotionName,
      "activity timeline detail preserves its category, participants, and emotions",
    );
    assert(
      call?.contactWasCaller === true &&
        call.emotions?.[0]?.id === callEmotionId &&
        call.emotions[0].name === callEmotionName,
      "call timeline detail preserves caller direction and emotions",
    );
    assert(
      conversation?.channelType === "Email" &&
        conversation.contactMethod === "ada@example.test" &&
        JSON.stringify(conversation.messages) === JSON.stringify([
            {
              content: "Shall we meet?",
              direction: "outbound",
              writtenAt: "2026-08-23T11:00:00.000000Z",
            },
            {
              content: "Yes, at noon.",
              direction: "inbound",
              writtenAt: "2026-08-23T11:01:00.000000Z",
            },
          ]),
      "conversation timeline detail preserves channel, contact method, and ordered messages",
    );
    const detailFields = [
      "activityType",
      "channelType",
      "contactMethod",
      "contactWasCaller",
      "emotions",
      "messages",
      "participants",
    ];
    assert(
      note !== undefined && happened !== undefined &&
        detailFields.every((field) => !Object.hasOwn(note, field)) &&
        detailFields.every((field) => !Object.hasOwn(happened, field)),
      "notes and life events omit every per-kind detail field",
    );
    assert(
      happened?.occurredAt.startsWith("2026-08-22T12:00:00") === true &&
        happened.datePrecision === "full" &&
        unknown?.occurredAt.startsWith("2026-08-21T12:00:00") === true &&
        unknown.datePrecision === "unknown" &&
        partial?.occurredAt.startsWith("1843-12-01T00:00:00") === true &&
        partial.datePrecision === "year_month" &&
        partial.title === "Publication",
      "life events resolve happened_at, partial UTC components, then recorded date with exact precision",
    );

    const firstPage = await listPersonTimeline(owner, personId, "limit=2");
    const firstPageBody = await firstPage.json() as {
      readonly items: readonly { readonly id: string }[];
      readonly nextCursor?: string;
    };
    assert(
      firstPage.status === 200 && firstPageBody.items[0]?.id === activityId &&
        firstPageBody.items[1]?.id === noteId && firstPageBody.nextCursor,
      "first page ends on the higher id at the duplicate timestamp",
    );
    const secondPage = await listPersonTimeline(
      owner,
      personId,
      `limit=2&cursor=${encodeURIComponent(firstPageBody.nextCursor ?? "")}`,
    );
    const secondPageBody = await secondPage.json() as {
      readonly items: readonly { readonly id: string }[];
    };
    assert(
      secondPage.status === 200 && secondPageBody.items[0]?.id === callId &&
        secondPageBody.items[1]?.id === conversationId,
      "the lower id at a duplicate timestamp begins the next page without a gap",
    );

    const anchorPage = await listPersonTimeline(owner, personId, "limit=4");
    const anchorPageBody = await anchorPage.json() as {
      readonly nextCursor?: string;
    };
    assert(anchorPageBody.nextCursor, "conversation anchor cursor exists");
    await sql`
      update crm.workspace_profile_modules set is_active = false,
        updated_at = now()
      where workspace_id = ${owner.workspaceId} and key = 'conversations'
    `;
    const personalized = await listPersonTimeline(owner, personId, "limit=50");
    const personalizedBody = await personalized.json() as {
      readonly items: readonly { readonly kind: string }[];
    };
    assert(
      personalized.status === 200 &&
        personalizedBody.items.every((item) => item.kind !== "conversation"),
      "a disabled profile module contributes no retained rows",
    );
    const hiddenAnchor = await listPersonTimeline(
      owner,
      personId,
      `cursor=${encodeURIComponent(anchorPageBody.nextCursor ?? "")}`,
    );
    assert(
      hiddenAnchor.status === 409 &&
        (await hiddenAnchor.json() as { readonly code: string }).code ===
          "person_timeline_stale_cursor",
      "a cursor anchored to a newly hidden kind becomes stale",
    );

    assert(
      (await listPersonTimeline(owner, foreignPersonId)).status === 404,
      "a foreign-workspace person is indistinguishable from a missing person",
    );
    const [ownerUser] = await sql<{ readonly id: string }[]>`
      select user_id::text as id from crm.workspace_members
      where id = ${owner.memberId}
    `;
    assert(ownerUser, "timeline owner user exists");
    const forged = await personProfile.listTimeline({
      memberId: owner.memberId,
      role: "owner",
      userId: ownerUser.id,
      workspaceId: foreign.workspaceId,
    }, foreignPersonId);
    assert(
      forged.status === "forbidden",
      "a forged workspace context is refused before timeline projection",
    );
  },
});

Deno.test({
  name: "GAP-009 a revoked member reads no read model",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const actor = await createStaleActorFixture(
      `read-model-revocation-${crypto.randomUUID()}`,
    );
    const tags = createPeopleTagOptions({
      actors,
      repository: new PostgresPeopleDirectoryRepository(peopleConnection.db),
      transaction: new PostgresPeopleTransaction(peopleConnection.db),
    });

    // Every surface answers while the membership is active, so the refusals
    // below can only come from the revocation.
    const beforeList = await directory.list(actor, {});
    const beforeProfile = await personProfile.get(actor, actor.personId);
    const beforeTags = await tags.list(actor, {});
    assert(
      beforeList.status === "ready" && beforeProfile.status === "ready" &&
        beforeTags.status === "ready",
      "an active member reads the people read models",
    );

    await sql`
      update crm.workspace_members set left_at = now(), status = 'left'
      where id = ${actor.memberId}
    `;

    const listed = await directory.list(actor, {});
    const profiled = await personProfile.get(actor, actor.personId);
    const timeline = await personProfile.listTimeline(
      actor,
      actor.personId,
      {},
    );
    const lifeEvents = await personProfile.listLifeEvents(
      actor,
      actor.personId,
    );
    const tagged = await tags.list(actor, {});
    assert(
      listed.status === "forbidden" && profiled.status === "forbidden" &&
        timeline.status === "forbidden" &&
        lifeEvents.status === "forbidden" && tagged.status === "forbidden",
      "a revoked member still read a people read model",
    );
  },
});

/**
 * The rail sections `include=rail` composes, keyed as the answer keys them,
 * with the path each one's own endpoint answers on (AUD-Q3).
 */
const RAIL_FACT_SECTIONS = [
  "contact-methods",
  "addresses",
  "first-meeting",
  "work",
  "food-preferences",
  "pets",
  "tags",
] as const;

/**
 * What `GET /api/v1/people/{id}?include=rail` sends for this filled rail,
 * measured with K3's counting pool under schema v14 on 2026-11-08 (every
 * statement is one round trip, `begin` and `commit` included; a scoped
 * transaction opens with `begin; set local app.workspace_id` as one message,
 * ADR 0008): the session resolution 5 (2 statements and its legal
 * requirements in a scoped bracket of 3), the profile with its summary 3 (one
 * statement in a scoped bracket), and each section's own read through its
 * owning module, each in its own workspace-scoped transaction — the seven
 * facts 45 (6 each, 8 for contact methods with their resolved types, 7 for
 * tags with their names), relationships 9, their types 8, important dates 5,
 * and reminders 8. The eleven requests it replaces sent those 75 module
 * statements plus a session resolution each.
 */
const RAIL_STATEMENT_BUDGET = 83;

Deno.test({
  name:
    "AUD-Q3 one read composes the rail as each section's own endpoint answers it, hidden and foreign included",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    let observed: string[] | undefined;
    const countedMail = new CapturedVerificationMail();
    const counted = createConfiguredApiApp(
      databaseUrl,
      countedMail,
      browserSecurityPolicy("test", "http://localhost"),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (url) =>
        connectDatabase(url, {
          onStatement: (text) => observed?.push(text),
        }),
    );
    const countedApi = apiSupport(counted.app, countedMail, sql);
    await truncate(sql, ["crm.users", "crm.workspaces"]);
    try {
      const owner = await countedApi.register(
        `rail-owner-${crypto.randomUUID()}@example.test`,
        "Rail circle",
      );
      const foreign = await countedApi.register(
        `rail-foreign-${crypto.randomUUID()}@example.test`,
        "Foreign rail circle",
      );
      const personId = crypto.randomUUID();
      const relatedId = crypto.randomUUID();
      const contactTypeId = crypto.randomUUID();
      const relationshipTypeId = crypto.randomUUID();
      await sql.begin(async (transaction) => {
        await transaction`
          insert into crm.people (
            id, workspace_id, created_by_member_id, given_name, family_name,
            food_preferences
          ) values
            (${personId}, ${owner.workspaceId}, ${owner.memberId}, 'Ada',
              'Lovelace', 'Tea'),
            (${relatedId}, ${owner.workspaceId}, ${owner.memberId}, 'Charles',
              null, null)
        `;
        await transaction`
          insert into crm.contact_method_types (
            id, workspace_id, name, kind, protocol, sort_order
          ) values (${contactTypeId}, ${owner.workspaceId}, 'Email', 'email',
            'mailto', 1)
        `;
        await transaction`
          insert into crm.person_contact_methods (
            workspace_id, person_id, type_id, value, is_primary, sort_order
          ) values (${owner.workspaceId}, ${personId}, ${contactTypeId},
            'ada@example.test', true, 1)
        `;
        await transaction`
          insert into crm.pets (person_id, name, workspace_id)
          values (${personId}, 'Puff', (select scope.workspace_id from crm.people scope where scope.id = ${personId}::uuid))
        `;
        await transaction`
          insert into crm.tags (id, workspace_id, name, slug)
          values (gen_random_uuid(), ${owner.workspaceId}, 'Analyst',
            'analyst')
        `;
        await transaction`
          insert into crm.person_tags (workspace_id, person_id, tag_id)
          select ${owner.workspaceId}, ${personId}, tag.id from crm.tags tag
          where tag.workspace_id = ${owner.workspaceId}
        `;
        await transaction`
          insert into crm.relationship_types (
            id, workspace_id, forward_label, reverse_label, sort_order
          ) values (${relationshipTypeId}, ${owner.workspaceId}, 'friend',
            'friend', 1)
        `;
        await transaction`
          insert into crm.relationships (
            workspace_id, from_person_id, to_person_id, relationship_type_id
          ) values (${owner.workspaceId}, ${personId}, ${relatedId},
            ${relationshipTypeId})
        `;
        await transaction`
          insert into crm.reminders (
            workspace_id, person_id, target_kind, title, anchor_on,
            created_by_member_id
          ) values (${owner.workspaceId}, ${personId}, 'person',
            'Write to Ada', '2026-08-20', ${owner.memberId})
        `;
        await transaction`
          insert into crm.stay_in_touch_cadences (
            workspace_id, person_id, interval_count, interval_unit, next_due_at
          ) values (${owner.workspaceId}, ${personId}, 1, 'month',
            '2026-08-21T09:00:00.000Z')
        `;
      });
      const dated = await countedApi.request(
        owner,
        `/api/v1/people/${personId}/dates`,
        "POST",
        {
          day: 10,
          isAgeBased: false,
          isYearApproximate: false,
          kind: "birthday",
          month: 12,
          precision: "full",
          year: 1815,
        },
      );
      assert(dated.status === 201, `the birthday is saved (${dated.status})`);
      await dated.body?.cancel();

      const own = async (path: string): Promise<unknown> => {
        const response = await countedApi.request(owner, path);
        assert(response.status === 200, `${path} answers (${response.status})`);
        return await response.json();
      };
      const sectionAnswers = async () => ({
        ...Object.fromEntries(
          await Promise.all(RAIL_FACT_SECTIONS.map(async (section) => [
            section,
            {
              status: "ready",
              value: await own(`/api/v1/people/${personId}/facts/${section}`),
            },
          ])),
        ),
        "important-dates": {
          status: "ready",
          value: await own(`/api/v1/people/${personId}/dates`),
        },
        relationships: {
          status: "ready",
          value: {
            list: await own(
              `/api/v1/people/${personId}/relationships?limit=20`,
            ),
            types: await own("/api/v1/relationship-types"),
          },
        },
        reminders: {
          status: "ready",
          value: await own(`/api/v1/people/${personId}/reminders`),
        },
      });
      const expected = await sectionAnswers();
      const summary = await own(`/api/v1/people/${personId}?include=summary`);

      const railPath = `/api/v1/people/${personId}?include=rail`;
      // The first read prepares what later reads reuse.
      const warm = await countedApi.request(owner, railPath);
      assert(warm.status === 200, `the rail answers (${warm.status})`);
      await warm.body?.cancel();
      observed = [];
      const composed = await countedApi.request(owner, railPath);
      const statements = observed;
      observed = undefined;
      assert(composed.status === 200, "the counted rail read answers");
      const body = await composed.json() as Record<string, unknown> & {
        readonly rail: Record<string, unknown>;
      };
      const { rail, ...profile } = body;
      assertEquals(profile, summary, "the rail read keeps the summary answer");
      for (const [section, answer] of Object.entries(expected)) {
        assertEquals(
          rail[section],
          answer,
          `the rail's ${section} is what its own endpoint answers`,
        );
      }
      assertEquals(
        Object.keys(rail).sort(),
        Object.keys(expected).sort(),
        "the rail answers exactly its ten sections",
      );
      assert(
        statements.length <= RAIL_STATEMENT_BUDGET,
        `include=rail sent ${statements.length} statements:\n${
          statements.map((text) => text.replace(/\s+/g, " ").slice(0, 90))
            .join("\n")
        }`,
      );

      // A module the workspace turned off is hidden in the rail as its own
      // endpoint hides it; the other sections still answer.
      await sql`
        insert into crm.workspace_profile_modules
          (workspace_id, key, name, is_active)
        values
          (${owner.workspaceId}, 'pets', 'Pets', false),
          (${owner.workspaceId}, 'relationships', 'Relationships', false)
        on conflict (workspace_id, key) do update set is_active = false
      `;
      const hidden = await countedApi.request(owner, railPath);
      assert(hidden.status === 200, "the rail answers with hidden modules");
      const hiddenRail = (await hidden.json() as {
        readonly rail: Record<string, { readonly status: string }>;
      }).rail;
      assertEquals(hiddenRail.pets, { status: "hidden" }, "pets are hidden");
      assertEquals(
        hiddenRail.relationships,
        { status: "hidden" },
        "relationships are hidden",
      );
      assertEquals(
        hiddenRail["contact-methods"],
        expected["contact-methods"],
        "a visible section still answers beside hidden ones",
      );

      // Another workspace learns nothing about this person, rail or not.
      const foreignRead = await countedApi.request(foreign, railPath);
      assert(
        foreignRead.status === 404,
        `a foreign rail read is not found (${foreignRead.status})`,
      );
      assert(
        !("rail" in (await foreignRead.json() as Record<string, unknown>)),
        "a foreign rail read carries no rail",
      );
    } finally {
      await counted.close();
    }
  },
});

/** A local keyset of one repeated byte. */
function railKeyset(fill: number) {
  return {
    activeKeyId: "rail-refusal",
    keys: new Map([["rail-refusal", new Uint8Array(32).fill(fill)]]),
  };
}

Deno.test({
  name:
    "REL-127 a rail section its module refuses answers forbidden, not hidden",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const actor = await createStaleActorFixture(
      `rail-refusal-${crypto.randomUUID()}`,
    );
    const services = composeApiServices(peopleConnection.db, {
      davEnabled: false,
      davKeyset: railKeyset(0x69),
      deviceKeyset: {
        activeVersion: 1,
        keys: new Map([[1, new Uint8Array(32).fill(0x44)]]),
      },
      mail: new CapturedVerificationMail(),
      mfaKeyset: railKeyset(0x4b),
      objectStore: fakeObjectStore(),
      policy: browserSecurityPolicy("test", "http://localhost"),
      subjectKeyset: {
        activeVersion: 1,
        keys: new Map([[1, new Uint8Array(32).fill(0x52)]]),
      },
    });
    const { importantDates, profileFacts, relationships, reminders } = services;
    assert(
      importantDates && profileFacts && relationships && reminders,
      "the rail's owning modules are composed",
    );
    const rail = {
      facts: profileFacts,
      importantDates,
      relationships,
      reminders,
    };
    const profileOf = (
      revalidate: typeof actors.revalidate,
    ) =>
      createPersonProfile({
        actors: { revalidate },
        rail,
        repository: new PostgresPersonProfileRepository(peopleConnection.db),
        transaction: new PostgresPeopleTransaction(peopleConnection.db),
      });

    // While the membership is active every section answers, so the
    // refusals below can only come from the revocation.
    const before = await profileOf((command) => actors.revalidate(command))
      .get(actor, actor.personId, { includeRail: true });
    assert(before.status === "ready" && before.rail, "the rail is answered");
    for (const [section, answer] of Object.entries(before.rail)) {
      assert(answer.status === "ready", `${section} is ready before`);
    }

    // The person read admitted the member, and the revocation lands before
    // each section's module checks the member's standing again.
    await revokeMembership(sql, actor.memberId);
    const refused = await profileOf(() => Promise.resolve("active"))
      .get(actor, actor.personId, { includeRail: true });
    assert(refused.status === "ready" && refused.rail, "the person answers");
    const sections = [
      ...RAIL_FACT_SECTIONS,
      "relationships",
      "important-dates",
      "reminders",
    ] as const;
    assertEquals(
      Object.keys(refused.rail).sort(),
      [...sections].sort(),
      "the rail answers exactly its ten sections",
    );
    const railAnswer = refused.rail;
    assertEquals(
      sections.map((section) => [section, railAnswer[section]]),
      sections.map((section) => [section, { status: "forbidden" }]),
      "every section its module refused is forbidden, none hidden",
    );
  },
});

Deno.test({
  name: "PEOPLE-001 PostgreSQL profile resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await closeResources();
  },
});
