/**
 * The seven shapes a profile fact is written in, and the one it is read in.
 *
 * Seven sections with seven bodies, each strict, each refusing an empty fact
 * in its own words, and each spelled twice — once for a create that may not
 * carry an identifier, once for an update that must. The bodies themselves
 * moved to `packages/contracts/schemas/people.ts` in GAP-022, where the same
 * Zod is what the route parses with and what the published document
 * advertises; a base and a factory can no longer keep the two spellings in
 * step, so what is left here is the table that names them.
 *
 * The table is what makes a section a schema rather than four more routes:
 * `facts.ts` reads the path's section and parses the body with the entry that
 * section names.
 */

import type { ProfileFactRecord } from "../../public.ts";
import {
  addressFactCreateInput,
  addressFactUpdateInput,
  contactMethodFactCreateInput,
  contactMethodFactUpdateInput,
  firstMeetingFactCreateInput,
  firstMeetingFactUpdateInput,
  foodPreferencesFactCreateInput,
  foodPreferencesFactUpdateInput,
  occupationFactCreateInput,
  occupationFactUpdateInput,
  petFactCreateInput,
  petFactUpdateInput,
  tagsFactCreateInput,
  tagsFactUpdateInput,
} from "../../../../../contracts/schemas/people.ts";

/** The body a new fact arrives in, by the section that owns it. */
export const profileFactCreateSchemas = {
  addresses: addressFactCreateInput,
  "contact-methods": contactMethodFactCreateInput,
  "first-meeting": firstMeetingFactCreateInput,
  "food-preferences": foodPreferencesFactCreateInput,
  pets: petFactCreateInput,
  tags: tagsFactCreateInput,
  work: occupationFactCreateInput,
} as const;

/** The same, for a change to a fact that already has an identifier. */
export const profileFactUpdateSchemas = {
  addresses: addressFactUpdateInput,
  "contact-methods": contactMethodFactUpdateInput,
  "first-meeting": firstMeetingFactUpdateInput,
  "food-preferences": foodPreferencesFactUpdateInput,
  pets: petFactUpdateInput,
  tags: tagsFactUpdateInput,
  work: occupationFactUpdateInput,
} as const;

export function publicProfileFact(record: ProfileFactRecord) {
  return { ...record, value: { section: record.section, ...record.value } };
}
