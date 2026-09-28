/**
 * A member's calendar feed, managed from the integrations settings page
 * (GAP-052, `INTEGRATION-002`).
 *
 * Four routes: read whether a feed is live, create one, rotate it, and
 * revoke it. Every member manages only their own feed, so there is no
 * administrative gate; the session names whose feed it is. The subscription
 * URL is built from the configured public web origin, which is also where the
 * gateway serves the API, and is returned only by the two answers that mint a
 * secret. Nothing here is cached.
 */

import { type Context, Hono } from "hono";
import type { CalendarFeedRecord, CalendarFeedTokens } from "../../public.ts";
import type { createProtectedSessionCoordinator } from "../../../workspaces/public.ts";
import {
  createCalendarFeed,
  getCalendarFeed,
  revokeCalendarFeed,
  rotateCalendarFeed,
} from "../../../../../contracts/routes/calendar_feeds.ts";
import type { BrowserSecurityPolicy } from "../../../../../http-kit/security_policy.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import { requireMatchingOrigin } from "../../../../../http-kit/origin.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  requireActor,
  sessionActor,
} from "../../../../../http-kit/session.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;
export interface CalendarFeedHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly calendarFeeds: CalendarFeedTokens;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
}

const FEED_UNAVAILABLE: ProblemDefinition = {
  code: "calendar_feed_settings_unavailable",
  detail: "Your calendar feed could not be loaded or changed. Try again.",
  status: 503,
  title: "Calendar feed unavailable",
};

/** What a refused calendar-feed request says. */
export const CALENDAR_FEED_FAILURES: FailureTable = {
  fallback: FEED_UNAVAILABLE,
  statuses: {
    conflict: {
      code: "calendar_feed_exists",
      detail: "You already have a calendar feed. Rotate it for a new link.",
      title: "Calendar feed exists",
    },
    forbidden: {
      code: "calendar_feed_forbidden",
      detail: "Your active workspace membership no longer permits this.",
      title: "Calendar feed unavailable",
    },
    "not-found": {
      code: "calendar_feed_not_found",
      detail: "You have no calendar feed in this workspace.",
      title: "Calendar feed not found",
    },
  },
};

/** Every problem this file answers on its own, for the pinning suite. */
export const CALENDAR_FEED_SETTINGS_PROBLEMS: readonly ProblemDefinition[] = [
  FEED_UNAVAILABLE,
];

const failure = failureResponder(CALENDAR_FEED_FAILURES);

function shown(feed: CalendarFeedRecord) {
  return {
    createdAt: feed.createdAt,
    ...(feed.lastUsedAt ? { lastUsedAt: feed.lastUsedAt } : {}),
  };
}

export function createCalendarFeedSettingsRoutes(
  services: CalendarFeedHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);
  const url = (secret: string) =>
    new URL(
      `/api/v1/calendar-feeds/${secret}.ics`,
      services.browserSecurity.origin,
    ).href;

  /** Creating and rotating both mint a secret and answer its URL once. */
  const issue = async (
    context: Context<ActorEnv>,
    use: "create" | "rotate",
  ) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.calendarFeeds[use](actor).catch(() =>
      undefined
    );
    if (!result) return definedProblem(context, FEED_UNAVAILABLE);
    if (result.status !== "created" && result.status !== "rotated") {
      return failure(context, result.status);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      feed: shown(result.feed),
      status: result.status,
      url: url(result.secret),
    }, 201);
  };

  mount(routes, getCalendarFeed, session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.calendarFeeds.current(actor).catch(() =>
      undefined
    );
    if (!result) return definedProblem(context, FEED_UNAVAILABLE);
    if (result.status !== "ready") return failure(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json({
      ...(result.feed ? { feed: shown(result.feed) } : {}),
      status: "ready",
    });
  });

  mount(
    routes,
    createCalendarFeed,
    origin,
    session,
    (context) => issue(context, "create"),
  );

  mount(
    routes,
    rotateCalendarFeed,
    origin,
    session,
    (context) => issue(context, "rotate"),
  );

  mount(routes, revokeCalendarFeed, origin, session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.calendarFeeds.revoke(actor).catch(() =>
      undefined
    );
    if (!result) return definedProblem(context, FEED_UNAVAILABLE);
    if (result.status !== "revoked") return failure(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json({ status: "revoked" });
  });
  return routes;
}
