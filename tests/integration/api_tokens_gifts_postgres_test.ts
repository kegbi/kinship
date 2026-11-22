/**
 * MCP-B7: personal tokens read and change gifts and debts through the
 * deployment's real composition.
 *
 * `gifts:read` admits a person's gifts, debts, and recurring debts and a
 * debt's settlement history; `gifts:write` admits the eight writes. Neither
 * grant implies the other, and no unrelated grant admits either. A refused
 * bearer never borrows the cookie, a token never reaches another workspace's
 * records, and an id of another workspace inside a body stores nothing.
 */

import { assert } from "../../packages/backend/testing/assert.ts";
import type { HttpMethod, SignedInFixture } from "../support/api.ts";
import { composeTokenSuite } from "../support/tokens.ts";

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

/** An available stored file, linked to a person as a photo when asked. */
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
      'paid.png', 'test', 'test', ${fileId}, 4, 'image/png', 'available',
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
  readonly attachmentFileId?: string;
  readonly id: string;
  readonly name: string;
  readonly recipientPersonId?: string;
  readonly status: string;
}

interface Debt {
  readonly amount: string;
  readonly id: string;
  readonly recurringDebtId?: string;
  readonly status: string;
}

interface RecurringDebt {
  readonly active: boolean;
  readonly amount: string;
  readonly id: string;
}

interface Listing {
  readonly debts: readonly Debt[];
  readonly gifts: readonly Gift[];
  readonly recurringDebts: readonly RecurringDebt[];
}

interface Settlements {
  readonly settlements: readonly {
    readonly photoFileId?: string;
    readonly reason?: string;
  }[];
}

/**
 * What a person's gifts and debts hold, straight from the tables: every row,
 * its status, and its last change, so a refused write that changed anything
 * shows here.
 */
async function counts(personId: string): Promise<string> {
  const [row] = await sql<Record<string, unknown>[]>`select
      (select string_agg(id || status || updated_at, ',' order by id)
        from crm.gifts where person_id = ${personId}::uuid) as gifts,
      (select string_agg(id || status || updated_at, ',' order by id)
        from crm.debts where person_id = ${personId}::uuid) as debts,
      (select string_agg(id || is_active::text || amount || updated_at, ',' order by id)
        from crm.recurring_debts where person_id = ${personId}::uuid) as recurring,
      (select count(*)::int from crm.debt_settlements settlement
        join crm.debts debt on debt.id = settlement.debt_id
        where debt.person_id = ${personId}::uuid) as settlements`;
  return JSON.stringify(row);
}

Deno.test("[MCP-B7] PostgreSQL gifts and debts admit only their own token grant", async () => {
  const suffix = crypto.randomUUID();
  const own = await register(`gifts-api-${suffix}@example.test`, "Gifts API");
  const foreign = await register(
    `gifts-api-foreign-${suffix}@example.test`,
    "Foreign gifts",
  );
  const personId = await person(own, "Ada");
  const recipientId = await person(own, "Grace");
  const foreignPersonId = await person(foreign, "Outsider");
  const attachmentId = await storedFile(own);
  const photoId = await storedFile(own, personId);
  const foreignFileId = await storedFile(foreign);
  const foreignPhotoId = await storedFile(foreign, foreignPersonId);

  const reader = await tokens.mint(own, ["gifts:read"]);
  const writer = await tokens.mint(own, ["gifts:write"]);
  const unrelated = [
    await tokens.mint(own, ["people:write"]),
    await tokens.mint(own, ["tasks:write"]),
  ];
  const foreignToken = await tokens.mint(foreign, [
    "gifts:read",
    "gifts:write",
  ]);
  const send = (
    secret: string,
    path: string,
    method: HttpMethod = "GET",
    body?: unknown,
  ) => tokens.bearer(secret, path, { body, method });

  const root = `/api/v1/people/${personId}`;
  const list = `${root}/gifts`;

  // gifts:write creates a gift, with a recipient and an attachment, and moves it.
  const { gift } = await expect<{ gift: Gift }>(
    await send(writer.secret, list, "POST", {
      amount: "42.50",
      attachmentFileId: attachmentId,
      currencyCode: "eur",
      name: `Train tickets ${suffix}`,
      recipientPersonId: recipientId,
      status: "idea",
    }),
    201,
    "gifts:write creates a gift",
  );
  assert(
    gift.attachmentFileId === attachmentId &&
      gift.recipientPersonId === recipientId,
    "the gift keeps its attachment and recipient",
  );
  const giftStatus = `${root}/gifts/${gift.id}/status`;
  const planned = await expect<{ gift: Gift; status: string }>(
    await send(writer.secret, giftStatus, "PATCH", { status: "planned" }),
    200,
    "gifts:write moves the gift",
  );
  assert(planned.gift.status === "planned", "the gift is planned");
  await expect(
    await send(writer.secret, giftStatus, "PATCH", { status: "idea" }),
    409,
    "the gift transition graph still applies",
  );

  // gifts:write creates debts, settles one with a photo, and reopens it.
  const debts = `${root}/debts`;
  const { debt } = await expect<{ debt: Debt }>(
    await send(writer.secret, debts, "POST", {
      amount: "12.50",
      currencyCode: "EUR",
      direction: "they_owe",
      reason: `Dinner ${suffix}`,
      status: "open",
    }),
    201,
    "gifts:write creates a debt",
  );
  const { debt: doomed } = await expect<{ debt: Debt }>(
    await send(writer.secret, debts, "POST", {
      amount: "3",
      currencyCode: "EUR",
      direction: "i_owe",
      status: "open",
    }),
    201,
    "gifts:write creates a second debt",
  );
  const debtStatus = `${debts}/${debt.id}/status`;
  const settled = await expect<{ debt: Debt }>(
    await send(writer.secret, debtStatus, "PATCH", {
      settlementPhotoFileId: photoId,
      settlementReason: `Paid back ${suffix}`,
      status: "settled",
    }),
    200,
    "gifts:write settles the debt",
  );
  assert(settled.debt.status === "settled", "the debt is settled");
  const reopened = await expect<{ debt: Debt }>(
    await send(writer.secret, debtStatus, "PATCH", { status: "open" }),
    200,
    "gifts:write reopens the debt",
  );
  assert(reopened.debt.status === "open", "the debt is open again");
  await expect(
    await send(writer.secret, `${debts}/${doomed.id}`, "DELETE"),
    200,
    "gifts:write deletes a debt",
  );

  // gifts:write creates, changes, and deletes recurring debts.
  const recurring = `${root}/recurring-debts`;
  const rule = {
    amount: "500",
    currencyCode: "EUR",
    dayOfMonth: 1,
    direction: "they_owe",
    intervalMonths: 1,
    reason: `Rent ${suffix}`,
    startsOn: "2099-01-01",
  };
  const { recurringDebt } = await expect<{ recurringDebt: RecurringDebt }>(
    await send(writer.secret, recurring, "POST", rule),
    201,
    "gifts:write creates a recurring debt",
  );
  const { recurringDebt: removedRule } = await expect<
    { recurringDebt: RecurringDebt }
  >(
    await send(writer.secret, recurring, "POST", rule),
    201,
    "gifts:write creates a second recurring debt",
  );
  const paused = await expect<{ recurringDebt: RecurringDebt }>(
    await send(writer.secret, `${recurring}/${recurringDebt.id}`, "PATCH", {
      active: false,
      amount: "550",
    }),
    200,
    "gifts:write changes a recurring debt",
  );
  assert(
    !paused.recurringDebt.active && Number(paused.recurringDebt.amount) === 550,
    `the recurring debt is paused at its new amount: ${JSON.stringify(paused)}`,
  );
  await expect(
    await send(writer.secret, `${recurring}/${removedRule.id}`, "DELETE"),
    200,
    "gifts:write deletes a recurring debt",
  );

  // gifts:read sees each effect, settlement history included.
  const seen = await expect<Listing>(
    await send(reader.secret, list),
    200,
    "gifts:read lists gifts and debts",
  );
  assert(
    seen.gifts.some((item) =>
      item.id === gift.id && item.status === "planned" &&
      item.attachmentFileId === attachmentId
    ) &&
      seen.debts.some((item) =>
        item.id === debt.id && item.status === "open"
      ) &&
      !seen.debts.some((item) => item.id === doomed.id) &&
      seen.recurringDebts.length === 1 &&
      seen.recurringDebts[0]?.id === recurringDebt.id &&
      Number(seen.recurringDebts[0]?.amount) === 550,
    `gifts:read sees every write: ${JSON.stringify(seen)}`,
  );
  const history = `${debts}/${debt.id}/settlements`;
  const settlements = await expect<Settlements>(
    await send(reader.secret, history),
    200,
    "gifts:read lists the settlement history",
  );
  assert(
    settlements.settlements.length === 1 &&
      settlements.settlements[0]?.reason === `Paid back ${suffix}` &&
      settlements.settlements[0]?.photoFileId === photoId,
    "the settlement survives reopening with its reason and photo",
  );
  await expect(
    await send(reader.secret, `${debts}/${doomed.id}/settlements`),
    404,
    "a deleted debt has no history left",
  );

  // Every bearer write named its token on its audit event.
  const audit = await sql<
    { action: string; api_token_id: string | null; subject_id: string }[]
  >`select action, subject_id::text, payload->>'apiTokenId' as api_token_id
    from crm.audit_events
    where workspace_id = ${own.workspaceId}::uuid
      and action like 'gifts.%'`;
  for (
    const subject of [
      gift.id,
      debt.id,
      doomed.id,
      recurringDebt.id,
      removedRule.id,
    ]
  ) {
    const events = audit.filter((row) => row.subject_id === subject);
    assert(
      events.length > 0 &&
        events.every((row) => row.api_token_id === writer.record.id),
      `each event for ${subject} names the token: ${JSON.stringify(events)}`,
    );
  }
  assert(
    audit.filter((row) => row.subject_id === debt.id).length === 3 &&
      audit.filter((row) => row.subject_id === gift.id).length === 2 &&
      audit.filter((row) => row.subject_id === recurringDebt.id).length === 2,
    "create, settle, reopen, and status moves were each audited",
  );

  // Grants are independent, and unrelated grants admit nothing here.
  const writes: readonly [HttpMethod, string, unknown][] = [
    ["POST", list, { name: "Denied", status: "idea" }],
    ["PATCH", giftStatus, { status: "given" }],
    ["POST", debts, {
      amount: "1",
      currencyCode: "EUR",
      direction: "i_owe",
      status: "open",
    }],
    ["PATCH", debtStatus, { status: "cancelled" }],
    ["DELETE", `${debts}/${debt.id}`, undefined],
    ["POST", recurring, rule],
    ["PATCH", `${recurring}/${recurringDebt.id}`, { active: true }],
    ["DELETE", `${recurring}/${recurringDebt.id}`, undefined],
  ];
  const reads = [list, history];
  const before = await counts(personId);
  for (const [method, path, body] of writes) {
    await expect(
      await send(reader.secret, path, method, body),
      401,
      `gifts:read ${method} ${path}`,
    );
  }
  for (const path of reads) {
    await expect(
      await send(writer.secret, path),
      401,
      `gifts:write GET ${path}`,
    );
  }
  for (const token of unrelated) {
    for (const [method, path, body] of writes) {
      await expect(
        await send(token.secret, path, method, body),
        401,
        `${token.record.scopes.join()} ${method} ${path}`,
      );
    }
    for (const path of reads) {
      await expect(
        await send(token.secret, path),
        401,
        `${token.record.scopes.join()} GET ${path}`,
      );
    }
  }
  assert(await counts(personId) === before, "no refused write changed a row");

  // Revoked and expired tokens are refused.
  const revoked = await tokens.mint(own, ["gifts:read", "gifts:write"]);
  await expect(
    await api.request(
      own,
      `/api/v1/settings/api-tokens/${revoked.record.id}`,
      "DELETE",
    ),
    200,
    "token revoked through the owning route",
  );
  const expired = await tokens.mint(own, ["gifts:read", "gifts:write"]);
  await sql`update crm.api_tokens set expires_at = now() - interval '1 second'
    where id = ${expired.record.id}::uuid`;
  for (const token of [revoked, expired]) {
    for (const [method, path, body] of writes) {
      await expect(
        await send(token.secret, path, method, body),
        401,
        `unusable token ${method} ${path}`,
      );
    }
    for (const path of reads) {
      await expect(
        await send(token.secret, path),
        401,
        `unusable token ${path}`,
      );
    }
  }
  assert(await counts(personId) === before, "no unusable token changed a row");

  // Another workspace's token reaches none of this workspace's records.
  for (const path of reads) {
    const response = await send(foreignToken.secret, path);
    const text = await response.text();
    assert(
      response.status === 404 && !text.includes(suffix),
      `foreign token on ${path}: ${response.status} ${text}`,
    );
  }
  for (const [method, path, body] of writes) {
    await expect(
      await send(foreignToken.secret, path, method, body),
      404,
      `foreign token ${method} ${path}`,
    );
  }
  await expect(
    await tokens.bearer(writer.secret, list, {
      headers: { "X-Workspace-Id": foreign.workspaceId },
    }),
    401,
    "a token cannot select another workspace",
  );
  assert(
    await counts(personId) === before,
    "no foreign token changed a row",
  );

  // Another workspace's ids inside a body are refused and store nothing.
  for (
    const [label, body] of [
      ["foreign recipient", {
        name: "Foreign recipient",
        recipientPersonId: foreignPersonId,
        status: "idea",
      }],
      ["foreign attachment", {
        attachmentFileId: foreignFileId,
        name: "Foreign attachment",
        status: "idea",
      }],
    ] as const
  ) {
    await expect(
      await send(writer.secret, list, "POST", body),
      404,
      `a ${label} is refused`,
    );
  }
  await expect(
    await send(writer.secret, debts, "POST", {
      amount: "1",
      currencyCode: "EUR",
      direction: "i_owe",
      settlementPhotoFileId: foreignPhotoId,
      status: "settled",
    }),
    404,
    "a foreign settlement photo is refused on create",
  );
  await expect(
    await send(writer.secret, debtStatus, "PATCH", {
      settlementPhotoFileId: foreignPhotoId,
      status: "settled",
    }),
    404,
    "a foreign settlement photo is refused on settle",
  );
  assert(
    await counts(personId) === before,
    "no foreign id stored anything",
  );

  // A present bearer never borrows the cookie; the cookie alone still works.
  for (
    const authorization of [
      "Bearer kin_pat_invalid",
      `Bearer ${reader.secret}`,
      "Basic invalid",
    ]
  ) {
    await expect(
      await tokens.bearer(writer.secret, list, {
        body: { name: "Borrowed", status: "idea" },
        headers: { authorization, cookie: own.cookie },
        method: "POST",
      }),
      401,
      `${authorization.split(" ")[0]} with a cookie on a write`,
    );
    await expect(
      await tokens.bearer(writer.secret, history, {
        headers: {
          authorization: "Bearer kin_pat_invalid",
          cookie: own.cookie,
        },
      }),
      401,
      "an invalid bearer with a cookie on a read",
    );
  }
  assert(await counts(personId) === before, "no borrowed cookie wrote");
  const cookieRead = await api.request(own, list);
  assert(cookieRead.status === 200, "the cookie alone still reads");
  await cookieRead.body?.cancel();
  const cookieWrite = await api.request(own, list, "POST", {
    name: `Cookie gift ${suffix}`,
    status: "idea",
  });
  const cookieGift = await expect<{ gift: Gift }>(
    cookieWrite,
    201,
    "the cookie alone still writes",
  );
  const [cookieEvent] = await sql<{ api_token_id: string | null }[]>`
    select payload->>'apiTokenId' as api_token_id from crm.audit_events
    where subject_id = ${cookieGift.gift.id}::uuid`;
  assert(
    cookieEvent !== undefined && cookieEvent.api_token_id === null,
    "a cookie write names no token",
  );

  // An archived person stays readable and refuses every token write.
  const profile = await (await api.request(own, root)).json();
  await expect(
    await api.request(own, `${root}/archive`, "POST", {
      expectedUpdatedAt: profile.person.updatedAt,
    }),
    200,
    "person archived",
  );
  const archived = await counts(personId);
  for (const [method, path, body] of writes) {
    await expect(
      await send(writer.secret, path, method, body),
      409,
      `archived person refuses ${method} ${path}`,
    );
  }
  for (const path of reads) {
    await expect(
      await send(reader.secret, path),
      200,
      `archived person still reads ${path}`,
    );
  }
  assert(await counts(personId) === archived, "the archived person is intact");
});

Deno.test({
  name: "close MCP-B7 token PostgreSQL fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => suite.close(),
});
