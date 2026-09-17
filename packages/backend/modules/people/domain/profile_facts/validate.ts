/**
 * Whether a normalized profile fact says enough to be stored.
 *
 * Each section has one question worth asking: a contact method without a value
 * is not a contact method, an address with no line at all names nowhere, a pet
 * needs either a name or a category to be a pet, and a job that ends before it
 * starts is a typo. A food preference is the odd one out — clearing it is a
 * separate action, so an empty one is a mistake rather than a deletion.
 *
 * The self-introduction rule sits here too: a person cannot be the one who
 * introduced them, and that answer overrides anything else the section might
 * have said.
 */

import type { ValidationErrors } from "../../../../shared-kernel/result.ts";
import type {
  AddressFact,
  ContactMethodFact,
  FirstMeetingFact,
  FoodPreferencesFact,
  OccupationFact,
  PetFact,
  ProfileFactSection,
  ProfileFactValue,
} from "./values.ts";

/** The field errors a normalized value carries for its section. */
export function validateProfileFact(
  section: ProfileFactSection,
  value: ProfileFactValue,
  personId: string,
): ValidationErrors {
  if (
    section === "first-meeting" &&
    (value as FirstMeetingFact).introducedByPersonId === personId
  ) return { introducedByPersonId: "Choose another person." };
  const errors: Record<string, string> = {};
  if (section === "contact-methods" && !(value as ContactMethodFact).value) {
    errors.value = "Enter a contact value.";
  }
  if (
    section === "food-preferences" &&
    !(value as FoodPreferencesFact).foodPreferences
  ) {
    errors.foodPreferences = "Enter a food preference or use Clear.";
  }
  if (section === "work" && !(value as OccupationFact).title) {
    errors.title = "Enter a role or title.";
  }
  if (section === "work") {
    const work = value as OccupationFact;
    if (work.startOn && work.endOn && work.endOn < work.startOn) {
      errors.endOn = "End date must be on or after the start date.";
    }
  }
  if (section === "addresses") {
    const address = value as AddressFact;
    if (
      ![
        address.displayName,
        address.street,
        address.city,
        address.region,
        address.postalCode,
        address.country,
      ].some(Boolean)
    ) {
      errors.address = "Enter an address name or location detail.";
    }
  }
  if (section === "pets") {
    const pet = value as PetFact;
    if (!pet.name && !pet.categoryId) {
      errors.pet = "Enter a pet name or select a category.";
    }
  }
  return errors;
}
