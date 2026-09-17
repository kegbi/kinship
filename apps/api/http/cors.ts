/**
 * Cross-origin access: exactly one origin, and it is the application's own.
 *
 * The browser has always reached this API same-origin — through the gateway's
 * `/api/v1/` proxy in production and E2E, through the Astro dev proxy in
 * development — so nothing needed CORS and nothing declared it. "Nothing
 * declared" is not the same as "denied", though: it is the default a future
 * reader has to infer. This states it. The configured web origin is echoed
 * back, with credentials, and every other origin gets no
 * `Access-Control-Allow-Origin` at all, so the browser refuses the response.
 *
 * `Origin` is still checked a second time inside the API, by `origin.ts`, on
 * every write. CORS is a browser's rule about reading an answer; the origin
 * middleware is this API's rule about being asked in the first place, and a
 * non-browser client is bound by the second one only.
 *
 * Hono ships a `cors()` of its own and this is deliberately not it. That one
 * writes its headers through `c.res` *before* the route runs, which brings the
 * response object into existence early; Hono then merges the finished response
 * into it, and that merge replaces the finished response's `Set-Cookie` list
 * with the early object's. Three authentication routes build their response and
 * then append a cookie to it — the MFA route clears its one-time challenge
 * exactly that way — and the merge silently dropped it. Writing the same
 * headers after `next()` leaves every response's cookies where the route put
 * them.
 */

import type { MiddlewareHandler } from "hono";
import type { BrowserSecurityPolicy } from "../security_config.ts";

/** The request headers a browser may send to this API. */
export const ALLOWED_REQUEST_HEADERS: readonly string[] = [
  "Content-Type",
  "X-Request-Id",
  "X-Workspace-Id",
];

/** The methods this API answers. */
export const ALLOWED_METHODS: readonly string[] = [
  "DELETE",
  "GET",
  "HEAD",
  "PATCH",
  "POST",
  "PUT",
];

/** How long a browser may cache one preflight. */
export const PREFLIGHT_MAX_AGE_SECONDS = 600;

/** Admits the configured web origin, with credentials, and nobody else. */
export function sameOriginCors(
  policy: BrowserSecurityPolicy,
): MiddlewareHandler {
  const allowHeaders = ALLOWED_REQUEST_HEADERS.join(",");
  const allowMethods = ALLOWED_METHODS.join(",");
  return async (context, next) => {
    const origin = context.req.header("Origin");
    const admitted = origin !== undefined && origin === policy.origin;
    if (context.req.method === "OPTIONS") {
      const headers = new Headers({
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": allowHeaders,
        "Access-Control-Allow-Methods": allowMethods,
        "Access-Control-Max-Age": String(PREFLIGHT_MAX_AGE_SECONDS),
        Vary: "Origin",
      });
      if (admitted) headers.set("Access-Control-Allow-Origin", origin);
      return new Response(null, { headers, status: 204 });
    }
    await next();
    const headers = context.res.headers;
    headers.append("Vary", "Origin");
    headers.set("Access-Control-Allow-Credentials", "true");
    if (admitted) headers.set("Access-Control-Allow-Origin", origin);
    return undefined;
  };
}
