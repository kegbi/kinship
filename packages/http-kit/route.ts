/**
 * Mounting a route descriptor onto Hono.
 *
 * A route file used to write its path out as a string literal beside the
 * handler, and `tools/contracts/generate.ts` wrote the same path out again, in
 * OpenAPI's `{parameter}` spelling, several thousand lines away. The two drifted
 * exactly as one would expect: three routes had different parameter names on
 * the two sides, and twelve declared a path parameter in one place that the
 * other never mentioned. Nothing noticed, because the drift check only diffed
 * the generator against its own output.
 *
 * `mount` takes the descriptor instead. The path the app matches on is derived
 * from the path the document publishes, so the two cannot differ, and
 * `apps/api/routes_test.ts` puts what Hono ended up holding beside the
 * registry, so nothing can be mounted around this function either.
 *
 * The handlers are passed through untouched. Parsing stays where it was — a
 * route answers a rejected path parameter differently from a rejected body,
 * and only the route knows which refusal it owes — so this module binds the
 * method and the path and nothing else.
 */

import type { Env, Hono, MiddlewareHandler } from "hono";
import { honoPath, type RouteDescriptor } from "../contracts/registry.ts";

/**
 * Mounts one descriptor.
 *
 * The last handler answers and the ones before it are the kit — the session,
 * the origin rule — in the order the route file lists them.
 */
export function mount<E extends Env>(
  app: Hono<E>,
  route: RouteDescriptor,
  ...handlers: readonly MiddlewareHandler<E>[]
): void {
  app.on(
    [route.method.toUpperCase()],
    [honoPath(route.path)],
    ...handlers as MiddlewareHandler<E>[],
  );
}

/** Every method and path a Hono app answers, as `routes_test.ts` reads them. */
export function mountedRoutes<E extends Env>(
  app: Hono<E>,
): readonly string[] {
  const mounted = new Set<string>();
  for (const route of app.routes) {
    if (route.method === "ALL") continue;
    mounted.add(`${route.method} ${route.path}`);
  }
  return [...mounted];
}
