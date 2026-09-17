/**
 * The shapes a profile fact takes.
 *
 * A profile fact is one entry in one section of a person's profile, and each
 * section stores something different: a contact method, an address, where two
 * people first met, what somebody will not eat, a job, a pet, a set of tags.
 * They are one union because every section is normalized, validated, stored,
 * and audited through the same path, and the section decides which member of
 * the union a value is.
 *
 * Nothing here is a rule; `normalize.ts` and `validate.ts` hold those. This
 * file is the vocabulary all three layers share, which is why the ports and
 * the use cases can both speak it without either owning it.
 */

/** The profile sections a fact can belong to. */
export type ProfileFactSection =
  | "addresses"
  | "contact-methods"
  | "first-meeting"
  | "food-preferences"
  | "pets"
  | "tags"
  | "work";

/** A workspace vocabulary entry a fact may point at. */
export interface ProfileFactOption {
  readonly id: string;
  readonly kind?:
    | "contact-label"
    | "contact-type"
    | "organization"
    | "pet-category";
  readonly name: string;
}

export interface ContactMethodFact {
  readonly isPrimary: boolean;
  readonly labelIds: readonly string[];
  readonly notes?: string;
  readonly typeId: string;
  readonly value: string;
}

export interface AddressFact {
  readonly city?: string;
  readonly country?: string;
  readonly displayName?: string;
  readonly isPrimary: boolean;
  readonly labelIds: readonly string[];
  readonly postalCode?: string;
  readonly region?: string;
  readonly street?: string;
}

export interface FirstMeetingFact {
  readonly introducedByPersonId?: string;
  readonly notes?: string;
  readonly placeText?: string;
}

export interface FoodPreferencesFact {
  readonly foodPreferences: string;
}

export interface OccupationFact {
  readonly description?: string;
  readonly endOn?: string;
  readonly isCurrent: boolean;
  readonly organizationId?: string;
  readonly organizationName?: string;
  readonly startOn?: string;
  readonly title: string;
}

export interface PetFact {
  readonly categoryId?: string;
  readonly name?: string;
  readonly notes?: string;
}

export interface TagsFact {
  readonly tagIds: readonly string[];
}

export type ProfileFactValue =
  | AddressFact
  | ContactMethodFact
  | FirstMeetingFact
  | FoodPreferencesFact
  | OccupationFact
  | PetFact
  | TagsFact;

/** A stored fact, with the vocabulary entries a reader resolved for it. */
export interface ProfileFactRecord {
  readonly id: string;
  readonly referencesResolved?: boolean;
  readonly section: ProfileFactSection;
  readonly selectedOptions?: readonly ProfileFactOption[];
  readonly updatedAt: string;
  readonly value: ProfileFactValue;
}
