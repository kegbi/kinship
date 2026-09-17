/**
 * The seven shapes a profile fact is written in, and the one it is read in.
 *
 * Seven sections with seven bodies, each strict, each refusing an empty fact
 * in its own words, and each spelled twice — once for a create that may not
 * carry an identifier, once for an update that must. The table is generated
 * from one base so the two spellings cannot drift, and it lives beside the
 * routes rather than inside them because it is longer than they are.
 */

import { z } from "zod";
import type { ProfileFactRecord } from "../../../packages/backend/modules/people/public.ts";
import { expectedUpdatedAtSchema } from "./shared.ts";

export const profileFactSectionSchema = z.enum([
  "addresses",
  "contact-methods",
  "first-meeting",
  "food-preferences",
  "pets",
  "tags",
  "work",
]);
export const profileFactListQuerySchema = z.object({
  cursor: z.string().max(2_000).optional(),
  includeOptions: z.enum(["true"]).optional(),
  optionCursor: z.string().max(2_000).optional(),
  optionSearch: z.string().trim().max(200).optional(),
}).strict().superRefine((query, context) => {
  if (query.optionCursor && query.includeOptions !== "true") {
    context.addIssue({
      code: "custom",
      message: "Option continuation requires includeOptions=true.",
      path: ["optionCursor"],
    });
  }
});
const optionalText = z.string().trim().max(2_000).optional();
const profileFactCreateBaseSchema = z.object({
  expectedPersonUpdatedAt: expectedUpdatedAtSchema,
});
const profileFactUpdateBaseSchema = profileFactCreateBaseSchema.extend({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  id: z.uuid(),
});
const profileFactSchemas = (profileFactBaseSchema: z.ZodObject) => ({
  addresses: profileFactBaseSchema.extend({
    city: z.string().trim().max(200).optional(),
    country: z.string().trim().max(200).optional(),
    displayName: z.string().trim().max(200).optional(),
    isPrimary: z.boolean(),
    labelIds: z.array(z.uuid()).max(20),
    postalCode: z.string().trim().max(50).optional(),
    region: z.string().trim().max(200).optional(),
    section: z.literal("addresses"),
    street: z.string().trim().max(500).optional(),
  }).strict().refine((value) =>
    Boolean(
      value.city || value.country || value.displayName || value.postalCode ||
        value.region || value.street,
    ), { message: "Enter an address detail." }),
  "contact-methods": profileFactBaseSchema.extend({
    isPrimary: z.boolean(),
    labelIds: z.array(z.uuid()).max(20),
    notes: optionalText,
    section: z.literal("contact-methods"),
    typeId: z.uuid(),
    value: z.string().trim().min(1).max(2_000),
  }).strict(),
  "first-meeting": profileFactBaseSchema.extend({
    introducedByPersonId: z.uuid().optional(),
    notes: optionalText,
    placeText: z.string().trim().max(500).optional(),
    section: z.literal("first-meeting"),
  }).strict().refine(
    (value) =>
      Boolean(value.introducedByPersonId || value.notes || value.placeText),
    { message: "Enter first-meeting context." },
  ),
  "food-preferences": profileFactBaseSchema.extend({
    foodPreferences: z.string().trim().min(1).max(2_000),
    section: z.literal("food-preferences"),
  }).strict(),
  pets: profileFactBaseSchema.extend({
    categoryId: z.uuid().optional(),
    name: z.string().trim().max(200).optional(),
    notes: optionalText,
    section: z.literal("pets"),
  }).strict().refine(
    (value) => Boolean(value.categoryId || value.name),
    {
      message: "Enter a pet detail.",
    },
  ),
  tags: profileFactBaseSchema.extend({
    section: z.literal("tags"),
    tagIds: z.array(z.uuid()).max(500),
  }).strict(),
  work: profileFactBaseSchema.extend({
    description: optionalText,
    endOn: z.iso.date().optional(),
    isCurrent: z.boolean(),
    organizationId: z.uuid().optional(),
    organizationName: z.string().trim().max(200).optional(),
    section: z.literal("work"),
    startOn: z.iso.date().optional(),
    title: z.string().trim().min(1).max(200),
  }).strict(),
} as const);
export const profileFactCreateSchemas = profileFactSchemas(
  profileFactCreateBaseSchema,
);
export const profileFactUpdateSchemas = profileFactSchemas(
  profileFactUpdateBaseSchema,
);
export const profileFactDeleteSchema = z.object({
  expectedPersonUpdatedAt: expectedUpdatedAtSchema,
  expectedUpdatedAt: expectedUpdatedAtSchema,
  section: profileFactSectionSchema,
}).strict();

export function publicProfileFact(record: ProfileFactRecord) {
  return { ...record, value: { section: record.section, ...record.value } };
}
