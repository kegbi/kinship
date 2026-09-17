import { workspaceLifecycleImpact } from "../../../../platform/postgres/lifecycle_impact.ts";

/** What a workspace cascade destroys in people, table by table. */
export const PostgresPeopleWorkspaceLifecycleImpact = workspaceLifecycleImpact({
  counts: { people: "crm.people" },
  revision: {
    people: "crm.people@id",
    avatars: "crm.person_avatars@person_id via crm.people.person_id",
    dates: "crm.person_dates@id via crm.people.person_id",
    meetings: "crm.person_first_meetings@person_id via crm.people.person_id",
    contacts: "crm.person_contact_methods@id via crm.people.person_id",
    contactLabels:
      "crm.person_contact_method_labels@contact_method_id,label_id via crm.person_contact_methods.contact_method_id via crm.people.person_id",
    locations: "crm.locations@id",
    addresses: "crm.person_addresses@id via crm.people.person_id",
    addressLabels:
      "crm.person_address_labels@address_id,label_id via crm.person_addresses.address_id via crm.people.person_id",
    organizations: "crm.organizations@id",
    occupations: "crm.person_occupations@id via crm.people.person_id",
    tags: "crm.tags@id",
    personTags: "crm.person_tags@person_id,tag_id via crm.people.person_id",
    pets: "crm.pets@id via crm.people.person_id",
  },
});
