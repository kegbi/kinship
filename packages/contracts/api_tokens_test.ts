import { buildOpenApiDocument } from "../../tools/contracts/document.ts";
import {
  createApiToken,
  getApiTokens,
  revokeApiToken,
} from "./generated/auth-client.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
