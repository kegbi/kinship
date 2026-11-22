/**
 * Token admission for the journal's routes, without moving a cookie check
 * (MCP-B6).
 *
 * A cookie request to a journal route has always been answered in one order:
 * a foreign `Origin` first, a malformed workspace header next, then an
 * unparsable path or body, and only then whether anyone is signed in. That
 * order is observable, so it stays. A bearer request is admitted before any of
 * them instead, the way every other token route admits one: a token without
 * the route's grant is refused before its body is judged.
 *
 * Each route's admission is resolved once per request. The gate in front of
 * the route and the handler behind it read the same answer, so a token is
 * authenticated, and the legal guard asked about it, exactly once.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { RouteDescriptor } from "../../../../../contracts/registry.ts";
import { requireMatchingOrigin } from "../../../../../http-kit/origin.ts";
import {
  scopedRouteActor,
  type ScopedRouteServices,
} from "../../../../../http-kit/scoped_actor.ts";
import type {
  ActorEnv,
  SessionActor,
} from "../../../../../http-kit/session.ts";

/** One token-enabled route's gate and the actor its handler asks for. */
export interface RouteAdmission {
  /** The member behind the request, or the refusal the route answers. */
  readonly actor: (
    context: Context<ActorEnv>,
  ) => Promise<SessionActor | Response>;
  /**
   * Mounted where the route's origin check used to be: a cookie write still
   * needs the exact `Origin`, and a bearer request is admitted here.
   */
  readonly gate: MiddlewareHandler<ActorEnv>;
}

export function routeAdmission(
  route: RouteDescriptor,
  services: ScopedRouteServices,
): RouteAdmission {
  const resolve = scopedRouteActor(route, services);
  const origin = requireMatchingOrigin(services.browserSecurity);
  const admitted = new WeakMap<
    Context<ActorEnv>,
    Promise<SessionActor | Response>
  >();
  const actor = (context: Context<ActorEnv>) => {
    let answer = admitted.get(context);
    if (!answer) {
      answer = resolve(context);
      admitted.set(context, answer);
    }
    return answer;
  };
  return {
    actor,
    gate: async (context, next) => {
      if (context.req.header("Authorization") === undefined) {
        return await origin(context, next);
      }
      const answer = await actor(context);
      if (answer instanceof Response) return answer;
      await next();
    },
  };
}
