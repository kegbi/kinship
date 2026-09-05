import type { MemberPreferences } from "../../../../packages/contracts/generated/auth-client.ts";

export type PersonNameOrder = MemberPreferences["contactNameOrder"];

export function displayPersonName(
  person: {
    readonly givenName?: string;
    readonly middleName?: string;
    readonly familyName?: string;
    readonly nickname?: string;
  },
  order: PersonNameOrder,
): string {
  const parts = order === "family_given_nickname"
    ? [person.familyName, person.givenName, person.middleName]
    : [person.givenName, person.middleName, person.familyName];
  const formal = parts.map((part) => part?.trim()).filter(Boolean).join(" ");
  const nickname = person.nickname?.trim();
  return formal
    ? `${formal}${nickname ? ` “${nickname}”` : ""}`
    : nickname || "Unnamed person";
}
