/**
 * Every browser a member is signed in on, and the button that ends one.
 *
 * Revoking the session the request itself arrived on is the interesting case:
 * the response clears the cookie as well, so the browser that asked to be
 * signed out is signed out rather than left holding a token the server has
 * already forgotten.
 *
 * The list is handed through untouched. It used to render each session's three
 * instants here; GAP-023 moved that into the settings use case, which is where
 * a timestamp the transport publishes is produced.
 */

import { Hono } from "hono";
import { type Context } from "hono";
import {
  listMemberSessions,
  revokeMemberSession,
} from "../../../../../../contracts/routes/settings.ts";
import { uuid } from "../../../../../../contracts/schemas/shared.ts";
import {
  expiredSessionCookie,
  sessionToken,
} from "../../../../../../http-kit/cookies.ts";
import { requireMatchingOrigin } from "../../../../../../http-kit/origin.ts";
import type { BrowserSecurityPolicy } from "../../../../../../http-kit/security_policy.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../../http-kit/problem.ts";
import { mount } from "../../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  requireActor,
  sessionActor,
} from "../../../../../../http-kit/session.ts";
import { parseValue } from "../../../../../../http-kit/validate.ts";
import { privateJson, type SettingsHttpServices } from "./shared.ts";

/** What a member's signed-in browsers are served from. */
export type MemberSessionsHttpServices = Pick<
  SettingsHttpServices,
  "browserSecurity" | "protectedSessions" | "settings"
>;

export const SESSIONS_NOT_LOADED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "Your sessions could not be loaded.",
  status: 503,
  title: "Sessions unavailable",
};
export const SESSION_STALE: ProblemDefinition = {
  code: "session_stale",
  detail: "That session is no longer active.",
  status: 404,
  title: "Session unavailable",
};
export const SESSION_NOT_REVOKED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "That session could not be revoked.",
  status: 503,
  title: "Session unavailable",
};

/**
 * The session token this request carries.
 *
 * Only the two session routes need it, and both have already required an
 * actor, which is only resolved from a cookie that is present.
 */
function currentSessionToken(
  context: Context,
  policy: BrowserSecurityPolicy,
): string {
  return sessionToken(context.req.header("Cookie"), policy) ?? "";
}

export function createSessionsRoutes(
  services: MemberSessionsHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services);
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(routes, listMemberSessions, session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const sessions = await services.settings.listSessions(
      actor,
      currentSessionToken(context, services.browserSecurity),
    ).catch(() => undefined);
    return sessions
      ? privateJson(context, { sessions, status: "ready" })
      : definedProblem(context, SESSIONS_NOT_LOADED);
  });

  mount(
    routes,
    revokeMemberSession,
    origin,
    session,
    async (context) => {
      const parsedId = parseValue(uuid, context.req.param("sessionId"));
      if ("errors" in parsedId) {
        return definedProblem(context, SESSION_STALE);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.settings.revokeSession(
        actor,
        currentSessionToken(context, services.browserSecurity),
        parsedId.data,
      ).catch(() => undefined);
      if (!result) return definedProblem(context, SESSION_NOT_REVOKED);
      // Somebody else's session id answers what an unknown one does
      // (SECT-06), so an id cannot be probed for being live.
      if (result.status !== "revoked") {
        return definedProblem(context, SESSION_STALE);
      }
      if (result.current) {
        context.header(
          "Set-Cookie",
          expiredSessionCookie(services.browserSecurity),
        );
      }
      return privateJson(context, {
        current: result.current,
        status: "revoked",
      });
    },
  );
  return routes;
}
