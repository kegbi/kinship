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
 *
 * AUD-K1 made that one resolution per request rather than one per route file.
 * `createApiApp` installs it once, in front of the legal guard, and a route's
 * own `sessionActor` finds it already installed and leaves it alone, so the
 * guard and the route ask the coordinator once between them. The guard reads
 * it through `readActorOf`, which keeps an outage an outage; every other
 * reader conceals it as nobody.
 *
 * Two export links name their workspace in the query string rather than the
 * header. Their resolution is installed with that parameter, in front of the
 * app-wide one, so the workspace the guard checks is the workspace the route
 * acts in, and still only one is asked about.
 */

import type { Context, MiddlewareHandler } from "hono";
import {
  carryAdmission,
  type ResolvedSessionContext,
  type WorkspaceRole,
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
    /** The same resolution, with an outage left as a rejection. */
    sessionRead: () => Promise<ResolvedSession | undefined>;
    /**
     * What a token-admitted member still owes, set by the legal guard: the
     * refusal to answer instead, or nothing when the member may proceed.
     */
    tokenAdmission?: (actor: SessionActor) => Promise<Response | undefined>;
  };
}

/** The answer to a request that needs a member and has none. */
export const SESSION_INVALID: ProblemDefinition = {
  code: "session_invalid",
  detail: "Sign in with an active workspace membership.",
  status: 401,
  title: "Authentication required",
};

/** The answer to a workspace header that cannot name a workspace (SECA-08). */
export const WORKSPACE_HEADER_INVALID: ProblemDefinition = {
  code: "workspace_header_invalid",
  detail: "Send X-Workspace-Id as a workspace identifier, or leave it out.",
  status: 400,
  title: "Invalid workspace",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The workspace this request asks for in its header; empty means none. */
function requestedWorkspace(context: Context): string | undefined {
  return context.req.header(WORKSPACE_HEADER) || undefined;
}

/**
 * The workspace a resolution is asked for: the named query parameter when the
 * route takes one and the request sends it, otherwise the header.
 */
function namedWorkspace(
  context: Context,
  workspaceQuery: string | undefined,
): string | undefined {
  return (workspaceQuery && context.req.query(workspaceQuery)) ||
    requestedWorkspace(context);
}

/**
 * Whether a requested workspace is something that is not a workspace id.
 *
 * Such a value used to reach the database's uuid cast, and the failed cast was
 * reported as an outage (SECA-08).
 */
function malformedWorkspace(requested: string | undefined): boolean {
  return requested !== undefined && !UUID.test(requested);
}

/** How a route's session resolution chooses its workspace. */
export interface SessionOptions {
  /**
   * The query parameter that names the workspace, for a route opened from a
   * link. The header still answers when the request leaves it out.
   */
  readonly workspaceQuery?: string;
}

/**
 * The coordinator's answer, outage and all.
 *
 * A malformed workspace header is nobody here rather than a question the
 * coordinator would fail on: the route that reads the session refuses it
 * with a 400 of its own, and a reader in front of the route — the legal
 * guard — must not report it as an outage.
 */
function read(
  context: Context,
  sessions: SessionCoordinator,
  requestedWorkspaceId: string | undefined,
): Promise<ResolvedSession | undefined> {
  const sessionToken = cookieValue(
    context.req.header("Cookie"),
    SESSION_COOKIE,
  );
  if (!sessionToken || malformedWorkspace(requestedWorkspaceId)) {
    return Promise.resolve(undefined);
  }
  return sessions.resolve({
    sessionToken,
    ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
  });
}

/** This request's correlation, as a member that is absent when there is none. */
function correlation(context: Context): Correlation {
  return correlationOf({ requestId: requestIdOf(context) });
}

/**
 * The membership, and nothing else, out of a wider resolution.
 *
 * It keeps the resolution's admission (BEQ-04), so a read use case handed
 * this actor knows the request has just resolved it and does not revalidate.
 */
function membership(
  resolved: ResolvedSession,
  context: Context,
): SessionActor {
  return carryAdmission(resolved, {
    memberId: resolved.memberId,
    role: resolved.role,
    userId: resolved.userId,
    workspaceId: resolved.workspaceId,
    ...correlation(context),
  });
}

/**
 * Installs this request's session resolution in `c.var`, once.
 *
 * A request that already carries one keeps it: the first installer's thunks
 * are the ones every later reader shares, so a route's own `sessionActor`
 * behind the app's costs nothing. Nothing is resolved until somebody reads.
 */
export function installSession(
  context: Context<ActorEnv>,
  sessions: SessionCoordinator,
  options: SessionOptions = {},
): void {
  if (context.get("sessionRead")) return;
  let raw: Promise<ResolvedSession | undefined> | undefined;
  let concealed: Promise<ResolvedSession | undefined> | undefined;
  let narrowed: Promise<SessionActor | undefined> | undefined;
  const sessionRead = () => {
    raw ??= read(
      context,
      sessions,
      namedWorkspace(context, options.workspaceQuery),
    );
    return raw;
  };
  const session = () => {
    concealed ??= sessionRead().catch(() => undefined);
    return concealed;
  };
  context.set("sessionRead", sessionRead);
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
}

/**
 * The request's one resolution, installed for everything behind it.
 *
 * `createApiApp` mounts this in front of the legal guard. It judges nothing:
 * whether the workspace header is acceptable is the business of the routes
 * that read a session, so a route that never does — the calendar feed — keeps
 * the answer it always gave. A link route's resolution is mounted in front of
 * it with that route's `workspaceQuery`.
 */
export function sessionResolution(
  sessions: SessionCoordinator,
  options: SessionOptions = {},
): MiddlewareHandler<ActorEnv> {
  return async (context, next) => {
    installSession(context, sessions, options);
    await next();
  };
}

/** The refusal a malformed workspace header earns, if this request has one. */
function workspaceRefusal(context: Context): Response | undefined {
  return malformedWorkspace(requestedWorkspace(context))
    ? definedProblem(context, WORKSPACE_HEADER_INVALID)
    : undefined;
}

/**
 * Puts the session resolution for this request in `c.var`, for a route that
 * reads it, and refuses a malformed workspace header with a 400.
 */
export function sessionActor(
  sessions: SessionCoordinator,
  options: SessionOptions = {},
): MiddlewareHandler<ActorEnv> {
  return async (context, next) => {
    const refused = workspaceRefusal(context);
    if (refused) return refused;
    installSession(context, sessions, options);
    return await next();
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
 * The member behind this request, without concealing an outage.
 *
 * The legal guard is the one caller that has to tell "nobody is signed in"
 * from "the session store is down". The first lets a public route through; the
 * second must refuse every route, because a guard that cannot check whether a
 * document is outstanding may not decide that none is. Every other caller
 * wants the concealing readings above. It reads the request's one memoized
 * resolution, so the route behind the guard asks nobody again.
 */
export async function readActorOf(
  context: Context<ActorEnv>,
): Promise<SessionActor | undefined> {
  const resolved = await context.var.sessionRead();
  return resolved && membership(resolved, context);
}

/**
 * What this module needs of a scoped API-token authority. `Scope` is the
 * scopes it serves, so a personal-token authority can never be asked for a
 * calendar feed's `calendar.read` (GAP-052), nor for any scope it does not
 * name.
 */
export interface ScopedTokenAuthority<Scope extends string> {
  authenticate(
    rawToken: string,
    requiredScope: Scope,
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
 * The member behind a request that may authenticate either way, or the
 * refusal a route answers instead.
 *
 * An `Authorization` header commits the request to the token path: a header
 * that names a token this deployment cannot check, or a token without the
 * required scope, is a 401 rather than a silent fallback onto the cookie. A
 * token that does authenticate still answers to the `tokenAdmission` the legal
 * guard set (SECA-05). The guard cannot authenticate the token itself, because
 * only the route knows the scope the token must carry.
 */
export async function requireTokenOrSessionActor<Scope extends string>(
  context: Context<ActorEnv>,
  options: {
    readonly scope: Scope;
    readonly tokens?: ScopedTokenAuthority<NoInfer<Scope>>;
  },
): Promise<SessionActor | Response> {
  if (context.req.header("Authorization") === undefined) {
    return await requireActor(context);
  }
  const refused = workspaceRefusal(context);
  if (refused) return refused;
  const token = bearerToken(context);
  const authenticated = token && options.tokens
    ? await options.tokens.authenticate(
      token,
      options.scope,
      requestedWorkspace(context),
    ).catch(() => undefined)
    : undefined;
  if (authenticated?.status !== "authenticated") {
    return definedProblem(context, SESSION_INVALID);
  }
  const actor = { ...authenticated.actor, ...correlation(context) };
  return await context.var.tokenAdmission?.(actor) ?? actor;
}
