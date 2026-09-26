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
 * The middleware here puts that resolution in `c.var` once. It is stored as a
 * memoized thunk rather than an awaited value on purpose: a route that refuses
 * a request before it ever asks who is making it — a foreign `Origin`, an
 * unparsable body — must not pay for a session read, and the order in which a
 * route's checks answer must not change because a middleware now runs in front
 * of it. The first `actorOf(context)` resolves; later ones reuse it.
 *
 * Nine of those copies narrowed the coordinator's answer to the membership and
 * four kept the whole of it, because their use cases are the ones that name
 * the active workspace. Both readings are here: `actorOf` narrows, `sessionOf`
 * does not, and neither costs a second resolution.
 */

import type { Context, MiddlewareHandler } from "hono";
import type {
  ResolvedSessionContext,
  WorkspaceRole,
} from "../backend/modules/workspaces/public.ts";
import {
  type Correlation,
  correlationOf,
} from "../backend/shared-kernel/telemetry.ts";
import { cookieValue, SESSION_COOKIE } from "./cookies.ts";
import { definedProblem, type ProblemDefinition } from "./problem.ts";
import { requestIdOf } from "./request_id.ts";

/** The header a member switches their active workspace with. */
export const WORKSPACE_HEADER = "X-Workspace-Id";

/**
 * The membership a request is acting as, and the request it is acting in.
 *
 * `requestId` is the request's correlation (GAP-039): the identifier the
 * gateway forwarded or the API minted. It rides on the actor because the actor
 * is what every route already hands its use case, so a use case reaches the
 * identifier — and the audit event it describes carries it — without a second
 * parameter. It is absent when the request-ID middleware is not mounted.
 */
export interface SessionActor extends Correlation {
  readonly memberId: string;
  readonly role: WorkspaceRole;
  readonly userId: string;
  readonly workspaceId: string;
}

/**
 * Everything the coordinator knows about this request's session.
 *
 * Most routes want the membership and nothing else, which is what `actorOf`
 * hands them. Four flows want more: the invitation, both lifecycle pages, and
 * the session read name the active workspace, and the session read also lists
 * the workspaces the same user could switch to. They ask for it explicitly
 * through `sessionOf`, so the wider shape never leaks into a use case that
 * asked for a membership.
 */
export type ResolvedSession = ResolvedSessionContext;

/** What this module needs of the protected-session coordinator. */
export interface SessionCoordinator {
  resolve(command: {
    readonly requestedWorkspaceId?: string;
    readonly sessionToken: string;
  }): Promise<ResolvedSession | undefined>;
}

/**
 * The context variables the middleware sets.
 *
 * Both are thunks over the same single resolution: `actor` narrows it to the
 * membership, `session` hands back all of it. Each memoizes its own answer, so
 * a route that asks twice gets the same object twice and the coordinator is
 * still asked once.
 */
export interface ActorEnv {
  Variables: {
    actor: () => Promise<SessionActor | undefined>;
    session: () => Promise<ResolvedSession | undefined>;
  };
}

/** The answer to a request that needs a member and has none. */
export const SESSION_INVALID: ProblemDefinition = {
  code: "session_invalid",
  detail: "Sign in with an active workspace membership.",
  status: 401,
  title: "Authentication required",
};

/** The coordinator's answer, outage and all. */
function read(
  context: Context,
  sessions: SessionCoordinator,
  requestedWorkspaceId: string | undefined,
): Promise<ResolvedSession | undefined> {
  const sessionToken = cookieValue(
    context.req.header("Cookie"),
    SESSION_COOKIE,
  );
  if (!sessionToken) return Promise.resolve(undefined);
  return sessions.resolve({
    sessionToken,
    ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
  });
}

/** The same, with an outage concealed as nobody. */
function resolve(
  context: Context,
  sessions: SessionCoordinator,
  requestedWorkspaceId: string | undefined,
): Promise<ResolvedSession | undefined> {
  return read(context, sessions, requestedWorkspaceId).catch(() => undefined);
}

/** This request's correlation, as a member that is absent when there is none. */
function correlation(context: Context): Correlation {
  return correlationOf({ requestId: requestIdOf(context) });
}

/** The membership, and nothing else, out of a wider resolution. */
function membership(
  resolved: ResolvedSession,
  context: Context,
): SessionActor {
  return {
    memberId: resolved.memberId,
    role: resolved.role,
    userId: resolved.userId,
    workspaceId: resolved.workspaceId,
    ...correlation(context),
  };
}

/** Puts the session resolution for this request in `c.var`. */
export function sessionActor(
  sessions: SessionCoordinator,
): MiddlewareHandler<ActorEnv> {
  return async (context, next) => {
    let resolved: Promise<ResolvedSession | undefined> | undefined;
    let narrowed: Promise<SessionActor | undefined> | undefined;
    const session = () => {
      resolved ??= resolve(
        context,
        sessions,
        context.req.header(WORKSPACE_HEADER),
      );
      return resolved;
    };
    context.set("session", session);
    context.set(
      "actor",
      () => {
        narrowed ??= session().then((value) =>
          value && membership(value, context)
        );
        return narrowed;
      },
    );
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

/** The whole resolution, for a route that names the active workspace. */
export function sessionOf(
  context: Context<ActorEnv>,
): Promise<ResolvedSession | undefined> {
  return context.var.session();
}

/** The same, or the 401 a route answers instead. */
export async function requireSession(
  context: Context<ActorEnv>,
): Promise<ResolvedSession | Response> {
  return await sessionOf(context) ?? definedProblem(context, SESSION_INVALID);
}

/**
 * The member behind a request that names its workspace somewhere else.
 *
 * Two export routes are opened from a link rather than from the application,
 * so the workspace they mean arrives in the query string instead of the header
 * everything else uses. They resolve on their own rather than through the
 * middleware, because the answer depends on a value the middleware cannot see;
 * a request that names no workspace falls back to the header, which is what
 * makes the same two routes work from inside the application as well.
 */
export async function workspaceScopedActor(
  context: Context,
  sessions: SessionCoordinator,
  requestedWorkspaceId: string | undefined,
): Promise<SessionActor | undefined> {
  const resolved = await resolve(
    context,
    sessions,
    requestedWorkspaceId ?? context.req.header(WORKSPACE_HEADER),
  );
  return resolved && membership(resolved, context);
}

/**
 * The member behind this request, without concealing an outage.
 *
 * The legal guard is the one caller that has to tell "nobody is signed in"
 * from "the session store is down". The first lets a public route through; the
 * second must refuse every route, because a guard that cannot check whether a
 * document is outstanding may not decide that none is. Every other caller
 * wants the concealing readings above.
 */
export async function readActor(
  context: Context,
  sessions: SessionCoordinator,
): Promise<SessionActor | undefined> {
  const resolved = await read(
    context,
    sessions,
    context.req.header(WORKSPACE_HEADER),
  );
  return resolved && membership(resolved, context);
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
    ? { ...authenticated.actor, ...correlation(context) }
    : undefined;
}
