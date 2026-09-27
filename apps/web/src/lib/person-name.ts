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

/**
 * The initials an avatar shows (GAP-045): the first letter of the first and
 * last word of the name the member reads, in their own name order. A quoted
 * nickname after a formal name is not part of it, and punctuation is skipped,
 * so "Ada Lovelace “Enchantress”" is AL rather than A“.
 */
export function nameInitials(name: string): string {
  const formal = name.replace(/\s+“[^”]*”\s*$/u, "");
  const letters = formal.trim().split(/\s+/).flatMap((word) => {
    const letter = /[\p{L}\p{N}]/u.exec(word)?.[0];
    return letter ? [letter] : [];
  });
  if (letters.length === 0) return "?";
  return `${letters[0]}${letters.length > 1 ? letters.at(-1) : ""}`
    .toLocaleUpperCase();
}
