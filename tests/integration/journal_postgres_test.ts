import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { createJournalManagement } from "../../packages/backend/modules/journal/public.ts";
import { journalAuditFrom } from "../../packages/backend/modules/journal/public.ts";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  PostgresJournalRepository,
} from "../../packages/backend/modules/journal/adapters/postgres/journal_repository.ts";
import {
  PostgresJournalActivityBoundary,
} from "../../packages/backend/modules/interactions/adapters/postgres/journal_activity_boundary.ts";
import {
  PostgresAuditEventRecorder,
} from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import {
  PostgresPeopleTransaction,
} from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import {
  PostgresActorRevalidation,
} from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  assertCrossWorkspaceRefused,
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
type Fixture = SignedInFixture;
const api = apiSupport(configured.app, mail, sql);
const register = (email: string) =>
  api.register(email, email, { firstName: "Journal", lastName: "Tester" });
function request(
  fixture: Fixture,
  path: string,
  method: "DELETE" | "GET" | "POST" | "PUT",
  body?: unknown,
) {
  return api.request(fixture, path, method, body);
}

Deno.test("[JOURNAL-001] activity participants are named on timeline and detail without exposing other workspaces or deleted people", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(`journal-people-${suffix}@example.test`);
  const foreign = await register(
    `journal-people-foreign-${suffix}@example.test`,
  );
  const activityId = crypto.randomUUID();
  const emptyId = crypto.randomUUID();
  const ada = crypto.randomUUID();
  const archived = crypto.randomUUID();
  const nickname = crypto.randomUUID();
  const unnamed = crypto.randomUUID();
  const deleted = crypto.randomUUID();
  const foreignPerson = crypto.randomUUID();
  await sql`insert into crm.people (id, workspace_id, given_name, family_name, nickname, archived_at, deleted_at) values
    (${ada}, ${primary.workspaceId}, 'Ada', 'Lovelace', null, null, null),
    (${archived}, ${primary.workspaceId}, 'Grace', 'Hopper', null, now(), null),
    (${nickname}, ${primary.workspaceId}, '', null, 'Lin', null, null),
    (${unnamed}, ${primary.workspaceId}, '', null, null, null, null),
    (${deleted}, ${primary.workspaceId}, 'Deleted person', null, null, null, now()),
    (${foreignPerson}, ${foreign.workspaceId}, 'Foreign person', null, null, null, null)`;
  await sql`insert into crm.activities (id, workspace_id, summary, happened_at) values
    (${activityId}, ${primary.workspaceId}, 'Lunch together', '2026-08-22T12:00:00Z'),
    (${emptyId}, ${primary.workspaceId}, 'Solo walk', '2026-08-21T12:00:00Z')`;
  for (const personId of [ada, archived, nickname, unnamed, deleted]) {
    await sql`insert into crm.activity_participants (activity_id, person_id, workspace_id) values (${activityId}, ${personId}, ${primary.workspaceId}::uuid)`;
  }
  // Since schema v14 a link to a person from a different workspace is refused
  // by the database itself (ADR 0008), so no projection can meet one.
  await assertCrossWorkspaceRefused(
    () =>
      sql`insert into crm.activity_participants (activity_id, person_id, workspace_id) values (${activityId}, ${foreignPerson}, ${primary.workspaceId}::uuid)`,
    "a participant from another workspace",
  );
  const linked = await request(primary, "/api/v1/journal/activities", "POST", {
    activityId,
  });
  const linkedBody = await linked.json() as { id: string };
  assert(linked.status === 201, "activity linked");
  const empty = await request(primary, "/api/v1/journal/activities", "POST", {
    activityId: emptyId,
  });
  const emptyBody = await empty.json() as { id: string };
  assert(empty.status === 201, "participant-free activity linked");
  const expected = [
    { id: ada, name: "Ada Lovelace" },
    { id: archived, name: "Grace Hopper" },
    { id: nickname, name: "Lin" },
    { id: unnamed, name: "Unnamed person" },
  ];
  interface Item {
    id: string;
    activity: { participants: typeof expected };
  }
  const timeline = await request(primary, "/api/v1/journal", "GET");
  const page = await timeline.json() as { items: Item[] };
  assert(
    timeline.status === 200 && JSON.stringify(
          page.items.find((item) => item.id === linkedBody.id)?.activity
            .participants,
        ) === JSON.stringify(expected),
    "timeline must expose sorted live same-workspace participants, including archived and fallback names",
  );
  for (
    const [id, participants] of [[linkedBody.id, expected], [
      emptyBody.id,
      [],
    ]] as const
  ) {
    const detail = await request(primary, `/api/v1/journal/items/${id}`, "GET");
    const body = await detail.json() as { item: Item };
    assert(
      detail.status === 200 &&
        JSON.stringify(body.item.activity.participants) ===
          JSON.stringify(participants),
      "detail must expose the same participants or an empty list",
    );
  }
  assert(
    (await request(foreign, `/api/v1/journal/items/${linkedBody.id}`, "GET"))
      .status === 404,
    "foreign workspace cannot read participants through journal detail",
  );
});

Deno.test("[JOURNAL-001] PostgreSQL journal ordering, update, audit, and tenant isolation", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(`journal-${suffix}@example.test`);
  const foreign = await register(`journal-foreign-${suffix}@example.test`);
  const activityId = crypto.randomUUID();
  const foreignActivityId = crypto.randomUUID();
  await sql`insert into crm.activities (id, workspace_id, summary, happened_at, created_by_member_id) values
    (${activityId}::uuid, ${primary.workspaceId}::uuid, 'Shared a walk', '2026-08-22T12:00:00Z', ${primary.memberId}::uuid),
    (${foreignActivityId}::uuid, ${foreign.workspaceId}::uuid, 'Foreign event', '2026-08-22T12:00:00Z', ${foreign.memberId}::uuid)`;

  const post = await request(primary, "/api/v1/journal/posts", "POST", {
    body: "First version",
    occurredAt: "2026-08-23T18:30:00.000Z",
    title: "Today",
  });
  const postBody = await post.json() as { post: { id: string } };
  assert(post.status === 201, "journal post created");
  assert(
    (await request(
      primary,
      `/api/v1/journal/posts/${postBody.post.id}`,
      "PUT",
      {
        body: "Edited version",
        occurredAt: "2026-08-24T18:30:00.000Z",
        title: "Tomorrow",
      },
    )).status === 200,
    "journal post edited",
  );
  const firstRating = await request(
    primary,
    "/api/v1/journal/day-ratings",
    "PUT",
    { comment: "Good", ratedOn: "2026-08-23", rating: 4 },
  );
  const firstRatingBody = await firstRating.json() as {
    rating: { id: string };
  };
  const secondRating = await request(
    primary,
    "/api/v1/journal/day-ratings",
    "PUT",
    { ratedOn: "2026-08-23", rating: 5 },
  );
  const secondRatingBody = await secondRating.json() as {
    rating: { id: string };
  };
  assert(
    firstRating.status === 201 && secondRating.status === 200 &&
      firstRatingBody.rating.id === secondRatingBody.rating.id,
    "same day rating updates one record",
  );
  const linked = await request(primary, "/api/v1/journal/activities", "POST", {
    activityId,
  });
  const linkedBody = await linked.json() as { id: string };
  assert(linked.status === 201, "same-workspace activity linked");
  assert(
    (await request(primary, "/api/v1/journal/activities", "POST", {
      activityId: foreignActivityId,
    })).status === 404,
    "cross-workspace activity concealed",
  );
  const timeline = await request(primary, "/api/v1/journal", "GET");
  const timelineBody = await timeline.json() as {
    items: readonly { id: string; post?: { body: string } }[];
  };
  assert(
    timeline.status === 200 &&
      timelineBody.items[0]?.post?.body === "Edited version",
    "timeline is ordered by authoritative occurrence",
  );
  assert(
    (await request(foreign, `/api/v1/journal/items/${postBody.post.id}`, "GET"))
      .status === 404,
    "cross-workspace journal item concealed",
  );
  const deleted = await request(
    primary,
    `/api/v1/journal/items/${linkedBody.id}`,
    "DELETE",
  );
  const deletedBody = await deleted.json() as {
    itemType?: string;
    status?: string;
  };
  assert(
    deleted.status === 200 && deletedBody.itemType === "activity" &&
      deletedBody.status === "deleted",
    `activity journal link removed with stored type: ${
      JSON.stringify(deletedBody)
    }`,
  );
  const [activity] = await sql<
    { count: string }[]
  >`select count(*)::text as count from crm.activities where id = ${activityId}::uuid`;
  assert(
    activity?.count === "1",
    "removing journal link does not delete interaction-owned activity",
  );
  const [ratings] = await sql<
    { count: string }[]
  >`select count(*)::text as count from crm.journal_day_ratings where workspace_id = ${primary.workspaceId}::uuid and rated_on = '2026-08-23'`;
  assert(ratings?.count === "1", "same-day uniqueness persisted");
  const [audits] = await sql<
    { count: string }[]
  >`select count(*)::text as count from crm.audit_events where workspace_id = ${primary.workspaceId}::uuid and subject_type = 'journal_item'`;
  assert(Number(audits?.count) >= 5, "journal CRUD audited");
  const deletionAudits = await sql<
    { action: string; item_type: string; subject_id: string }[]
  >`select action, payload->>'itemType' as item_type, subject_id::text from crm.audit_events where workspace_id = ${primary.workspaceId}::uuid and subject_type = 'journal_item' and action like 'journal.item-delete%'`;
  const deletionAudit = deletionAudits.find((event) =>
    event.subject_id === linkedBody.id
  );
  assert(
    deletionAudit?.item_type === "activity",
    `deletion audit derives the stored journal item type: ${
      JSON.stringify(deletionAudits)
    }`,
  );
});

// --- GAP-009 -------------------------------------------------------------

Deno.test({
  name: "[JOURNAL-001] GAP-009 a revoked member cannot write journal entries",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        sql,
        `journal-revocation-${crypto.randomUUID()}`,
      );
      const journal = createJournalManagement({
        activities: new PostgresJournalActivityBoundary(),
        actors: new PostgresActorRevalidation(),
        audit: journalAuditFrom(new PostgresAuditEventRecorder()),
        clock: { now: () => new Date() },
        ids: { next: () => crypto.randomUUID() },
        repository: new PostgresJournalRepository(),
        transaction: new PostgresPeopleTransaction(connection.db),
      });

      const allowed = await journal.createPost(actor, {
        body: "Allowed entry",
        occurredAt: new Date().toISOString(),
      });
      assert(allowed.status === "created", "an active member writes a post");

      await revokeMembership(sql, actor.memberId);

      const refusedPost = await journal.createPost(actor, {
        body: "Refused entry",
        occurredAt: new Date().toISOString(),
      });
      const refusedRating = await journal.saveDayRating(actor, {
        ratedOn: new Date().toISOString().slice(0, 10),
        rating: 4,
      });
      assert(
        refusedPost.status === "forbidden" &&
          refusedRating.status === "forbidden",
        "a revoked member still wrote a journal entry",
      );
      const [remaining] = await sql<[{ readonly count: number }]>`
        select count(*)::int as count from crm.journal_posts
        where workspace_id = ${actor.workspaceId}
      `;
      assert(remaining?.count === 1, "a revoked member wrote a journal row");
    } finally {
      await connection.destroy();
    }
  },
});
Deno.test("[GAP-023] PostgreSQL pages the journal behind a workspace-bound cursor", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(`journal-page-${suffix}@example.test`);
  const foreign = await register(`journal-page-foreign-${suffix}@example.test`);
  for (const body of ["One", "Two", "Three"]) {
    assert(
      (await request(primary, "/api/v1/journal/posts", "POST", {
        body,
        occurredAt: "2026-08-23T18:30:00.000Z",
      })).status === 201,
      `${body} journal post created`,
    );
  }
  // Every item shares one moment and one creation instant, so only the
  // identifier can order a page boundary.
  await sql`
    update crm.journal_items set created_at = '2026-08-23T18:30:00Z'
    where workspace_id = ${primary.workspaceId}::uuid
  `;
  const ids = (await sql<{ readonly id: string }[]>`
    select id::text from crm.journal_items
    where workspace_id = ${primary.workspaceId}::uuid
    order by id desc
  `).map((row) => row.id);
  interface Page {
    readonly items: readonly { readonly id: string }[];
    readonly nextCursor?: string;
  }
  const first = await request(primary, "/api/v1/journal?limit=2", "GET");
  const firstBody = await first.json() as Page;
  assert(
    first.status === 200 && firstBody.items.length === 2 &&
      firstBody.nextCursor,
    "a first journal page of two did not continue",
  );
  const cursor = encodeURIComponent(firstBody.nextCursor!);
  const second = await request(
    primary,
    `/api/v1/journal?limit=2&cursor=${cursor}`,
    "GET",
  );
  const secondBody = await second.json() as Page;
  assert(
    second.status === 200 && secondBody.items.length === 1 &&
      !secondBody.nextCursor &&
      JSON.stringify(
          [...firstBody.items, ...secondBody.items].map((item) => item.id),
        ) === JSON.stringify(ids),
    "the journal continuation dropped, repeated, or reordered an item",
  );
  for (
    const [fixture, query] of [
      [foreign, `cursor=${cursor}`],
      [primary, "cursor=not-a-cursor"],
      [primary, "limit=51"],
    ] as const
  ) {
    const refused = await request(fixture, `/api/v1/journal?${query}`, "GET");
    const problem = await refused.json() as { readonly code?: string };
    assert(
      refused.status === 400 && problem.code === "journal_query_invalid",
      `${query} against another journal was answered: ${refused.status}`,
    );
  }
});

Deno.test({
  name: "JOURNAL-001 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.all([configured.close(), sql.end()]);
  },
});
