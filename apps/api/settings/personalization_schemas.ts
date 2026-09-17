/**
 * The bodies each personalization section accepts.
 *
 * Nine sections with four shapes between them — a named option, a name on its
 * own, a relationship's two labels, and a reminder's lead time — chosen by
 * section rather than by route, so a new section is an entry here rather than
 * four more routes. Two sections accept nothing at all: their options are
 * seeded and may only be enabled or disabled.
 *
 * Every update must change something, which is what `atLeastOneUpdate` is
 * for: a body carrying only the version it was decided against is a no-op the
 * route refuses rather than an edit it applies.
 */

import { z } from "zod";
import type { PersonalizationSection } from "../../../packages/backend/modules/workspaces/public.ts";

const personalizationName = z.string().trim().min(1).max(200);
const personalizationOrder = z.number().int().min(0).max(10_000);
const personalizationDays = z.number().int().min(0).max(3650);
const expectedUpdatedAt = z.string().datetime({ offset: true });
const namedCreate = z.object({
  name: personalizationName,
  sortOrder: personalizationOrder.optional(),
}).strict();
const nameOnlyCreate = z.object({ name: personalizationName }).strict();
const relationshipCreate = z.object({
  forwardLabel: personalizationName,
  reverseLabel: personalizationName,
  sortOrder: personalizationOrder.optional(),
}).strict();
const reminderCreate = z.object({ daysBefore: personalizationDays }).strict();
const atLeastOneUpdate = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ expectedUpdatedAt, ...shape }).strict().refine(
    (value) => Object.keys(value).length > 1,
  );
const namedUpdate = atLeastOneUpdate({
  isActive: z.boolean().optional(),
  name: personalizationName.optional(),
  sortOrder: personalizationOrder.optional(),
});
const genderUpdate = atLeastOneUpdate({
  isActive: z.boolean().optional(),
  isDefault: z.literal(true).optional(),
  name: personalizationName.optional(),
  sortOrder: personalizationOrder.optional(),
});
const nameOnlyUpdate = atLeastOneUpdate({
  name: personalizationName.optional(),
});
const relationshipUpdate = atLeastOneUpdate({
  forwardLabel: personalizationName.optional(),
  isActive: z.boolean().optional(),
  reverseLabel: personalizationName.optional(),
  sortOrder: personalizationOrder.optional(),
}).refine(
  (value) =>
    (value.forwardLabel === undefined) === (value.reverseLabel === undefined),
);
const reminderUpdate = atLeastOneUpdate({
  daysBefore: personalizationDays.optional(),
  isActive: z.boolean().optional(),
});
export const personalizationCreateSchema = (
  section: PersonalizationSection,
) => {
  if (section === "relationship-types") return relationshipCreate;
  if (section === "reminder-rules") return reminderCreate;
  if (section === "contact-labels" || section === "tags") {
    return nameOnlyCreate;
  }
  if (section === "emotion-options" || section === "pet-categories") {
    return z.never();
  }
  return namedCreate;
};
export const personalizationUpdateSchema = (
  section: PersonalizationSection,
) => {
  if (section === "gender-options") return genderUpdate;
  if (section === "contact-labels" || section === "tags") {
    return nameOnlyUpdate;
  }
  if (section === "relationship-types") return relationshipUpdate;
  if (section === "reminder-rules") return reminderUpdate;
  if (section === "emotion-options" || section === "pet-categories") {
    return z.never();
  }
  return namedUpdate;
};
export const personalizationDeleteSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  replacementId: z.string().uuid().optional(),
}).strict();
