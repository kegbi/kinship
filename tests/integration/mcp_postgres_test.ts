/**
 * The MCP endpoint over the real composition and PostgreSQL (MCP-C1).
 *
 * Every request here is one an MCP client would send: a JSON-RPC message
 * posted to `/api/v1/mcp` with a personal token minted through the real
 * settings route, in the 2025-era shape (an `initialize` handshake, then the
 * negotiated version as a header) or the 2026-07-28 shape (a protocol
 * envelope in `_meta` and the standard headers). A tool call reaches its
 * route in process, so what it creates is what REST then reads back, and its
 * audit names the token that made it.
 */

import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import { ORIGIN, type SignedInFixture } from "../support/api.ts";
import { composeTokenSuite } from "../support/tokens.ts";

const suite = composeTokenSuite();
const { api, register, sql, tokens } = suite;

const LEGACY = "2025-06-18";
const MODERN = "2026-07-28";
const ENVELOPE = {
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientInfo": { name: "mcp-suite", version: "1" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

type Era = "legacy" | "modern";

interface Rpc {
  readonly id?: number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

interface PostOptions {
  readonly era?: Era;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Posts one JSON-RPC message the way a client of `era` would. */
async function post(
  secret: string | undefined,
  message: Rpc,
  options: PostOptions = {},
): Promise<Response> {
  const era = options.era ?? "legacy";
  const name = message.params?.name;
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    ...(secret === undefined ? {} : { Authorization: `Bearer ${secret}` }),
    ...(era === "modern"
      ? {
        "MCP-Protocol-Version": MODERN,
        "Mcp-Method": message.method,
        ...(typeof name === "string" ? { "Mcp-Name": name } : {}),
      }
      : message.method === "initialize"
      ? {}
      : { "MCP-Protocol-Version": LEGACY }),
    ...options.headers,
  };
  const body = era === "modern"
    ? { ...message, params: { ...message.params, _meta: ENVELOPE } }
    : message;
  return await suite.app.request(`${ORIGIN}/api/v1/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", ...body }),
  });
}

// deno-lint-ignore no-explicit-any
type Json = any;

/** The JSON-RPC result of a 200 answer, which must be one JSON body. */
async function resultOf(response: Response): Promise<Json> {
  const text = await response.text();
  assert(response.status === 200, `expected 200: ${response.status} ${text}`);
  assert(
    response.headers.get("Content-Type")?.startsWith("application/json"),
    `one JSON body, not ${response.headers.get("Content-Type")}`,
  );
  const body = JSON.parse(text);
  assert(body.error === undefined, `a JSON-RPC error: ${text}`);
  return body.result;
}

function callTool(
  secret: string,
  name: string,
  args: Record<string, unknown>,
  options: PostOptions = {},
): Promise<Response> {
  return post(secret, {
    id: 10,
    method: "tools/call",
    params: { name, arguments: args },
  }, options);
}

async function listedNames(secret: string, era: Era): Promise<string[]> {
  const listed = await resultOf(
    await post(secret, { id: 2, method: "tools/list" }, { era }),
  );
  return (listed.tools as { name: string }[]).map((tool) => tool.name).sort();
}

async function ownerOf(label: string): Promise<SignedInFixture> {
  return await register(
    `mcp-${label}-${crypto.randomUUID()}@example.test`,
    `MCP ${label}`,
  );
}

Deno.test("[MCP-C1] PostgreSQL MCP clients of both eras see only the tools their token's scopes allow", async () => {
  const owner = await ownerOf("eras");
  const reader = await tokens.mint(owner, ["tasks:read"]);

  const initialized = await resultOf(
    await post(reader.secret, {
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LEGACY,
        capabilities: {},
        clientInfo: { name: "mcp-suite", version: "1" },
      },
    }),
  );
  assertEquals(initialized.serverInfo.name, "kinship");
  assertEquals(initialized.protocolVersion, LEGACY);
  const notified = await post(reader.secret, {
    method: "notifications/initialized",
  });
  assertEquals(notified.status, 202, "the handshake notification");
  assertEquals(await listedNames(reader.secret, "legacy"), [
    "get_context",
    "get_task",
    "list_tasks",
  ]);

  const discovered = await resultOf(
    await post(reader.secret, { id: 1, method: "server/discover" }, {
      era: "modern",
    }),
  );
  assert(
    discovered.supportedVersions.includes(MODERN),
    "the 2026-07-28 revision is served",
  );
  assertEquals(await listedNames(reader.secret, "modern"), [
    "get_context",
    "get_task",
    "list_tasks",
  ]);

  const context = await resultOf(
    await callTool(reader.secret, "get_context", {}, { era: "modern" }),
  );
  assertEquals(context.structuredContent.token.id, reader.record.id);
  assertEquals(context.structuredContent.workspaceId, owner.workspaceId);
});

Deno.test("[MCP-C1] PostgreSQL a tool call creates through the route, REST reads it back, and audit names the token", async () => {
  const owner = await ownerOf("create");
  const writer = await tokens.mint(owner, ["tasks:create"]);
  const requestId = crypto.randomUUID();
  const correlation = `mcp-suite-${crypto.randomUUID()}`;
  const created = await resultOf(
    await callTool(writer.secret, "create_task", {
      requestId,
      title: "Call Ada back",
    }, { headers: { "X-Request-Id": correlation } }),
  );
  assert(created.isError !== true, JSON.stringify(created));
  const taskId = created.structuredContent.task.id as string;
  assertEquals(created.structuredContent.task.title, "Call Ada back");

  const read = await api.request(owner, `/api/v1/tasks/${taskId}`);
  assertEquals(read.status, 200, "REST reads the task the tool created");
  assertEquals(
    (await read.json() as { task: { title: string } }).task.title,
    "Call Ada back",
  );

  const retried = await resultOf(
    await callTool(writer.secret, "create_task", {
      requestId,
      title: "Call Ada back",
    }, { era: "modern" }),
  );
  assertEquals(
    retried.structuredContent.task.id,
    taskId,
    "the same retry key returns the original task",
  );

  const rows = await sql<
    { api_token_id: string | null; request_id: string | null }[]
  >`select payload ->> 'apiTokenId' as api_token_id,
      payload ->> 'requestId' as request_id
    from crm.audit_events
    where workspace_id = ${owner.workspaceId}::uuid
      and subject_id = ${taskId}::uuid`;
  assert(rows.length >= 1, "the create is audited");
  assert(
    rows.every((row) => row.api_token_id === writer.record.id),
    `every audit event names the token: ${JSON.stringify(rows)}`,
  );
  assert(
    rows.some((row) => row.request_id === correlation),
    `the audit carries the MCP request's id: ${JSON.stringify(rows)}`,
  );
});

Deno.test("[MCP-C1] PostgreSQL a tool outside the token's scopes is refused before any use case runs", async () => {
  const owner = await ownerOf("scope");
  const reader = await tokens.mint(owner, ["tasks:read"]);
  const response = await callTool(reader.secret, "create_task", {
    title: "Must not exist",
  });
  const body = await response.json() as Json;
  assert(
    body.error !== undefined || body.result?.isError === true,
    `create_task is not callable with tasks:read: ${JSON.stringify(body)}`,
  );
  const [row] = await sql<{ count: string }[]>`
    select count(*)::text as count from crm.tasks
    where workspace_id = ${owner.workspaceId}::uuid`;
  assertEquals(row?.count, "0", "no task was created");
});

Deno.test("[MCP-C1] PostgreSQL a route's validation failure is an error result naming its problem", async () => {
  const owner = await ownerOf("invalid");
  const writer = await tokens.mint(owner, ["tasks:create", "tasks:write"]);
  const created = await resultOf(
    await callTool(writer.secret, "create_task", { title: "Edit me" }),
  );
  const task = created.structuredContent.task as {
    id: string;
    updatedAt: string;
  };
  // The argument schema has no "at least one change" rule; the route does.
  const refused = await resultOf(
    await callTool(writer.secret, "update_task", {
      expectedUpdatedAt: task.updatedAt,
      taskId: task.id,
    }),
  );
  assert(refused.isError === true, JSON.stringify(refused));
  assertEquals(refused.structuredContent.code, "task_request_invalid");
  assert(
    JSON.stringify(refused.content).includes("task_request_invalid"),
    "the text names the problem code",
  );
});

Deno.test("[MCP-C1] PostgreSQL the endpoint admits only a current bearer token from no foreign origin", async () => {
  const owner = await ownerOf("admission");
  const agent = await tokens.mint(owner, ["tasks:read"]);
  const list = { id: 2, method: "tools/list" };
  assertEquals((await post(agent.secret, list)).status, 200);

  const foreign = await post(agent.secret, list, {
    headers: { Origin: "https://elsewhere.example" },
  });
  assertEquals(foreign.status, 403, "a foreign origin");
  assertEquals((await foreign.json() as Json).code, "origin_invalid");

  const cookie = await post(undefined, list, {
    headers: { Cookie: owner.cookie },
  });
  assertEquals(cookie.status, 401, "a valid session cookie is not a bearer");
  assertEquals(
    cookie.headers.get("WWW-Authenticate"),
    'Bearer realm="kinship"',
  );
  await cookie.body?.cancel();

  const revoked = await api.request(
    owner,
    `/api/v1/settings/api-tokens/${agent.record.id}`,
    "DELETE",
  );
  assertEquals(revoked.status, 200, "the token is revoked");
  const refused = await post(agent.secret, list);
  assertEquals(refused.status, 401, "a revoked token");
  assertEquals(
    refused.headers.get("WWW-Authenticate"),
    'Bearer realm="kinship"',
  );
  const text = await refused.text();
  assert(!text.includes(agent.secret), "the refusal never echoes the token");
});

Deno.test("[MCP-C1] PostgreSQL the legal guard refuses a token whose member owes a document", async () => {
  const owner = await ownerOf("legal");
  const agent = await tokens.mint(owner, ["tasks:read"]);
  const list = { id: 2, method: "tools/list" };
  assertEquals((await post(agent.secret, list)).status, 200);
  const documentId = crypto.randomUUID();
  await sql`insert into crm.legal_documents
    (id, document_type, version, content, published_at, is_active)
    values (${documentId}::uuid, 'terms', ${`mcp-c1-${documentId}`},
      'Terms published after the token', now() - interval '1 minute', true)`;
  try {
    const refused = await post(agent.secret, list);
    assertEquals(refused.status, 403, "an outstanding document");
    assertEquals(
      (await refused.json() as Json).code,
      "legal_acceptance_required",
    );
  } finally {
    await sql`delete from crm.legal_documents where id = ${documentId}::uuid`;
  }
  assertEquals(
    (await post(agent.secret, list)).status,
    200,
    "withdrawn terms admit the token again",
  );
});

Deno.test({
  name: "close MCP PostgreSQL fixture",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await suite.close();
  },
});
