/**
 * The MCP endpoint over a fake introspection and a fake route (MCP-C1).
 *
 * The endpoint authenticates the token, lists what its scopes allow, and
 * turns a call into a request for the route; it decides nothing else. These
 * cases drive it as an MCP client would, in both protocol eras, and pin each
 * refusal it owns: a foreign `Origin`, a missing or refused bearer, a cookie
 * offered instead, a message that is not JSON-RPC, a held-open subscription,
 * and every method but `POST`. No response may ever carry the token.
 */

import { Hono } from "hono";
import { requestId } from "../http-kit/request_id.ts";
import { assert, assertEquals } from "../backend/testing/assert.ts";
import { sessionActor } from "../backend/testing/fixtures.ts";
import { API_VERSION } from "../contracts/version.ts";
import {
  BEARER_CHALLENGE,
  createMcpRoutes,
  type McpTokenIntrospection,
} from "./endpoint.ts";
import { SERVER_INSTRUCTIONS } from "./server.ts";

const ORIGIN = "https://kinship.example";
const SECRET = "kin_pat_00000000-0000-4000-8000-000000000001.c2VjcmV0";
const TOKEN_ID = "00000000-0000-4000-8000-0000000000aa";

interface Harness {
  readonly app: Hono;
  readonly dispatched: Request[];
  readonly introspected: string[];
  readonly bodies: string[];
}

function harness(
  options: {
    readonly scopes?: readonly string[];
    readonly tokens?: McpTokenIntrospection;
    readonly route?: (request: Request) => Response | Promise<Response>;
  } = {},
): Harness {
  const dispatched: Request[] = [];
  const introspected: string[] = [];
  const bodies: string[] = [];
  const tokens: McpTokenIntrospection = options.tokens ?? {
    introspect: (raw) => {
      introspected.push(raw);
      return Promise.resolve(
        raw === SECRET
          ? {
            actor: sessionActor(),
            status: "authenticated",
            token: { id: TOKEN_ID, scopes: options.scopes ?? ["tasks:read"] },
          }
          : { status: "invalid" },
      );
    },
  };
  const app = new Hono();
  app.use(requestId({ generate: () => "outer-request" }));
  app.use(async (context, next) => {
    await next();
    bodies.push(await context.res.clone().text());
  });
  app.route(
    "/",
    createMcpRoutes({
      browserSecurity: { origin: ORIGIN, secureCookie: true },
      tokens,
      dispatch: (request) => {
        dispatched.push(request);
        return options.route?.(request) ??
          Response.json({ items: [], status: "ready" });
      },
    }) as unknown as Hono,
  );
  return { app, bodies, dispatched, introspected };
}

const LEGACY = "2025-06-18";
const MODERN = "2026-07-28";
const ENVELOPE = {
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientInfo": { name: "suite", version: "1" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

interface Rpc {
  readonly id?: number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

/** A 2025-era client: no envelope, and the negotiated version as a header. */
function legacy(
  app: Hono,
  message: Rpc,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(app.request("http://api.internal/api/v1/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      ...(message.method === "initialize"
        ? {}
        : { "MCP-Protocol-Version": LEGACY }),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...message }),
  }));
}

/** A 2026-07-28 client: the envelope in `_meta` and the standard headers. */
function modern(app: Hono, message: Rpc): Promise<Response> {
  const name = message.params?.name;
  return Promise.resolve(app.request("http://api.internal/api/v1/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      "MCP-Protocol-Version": MODERN,
      "Mcp-Method": message.method,
      ...(typeof name === "string" ? { "Mcp-Name": name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...message,
      params: { ...message.params, _meta: ENVELOPE },
    }),
  }));
}

// deno-lint-ignore no-explicit-any
async function result(response: Response): Promise<any> {
  assertEquals(response.status, 200, "a JSON-RPC answer");
  assert(
    response.headers.get("Content-Type")?.startsWith("application/json"),
    `one JSON body, not ${response.headers.get("Content-Type")}`,
  );
  // deno-lint-ignore no-explicit-any
  const body = await response.json() as any;
  assert(body.error === undefined, `no error: ${JSON.stringify(body.error)}`);
  return body.result;
}

function toolNames(listed: { tools: { name: string }[] }): string[] {
  return listed.tools.map((tool) => tool.name).sort();
}

function neverLeaks(suite: Harness): void {
  for (const body of suite.bodies) {
    assert(!body.includes(SECRET), `a response carried the token: ${body}`);
  }
}

Deno.test("[MCP-C1] a 2025-era client initializes, lists its tools, and calls one", async () => {
  const suite = harness({ scopes: ["tasks:read"] });
  const initialized = await result(
    await legacy(suite.app, {
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LEGACY,
        capabilities: {},
        clientInfo: { name: "suite", version: "1" },
      },
    }),
  );
  assertEquals(initialized.serverInfo, {
    name: "kinship",
    version: API_VERSION,
  });
  assertEquals(initialized.capabilities.tools, { listChanged: false });
  assertEquals(initialized.instructions, SERVER_INSTRUCTIONS);

  const accepted = await legacy(suite.app, {
    method: "notifications/initialized",
  });
  assertEquals(accepted.status, 202, "a notification is accepted");

  const listed = await result(
    await legacy(suite.app, { id: 2, method: "tools/list" }),
  );
  assertEquals(toolNames(listed), ["get_context", "get_task", "list_tasks"]);
  const listTasks = listed.tools.find((tool: { name: string }) =>
    tool.name === "list_tasks"
  );
  assertEquals(listTasks.inputSchema.type, "object");
  assertEquals(listTasks.annotations.readOnlyHint, true);

  const called = await result(
    await legacy(suite.app, {
      id: 3,
      method: "tools/call",
      params: { name: "list_tasks", arguments: { status: "open", limit: 5 } },
    }),
  );
  assertEquals(called.structuredContent, { items: [], status: "ready" });
  assert(called.isError !== true, "the route answered 200");
  const [inner] = suite.dispatched;
  assert(inner !== undefined, "the call reached the route");
  const url = new URL(inner.url);
  assertEquals(url.pathname, "/api/v1/tasks");
  assertEquals(url.searchParams.get("status"), "open");
  assertEquals(url.searchParams.get("limit"), "5");
  assertEquals(inner.headers.get("Authorization"), `Bearer ${SECRET}`);
  assertEquals(inner.headers.get("X-Request-Id"), "outer-request");
  assert(inner.headers.get("Cookie") === null, "the cookie stays behind");
  neverLeaks(suite);
});

Deno.test("[MCP-C1] a 2026-07-28 client is answered with one JSON body", async () => {
  const suite = harness({ scopes: ["tasks:read"] });
  const discovered = await result(
    await modern(suite.app, { id: 1, method: "server/discover" }),
  );
  assert(
    discovered.supportedVersions.includes(MODERN),
    "the modern revision is offered",
  );
  const listed = await result(
    await modern(suite.app, { id: 2, method: "tools/list" }),
  );
  assertEquals(toolNames(listed), ["get_context", "get_task", "list_tasks"]);
  const called = await result(
    await modern(suite.app, {
      id: 3,
      method: "tools/call",
      params: { name: "get_context", arguments: {} },
    }),
  );
  assert(called.isError !== true, "the call succeeded");
  assertEquals(new URL(suite.dispatched[0]?.url ?? "").pathname, "/api/v1/me");
  neverLeaks(suite);
});

Deno.test("[MCP-C1] a tool outside the token's scopes is neither listed nor callable", async () => {
  const suite = harness({ scopes: ["tasks:read"] });
  const response = await legacy(suite.app, {
    id: 4,
    method: "tools/call",
    params: {
      name: "create_task",
      arguments: { title: "Not allowed" },
    },
  });
  // deno-lint-ignore no-explicit-any
  const body = await response.json() as any;
  assert(
    body.error !== undefined || body.result?.isError === true,
    `an unlisted tool is refused: ${JSON.stringify(body)}`,
  );
  assertEquals(suite.dispatched.length, 0, "nothing reached a route");

  const writer = harness({ scopes: ["tasks:create"] });
  const listed = await result(
    await legacy(writer.app, { id: 5, method: "tools/list" }),
  );
  assertEquals(toolNames(listed), ["create_task", "get_context"]);
  const created = await result(
    await legacy(writer.app, {
      id: 6,
      method: "tools/call",
      params: { name: "create_task", arguments: { title: "Allowed" } },
    }),
  );
  assert(created.isError !== true, "the scoped call reached its route");
  const [inner] = writer.dispatched;
  assertEquals(inner?.method, "POST");
  const sent = await inner?.json() as { requestId: string; title: string };
  assertEquals(sent.title, "Allowed");
  assert(/^[0-9a-f-]{36}$/.test(sent.requestId), "a retry key was minted");
});

Deno.test("[MCP-C1] arguments the contract refuses never reach the route", async () => {
  const suite = harness({ scopes: ["tasks:read"] });
  const refused = await result(
    await legacy(suite.app, {
      id: 7,
      method: "tools/call",
      params: { name: "get_task", arguments: { taskId: "not-a-uuid" } },
    }),
  );
  assert(refused.isError === true, "an invalid argument is an error result");
  assert(
    JSON.stringify(refused.content).includes("taskId"),
    "the error names the argument",
  );
  assertEquals(suite.dispatched.length, 0, "the route was never asked");
});

Deno.test("[MCP-C1] a route's problem and an unreachable route are error results", async () => {
  const problem = harness({
    route: () =>
      new Response(
        JSON.stringify({
          type: "https://kinship.test/problems/task_conflict",
          title: "Task changed",
          status: 409,
          detail: "Read the task again.",
          code: "task_conflict",
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/problem+json" },
        },
      ),
  });
  const conflicted = await result(
    await legacy(problem.app, {
      id: 8,
      method: "tools/call",
      params: { name: "list_tasks", arguments: {} },
    }),
  );
  assert(conflicted.isError === true, "a problem is an error result");
  assertEquals(conflicted.structuredContent.code, "task_conflict");

  const down = harness({
    route: () => Promise.reject(new Error(`boom ${SECRET}`)),
  });
  const failed = await result(
    await legacy(down.app, {
      id: 9,
      method: "tools/call",
      params: { name: "list_tasks" },
    }),
  );
  assert(failed.isError === true, "an unreachable route is an error result");
  neverLeaks(down);
});

Deno.test("[MCP-C1] a foreign Origin is refused before the token is read", async () => {
  const suite = harness();
  const foreign = await legacy(suite.app, { id: 1, method: "tools/list" }, {
    Origin: "https://evil.example",
  });
  assertEquals(foreign.status, 403);
  assertEquals(
    (await foreign.json() as { code: string }).code,
    "origin_invalid",
  );
  assertEquals(suite.introspected.length, 0, "no token was introspected");

  const own = await legacy(suite.app, { id: 2, method: "tools/list" }, {
    Origin: ORIGIN,
  });
  assertEquals(own.status, 200, "the configured origin passes");
});

Deno.test("[MCP-C1] no bearer, a refused bearer, or a cookie alone is a 401 challenge", async () => {
  const suite = harness();
  for (
    const headers of [
      { Authorization: "" },
      { Authorization: "Bearer kin_pat_unknown" },
      { Authorization: "Basic dXNlcjpwYXNz" },
      { Authorization: "", Cookie: "kinship_session=valid" },
    ]
  ) {
    const response = await legacy(
      suite.app,
      { id: 1, method: "tools/list" },
      headers,
    );
    assertEquals(response.status, 401, JSON.stringify(headers));
    assertEquals(response.headers.get("WWW-Authenticate"), BEARER_CHALLENGE);
    assertEquals(
      (await response.json() as { code: string }).code,
      "session_invalid",
    );
  }
  const thrown = harness({
    tokens: { introspect: () => Promise.reject(new Error("down")) },
  });
  assertEquals(
    (await legacy(thrown.app, { id: 1, method: "tools/list" })).status,
    401,
    "an introspection outage admits nobody",
  );
  assertEquals(suite.dispatched.length, 0, "nothing reached a route");
});

Deno.test("[MCP-C1] a malformed message or a subscription is a JSON-RPC refusal", async () => {
  const suite = harness();
  const send = (body: string) =>
    suite.app.request("http://api.internal/api/v1/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body,
    });
  for (
    const [body, code] of [
      ["{not json", -32700],
      ['{"jsonrpc":"1.0","method":"tools/list"}', -32600],
      ['[{"jsonrpc":"2.0","method":"tools/list","id":1}]', -32600],
    ] as const
  ) {
    const response = await send(body);
    assertEquals(response.status, 400, body);
    assertEquals(
      (await response.json() as { error: { code: number } }).error.code,
      code,
      body,
    );
  }
  const listen = await send(
    '{"jsonrpc":"2.0","id":3,"method":"subscriptions/listen","params":{}}',
  );
  assertEquals(listen.status, 200);
  assertEquals(
    await listen.json() as { error: { code: number }; id: number },
    {
      jsonrpc: "2.0",
      error: {
        code: -32601,
        message: "Method not found: this endpoint offers no subscriptions.",
      },
      id: 3,
    },
  );
});

Deno.test("[MCP-C1] every method but POST answers 405", async () => {
  const suite = harness();
  for (const method of ["GET", "DELETE", "PUT", "PATCH"]) {
    const response = await suite.app.request(
      "http://api.internal/api/v1/mcp",
      { method, headers: { Authorization: `Bearer ${SECRET}` } },
    );
    assertEquals(response.status, 405, method);
    assertEquals(response.headers.get("Allow"), "POST");
  }
  assertEquals(suite.introspected.length, 0, "nobody was authenticated");
});
