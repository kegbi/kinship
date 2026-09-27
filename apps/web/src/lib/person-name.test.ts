import { describe, expect, it } from "vitest";
import {
  displayPersonName,
  nameInitials,
  type PersonNameOrder,
} from "./person-name.ts";

describe("APR-008 explicit person-name preferences", () => {
  it.each(
    [
      ["given_family_nickname", "Ada Byron Lovelace “Enchantress”"],
      ["family_given_nickname", "Lovelace Ada Byron “Enchantress”"],
    ] as const,
  )("uses %s without losing middle names or nicknames", (order, expected) => {
    expect(
      displayPersonName({
        givenName: " Ada ",
        middleName: "Byron",
        familyName: "Lovelace",
        nickname: "Enchantress",
      }, order),
    ).toBe(expected);
  });

  it.each([
    [{ givenName: "Prince" }, "Prince"],
    [{ familyName: "Hopper" }, "Hopper"],
    [{ middleName: "Byron" }, "Byron"],
    [{ nickname: " Sunny " }, "Sunny"],
    [{ givenName: " ", familyName: "", nickname: " " }, "Unnamed person"],
    [{}, "Unnamed person"],
  ])("keeps partial identity %j honest", (person, expected) => {
    for (
      const order of [
        "given_family_nickname",
        "family_given_nickname",
      ] as PersonNameOrder[]
    ) {
      expect(displayPersonName(person, order)).toBe(expected);
    }
  });
});

describe("PEOPLE-007 the initials an avatar shows", () => {
  it.each([
    ["Ada Lovelace", "AL"],
    ["Lovelace Ada Byron", "LB"],
    ["Ada Byron Lovelace “Enchantress”", "AL"],
    ["“Enchantress”", "E"],
    ["prince", "P"],
    ["  ", "?"],
    ["Unnamed person", "UP"],
    ["Élodie d’Arc", "ÉD"],
  ])(
    "draws %j as %j, from the name as the member reads it",
    (name, expected) => {
      expect(nameInitials(name)).toBe(expected);
    },
  );
});
