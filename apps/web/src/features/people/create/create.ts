/**
 * Adding a person, the pure half (GAP-033): the identity a form carries and
 * the checks it passes before anything is sent. Nothing here touches the
 * DOM.
 *
 * Kinship never invents a name. A person needs at least one of a given
 * name, a family name, or a nickname, and one without a given name must be
 * marked partial, so an unknown given name stays visibly unknown.
 */

import type {
  PersonIdentity,
  PersonInput,
} from "../../../../../../packages/contracts/generated/auth-client.ts";

/** The identity fields the create form carries, as typed. */
export interface CreateValues {
  readonly givenName: string;
  readonly middleName: string;
  readonly familyName: string;
  readonly nickname: string;
  readonly isPartial: boolean;
}

function optional(value: string): string | undefined {
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

/** The request the form's values make; blank optional names are left out. */
export function personInput(
  values: CreateValues,
  duplicateOverride = false,
): PersonInput {
  const familyName = optional(values.familyName);
  const middleName = optional(values.middleName);
  const nickname = optional(values.nickname);
  return {
    ...(duplicateOverride ? { duplicateOverride: true } : {}),
    ...(familyName ? { familyName } : {}),
    givenName: values.givenName.trim(),
    isPartial: values.isPartial,
    ...(middleName ? { middleName } : {}),
    ...(nickname ? { nickname } : {}),
  };
}

/** What stops a person from being sent, by field; empty when nothing does. */
export function localErrors(
  person: PersonInput,
): Readonly<Record<string, string>> {
  if (!person.givenName && !person.familyName && !person.nickname) {
    return { givenName: "Enter a given name, family name, or nickname." };
  }
  if (!person.givenName && !person.isPartial) {
    return {
      isPartial:
        "Mark this person as partial when their given name is unknown.",
    };
  }
  return {};
}

/** How a created person is named in the "created" line. */
export function createdName(person: PersonIdentity): string {
  const formal = [person.givenName, person.familyName].filter(Boolean).join(
    " ",
  );
  return formal || person.nickname || "Unnamed person";
}

/** The fields a problem's errors may name; any other key is ignored. */
export const CREATE_FIELDS = [
  "givenName",
  "middleName",
  "familyName",
  "nickname",
  "isPartial",
] as const;

export const ERROR_SUMMARY =
  "Review the highlighted identity fields and try again.";

export const CREATE_FAILED = "The person could not be created. Try again.";
