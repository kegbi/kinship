import { assert, assertEquals } from "../../../testing/assert.ts";
import {
  canTransitionDebt,
  canTransitionGift,
  type DebtStatus,
  type GiftStatus,
  hydrateGifts,
  money,
  normalizeDebt,
  normalizeGift,
  type StoredGift,
} from "./gift_rules.ts";

const personId = "10000000-0000-4000-8000-000000000001";
const fileId = "20000000-0000-4000-8000-000000000001";

function gift(overrides: Partial<StoredGift> = {}): StoredGift {
  return {
    createdAt: "2026-03-04T10:00:00.000000Z",
    id: "30000000-0000-4000-8000-000000000001",
    name: "A book",
    personId,
    status: "idea",
    updatedAt: "2026-03-04T10:00:00.000000Z",
    ...overrides,
  };
}

Deno.test("[GAP-017] a gift moves forward and archives, and never comes back", () => {
  const allowed: Readonly<Record<GiftStatus, readonly GiftStatus[]>> = {
    archived: [],
    given: ["archived"],
    idea: ["archived", "given", "planned", "received"],
    planned: ["archived", "given", "received"],
    received: ["archived"],
  };
  const every: readonly GiftStatus[] = [
    "archived",
    "given",
    "idea",
    "planned",
    "received",
  ];
  for (const from of every) {
    for (const to of every) {
      assertEquals(
        canTransitionGift(from, to),
        allowed[from].includes(to),
        `a ${from} gift may ${
          allowed[from].includes(to) ? "" : "not "
        }become ${to}`,
      );
    }
  }
});

Deno.test("[GAP-017] a debt is settled or cancelled once and then finished", () => {
  const allowed: Readonly<Record<DebtStatus, readonly DebtStatus[]>> = {
    cancelled: [],
    open: ["cancelled", "settled"],
    settled: [],
  };
  const every: readonly DebtStatus[] = ["cancelled", "open", "settled"];
  for (const from of every) {
    for (const to of every) {
      assertEquals(
        canTransitionDebt(from, to),
        allowed[from].includes(to),
        `a ${from} debt may ${
          allowed[from].includes(to) ? "" : "not "
        }become ${to}`,
      );
    }
  }
});

Deno.test("[GAP-017] money is text the column holds and a total can still sum", () => {
  assertEquals(money("12.34"), "12.34");
  assertEquals(money("0"), "0");
  assertEquals(
    money("999999999999999.9999"),
    "999999999999999.9999",
    "the largest amount the column holds is still an amount",
  );
  assertEquals(
    money("9999999999999999"),
    undefined,
    "more whole digits than the column keeps is not an amount",
  );
  assertEquals(money(undefined), undefined);
  assertEquals(money("-1"), undefined, "a debt is never negative");
  assertEquals(money("1.23456"), undefined, "the column keeps four decimals");
  assertEquals(money("a lot"), undefined);
});

Deno.test("[GAP-017] a gift's attachment is joined on, and a gift without one is untouched", () => {
  const withLink = gift();
  const withoutLink = gift({ id: "30000000-0000-4000-8000-000000000002" });
  const hydrated = hydrateGifts([withLink, withoutLink], [{
    fileId,
    giftId: withLink.id,
  }]);
  assertEquals(hydrated[0]?.attachmentFileId, fileId);
  assertEquals(hydrated[1]?.attachmentFileId, undefined);
  assert(
    hydrated[1] === withoutLink,
    "a gift with no link is handed back as is",
  );
  assertEquals(hydrateGifts([], [{ fileId, giftId: withLink.id }]), []);
});

Deno.test("[GAP-017] a gift needs a name, and an amount needs a currency", () => {
  assertEquals(
    normalizeGift({ name: "  A book  ", status: "idea" }),
    { name: "A book", status: "idea" },
  );
  assertEquals(
    normalizeGift({
      amount: "12.34",
      comment: "  For the trip  ",
      currencyCode: "  eur  ",
      eventAt: "2026-03-04T10:00:00.000Z",
      name: "A book",
      recipientPersonId: personId,
      status: "planned",
      url: "  https://example.test/book  ",
    }),
    {
      amount: "12.34",
      comment: "For the trip",
      currencyCode: "EUR",
      eventAt: "2026-03-04T10:00:00.000000Z",
      name: "A book",
      recipientPersonId: personId,
      status: "planned",
      url: "https://example.test/book",
    },
  );
  assertEquals(
    normalizeGift({ name: "   ", status: "idea" }),
    undefined,
    "a gift with no name is nothing to record",
  );
  assertEquals(
    normalizeGift({ name: "x".repeat(501), status: "idea" }),
    undefined,
  );
  assertEquals(
    normalizeGift({ amount: "12.34", name: "A book", status: "idea" }),
    undefined,
    "a bare number is not a price",
  );
  assertEquals(
    normalizeGift({
      amount: "lots",
      currencyCode: "EUR",
      name: "A book",
      status: "idea",
    }),
    undefined,
  );
  assertEquals(
    normalizeGift({ currencyCode: "euros", name: "A book", status: "idea" }),
    undefined,
  );
  assertEquals(
    normalizeGift({ eventAt: "sometime", name: "A book", status: "idea" }),
    undefined,
  );
});

Deno.test("[GAP-017] a comment or a link that will not fit is dropped, not refused", () => {
  assertEquals(
    normalizeGift({
      comment: "x".repeat(10_001),
      name: "A book",
      status: "idea",
      url: "y".repeat(2_001),
    }),
    { name: "A book", status: "idea" },
  );
});

Deno.test("[GAP-017] a debt is always an amount of something", () => {
  assertEquals(
    normalizeDebt({
      amount: "12.34",
      currencyCode: "eur",
      direction: "i_owe",
      reason: "  Lunch  ",
      status: "open",
    }),
    {
      amount: "12.34",
      currencyCode: "EUR",
      direction: "i_owe",
      reason: "Lunch",
      status: "open",
    },
  );
  assertEquals(
    normalizeDebt({
      amount: "12.34",
      currencyCode: "EUR",
      direction: "they_owe",
      reason: "x".repeat(10_001),
      status: "settled",
    }),
    {
      amount: "12.34",
      currencyCode: "EUR",
      direction: "they_owe",
      status: "settled",
    },
    "a reason that will not fit is dropped, not refused",
  );
  assertEquals(
    normalizeDebt({
      amount: "lots",
      currencyCode: "EUR",
      direction: "i_owe",
      status: "open",
    }),
    undefined,
  );
  assertEquals(
    normalizeDebt({
      amount: "12.34",
      currencyCode: "euros",
      direction: "i_owe",
      status: "open",
    }),
    undefined,
  );
});
