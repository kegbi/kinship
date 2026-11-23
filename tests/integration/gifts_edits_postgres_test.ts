/**
 * MCP-D3: editing gifts and debts, deleting a gift, retry-safe creates, and
 * revision checks, through the deployment's real composition, by browser
 * session and by personal token.
 *
 * Every refusal is proven to change nothing by reading the rows straight from
 * the tables, and every concurrent pair is proven to leave one consistent
 * answer: one record for one retry key, and one winner for a settle racing an
 * edit, with no settlement orphaned or duplicated.
 */

import { PostgresRequestTombstones } from "../../packages/backend/modules/governance/adapters/postgres/request_tombstones.ts";
import { PostgresGiftAttachmentBoundary } from "../../packages/backend/modules/files/adapters/postgres/gift_attachment_boundary.ts";
import { PostgresGiftAttachmentTarget } from "../../packages/backend/modules/gifts/adapters/postgres/gift_attachment_target.ts";
import { PostgresGiftRepository } from "../../packages/backend/modules/gifts/adapters/postgres/gift_repository.ts";
import { PostgresRecurringDebtRepository } from "../../packages/backend/modules/gifts/adapters/postgres/recurring_debt_repository.ts";
import {
  createGiftManagement,
  giftAuditFrom,
} from "../../packages/backend/modules/gifts/public.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import { PostgresPeopleTransaction } from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import { PostgresWorkspaceCurrencyBoundary } from "../../packages/backend/modules/workspaces/adapters/postgres/currency_boundary.ts";
import { PostgresWorkspaceCalendarBoundary } from "../../packages/backend/modules/workspaces/adapters/postgres/workspace_calendar.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import {
  type HttpMethod,
  PASSWORD,
  sessionCookie,
  type SignedInFixture,
} from "../support/api.ts";
import { requireDatabaseUrl, revocableActor } from "../support/database.ts";
import { composeTokenSuite } from "../support/tokens.ts";
import { holdWorkspaceWrites } from "../support/workspace_write_queue.ts";

const suite = composeTokenSuite();
const { api, register, sql, tokens } = suite;

async function expect<T = Record<string, unknown>>(
  response: Response,
  status: number,
  label: string,
): Promise<T> {
  const text = await response.text();
  assert(
    response.status === status,
    `${label}: expected ${status}, received ${response.status}: ${text}`,
  );
  return (text ? JSON.parse(text) : {}) as T;
}

/** The problem code a refusal carries. */
async function refused(
  response: Response,
  status: number,
  code: string,
  label: string,
): Promise<void> {
  const body = await expect<{ code?: string }>(response, status, label);
  assertEquals(body.code, code, label);
}

async function person(
  fixture: SignedInFixture,
  givenName: string,
): Promise<string> {
  const response = await api.request(fixture, "/api/v1/people", "POST", {
    givenName,
    isPartial: false,
  });
  assert(response.status === 201, `${givenName} created`);
  return (await response.json()).person.id as string;
}

/** An available stored file, linked to the person as a photo when asked. */
async function storedFile(
  fixture: SignedInFixture,
  photoOf?: string,
): Promise<string> {
  const fileId = crypto.randomUUID();
  await sql`insert into crm.files (
      id, workspace_id, uploaded_by_member_id, original_filename,
      storage_provider, storage_bucket, storage_key, byte_size, mime_type,
      status, visibility
    ) values (
      ${fileId}::uuid, ${fixture.workspaceId}::uuid, ${fixture.memberId}::uuid,
      'gift.png', 'test', 'test', ${fileId}, 4, 'image/png', 'available',
      'private'
    )`;
  if (photoOf) {
    await sql`insert into crm.person_file_links
        (person_id, file_id, kind, workspace_id)
      values (${photoOf}::uuid, ${fileId}::uuid, 'photo',
        ${fixture.workspaceId}::uuid)`;
  }
  return fileId;
}

interface Gift {
  readonly amount?: string;
  readonly attachmentFileId?: string;
  readonly comment?: string;
  readonly currencyCode?: string;
  readonly eventAt?: string;
  readonly id: string;
  readonly name: string;
  readonly recipientPersonId?: string;
  readonly status: string;
  readonly updatedAt: string;
  readonly url?: string;
}

interface Debt {
  readonly amount: string;
  readonly currencyCode?: string;
  readonly direction: string;
  readonly id: string;
  readonly reason?: string;
  readonly recurringDebtId?: string;
  readonly status: string;
  readonly updatedAt: string;
}

interface RecurringDebt {
  readonly id: string;
  readonly updatedAt: string;
}

interface Listing {
  readonly debts: readonly Debt[];
  readonly gifts: readonly Gift[];
  readonly recurringDebts: readonly RecurringDebt[];
}

/** Every gift, debt, rule, link, and settlement of a person, as stored. */
async function snapshot(personId: string): Promise<string> {
  const [row] = await sql<Record<string, unknown>[]>`select
      (select string_agg(concat_ws('|', id, name, amount, currency_code,
          comment, url, recipient_person_id, event_at, status, updated_at),
          ',' order by id)
        from crm.gifts where person_id = ${personId}::uuid) as gifts,
      (select string_agg(concat_ws('|', link.gift_id, link.file_id), ','
          order by link.gift_id, link.file_id)
        from crm.gift_file_links link
        join crm.gifts gift on gift.id = link.gift_id
        where gift.person_id = ${personId}::uuid) as links,
      (select string_agg(concat_ws('|', id, amount, currency_code, direction,
          reason, status, updated_at), ',' order by id)
        from crm.debts where person_id = ${personId}::uuid) as debts,
      (select string_agg(concat_ws('|', id, amount, is_active, updated_at), ','
          order by id)
        from crm.recurring_debts where person_id = ${personId}::uuid)
        as recurring,
      (select string_agg(settlement.id::text, ',' order by settlement.id)
        from crm.debt_settlements settlement
        join crm.debts debt on debt.id = settlement.debt_id
        where debt.person_id = ${personId}::uuid) as settlements`;
  return JSON.stringify(row);
}

async function auditTokens(subjectId: string): Promise<string[]> {
  const rows = await sql<{ action: string; token: string | null }[]>`
    select payload->>'action' as action, payload->>'apiTokenId' as token
    from crm.audit_events where subject_id = ${subjectId}::uuid
    order by occurred_at, id`;
  return rows.map((row) => `${row.action}:${row.token ?? "cookie"}`);
}

const STALE = "2020-01-01T00:00:00.000Z";

Deno.test("[MCP-D3] PostgreSQL edits and deletes a gift by cookie without touching its file", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`gift-edit-${suffix}@example.test`, "Gift edits");
  const foreign = await register(
    `gift-edit-foreign-${suffix}@example.test`,
    "Foreign gift edits",
  );
  const personId = await person(own, "Ada");
  const otherPersonId = await person(own, "Lin");
  const recipientId = await person(own, "Grace");
  const foreignPersonId = await person(foreign, "Outsider");
  const firstFile = await storedFile(own, personId);
  const secondFile = await storedFile(own, personId);
  const foreignFile = await storedFile(foreign);
  const root = `/api/v1/people/${personId}`;
  const send = (path: string, method: HttpMethod, body?: unknown) =>
    api.request(own, path, method, body);

  const { gift } = await expect<{ gift: Gift }>(
    await send(`${root}/gifts`, "POST", {
      attachmentFileId: firstFile,
      name: `Book ${suffix}`,
      recipientPersonId: recipientId,
      status: "idea",
    }),
    201,
    "a cookie creates a gift without a retry key",
  );
  const path = `${root}/gifts/${gift.id}`;
  const unchangedBefore = await snapshot(personId);
  for (
    const [body, status, code, label] of [
      [{ expectedUpdatedAt: STALE, name: "Late" }, 409, "gift_stale", "stale"],
      [
        {
          expectedUpdatedAt: gift.updatedAt,
          recipientPersonId: foreignPersonId,
        },
        404,
        "gift_not_found",
        "foreign recipient",
      ],
      [
        {
          attachmentFileId: foreignFile,
          expectedUpdatedAt: gift.updatedAt,
        },
        404,
        "gift_not_found",
        "foreign file",
      ],
      [
        {
          amount: "30",
          currencyCode: "XXX",
          expectedUpdatedAt: gift.updatedAt,
        },
        400,
        "gift_invalid",
        "unsupported currency",
      ],
      [
        { amount: "30", expectedUpdatedAt: gift.updatedAt },
        400,
        "gift_invalid",
        "amount alone",
      ],
    ] as const
  ) {
    await refused(await send(path, "PATCH", body), status, code, label);
  }
  await refused(
    await send(`/api/v1/people/${otherPersonId}/gifts/${gift.id}`, "PATCH", {
      expectedUpdatedAt: gift.updatedAt,
      name: "Wrong person",
    }),
    404,
    "gift_not_found",
    "a gift under the wrong person path",
  );
  assertEquals(
    await snapshot(personId),
    unchangedBefore,
    "refusals wrote nothing",
  );

  const edited = await expect<{ gift: Gift; status: string }>(
    await send(path, "PATCH", {
      amount: "42.5",
      attachmentFileId: secondFile,
      comment: "Wrapped",
      currencyCode: "eur",
      eventAt: "2026-12-24T18:00:00+01:00",
      expectedUpdatedAt: gift.updatedAt,
      name: `Novel ${suffix}`,
      url: "https://example.test/novel",
    }),
    200,
    "a cookie edits the gift's values",
  );
  assertEquals(edited.status, "saved");
  assertEquals(
    [
      edited.gift.name,
      edited.gift.amount,
      edited.gift.currencyCode,
      edited.gift.comment,
      edited.gift.attachmentFileId,
      edited.gift.recipientPersonId,
      edited.gift.status,
      Date.parse(edited.gift.eventAt ?? ""),
    ],
    [
      `Novel ${suffix}`,
      "42.5000",
      "EUR",
      "Wrapped",
      secondFile,
      recipientId,
      "idea",
      Date.parse("2026-12-24T17:00:00Z"),
    ],
  );
  const listed = await expect<Listing>(
    await send(`${root}/gifts`, "GET"),
    200,
    "the list shows the edit",
  );
  const shown = listed.gifts.find((entry) => entry.id === gift.id);
  assertEquals(shown?.updatedAt, edited.gift.updatedAt, "revision exposed");
  assertEquals(shown?.attachmentFileId, secondFile);
  const replayed = await expect<{ status: string }>(
    await send(path, "PATCH", {
      expectedUpdatedAt: edited.gift.updatedAt,
      name: `Novel ${suffix}`,
    }),
    200,
    "an edit that changes nothing",
  );
  assertEquals(replayed.status, "unchanged");
  const cleared = await expect<{ gift: Gift }>(
    await send(path, "PATCH", {
      amount: null,
      comment: null,
      currencyCode: null,
      eventAt: null,
      expectedUpdatedAt: edited.gift.updatedAt,
      recipientPersonId: null,
      url: null,
    }),
    200,
    "null clears every optional value",
  );
  assertEquals(
    [
      cleared.gift.amount,
      cleared.gift.currencyCode,
      cleared.gift.comment,
      cleared.gift.eventAt,
      cleared.gift.recipientPersonId,
      cleared.gift.url,
      cleared.gift.attachmentFileId,
    ],
    [
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      secondFile,
    ],
  );

  // Deleting a gift needs its current revision and keeps the file.
  await refused(
    await send(path, "DELETE", { expectedUpdatedAt: edited.gift.updatedAt }),
    409,
    "gift_stale",
    "a stale delete",
  );
  await refused(
    await api.request(foreign, path, "DELETE", {
      expectedUpdatedAt: cleared.gift.updatedAt,
    }),
    404,
    "gift_not_found",
    "another workspace cannot delete it",
  );
  assert(
    (await sql`select 1 from crm.gifts where id = ${gift.id}::uuid`).length ===
      1,
    "refused deletes kept the gift",
  );
  const deleted = await expect<{ giftId: string; status: string }>(
    await send(path, "DELETE", { expectedUpdatedAt: cleared.gift.updatedAt }),
    200,
    "a cookie deletes the gift",
  );
  assertEquals(deleted, { giftId: gift.id, status: "deleted" });
  assertEquals(
    (await sql`select 1 from crm.gifts where id = ${gift.id}::uuid`).length,
    0,
  );
  assertEquals(
    (await sql`select 1 from crm.gift_file_links where gift_id = ${gift.id}::uuid`)
      .length,
    0,
    "the link went with the gift",
  );
  const [file] = await sql<{ status: string; deleted_at: Date | null }[]>`
    select status, deleted_at from crm.files where id = ${secondFile}::uuid`;
  assertEquals([file?.status, file?.deleted_at], ["available", null]);
  const files = await expect<{ files: { fileId: string }[] }>(
    await send(`${root}/files`, "GET"),
    200,
    "the person's files still list",
  );
  assert(
    files.files.some((entry) => entry.fileId === secondFile) &&
      files.files.some((entry) => entry.fileId === firstFile),
    "both files are still the person's",
  );
  await refused(
    await send(path, "DELETE", { expectedUpdatedAt: cleared.gift.updatedAt }),
    404,
    "gift_not_found",
    "a deleted gift is gone",
  );
  assertEquals(await auditTokens(gift.id), [
    "created:cookie",
    "changed:cookie",
    "changed:cookie",
    "deleted:cookie",
  ]);

  // Omitting the new fields keeps every old cookie behavior.
  const twice = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    twice.push(
      (await expect<{ gift: Gift }>(
        await send(`${root}/gifts`, "POST", { name: "Twice", status: "idea" }),
        201,
        "a create without a retry key",
      )).gift.id,
    );
  }
  assert(twice[0] !== twice[1], "two creates without a key: two gifts");
  const moved = await expect<{ gift: Gift }>(
    await send(`${root}/gifts/${twice[0]}/status`, "PATCH", {
      status: "planned",
    }),
    200,
    "an unversioned status change still applies",
  );
  assertEquals(moved.gift.status, "planned");
});

Deno.test("[MCP-D3] PostgreSQL debt edits follow the settlement rule and recurring charges are ordinary debts", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`debt-edit-${suffix}@example.test`, "Debt edits");
  const personId = await person(own, "Ada");
  const root = `/api/v1/people/${personId}`;
  const send = (path: string, method: HttpMethod, body?: unknown) =>
    api.request(own, path, method, body);
  const { debt } = await expect<{ debt: Debt }>(
    await send(`${root}/debts`, "POST", {
      amount: "20",
      currencyCode: "EUR",
      direction: "they_owe",
      reason: "Lunch",
      status: "open",
    }),
    201,
    "a debt",
  );
  const path = `${root}/debts/${debt.id}`;
  const edited = await expect<{ debt: Debt }>(
    await send(path, "PATCH", {
      amount: "25",
      direction: "i_owe",
      expectedUpdatedAt: debt.updatedAt,
      reason: null,
    }),
    200,
    "an open, never settled debt changes its money",
  );
  assertEquals(
    [edited.debt.amount, edited.debt.direction, edited.debt.reason],
    ["25.0000", "i_owe", undefined],
  );
  const settled = await expect<{ debt: Debt }>(
    await send(`${path}/status`, "PATCH", {
      expectedUpdatedAt: edited.debt.updatedAt,
      settlementReason: "Cash",
      status: "settled",
    }),
    200,
    "a versioned settle",
  );
  const reopened = await expect<{ debt: Debt }>(
    await send(`${path}/status`, "PATCH", { status: "open" }),
    200,
    "an unversioned reopen",
  );
  const history = await snapshot(personId);
  await refused(
    await send(path, "PATCH", {
      amount: "30",
      expectedUpdatedAt: reopened.debt.updatedAt,
    }),
    409,
    "debt_values_locked",
    "a reopened debt keeps what was settled",
  );
  await refused(
    await send(`${path}/status`, "PATCH", {
      expectedUpdatedAt: settled.debt.updatedAt,
      status: "settled",
    }),
    409,
    "gift_stale",
    "a stale settle",
  );
  assertEquals(await snapshot(personId), history, "no settlement appended");
  const reason = await expect<{ debt: Debt }>(
    await send(path, "PATCH", {
      expectedUpdatedAt: reopened.debt.updatedAt,
      reason: "Dinner",
    }),
    200,
    "the reason stays editable",
  );
  assertEquals(reason.debt.reason, "Dinner");
  const settlements = await expect<{ settlements: unknown[] }>(
    await send(`${path}/settlements`, "GET"),
    200,
    "history read",
  );
  assertEquals(settlements.settlements.length, 1, "history intact");

  // A charged debt is an ordinary debt once charged.
  const rule = await expect<{ charged: number; recurringDebt: RecurringDebt }>(
    await send(`${root}/recurring-debts`, "POST", {
      amount: "500",
      currencyCode: "EUR",
      dayOfMonth: 1,
      direction: "they_owe",
      intervalMonths: 1,
      startsOn: "2026-01-01",
    }),
    201,
    "a rule that charges at once",
  );
  assert(rule.charged >= 2, `charged ${rule.charged}`);
  const listed = await expect<Listing>(
    await send(`${root}/gifts?limit=50`, "GET"),
    200,
    "charged debts listed",
  );
  const charged = listed.debts.filter((entry) =>
    entry.recurringDebtId === rule.recurringDebt.id
  );
  assertEquals(charged.length, rule.charged);
  const [first] = charged;
  const changedCharge = await expect<{ debt: Debt }>(
    await send(`${root}/debts/${first!.id}`, "PATCH", {
      amount: "450",
      expectedUpdatedAt: first!.updatedAt,
      reason: "Discounted month",
    }),
    200,
    "a charged debt is edited like any debt",
  );
  assertEquals(changedCharge.debt.recurringDebtId, rule.recurringDebt.id);
  await refused(
    await send(`${root}/recurring-debts/${rule.recurringDebt.id}`, "PATCH", {
      amount: "550",
      expectedUpdatedAt: STALE,
    }),
    409,
    "gift_stale",
    "a stale rule change",
  );
  await expect(
    await send(`${root}/recurring-debts/${rule.recurringDebt.id}`, "PATCH", {
      amount: "550",
      expectedUpdatedAt: rule.recurringDebt.updatedAt,
    }),
    200,
    "a current rule change",
  );
  const [stored] = await sql<{ amount: string; reason: string }[]>`
    select amount::text, reason from crm.debts where id = ${first!.id}::uuid`;
  assertEquals([stored?.amount, stored?.reason], [
    "450.0000",
    "Discounted month",
  ]);
  const [count] = await sql<{ count: number }[]>`
    select count(*)::int as count from crm.debts
    where recurring_debt_id = ${rule.recurringDebt.id}::uuid`;
  assertEquals(count?.count, rule.charged, "no period charged again");
});

Deno.test("[MCP-D3] PostgreSQL token creates are retry-safe, revisions are checked, and races stay consistent", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`gift-retry-${suffix}@example.test`, "Retries");
  const foreign = await register(
    `gift-retry-foreign-${suffix}@example.test`,
    "Foreign retries",
  );
  const personId = await person(own, "Ada");
  const otherPersonId = await person(own, "Lin");
  const foreignPersonId = await person(foreign, "Outsider");
  const photoId = await storedFile(own, personId);
  const writer = await tokens.mint(own, ["gifts:write"]);
  const reader = await tokens.mint(own, ["gifts:read"]);
  const unrelated = await tokens.mint(own, ["people:write"]);
  const foreignWriter = await tokens.mint(foreign, ["gifts:write"]);
  const send = (
    path: string,
    method: HttpMethod,
    body?: unknown,
    secret = writer.secret,
  ) => tokens.bearer(secret, path, { body, method });
  const root = `/api/v1/people/${personId}`;

  // Two concurrent creates with one key: one gift, both answered 201.
  const giftKey = crypto.randomUUID();
  const giftBody = {
    amount: "10",
    currencyCode: "EUR",
    name: `Scarf ${suffix}`,
    requestId: giftKey,
    status: "idea",
  };
  const [first, second] = await Promise.all([
    send(`${root}/gifts`, "POST", giftBody),
    send(`${root}/gifts`, "POST", giftBody),
  ]);
  const one = await expect<{ gift: Gift }>(first, 201, "first concurrent");
  const two = await expect<{ gift: Gift }>(second, 201, "second concurrent");
  assertEquals(one.gift.id, two.gift.id, "one gift for one key");
  const [giftRows] = await sql<{ count: number }[]>`
    select count(*)::int as count from crm.gifts
    where person_id = ${personId}::uuid`;
  assertEquals(giftRows?.count, 1);
  const replay = await expect<{ gift: Gift }>(
    await send(`${root}/gifts`, "POST", { ...giftBody, amount: "10.00" }),
    201,
    "a later replay returns the original",
  );
  assertEquals(replay.gift, one.gift);
  await refused(
    await send(`${root}/gifts`, "POST", { ...giftBody, name: "Other" }),
    409,
    "gift_request_conflict",
    "the key with another payload",
  );
  await refused(
    await send(`/api/v1/people/${otherPersonId}/gifts`, "POST", giftBody),
    409,
    "gift_request_conflict",
    "the key for another person",
  );

  // The new routes need gifts:write and nothing else admits them.
  const giftPath = `${root}/gifts/${one.gift.id}`;
  for (const secret of [reader.secret, unrelated.secret]) {
    for (
      const [path, method, body] of [
        [giftPath, "PATCH", {
          expectedUpdatedAt: one.gift.updatedAt,
          name: "x",
        }],
        [giftPath, "DELETE", { expectedUpdatedAt: one.gift.updatedAt }],
      ] as const
    ) {
      await expect(
        await send(path, method, body, secret),
        401,
        `${method} refused without gifts:write`,
      );
    }
  }
  const before = await snapshot(personId);
  await refused(
    await send(
      giftPath,
      "PATCH",
      { expectedUpdatedAt: one.gift.updatedAt, name: "Taken" },
      foreignWriter.secret,
    ),
    404,
    "gift_not_found",
    "a foreign token cannot reach the gift",
  );
  await refused(
    await send(
      `/api/v1/people/${foreignPersonId}/gifts/${one.gift.id}`,
      "PATCH",
      {
        expectedUpdatedAt: one.gift.updatedAt,
        name: "Taken",
      },
    ),
    404,
    "gift_not_found",
    "a foreign person path",
  );
  const foreignFile = await storedFile(foreign);
  for (
    const [field, value] of [
      ["recipientPersonId", foreignPersonId],
      ["attachmentFileId", foreignFile],
    ] as const
  ) {
    await refused(
      await send(giftPath, "PATCH", {
        expectedUpdatedAt: one.gift.updatedAt,
        [field]: value,
      }),
      404,
      "gift_not_found",
      `a token edit naming a foreign ${field}`,
    );
  }
  await refused(
    await send(`${giftPath}/status`, "PATCH", {
      expectedUpdatedAt: STALE,
      status: "given",
    }),
    409,
    "gift_stale",
    "a stale gift status change",
  );
  assertEquals(await snapshot(personId), before, "nothing changed");
  const edited = await expect<{ gift: Gift }>(
    await send(giftPath, "PATCH", {
      expectedUpdatedAt: one.gift.updatedAt,
      name: `Wool scarf ${suffix}`,
    }),
    200,
    "gifts:write edits the gift",
  );
  await refused(
    await send(`${root}/gifts`, "POST", giftBody),
    409,
    "gift_request_conflict",
    "a replay after an edit no longer matches",
  );
  await expect(
    await send(giftPath, "DELETE", {
      expectedUpdatedAt: edited.gift.updatedAt,
    }),
    200,
    "gifts:write deletes the gift",
  );
  await refused(
    await send(`${root}/gifts`, "POST", giftBody),
    409,
    "gift_request_deleted",
    "a replay after the delete does not resurrect it",
  );
  assertEquals(
    (await sql`select 1 from crm.gifts where id = ${one.gift.id}::uuid`).length,
    0,
  );
  assertEquals(await auditTokens(one.gift.id), [
    `created:${writer.record.id}`,
    `changed:${writer.record.id}`,
    `deleted:${writer.record.id}`,
  ]);
  assertEquals(await tombstoneOf(own.workspaceId, one.gift.id), "gift");
  // The refusal is the tombstone's, not the audit history's (MCP-E3): with
  // the gift's events gone the replay is still refused.
  await sql`delete from crm.audit_events where subject_id = ${one.gift.id}::uuid`;
  await refused(
    await send(`${root}/gifts`, "POST", giftBody),
    409,
    "gift_request_deleted",
    "a replay after the history is pruned",
  );

  // A settled debt retried concurrently settles once.
  const debtKey = crypto.randomUUID();
  const debtBody = {
    amount: "15",
    currencyCode: "EUR",
    direction: "they_owe",
    requestId: debtKey,
    settlementPhotoFileId: photoId,
    settlementReason: "Cash",
    status: "settled",
  };
  const debts = await Promise.all([
    send(`${root}/debts`, "POST", debtBody),
    send(`${root}/debts`, "POST", debtBody),
  ]);
  const settled = await expect<{ debt: Debt }>(debts[0]!, 201, "debt one");
  const again = await expect<{ debt: Debt }>(debts[1]!, 201, "debt two");
  assertEquals(settled.debt.id, again.debt.id);
  const [settlementCount] = await sql<{ count: number }[]>`
    select count(*)::int as count from crm.debt_settlements
    where debt_id = ${settled.debt.id}::uuid`;
  assertEquals(settlementCount?.count, 1, "settled once");
  await refused(
    await send(`${root}/debts`, "POST", {
      ...debtBody,
      settlementReason: "Card",
    }),
    409,
    "gift_request_conflict",
    "a debt key with another settlement",
  );
  await expect(
    await send(`${root}/debts/${settled.debt.id}`, "DELETE"),
    200,
    "the debt is deleted",
  );
  await refused(
    await send(`${root}/debts`, "POST", debtBody),
    409,
    "gift_request_deleted",
    "a deleted debt is not recreated",
  );
  assertEquals(await tombstoneOf(own.workspaceId, settled.debt.id), "debt");

  // A rule retried concurrently charges its due periods once.
  const ruleKey = crypto.randomUUID();
  const ruleBody = {
    amount: "100",
    currencyCode: "EUR",
    dayOfMonth: 1,
    direction: "i_owe",
    intervalMonths: 1,
    requestId: ruleKey,
    startsOn: "2026-01-01",
  };
  const rules = await Promise.all([
    send(`${root}/recurring-debts`, "POST", ruleBody),
    send(`${root}/recurring-debts`, "POST", ruleBody),
  ]);
  const created = await Promise.all(
    rules.map((response, index) =>
      expect<{ charged: number; recurringDebt: RecurringDebt }>(
        response,
        201,
        `rule ${index}`,
      )
    ),
  );
  assertEquals(created[0]!.recurringDebt.id, created[1]!.recurringDebt.id);
  const charged = created[0]!.charged + created[1]!.charged;
  assert(charged >= 2, `the first attempt charged ${charged}`);
  assert(
    created.some((entry) => entry.charged === 0),
    "the retry charged nothing",
  );
  const ruleId = created[0]!.recurringDebt.id;
  const [ruleDebts] = await sql<{ count: number }[]>`
    select count(*)::int as count from crm.debts
    where recurring_debt_id = ${ruleId}::uuid`;
  assertEquals(ruleDebts?.count, charged, "each period charged once");
  await expect(
    await send(`${root}/recurring-debts/${ruleId}`, "DELETE"),
    200,
    "the rule is deleted",
  );
  await refused(
    await send(`${root}/recurring-debts`, "POST", ruleBody),
    409,
    "gift_request_deleted",
    "a deleted rule is not recreated and charges nothing",
  );
  assertEquals(await tombstoneOf(own.workspaceId, ruleId), "recurring_debt");
  const [kept] = await sql<{ count: number }[]>`
    select count(*)::int as count from crm.debts
    where person_id = ${personId}::uuid and direction = 'i_owe'`;
  assertEquals(kept?.count, charged, "its charges stay, none added");

  // A settle racing an edit of the same revision: one wins, one is stale.
  const { debt: raced } = await expect<{ debt: Debt }>(
    await send(`${root}/debts`, "POST", {
      amount: "40",
      currencyCode: "EUR",
      direction: "they_owe",
      status: "open",
    }),
    201,
    "a debt to race over",
  );
  const racePath = `${root}/debts/${raced.id}`;
  const [settle, edit] = await Promise.all([
    send(`${racePath}/status`, "PATCH", {
      expectedUpdatedAt: raced.updatedAt,
      status: "settled",
    }),
    send(racePath, "PATCH", {
      amount: "45",
      expectedUpdatedAt: raced.updatedAt,
    }),
  ]);
  const outcomes = [settle.status, edit.status].sort();
  assertEquals(outcomes, [200, 409], `race answered ${outcomes}`);
  const [final] = await sql<{ amount: string; status: string }[]>`
    select amount::text, status from crm.debts where id = ${raced.id}::uuid`;
  const [raceSettlements] = await sql<{ count: number }[]>`
    select count(*)::int as count from crm.debt_settlements
    where debt_id = ${raced.id}::uuid`;
  if (settle.status === 200) {
    assertEquals(
      [final?.amount, final?.status, raceSettlements?.count],
      ["40.0000", "settled", 1],
    );
    assertEquals((await edit.json()).code, "gift_stale");
  } else {
    assertEquals(
      [final?.amount, final?.status, raceSettlements?.count],
      ["45.0000", "open", 0],
    );
    assertEquals((await settle.json()).code, "gift_stale");
  }
  const changedDebt = await expect<{ debt: Debt }>(
    await send(racePath, "PATCH", {
      expectedUpdatedAt: (await expect<Listing>(
        await send(`${root}/gifts?limit=50`, "GET", undefined, reader.secret),
        200,
        "the reader sees the revision",
      )).debts.find((entry) => entry.id === raced.id)!.updatedAt,
      reason: "Settled up",
    }),
    200,
    "an edit at the current revision",
  );
  assertEquals(changedDebt.debt.reason, "Settled up");
  assert(
    (await auditTokens(raced.id)).every((entry) =>
      entry.endsWith(writer.record.id)
    ),
    "every token write names its token",
  );
});

Deno.test("[MCP-D3] PostgreSQL an unconditional settle racing a fresh edit never settles a debt whose amount then changes", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`gift-settle-${suffix}@example.test`, "Settles");
  const personId = await person(own, "Ada");
  const root = `/api/v1/people/${personId}`;
  for (let round = 0; round < 6; round++) {
    const { debt } = await expect<{ debt: Debt }>(
      await api.request(own, `${root}/debts`, "POST", {
        amount: "40",
        currencyCode: "EUR",
        direction: "they_owe",
        status: "open",
      }),
      201,
      `round ${round}: a debt to race over`,
    );
    const path = `${root}/debts/${debt.id}`;
    // The settle names no revision, so only the row lock and the settlement
    // history re-check stand between it and the edit.
    const [settle, edit] = await Promise.all([
      api.request(own, `${path}/status`, "PATCH", { status: "settled" }),
      api.request(own, path, "PATCH", {
        amount: "45",
        expectedUpdatedAt: debt.updatedAt,
      }),
    ]);
    const settled = await expect<{ debt: Debt }>(
      settle,
      200,
      `round ${round}: the unconditional settle`,
    );
    const [stored] = await sql<
      { amount: string; settlements: number; status: string }[]
    >`select debt.amount::text, debt.status,
        (select count(*)::int from crm.debt_settlements settlement
          where settlement.debt_id = debt.id) as settlements
      from crm.debts debt where debt.id = ${debt.id}::uuid`;
    const audit = await auditTokens(debt.id);
    if (edit.status === 200) {
      // The edit ran first, on the open debt, and the settle settled its
      // amount.
      const edited = await expect<{ debt: Debt }>(edit, 200, "edit first");
      assertEquals(edited.debt.status, "open", `round ${round}`);
      assertEquals(settled.debt.amount, "45.0000", `round ${round}`);
      assertEquals(audit, [
        "created:cookie",
        "changed:cookie",
        "changed:cookie",
      ]);
    } else {
      // The settle ran first and moved the revision the edit was read at.
      await refused(edit, 409, "gift_stale", `round ${round}: edit after`);
      assertEquals(settled.debt.amount, "40.0000", `round ${round}`);
      assertEquals(audit, ["created:cookie", "changed:cookie"]);
    }
    assertEquals(
      [stored?.amount, stored?.status, stored?.settlements],
      [settled.debt.amount, "settled", 1],
      `round ${round}: one settlement of the amount the debt still has`,
    );
  }
});

/** The kind a record's request tombstone names, if it left one (MCP-E3). */
async function tombstoneOf(
  workspaceId: string,
  recordId: string,
): Promise<string | undefined> {
  const [row] = await sql<{ record_type: string }[]>`
    select record_type from crm.request_tombstones
    where workspace_id = ${workspaceId}::uuid
      and record_id = ${recordId}::uuid`;
  return row?.record_type;
}

/**
 * A gift's delete and its create's replay, queued on the workspace row in both
 * orders (MCP-E3): the replay that runs first returns the gift, which the
 * delete then removes; the replay that runs second is refused. Neither order
 * records the gift again.
 */
Deno.test("[MCP-E3] PostgreSQL a gift delete racing its create's replay never records the gift again", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`gift-race-${suffix}@example.test`, "Gift race");
  const personId = await person(own, "Ada");
  const writer = await tokens.mint(own, ["gifts:write"]);
  const root = `/api/v1/people/${personId}/gifts`;
  for (const first of ["delete", "replay"] as const) {
    const body = {
      name: `Raced lamp ${first} ${suffix}`,
      requestId: crypto.randomUUID(),
      status: "idea",
    };
    const { gift } = await expect<{ gift: Gift }>(
      await tokens.bearer(writer.secret, root, { body, method: "POST" }),
      201,
      "the keyed create",
    );
    const remove = () =>
      tokens.bearer(writer.secret, `${root}/${gift.id}`, {
        body: { expectedUpdatedAt: gift.updatedAt },
        method: "DELETE",
      });
    const replay = () =>
      tokens.bearer(writer.secret, root, { body, method: "POST" });
    const queue = await holdWorkspaceWrites(sql, own.workspaceId);
    let deleted: Promise<Response>;
    let replayed: Promise<Response>;
    try {
      if (first === "delete") {
        deleted = remove();
        await queue.queued(1);
        replayed = replay();
        await queue.queued(2);
      } else {
        replayed = replay();
        await queue.queued(1);
        deleted = remove();
        await queue.queued(2);
      }
    } finally {
      await queue.release();
    }
    await expect(await deleted!, 200, `${first} first: the delete`);
    if (first === "delete") {
      await refused(
        await replayed!,
        409,
        "gift_request_deleted",
        "the later replay",
      );
    } else {
      const returned = await expect<{ gift: Gift }>(
        await replayed!,
        201,
        "the earlier replay",
      );
      assertEquals(returned.gift.id, gift.id, "it returned the gift");
    }
    assertEquals(
      (await sql`select 1 from crm.gifts where id = ${gift.id}::uuid`).length,
      0,
      `${first} first: the gift is gone`,
    );
  }
});

Deno.test("[MCP-E3] PostgreSQL a workspace reset removes the request tombstones, so a replayed key creates its record again", async () => {
  const suffix = crypto.randomUUID();
  const email = `gift-reset-${suffix}@example.test`;
  const own = await register(email, "Reset retries");
  const requestId = crypto.randomUUID();
  const body = { name: `Lamp ${suffix}`, requestId, status: "idea" };
  const firstPerson = await person(own, "Ada");
  const { gift } = await expect<{ gift: Gift }>(
    await api.request(own, `/api/v1/people/${firstPerson}/gifts`, "POST", body),
    201,
    "a keyed create",
  );
  await expect(
    await api.request(
      own,
      `/api/v1/people/${firstPerson}/gifts/${gift.id}`,
      "DELETE",
      { expectedUpdatedAt: gift.updatedAt },
    ),
    200,
    "the gift is deleted",
  );
  await refused(
    await api.request(own, `/api/v1/people/${firstPerson}/gifts`, "POST", body),
    409,
    "gift_request_deleted",
    "before the reset the tombstone refuses the replay",
  );
  const shown = await expect<{
    confirmations: { resetWorkspace: string };
    impactToken: string;
  }>(
    await api.request(own, "/api/v1/settings/workspace-lifecycle"),
    200,
    "the reset preview",
  );
  await expect(
    await api.request(
      own,
      "/api/v1/settings/workspace-lifecycle/reset",
      "POST",
      {
        confirmation: shown.confirmations.resetWorkspace,
        impactToken: shown.impactToken,
        password: PASSWORD,
      },
    ),
    200,
    "the owner resets the workspace",
  );
  assertEquals(
    await tombstoneOf(own.workspaceId, gift.id),
    undefined,
    "the reset removed the gift's tombstone",
  );
  const signedIn = await api.signIn(email, { workspaceId: own.workspaceId });
  const cookie = sessionCookie(signedIn);
  assert(signedIn.status === 200 && cookie, `sign-in ${signedIn.status}`);
  const again = { ...own, cookie };
  const secondPerson = await person(again, "Ada again");
  const recreated = await expect<{ gift: Gift }>(
    await api.request(
      again,
      `/api/v1/people/${secondPerson}/gifts`,
      "POST",
      body,
    ),
    201,
    "after a reset the same key creates the gift again",
  );
  assertEquals(recreated.gift.id, gift.id, "under the id the key derives");
});

/** The revision a row stores, at the precision a client must send back. */
async function storedRevision(
  table: "debts" | "gifts" | "recurring_debts",
  id: string,
): Promise<string | undefined> {
  const [row] = await sql<{ revision: string }[]>`
    select to_char(updated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as revision
    from ${sql(`crm.${table}`)} where id = ${id}::uuid`;
  return row?.revision;
}

Deno.test({
  name:
    "[MCP-D3] PostgreSQL writes at one instant still advance the revision, so a second writer is stale",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(requireDatabaseUrl());
    try {
      const actor = await revocableActor(
        sql,
        `gift-revision-${crypto.randomUUID()}`,
      );
      const personId = actor.personId;
      // One instant for every write: a frozen clock, or callers inside one
      // millisecond.
      const instant = new Date("2026-10-14T10:00:00.000Z");
      const gifts = createGiftManagement({
        actors: new PostgresActorRevalidation(),
        attachments: new PostgresGiftAttachmentBoundary(
          new PostgresGiftAttachmentTarget(),
        ),
        audit: giftAuditFrom(new PostgresAuditEventRecorder()),
        calendar: new PostgresWorkspaceCalendarBoundary(),
        clock: { now: () => new Date(instant) },
        currencies: new PostgresWorkspaceCurrencyBoundary(),
        ids: { next: () => crypto.randomUUID() },
        recurringDebts: new PostgresRecurringDebtRepository(),
        repository: new PostgresGiftRepository(),
        tombstones: new PostgresRequestTombstones(),
        transaction: new PostgresPeopleTransaction(connection.db),
      });
      // Each record's revisions so far: every write must pass the last one.
      const revisions = new Map<string, string>();
      /** Keeps a revision a write answered, after checking it advanced. */
      const advanced = async (
        table: "debts" | "gifts" | "recurring_debts",
        id: string,
        revision: string,
        label: string,
      ) => {
        const previous = revisions.get(id);
        assert(
          previous === undefined || revision > previous,
          `${label}: revision ${revision} does not pass ${previous}`,
        );
        assertEquals(await storedRevision(table, id), revision, label);
        revisions.set(id, revision);
        return revision;
      };

      // A gift's values, then its status.
      const createdGift = await gifts.createGift(actor, personId, {
        name: "Scarf",
        status: "idea",
      });
      if (createdGift.status !== "created") throw new Error(createdGift.status);
      const giftId = createdGift.gift.id;
      const giftCreated = await advanced(
        "gifts",
        giftId,
        createdGift.gift.updatedAt,
        "gift created",
      );
      const firstEdit = await gifts.changeGift(actor, personId, giftId, {
        expectedUpdatedAt: giftCreated,
        name: "Wool scarf",
      });
      if (firstEdit.status !== "saved") throw new Error(firstEdit.status);
      const giftEdited = await advanced(
        "gifts",
        giftId,
        firstEdit.gift.updatedAt,
        "a gift edit at the creating instant",
      );
      assertEquals(
        (await gifts.changeGift(actor, personId, giftId, {
          expectedUpdatedAt: giftCreated,
          name: "Silk scarf",
        })).status,
        "stale",
        "a second gift editor holding the first revision",
      );
      const giftStatus = await gifts.changeGiftStatus(
        actor,
        personId,
        giftId,
        "planned",
        { expectedUpdatedAt: giftEdited },
      );
      if (giftStatus.status !== "saved") throw new Error(giftStatus.status);
      const giftPlanned = await advanced(
        "gifts",
        giftId,
        giftStatus.gift.updatedAt,
        "a gift status change at the same instant",
      );
      assertEquals(
        (await gifts.changeGiftStatus(actor, personId, giftId, "given", {
          expectedUpdatedAt: giftEdited,
        })).status,
        "stale",
        "a second status writer holding the edit's revision",
      );
      assertEquals(
        (await gifts.changeGift(actor, personId, giftId, {
          expectedUpdatedAt: giftEdited,
          name: "Silk scarf",
        })).status,
        "stale",
        "an edit holding the revision before the status change",
      );

      // A debt's values, then a settle that must not follow a stale read.
      const createdDebt = await gifts.createDebt(actor, personId, {
        amount: "40",
        currencyCode: "EUR",
        direction: "they_owe",
        status: "open",
      });
      if (createdDebt.status !== "created") throw new Error(createdDebt.status);
      const debtId = createdDebt.debt.id;
      const debtCreated = await advanced(
        "debts",
        debtId,
        createdDebt.debt.updatedAt,
        "debt created",
      );
      const debtEdit = await gifts.changeDebt(actor, personId, debtId, {
        amount: "45",
        expectedUpdatedAt: debtCreated,
      });
      if (debtEdit.status !== "saved") throw new Error(debtEdit.status);
      const debtEdited = await advanced(
        "debts",
        debtId,
        debtEdit.debt.updatedAt,
        "a debt edit at the creating instant",
      );
      assertEquals(
        (await gifts.changeDebtStatus(
          actor,
          personId,
          debtId,
          "settled",
          {},
          { expectedUpdatedAt: debtCreated },
        )).status,
        "stale",
        "a settle holding the revision before the edit",
      );
      const [unsettled] = await sql<{ count: number }[]>`
        select count(*)::int as count from crm.debt_settlements
        where debt_id = ${debtId}::uuid`;
      assertEquals(unsettled?.count, 0, "a stale settle appends nothing");
      assertEquals(
        (await gifts.changeDebt(actor, personId, debtId, {
          expectedUpdatedAt: debtCreated,
          reason: "Dinner",
        })).status,
        "stale",
        "a second debt editor holding the first revision",
      );
      const settle = await gifts.changeDebtStatus(
        actor,
        personId,
        debtId,
        "settled",
        {},
        { expectedUpdatedAt: debtEdited },
      );
      if (settle.status !== "saved") throw new Error(settle.status);
      const debtSettled = await advanced(
        "debts",
        debtId,
        settle.debt.updatedAt,
        "a settle at the same instant",
      );
      assertEquals(
        (await gifts.changeDebt(actor, personId, debtId, {
          expectedUpdatedAt: debtEdited,
          reason: "Dinner",
        })).status,
        "stale",
        "an edit holding the revision before the settle",
      );
      assertEquals(
        (await gifts.changeDebtStatus(
          actor,
          personId,
          debtId,
          "open",
          {},
          { expectedUpdatedAt: debtEdited },
        )).status,
        "stale",
        "a reopen holding the revision before the settle",
      );
      const [settledOnce] = await sql<
        { amount: string; count: number; status: string }[]
      >`select debt.amount::text, debt.status,
          (select count(*)::int from crm.debt_settlements settlement
            where settlement.debt_id = debt.id) as count
        from crm.debts debt where debt.id = ${debtId}::uuid`;
      assertEquals(
        [settledOnce?.amount, settledOnce?.status, settledOnce?.count],
        ["45.0000", "settled", 1],
      );

      // A recurring rule, where a stale update must charge nothing.
      const createdRule = await gifts.createRecurringDebt(actor, personId, {
        amount: "8",
        currencyCode: "EUR",
        dayOfMonth: 14,
        direction: "i_owe",
        intervalMonths: 1,
        startsOn: "2026-12-14",
      });
      if (createdRule.status !== "created") throw new Error(createdRule.status);
      assertEquals(createdRule.charged, 0);
      const ruleId = createdRule.recurringDebt.id;
      const ruleCreated = await advanced(
        "recurring_debts",
        ruleId,
        createdRule.recurringDebt.updatedAt,
        "rule created",
      );
      const ruleEdit = await gifts.changeRecurringDebt(
        actor,
        personId,
        ruleId,
        { reason: "Rent" },
        { expectedUpdatedAt: ruleCreated },
      );
      if (ruleEdit.status !== "saved") throw new Error(ruleEdit.status);
      const ruleEdited = await advanced(
        "recurring_debts",
        ruleId,
        ruleEdit.recurringDebt.updatedAt,
        "a rule update at the creating instant",
      );
      assertEquals(
        (await gifts.changeRecurringDebt(
          actor,
          personId,
          ruleId,
          { startsOn: "2026-08-14" },
          { expectedUpdatedAt: ruleCreated },
        )).status,
        "stale",
        "a second rule writer holding the first revision",
      );
      const [ruleCharges] = await sql<{ count: number }[]>`
        select count(*)::int as count from crm.debts
        where recurring_debt_id = ${ruleId}::uuid`;
      assertEquals(
        ruleCharges?.count,
        0,
        "a stale rule update charges nothing",
      );

      // Every answered revision is the one the listing hands back.
      const listing = await gifts.list(actor, personId);
      if (listing.status !== "ready") throw new Error(listing.status);
      assertEquals(listing.gifts.map((entry) => entry.updatedAt), [
        giftPlanned,
      ]);
      assertEquals(listing.debts.map((entry) => entry.updatedAt), [
        debtSettled,
      ]);
      assertEquals(listing.recurringDebts.map((entry) => entry.updatedAt), [
        ruleEdited,
      ]);
      const roundTrip = await gifts.changeGift(actor, personId, giftId, {
        comment: "Blue",
        expectedUpdatedAt: listing.gifts[0]!.updatedAt,
      });
      assertEquals(
        roundTrip.status,
        "saved",
        "the listed revision round-trips",
      );
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name: "close MCP-D3 gift edits PostgreSQL fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => suite.close(),
});
