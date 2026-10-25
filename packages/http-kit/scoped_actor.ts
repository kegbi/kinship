/** Admission for the routes that explicitly support personal API grants. */
import type { Context } from "hono";
import { rejectForeignOrigin, UNSAFE_METHODS } from "./origin.ts";
import { definedProblem } from "./problem.ts";
import type { BrowserSecurityPolicy } from "./security_policy.ts";
import {
  type ActorEnv,
  type ScopedTokenAuthority,
  SESSION_INVALID,
  type SessionActor,
  tokenOrSessionActor,
} from "./session.ts";

/**
 * A present Authorization header exclusively selects token admission. Cookie
 * writes still require the exact browser origin, before resolving a session.
 * Bearer writes need no cookie or Origin; a refused token never borrows either.
 */
export async function requireScopedActor<Scope extends string>(
  context: Context<ActorEnv>,
  options: {
    readonly browserSecurity: BrowserSecurityPolicy;
    readonly scope: Scope;
    readonly tokens?: ScopedTokenAuthority<NoInfer<Scope>>;
  },
): Promise<SessionActor | Response> {
  if (
    context.req.header("Authorization") === undefined &&
    UNSAFE_METHODS.has(context.req.method)
  ) {
    const refused = rejectForeignOrigin(context, options.browserSecurity);
    if (refused) return refused;
  }
  return await tokenOrSessionActor(context, options) ??
    definedProblem(context, SESSION_INVALID);
}
