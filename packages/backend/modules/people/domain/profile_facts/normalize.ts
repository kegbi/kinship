/**
 * The canonical spelling of a profile fact.
 *
 * Every section normalizes the same way in spirit: text is trimmed, text that
 * is blank once trimmed is dropped rather than stored as an empty string, and
 * a list of references keeps only its distinct entries. What differs is which
 * fields a section has, so the rule is written once per section here and the
 * use case never sees a raw value again.
 *
 * Two fields are deliberately not trimmed away: a contact method's value and
 * an occupation's title are trimmed but kept even when empty, because
 * `validate.ts` is what tells the member to enter one.
 */

import { optionalText } from "../../../../shared-kernel/validation.ts";
import type {
  AddressFact,
  ContactMethodFact,
  FirstMeetingFact,
  FoodPreferencesFact,
  OccupationFact,
  PetFact,
  ProfileFactSection,
  ProfileFactValue,
  TagsFact,
} from "./values.ts";

/** The stored form of the value a member submitted for this section. */
export function normalizeProfileFact(
  section: ProfileFactSection,
  input: ProfileFactValue,
): ProfileFactValue {
  if (section === "food-preferences") {
    const fact = input as FoodPreferencesFact;
    const foodPreferences = optionalText(fact.foodPreferences);
    return { foodPreferences: foodPreferences ?? "" };
  }
  if (section === "first-meeting") {
    const fact = input as FirstMeetingFact;
    const notes = optionalText(fact.notes);
    const placeText = optionalText(fact.placeText);
    return {
      ...(fact.introducedByPersonId
        ? { introducedByPersonId: fact.introducedByPersonId }
        : {}),
      ...(notes ? { notes } : {}),
      ...(placeText ? { placeText } : {}),
    };
  }
  if (section === "tags") {
    return { tagIds: [...new Set((input as TagsFact).tagIds)] };
  }
  if (section === "contact-methods") {
    const fact = input as ContactMethodFact;
    return {
      isPrimary: fact.isPrimary,
      labelIds: [...new Set(fact.labelIds)],
      ...(optionalText(fact.notes) ? { notes: optionalText(fact.notes) } : {}),
      typeId: fact.typeId,
      value: fact.value.trim(),
    };
  }
  if (section === "addresses") {
    const fact = input as AddressFact;
    const city = optionalText(fact.city);
    const country = optionalText(fact.country);
    const displayName = optionalText(fact.displayName);
    const postalCode = optionalText(fact.postalCode);
    const region = optionalText(fact.region);
    const street = optionalText(fact.street);
    return {
      ...(city ? { city } : {}),
      ...(country ? { country } : {}),
      ...(displayName ? { displayName } : {}),
      isPrimary: fact.isPrimary,
      labelIds: [...new Set(fact.labelIds)],
      ...(postalCode ? { postalCode } : {}),
      ...(region ? { region } : {}),
      ...(street ? { street } : {}),
    };
  }
  if (section === "work") {
    const fact = input as OccupationFact;
    const description = optionalText(fact.description);
    const organizationName = optionalText(fact.organizationName);
    return {
      ...(description ? { description } : {}),
      ...(fact.endOn ? { endOn: fact.endOn } : {}),
      isCurrent: fact.isCurrent,
      ...(fact.organizationId ? { organizationId: fact.organizationId } : {}),
      ...(organizationName ? { organizationName } : {}),
      ...(fact.startOn ? { startOn: fact.startOn } : {}),
      title: fact.title.trim(),
    };
  }
  const fact = input as PetFact;
  const name = optionalText(fact.name);
  const notes = optionalText(fact.notes);
  return {
    ...(fact.categoryId ? { categoryId: fact.categoryId } : {}),
    ...(name ? { name } : {}),
    ...(notes ? { notes } : {}),
  };
}
