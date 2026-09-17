import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { createJournalManagement } from "../../packages/backend/modules/journal/public.ts";
import { journalAuditFrom } from "../../packages/backend/modules/journal/public.ts";
import postgres from "postgres";
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
  cookie: string;
  memberId: string;
  workspaceId: string;
}
async function register(email: string): Promise<Fixture> {
  const registered = await configured.app.request(
    "http://localhost/api/v1/registrations",
    {
      body: JSON.stringify({
        email,
        firstName: "Journal",
        lastName: "Tester",
        password,
        workspaceName: email,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  assert(registered.status === 202, "journal fixture registers");
  const token = mail.latestToken(email);
  assert(token, "journal token captured");
  assert(
    (await configured.app.request(
      "http://localhost/api/v1/email-verifications",
      {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    )).status === 200,
    "journal fixture verifies",
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
    member: { id: string };
    workspace: { id: string };
  };
  const cookie = signed.headers.get("set-cookie")?.split(";")[0];
  assert(signed.status === 200 && cookie, "journal fixture signs in");
  return { cookie, memberId: body.member.id, workspaceId: body.workspace.id };
}
function request(
  fixture: Fixture,
  path: string,
  method: "DELETE" | "GET" | "POST" | "PUT",
  body?: unknown,
) {
  return configured.app.request(`http://localhost${path}`, {
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: {
      "content-type": "application/json",
      cookie: fixture.cookie,
      origin: "http://localhost",
      "X-Workspace-Id": fixture.workspaceId,
    },
    method,
  });
}

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

/**
 * A workspace whose only member can be revoked mid-test. The actor is built
 * directly so the use case is exercised without the session layer refusing
 * first.
 */
async function revocableActor(name: string): Promise<{
  readonly memberId: string;
  readonly personId: string;
  readonly role: "owner";
  readonly userId: string;
  readonly workspaceId: string;
}> {
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const personId = crypto.randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`
      insert into crm.users (id, email, first_name, status)
      values (${userId}, ${`${name}@example.test`}, 'Revocable', 'active')
    `;
    await transaction`
      insert into crm.workspaces (id, name, status, created_by_user_id)
      values (${workspaceId}, ${name}, 'active', ${userId})
    `;
    await transaction`
      insert into crm.workspace_members (
        id, workspace_id, user_id, role, status, joined_at
      ) values (${memberId}, ${workspaceId}, ${userId}, 'owner', 'active', now())
    `;
    await transaction`
      insert into crm.people (id, workspace_id, created_by_member_id, given_name)
      values (${personId}, ${workspaceId}, ${memberId}, 'Revocation subject')
    `;
  });
  return { memberId, personId, role: "owner", userId, workspaceId };
}

async function revokeMembership(memberId: string): Promise<void> {
  await sql`
    update crm.workspace_members set status = 'left', left_at = now()
    where id = ${memberId}
  `;
}

Deno.test({
  name: "[JOURNAL-001] GAP-009 a revoked member cannot write journal entries",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
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

      await revokeMembership(actor.memberId);

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
Deno.test({
  name: "JOURNAL-001 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.all([configured.close(), sql.end()]);
  },
});
