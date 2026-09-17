/**
 * Every browser a member is signed in on, and the button that ends one.
 *
 * Revoking the session the request itself arrived on is the interesting case:
 * the response clears the cookie as well, so the browser that asked to be
 * signed out is signed out rather than left holding a token the server has
 * already forgotten.
 */

import { Hono } from "hono";
import { type Context } from "hono";
import { z } from "zod";
import { cookieValue, SESSION_COOKIE, setCookie } from "../http/cookies.ts";
import { requireMatchingOrigin } from "../http/origin.ts";
import { definedProblem, type ProblemDefinition } from "../http/problem.ts";
import { type ActorEnv, requireActor, sessionActor } from "../http/session.ts";
import { parseValue } from "../http/validate.ts";
import { privateJson, type SettingsHttpServices } from "./shared.ts";

/** What a member's signed-in browsers are served from. */
export type MemberSessionsHttpServices = Pick<
  SettingsHttpServices,
  "browserSecurity" | "protectedSessions" | "settings"
>;

const sessionId = z.string().uuid();

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
export const SESSION_FORBIDDEN: ProblemDefinition = {
  code: "session_forbidden",
  detail: "You can revoke only your own sessions.",
  status: 403,
  title: "Session forbidden",
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
function currentSessionToken(context: Context): string {
  return cookieValue(context.req.header("Cookie"), SESSION_COOKIE) ?? "";
}

export function createSessionsRoutes(
  services: MemberSessionsHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  routes.get("/api/v1/settings/sessions", session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const sessions = await services.settings.listSessions(
      actor,
      currentSessionToken(context),
    ).catch(() => undefined);
    return sessions
      ? privateJson(context, {
        sessions: sessions.map((item) => ({
          ...item,
          createdAt: item.createdAt.toISOString(),
          expiresAt: item.expiresAt.toISOString(),
          lastSeenAt: item.lastSeenAt.toISOString(),
        })),
        status: "ready",
      })
      : definedProblem(context, SESSIONS_NOT_LOADED);
  });

  routes.delete(
    "/api/v1/settings/sessions/:sessionId",
    origin,
    session,
    async (context) => {
      const parsedId = parseValue(sessionId, context.req.param("sessionId"));
      if ("errors" in parsedId) {
        return definedProblem(context, SESSION_STALE);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.settings.revokeSession(
        actor,
        currentSessionToken(context),
        parsedId.data,
      ).catch(() => undefined);
      if (!result) return definedProblem(context, SESSION_NOT_REVOKED);
      if (result.status !== "revoked") {
        return definedProblem(
          context,
          result.status === "forbidden" ? SESSION_FORBIDDEN : SESSION_STALE,
        );
      }
      if (result.current) {
        context.header(
          "Set-Cookie",
          setCookie(services.browserSecurity, {
            maxAgeSeconds: 0,
            name: SESSION_COOKIE,
            path: "/",
            value: "",
          }),
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
