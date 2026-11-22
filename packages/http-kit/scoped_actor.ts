/**
 * Admission for the routes that explicitly support personal API grants.
 *
 * A token-enabled route names the one scope it requires on its descriptor
 * (`RouteDescriptor.tokenScope`, MCP-A1), and the route file asks for its
 * actor through `scopedRouteActor(descriptor, …)`. The scope is read from the
 * descriptor once, when the route file mounts, so the published document,
 * the tool catalog that reads it, and the enforcement cannot name different
 * grants — and a route handed to it without a scope fails when the app is
 * built, not on the request that would have needed one.
 */
import type { Context } from "hono";
import type { RouteDescriptor } from "../contracts/registry.ts";
import { apiTokenScope } from "../contracts/schemas/api_tokens.ts";
import { rejectForeignOrigin, UNSAFE_METHODS } from "./origin.ts";
import type { BrowserSecurityPolicy } from "./security_policy.ts";
import {
  type ActorEnv,
  presentsAuthorization,
  requireTokenOrSessionActor,
  type ScopedTokenAuthority,
  type SessionActor,
} from "./session.ts";

/** Every grant a personal token may carry, as the contract names them. */
export type PersonalTokenScope = typeof apiTokenScope.options[number];

/**
 * The personal-token authority every module's routes receive, typed once over
 * the whole contract vocabulary: enabling another route for tokens never
 * widens a module's own scope union.
 */
export type PersonalTokenAuthority = ScopedTokenAuthority<PersonalTokenScope>;

/** What a token-enabled route's admission is built from. */
export interface ScopedRouteServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly tokens?: PersonalTokenAuthority | undefined;
}

/** The scope a descriptor requires, or a refusal to build its admission. */
function requiredScope(route: RouteDescriptor): PersonalTokenScope {
  const parsed = apiTokenScope.safeParse(route.tokenScope);
  if (!parsed.success) {
    throw new Error(
      `${route.operationId} names no personal token scope, so it cannot admit a token`,
    );
  }
  return parsed.data;
}

/**
 * The member behind a request to a token-enabled route, or the refusal the
 * route answers instead.
 *
 * A present Authorization header exclusively selects token admission, for the
 * scope the descriptor names. Cookie writes still require the exact browser
 * origin, before resolving a session. Bearer writes need no cookie or Origin;
 * a refused token never borrows either. An admitted token's actor carries the
 * token's id, and the legal guard's `tokenAdmission` still runs.
 */
export function scopedRouteActor(
  route: RouteDescriptor,
  services: ScopedRouteServices,
): (context: Context<ActorEnv>) => Promise<SessionActor | Response> {
  const scope = requiredScope(route);
  return async (context) => {
    if (
      !presentsAuthorization(context) &&
      UNSAFE_METHODS.has(context.req.method)
    ) {
      const refused = rejectForeignOrigin(context, services.browserSecurity);
      if (refused) return refused;
    }
    return await requireTokenOrSessionActor(context, {
      scope,
      ...(services.tokens ? { tokens: services.tokens } : {}),
    });
  };
}
