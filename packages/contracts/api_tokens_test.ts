import { buildOpenApiDocument } from "../../tools/contracts/document.ts";
import { apiTokenCreateInput } from "./schemas/api_tokens.ts";
import { API_TOKEN_SCOPES } from "../backend/modules/api-access/public.ts";
import {
  createApiToken,
  getApiTokens,
  getPersonIdentity,
  revokeApiToken,
} from "./generated/auth-client.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("personal tokens deliberately accept multiple distinct supported read grants", () => {
  const scopes = ["people:read", "people:profile:read", "relationships:read"];
  assert(
    apiTokenCreateInput.safeParse({ name: "Connector", scopes }).success,
    "all delivered read grants may be selected together",
  );
  for (
    const invalid of [[], ["people:read", "people:read"], ["people:write"], [
      "calendar.read",
    ]]
  ) {
    assert(
      !apiTokenCreateInput.safeParse({ name: "Connector", scopes: invalid })
        .success,
      "empty, duplicate, unknown, and feed scopes are refused",
    );
  }
  assert(
    JSON.stringify(apiTokenCreateInput.shape.scopes.element.options) ===
      JSON.stringify(API_TOKEN_SCOPES),
    "transport and pure domain share the closed vocabulary",
  );
});

Deno.test("generated minimal identity client uses the scoped route and workspace header", async () => {
  const original = globalThis.fetch;
  let path = "";
  let workspace = "";
  const person = {
    givenName: "Ada",
    id: crypto.randomUUID(),
    isPartial: false,
  };
  globalThis.fetch = (input, init) => {
    path = String(input);
    workspace = new Headers(init?.headers).get("X-Workspace-Id") ?? "";
    return Promise.resolve(Response.json({ person, status: "archived" }));
  };
  try {
    const result = await getPersonIdentity(person.id, "workspace");
    assert(
      result.ok && result.value.status === "archived" &&
        result.value.person.id === person.id,
      "minimal result returned",
    );
    assert(
      path === `/api/v1/people/${person.id}/identity` &&
        workspace === "workspace",
      "minimal route and tenant header used",
    );
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("person reads document domain grants with HTTP bearer security and leave aggregates session-only", () => {
  const document = buildOpenApiDocument() as {
    paths: Record<
      string,
      Record<
        string,
        { security: Record<string, string[]>[]; description?: string }
      >
    >;
  };
  for (
    const [path, grant] of [
      ["/api/v1/people", "people:read"],
      ["/api/v1/people/{personId}/identity", "people:profile:read"],
      ["/api/v1/people/{personId}/dates", "people:profile:read"],
      ["/api/v1/people/{personId}/facts/{section}", "people:profile:read"],
      ["/api/v1/people/{personId}/relationships", "relationships:read"],
      ["/api/v1/relationship-types", "relationships:read"],
    ]
  ) {
    const operation = document.paths[path!]?.get;
    assert(
      operation && operation.description?.includes(grant!),
      "required domain grant described",
    );
    assert(
      JSON.stringify(operation.security) ===
        JSON.stringify([{ kinship_session: [] }, { kinship_api_token: [] }]),
      "HTTP bearer schemes have empty scope arrays",
    );
  }
  assert(
    JSON.stringify(
      document.paths["/api/v1/people/{personId}"]?.get?.security,
    ) === JSON.stringify([{ kinship_session: [] }]),
    "full profile never accepts a personal token",
  );
});

Deno.test("API-001 contract returns the one-time secret and generates token management calls", async () => {
  const document = buildOpenApiDocument() as unknown as {
    components: {
      schemas: {
        ApiTokenCreated: {
          properties: { secret: { writeOnly?: boolean } };
        };
      };
    };
  };
  assert(
    document.components.schemas.ApiTokenCreated.properties.secret.writeOnly !==
      true,
    "create response secret is readable response data",
  );

  const calls: Array<{ body?: string; method: string; path: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    calls.push({
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
      method: init?.method ?? "GET",
      path: String(input),
    });
    const body = init?.method === "POST"
      ? {
        record: {
          createdAt: "2026-08-24T10:00:00.000Z",
          id: crypto.randomUUID(),
          name: "Desktop",
          scopes: ["people:read"],
        },
        secret: "kin_pat_visible_once",
        status: "created",
      }
      : init?.method === "DELETE"
      ? {
        record: {
          createdAt: "2026-08-24T10:00:00.000Z",
          id: crypto.randomUUID(),
          name: "Desktop",
          revokedAt: "2026-08-24T11:00:00.000Z",
          scopes: ["people:read"],
        },
        status: "revoked",
      }
      : { records: [], scopes: ["people:read"], status: "ready" };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: init?.method === "POST" ? 201 : 200,
      }),
    );
  };

  try {
    const created = await createApiToken(
      { name: "Desktop", scopes: ["people:read"] },
      "workspace",
    );
    assert(
      created.ok && created.value.secret === "kin_pat_visible_once",
      "generated client exposes one-time create secret",
    );
    await getApiTokens("workspace");
    await revokeApiToken("token", "workspace");
  } finally {
    globalThis.fetch = original;
  }

  assert(
    calls.map((call) => `${call.method} ${call.path}`).join("|") ===
      "POST /api/v1/settings/api-tokens|GET /api/v1/settings/api-tokens|DELETE /api/v1/settings/api-tokens/token",
    "generated client covers list/create/revoke",
  );
  assert(
    calls[0]?.body ===
      JSON.stringify({ name: "Desktop", scopes: ["people:read"] }),
    "generated create omits an absent optional expiry",
  );
});
