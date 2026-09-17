import { referenceCounter } from "../../../../platform/postgres/reference_counter.ts";

/**
 * Where people's rows name a workspace personalization entry.
 *
 * A contact method carries the type it was recorded under, and a person may
 * only have one primary method of each type, so a replacement that would leave
 * a person primary twice under one type is refused rather than applied. The
 * two label junctions have no `updated_at` and may already carry the
 * replacement, so they are re-pointed by insert and delete.
 */
export const PostgresPeoplePersonalizationReferences = referenceCounter({
  "contact-labels": {
    sites: [
      {
        column: "label_id",
        junctionKey: "contact_method_id",
        source:
          "crm.person_contact_method_labels via crm.person_contact_methods.contact_method_id via crm.people.person_id",
      },
      {
        column: "label_id",
        junctionKey: "address_id",
        source:
          "crm.person_address_labels via crm.person_addresses.address_id via crm.people.person_id",
      },
    ],
  },
  "contact-method-types": {
    conflict: { keyColumns: ["person_id"], whenTrue: "is_primary" },
    sites: [{
      column: "type_id",
      source: "crm.person_contact_methods via crm.people.person_id",
    }],
  },
  "gender-options": {
    sites: [{ column: "gender_option_id", source: "crm.people" }],
  },
  "pet-categories": {
    sites: [{
      column: "category_id",
      source: "crm.pets via crm.people.person_id",
    }],
  },
});
