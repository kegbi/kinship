import { createApiTokenRoutes } from "./api_tokens.ts";
import type { ApiTokenHttpServices } from "./api_tokens.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const owner = {
  accessibleWorkspaces: [],
  memberId: "00000000-0000-4000-8000-000000000001",
  role: "owner" as const,
  userId: "00000000-0000-4000-8000-000000000002",
  workspaceId: "00000000-0000-4000-8000-000000000003",
  workspaceName: "Circle",
};

function fixture(role: "owner" | "member" = "owner") {
  const calls: string[] = [];
  const services: ApiTokenHttpServices = {
    apiTokens: {
      authenticate: () => Promise.resolve({ status: "invalid" }),
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
  assert(created.status === 201, "valid token created");
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
