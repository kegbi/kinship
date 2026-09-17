import { Hono } from "hono";
import {
  assert,
  assertEquals,
  assertStatus,
} from "../../../packages/backend/testing/assert.ts";
import { sessionActor as fixtureActor } from "../../../packages/backend/testing/fixtures.ts";
import {
  type ActorEnv,
  actorOf,
  bearerToken,
  requireActor,
  type ScopedTokenAuthority,
  type SessionActor,
  sessionActor,
  type SessionCoordinator,
  tokenOrSessionActor,
  WORKSPACE_HEADER,
} from "./session.ts";

const member = fixtureActor();

function coordinator(
  calls: { readonly sessionToken: string }[],
  resolved: SessionActor | undefined = member,
): SessionCoordinator {
  return {
    resolve(command) {
      calls.push(command);
      return Promise.resolve(resolved);
    },
  };
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
        [WORKSPACE_HEADER]: "workspace-2",
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
      requestedWorkspaceId: "workspace-2",
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
  const tokens: ScopedTokenAuthority = {
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
      const actor = await tokenOrSessionActor(context, {
        scope: "people:read",
        tokens,
      });
      return context.json({ member: actor?.memberId ?? null });
    },
  );
  app.get("/no-tokens", sessionActor(coordinator([])), async (context) => {
    const actor = await tokenOrSessionActor(context, { scope: "people:read" });
    return context.json({ member: actor?.memberId ?? null });
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
    const actor = await tokenOrSessionActor(context, {
      scope: "people:read",
      tokens: { authenticate: () => Promise.reject(new Error("offline")) },
    });
    return context.json({ member: actor?.memberId ?? null });
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
