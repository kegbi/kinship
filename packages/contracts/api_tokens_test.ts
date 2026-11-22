import { buildOpenApiDocument } from "../../tools/contracts/document.ts";
import { buildExternalOpenApiDocument } from "../../tools/contracts/external.ts";
import { apiTokenCreateInput, apiTokenScope } from "./schemas/api_tokens.ts";
import { API_TOKEN_SCOPES } from "../backend/modules/api-access/public.ts";
import { ANY_TOKEN_OPERATIONS, API_ROUTES } from "./routes/mod.ts";
import { tokenOrSessionWriteHeaders } from "./routes/common.ts";
import {
  createApiToken,
  getApiTokens,
  getPersonIdentity,
  getTask,
  listTasks,
  revokeApiToken,
} from "./generated/auth-client.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface PublishedOperation {
  readonly description?: string;
  readonly operationId: string;
  readonly parameters?: readonly { name: string; required?: boolean }[];
  readonly security?: readonly Record<string, readonly string[]>[];
  readonly "x-kinship-token-scope"?: string;
}

type PublishedPaths = Record<string, Record<string, PublishedOperation>>;

const SAFE_METHODS = new Set(["get"]);

/**
 * The one rule every token-enabled route keeps (MCP-A1): it names its scope
 * on the descriptor, the documents publish that scope, it is admitted by the
 * session cookie or a token (or a token alone, for the routes that accept any
 * valid token), a write takes the optional `Origin` a bearer may omit, and its
 * prose names the scope it needs.
 */
Deno.test("[MCP-A1] every token-enabled route publishes its one scope and the bearer pair", () => {
  const internal = buildOpenApiDocument() as { paths: PublishedPaths };
  const external = buildExternalOpenApiDocument() as { paths: PublishedPaths };
  const anyToken = new Set<string>(ANY_TOKEN_OPERATIONS);
  const tokenRoutes = API_ROUTES.filter((route) =>
    route.security?.some((entry) => "kinship_api_token" in entry)
  );
  assert(tokenRoutes.length > 0, "some route accepts a personal token");
  for (const route of tokenRoutes) {
    const name = route.operationId;
    const published = internal.paths[route.path]?.[route.method];
    const projected = external.paths[route.path]?.[route.method];
    assert(published && projected, `${name} is in both documents`);
    if (anyToken.has(name)) {
      assert(route.tokenScope === undefined, `${name} accepts any token`);
      assert(
        JSON.stringify(route.security) ===
          JSON.stringify([{ kinship_api_token: [] }]),
        `${name} is token-only`,
      );
      assert(
        published["x-kinship-token-scope"] === undefined &&
          projected["x-kinship-token-scope"] === undefined,
        `${name} publishes no scope`,
      );
      continue;
    }
    const scope = route.tokenScope;
    assert(
      scope !== undefined && apiTokenScope.safeParse(scope).success,
      `${name} names a token scope of the vocabulary: ${scope}`,
    );
    assert(
      JSON.stringify(route.security) ===
        JSON.stringify([{ kinship_session: [] }, { kinship_api_token: [] }]),
      `${name} is admitted by the session or a token, with empty scope arrays`,
    );
    assert(
      published["x-kinship-token-scope"] === scope &&
        projected["x-kinship-token-scope"] === scope,
      `${name} publishes x-kinship-token-scope ${scope} in both documents`,
    );
    assert(
      route.description?.includes(scope),
      `${name} describes the ${scope} grant it requires`,
    );
    if (!SAFE_METHODS.has(route.method)) {
      assert(
        route.request?.headers === tokenOrSessionWriteHeaders,
        `${name} takes the Origin a bearer write may omit`,
      );
      assert(
        published.parameters?.find((p) => p.name === "Origin")?.required ===
          false,
        `${name} publishes Origin as optional`,
      );
    }
  }
  for (const route of API_ROUTES) {
    if (tokenRoutes.includes(route)) continue;
    assert(
      route.tokenScope === undefined,
      `${route.operationId} names a scope and accepts no token`,
    );
  }
});

Deno.test("routes that are not token-enabled keep session admission", () => {
  const document = buildOpenApiDocument() as { paths: PublishedPaths };
  const sessionOnly = (path: string, method = "get") =>
    JSON.stringify(document.paths[path]?.[method]?.security) ===
      JSON.stringify([{ kinship_session: [] }]);
  for (const path of ["/api/v1/today/tasks", "/api/v1/today/reminders"]) {
    assert(sessionOnly(path), `${path}: Today stays session-only`);
  }
  assert(
    document.paths["/api/v1/reminders"]?.post?.parameters?.find((p) =>
      p.name === "Origin"
    )?.required === true,
    "unrelated cookie write Origin remains required",
  );
  for (
    const path of [
      "/api/v1/people/{personId}/activity-report",
      "/api/v1/people/{personId}/communications",
      "/api/v1/today/favorite-notes",
      "/api/v1/today/recent-activity",
    ]
  ) {
    assert(
      sessionOnly(path),
      `${path}: historic projections stay session-only`,
    );
  }
  assert(
    sessionOnly("/api/v1/people/{personId}"),
    "full profile never accepts a personal token",
  );
  assert(
    document.paths["/api/v1/tasks"]?.get?.parameters?.some((p) =>
      p.name === "dueBefore"
    ),
    "dueBefore is published",
  );
});

/** A scope name the vocabulary's `area:verb` grammar can never produce. */
const NEVER_A_SCOPE = "not a scope";

Deno.test("personal tokens deliberately accept multiple distinct supported grants", () => {
  assert(
    apiTokenCreateInput.safeParse({
      name: "Connector",
      scopes: [...API_TOKEN_SCOPES],
    }).success,
    "every grant may be selected together",
  );
  for (
    const invalid of [[], ["people:read", "people:read"], [NEVER_A_SCOPE], [
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
  assert(
    apiTokenCreateInput.safeParse({
      name: "Capture",
      scopes: ["interactions:create"],
    }).success,
    "capture-only grant can be issued",
  );
});

Deno.test("task client exposes detail and keeps dueBefore on filtered pagination", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; workspace: string | null }[] = [];
  globalThis.fetch = (input, init) => {
    calls.push({
      url: String(input),
      workspace: new Headers(init?.headers).get("X-Workspace-Id"),
    });
    return Promise.resolve(Response.json({ status: "ready", items: [] }));
  };
  try {
    await getTask("task/id", "workspace");
    await getTask("task/id");
    await listTasks({
      dueBefore: "2026-10-25T12:00:00+02:00",
      cursor: "bound",
      limit: 1,
      personId: "person",
      status: "open",
    }, "workspace");
    const query = new URL(calls[2]!.url, "http://localhost").searchParams;
    assert(
      calls[0]?.url === "/api/v1/tasks/task%2Fid" &&
        calls[0].workspace === "workspace" && calls[1]?.workspace === null,
      "detail ID encoded and optional workspace retained",
    );
    assert(
      query.get("dueBefore") === "2026-10-25T12:00:00+02:00" &&
        query.get("cursor") === "bound" && query.get("personId") === "person" &&
        query.get("status") === "open" && query.get("limit") === "1",
      "list client retains the complete filter question",
    );
  } finally {
    globalThis.fetch = original;
  }
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
