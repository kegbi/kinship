/**
 * Legal acceptance and the audit history: the shapes this surface accepts and
 * answers with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/governance` and out of the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";
import { interactionParticipant } from "./interactions.ts";
import { oneOf } from "./shared.ts";

/**
 * The two legal documents a path may name.
 *
 * It carries no `id` because `getPublicLegalDocument` inlines it into its path
 * parameter rather than naming a component, and the governance routes parse
 * `{documentType}` with this exact schema.
 */
export const legalDocumentType = z.enum(["privacy", "terms"]);

/**
 * The one document an acceptance names.
 *
 * `acceptLegalDocument` inlines the same shape into its request body, so this
 * carries no `id` either: it exists so the route and the descriptor parse the
 * same thing.
 */
export const legalAcceptanceInput = z.strictObject({
  documentId: z.uuid(),
});

export const auditDateDetail = z.strictObject({
  isYearApproximate: z.boolean(),
  precision: z.enum([
    "day",
    "full",
    "month",
    "month_day",
    "unknown",
    "year",
    "year_month",
  ]),
}).meta({ id: "AuditDateDetail" });

export const auditTransitionDetail = oneOf([
  z.null(),
  z.enum(["active", "archived", "deleted"]),
  auditDateDetail,
]).meta({ id: "AuditTransitionDetail" });

export const auditEvent = z.strictObject({
  action: z.string(),
  actor: z.strictObject({
    id: z.uuid().optional(),
    name: z.string(),
  }),
  details: z.strictObject({
    action: z.enum([
      "changed",
      "completed",
      "create",
      "created",
      "delete",
      "reopened",
      "save",
      "update",
    ]).optional(),
    current: z.boolean().optional(),
    from: auditTransitionDetail.optional(),
    fromPersonId: z.uuid().optional(),
    isPartial: z.boolean().optional(),
    kind: z.enum(["activity", "call", "conversation", "note"]).optional(),
    participantIds: z.array(z.uuid()).max(50).optional(),
    personId: z.uuid().optional(),
    relationshipTypeId: z.uuid().optional(),
    role: z.enum(["admin", "member", "owner"]).optional(),
    section: z.enum([
      "activity-types",
      "addresses",
      "contact-labels",
      "contact-method-types",
      "contact-methods",
      "emotion-options",
      "first-meeting",
      "food-preferences",
      "gender-options",
      "identity-summary",
      "life-event-types",
      "pet-categories",
      "pets",
      "profile-modules",
      "relationship-types",
      "reminder-rules",
      "security",
      "tags",
      "work",
    ]).optional(),
    status: z.enum(["active", "cancelled", "completed", "open", "suspended"])
      .optional(),
    to: auditTransitionDetail.optional(),
    toPersonId: z.uuid().optional(),
  }),
  id: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
  person: interactionParticipant.optional(),
  redacted: z.boolean(),
  subject: z.strictObject({
    id: z.uuid().optional(),
    type: z.string().optional(),
  }),
}).meta({ id: "AuditEvent" });

export const auditHistory = z.strictObject({
  items: z.array(auditEvent).max(50),
  nextCursor: z.string().optional(),
  person: interactionParticipant.optional(),
  status: z.enum(["archived", "ready"]),
}).meta({ id: "AuditHistory" });

export const legalAccepted = z.strictObject({
  acceptedAt: z.iso.datetime({ offset: true }),
  documentId: z.uuid(),
  status: z.enum(["accepted", "already-accepted"]),
}).meta({ id: "LegalAccepted" });

export const legalDocument = z.strictObject({
  content: z.string(),
  documentType: z.string(),
  id: z.uuid(),
  publishedAt: z.iso.datetime({ offset: true }).optional(),
  version: z.string(),
}).meta({ id: "LegalDocument" });

export const legalDocumentReady = z.strictObject({
  document: legalDocument,
  status: z.literal("ready"),
}).meta({ id: "LegalDocumentReady" });

export const legalRequirements = z.strictObject({
  documents: z.array(legalDocument),
  status: z.literal("ready"),
}).meta({ id: "LegalRequirements" });
