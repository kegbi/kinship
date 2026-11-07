import { type Context, Hono } from "hono";
import {
  assert,
  assertEquals,
  assertStatus,
} from "../backend/testing/assert.ts";
import {
  sessionActor as fixtureActor,
  uuid,
} from "../backend/testing/fixtures.ts";
import {
  type ActorEnv,
  actorOf,
  bearerToken,
  readActorOf,
  requireActor,
  requireSession,
  requireTokenOrSessionActor,
  type ResolvedSession,
  type ScopedTokenAuthority,
  type SessionActor,
  sessionActor,
  type SessionCoordinator,
  sessionResolution,
  WORKSPACE_HEADER,
} from "./session.ts";
import {
  REQUEST_ID_HEADER,
  requestId,
  type RequestIdEnv,
} from "./request_id.ts";

const member = fixtureActor();

function coordinator(
  calls: { readonly sessionToken: string }[],
  resolved: ResolvedSession | undefined = member,
): SessionCoordinator {
  return {
    resolve(command) {
      calls.push(command);
      return Promise.resolve(resolved);
    },
  };
}

/** The member a token-or-session reading admitted, or null for a refusal. */
function memberOf(actor: SessionActor | Response): string | null {
  return actor instanceof Response ? null : actor.memberId;
}

function guarded(sessions: SessionCoordinator): Hono<ActorEnv> {
  const app = new Hono<ActorEnv>();
  app.get("/who", sessionActor(sessions), async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    return context.json(actor);
  });
  return app;
}

Deno.test("[GAP-019] the cookie and the workspace header become the actor", async () => {
  const calls: { readonly sessionToken: string }[] = [];
  const response = await guarded(coordinator(calls)).request(
    "http://localhost/who",
    {
      headers: {
        Cookie: "theme=dark; kinship_session=token",
        [WORKSPACE_HEADER]: uuid(902),
      },
    },
  );
  const body = await response.json() as SessionActor;

  assertStatus(response, 200);
  assertEquals(body.memberId, member.memberId, "the membership is projected");
  assertEquals(
    JSON.stringify(calls),
    JSON.stringify([{
      sessionToken: "token",
      requestedWorkspaceId: uuid(902),
    }]),
    "the coordinator is asked once, for the requested workspace",
  );
  assertEquals(
    Object.keys(body).sort().join(","),
    "memberId,role,userId,workspaceId",
    "nothing but the membership crosses into the route",
  );
});

Deno.test("[GAP-019] no cookie never reaches the coordinator and answers 401", async () => {
  const calls: { readonly sessionToken: string }[] = [];
  const response = await guarded(coordinator(calls)).request(
    "http://localhost/who",
  );
  const body = await response.json() as { readonly code: string };

  assertStatus(response, 401);
  assertEquals(body.code, "session_invalid", "the refusal names the session");
  assertEquals(calls.length, 0, "an anonymous request costs no session read");
});

Deno.test("[GAP-019] a coordinator that throws is nobody, not a crash", async () => {
  const response = await guarded({
    resolve: () => Promise.reject(new Error("offline")),
  }).request("http://localhost/who", {
    headers: { Cookie: "kinship_session=token" },
  });

  assertStatus(response, 401, "an outage conceals rather than leaks");
});

Deno.test("[GAP-019] the resolution is memoized for the whole request", async () => {
  const calls: { readonly sessionToken: string }[] = [];
  const app = new Hono<ActorEnv>();
  app.get("/twice", sessionActor(coordinator(calls)), async (context) => {
    const first = await actorOf(context);
    const second = await actorOf(context);
    return context.json({ same: first === second });
  });

  const response = await app.request("http://localhost/twice", {
    headers: { Cookie: "kinship_session=token" },
  });

  assert(
    (await response.json() as { readonly same: boolean }).same,
    "both reads see one resolution",
  );
  assertEquals(calls.length, 1, "the coordinator is asked exactly once");
});

Deno.test("[GAP-019] a bearer token is read only from a well-formed header", async () => {
  const app = new Hono();
  app.get("/token", (context) => context.json({ token: bearerToken(context) }));

  const read = async (authorization?: string) =>
    ((await (await app.request("http://localhost/token", {
      ...(authorization ? { headers: { Authorization: authorization } } : {}),
    })).json()) as { readonly token?: string }).token;

  assertEquals(await read("Bearer abc123"), "abc123", "a bearer token");
  assertEquals(
    await read("bearer abc123"),
    "abc123",
    "the scheme is not cased",
  );
  assertEquals(await read("Basic abc123"), undefined, "another scheme is not");
  assertEquals(await read(), undefined, "no header is no token");
});

Deno.test("[GAP-019] an Authorization header commits the request to the token path", async () => {
  const tokens: ScopedTokenAuthority<"people:read"> = {
    authenticate(rawToken, requiredScope) {
      return Promise.resolve(
        rawToken === "good" && requiredScope === "people:read"
          ? { actor: member, status: "authenticated" as const }
          : { status: "invalid" as const },
      );
    },
  };
  const app = new Hono<ActorEnv>();
  app.get(
    "/directory",
    sessionActor(coordinator([])),
    async (context) => {
      const actor = await requireTokenOrSessionActor(context, {
        scope: "people:read",
        tokens,
      });
      return context.json({ member: memberOf(actor) });
    },
  );
  app.get("/no-tokens", sessionActor(coordinator([])), async (context) => {
    const actor = await requireTokenOrSessionActor(context, {
      scope: "people:read",
    });
    return context.json({ member: memberOf(actor) });
  });

  const read = async (path: string, authorization?: string) =>
    ((await (await app.request(`http://localhost${path}`, {
      headers: {
        Cookie: "kinship_session=token",
        ...(authorization ? { Authorization: authorization } : {}),
      },
    })).json()) as { readonly member: string | null }).member;

  assertEquals(
    await read("/directory", "Bearer good"),
    member.memberId,
    "a scoped token authenticates",
  );
  assertEquals(
    await read("/directory", "Bearer wrong"),
    null,
    "a token without the scope is nobody, not the cookie's member",
  );
  assertEquals(
    await read("/directory", "Basic good"),
    null,
    "another scheme does not fall back onto the cookie",
  );
  assertEquals(
    await read("/directory"),
    member.memberId,
    "no Authorization header uses the session",
  );
  assertEquals(
    await read("/no-tokens", "Bearer good"),
    null,
    "a deployment without an API-token authority admits no token",
  );
});

Deno.test("[GAP-019] a token authority that throws is nobody", async () => {
  const app = new Hono<ActorEnv>();
  app.get("/directory", sessionActor(coordinator([])), async (context) => {
    const actor = await requireTokenOrSessionActor(context, {
      scope: "people:read",
      tokens: { authenticate: () => Promise.reject(new Error("offline")) },
    });
    return context.json({ member: memberOf(actor) });
  });

  const response = await app.request("http://localhost/directory", {
    headers: { Authorization: "Bearer good" },
  });

  assertEquals(
    (await response.json() as { readonly member: string | null }).member,
    null,
    "an outage in the token authority conceals",
  );
});

Deno.test("[GAP-020] the wider reading keeps what the narrow one drops", async () => {
  const calls: { readonly sessionToken: string }[] = [];
  const app = new Hono<ActorEnv>();
  app.get("/both", sessionActor(coordinator(calls)), async (context) => {
    const actor = await requireActor(context);
    const session = await requireSession(context);
    if (actor instanceof Response || session instanceof Response) {
      return context.json({ refused: true });
    }
    return context.json({
      actor: Object.keys(actor).sort().join(","),
      session: Object.keys(session).sort().join(","),
    });
  });

  const response = await app.request("http://localhost/both", {
    headers: { Cookie: "kinship_session=token" },
  });

  assertEquals(
    await response.json(),
    {
      actor: "memberId,role,userId,workspaceId",
      session:
        "accessibleWorkspaces,memberId,role,userId,workspaceId,workspaceName",
    },
    "the membership is narrowed and the resolution is not",
  );
  assertEquals(calls.length, 1, "both readings share one resolution");
});

Deno.test("[GAP-020] a route may name its own workspace instead of the header", async () => {
  const calls: { readonly requestedWorkspaceId?: string }[] = [];
  const sessions = coordinator(calls as { sessionToken: string }[]);
  const app = new Hono<ActorEnv>();
  app.get(
    "/scoped",
    sessionActor(sessions, { workspaceQuery: "workspaceId" }),
    async (context) => {
      const actor = await actorOf(context);
      return context.json({ member: actor?.memberId ?? null });
    },
  );

  const named = await app.request(
    `http://localhost/scoped?workspaceId=${uuid(909)}`,
    {
      headers: {
        Cookie: "kinship_session=token",
        [WORKSPACE_HEADER]: uuid(908),
      },
    },
  );
  const unnamed = await app.request("http://localhost/scoped", {
    headers: { Cookie: "kinship_session=token", [WORKSPACE_HEADER]: uuid(908) },
  });

  assertStatus(named, 200);
  assertEquals(
    (await unnamed.json() as { readonly member: string | null }).member,
    member.memberId,
    "a request that names no workspace falls back to the header",
  );
  assertEquals(
    calls.map((call) => call.requestedWorkspaceId).join(","),
    `${uuid(909)},${uuid(908)}`,
    "the query string wins, and only where there is one",
  );
});

Deno.test("[GAP-020] one reading lets an outage through as a throw", async () => {
  const offline: SessionCoordinator = {
    resolve: () => Promise.reject(new Error("offline")),
  };
  const app = new Hono<ActorEnv>();
  app.use(sessionActor(offline));
  app.get("/guard", async (context) => {
    const resolved = await readActorOf(context).catch(() =>
      "unavailable" as const
    );
    return context.json({ resolved });
  });
  app.get("/anonymous", async (context) => {
    const resolved = await readActorOf(context).catch(() =>
      "unavailable" as const
    );
    return context.json({ resolved: resolved ?? null });
  });

  const outage = await app.request("http://localhost/guard", {
    headers: { Cookie: "kinship_session=token" },
  });
  const anonymous = await app.request("http://localhost/anonymous");

  assertEquals(
    (await outage.json() as { readonly resolved: string }).resolved,
    "unavailable",
    "a session store that will not answer is not read as nobody",
  );
  assertEquals(
    (await anonymous.json() as { readonly resolved: string | null }).resolved,
    null,
    "no cookie is still nobody, and costs no read",
  );
});

Deno.test("[GAP-039] the actor carries this request's identifier into the use case", async () => {
  const app = new Hono<RequestIdEnv>();
  app.use(requestId());
  const routes = new Hono<ActorEnv>();
  routes.use(sessionActor(coordinator([])));
  routes.get("/who", async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const read = await readActorOf(context);
    return context.json({ actor, read: read?.requestId });
  });

  app.route("/", routes);

  const response = await app.request("http://localhost/who", {
    headers: {
      Cookie: "kinship_session=token",
      [REQUEST_ID_HEADER]: "gateway-3f2a9c0d",
    },
  });
  const body = await response.json() as {
    readonly actor: SessionActor;
    readonly read?: string;
  };

  assertEquals(
    body.actor.requestId,
    "gateway-3f2a9c0d",
    "the gateway's identifier is the actor's correlation",
  );
  assertEquals(
    Object.keys(body.actor).sort().join(","),
    "memberId,requestId,role,userId,workspaceId",
    "the membership and its correlation, nothing else",
  );
  assertEquals(
    body.read,
    "gateway-3f2a9c0d",
    "every actor reading carries the same identifier",
  );
});

Deno.test("[GAP-039] a token-authenticated actor carries the request identifier too", async () => {
  const app = new Hono<RequestIdEnv>();
  app.use(requestId({ generate: () => "minted-7" }));
  const routes = new Hono<ActorEnv>();
  routes.use(sessionActor(coordinator([])));
  routes.get("/token", async (context) => {
    const actor = await requireTokenOrSessionActor(context, {
      scope: "people:read",
      tokens: {
        authenticate: () =>
          Promise.resolve({ actor: member, status: "authenticated" }),
      },
    });
    return context.json({
      requestId: actor instanceof Response ? null : actor.requestId,
    });
  });

  app.route("/", routes);

  const response = await app.request("http://localhost/token", {
    headers: { Authorization: "Bearer kinship_pat_token" },
  });

  assertEquals(
    await response.json(),
    { requestId: "minted-7" },
    "a minted identifier reaches a token actor as well",
  );
});

Deno.test("[INTEGRATION-002] a scoped token authority is only asked for the scopes it serves", () => {
  const personal: ScopedTokenAuthority<"people:read"> = {
    authenticate: () => Promise.resolve({ status: "invalid" as const }),
  };
  const asked = (context: Context<ActorEnv>) => [
    requireTokenOrSessionActor(context, {
      scope: "people:read",
      tokens: personal,
    }),
    requireTokenOrSessionActor(context, {
      scope: "calendar.read",
      // @ts-expect-error a personal-token authority never serves the calendar feed
      tokens: personal,
    }),
    // @ts-expect-error nor any scope it does not name
    personal.authenticate("token", "calendar.read"),
  ];
  assertEquals(
    typeof asked,
    "function",
    "the constraint is checked at compile time",
  );
});

Deno.test("[AUD-K1] a second sessionActor reuses the first one's resolution", async () => {
  const calls: { readonly sessionToken: string }[] = [];
  const app = new Hono<ActorEnv>();
  app.use(sessionActor(coordinator(calls)));
  const routes = new Hono<ActorEnv>();
  routes.use(sessionActor(coordinator(calls)));
  routes.get("/who", async (context) => {
    const actor = await requireActor(context);
    const read = await readActorOf(context);
    return context.json({
      same: !(actor instanceof Response) && Boolean(read),
    });
  });
  app.route("/", routes);

  const response = await app.request("http://localhost/who", {
    headers: { Cookie: "kinship_session=token" },
  });

  assertEquals(await response.json(), { same: true });
  assertEquals(calls.length, 1, "the router's middleware asked nobody again");
});

Deno.test("[AUD-K1] a route that reads a session refuses a malformed workspace header", async () => {
  const calls: { readonly sessionToken: string }[] = [];
  const app = guarded(coordinator(calls));
  const ask = (headers: Record<string, string>) =>
    app.request("http://localhost/who", { headers });

  const cookie = await ask({
    Cookie: "kinship_session=token",
    [WORKSPACE_HEADER]: "not-a-uuid",
  });
  const anonymous = await ask({ [WORKSPACE_HEADER]: "not-a-uuid" });
  const empty = await ask({
    Cookie: "kinship_session=token",
    [WORKSPACE_HEADER]: "",
  });

  assertStatus(cookie, 400, "a cookie with a malformed header");
  assertEquals(
    (await cookie.json() as { readonly code: string }).code,
    "workspace_header_invalid",
  );
  assertStatus(anonymous, 400, "the header is judged before the credential");
  assertStatus(empty, 200, "an empty header names no workspace");
  assertEquals(
    JSON.stringify(calls),
    JSON.stringify([{ sessionToken: "token" }]),
    "only the empty header reached the coordinator, as no workspace",
  );
});

Deno.test("[AUD-K1] the app-wide resolution judges no header and never asks with a bad one", async () => {
  const calls: { readonly sessionToken: string }[] = [];
  const app = new Hono<ActorEnv>();
  app.use(sessionResolution(coordinator(calls)));
  app.get("/feed", async (context) => {
    const read = await readActorOf(context);
    return context.json({ read: read?.memberId ?? null });
  });
  app.get("/token", async (context) => {
    const actor = await requireTokenOrSessionActor(context, {
      scope: "people:read",
    });
    return actor instanceof Response ? actor : context.json(actor);
  });

  const feed = await app.request("http://localhost/feed", {
    headers: {
      Cookie: "kinship_session=token",
      [WORKSPACE_HEADER]: "not-a-uuid",
    },
  });
  const bearer = await app.request("http://localhost/token", {
    headers: { Authorization: "Bearer x", [WORKSPACE_HEADER]: "not-a-uuid" },
  });

  assertStatus(feed, 200, "a route that reads no session keeps its answer");
  assertEquals(await feed.json(), { read: null }, "a bad header is nobody");
  assertEquals(calls.length, 0, "the coordinator is never asked with it");
  assertStatus(bearer, 400, "the token path refuses the header itself");
});

Deno.test("[AUD-K1] a token-admitted member answers to the admission the guard set", async () => {
  const app = new Hono<ActorEnv>();
  app.use(sessionActor(coordinator([])));
  app.use(async (context, next) => {
    context.set(
      "tokenAdmission",
      (actor) =>
        Promise.resolve(
          actor.memberId === member.memberId
            ? context.json({ refused: true }, 403)
            : undefined,
        ),
    );
    await next();
  });
  app.get("/token", async (context) => {
    const actor = await requireTokenOrSessionActor(context, {
      scope: "people:read",
      tokens: {
        authenticate: () =>
          Promise.resolve({ actor: member, status: "authenticated" }),
      },
    });
    return actor instanceof Response ? actor : context.json(actor);
  });

  const response = await app.request("http://localhost/token", {
    headers: { Authorization: "Bearer good" },
  });

  assertStatus(response, 403, "the admission's refusal is the answer");
});

Deno.test("[AUD-K1] a link route's one resolution is made for the workspace it names", async () => {
  const calls: { readonly requestedWorkspaceId?: string }[] = [];
  const sessions = coordinator(calls as { sessionToken: string }[]);
  const app = new Hono<ActorEnv>();
  app.get(
    "/scoped",
    sessionResolution(sessions, { workspaceQuery: "workspaceId" }),
  );
  app.use(sessionResolution(sessions));
  const guarded: (string | undefined)[] = [];
  app.use(async (context, next) => {
    guarded.push((await readActorOf(context))?.memberId);
    await next();
  });
  app.get("/scoped", sessionActor(sessions), async (context) => {
    await actorOf(context);
    return context.json({});
  });
  const headers = {
    Cookie: "kinship_session=token",
    [WORKSPACE_HEADER]: uuid(908),
  };

  await app.request(`http://localhost/scoped?workspaceId=${uuid(909)}`, {
    headers,
  });
  await app.request("http://localhost/scoped", { headers });

  assertEquals(
    calls.map((call) => call.requestedWorkspaceId).join(","),
    `${uuid(909)},${uuid(908)}`,
    "the query wins where there is one, and each request asks once",
  );
  assertEquals(guarded.length, 2, "the guard read that same resolution");
});
