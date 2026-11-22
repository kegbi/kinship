import { createApiTokenRoutes } from "./routes.ts";
import type { ApiTokenHttpServices } from "./routes.ts";
import {
  assert,
  assertEquals,
  assertStatus,
} from "../../../../testing/assert.ts";
import * as fixtures from "../../../../testing/fixtures.ts";

const owner = fixtures.sessionActor({
  memberId: fixtures.uuid(1),
  role: "owner",
  userId: fixtures.uuid(2),
  workspaceName: "Circle",
});

const TOKEN_ID = "00000000-0000-4000-8000-000000000009";

function fixture(role: "owner" | "member" = "owner") {
  const calls: string[] = [];
  const services: ApiTokenHttpServices = {
    apiTokens: {
      create: (_actor, input) => {
        calls.push(`create:${input.scopes.join(",")}`);
        return Promise.resolve({
          record: {
            createdAt: "2026-08-24T10:00:00.000Z",
            id: "00000000-0000-4000-8000-000000000004",
            name: input.name,
            scopes: input.scopes,
          },
          secret: "kin_pat_secret",
          status: "created",
        });
      },
      list: () => {
        calls.push("list");
        return Promise.resolve(
          role === "member"
            ? { status: "forbidden" }
            : { records: [], status: "ready" },
        );
      },
      revoke: (_actor, id) => {
        calls.push(`revoke:${id}`);
        return Promise.resolve({
          record: {
            createdAt: "2026-08-24T10:00:00.000Z",
            id,
            name: "Desktop",
            revokedAt: "2026-08-24T11:00:00.000Z",
            scopes: ["people:read"],
          },
          status: "revoked",
        });
      },
      introspect: (rawToken, requestedWorkspaceId) => {
        calls.push(`introspect:${requestedWorkspaceId ?? "-"}`);
        if (rawToken === "throws") return Promise.reject(new Error("down"));
        return Promise.resolve(
          rawToken === "agent"
            ? {
              actor: { ...owner, role },
              status: "authenticated" as const,
              token: {
                expiresAt: "2026-09-24T10:00:00.000Z",
                id: TOKEN_ID,
                name: "Agent",
                scopes: ["tasks:write", "people:read"],
              },
            }
            : { status: "invalid" as const },
        );
      },
    },
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    protectedSessions: {
      resolve: () => Promise.resolve({ ...owner, role }),
    },
  };
  return { calls, routes: createApiTokenRoutes(services), services };
}

Deno.test("API-001 HTTP requires origin, accepted scopes, and admin membership", async () => {
  const ownerFixture = fixture();
  assert(
    (await ownerFixture.routes.request(
      "http://localhost/api/v1/settings/api-tokens",
      { headers: { cookie: "kinship_session=session" } },
    )).status === 200,
    "owner lists tokens",
  );
  assert(
    (await ownerFixture.routes.request(
      "http://localhost/api/v1/settings/api-tokens",
      {
        body: JSON.stringify({ name: "Desktop", scopes: ["people:read"] }),
        headers: {
          "content-type": "application/json",
          cookie: "kinship_session=session",
        },
        method: "POST",
      },
    )).status === 403,
    "missing origin rejected",
  );
  const created = await ownerFixture.routes.request(
    "http://localhost/api/v1/settings/api-tokens",
    {
      body: JSON.stringify({
        expiresAt: "2026-09-24T10:00:00.000Z",
        name: "Desktop",
        scopes: ["people:read"],
      }),
      headers: {
        "content-type": "application/json",
        cookie: "kinship_session=session",
        origin: "http://localhost",
      },
      method: "POST",
    },
  );
  assertStatus(created, 201, "valid token created");
  assert(
    (await created.text()).includes("kin_pat_secret"),
    "secret returned at creation",
  );
  const id = "00000000-0000-4000-8000-000000000004";
  assert(
    (await ownerFixture.routes.request(
      `http://localhost/api/v1/settings/api-tokens/${id}`,
      {
        headers: {
          cookie: "kinship_session=session",
          origin: "http://localhost",
        },
        method: "DELETE",
      },
    )).status === 200,
    "token revoked",
  );
  assert(
    ownerFixture.calls.join("|") === `list|create:people:read|revoke:${id}`,
    "bounded operations called",
  );
  assert(
    (await fixture("member").routes.request(
      "http://localhost/api/v1/settings/api-tokens",
      { headers: { cookie: "kinship_session=session" } },
    )).status === 403,
    "member forbidden",
  );
});

Deno.test("API-001 HTTP maps invalid, stale, unauthenticated, and unavailable states safely", async () => {
  const state = fixture();
  assert(
    (await state.routes.request("http://localhost/api/v1/settings/api-tokens"))
      .status === 401,
    "missing session rejected",
  );
  assert(
    (await state.routes.request("http://localhost/api/v1/settings/api-tokens", {
      body: JSON.stringify({ name: "Missing scope", scopes: [] }),
      headers: {
        "content-type": "application/json",
        cookie: "kinship_session=session",
        origin: "http://localhost",
      },
      method: "POST",
    })).status === 400,
    "invalid grant rejected",
  );
  assert(
    (await state.routes.request(
      "http://localhost/api/v1/settings/api-tokens/not-a-uuid",
      {
        headers: {
          cookie: "kinship_session=session",
          origin: "http://localhost",
        },
        method: "DELETE",
      },
    )).status === 404,
    "invalid id hidden",
  );
  state.services.apiTokens.list = () => Promise.reject(new Error("offline"));
  assert(
    (await state.routes.request("http://localhost/api/v1/settings/api-tokens", {
      headers: { cookie: "kinship_session=session" },
    })).status === 503,
    "list outage safe",
  );
  state.services.apiTokens.create = () =>
    Promise.resolve({ status: "invalid" });
  assert(
    (await state.routes.request("http://localhost/api/v1/settings/api-tokens", {
      body: JSON.stringify({ name: "Expired", scopes: ["people:read"] }),
      headers: {
        "content-type": "application/json",
        cookie: "kinship_session=session",
        origin: "http://localhost",
      },
      method: "POST",
    })).status === 400,
    "domain validation safe",
  );
  state.services.apiTokens.revoke = () =>
    Promise.resolve({ status: "not-found" });
  const id = "00000000-0000-4000-8000-000000000004";
  assert(
    (await state.routes.request(
      `http://localhost/api/v1/settings/api-tokens/${id}`,
      {
        headers: {
          cookie: "kinship_session=session",
          origin: "http://localhost",
        },
        method: "DELETE",
      },
    )).status === 404,
    "stale token hidden",
  );
});

Deno.test("[MCP-A1] GET /api/v1/me tells a token what it is and who it acts as", async () => {
  const state = fixture("member");
  const me = (headers: Record<string, string>) =>
    state.routes.request("http://localhost/api/v1/me", { headers });

  const answered = await me({ authorization: "Bearer agent" });
  assertStatus(answered, 200, "any valid personal token is admitted");
  assert(
    answered.headers.get("Cache-Control") === "private, no-store",
    "the answer is never cached",
  );
  assertEquals(await answered.json(), {
    memberId: owner.memberId,
    role: "member",
    token: {
      expiresAt: "2026-09-24T10:00:00.000Z",
      id: TOKEN_ID,
      name: "Agent",
      scopes: ["tasks:write", "people:read"],
    },
    workspaceId: owner.workspaceId,
  });
  assertStatus(
    await me({
      authorization: "Bearer agent",
      "X-Workspace-Id": owner.workspaceId,
    }),
    200,
    "the bound workspace may be named",
  );
  assert(
    state.calls.join() === `introspect:-,introspect:${owner.workspaceId}`,
    `the requested workspace reaches the check: ${state.calls}`,
  );

  for (
    const [headers, reason] of [
      [{ cookie: "kinship_session=session" }, "a cookie is never read"],
      [{}, "nothing presented"],
      [
        { authorization: "Bearer refused", cookie: "kinship_session=session" },
        "a refused token never borrows the cookie",
      ],
      [{ authorization: "Basic agent" }, "another scheme"],
      [{ authorization: "Bearer throws" }, "an outage conceals as nobody"],
    ] as const
  ) {
    const refused = await me(headers);
    assertStatus(refused, 401, reason);
    assertEquals(
      (await refused.json() as { code: string }).code,
      "session_invalid",
      reason,
    );
  }
  assertStatus(
    await me({ authorization: "Bearer agent", "X-Workspace-Id": "nope" }),
    400,
    "a malformed workspace header is refused before the token is checked",
  );
});
