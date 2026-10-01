import { describe, expect, it } from "vitest";
import type {
  Gift,
  PeopleDirectoryPerson,
  RecurringDebt,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  debtDetail,
  debtForm,
  EMPTY_RECORDS,
  foldPage,
  giftDetail,
  giftForm,
  localToday,
  personName,
  recurringDebtChange,
  recurringDebtDetail,
  recurringDebtForm,
  recurringDebtFormValues,
  recurringDebtTitle,
  startingCurrency,
  submittedValues,
  withoutCursors,
} from "./records.ts";

const gift = {
  createdAt: "2026-08-23T08:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000003",
  name: "Book",
  personId: "00000000-0000-4000-8000-000000000001",
  status: "idea",
  updatedAt: "2026-08-23T08:00:00.000Z",
} satisfies Gift;

describe("GIFTS-001 gift and debt records", () => {
  it("reads an amount with or without its currency", () => {
    expect(giftDetail({ ...gift, amount: "3" })).toBe(
      "idea · 3 · No recipient",
    );
    expect(giftDetail({ ...gift, amount: "3", currencyCode: "EUR" })).toBe(
      "idea · 3 EUR · No recipient",
    );
  });

  it("names a recipient by full name, then nickname, then a placeholder", () => {
    const person = {
      id: gift.personId,
      isPartial: false,
      isStarred: false,
      lifecycle: "active",
      tagCount: 0,
      tags: [],
    } as unknown as PeopleDirectoryPerson;
    expect(personName({ ...person, familyName: "Hopper", givenName: "Grace" }))
      .toBe("Grace Hopper");
    expect(personName({ ...person, nickname: "Amazing" })).toBe("Amazing");
    expect(personName(person)).toBe("Unnamed person");
  });

  it("sends only filled fields and an event time as an instant", () => {
    expect(submittedValues({
      amount: " ",
      eventAt: "2026-09-01T10:30",
      name: "Book",
    })).toEqual({
      eventAt: new Date("2026-09-01T10:30").toISOString(),
      name: "Book",
    });
    // An unreadable time reaches the schema as typed, which refuses it.
    expect(submittedValues({ eventAt: "soon" })).toEqual({ eventAt: "soon" });
    expect(submittedValues(null)).toBeNull();
    expect(
      giftForm.safeParse({ eventAt: "soon", name: "Book", status: "idea" })
        .success,
    ).toBe(false);
    expect(
      debtForm.safeParse({
        amount: "12",
        currencyCode: "EUR",
        direction: "i_owe",
        reason: "",
        status: "open",
      }).data,
    ).toEqual({
      amount: "12",
      currencyCode: "EUR",
      direction: "i_owe",
      status: "open",
    });
  });

  it("replaces both collections on a plain refresh", () => {
    const records = foldPage(
      { ...EMPTY_RECORDS, gifts: [gift], nextDebtCursor: "d" },
      {
        debts: [],
        defaultCurrencyCode: "EUR",
        gifts: [],
        nextGiftCursor: "g",
        recurringDebts: [rule],
        status: "ready",
        supportedCurrencyCodes: ["USD"],
      },
      {},
    );
    expect(records).toEqual({
      currencies: ["USD"],
      debts: [],
      defaultCurrency: "EUR",
      gifts: [],
      nextGiftCursor: "g",
      recurringDebts: [rule],
    });
    expect(withoutCursors(records)).toEqual({
      currencies: ["USD"],
      debts: [],
      defaultCurrency: "EUR",
      gifts: [],
      recurringDebts: [rule],
    });
  });
});

const rule = {
  active: true,
  amount: "500.0000",
  createdAt: "2026-08-23T08:00:00.000Z",
  currencyCode: "EUR",
  dayOfMonth: 31,
  direction: "they_owe",
  id: "00000000-0000-4000-8000-000000000009",
  intervalMonths: 1,
  nextOccurrenceOn: "2026-09-30",
  personId: gift.personId,
  reason: "Rent share",
  startsOn: "2026-05-31",
  updatedAt: "2026-08-23T08:00:00.000Z",
} satisfies RecurringDebt;

describe("GIFTS-001 default currency and recurring debts", () => {
  it("starts a money form on the default currency the workspace supports", () => {
    expect(startingCurrency("RSD", ["EUR", "RSD"])).toBe("RSD");
    expect(startingCurrency("RSD", ["EUR", "USD"])).toBe("EUR");
    expect(startingCurrency("USD", [])).toBe("USD");
  });

  it("drops a gift's currency when the gift has no amount", () => {
    expect(
      giftForm.safeParse({
        amount: "",
        currencyCode: "EUR",
        name: "Book",
        status: "idea",
      }).data,
    ).toEqual({ name: "Book", status: "idea" });
    expect(
      giftForm.safeParse({
        amount: "12",
        currencyCode: "EUR",
        name: "Book",
        status: "idea",
      }).data,
    ).toEqual({
      amount: "12",
      currencyCode: "EUR",
      name: "Book",
      status: "idea",
    });
  });

  it("reads a rule's schedule and state", () => {
    expect(recurringDebtTitle(rule)).toBe("Rent share");
    expect(recurringDebtTitle({ ...rule, reason: undefined } as never)).toBe(
      "Recurring debt",
    );
    expect(recurringDebtDetail(rule)).toBe(
      "They owe · 500.0000 EUR · Monthly on day 31 · Next 2026-09-30",
    );
    expect(
      recurringDebtDetail({
        ...rule,
        direction: "i_owe",
        endsOn: "2027-05-31",
        intervalMonths: 3,
      }),
    ).toBe(
      "I owe · 500.0000 EUR · Every 3 months on day 31 · Until 2027-05-31 · Next 2026-09-30",
    );
    expect(recurringDebtDetail({ ...rule, active: false })).toContain(
      "Paused",
    );
    const { nextOccurrenceOn: _next, ...ended } = rule;
    expect(recurringDebtDetail(ended)).toContain("Ended");
  });

  it("marks a debt a rule charged", () => {
    expect(
      debtDetail({
        amount: "500",
        createdAt: rule.createdAt,
        currencyCode: "EUR",
        direction: "they_owe",
        id: rule.id,
        occurrenceOn: "2026-08-31",
        personId: rule.personId,
        recurringDebtId: rule.id,
        status: "open",
        updatedAt: rule.updatedAt,
      }),
    ).toBe("They owe · 500 EUR · open · Recurring, due 2026-08-31");
  });

  it("starts a new rule today and an edited rule from its own values", () => {
    expect(recurringDebtFormValues(undefined, "RSD", "2026-10-07")).toEqual({
      amount: "",
      currencyCode: "RSD",
      dayOfMonth: "7",
      direction: "they_owe",
      endsOn: "",
      intervalMonths: "1",
      reason: "",
      startsOn: "2026-10-07",
    });
    expect(recurringDebtFormValues(rule, "RSD", "2026-10-07")).toEqual({
      amount: "500.0000",
      currencyCode: "EUR",
      dayOfMonth: "31",
      direction: "they_owe",
      endsOn: "",
      intervalMonths: "1",
      reason: "Rent share",
      startsOn: "2026-05-31",
    });
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("validates the rule with the contract schema and sends clears as null", () => {
    const parsed = recurringDebtForm.safeParse({
      amount: "40",
      currencyCode: "EUR",
      dayOfMonth: "31",
      direction: "i_owe",
      endsOn: "",
      intervalMonths: "2",
      reason: "",
      startsOn: "2026-01-31",
    });
    expect(parsed.data).toEqual({
      amount: "40",
      currencyCode: "EUR",
      dayOfMonth: 31,
      direction: "i_owe",
      intervalMonths: 2,
      startsOn: "2026-01-31",
    });
    expect(recurringDebtChange(parsed.data!)).toEqual({
      amount: "40",
      currencyCode: "EUR",
      dayOfMonth: 31,
      direction: "i_owe",
      endsOn: null,
      intervalMonths: 2,
      reason: null,
      startsOn: "2026-01-31",
    });
    for (
      const [field, value] of [
        ["dayOfMonth", "32"],
        ["dayOfMonth", "1.5"],
        ["intervalMonths", "0"],
        ["startsOn", ""],
        ["amount", "abc"],
      ] as const
    ) {
      expect(
        recurringDebtForm.safeParse({
          amount: "40",
          currencyCode: "EUR",
          dayOfMonth: "1",
          direction: "i_owe",
          endsOn: "",
          intervalMonths: "1",
          reason: "",
          startsOn: "2026-01-01",
          [field]: value,
        }).success,
        `${field}=${value}`,
      ).toBe(false);
    }
  });
});
