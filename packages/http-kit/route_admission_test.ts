import { Hono, type MiddlewareHandler } from "hono";
import { assertEquals, assertStatus } from "../backend/testing/assert.ts";
import { sessionActor as fixtureActor } from "../backend/testing/fixtures.ts";
import { defineRoute, type RouteDescriptor } from "../contracts/registry.ts";
import { routeAdmission } from "./route_admission.ts";
import type { PersonalTokenAuthority } from "./scoped_actor.ts";
import {
  type ActorEnv,
  type SessionActor,
  sessionActor,
  type SessionCoordinator,
  WORKSPACE_HEADER,
} from "./session.ts";

const member = fixtureActor();
const LOOPBACK = { origin: "http://localhost", secureCookie: false };
const TOKEN_ID = "00000000-0000-4000-8000-0000000000bb";
const COOKIE = "kinship_session=s";

const scopedRead = defineRoute({
  method: "get",
  path: "/thing",
  operationId: "admissionRead",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  tokenScope: "journal:read",
  responses: { 200: { description: "ok" } },
});
const scopedWrite = defineRoute({
  ...scopedRead,
  method: "post",
  operationId: "admissionWrite",
  tokenScope: "journal:write",
});

/** What one request asked of the session store, the authority, and the guard. */
interface Seen {
  readonly authenticated: string[];
  readonly guarded: SessionActor[];
  readonly handled: string[];
  readonly sessions: string[];
}

function seen(): Seen {
  return { authenticated: [], guarded: [], handled: [], sessions: [] };
}

/** An authority that admits `good` for `journal:write` only. */
function tokens(log: Seen): PersonalTokenAuthority {
  return {
    authenticate(rawToken, requiredScope) {
      log.authenticated.push(`${rawToken}:${requiredScope}`);
      return Promise.resolve(
        rawToken === "good" && requiredScope === "journal:write"
          ? { actor: member, status: "authenticated", tokenId: TOKEN_ID }
          : { status: "invalid" },
      );
    },
  };
}

function sessions(log: Seen): SessionCoordinator {
  return {
    resolve(command) {
      log.sessions.push(command.sessionToken);
      return Promise.resolve(member);
    },
  };
}

/** What the legal guard installs for a request presenting Authorization. */
function guard(log: Seen): MiddlewareHandler<ActorEnv> {
  return async (context, next) => {
    context.set("tokenAdmission", (actor) => {
      log.guarded.push(actor);
      return Promise.resolve(undefined);
    });
    await next();
  };
}

/**
 * A route mounted the way a module mounts one: the gate where the Origin
 * check was, the session resolution behind it, and a handler that asks for
 * its actor — twice, to show the answer is the gate's and is resolved once.
 */
function app(
  log: Seen,
  route: RouteDescriptor = scopedWrite,
  handlerRoute: RouteDescriptor = route,
): Hono<ActorEnv> {
  const services = { browserSecurity: LOOPBACK, tokens: tokens(log) };
  const admission = routeAdmission(route, services);
  const handlerAdmission = handlerRoute === route
    ? admission
    : routeAdmission(handlerRoute, services);
  const hono = new Hono<ActorEnv>();
  hono.on(
    route.method.toUpperCase(),
    route.path,
    guard(log),
    admission.gate,
    sessionActor({
      browserSecurity: LOOPBACK,
      protectedSessions: sessions(log),
    }),
    async (context) => {
      log.handled.push(context.req.method);
      const first = await handlerAdmission.actor(context);
      const second = await handlerAdmission.actor(context);
      if (first instanceof Response) return first;
      return context.json({
        apiTokenId: first.apiTokenId ?? null,
        member: first.memberId,
        same: first === second,
      });
    },
  );
  return hono;
}

function send(
  hono: Hono<ActorEnv>,
  method: string,
  headers: Record<string, string>,
): Promise<Response> {
  return Promise.resolve(
    hono.request("http://localhost/thing", { headers, method }),
  );
}

async function codeOf(response: Response): Promise<string> {
  return (await response.json() as { readonly code: string }).code;
}

Deno.test("[MCP-R1] a cookie read needs no Origin and its actor is the session", async () => {
  const log = seen();
  const response = await send(app(log, scopedRead), "GET", { Cookie: COOKIE });

  assertStatus(response, 200, "a safe method passes the gate untouched");
  assertEquals(
    await response.json(),
    { apiTokenId: null, member: member.memberId, same: true },
    "the handler's actor is the session's member, read once",
  );
  assertEquals(log.sessions, ["s"], "the session is resolved once");
  assertEquals(log.authenticated, [], "no token is asked about");
});

Deno.test("[MCP-R1] a cookie write without the exact Origin is refused at the gate", async () => {
  for (
    const origin of [undefined, "https://attacker.test", "null"] as const
  ) {
    const log = seen();
    const response = await send(app(log), "POST", {
      Cookie: COOKIE,
      ...(origin === undefined ? {} : { Origin: origin }),
    });

    assertStatus(response, 403, `Origin ${origin ?? "missing"}`);
    assertEquals(await codeOf(response), "origin_invalid", "names the Origin");
    assertEquals(log.handled, [], "the handler never runs");
    assertEquals(log.sessions, [], "no session is resolved");
  }
});

Deno.test("[MCP-R1] a cookie write from the Origin is authenticated by the handler", async () => {
  const log = seen();
  const hono = app(log);
  const response = await send(hono, "POST", {
    Cookie: COOKIE,
    Origin: LOOPBACK.origin,
  });

  assertStatus(response, 200, "the exact Origin passes the gate");
  assertEquals(
    await response.json(),
    { apiTokenId: null, member: member.memberId, same: true },
    "the session's member, never a token's",
  );
  assertEquals(log.sessions, ["s"], "resolved once, by the handler");

  const nobody = seen();
  const unsigned = await send(app(nobody), "POST", { Origin: LOOPBACK.origin });
  assertStatus(unsigned, 401, "the gate admits nobody for a cookie write");
  assertEquals(nobody.handled, ["POST"], "the handler answers the 401");
});

Deno.test("[MCP-R1] a bearer with the route's scope is admitted once, at the gate", async () => {
  const log = seen();
  const response = await send(app(log), "POST", {
    Authorization: "Bearer good",
    Cookie: COOKIE,
  });

  assertStatus(response, 200, "a bearer write needs no Origin");
  assertEquals(
    await response.json(),
    { apiTokenId: TOKEN_ID, member: member.memberId, same: true },
    "the handler reads the actor the gate admitted",
  );
  assertEquals(log.authenticated, ["good:journal:write"], "authenticated once");
  assertEquals(log.guarded.length, 1, "the legal guard is asked once");
  assertEquals(log.guarded[0]?.apiTokenId, TOKEN_ID, "about the token actor");
  assertEquals(log.sessions, [], "the cookie session is never resolved");
});

Deno.test("[MCP-R1] any refused Authorization is a 401 at the gate, never the cookie", async () => {
  for (
    const authorization of [
      "Bearer good-but-unknown",
      "Bearer",
      "Bearer two words",
      "",
      "Basic dXNlcjpwYXNz",
    ]
  ) {
    const log = seen();
    const response = await send(app(log), "POST", {
      Authorization: authorization,
      Cookie: COOKIE,
      Origin: LOOPBACK.origin,
    });

    assertStatus(response, 401, `Authorization "${authorization}"`);
    assertEquals(
      await codeOf(response),
      "session_invalid",
      "names the session",
    );
    assertEquals(log.handled, [], "the handler never runs");
    assertEquals(log.sessions, [], "the cookie session is never resolved");
    assertEquals(log.guarded, [], "nothing is admitted to the guard");
  }

  const log = seen();
  const lacking = await send(app(log, scopedRead), "GET", {
    Authorization: "Bearer good",
    Cookie: COOKIE,
  });
  assertStatus(lacking, 401, "a token without the read's scope is refused");
  assertEquals(log.authenticated, ["good:journal:read"], "for that scope");
  assertEquals(log.handled, [], "before the handler runs");
  assertEquals(log.sessions, [], "and without the cookie");
});

Deno.test("[MCP-R1] a bearer's malformed workspace header is a 400 at the gate", async () => {
  const log = seen();
  const response = await send(app(log), "POST", {
    Authorization: "Bearer good",
    [WORKSPACE_HEADER]: "not-a-workspace",
  });

  assertStatus(response, 400, "the header cannot name a workspace");
  assertEquals(
    await codeOf(response),
    "workspace_header_invalid",
    "names the header",
  );
  assertEquals(log.authenticated, [], "the token is never checked");
  assertEquals(log.handled, [], "the handler never runs");
});

Deno.test("[MCP-R1] one route's admitted token is never another route's actor", async () => {
  const log = seen();
  // The write's gate admits the token; the read's admission, asked on the
  // same request, judges it for its own scope and refuses it.
  const response = await send(app(log, scopedWrite, scopedRead), "POST", {
    Authorization: "Bearer good",
  });

  assertStatus(response, 401, "the read's admission does not share the actor");
  assertEquals(
    log.authenticated,
    ["good:journal:write", "good:journal:read"],
    "each admission asks for its own scope, once",
  );
});

Deno.test("[MCP-R1] a descriptor without a token scope cannot build an admission", () => {
  const sessionOnly = defineRoute({
    method: "get",
    path: "/session",
    operationId: "admissionSessionOnly",
    security: [{ kinship_session: [] }],
    responses: { 200: { description: "ok" } },
  });
  let message = "";
  try {
    routeAdmission(sessionOnly, { browserSecurity: LOOPBACK });
  } catch (error) {
    message = (error as Error).message;
  }
  assertEquals(
    message,
    "admissionSessionOnly names no personal token scope, so it cannot admit a token",
    "the mount fails, not the request",
  );
});
