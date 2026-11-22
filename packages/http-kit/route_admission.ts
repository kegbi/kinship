/**
 * One token-enabled route's admission, without moving a cookie check (MCP-R1).
 *
 * A cookie request to a route has always been answered in one order: a
 * foreign `Origin` first, a malformed workspace header next, then whatever the
 * route judges of its path, query, headers, or body, and only then whether
 * anyone is signed in. That order is observable, so it stays. A bearer request
 * is admitted before any of them instead: a token without the route's grant is
 * refused before its request is judged, and so before its body is read.
 *
 * The pair splits that between two places. The `gate` is mounted where the
 * route's `requireMatchingOrigin` used to stand. A request without
 * `Authorization` is NOT authenticated there; only an unsafe method's Origin is
 * checked, so its handler must ask `actor(context)`, which resolves the
 * session at the point the handler always did. A request presenting
 * `Authorization` is admitted or refused at the gate, once, and
 * `actor(context)` hands the handler that same answer: the token is
 * authenticated, and the legal guard's `tokenAdmission` asked about it,
 * exactly once per request.
 *
 * Each admission keeps its own answers, so the actor one route admitted is
 * never handed to another route's handler. The journal, gift, file, and
 * personalization routes each carried a verbatim copy of this until MCP-R1.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { RouteDescriptor } from "../contracts/registry.ts";
import { requireMatchingOrigin } from "./origin.ts";
import { scopedRouteActor, type ScopedRouteServices } from "./scoped_actor.ts";
import {
  type ActorEnv,
  presentsAuthorization,
  type SessionActor,
} from "./session.ts";

/** One token-enabled route's gate and the actor its handler asks for. */
export interface RouteAdmission {
  /**
   * The member behind the request, or the refusal the route answers: the
   * gate's answer for a bearer, the session for a cookie.
   */
  readonly actor: (
    context: Context<ActorEnv>,
  ) => Promise<SessionActor | Response>;
  /**
   * Mounted where the route's origin check used to be: a cookie write still
   * needs the exact `Origin`, and a bearer request is admitted here.
   */
  readonly gate: MiddlewareHandler<ActorEnv>;
}

/**
 * The admission for `route`, which must name its `tokenScope`: a descriptor
 * without one fails here, when the route file mounts.
 */
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
      if (!presentsAuthorization(context)) return await origin(context, next);
      const answer = await actor(context);
      if (answer instanceof Response) return answer;
      await next();
    },
  };
}
