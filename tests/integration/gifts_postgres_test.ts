import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  createGiftManagement,
} from "../../packages/backend/modules/gifts/public.ts";
import { giftAuditFrom } from "../../packages/backend/modules/gifts/public.ts";
import postgres from "postgres";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  PostgresGiftAttachmentTarget,
} from "../../packages/backend/modules/gifts/adapters/postgres/gift_attachment_target.ts";
import {
  PostgresGiftRepository,
} from "../../packages/backend/modules/gifts/adapters/postgres/gift_repository.ts";
import {
  PostgresGiftAttachmentBoundary,
} from "../../packages/backend/modules/files/adapters/postgres/gift_attachment_boundary.ts";
import {
  PostgresAuditEventRecorder,
} from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import {
  PostgresPeopleTransaction,
} from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import {
  PostgresActorRevalidation,
} from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import {
  PostgresWorkspaceCurrencyBoundary,
} from "../../packages/backend/modules/workspaces/adapters/postgres/currency_boundary.ts";
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
  const registered = await configured.app.request(
    "http://localhost/api/v1/registrations",
    {
      body: JSON.stringify({
        email,
        firstName: "Gift",
        lastName: "Tester",
        password,
        workspaceName,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  assert(registered.status === 202, "gift fixture registers");
  const token = mail.latestToken(email);
  assert(token, "gift verification token captured");
  assert(
    (await configured.app.request(
      "http://localhost/api/v1/email-verifications",
      {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    )).status === 200,
    "gift fixture verifies",
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
  assert(signed.status === 200 && cookie, "gift fixture signs in");
  return { cookie, memberId: body.member.id, workspaceId: body.workspace.id };
}

async function createPerson(
  fixture: Fixture,
  givenName: string,
): Promise<string> {
  const response = await configured.app.request(
    "http://localhost/api/v1/people",
    {
      body: JSON.stringify({ givenName, isPartial: false }),
      headers: {
        "content-type": "application/json",
        cookie: fixture.cookie,
        origin: "http://localhost",
        "X-Workspace-Id": fixture.workspaceId,
      },
      method: "POST",
    },
  );
  const body = await response.json() as { person: { id: string } };
  assert(response.status === 201, "gift person created");
  return body.person.id;
}

function request(
  fixture: Fixture,
  path: string,
  method: "GET" | "PATCH" | "POST",
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

Deno.test("[GIFTS-001] PostgreSQL gifts, attachments, debts, audit, and tenant guards", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(
    `gifts-${suffix}@example.test`,
    "Gift primary",
  );
  const foreign = await register(
    `gifts-foreign-${suffix}@example.test`,
    "Gift foreign",
  );
  const ada = await createPerson(primary, "Ada");
  const grace = await createPerson(primary, "Grace");
  const outsider = await createPerson(foreign, "Outsider");
  const fileId = crypto.randomUUID();
  const secondFileId = crypto.randomUUID();
  const foreignFileId = crypto.randomUUID();
  await sql`
    insert into crm.files (
      id, workspace_id, uploaded_by_member_id, original_filename,
      storage_provider, storage_bucket, storage_key, byte_size, mime_type,
      status, visibility
    ) values
      (${fileId}::uuid, ${primary.workspaceId}::uuid, ${primary.memberId}::uuid,
       'gift.jpg', 'test', 'test', ${fileId}, 4, 'image/jpeg', 'available', 'private'),
      (${secondFileId}::uuid, ${primary.workspaceId}::uuid, ${primary.memberId}::uuid,
       'second.jpg', 'test', 'test', ${secondFileId}, 4, 'image/jpeg', 'available', 'private'),
      (${foreignFileId}::uuid, ${foreign.workspaceId}::uuid, ${foreign.memberId}::uuid,
       'foreign.jpg', 'test', 'test', ${foreignFileId}, 4, 'image/jpeg', 'available', 'private')
  `;

  const unknown = await request(
    primary,
    `/api/v1/people/${ada}/gifts`,
    "POST",
    {
      name: "Train tickets",
      status: "idea",
    },
  );
  assert(unknown.status === 201, "unknown amount and no recipient stay valid");

  const attached = await request(
    primary,
    `/api/v1/people/${ada}/gifts`,
    "POST",
    {
      attachmentFileId: fileId,
      amount: "49.5000",
      currencyCode: "eur",
      name: "Photo book",
      recipientPersonId: grace,
      status: "given",
    },
  );
  const attachedBody = await attached.json() as {
    gift: { attachmentFileId?: string; id: string };
  };
  assert(attached.status === 201, "active-workspace recipient and file attach");
  assert(
    attachedBody.gift.attachmentFileId === fileId,
    "attached POST returns its authoritative file representation",
  );
  const [link] = await sql<{ gift_id: string }[]>`
    select gift_id::text from crm.gift_file_links
    where gift_id = ${attachedBody.gift.id}::uuid and file_id = ${fileId}::uuid
  `;
  assert(link, "files-owned gift link is persisted atomically");
  await sql`
    insert into crm.gift_file_links (gift_id, file_id, role, sort_order)
    values (${attachedBody.gift.id}::uuid, ${secondFileId}::uuid, 'document', 0)
  `;
  const attachmentList = await request(
    primary,
    `/api/v1/people/${ada}/gifts`,
    "GET",
  );
  const attachmentListBody = await attachmentList.json() as {
    gifts: readonly { attachmentFileId?: string; id: string }[];
  };
  const hydrated = attachmentListBody.gifts.filter((gift) =>
    gift.id === attachedBody.gift.id
  );
  assert(hydrated.length === 1, "multiple links keep one singular gift DTO");
  assert(
    hydrated[0]?.attachmentFileId === [fileId, secondFileId].sort()[0],
    "singular attachment hydration is deterministic",
  );

  assert(
    (await request(primary, `/api/v1/people/${ada}/gifts`, "POST", {
      attachmentFileId: foreignFileId,
      name: "Foreign file",
      status: "idea",
    })).status === 404,
    "cross-workspace file is concealed",
  );
  assert(
    (await request(primary, `/api/v1/people/${ada}/gifts`, "POST", {
      name: "Foreign recipient",
      recipientPersonId: outsider,
      status: "idea",
    })).status === 404,
    "cross-workspace recipient is concealed",
  );
  assert(
    (await request(primary, `/api/v1/people/${ada}/gifts`, "POST", {
      amount: "2",
      currencyCode: "XXX",
      name: "Unsupported currency",
      status: "idea",
    })).status === 400,
    "unsupported gift currency is rejected before persistence",
  );
  assert(
    (await request(primary, `/api/v1/people/${ada}/debts`, "POST", {
      amount: "2",
      direction: "i_owe",
      status: "open",
    })).status === 400,
    "debt requires a supported currency",
  );
  assert(
    (await request(foreign, `/api/v1/people/${ada}/gifts`, "GET")).status ===
      404,
    "cross-workspace list is concealed",
  );
  assert(
    (await request(
      primary,
      `/api/v1/people/${ada}/gifts/${attachedBody.gift.id}/status`,
      "PATCH",
      { status: "idea" },
    )).status === 409,
    "invalid gift reversal is rejected",
  );

  const debt = await request(primary, `/api/v1/people/${ada}/debts`, "POST", {
    amount: "24.5000",
    currencyCode: "EUR",
    direction: "they_owe",
    reason: "Lunch",
    status: "open",
  });
  const debtBody = await debt.json() as { debt: { id: string } };
  assert(debt.status === 201, "debt direction, amount, and currency persist");
  assert(
    (await request(
      primary,
      `/api/v1/people/${ada}/debts/${debtBody.debt.id}/status`,
      "PATCH",
      { status: "settled" },
    )).status === 200,
    "open debt settles",
  );
  const [settled] = await sql<{ settled_at: Date | null }[]>`
    select settled_at from crm.debts where id = ${debtBody.debt.id}::uuid
  `;
  assert(settled?.settled_at, "settled debt records its settlement instant");
  const [audits] = await sql<{ count: string }[]>`
    select count(*)::text as count from crm.audit_events
    where workspace_id = ${primary.workspaceId}::uuid
      and subject_type in ('gift', 'debt')
  `;
  assert(
    Number(audits?.count) >= 4,
    "gift and debt changes preserve audit history",
  );

  const racedGift = await request(
    primary,
    `/api/v1/people/${ada}/gifts`,
    "POST",
    { name: "Competing terminal", status: "idea" },
  );
  const racedGiftBody = await racedGift.json() as { gift: { id: string } };
  let competingTransition: Promise<Response> | undefined;
  await sql.begin(async (transaction) => {
    await transaction`
      select id from crm.gifts where id = ${racedGiftBody.gift.id}::uuid
      for update
    `;
    competingTransition = Promise.resolve(request(
      primary,
      `/api/v1/people/${ada}/gifts/${racedGiftBody.gift.id}/status`,
      "PATCH",
      { status: "given" },
    ));
    await new Promise((resolve) => setTimeout(resolve, 75));
    await transaction`
      update crm.gifts set status = 'received', updated_at = now()
      where id = ${racedGiftBody.gift.id}::uuid
    `;
  });
  assert(competingTransition, "competing transition started while locked");
  assert(
    (await competingTransition).status === 409,
    "a competing terminal transition cannot overwrite the committed winner",
  );

  let archivedWrite: Promise<Response> | undefined;
  await sql.begin(async (transaction) => {
    await transaction`
      select id from crm.people where id = ${grace}::uuid for update
    `;
    archivedWrite = Promise.resolve(request(
      primary,
      `/api/v1/people/${grace}/debts`,
      "POST",
      {
        amount: "3",
        currencyCode: "EUR",
        direction: "they_owe",
        status: "open",
      },
    ));
    await new Promise((resolve) => setTimeout(resolve, 75));
    await transaction`
      update crm.people set archived_at = now(), updated_at = now()
      where id = ${grace}::uuid
    `;
  });
  assert(archivedWrite, "write started while archival row was locked");
  assert(
    (await archivedWrite).status === 409,
    "a write serialized after archival observes the archived state",
  );

  await sql`update crm.people set archived_at = now() where id = ${ada}::uuid`;
  assert(
    (await request(primary, `/api/v1/people/${ada}/debts`, "POST", {
      amount: "1",
      currencyCode: "EUR",
      direction: "i_owe",
      status: "open",
    })).status === 409,
    "archived person rejects writes",
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
  name: "[GIFTS-001] GAP-009 a revoked member cannot write gifts or debts",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        `gift-revocation-${crypto.randomUUID()}`,
      );
      const gifts = createGiftManagement({
        actors: new PostgresActorRevalidation(),
        attachments: new PostgresGiftAttachmentBoundary(
          new PostgresGiftAttachmentTarget(),
        ),
        audit: giftAuditFrom(new PostgresAuditEventRecorder()),
        clock: { now: () => new Date() },
        currencies: new PostgresWorkspaceCurrencyBoundary(),
        ids: { next: () => crypto.randomUUID() },
        repository: new PostgresGiftRepository(),
        transaction: new PostgresPeopleTransaction(connection.db),
      });

      const allowed = await gifts.createGift(actor, actor.personId, {
        name: "Allowed gift",
        status: "idea",
      });
      assert(allowed.status === "created", "an active member creates a gift");

      await revokeMembership(actor.memberId);

      const refusedGift = await gifts.createGift(actor, actor.personId, {
        name: "Refused gift",
        status: "idea",
      });
      const refusedDebt = await gifts.createDebt(actor, actor.personId, {
        amount: "10.00",
        currencyCode: "EUR",
        direction: "i_owe",
        status: "open",
      });
      const refusedChange = await gifts.changeGiftStatus(
        actor,
        actor.personId,
        allowed.status === "created" ? allowed.gift.id : crypto.randomUUID(),
        "archived",
      );
      const refusedList = await gifts.list(actor, actor.personId);
      assert(
        refusedGift.status === "forbidden" &&
          refusedDebt.status === "forbidden" &&
          refusedChange.status === "forbidden" &&
          refusedList.status === "forbidden",
        "a revoked member still reached gifts or debts",
      );
      const [remaining] = await sql<[{ readonly count: number }]>`
        select count(*)::int as count from crm.gifts
        where workspace_id = ${actor.workspaceId}
      `;
      assert(remaining?.count === 1, "a revoked member wrote a gift row");
    } finally {
      await connection.destroy();
    }
  },
});
Deno.test({
  name: "GIFTS-001 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.all([configured.close(), sql.end()]);
  },
});
