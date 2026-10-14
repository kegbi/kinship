import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  createGiftManagement,
  createRecurringDebtCharging,
} from "../../packages/backend/modules/gifts/public.ts";
import { giftAuditFrom } from "../../packages/backend/modules/gifts/public.ts";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { PostgresGiftBusinessImportBoundary } from "../../packages/backend/modules/gifts/adapters/postgres/import_business_boundary.ts";
import { personBoundary } from "../../packages/backend/modules/people/composition.ts";
import {
  PostgresGiftAttachmentTarget,
} from "../../packages/backend/modules/gifts/adapters/postgres/gift_attachment_target.ts";
import {
  PostgresGiftRepository,
} from "../../packages/backend/modules/gifts/adapters/postgres/gift_repository.ts";
import {
  PostgresRecurringDebtRepository,
} from "../../packages/backend/modules/gifts/adapters/postgres/recurring_debt_repository.ts";
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
import {
  PostgresWorkspaceCalendarBoundary,
} from "../../packages/backend/modules/workspaces/adapters/postgres/workspace_calendar.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  revocableActor,
  revokeMembership,
} from "../support/database.ts";
import { apiSupport, type SignedInFixture } from "../support/api.ts";
import { createPerson as createPersonThroughApi } from "../support/fixtures.ts";

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
const register = (email: string, workspaceName: string) =>
  api.register(email, workspaceName, { firstName: "Gift", lastName: "Tester" });
const createPerson = (fixture: Fixture, givenName: string) =>
  createPersonThroughApi(api, fixture, givenName);

Deno.test({
  name:
    "[GIFTS-001] PostgreSQL reopens and permanently removes debts with scoped atomic audit",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const suffix = crypto.randomUUID();
      const primary = await register(
        `debt-actions-${suffix}@example.test`,
        "Debt actions",
      );
      const foreign = await register(
        `debt-actions-foreign-${suffix}@example.test`,
        "Foreign debts",
      );
      const person = await createPerson(primary, "Debt owner");
      const otherPerson = await createPerson(primary, "Other person");
      const debtPath = `/api/v1/people/${person}/debts`;
      const auditCount = async (id: string) => {
        const [row] = await sql<
          { count: number }[]
        >`select count(*)::int as count from crm.audit_events where workspace_id = ${primary.workspaceId}::uuid and subject_id = ${id}::uuid and subject_type = 'debt'`;
        return row?.count;
      };
      for (const status of ["open", "settled", "cancelled"] as const) {
        const created = await request(primary, debtPath, "POST", {
          amount: "14.5",
          currencyCode: "EUR",
          direction: "they_owe",
          status,
        });
        assertEquals(created.status, 201);
        const body = await created.json() as { debt: { id: string } };
        const id = body.debt.id;
        if (status === "settled") {
          const reopened = await request(
            primary,
            `${debtPath}/${id}/status`,
            "PATCH",
            { status: "open" },
          );
          assertEquals(reopened.status, 200);
          const opened = await reopened.json() as {
            debt: { status: string; settledAt?: string };
          };
          assertEquals(opened.debt.status, "open");
          assertEquals(opened.debt.settledAt, undefined);
          const [row] = await sql<
            { settled_at: Date | null }[]
          >`select settled_at from crm.debts where id = ${id}::uuid`;
          assertEquals(row?.settled_at, null);
          const before = await auditCount(id);
          const repeated = await request(
            primary,
            `${debtPath}/${id}/status`,
            "PATCH",
            { status: "open" },
          );
          assertEquals(
            (await repeated.json() as { status: string }).status,
            "unchanged",
          );
          assertEquals(await auditCount(id), before);
          const resettled = await request(
            primary,
            `${debtPath}/${id}/status`,
            "PATCH",
            { status: "settled" },
          );
          assertEquals(resettled.status, 200);
          assert(
            (await resettled.json() as { debt: { settledAt?: string } }).debt
              .settledAt,
            "settling again stamps its new settlement",
          );
        }
        if (status === "cancelled") {
          assertEquals(
            (await request(primary, `${debtPath}/${id}/status`, "PATCH", {
              status: "open",
            })).status,
            409,
          );
        }
        for (
          const [who, path] of [[foreign, `${debtPath}/${id}`], [
            primary,
            `/api/v1/people/${otherPerson}/debts/${id}`,
          ]] as const
        ) {
          assertEquals((await request(who, path, "DELETE")).status, 404);
          assertEquals(
            (await request(who, `${path}/status`, "PATCH", { status: "open" }))
              .status,
            404,
          );
        }
        await sql`update crm.people set archived_at = now() where id = ${person}::uuid`;
        assertEquals(
          (await request(primary, `${debtPath}/${id}`, "DELETE")).status,
          409,
        );
        assertEquals(
          (await request(primary, `${debtPath}/${id}/status`, "PATCH", {
            status: "open",
          })).status,
          409,
        );
        await sql`update crm.people set archived_at = null where id = ${person}::uuid`;
        const before = await auditCount(id);
        const deleted = await request(primary, `${debtPath}/${id}`, "DELETE");
        assertEquals(deleted.status, 200);
        assertEquals(await deleted.json(), { debtId: id, status: "deleted" });
        assertEquals(await auditCount(id), (before ?? 0) + 1);
        assertEquals(
          (await request(primary, `${debtPath}/${id}`, "DELETE")).status,
          404,
        );
        assertEquals(await auditCount(id), (before ?? 0) + 1);
        const [deletedAudit] = await sql<
          { payload: { action: string } }[]
        >`select payload from crm.audit_events where subject_id = ${id}::uuid and payload->>'action' = 'deleted'`;
        assertEquals(deletedAudit?.payload.action, "deleted");
        const rows = await sql`select id from crm.debts where id = ${id}::uuid`;
        assertEquals(rows.length, 0);
      }

      const created = await request(primary, debtPath, "POST", {
        amount: "3",
        currencyCode: "EUR",
        direction: "i_owe",
        status: "open",
      });
      const { debt: { id } } = await created.json() as { debt: { id: string } };
      const brokenAudit = createGiftManagement({
        actors: new PostgresActorRevalidation(),
        attachments: new PostgresGiftAttachmentBoundary(
          new PostgresGiftAttachmentTarget(),
        ),
        audit: {
          record: () => Promise.reject(new Error("audit unavailable")),
          recordCharged: () => Promise.reject(new Error("unused")),
        },
        calendar: new PostgresWorkspaceCalendarBoundary(),
        clock: { now: () => new Date() },
        currencies: new PostgresWorkspaceCurrencyBoundary(),
        ids: { next: () => crypto.randomUUID() },
        recurringDebts: new PostgresRecurringDebtRepository(),
        repository: new PostgresGiftRepository(),
        transaction: new PostgresPeopleTransaction(connection.db),
      });
      const actor = {
        memberId: primary.memberId,
        userId: primary.userId,
        role: primary.role,
        workspaceId: primary.workspaceId,
      };
      assertEquals(await brokenAudit.deleteDebt(actor, person, id), {
        status: "unavailable",
      });
      assertEquals(
        (await sql`select id from crm.debts where id = ${id}::uuid`).length,
        1,
      );
      const recurring = await request(
        primary,
        `/api/v1/people/${person}/recurring-debts`,
        "POST",
        {
          amount: "8",
          currencyCode: "EUR",
          dayOfMonth: 1,
          direction: "they_owe",
          intervalMonths: 1,
          startsOn: monthsFromToday(-1, 1),
        },
      );
      const recurringBody = await recurring.json() as {
        charged: number;
        recurringDebt: { id: string; nextOccurrenceOn: string };
      };
      assertEquals(recurringBody.charged, 2);
      const ruleId = recurringBody.recurringDebt.id;
      const [selectedCharge] = await sql<
        { id: string }[]
      >`select id::text from crm.debts where recurring_debt_id = ${ruleId}::uuid order by occurrence_on limit 1`;
      assert(selectedCharge, "generated charge expected");
      assertEquals(
        (await request(primary, `${debtPath}/${selectedCharge.id}`, "DELETE"))
          .status,
        200,
      );
      const charging = createRecurringDebtCharging({
        audit: giftAuditFrom(new PostgresAuditEventRecorder()),
        calendar: new PostgresWorkspaceCalendarBoundary(),
        clock: { now: () => new Date() },
        ids: { next: () => crypto.randomUUID() },
        recurringDebts: new PostgresRecurringDebtRepository(),
        transaction: new PostgresPeopleTransaction(connection.db),
      });
      await charging.chargeDue();
      await charging.chargeDue();
      assertEquals(
        (await sql`select id from crm.debts where recurring_debt_id = ${ruleId}::uuid`)
          .length,
        1,
      );
      const [ruleAfter] = await sql<
        { next: string; active: boolean }[]
      >`select next_occurrence_on::text as next, is_active as active from crm.recurring_debts where id = ${ruleId}::uuid`;
      assertEquals(
        ruleAfter?.next,
        recurringBody.recurringDebt.nextOccurrenceOn,
      );
      assertEquals(ruleAfter?.active, true);
      await sql`update crm.people set deleted_at = now() where id = ${person}::uuid`;
      assertEquals(
        (await request(primary, `${debtPath}/${id}`, "DELETE")).status,
        404,
      );
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name:
    "[GIFTS-001] PostgreSQL ordinary resume preserves a removed latest charge and finished rules",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        sql,
        `debt-resume-${crypto.randomUUID()}`,
      );
      const dependencies = {
        actors: new PostgresActorRevalidation(),
        attachments: new PostgresGiftAttachmentBoundary(
          new PostgresGiftAttachmentTarget(),
        ),
        audit: giftAuditFrom(new PostgresAuditEventRecorder()),
        calendar: new PostgresWorkspaceCalendarBoundary(),
        clock: { now: () => new Date("2026-10-14T10:00:00.000Z") },
        currencies: new PostgresWorkspaceCurrencyBoundary(),
        ids: { next: () => crypto.randomUUID() },
        recurringDebts: new PostgresRecurringDebtRepository(),
        repository: new PostgresGiftRepository(),
        transaction: new PostgresPeopleTransaction(connection.db),
      };
      const gifts = createGiftManagement(dependencies);
      const charging = createRecurringDebtCharging(dependencies);
      for (const endsOn of [undefined, "2026-10-14"]) {
        const created = await gifts.createRecurringDebt(actor, actor.personId, {
          amount: "8",
          currencyCode: "EUR",
          dayOfMonth: 14,
          direction: "they_owe",
          intervalMonths: 1,
          startsOn: "2026-09-14",
          ...(endsOn ? { endsOn } : {}),
        });
        if (created.status !== "created") throw new Error(created.status);
        assertEquals(created.charged, 2);
        const id = created.recurringDebt.id;
        const [latest] = await sql<
          { id: string }[]
        >`select id::text from crm.debts where recurring_debt_id = ${id}::uuid and occurrence_on = '2026-10-14'`;
        assert(latest, "today's generated charge expected");
        assertEquals(await gifts.deleteDebt(actor, actor.personId, latest.id), {
          debtId: latest.id,
          status: "deleted",
        });
        for (let retry = 0; retry < 2; retry++) {
          await gifts.changeRecurringDebt(actor, actor.personId, id, {
            active: false,
          });
          const resumed = await gifts.changeRecurringDebt(
            actor,
            actor.personId,
            id,
            { active: true },
          );
          if (resumed.status !== "saved") throw new Error(resumed.status);
          assertEquals(resumed.charged, 0);
          assertEquals(
            resumed.recurringDebt.nextOccurrenceOn,
            endsOn ? undefined : "2026-11-14",
          );
          assertEquals((await charging.chargeDue()).charged, 0);
          const charged = await sql<
            { on: string }[]
          >`select occurrence_on::text as on from crm.debts where recurring_debt_id = ${id}::uuid order by occurrence_on`;
          assertEquals(charged.map((row) => row.on), ["2026-09-14"]);
        }
        if (endsOn) {
          await gifts.changeRecurringDebt(actor, actor.personId, id, {
            active: false,
          });
          const extended = await gifts.changeRecurringDebt(
            actor,
            actor.personId,
            id,
            { active: true, endsOn: "2026-12-14" },
          );
          assertEquals(
            extended.status === "saved" ? extended.charged : extended.status,
            1,
            "explicit rescheduling may regenerate the removed period",
          );
        }
      }
    } finally {
      await connection.destroy();
    }
  },
});

function request(
  fixture: Fixture,
  path: string,
  method: "DELETE" | "GET" | "PATCH" | "POST",
  body?: unknown,
) {
  return api.request(fixture, path, method, body);
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

Deno.test({
  name: "[GIFTS-001] GAP-009 a revoked member cannot write gifts or debts",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        sql,
        `gift-revocation-${crypto.randomUUID()}`,
      );
      const gifts = createGiftManagement({
        actors: new PostgresActorRevalidation(),
        attachments: new PostgresGiftAttachmentBoundary(
          new PostgresGiftAttachmentTarget(),
        ),
        audit: giftAuditFrom(new PostgresAuditEventRecorder()),
        calendar: new PostgresWorkspaceCalendarBoundary(),
        clock: { now: () => new Date() },
        currencies: new PostgresWorkspaceCurrencyBoundary(),
        ids: { next: () => crypto.randomUUID() },
        recurringDebts: new PostgresRecurringDebtRepository(),
        repository: new PostgresGiftRepository(),
        transaction: new PostgresPeopleTransaction(connection.db),
      });

      const allowed = await gifts.createGift(actor, actor.personId, {
        name: "Allowed gift",
        status: "idea",
      });
      assert(allowed.status === "created", "an active member creates a gift");

      const allowedDebt = await gifts.createDebt(actor, actor.personId, {
        amount: "10",
        currencyCode: "EUR",
        direction: "i_owe",
        status: "settled",
      });
      assert(allowedDebt.status === "created", "active member creates debt");

      await revokeMembership(sql, actor.memberId);

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
      const refusedReopen = await gifts.changeDebtStatus(
        actor,
        actor.personId,
        allowedDebt.debt.id,
        "open",
      );
      const refusedDelete = await gifts.deleteDebt(
        actor,
        actor.personId,
        allowedDebt.debt.id,
      );
      assert(
        refusedGift.status === "forbidden" &&
          refusedDebt.status === "forbidden" &&
          refusedChange.status === "forbidden" &&
          refusedReopen.status === "forbidden" &&
          refusedDelete.status === "forbidden" &&
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
Deno.test("[GAP-023] PostgreSQL pages gifts and debts independently behind bound cursors", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(
    `gifts-page-${suffix}@example.test`,
    "Gift pages",
  );
  const foreign = await register(
    `gifts-page-foreign-${suffix}@example.test`,
    "Gift pages foreign",
  );
  const ada = await createPerson(primary, "Ada");
  const grace = await createPerson(primary, "Grace");
  const outsider = await createPerson(foreign, "Outsider");
  for (const name of ["First", "Second", "Third"]) {
    assert(
      (await request(primary, `/api/v1/people/${ada}/gifts`, "POST", {
        name,
        status: "idea",
      })).status === 201,
      `${name} gift created`,
    );
    assert(
      (await request(primary, `/api/v1/people/${ada}/debts`, "POST", {
        amount: "1",
        currencyCode: "EUR",
        direction: "i_owe",
        reason: name,
        status: "open",
      })).status === 201,
      `${name} debt created`,
    );
  }
  // Every row shares one instant, so only the identifier can order a page
  // boundary: the keyset has to carry it or a row is dropped or repeated.
  await sql`
    update crm.gifts set updated_at = '2026-08-23T10:00:00Z'
    where person_id = ${ada}::uuid
  `;
  await sql`
    update crm.debts set updated_at = '2026-08-23T10:00:00Z'
    where person_id = ${ada}::uuid
  `;
  interface Page {
    readonly debts: readonly { readonly id: string }[];
    readonly gifts: readonly { readonly id: string }[];
    readonly nextDebtCursor?: string;
    readonly nextGiftCursor?: string;
  }
  const read = async (fixture: Fixture, person: string, query: string) => {
    const response = await request(
      fixture,
      `/api/v1/people/${person}/gifts?${query}`,
      "GET",
    );
    return { body: await response.json() as Page, status: response.status };
  };
  const first = await read(primary, ada, "limit=2");
  assert(
    first.status === 200 && first.body.gifts.length === 2 &&
      first.body.debts.length === 2 && first.body.nextGiftCursor &&
      first.body.nextDebtCursor,
    "a first page of two did not continue both collections",
  );
  const giftCursor = first.body.nextGiftCursor!;
  const debtCursor = first.body.nextDebtCursor!;
  const gifts = await read(
    primary,
    ada,
    `limit=2&giftCursor=${encodeURIComponent(giftCursor)}`,
  );
  assert(
    gifts.status === 200 && gifts.body.gifts.length === 1 &&
      !gifts.body.nextGiftCursor &&
      new Set([...first.body.gifts, ...gifts.body.gifts].map((row) => row.id))
          .size === 3,
    "the gift continuation dropped or repeated a gift",
  );
  assert(
    JSON.stringify(gifts.body.debts) === JSON.stringify(first.body.debts) &&
      gifts.body.nextDebtCursor !== undefined,
    "continuing gifts disturbed the first page of debts",
  );
  const debts = await read(
    primary,
    ada,
    `limit=2&debtCursor=${encodeURIComponent(debtCursor)}`,
  );
  assert(
    debts.status === 200 && debts.body.debts.length === 1 &&
      !debts.body.nextDebtCursor &&
      new Set([...first.body.debts, ...debts.body.debts].map((row) => row.id))
          .size === 3,
    "the debt continuation dropped or repeated a debt",
  );
  const everything = await read(primary, ada, "limit=50");
  assert(
    everything.body.gifts.length === 3 && everything.body.debts.length === 3 &&
      !everything.body.nextGiftCursor && !everything.body.nextDebtCursor,
    "a page larger than the collection still offered a continuation",
  );
  for (
    const [fixture, person, query] of [
      [primary, grace, `giftCursor=${encodeURIComponent(giftCursor)}`],
      [foreign, outsider, `giftCursor=${encodeURIComponent(giftCursor)}`],
      [primary, ada, `debtCursor=${encodeURIComponent(giftCursor)}`],
      [primary, ada, "giftCursor=not-a-cursor"],
      [primary, ada, "limit=51"],
    ] as const
  ) {
    const refused = await request(
      fixture,
      `/api/v1/people/${person}/gifts?${query}`,
      "GET",
    );
    const problem = await refused.json() as { readonly code?: string };
    assert(
      refused.status === 400 && problem.code === "gift_query_invalid",
      `${query} against another listing was answered: ${refused.status}`,
    );
  }
});

// --- REL-081 -------------------------------------------------------------

Deno.test({
  name:
    "[GIFTS-001] REL-081 an avatar image is refused as a gift attachment and a document still attaches",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const owner = await register(
        `gift-avatar-${crypto.randomUUID()}@example.test`,
        "Gift avatar",
      );
      const ada = await createPerson(owner, "Ada");
      const avatarFileId = crypto.randomUUID();
      const documentFileId = crypto.randomUUID();
      await sql`
        insert into crm.files (
          id, workspace_id, uploaded_by_member_id, original_filename,
          storage_provider, storage_bucket, storage_key, byte_size, mime_type,
          status, visibility
        ) values
          (${avatarFileId}::uuid, ${owner.workspaceId}::uuid,
           ${owner.memberId}::uuid, 'avatar.png', 'test', 'test',
           ${avatarFileId}, 4, 'image/png', 'available', 'private'),
          (${documentFileId}::uuid, ${owner.workspaceId}::uuid,
           ${owner.memberId}::uuid, 'receipt.pdf', 'test', 'test',
           ${documentFileId}, 4, 'application/pdf', 'available', 'private')
      `;
      await sql`
        insert into crm.person_file_links (person_id, file_id, kind)
        values
          (${ada}::uuid, ${avatarFileId}::uuid, 'avatar'),
          (${ada}::uuid, ${documentFileId}::uuid, 'document')
      `;

      const refused = await request(
        owner,
        `/api/v1/people/${ada}/gifts`,
        "POST",
        { attachmentFileId: avatarFileId, name: "Avatar gift", status: "idea" },
      );
      await refused.body?.cancel();
      assert(
        refused.status === 404,
        `an avatar image was accepted as a gift attachment: ${refused.status}`,
      );

      const plain = await request(
        owner,
        `/api/v1/people/${ada}/gifts`,
        "POST",
        { name: "Plain gift", status: "idea" },
      );
      const plainBody = await plain.json() as { gift: { id: string } };
      assert(plain.status === 201, "a gift without an attachment is created");
      const boundary = new PostgresGiftAttachmentBoundary(
        new PostgresGiftAttachmentTarget(),
      );
      const actor = {
        memberId: owner.memberId,
        role: owner.role,
        userId: owner.userId,
        workspaceId: owner.workspaceId,
      };
      const direct = await boundary.attachToGift({
        ...actor,
        fileId: avatarFileId,
        giftId: plainBody.gift.id,
        transaction: { opaque: connection.db },
      });
      assert(
        direct.status === "not-found",
        `the boundary linked an avatar image to a gift: ${direct.status}`,
      );
      const [avatarLinks] = await sql<[{ readonly count: number }]>`
        select count(*)::int as count from crm.gift_file_links
        where file_id = ${avatarFileId}::uuid
      `;
      assert(avatarLinks?.count === 0, "an avatar image is linked to a gift");

      const attached = await request(
        owner,
        `/api/v1/people/${ada}/gifts`,
        "POST",
        {
          attachmentFileId: documentFileId,
          name: "Documented gift",
          status: "given",
        },
      );
      const attachedBody = await attached.json() as {
        gift: { attachmentFileId?: string };
      };
      assert(
        attached.status === 201 &&
          attachedBody.gift.attachmentFileId === documentFileId,
        `a person's document no longer attaches to a gift: ${attached.status}`,
      );
    } finally {
      await connection.destroy();
    }
  },
});

/** The UTC calendar date `months` months from today, on day `day`. */
function monthsFromToday(months: number, day: number): string {
  const today = Temporal.Now.plainDateISO("UTC");
  const month = today.toPlainYearMonth().add({ months });
  return month.toPlainDate({ day: Math.min(day, month.daysInMonth) })
    .toString();
}

Deno.test({
  name:
    "[GIFTS-001] PostgreSQL recurring debts charge each period once, catch up, and stay in their workspace",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const suffix = crypto.randomUUID();
      const primary = await register(
        `recurring-${suffix}@example.test`,
        "Recurring primary",
      );
      const foreign = await register(
        `recurring-foreign-${suffix}@example.test`,
        "Recurring foreign",
      );
      const ada = await createPerson(primary, "Ada");
      const outsider = await createPerson(foreign, "Outsider");
      const charging = createRecurringDebtCharging({
        audit: giftAuditFrom(new PostgresAuditEventRecorder()),
        calendar: new PostgresWorkspaceCalendarBoundary(),
        clock: { now: () => new Date() },
        ids: { next: () => crypto.randomUUID() },
        recurringDebts: new PostgresRecurringDebtRepository(),
        transaction: new PostgresPeopleTransaction(connection.db),
      });
      const charged = async (rule: string) =>
        (await sql<{ readonly on: string }[]>`
          select occurrence_on::text as on from crm.debts
          where recurring_debt_id = ${rule}::uuid order by occurrence_on
        `).map((row) => row.on);

      // A rule that started two months ago charges three periods at once.
      const startsOn = monthsFromToday(-2, 1);
      const created = await request(
        primary,
        `/api/v1/people/${ada}/recurring-debts`,
        "POST",
        {
          amount: "25.50",
          currencyCode: "eur",
          dayOfMonth: 1,
          direction: "they_owe",
          intervalMonths: 1,
          reason: "Shared rent",
          startsOn,
        },
      );
      const createdBody = await created.json() as {
        readonly charged: number;
        readonly recurringDebt: {
          readonly id: string;
          readonly nextOccurrenceOn?: string;
        };
      };
      assert(
        created.status === 201 && createdBody.charged === 3,
        `a past start did not catch up: ${created.status} ${
          JSON.stringify(createdBody)
        }`,
      );
      const rule = createdBody.recurringDebt.id;
      assert(
        createdBody.recurringDebt.nextOccurrenceOn === monthsFromToday(1, 1),
        "the rule waits for next month's period",
      );
      assert(
        JSON.stringify(await charged(rule)) ===
          JSON.stringify([
            startsOn,
            monthsFromToday(-1, 1),
            monthsFromToday(0, 1),
          ]),
        "each period is its own debt",
      );

      // The worker finds nothing more to charge, however often it runs.
      await charging.chargeDue();
      await charging.chargeDue();
      assert((await charged(rule)).length === 3, "the worker charged twice");

      // A worker that was down for months catches up every period, once,
      // even when two runs overlap.
      await sql`
        update crm.recurring_debts
        set starts_on = ${monthsFromToday(-6, 1)}::date,
          next_occurrence_on = ${monthsFromToday(-6, 1)}::date
        where id = ${rule}::uuid
      `;
      await Promise.all([charging.chargeDue(), charging.chargeDue()]);
      const caughtUp = await charged(rule);
      assert(
        caughtUp.length === 7 && new Set(caughtUp).size === 7,
        `catch-up charged ${JSON.stringify(caughtUp)}`,
      );
      const [advanced] = await sql<{ readonly next: string }[]>`
        select next_occurrence_on::text as next from crm.recurring_debts
        where id = ${rule}::uuid
      `;
      assert(
        advanced?.next === monthsFromToday(1, 1),
        `catch-up left the rule at ${advanced?.next}`,
      );

      // The person's section lists the rule, the generated debts, and the
      // default currency: the workspace's, until the member chooses one.
      const listed = async () =>
        await (await request(primary, `/api/v1/people/${ada}/gifts`, "GET"))
          .json() as {
            readonly debts: readonly { readonly recurringDebtId?: string }[];
            readonly defaultCurrencyCode: string;
            readonly recurringDebts: readonly { readonly id: string }[];
          };
      const first = await listed();
      assert(
        first.defaultCurrencyCode === "USD" &&
          first.recurringDebts.map((entry) => entry.id).join() === rule &&
          first.debts.filter((debt) => debt.recurringDebtId === rule)
              .length === 7,
        `the section did not list the rule: ${JSON.stringify(first)}`,
      );
      await sql`
        update crm.workspace_settings set default_currency_code = 'EUR'
        where workspace_id = ${primary.workspaceId}::uuid
      `;
      assert(
        (await listed()).defaultCurrencyCode === "EUR",
        "the workspace default currency was not offered",
      );
      await sql`
        insert into crm.member_preferences (member_id, currency_code)
        values (${primary.memberId}::uuid, 'RSD')
        on conflict (member_id) do update set currency_code = 'RSD'
      `;
      assert(
        (await listed()).defaultCurrencyCode === "RSD",
        "the member's preferred currency was not offered",
      );

      // Another workspace can neither see, change, nor delete the rule, nor
      // create one for a person it does not own.
      for (
        const [method, body] of [
          ["PATCH", { amount: "1" }],
          ["DELETE", undefined],
        ] as const
      ) {
        const refused = await request(
          foreign,
          `/api/v1/people/${ada}/recurring-debts/${rule}`,
          method,
          body,
        );
        assert(
          refused.status === 404,
          `${method} reached another workspace's rule: ${refused.status}`,
        );
      }
      const foreignCreate = await request(
        foreign,
        `/api/v1/people/${ada}/recurring-debts`,
        "POST",
        {
          amount: "1",
          currencyCode: "EUR",
          dayOfMonth: 1,
          direction: "i_owe",
          intervalMonths: 1,
          startsOn,
        },
      );
      assert(
        foreignCreate.status === 404,
        `a rule was created for another workspace's person: ${foreignCreate.status}`,
      );
      const outsiderList = await (await request(
        foreign,
        `/api/v1/people/${outsider}/gifts`,
        "GET",
      )).json() as { readonly recurringDebts: readonly unknown[] };
      assert(
        outsiderList.recurringDebts.length === 0,
        "another workspace's rule leaked into a list",
      );

      // A paused rule charges nothing; deleting it keeps every debt.
      const paused = await request(
        primary,
        `/api/v1/people/${ada}/recurring-debts/${rule}`,
        "PATCH",
        { active: false },
      );
      assert(paused.status === 200, `pause failed: ${paused.status}`);
      await sql`
        update crm.recurring_debts
        set next_occurrence_on = ${monthsFromToday(0, 1)}::date
        where id = ${rule}::uuid
      `;
      await sql`
        delete from crm.debts
        where recurring_debt_id = ${rule}::uuid
          and occurrence_on = ${monthsFromToday(0, 1)}::date
      `;
      await charging.chargeDue();
      assert(
        (await charged(rule)).length === 6,
        "a paused rule was charged",
      );
      const deleted = await request(
        primary,
        `/api/v1/people/${ada}/recurring-debts/${rule}`,
        "DELETE",
      );
      assert(deleted.status === 200, `delete failed: ${deleted.status}`);
      const [kept] = await sql<{ readonly count: number }[]>`
        select count(*)::int as count from crm.debts
        where person_id = ${ada}::uuid and recurring_debt_id is null
          and occurrence_on is not null
      `;
      assert(kept?.count === 6, "deleting the rule removed its debts");
      const [audits] = await sql<{ readonly count: number }[]>`
        select count(*)::int as count from crm.audit_events
        where workspace_id = ${primary.workspaceId}::uuid
          and action = 'gifts.recurring-debt-created-or-state-changed'
      `;
      assert(
        audits?.count === 3,
        `rule audits were ${audits?.count}, not create, pause, and delete`,
      );
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name:
    "[GIFTS-001] PostgreSQL earlier-start edits preserve charged months across due-day changes",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        sql,
        `backfill-${crypto.randomUUID()}`,
      );
      const dependencies = {
        actors: new PostgresActorRevalidation(),
        attachments: new PostgresGiftAttachmentBoundary(
          new PostgresGiftAttachmentTarget(),
        ),
        audit: giftAuditFrom(new PostgresAuditEventRecorder()),
        calendar: new PostgresWorkspaceCalendarBoundary(),
        clock: { now: () => new Date("2026-10-14T10:00:00.000Z") },
        currencies: new PostgresWorkspaceCurrencyBoundary(),
        ids: { next: () => crypto.randomUUID() },
        recurringDebts: new PostgresRecurringDebtRepository(),
        repository: new PostgresGiftRepository(),
        transaction: new PostgresPeopleTransaction(connection.db),
      };
      const management = createGiftManagement(dependencies);
      const created = await management.createRecurringDebt(
        actor,
        actor.personId,
        {
          amount: "500",
          currencyCode: "EUR",
          dayOfMonth: 14,
          direction: "they_owe",
          intervalMonths: 1,
          reason: "Rent",
          startsOn: "2026-10-14",
        },
      );
      assert(created.status === "created", "create should charge October");
      const id = created.recurringDebt.id;
      await sql`
        update crm.debts set status = 'settled', settled_at = '2026-10-14T10:00:00Z'
        where recurring_debt_id = ${id}::uuid
      `;
      const snapshot = async () =>
        await sql`
        select id::text, amount::text, status, occurrence_on::text,
          settled_at::text, updated_at::text
        from crm.debts where recurring_debt_id = ${id}::uuid order by occurrence_on
      `;
      const original = (await snapshot())[0];
      const backfilled = await management.changeRecurringDebt(
        actor,
        actor.personId,
        id,
        {
          startsOn: "2026-07-22",
        },
      );
      assert(backfilled.status === "saved", "earlier start should save");
      assertEquals([
        backfilled.charged,
        backfilled.recurringDebt.nextOccurrenceOn,
      ], [2, "2026-11-14"]);
      assertEquals(
        (await snapshot()).at(-1),
        original,
        "settled October debt remains unchanged",
      );
      const moved = await management.changeRecurringDebt(
        actor,
        actor.personId,
        id,
        {
          startsOn: "2026-06-22",
          dayOfMonth: 1,
        },
      );
      assert(moved.status === "saved", "earlier start and day should save");
      assertEquals([moved.charged, moved.recurringDebt.nextOccurrenceOn], [
        1,
        "2026-11-01",
      ]);
      assertEquals((await snapshot()).map((row) => row.occurrence_on), [
        "2026-07-01",
        "2026-08-14",
        "2026-09-14",
        "2026-10-14",
      ]);
      // Retrying an earlier-start edit and overlapping workers cannot charge
      // an existing month even though its original date differs from the rule.
      const retry = await management.changeRecurringDebt(
        actor,
        actor.personId,
        id,
        {
          startsOn: "2026-06-21",
        },
      );
      assert(retry.status === "saved", "retry should save");
      assertEquals([retry.charged, retry.recurringDebt.nextOccurrenceOn], [
        0,
        "2026-11-01",
      ]);
      const worker = createRecurringDebtCharging(dependencies);
      await Promise.all([worker.chargeDue(), worker.chargeDue()]);
      assertEquals((await snapshot()).length, 4);
      assertEquals((await snapshot()).at(-1), original);

      // A finished rule with no first occurrence can still backfill an earlier
      // start up to its end, without leaving a worker cursor after the end.
      const finished = await management.createRecurringDebt(
        actor,
        actor.personId,
        {
          amount: "20",
          currencyCode: "EUR",
          dayOfMonth: 14,
          direction: "i_owe",
          endsOn: "2026-10-15",
          intervalMonths: 1,
          startsOn: "2026-10-15",
        },
      );
      assert(finished.status === "created", "finished rule should save");
      assertEquals(
        [finished.charged, finished.recurringDebt.nextOccurrenceOn],
        [0, undefined],
      );
      const endedBackfill = await management.changeRecurringDebt(
        actor,
        actor.personId,
        finished.recurringDebt.id,
        {
          startsOn: "2026-07-22",
          endsOn: "2026-09-30",
        },
      );
      assert(endedBackfill.status === "saved", "ended backfill should save");
      assertEquals([
        endedBackfill.charged,
        endedBackfill.recurringDebt.nextOccurrenceOn,
      ], [2, undefined]);
      const endedEdit = await management.changeRecurringDebt(
        actor,
        actor.personId,
        finished.recurringDebt.id,
        { amount: "25" },
      );
      assert(endedEdit.status === "saved", "ended rule remains editable");
      assertEquals([
        endedEdit.charged,
        endedEdit.recurringDebt.nextOccurrenceOn,
      ], [0, undefined]);
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name:
    "[GIFTS-001] permanent settlement history is atomic, paged with microsecond precision, image-scoped and import-idempotent",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const suffix = crypto.randomUUID();
    const owner = await register(
      `settlements-${suffix}@example.test`,
      "Settlements",
    );
    const foreign = await register(
      `settlements-foreign-${suffix}@example.test`,
      "Foreign settlements",
    );
    const person = await createPerson(owner, "Debtor");
    const other = await createPerson(owner, "Other person");
    const outsider = await createPerson(foreign, "Outsider");
    const path = `/api/v1/people/${person}/debts`;
    const created = await request(owner, path, "POST", {
      amount: "15.25",
      currencyCode: "EUR",
      direction: "they_owe",
      reason: "Dinner",
      status: "open",
    });
    assertEquals(created.status, 201);
    const { debt: { id } } = await created.json() as { debt: { id: string } };
    const statusPath = `${path}/${id}/status`;
    const historyPath = `${path}/${id}/settlements`;
    const seedPhoto = async (
      workspace: string,
      linkedPerson: string,
      kind = "photo",
      status = "available",
      mime = "image/png",
    ) => {
      const fileId = crypto.randomUUID();
      await sql`insert into crm.files (id,workspace_id,original_filename,mime_type,status) values (${fileId}::uuid,${workspace}::uuid,'paid.png',${mime},${status})`;
      await sql`insert into crm.person_file_links (person_id,file_id,kind) values (${linkedPerson}::uuid,${fileId}::uuid,${kind})`;
      return fileId;
    };
    const validPhoto = await seedPhoto(owner.workspaceId, person);
    for (
      const invalidPhoto of [
        await seedPhoto(owner.workspaceId, other),
        await seedPhoto(foreign.workspaceId, outsider),
        await seedPhoto(owner.workspaceId, person, "avatar"),
        await seedPhoto(
          owner.workspaceId,
          person,
          "document",
          "available",
          "application/pdf",
        ),
        await seedPhoto(owner.workspaceId, person, "photo", "missing"),
        await seedPhoto(owner.workspaceId, person, "photo", "quarantined"),
        await seedPhoto(owner.workspaceId, person, "photo", "processing"),
      ]
    ) {
      assertEquals(
        (await request(owner, statusPath, "PATCH", {
          status: "settled",
          settlementPhotoFileId: invalidPhoto,
        })).status,
        404,
      );
    }
    const [stillOpen] = await sql<
      { status: string; count: number }[]
    >`select debt.status,(select count(*)::int from crm.debt_settlements where debt_id=debt.id) as count from crm.debts debt where id=${id}::uuid`;
    assertEquals(stillOpen, { status: "open", count: 0 });
    const repeated = await Promise.all([
      request(owner, statusPath, "PATCH", {
        status: "settled",
        settlementReason: "Paid by transfer",
        settlementPhotoFileId: validPhoto,
      }),
      request(owner, statusPath, "PATCH", {
        status: "settled",
        settlementReason: "Paid by transfer",
        settlementPhotoFileId: validPhoto,
      }),
    ]);
    assertEquals(repeated.map((response) => response.status), [200, 200]);
    let history = await (await request(owner, historyPath, "GET")).json() as {
      settlements: {
        id: string;
        reason?: string;
        photoAvailable?: boolean;
        photoFilename?: string;
        settledAt: string;
      }[];
    };
    assertEquals(history.settlements.length, 1);
    const first = history.settlements[0]!;
    assertEquals([first.reason, first.photoAvailable], [
      "Paid by transfer",
      true,
    ]);
    await request(owner, statusPath, "PATCH", { status: "open" });
    await request(owner, statusPath, "PATCH", { status: "settled" });
    history = await (await request(owner, historyPath, "GET")).json();
    assertEquals(history.settlements.length, 2);
    assert(
      history.settlements.some((event) =>
        event.id === first.id && event.settledAt === first.settledAt &&
        event.reason === first.reason
      ),
      "reopening preserves the original settlement",
    );
    for (
      const [who, url] of [[foreign, historyPath], [
        owner,
        `/api/v1/people/${other}/debts/${id}/settlements`,
      ]] as const
    ) assertEquals((await request(who, url, "GET")).status, 404);
    assertEquals(
      (await request(owner, `${historyPath}?cursor=bad`, "GET")).status,
      400,
    );
    await sql`update crm.people set archived_at=now() where id=${person}::uuid`;
    assertEquals((await request(owner, historyPath, "GET")).status, 200);
    assertEquals(
      (await request(owner, statusPath, "PATCH", { status: "open" })).status,
      409,
    );
    await sql`update crm.people set archived_at=null where id=${person}::uuid`;
    // Missing and explicitly removed files preserve historical filename/reason/date.
    await sql`update crm.files set status='missing' where id=${validPhoto}::uuid`;
    history = await (await request(owner, historyPath, "GET")).json();
    assertEquals(
      history.settlements.find((event) => event.id === first.id)
        ?.photoAvailable,
      false,
    );
    await sql`delete from crm.files where id=${validPhoto}::uuid`;
    history = await (await request(owner, historyPath, "GET")).json();
    assertEquals(
      history.settlements.find((event) => event.id === first.id)?.photoFilename,
      "paid.png",
    );
    // Equal submillisecond timestamps require their full stored precision in the cursor.
    await sql`delete from crm.debt_settlements where debt_id=${id}::uuid`;
    const eventIds = [1, 2, 3].map((n) =>
      `00000000-0000-4000-8000-00000000100${n}`
    );
    for (const eventId of eventIds) {
      await sql`insert into crm.debt_settlements(id,workspace_id,debt_id,settled_at) values (${eventId}::uuid,${owner.workspaceId}::uuid,${id}::uuid,'2026-01-01T12:00:00.123456Z')`;
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const response = await request(
        owner,
        `${historyPath}?limit=1${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
        }`,
        "GET",
      );
      assertEquals(response.status, 200);
      const result = await response.json() as {
        settlements: { id: string; settledAt: string }[];
        nextCursor?: string;
      };
      seen.push(...result.settlements.map((event) => event.id));
      assertEquals(
        result.settlements[0]?.settledAt,
        "2026-01-01T12:00:00.123456Z",
      );
      cursor = result.nextCursor;
      if (cursor) {
        assertEquals(
          (await request(
            owner,
            `/api/v1/people/${other}/debts/${id}/settlements?cursor=${
              encodeURIComponent(cursor)
            }`,
            "GET",
          )).status,
          400,
        );
      }
    } while (cursor);
    assertEquals(seen, eventIds);
    const initial = await request(owner, path, "POST", {
      amount: "2",
      currencyCode: "EUR",
      direction: "i_owe",
      status: "settled",
      settlementReason: "Already paid",
    });
    const initialId =
      (await initial.json() as { debt: { id: string } }).debt.id;
    assertEquals(
      (await (await request(owner, `${path}/${initialId}/settlements`, "GET"))
        .json() as { settlements: { reason: string }[] }).settlements[0]
        ?.reason,
      "Already paid",
    );
    const connection = connectDatabase(databaseUrl);
    try {
      const imports = new PostgresGiftBusinessImportBoundary(personBoundary());
      const importId = crypto.randomUUID();
      for (let attempt = 0; attempt < 2; attempt++) {
        await connection.db.transaction().execute(async (transaction) => {
          await imports.importRecords({
            actor: owner,
            transaction: { opaque: transaction },
            records: [{
              id: importId,
              references: { personId: person },
              data: {
                kind: "debt",
                amount: "3",
                currencyCode: "EUR",
                direction: "i_owe",
                status: "settled",
                settledAt: "2025-01-02T03:04:05.654321Z",
              },
            }],
          });
        });
      }
      const [imported] = await sql<
        { count: number; time: string }[]
      >`select count(*)::int as count,max(to_char(settled_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) as time from crm.debt_settlements where debt_id=${importId}::uuid`;
      assertEquals(imported, { count: 1, time: "2025-01-02T03:04:05.654321Z" });
    } finally {
      await connection.destroy();
    }
    await request(owner, `${path}/${id}`, "DELETE");
    assertEquals(
      (await sql`select id from crm.debt_settlements where debt_id=${id}::uuid`)
        .length,
      0,
    );
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
