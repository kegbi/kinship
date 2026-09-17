import { referenceCounter } from "../../../../platform/postgres/reference_counter.ts";

/**
 * Where relationships name a workspace relationship type. A pair of people may
 * be related once under a type, so a replacement that would relate the same
 * pair twice is refused rather than applied.
 */
export const PostgresRelationshipPersonalizationReferences = referenceCounter({
  "relationship-types": {
    conflict: { keyColumns: ["from_person_id", "to_person_id"] },
    sites: [{ column: "relationship_type_id", source: "crm.relationships" }],
  },
});
