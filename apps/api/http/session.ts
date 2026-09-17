/**
 * Who is making this request.
 *
 * Fifteen route files had each written the same `actor()`: read the
 * `kinship_session` cookie, read the optional `X-Workspace-Id`, ask the
 * protected-session coordinator, and swallow a throw as "nobody". It was
 * called about a hundred times, and a route that forgot the `.catch(…)` would
 * have turned a database outage into a 500 instead of the 401 its neighbour
 * answered.
 *
 * The middleware here puts that resolution in `c.var.actor` once. It is stored
 * as a memoized thunk rather than an awaited value on purpose: a route that
 * refuses a request before it ever asks who is making it — a foreign `Origin`,
 * an unparsable body — must not pay for a session read, and the order in which
 * a route's checks answer must not change because a middleware now runs in
 * front of it. The first `actorOf(context)` resolves; later ones reuse it.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { WorkspaceRole } from "../../../packages/backend/modules/workspaces/public.ts";
import { cookieValue, SESSION_COOKIE } from "./cookies.ts";
import { definedProblem, type ProblemDefinition } from "./problem.ts";

/** The header a member switches their active workspace with. */
export const WORKSPACE_HEADER = "X-Workspace-Id";

/** The membership a request is acting as. */
export interface SessionActor {
  readonly memberId: string;
  readonly role: WorkspaceRole;
  readonly userId: string;
  readonly workspaceId: string;
}

/** What this module needs of the protected-session coordinator. */
export interface SessionCoordinator {
  resolve(command: {
    readonly requestedWorkspaceId?: string;
    readonly sessionToken: string;
  }): Promise<SessionActor | undefined>;
}

/** The context variable the middleware sets. */
export interface ActorEnv {
  Variables: {
    actor: () => Promise<SessionActor | undefined>;
  };
}

/** The answer to a request that needs a member and has none. */
export const SESSION_INVALID: ProblemDefinition = {
  code: "session_invalid",
  detail: "Sign in with an active workspace membership.",
  status: 401,
  title: "Authentication required",
};

async function resolve(
  context: Context,
  sessions: SessionCoordinator,
): Promise<SessionActor | undefined> {
  const sessionToken = cookieValue(
    context.req.header("Cookie"),
    SESSION_COOKIE,
  );
  if (!sessionToken) return undefined;
  const requestedWorkspaceId = context.req.header(WORKSPACE_HEADER);
  const resolved = await sessions.resolve({
    sessionToken,
    ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
  }).catch(() => undefined);
  return resolved
    ? {
      memberId: resolved.memberId,
      role: resolved.role,
      userId: resolved.userId,
      workspaceId: resolved.workspaceId,
    }
    : undefined;
}

/** Puts the session resolution for this request in `c.var.actor`. */
export function sessionActor(
  sessions: SessionCoordinator,
): MiddlewareHandler<ActorEnv> {
  return async (context, next) => {
    let resolved: Promise<SessionActor | undefined> | undefined;
    context.set("actor", () => {
      resolved ??= resolve(context, sessions);
      return resolved;
    });
    await next();
  };
}

/** The member behind this request, or nobody. */
export function actorOf(
  context: Context<ActorEnv>,
): Promise<SessionActor | undefined> {
  return context.var.actor();
}

/** The member behind this request, or the 401 a route answers instead. */
export async function requireActor(
  context: Context<ActorEnv>,
): Promise<SessionActor | Response> {
  return await actorOf(context) ??
    definedProblem(context, SESSION_INVALID);
}

/** What this module needs of a scoped API-token authority. */
export interface ScopedTokenAuthority {
  authenticate(
    rawToken: string,
    requiredScope: string,
    requestedWorkspaceId?: string,
  ): Promise<
    | { readonly actor: SessionActor; readonly status: "authenticated" }
    | { readonly status: "invalid" }
  >;
}

/** The bearer token this request carries, if it carries one at all. */
export function bearerToken(context: Context): string | undefined {
  return /^Bearer ([^\s]+)$/i.exec(context.req.header("Authorization") ?? "")
    ?.[1];
}

/**
 * The member behind a request that may authenticate either way.
 *
 * An `Authorization` header commits the request to the token path: a header
 * that names a token this deployment cannot check, or a token without the
 * required scope, is nobody rather than a silent fallback onto the cookie.
 */
export async function tokenOrSessionActor(
  context: Context<ActorEnv>,
  options: {
    readonly scope: string;
    readonly tokens?: ScopedTokenAuthority;
  },
): Promise<SessionActor | undefined> {
  if (context.req.header("Authorization") === undefined) {
    return await actorOf(context);
  }
  const token = bearerToken(context);
  if (!token || !options.tokens) return undefined;
  const authenticated = await options.tokens.authenticate(
    token,
    options.scope,
    context.req.header(WORKSPACE_HEADER),
  ).catch(() => undefined);
  return authenticated?.status === "authenticated"
    ? authenticated.actor
    : undefined;
}
