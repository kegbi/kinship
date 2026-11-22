/**
 * The browser origin check that stands in front of every write.
 *
 * The API authenticates with a `SameSite=Strict` cookie, so a cross-site form
 * post cannot carry a session. The `Origin` comparison is the second lock: a
 * request that changes something must say it came from the one configured web
 * origin, and a request that says nothing is refused too, because a silent
 * `Origin` is exactly what an attacker's page would send.
 *
 * Twelve route files had spelled this out, half as `requireOrigin` returning a
 * response and half as a `validOrigin` predicate with a separate responder.
 * Both spellings survive here — the middleware for a route that checks the
 * origin first, the responder for the handful that must answer something else
 * before they look at it — and both read the same policy and produce the same
 * 403.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { BrowserSecurityPolicy } from "./security_policy.ts";
import { definedProblem, type ProblemDefinition } from "./problem.ts";

/** The methods that change something and therefore need an origin. */
export const UNSAFE_METHODS: ReadonlySet<string> = new Set([
  "DELETE",
  "PATCH",
  "POST",
  "PUT",
]);

/** The answer to a write that did not come from the configured origin. */
export const ORIGIN_INVALID: ProblemDefinition = {
  code: "origin_invalid",
  detail: "This request did not come from the configured application origin.",
  status: 403,
  title: "Request forbidden",
};

/** Whether this request's `Origin` is the configured web origin. */
export function matchingOrigin(
  context: Context,
  policy: BrowserSecurityPolicy,
): boolean {
  return context.req.header("Origin") === policy.origin;
}

/** The 403 to answer a foreign-origin write with, or nothing. */
export function rejectForeignOrigin(
  context: Context,
  policy: BrowserSecurityPolicy,
): Response | undefined {
  return matchingOrigin(context, policy)
    ? undefined
    : definedProblem(context, ORIGIN_INVALID);
}

/**
 * Refuses an unsafe method that does not carry the configured origin.
 *
 * Safe methods pass untouched: a read is guarded by the session cookie alone,
 * as it was before this middleware existed.
 */
export function requireMatchingOrigin(
  policy: BrowserSecurityPolicy,
): MiddlewareHandler {
  return async (context, next) => {
    if (!UNSAFE_METHODS.has(context.req.method)) return await next();
    const refused = rejectForeignOrigin(context, policy);
    if (refused) return refused;
    await next();
  };
}

/**
 * The same refusal for a route that also admits a personal token: a request
 * presenting `Authorization` is committed to token admission, which needs no
 * `Origin` (`scopedRouteActor`), so only a cookie write is asked for one. It
 * stands where `requireMatchingOrigin` stood, so a cookie request's checks
 * still answer in the order they did.
 */
export function requireCookieWriteOrigin(
  policy: BrowserSecurityPolicy,
): MiddlewareHandler {
  const origin = requireMatchingOrigin(policy);
  return async (context, next) => {
    if (context.req.header("Authorization") !== undefined) return await next();
    return await origin(context, next);
  };
}
