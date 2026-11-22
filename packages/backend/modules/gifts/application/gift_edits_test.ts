/**
 * Gift and debt edits, gift deletion, retry-safe creates, and revision checks
 * on the status changes (MCP-D3), against an in-memory store that keeps the
 * schema's rules: a gift's file links go with it, a settlement history is
 * append-only, and the audit history outlives the rows it describes.
 */

import {
  createGiftManagement,
  type GiftManagementDependencies,
  type StoredDebt,
  type StoredGift,
} from "../public.ts";
import { assert, assertEquals } from "../../../testing/assert.ts";
import { recordingAudit, sequentialIds } from "../../../testing/fakes.ts";
import { giftAuditAction, giftAuditFrom } from "./audit_events.ts";

const actor = {
  memberId: "50000000-0000-4000-8000-000000000001",
  role: "member" as const,
  userId: "50000000-0000-4000-8000-000000000002",
  workspaceId: "50000000-0000-4000-8000-000000000003",
};
const personId = "50000000-0000-4000-8000-000000000004";
const otherPersonId = "50000000-0000-4000-8000-000000000005";
const recipientId = "50000000-0000-4000-8000-000000000006";
const fileId = "50000000-0000-4000-8000-000000000007";
const secondFileId = "50000000-0000-4000-8000-000000000008";
const photoId = "50000000-0000-4000-8000-000000000009";
const requestId = "50000000-0000-4000-8000-0000000000aa";

type Settlement = {
  readonly debtId: string;
  readonly id: string;
  readonly photoFileId?: string;
  readonly photoFilename?: string;
  readonly reason?: string;
  readonly settledAt: string;
};

function fixture(options: { readonly archived?: boolean } = {}) {
  const gifts = new Map<string, StoredGift>();
  const debts = new Map<string, StoredDebt>();
  const settlements: Settlement[] = [];
  const links: { giftId: string; fileId: string }[] = [];
  const audits: {
    action: string;
    recordType: string;
    subjectId: string;
  }[] = [];
  const locks: string[] = [];
  let archived = options.archived ?? false;
  let now = Date.parse("2026-08-23T10:00:00.000Z");
  const clock = { now: () => new Date(now) };
  const tick = () => {
    now += 1000;
  };
  const owned = <T extends { personId: string }>(
    map: Map<string, T>,
    id: string,
    person: string,
  ) => {
    const found = map.get(id);
    return found && found.personId === person ? found : undefined;
  };
  const personState = (person: string) =>
    person === personId || person === otherPersonId
      ? archived ? "archived" as const : "active" as const
      : "not-found" as const;
  const refused = (person: string) => {
    const state = personState(person);
    return state === "archived"
      ? { status: "archived-write-rejected" as const }
      : state === "not-found"
      ? { status: "not-found" as const }
      : undefined;
  };
  const dependencies: GiftManagementDependencies = {
    actors: { revalidate: () => Promise.resolve("active" as const) },
    attachments: {
      validateSettlementPhoto: (command) =>
        Promise.resolve(
          command.fileId === photoId
            ? { filename: "receipt.png", status: "ready" as const }
            : { status: "not-found" as const },
        ),
      availableSettlementPhotos: () => Promise.resolve([photoId]),
      attachToGift: (command) => {
        if (![fileId, secondFileId].includes(command.fileId)) {
          return Promise.resolve({ status: "not-found" as const });
        }
        links.push({ fileId: command.fileId, giftId: command.giftId });
        return Promise.resolve({ status: "attached" as const });
      },
      detachFromGift: (command) => {
        if (!gifts.has(command.giftId)) {
          return Promise.resolve({ status: "not-found" as const });
        }
        for (let index = links.length - 1; index >= 0; index--) {
          if (links[index]!.giftId === command.giftId) links.splice(index, 1);
        }
        return Promise.resolve({ status: "detached" as const });
      },
      validateForGift: (command) =>
        Promise.resolve({
          status: [fileId, secondFileId].includes(command.fileId)
            ? "ready" as const
            : "not-found" as const,
        }),
      listForGifts: (command) =>
        Promise.resolve({
          links: links.filter((link) => command.giftIds.includes(link.giftId)),
          status: "ready" as const,
        }),
    },
    audit: {
      record: (command) => {
        audits.push({
          action: command.action,
          recordType: command.recordType,
          subjectId: command.record.id,
        });
        return Promise.resolve("audit");
      },
      recordCharged: () => Promise.resolve("audit"),
      recorded: (command) =>
        Promise.resolve(
          audits.some((event) =>
            event.recordType === command.recordType &&
            event.subjectId === command.subjectId
          ),
        ),
    },
    calendar: { timezones: () => Promise.resolve(new Map()) },
    clock,
    currencies: {
      isSupported: ({ code }) => Promise.resolve(["EUR", "USD"].includes(code)),
      listSupported: () => Promise.resolve(["EUR", "USD"]),
      preferredFor: () => Promise.resolve(undefined),
    },
    ids: sequentialIds({ prefix: "50000000-0000-4000-8000-1" }),
    recurringDebts: {
      listForPerson: () => Promise.resolve([]),
    } as unknown as GiftManagementDependencies["recurringDebts"],
    repository: {
      lockRequest: (command) => {
        locks.push(command.id);
        return Promise.resolve();
      },
      giftExists: (command) => Promise.resolve(gifts.has(command.id)),
      debtExists: (command) => Promise.resolve(debts.has(command.id)),
      findSettlement: (command) =>
        Promise.resolve(
          settlements.find((event) =>
            event.debtId === command.debtId && event.id === command.id
          ),
        ),
      recordSettlement: (command) => {
        settlements.push({
          debtId: command.debtId,
          id: command.id,
          ...(command.photoFileId
            ? {
              photoFileId: command.photoFileId,
              photoFilename: command.photoFilename!,
            }
            : {}),
          ...(command.reason ? { reason: command.reason } : {}),
          settledAt: command.occurredAt.toISOString(),
        });
        return Promise.resolve();
      },
      listSettlements: (command) =>
        Promise.resolve({
          settlements: settlements.filter((event) =>
            event.debtId === command.debtId
          ).slice(0, command.limit),
          status: "ready" as const,
        }),
      createGift: (command) => {
        const refusal = refused(command.personId);
        if (refusal) return Promise.resolve(refusal);
        if (
          command.recipientPersonId &&
          command.recipientPersonId !== recipientId
        ) return Promise.resolve({ status: "not-found" as const });
        const at = command.occurredAt.toISOString();
        const gift: StoredGift = {
          ...(command.amount ? { amount: `${command.amount}` } : {}),
          ...(command.comment ? { comment: command.comment } : {}),
          createdAt: at,
          ...(command.currencyCode
            ? { currencyCode: command.currencyCode }
            : {}),
          ...(command.eventAt ? { eventAt: command.eventAt } : {}),
          id: command.id,
          name: command.name,
          personId: command.personId,
          ...(command.recipientPersonId
            ? { recipientPersonId: command.recipientPersonId }
            : {}),
          status: command.status,
          updatedAt: at,
          ...(command.url ? { url: command.url } : {}),
        };
        if (gifts.has(gift.id)) throw new Error("duplicate gift id");
        gifts.set(gift.id, gift);
        return Promise.resolve({ gift, status: "created" as const });
      },
      createDebt: (command) => {
        const refusal = refused(command.personId);
        if (refusal) return Promise.resolve(refusal);
        const at = command.occurredAt.toISOString();
        const debt: StoredDebt = {
          amount: command.amount,
          createdAt: at,
          ...(command.currencyCode
            ? { currencyCode: command.currencyCode }
            : {}),
          direction: command.direction,
          id: command.id,
          personId: command.personId,
          ...(command.reason ? { reason: command.reason } : {}),
          ...(command.settledAt
            ? { settledAt: command.settledAt.toISOString() }
            : {}),
          status: command.status,
          updatedAt: at,
        };
        if (debts.has(debt.id)) throw new Error("duplicate debt id");
        debts.set(debt.id, debt);
        return Promise.resolve({ debt, status: "created" as const });
      },
      findGift: (command) => {
        const refusal = refused(command.personId);
        if (refusal) return Promise.resolve(refusal);
        const gift = owned(gifts, command.id, command.personId);
        return Promise.resolve(
          gift
            ? { gift, status: "found" as const }
            : { status: "not-found" as const },
        );
      },
      findDebt: (command) => {
        const refusal = refused(command.personId);
        if (refusal) return Promise.resolve(refusal);
        const debt = owned(debts, command.id, command.personId);
        return Promise.resolve(
          debt
            ? { debt, status: "found" as const }
            : { status: "not-found" as const },
        );
      },
      list: () =>
        Promise.resolve({
          debts: [...debts.values()],
          gifts: [...gifts.values()],
          status: "ready" as const,
        }),
      saveGift: (command) => {
        const gift = {
          ...gifts.get(command.id)!,
          status: command.status,
          updatedAt: command.occurredAt.toISOString(),
        };
        gifts.set(gift.id, gift);
        return Promise.resolve({ gift, status: "saved" as const });
      },
      saveDebt: (command) => {
        const { settledAt: _settled, ...current } = debts.get(command.id)!;
        const debt: StoredDebt = {
          ...current,
          ...(command.settledAt
            ? { settledAt: command.settledAt.toISOString() }
            : {}),
          status: command.status,
          updatedAt: command.occurredAt.toISOString(),
        };
        debts.set(debt.id, debt);
        return Promise.resolve({ debt, status: "saved" as const });
      },
      saveGiftValues: (command) => {
        const refusal = refused(command.personId);
        if (refusal) return Promise.resolve(refusal);
        const current = owned(gifts, command.id, command.personId);
        if (
          !current ||
          (command.checkRecipient &&
            command.recipientPersonId !== undefined &&
            command.recipientPersonId !== recipientId)
        ) return Promise.resolve({ status: "not-found" as const });
        const gift: StoredGift = {
          ...(command.amount ? { amount: command.amount } : {}),
          ...(command.comment ? { comment: command.comment } : {}),
          createdAt: current.createdAt,
          ...(command.currencyCode
            ? { currencyCode: command.currencyCode }
            : {}),
          ...(command.eventAt ? { eventAt: command.eventAt } : {}),
          id: current.id,
          name: command.name,
          personId: current.personId,
          ...(command.recipientPersonId
            ? { recipientPersonId: command.recipientPersonId }
            : {}),
          status: current.status,
          updatedAt: command.occurredAt.toISOString(),
          ...(command.url ? { url: command.url } : {}),
        };
        gifts.set(gift.id, gift);
        return Promise.resolve({ gift, status: "saved" as const });
      },
      saveDebtValues: (command) => {
        const refusal = refused(command.personId);
        if (refusal) return Promise.resolve(refusal);
        const current = owned(debts, command.id, command.personId);
        if (!current) return Promise.resolve({ status: "not-found" as const });
        const { reason: _reason, ...rest } = current;
        const debt: StoredDebt = {
          ...rest,
          amount: command.amount,
          currencyCode: command.currencyCode,
          direction: command.direction,
          ...(command.reason ? { reason: command.reason } : {}),
          updatedAt: command.occurredAt.toISOString(),
        };
        debts.set(debt.id, debt);
        return Promise.resolve({ debt, status: "saved" as const });
      },
      deleteGift: (command) => {
        const refusal = refused(command.personId);
        if (refusal) return Promise.resolve(refusal);
        const gift = owned(gifts, command.id, command.personId);
        if (!gift) return Promise.resolve({ status: "not-found" as const });
        gifts.delete(gift.id);
        // The schema's cascade: the links go, the files stay.
        for (let index = links.length - 1; index >= 0; index--) {
          if (links[index]!.giftId === gift.id) links.splice(index, 1);
        }
        return Promise.resolve({ gift, status: "deleted" as const });
      },
      deleteDebt: (command) => {
        const refusal = refused(command.personId);
        if (refusal) return Promise.resolve(refusal);
        const debt = owned(debts, command.id, command.personId);
        if (!debt) return Promise.resolve({ status: "not-found" as const });
        debts.delete(debt.id);
        for (let index = settlements.length - 1; index >= 0; index--) {
          if (settlements[index]!.debtId === debt.id) {
            settlements.splice(index, 1);
          }
        }
        return Promise.resolve({ debt, status: "deleted" as const });
      },
    },
    transaction: { run: (work) => work({ opaque: "transaction" }) },
  };
  return {
    /** Archives both people, as a member archiving them after these writes. */
    archive: () => {
      archived = true;
    },
    audits,
    debts,
    gifts,
    links,
    locks,
    management: createGiftManagement(dependencies),
    settlements,
    tick,
  };
}

const book = {
  amount: "12.50",
  currencyCode: "EUR",
  name: "Book",
  recipientPersonId: recipientId,
  status: "planned" as const,
};

async function createdGift(
  context: ReturnType<typeof fixture>,
  input: Parameters<ReturnType<typeof fixture>["management"]["createGift"]>[2] =
    book,
): Promise<StoredGift> {
  const created = await context.management.createGift(actor, personId, input);
  if (created.status !== "created") throw new Error(created.status);
  context.tick();
  return created.gift;
}

async function createdDebt(
  context: ReturnType<typeof fixture>,
  status: "cancelled" | "open" | "settled" = "open",
): Promise<StoredDebt> {
  const created = await context.management.createDebt(actor, personId, {
    amount: "20",
    currencyCode: "EUR",
    direction: "they_owe",
    reason: "Lunch",
    status,
  });
  if (created.status !== "created") throw new Error(created.status);
  context.tick();
  return created.debt;
}

Deno.test("[MCP-D3] a gift edit changes only what it names, at the revision it read", async () => {
  const context = fixture();
  const gift = await createdGift(context, {
    ...book,
    attachmentFileId: fileId,
  });
  const edited = await context.management.changeGift(actor, personId, gift.id, {
    comment: "Wrapped",
    expectedUpdatedAt: gift.updatedAt,
    name: "Novel",
  });
  if (edited.status !== "saved") throw new Error(edited.status);
  assertEquals(
    [edited.gift.name, edited.gift.comment, edited.gift.amount],
    ["Novel", "Wrapped", "12.50"],
  );
  assertEquals(edited.gift.recipientPersonId, recipientId);
  assertEquals(edited.gift.attachmentFileId, fileId, "attachment kept");
  assert(edited.gift.updatedAt !== gift.updatedAt, "revision moved");
  assertEquals(context.audits.at(-1), {
    action: "changed",
    recordType: "gift",
    subjectId: gift.id,
  });
  const audited = context.audits.length;
  const stale = await context.management.changeGift(actor, personId, gift.id, {
    expectedUpdatedAt: gift.updatedAt,
    name: "Atlas",
  });
  assertEquals(stale, { status: "stale" });
  assertEquals(
    context.gifts.get(gift.id)?.name,
    "Novel",
    "stale wrote nothing",
  );
  context.tick();
  const cleared = await context.management.changeGift(
    actor,
    personId,
    gift.id,
    {
      amount: null,
      attachmentFileId: null,
      comment: null,
      currencyCode: null,
      expectedUpdatedAt: edited.gift.updatedAt,
      recipientPersonId: null,
    },
  );
  if (cleared.status !== "saved") throw new Error(cleared.status);
  assertEquals(
    [
      cleared.gift.amount,
      cleared.gift.currencyCode,
      cleared.gift.comment,
      cleared.gift.recipientPersonId,
      cleared.gift.attachmentFileId,
    ],
    [undefined, undefined, undefined, undefined, undefined],
  );
  assertEquals(context.links, [], "link removed, file untouched");
  const unchanged = await context.management.changeGift(
    actor,
    personId,
    gift.id,
    { expectedUpdatedAt: cleared.gift.updatedAt, name: "Novel" },
  );
  assertEquals(unchanged.status, "unchanged");
  assertEquals(context.audits.length, audited + 1, "unchanged is not audited");
});

Deno.test("[MCP-D3] a gift edit applies every check the create applies", async () => {
  const context = fixture();
  const gift = await createdGift(context);
  const change = (input: Record<string, unknown>) =>
    context.management.changeGift(actor, personId, gift.id, {
      expectedUpdatedAt: gift.updatedAt,
      ...input,
    });
  for (
    const [input, status] of [
      [{}, "validation-error"],
      [{ amount: "30" }, "validation-error"],
      [{ amount: "30", currencyCode: "GBP" }, "validation-error"],
      [{ eventAt: "soon" }, "validation-error"],
      [{ recipientPersonId: otherPersonId }, "not-found"],
      [{ attachmentFileId: photoId }, "not-found"],
    ] as const
  ) {
    assertEquals(
      (await change(input)).status,
      status,
      JSON.stringify(input),
    );
  }
  assertEquals(context.gifts.get(gift.id), gift, "nothing was written");
  const moved = await change({ attachmentFileId: secondFileId });
  if (moved.status !== "saved") throw new Error(moved.status);
  assertEquals(moved.gift.attachmentFileId, secondFileId);
  assertEquals(context.links, [{ fileId: secondFileId, giftId: gift.id }]);
  const priced = await context.management.changeGift(actor, personId, gift.id, {
    amount: "30",
    currencyCode: "usd",
    expectedUpdatedAt: moved.gift.updatedAt,
  });
  if (priced.status !== "saved") throw new Error(priced.status);
  assertEquals([priced.gift.amount, priced.gift.currencyCode], ["30", "USD"]);
  assertEquals(
    (await context.management.changeGift(actor, otherPersonId, gift.id, {
      expectedUpdatedAt: priced.gift.updatedAt,
      name: "Elsewhere",
    })).status,
    "not-found",
    "a gift under the wrong person path is not found",
  );
});

Deno.test("[MCP-D3] deleting a gift needs its revision and keeps its file", async () => {
  const context = fixture();
  const gift = await createdGift(context, {
    ...book,
    attachmentFileId: fileId,
  });
  assertEquals(
    await context.management.deleteGift(actor, personId, gift.id, {
      expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
    }),
    { status: "stale" },
  );
  assertEquals(
    (await context.management.deleteGift(actor, otherPersonId, gift.id, {
      expectedUpdatedAt: gift.updatedAt,
    })).status,
    "not-found",
  );
  assert(context.gifts.has(gift.id), "refusals deleted nothing");
  const deleted = await context.management.deleteGift(
    actor,
    personId,
    gift.id,
    { expectedUpdatedAt: gift.updatedAt },
  );
  assertEquals(deleted, { giftId: gift.id, status: "deleted" });
  assert(!context.gifts.has(gift.id), "gift removed");
  assertEquals(context.links, [], "only the link went");
  assertEquals(context.audits.at(-1), {
    action: "deleted",
    recordType: "gift",
    subjectId: gift.id,
  });
  assertEquals(
    (await context.management.deleteGift(actor, personId, gift.id, {
      expectedUpdatedAt: gift.updatedAt,
    })).status,
    "not-found",
  );
});

Deno.test("[MCP-D3] archived people refuse gift and debt edits and deletes", async () => {
  const context = fixture({ archived: true });
  const expectedUpdatedAt = "2026-08-23T10:00:00.000Z";
  for (
    const result of [
      await context.management.changeGift(actor, personId, fileId, {
        expectedUpdatedAt,
        name: "Novel",
      }),
      await context.management.deleteGift(actor, personId, fileId, {
        expectedUpdatedAt,
      }),
      await context.management.changeDebt(actor, personId, fileId, {
        expectedUpdatedAt,
        reason: "Dinner",
      }),
    ]
  ) assertEquals(result.status, "archived-write-rejected");
});

Deno.test("[MCP-D3] a debt's money changes only while it is open and was never settled", async () => {
  const context = fixture();
  const open = await createdDebt(context);
  const edited = await context.management.changeDebt(actor, personId, open.id, {
    amount: "25",
    direction: "i_owe",
    expectedUpdatedAt: open.updatedAt,
    reason: null,
  });
  if (edited.status !== "saved") throw new Error(edited.status);
  assertEquals(
    [edited.debt.amount, edited.debt.direction, edited.debt.reason],
    ["25", "i_owe", undefined],
  );
  assertEquals(context.audits.at(-1)?.action, "changed");
  assertEquals(
    await context.management.changeDebt(actor, personId, open.id, {
      amount: "30",
      expectedUpdatedAt: open.updatedAt,
    }),
    { status: "stale" },
  );
  context.tick();
  const settled = await context.management.changeDebtStatus(
    actor,
    personId,
    open.id,
    "settled",
  );
  if (settled.status !== "saved") throw new Error(settled.status);
  context.tick();
  const reopened = await context.management.changeDebtStatus(
    actor,
    personId,
    open.id,
    "open",
  );
  if (reopened.status !== "saved") throw new Error(reopened.status);
  assertEquals(
    await context.management.changeDebt(actor, personId, open.id, {
      amount: "30",
      expectedUpdatedAt: reopened.debt.updatedAt,
    }),
    { status: "debt-values-locked" },
    "a reopened debt keeps what its history settled",
  );
  const reason = await context.management.changeDebt(
    actor,
    personId,
    open.id,
    { expectedUpdatedAt: reopened.debt.updatedAt, reason: "Dinner" },
  );
  assertEquals(reason.status, "saved", "the reason stays editable");
  const settledDebt = await createdDebt(context, "settled");
  assertEquals(
    (await context.management.changeDebt(actor, personId, settledDebt.id, {
      currencyCode: "USD",
      expectedUpdatedAt: settledDebt.updatedAt,
    })).status,
    "debt-values-locked",
  );
  const cancelled = await createdDebt(context, "cancelled");
  assertEquals(
    (await context.management.changeDebt(actor, personId, cancelled.id, {
      expectedUpdatedAt: cancelled.updatedAt,
      reason: "Forgiven",
    })).status,
    "debt-values-locked",
  );
  for (
    const [input, status] of [
      [{}, "validation-error"],
      [{ currencyCode: "GBP" }, "validation-error"],
      [{ amount: "1.23456" }, "validation-error"],
    ] as const
  ) {
    const fresh = await createdDebt(context);
    assertEquals(
      (await context.management.changeDebt(actor, personId, fresh.id, {
        expectedUpdatedAt: fresh.updatedAt,
        ...input,
      })).status,
      status,
    );
  }
  const same = await createdDebt(context);
  assertEquals(
    (await context.management.changeDebt(actor, personId, same.id, {
      amount: "20.00",
      expectedUpdatedAt: same.updatedAt,
    })).status,
    "unchanged",
  );
  assertEquals(
    (await context.management.changeDebt(actor, otherPersonId, same.id, {
      expectedUpdatedAt: same.updatedAt,
      reason: "x",
    })).status,
    "not-found",
  );
});

Deno.test("[MCP-D3] a stale status change changes nothing and appends no settlement", async () => {
  const context = fixture();
  const debt = await createdDebt(context);
  const gift = await createdGift(context);
  const stale = "2026-01-01T00:00:00.000Z";
  assertEquals(
    await context.management.changeDebtStatus(
      actor,
      personId,
      debt.id,
      "settled",
      { settlementReason: "Cash" },
      { expectedUpdatedAt: stale },
    ),
    { status: "stale" },
  );
  assertEquals(context.settlements, [], "no settlement history");
  assertEquals(context.debts.get(debt.id)?.status, "open");
  assertEquals(
    await context.management.changeGiftStatus(
      actor,
      personId,
      gift.id,
      "given",
      { expectedUpdatedAt: stale },
    ),
    { status: "stale" },
  );
  assertEquals(context.gifts.get(gift.id)?.status, "planned");
  const current = await context.management.changeDebtStatus(
    actor,
    personId,
    debt.id,
    "settled",
    {},
    { expectedUpdatedAt: debt.updatedAt },
  );
  assertEquals(current.status, "saved");
  assertEquals(context.settlements.length, 1);
  const unversioned = await context.management.changeGiftStatus(
    actor,
    personId,
    gift.id,
    "given",
  );
  assertEquals(unversioned.status, "saved", "omitted revision: as before");
});

Deno.test("[MCP-D3] a gift create retried with its request id returns the original", async () => {
  const context = fixture();
  const first = await context.management.createGift(actor, personId, {
    ...book,
    attachmentFileId: fileId,
    requestId,
  });
  if (first.status !== "created") throw new Error(first.status);
  const audited = context.audits.length;
  const replay = await context.management.createGift(actor, personId, {
    ...book,
    amount: "12.5",
    attachmentFileId: fileId,
    currencyCode: "eur",
    requestId: requestId.toUpperCase(),
  });
  assertEquals(replay, first);
  assertEquals(context.gifts.size, 1, "one gift");
  assertEquals(context.links.length, 1, "attached once");
  assertEquals(context.audits.length, audited, "a replay is not audited");
  assert(context.locks.includes(first.gift.id), "the request was serialized");
  for (
    const changed of [
      { ...book, name: "Other", requestId },
      { ...book, requestId },
      { ...book, attachmentFileId: fileId, requestId, status: "idea" as const },
    ]
  ) {
    assertEquals(
      await context.management.createGift(actor, personId, changed),
      { status: "idempotency-conflict" },
    );
  }
  assertEquals(
    await context.management.createGift(actor, otherPersonId, {
      ...book,
      attachmentFileId: fileId,
      requestId,
    }),
    { status: "idempotency-conflict" },
    "the key is the workspace's, whatever person it names",
  );
  assertEquals(
    await context.management.createGift(actor, personId, {
      ...book,
      requestId: "not-a-uuid",
    }),
    { status: "validation-error" },
  );
  context.tick();
  await context.management.deleteGift(actor, personId, first.gift.id, {
    expectedUpdatedAt: first.gift.updatedAt,
  });
  assertEquals(
    await context.management.createGift(actor, personId, {
      ...book,
      attachmentFileId: fileId,
      requestId,
    }),
    { status: "request-deleted" },
    "a deleted gift is not recreated by its replay",
  );
  assertEquals(context.gifts.size, 0);
  await createdGift(context);
  await createdGift(context);
  assertEquals(context.gifts.size, 2, "no request id: every create records");
});

Deno.test("[MCP-D3] a debt create retried with its request id never settles twice", async () => {
  const context = fixture();
  const input = {
    amount: "20",
    currencyCode: "EUR",
    direction: "they_owe" as const,
    requestId,
    settlementPhotoFileId: photoId,
    settlementReason: "Cash",
    status: "settled" as const,
  };
  const first = await context.management.createDebt(actor, personId, input);
  if (first.status !== "created") throw new Error(first.status);
  assertEquals(context.settlements.map((event) => event.id), [first.debt.id]);
  const replay = await context.management.createDebt(actor, personId, {
    ...input,
    amount: "20.0",
  });
  assertEquals(replay, first);
  assertEquals(context.settlements.length, 1, "no second settlement");
  for (
    const changed of [
      { ...input, settlementReason: "Card" },
      { ...input, settlementPhotoFileId: undefined },
      { ...input, direction: "i_owe" as const },
    ]
  ) {
    const { settlementPhotoFileId, ...rest } = changed;
    assertEquals(
      await context.management.createDebt(actor, personId, {
        ...rest,
        ...(settlementPhotoFileId ? { settlementPhotoFileId } : {}),
      }),
      { status: "idempotency-conflict" },
    );
  }
  await context.management.deleteDebt(actor, personId, first.debt.id);
  assertEquals(
    await context.management.createDebt(actor, personId, input),
    { status: "request-deleted" },
  );
  assertEquals(context.debts.size, 0);
  assertEquals(context.settlements.length, 0);
  const plain = fixture();
  await createdDebt(plain);
  await createdDebt(plain);
  assertEquals(plain.debts.size, 2, "no request id: every create records");
});

Deno.test("[MCP-D3] an edit that changes nothing still answers a finished debt and an archived person", async () => {
  const context = fixture();
  const cancelled = await createdDebt(context, "cancelled");
  assertEquals(
    await context.management.changeDebt(actor, personId, cancelled.id, {
      expectedUpdatedAt: cancelled.updatedAt,
      reason: "Lunch",
    }),
    { status: "debt-values-locked" },
    "a cancelled debt refuses even an edit naming its current values",
  );
  assertEquals(
    await context.management.changeDebt(actor, personId, cancelled.id, {
      amount: "20.00",
      expectedUpdatedAt: cancelled.updatedAt,
    }),
    { status: "debt-values-locked" },
  );
  const settled = await createdDebt(context, "settled");
  assertEquals(
    (await context.management.changeDebt(actor, personId, settled.id, {
      amount: "20",
      expectedUpdatedAt: settled.updatedAt,
    })).status,
    "unchanged",
    "a settled debt's unchanged money is no change, not a locked one",
  );

  // An archived gift is finished as a status only: its values stay editable,
  // so naming the values it has is no change.
  const gift = await createdGift(context);
  const archivedGift = await context.management.changeGiftStatus(
    actor,
    personId,
    gift.id,
    "archived",
  );
  if (archivedGift.status !== "saved") throw new Error(archivedGift.status);
  context.tick();
  assertEquals(
    (await context.management.changeGift(actor, personId, gift.id, {
      expectedUpdatedAt: archivedGift.gift.updatedAt,
      name: "Book",
    })).status,
    "unchanged",
  );
  const renamed = await context.management.changeGift(
    actor,
    personId,
    gift.id,
    { expectedUpdatedAt: archivedGift.gift.updatedAt, name: "Atlas" },
  );
  assertEquals(
    renamed.status === "saved"
      ? [renamed.gift.name, renamed.gift.status]
      : renamed.status,
    ["Atlas", "archived"],
  );

  // An archived person refuses before an edit is compared at all.
  const open = await createdDebt(context);
  const kept = await createdGift(context);
  context.archive();
  assertEquals(
    await context.management.changeDebt(actor, personId, open.id, {
      expectedUpdatedAt: open.updatedAt,
      reason: "Lunch",
    }),
    { status: "archived-write-rejected" },
  );
  assertEquals(
    await context.management.changeGift(actor, personId, kept.id, {
      expectedUpdatedAt: kept.updatedAt,
      name: "Book",
    }),
    { status: "archived-write-rejected" },
  );
});

Deno.test("[MCP-D3] the audit trail is asked about the action every gift event is written under", async () => {
  for (const recordType of ["debt", "gift", "recurring-debt"] as const) {
    const recorder = recordingAudit();
    const audit = giftAuditFrom(recorder);
    const subjectId = "50000000-0000-4000-8000-0000000000bb";
    const transaction = { opaque: recordType };
    const ask = (type: typeof recordType) =>
      audit.recorded({ actor, recordType: type, subjectId, transaction });
    assertEquals(await ask(recordType), false, `${recordType} before`);
    await audit.record({
      action: "deleted",
      actor,
      occurredAt: new Date("2026-08-23T10:00:00.000Z"),
      record: {
        amount: "1",
        createdAt: "2026-08-23T10:00:00.000000Z",
        direction: "they_owe",
        id: subjectId,
        personId,
        status: "open",
        updatedAt: "2026-08-23T10:00:00.000000Z",
      },
      recordType,
      transaction,
    });
    assertEquals(recorder.actions, [giftAuditAction(recordType)]);
    assertEquals(await ask(recordType), true, `${recordType} after`);
    for (
      const other of (["debt", "gift", "recurring-debt"] as const).filter(
        (type) => type !== recordType,
      )
    ) {
      assertEquals(await ask(other), false, `${other} is another record`);
    }
  }
});
