/**
 * The member's calendar feed (GAP-052, `INTEGRATION-002`): the shapes its
 * settings section reads and the file name its subscription URL ends in.
 *
 * The secret is returned only inside `url`, and only in the answer that
 * minted it; the status read never carries it.
 */

import { z } from "zod";

export const calendarFeed = z.strictObject({
  createdAt: z.iso.datetime({ offset: true }),
  lastUsedAt: z.iso.datetime({ offset: true }).optional(),
}).meta({ id: "CalendarFeed" });

export const calendarFeedStatus = z.strictObject({
  feed: calendarFeed.optional(),
  status: z.literal("ready"),
}).meta({ id: "CalendarFeedStatus" });

export const calendarFeedIssued = z.strictObject({
  feed: calendarFeed,
  status: z.enum(["created", "rotated"]),
  url: z.url().meta({
    description:
      "The subscription URL, shown once. Anyone holding it can read the feed until it is rotated or revoked.",
  }),
}).meta({ id: "CalendarFeedIssued" });

export const calendarFeedRevoked = z.strictObject({
  status: z.literal("revoked"),
}).meta({ id: "CalendarFeedRevoked" });

/** The last path segment of a subscription URL: the secret, then `.ics`. */
export const calendarFeedFile = z.string().regex(
  /^kin_cal_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{16,128}\.ics$/,
).meta({
  description:
    "The feed's secret followed by `.ics`. It is the request's only credential and is never logged.",
});
