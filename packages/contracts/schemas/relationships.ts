/**
 * Relationships between people: the shapes this surface accepts and answers
 * with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/relationships` and out of
 * the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";
import { personIdentity, personInput } from "./people.ts";

export const relationship = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  forwardLabel: z.string(),
  fromPersonId: z.uuid(),
  id: z.uuid(),
  relationshipTypeId: z.uuid(),
  relationshipTypeArchived: z.boolean(),
  reverseLabel: z.string(),
  status: z.enum(["active", "ended"]),
  toPersonId: z.uuid(),
  updatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "Relationship" });

export const relationshipDisplay = z.strictObject({
  label: z.string(),
  name: z.string().optional(),
  personId: z.uuid(),
  relationshipId: z.uuid(),
}).meta({ id: "RelationshipDisplay" });

export const relatedPersonRelationshipChanged = z.strictObject({
  affectedPersonIds: z.array(z.uuid()).min(2).max(2),
  forward: relationshipDisplay,
  inverse: relationshipDisplay,
  person: personIdentity,
  relationship: relationship,
  status: z.literal("created"),
}).meta({ id: "RelatedPersonRelationshipChanged" });

/**
 * The person a related-person write creates. It is the person-create input
 * without `requestId`: this route creates the person and the edge in one
 * transaction and keeps no request receipt, so it refuses a retry key rather
 * than accept one it would not honor.
 */
const relatedPersonInput = personInput.omit({ requestId: true }).meta({
  id: "RelatedPersonInput",
});

export const relatedPersonRelationshipInput = z.strictObject({
  person: relatedPersonInput,
  relationshipTypeId: z.uuid(),
}).meta({ id: "RelatedPersonRelationshipInput" });

export const relationshipChanged = z.strictObject({
  affectedPersonIds: z.array(z.uuid()).min(2).max(2),
  forward: relationshipDisplay,
  inverse: relationshipDisplay,
  relationship: relationship,
  status: z.enum(["created", "existing", "updated"]),
}).meta({ id: "RelationshipChanged" });

export const relationshipCreateInput = z.strictObject({
  relationshipTypeId: z.uuid(),
  targetPersonId: z.uuid(),
}).meta({ id: "RelationshipCreateInput" });

export const relationshipDeleted = z.strictObject({
  affectedPersonIds: z.array(z.uuid()).min(2).max(2),
  relationshipId: z.uuid(),
  status: z.literal("deleted"),
}).meta({ id: "RelationshipDeleted" });

export const relationshipWithDisplay = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  forwardLabel: z.string(),
  fromPersonId: z.uuid(),
  id: z.uuid(),
  relationshipTypeId: z.uuid(),
  relationshipTypeArchived: z.boolean(),
  reverseLabel: z.string(),
  status: z.enum(["active", "ended"]),
  toPersonId: z.uuid(),
  updatedAt: z.iso.datetime({ offset: true }),
  display: relationshipDisplay,
}).meta({ id: "RelationshipWithDisplay" });

export const relationshipList = z.strictObject({
  nextCursor: z.string().optional(),
  relationships: z.array(relationshipWithDisplay).max(50),
  status: z.enum(["archived", "hidden", "ready"]),
}).meta({ id: "RelationshipList" });

export const relationshipType = z.strictObject({
  archived: z.boolean(),
  forwardLabel: z.string(),
  id: z.uuid(),
  reverseLabel: z.string(),
}).meta({ id: "RelationshipType" });

export const relationshipTypeList = z.strictObject({
  nextCursor: z.string().optional(),
  options: z.array(relationshipType).max(20),
  selected: z.array(relationshipType).max(20),
  status: z.enum(["hidden", "ready"]),
}).meta({ id: "RelationshipTypeList" });

export const relationshipUpdateInput = z.strictObject({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  relationshipTypeId: z.uuid(),
}).meta({ id: "RelationshipUpdateInput" });
