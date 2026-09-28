/**
 * The member's notifications over HTTP (GAP-053, `TODAY-002`).
 *
 * `GET /api/v1/notifications` serves the `notifications` read model, whose
 * main source is planning's delivered reminders, beside the Today regions
 * this surface already serves. There is no write here: the shell marks
 * everything shown read by saving the newest item's time as the member's
 * `notificationsReadThrough` through the `workspaces` interface-state route.
 */

import { Hono } from "hono";
import {
  listNotifications,
  listNotificationsQuery,
} from "../../../../../contracts/routes/planning.ts";
import type { Notifications } from "../../../../read-models/notifications/public.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  requireActor,
  type sessionActor,
} from "../../../../../http-kit/session.ts";
import { parseQuery } from "../../../../../http-kit/validate.ts";

export const NOTIFICATIONS_QUERY_INVALID: ProblemDefinition = {
  code: "notifications_query_invalid",
  detail: "Start again from the newest notifications.",
  status: 400,
  title: "Invalid notifications page",
};
export const NOTIFICATIONS_FORBIDDEN: ProblemDefinition = {
  code: "notifications_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Notifications unavailable",
};
export const NOTIFICATIONS_UNAVAILABLE: ProblemDefinition = {
  code: "notifications_unavailable",
  detail: "Notifications are temporarily unavailable.",
  status: 503,
  title: "Notifications unavailable",
};

/** Every problem this file answers, for the pinning suite. */
export const NOTIFICATIONS_PROBLEMS: readonly ProblemDefinition[] = [
  NOTIFICATIONS_FORBIDDEN,
  NOTIFICATIONS_QUERY_INVALID,
  NOTIFICATIONS_UNAVAILABLE,
];

export function mountNotificationRoutes(
  routes: Hono<ActorEnv>,
  session: ReturnType<typeof sessionActor>,
  notifications: Notifications | undefined,
): void {
  mount(routes, listNotifications, session, async (context) => {
    const parsed = parseQuery(context, listNotificationsQuery);
    if ("errors" in parsed) {
      return definedProblem(context, NOTIFICATIONS_QUERY_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await notifications?.list(actor, {
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
    }).catch(() => undefined);
    if (!result) return definedProblem(context, NOTIFICATIONS_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, NOTIFICATIONS_FORBIDDEN);
    }
    if (result.status === "invalid-cursor") {
      return definedProblem(context, NOTIFICATIONS_QUERY_INVALID);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
}
