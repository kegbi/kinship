/**
 * The journal and its timeline: the shapes this surface accepts and answers
 * with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/journal` and out of the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";
import { oneOf } from "./shared.ts";

/**
 * The activity a journal link names.
 *
 * `linkJournalActivity` inlines this shape rather than naming a component, so
 * it carries no `id`.
 */
export const journalActivityInput = z.strictObject({
  activityId: z.uuid(),
});

export const journalActivityItem = z.strictObject({
  activity: z.strictObject({
    id: z.uuid(),
    summary: z.string(),
  }),
  id: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
  type: z.literal("activity"),
}).meta({ id: "JournalActivityItem" });

export const journalActivityLinked = z.strictObject({
  activityId: z.uuid(),
  id: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
  status: z.literal("created"),
}).meta({ id: "JournalActivityLinked" });

export const journalDayRatingInput = z.strictObject({
  comment: z.string().trim().min(1).max(10000).optional(),
  ratedOn: z.iso.date(),
  rating: z.number().int().min(1).max(5),
}).meta({ id: "JournalDayRatingInput" });

export const journalDayRatingItem = z.strictObject({
  dayRating: z.strictObject({
    comment: z.string().optional(),
    id: z.uuid(),
    ratedOn: z.iso.date(),
    rating: z.number().int().min(1).max(5),
  }),
  id: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
  type: z.literal("day-rating"),
}).meta({ id: "JournalDayRatingItem" });

export const journalStoredDayRating = z.strictObject({
  comment: z.string().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  ratedOn: z.iso.date(),
  rating: z.number().int().min(1).max(5),
  updatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "JournalStoredDayRating" });

export const journalDayRatingSaved = z.strictObject({
  rating: journalStoredDayRating,
  status: z.enum(["created", "updated"]),
}).meta({ id: "JournalDayRatingSaved" });

export const journalDeleted = z.strictObject({
  itemType: z.enum(["activity", "day-rating", "post"]),
  status: z.literal("deleted"),
}).meta({ id: "JournalDeleted" });

export const journalPostItem = z.strictObject({
  id: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
  post: z.strictObject({
    body: z.string(),
    id: z.uuid(),
    title: z.string().optional(),
    updatedAt: z.iso.datetime({ offset: true }),
  }),
  type: z.literal("post"),
}).meta({ id: "JournalPostItem" });

export const journalTimelineItem = oneOf([
  journalActivityItem,
  journalDayRatingItem,
  journalPostItem,
]).meta({
  discriminator: {
    "propertyName": "type",
    "mapping": {
      "activity": "#/components/schemas/JournalActivityItem",
      "day-rating": "#/components/schemas/JournalDayRatingItem",
      "post": "#/components/schemas/JournalPostItem",
    },
  },
  id: "JournalTimelineItem",
});

export const journalItemReady = z.strictObject({
  item: journalTimelineItem,
  status: z.literal("ready"),
}).meta({ id: "JournalItemReady" });

export const journalLinkableActivity = z.strictObject({
  happenedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  summary: z.string(),
}).meta({ id: "JournalLinkableActivity" });

export const journalStoredPost = z.strictObject({
  body: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
  title: z.string().optional(),
  updatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "JournalStoredPost" });

export const journalPostCreated = z.strictObject({
  post: journalStoredPost,
  status: z.literal("created"),
}).meta({ id: "JournalPostCreated" });

export const journalPostInput = z.strictObject({
  body: z.string().trim().min(1).max(50000),
  occurredAt: z.iso.datetime({ offset: true }),
  title: z.string().trim().min(1).max(500).optional(),
}).meta({ id: "JournalPostInput" });

export const journalPostUpdated = z.strictObject({
  post: journalStoredPost,
  status: z.literal("updated"),
}).meta({ id: "JournalPostUpdated" });

export const journalTimelineList = z.strictObject({
  activities: z.array(journalLinkableActivity).max(50),
  items: z.array(journalTimelineItem).max(50),
  nextCursor: z.string().optional(),
  status: z.literal("ready"),
}).meta({ id: "JournalTimelineList" });
