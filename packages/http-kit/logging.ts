/**
 * One structured line per request.
 *
 * The gateway has logged a low-cardinality `gateway.request` event since it
 * existed; the API behind it logged nothing at all, so a slow or refused
 * request could be seen arriving and never seen being answered. This is the
 * matching `api.request` event, joined to the gateway's by the request
 * identifier the gateway forwards in `X-Request-Id`.
 *
 * What is logged is deliberately small. The route is the registered pattern —
 * `/api/v1/people/:personId/gifts`, never the person's identifier — so the
 * event stays low-cardinality and carries no tenant data, and there is no
 * field for a header, a cookie, a token, a query string, or a body. The
 * destination is the shared kernel's `Logger` port: the deployment passes the
 * platform's JSON adapter, which redacts against the same closed catalogue, a
 * test passes a recorder, and a suite that passes nothing gets no output.
 */

import type { Context, MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import type {
  ApiRequestEvent,
  Logger,
} from "../backend/shared-kernel/telemetry.ts";
import { type RequestIdEnv, requestIdOf } from "./request_id.ts";

/** The event name every API request log line carries. */
export const REQUEST_EVENT = "api.request";

/** The route name used when nothing was matched. */
export const UNMATCHED_ROUTE = "unmatched";

/**
 * The registered pattern this request was answered by.
 *
 * Middleware matches as `ALL`, so the endpoint is the last matched route that
 * declares a method of its own; a request that matched none was not answered
 * by a route at all.
 */
export function loggedRoute(context: Context): string {
  const routes = matchedRoutes(context);
  for (let index = routes.length - 1; index >= 0; index--) {
    const route = routes[index];
    if (route && route.method !== "ALL") return route.path;
  }
  return UNMATCHED_ROUTE;
}

/** Logs one line per request, after the response is known. */
export function requestLogging(
  logger: Logger,
): MiddlewareHandler<RequestIdEnv> {
  return async (context, next) => {
    const started = performance.now();
    const record = (status: number): ApiRequestEvent => {
      const identifier = requestIdOf(context);
      return {
        event: REQUEST_EVENT,
        method: context.req.method,
        route: loggedRoute(context),
        status,
        duration_ms: Math.round(performance.now() - started),
        ...(identifier ? { request_id: identifier } : {}),
      };
    };
    try {
      await next();
    } catch (failure) {
      logger.log(record(500));
      throw failure;
    }
    logger.log(record(context.res.status));
  };
}
