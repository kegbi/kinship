import { assert, assertEquals } from "../../../testing/assert.ts";
import {
  debtMatchesCreate,
  debtValuesLocked,
  giftMatchesCreate,
  mergeDebtChange,
  mergeGiftChange,
  normalizeDebt,
  normalizeGift,
  sameRevision,
  type StoredDebt,
  type StoredGift,
} from "./gift_rules.ts";
import {
  normalizeRecurringDebt,
  recurringDebtMatchesCreate,
} from "./recurring_debts.ts";

const stored: StoredGift = {
  amount: "12.5000",
  comment: "Wrapped",
  createdAt: "2026-08-23T10:00:00.000000Z",
  currencyCode: "EUR",
  eventAt: "2026-09-01 10:00:00+00",
  id: "40000000-0000-4000-8000-000000000001",
  name: "Book",
  personId: "40000000-0000-4000-8000-000000000002",
  recipientPersonId: "40000000-0000-4000-8000-000000000003",
  status: "planned",
  updatedAt: "2026-08-23T10:00:00.000000Z",
  url: "https://example.test/book",
};

const debt: StoredDebt = {
  amount: "20.0000",
  createdAt: "2026-08-23T10:00:00.000000Z",
  currencyCode: "EUR",
  direction: "they_owe",
  id: "40000000-0000-4000-8000-000000000004",
  personId: stored.personId,
  reason: "Lunch",
  status: "open",
  updatedAt: "2026-08-23T10:00:00.000000Z",
};

Deno.test("[MCP-D3] a gift edit keeps omitted fields, clears explicit nulls, and refuses an incomplete price", () => {
  assertEquals(mergeGiftChange(stored, { name: " Novel " }), {
    attachmentFileId: undefined,
    values: {
      amount: "12.5000",
      comment: "Wrapped",
      currencyCode: "EUR",
      eventAt: "2026-09-01 10:00:00+00",
      name: "Novel",
      recipientPersonId: stored.recipientPersonId,
      status: "planned",
      url: "https://example.test/book",
    },
  });
  const cleared = mergeGiftChange(
    { ...stored, attachmentFileId: "40000000-0000-4000-8000-000000000009" },
    {
      amount: null,
      attachmentFileId: null,
      comment: null,
      currencyCode: null,
      eventAt: null,
      recipientPersonId: null,
      url: null,
    },
  );
  assertEquals(cleared, {
    attachmentFileId: undefined,
    values: { name: "Book", status: "planned" },
  });
  assertEquals(
    mergeGiftChange(stored, { amount: "30", currencyCode: "usd" })?.values
      .currencyCode,
    "USD",
  );
  assertEquals(
    mergeGiftChange(stored, {
      eventAt: "2026-10-01T08:00:00+02:00",
    })?.values.eventAt,
    "2026-10-01T06:00:00.000000Z",
  );
  for (
    const change of [
      {},
      { amount: "30" },
      { currencyCode: "USD" },
      { amount: "30", currencyCode: null },
      { amount: "1.23456", currencyCode: "EUR" },
      { name: " " },
      { comment: " " },
      { eventAt: "tomorrow" },
      { url: "" },
    ]
  ) {
    assertEquals(
      mergeGiftChange(stored, change),
      undefined,
      JSON.stringify(change),
    );
  }
  // A price may be dropped while the currency stays, as a create allows.
  assertEquals(
    mergeGiftChange(stored, { amount: null, currencyCode: "EUR" })?.values,
    {
      comment: "Wrapped",
      currencyCode: "EUR",
      eventAt: "2026-09-01 10:00:00+00",
      name: "Book",
      recipientPersonId: stored.recipientPersonId,
      status: "planned",
      url: "https://example.test/book",
    },
  );
});

Deno.test("[MCP-D3] a debt edit keeps omitted fields and freezes money once settled or cancelled", () => {
  assertEquals(mergeDebtChange(debt, { reason: null }), {
    amount: "20.0000",
    currencyCode: "EUR",
    direction: "they_owe",
    status: "open",
  });
  assertEquals(
    mergeDebtChange(debt, { amount: "25", currencyCode: "usd" }),
    {
      amount: "25",
      currencyCode: "USD",
      direction: "they_owe",
      reason: "Lunch",
      status: "open",
    },
  );
  for (
    const change of [
      {},
      { amount: "-1" },
      { currencyCode: "EURO" },
      { reason: " " },
    ]
  ) {
    assertEquals(mergeDebtChange(debt, change), undefined);
  }
  const money = mergeDebtChange(debt, { amount: "25" })!;
  const reason = mergeDebtChange(debt, { reason: "Dinner" })!;
  const sameAmount = mergeDebtChange(debt, { amount: "20", reason: "Dinner" })!;
  const direction = mergeDebtChange(debt, { direction: "i_owe" })!;
  assert(!debtValuesLocked(debt, money, false), "open, no history: money");
  assert(debtValuesLocked(debt, money, true), "history freezes money");
  assert(debtValuesLocked(debt, direction, true), "history freezes direction");
  assert(!debtValuesLocked(debt, reason, true), "history keeps reason open");
  assert(
    !debtValuesLocked(debt, sameAmount, true),
    "an equal amount is not a money change",
  );
  const settled: StoredDebt = { ...debt, status: "settled" };
  assert(
    debtValuesLocked(settled, { ...money, status: "settled" }, true),
    "settled money frozen",
  );
  assert(
    !debtValuesLocked(settled, { ...reason, status: "settled" }, true),
    "settled reason editable",
  );
  const cancelled: StoredDebt = { ...debt, status: "cancelled" };
  assert(
    debtValuesLocked(cancelled, { ...reason, status: "cancelled" }, false),
    "cancelled is finished",
  );
});

Deno.test("[MCP-D3] a replay matches its stored record by value, not spelling", () => {
  const values = normalizeGift({
    amount: "12.50",
    comment: "Wrapped",
    currencyCode: "eur",
    eventAt: "2026-09-01T10:00:00Z",
    name: "Book",
    recipientPersonId: stored.recipientPersonId!,
    status: "planned",
    url: "https://example.test/book",
  })!;
  assert(giftMatchesCreate(stored, values, undefined), "same gift");
  assert(
    !giftMatchesCreate(stored, { ...values, name: "Other" }, undefined),
    "name differs",
  );
  assert(
    !giftMatchesCreate(stored, values, "40000000-0000-4000-8000-000000000009"),
    "attachment differs",
  );
  assert(
    !giftMatchesCreate(stored, { ...values, status: "idea" }, undefined),
    "status differs",
  );
  const { eventAt: _eventAt, ...undated } = values;
  assert(!giftMatchesCreate(stored, undated, undefined), "event differs");
  const debtValues = normalizeDebt({
    amount: "20",
    currencyCode: "EUR",
    direction: "they_owe",
    reason: "Lunch",
    status: "open",
  })!;
  assert(debtMatchesCreate(debt, debtValues), "same debt");
  assert(
    !debtMatchesCreate(debt, { ...debtValues, amount: "20.01" }),
    "amount differs",
  );
  assert(
    !debtMatchesCreate(debt, { ...debtValues, direction: "i_owe" }),
    "direction differs",
  );
});

Deno.test("[MCP-D3] a revision matches its instant whatever its precision", () => {
  assert(
    sameRevision("2026-08-23T10:00:00.000000Z", "2026-08-23T10:00:00Z"),
    "padded",
  );
  assert(
    sameRevision("2026-08-23T10:00:00.120000Z", "2026-08-23T12:00:00.12+02:00"),
    "offset",
  );
  assert(
    !sameRevision("2026-08-23T10:00:00.000000Z", "2026-08-23T10:00:00.001Z"),
    "later",
  );
  assert(!sameRevision("2026-08-23T10:00:00.000000Z", "yesterday"), "junk");
});

Deno.test("[MCP-D3] a replayed rule matches what its create asked for, not its history since", () => {
  const values = normalizeRecurringDebt({
    amount: "500",
    currencyCode: "eur",
    dayOfMonth: 31,
    direction: "they_owe",
    endsOn: "2027-05-31",
    intervalMonths: 1,
    reason: "Rent",
    startsOn: "2026-05-31",
  })!;
  const stored = {
    ...values,
    active: false,
    amount: "500.0000",
    createdAt: "2026-08-23T10:00:00.000000Z",
    id: "40000000-0000-4000-8000-000000000010",
    nextOccurrenceOn: "2026-09-30",
    personId: "40000000-0000-4000-8000-000000000002",
    updatedAt: "2026-08-24T10:00:00.000000Z",
  };
  assert(recurringDebtMatchesCreate(stored, values), "paused since: same rule");
  for (
    const changed of [
      { ...values, amount: "501" },
      { ...values, currencyCode: "USD" },
      { ...values, direction: "i_owe" as const },
      { ...values, reason: "Other" },
      { ...values, dayOfMonth: 1 },
      { ...values, intervalMonths: 2 },
      { ...values, startsOn: "2026-06-30" },
      { ...values, endsOn: "2027-06-30" },
    ]
  ) {
    assert(
      !recurringDebtMatchesCreate(stored, changed),
      JSON.stringify(changed),
    );
  }
});
