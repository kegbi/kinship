import { describe, expect, it } from "vitest";
import type {
  Gift,
  PeopleDirectoryPerson,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  debtForm,
  EMPTY_RECORDS,
  foldPage,
  giftDetail,
  giftForm,
  personName,
  submittedValues,
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
        gifts: [],
        nextGiftCursor: "g",
        status: "ready",
        supportedCurrencyCodes: ["USD"],
      },
      {},
    );
    expect(records).toEqual({
      currencies: ["USD"],
      debts: [],
      gifts: [],
      nextGiftCursor: "g",
    });
  });
});
