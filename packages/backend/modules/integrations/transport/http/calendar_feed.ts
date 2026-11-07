/**
 * The calendar feed a calendar application subscribes to (GAP-052,
 * `INTEGRATION-002`).
 *
 * `GET /api/v1/calendar-feeds/{secret}.ics` carries no session and reads no
 * cookie: the secret in the path is the request's whole authority. So the
 * route is careful about three things.
 *
 * - It never confirms a secret. A malformed name, an unknown, revoked, or
 *   out-of-scope token, and a member who has since left all answer the same
 *   404, and a malformed name never reaches the token check.
 * - It never logs one. The request log records the registered pattern,
 *   `/api/v1/calendar-feeds/:feedFile`, never the path; the gateway logs
 *   `/api/v1/*`.
 * - It is cheap to poll. The publication derives a strong entity tag from the
 *   read model's revision before reading any event, and a client presenting
 *   that tag gets a 304 without the feed being read or rendered (BEQ-14). The
 *   answer may be cached privately for five minutes. `Referrer-Policy:
 *   no-referrer` is the gateway's, which owns that header on every response.
 */

import { Hono } from "hono";
import type { CalendarFeedPublication } from "../../public.ts";
import { getCalendarFeedDocument } from "../../../../../contracts/routes/calendar_feeds.ts";
import { calendarFeedFile } from "../../../../../contracts/schemas/calendar_feeds.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import { parseValue } from "../../../../../http-kit/validate.ts";

export interface CalendarFeedHttpServices {
  readonly calendarFeed: Pick<CalendarFeedPublication, "publish">;
}

export const CALENDAR_FEED_NOT_FOUND: ProblemDefinition = {
  code: "calendar_feed_not_found",
  detail: "This calendar feed does not exist or has been revoked.",
  status: 404,
  title: "Calendar feed not found",
};

export const CALENDAR_FEED_UNAVAILABLE: ProblemDefinition = {
  code: "calendar_feed_unavailable",
  detail: "The calendar feed is temporarily unavailable. Try again later.",
  status: 503,
  title: "Calendar feed unavailable",
};

/** Every problem this file answers, for the pinning suite. */
export const CALENDAR_FEED_PROBLEMS: readonly ProblemDefinition[] = [
  CALENDAR_FEED_NOT_FOUND,
  CALENDAR_FEED_UNAVAILABLE,
];

const CACHE_CONTROL = "private, max-age=300";

/** Whether `If-None-Match` names this tag, compared weakly (RFC 9110 §13.1.2). */
function unchanged(header: string | undefined, tag: string): boolean {
  if (header === undefined) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((candidate) =>
    candidate.trim().replace(/^W\//, "") === tag
  );
}

export function createCalendarFeedRoutes(
  services: CalendarFeedHttpServices,
): Hono {
  const routes = new Hono();
  mount(routes, getCalendarFeedDocument, async (context) => {
    const file = parseValue(calendarFeedFile, context.req.param("feedFile"));
    if ("errors" in file) {
      return definedProblem(context, CALENDAR_FEED_NOT_FOUND);
    }
    const secret = file.data.slice(0, -".ics".length);
    const presented = context.req.header("If-None-Match");
    const result = await services.calendarFeed.publish(
      secret,
      (tag) => unchanged(presented, tag),
    ).catch(() => undefined);
    if (!result || result.status === "unavailable") {
      return definedProblem(context, CALENDAR_FEED_UNAVAILABLE);
    }
    if (result.status === "not-found") {
      return definedProblem(context, CALENDAR_FEED_NOT_FOUND);
    }
    context.header("Cache-Control", CACHE_CONTROL);
    context.header("ETag", result.tag);
    if (result.status === "not-modified") return context.body(null, 304);
    context.header("Content-Type", "text/calendar; charset=utf-8");
    return context.body(result.body, 200);
  });
  return routes;
}
