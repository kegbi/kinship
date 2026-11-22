/**
 * A tool call as a route request, and the route's answer as a tool result
 * (MCP-C1).
 *
 * The endpoint never decides a call: it rebuilds the request the route would
 * have received from a REST client and reports what the route answered. These
 * cases pin both translations — where each argument lands, what the inner
 * request carries and never carries, and how each kind of answer reads to an
 * agent — without a server or a database.
 */

import { z } from "zod";
import { defineRoute } from "../contracts/registry.ts";
import { defineTool } from "../contracts/tools/define.ts";
import { assert, assertEquals } from "../backend/testing/assert.ts";
import { type ToolCaller, toolRequest, toolResult } from "./tool_call.ts";

const SECRET = "kin_pat_00000000-0000-4000-8000-000000000001.c2VjcmV0";

const caller: ToolCaller = {
  base: "http://api.internal",
  clientAddress: "203.0.113.7",
  requestId: "outer-request",
  scopes: ["people:write"],
  token: SECRET,
};

const both = [{ kinship_session: [] }, { kinship_api_token: [] }] as const;

const changeThing = defineRoute({
  method: "patch",
  path: "/api/v1/things/{section}/{thingId}",
  operationId: "changeThingFixture",
  tokenScope: "people:write",
  security: both,
  request: {
    params: z.object({ section: z.string(), thingId: z.string() }),
    query: z.object({
      ids: z.array(z.string()).optional(),
      limit: z.coerce.number().optional(),
    }),
    body: {
      required: true,
      content: {
        "application/json": z.strictObject({
          kind: z.literal("thing"),
          requestId: z.uuid(),
          section: z.string(),
          title: z.string().nullable().optional(),
        }),
      },
    },
  },
  responses: { 200: { description: "ok" } },
});

const tool = defineTool({
  name: "update_thing",
  title: "Update a thing",
  description: "Updates a thing.",
  route: changeThing,
  shared: ["section"],
  fixed: { kind: "thing" },
  minted: { requestId: "uuid" },
});

const listThings = defineTool({
  name: "list_things",
  title: "List things",
  description: "Lists things.",
  route: defineRoute({
    method: "get",
    path: "/api/v1/things",
    operationId: "listThingsFixture",
    tokenScope: "people:read",
    security: both,
    responses: { 200: { description: "ok" } },
  }),
});

Deno.test("[MCP-C1] arguments land in the path, the query, and the body the route reads", async () => {
  const request = toolRequest(tool, {
    ids: ["a", "b"],
    limit: 5,
    section: "a/b c",
    thingId: "x?y",
    title: null,
  }, caller);
  const url = new URL(request.url);
  assertEquals(url.origin, "http://api.internal");
  assertEquals(url.pathname, "/api/v1/things/a%2Fb%20c/x%3Fy");
  assertEquals(url.searchParams.get("ids"), "a,b");
  assertEquals(url.searchParams.get("limit"), "5");
  assertEquals(request.method, "PATCH");
  const body = await request.json() as Record<string, unknown>;
  assertEquals(Object.keys(body).sort(), [
    "kind",
    "requestId",
    "section",
    "title",
  ]);
  assertEquals(body.kind, "thing");
  assertEquals(body.section, "a/b c");
  assertEquals(body.title, null);
  assert(
    /^[0-9a-f-]{36}$/.test(String(body.requestId)),
    "a left-out retry key is minted",
  );
  const supplied = toolRequest(tool, {
    requestId: "11111111-1111-4111-8111-111111111111",
    section: "a",
    thingId: "t",
  }, caller);
  assertEquals(
    (await supplied.json() as { requestId: string }).requestId,
    "11111111-1111-4111-8111-111111111111",
  );
});

Deno.test("[MCP-C1] the inner request carries the caller's token and correlation, never a cookie or origin", () => {
  const request = toolRequest(tool, { section: "a", thingId: "t" }, caller);
  assertEquals(request.headers.get("Authorization"), `Bearer ${SECRET}`);
  assertEquals(request.headers.get("X-Request-Id"), "outer-request");
  assertEquals(
    request.headers.get("X-Kinship-Client-Address"),
    "203.0.113.7",
  );
  assertEquals(request.headers.get("Content-Type"), "application/json");
  assert(request.headers.get("Cookie") === null, "no cookie");
  assert(request.headers.get("Origin") === null, "no origin");

  const bare = toolRequest(listThings, {}, {
    base: caller.base,
    scopes: [],
    token: SECRET,
  });
  assert(bare.body === null, "a route without a body is sent none");
  assert(bare.headers.get("Content-Type") === null, "and no media type");
  assert(bare.headers.get("X-Request-Id") === null, "no invented id");
  assert(
    bare.headers.get("X-Kinship-Client-Address") === null,
    "no invented address",
  );
});

function answer(status: number, body?: unknown, type?: string): Response {
  return new Response(
    body === undefined
      ? null
      : typeof body === "string"
      ? body
      : JSON.stringify(body),
    { status, headers: type ? { "Content-Type": type } : {} },
  );
}

Deno.test("[MCP-C1] a JSON success is the tool's structured content and its text", async () => {
  const result = await toolResult(
    answer(201, { status: "created", task: { id: "t" } }, "application/json"),
  );
  assert(result.isError !== true, "a success is no error");
  assertEquals(result.structuredContent, {
    status: "created",
    task: { id: "t" },
  });
  assertEquals(result.content, [{
    type: "text",
    text: JSON.stringify({ status: "created", task: { id: "t" } }),
  }]);

  const listed = await toolResult(
    answer(200, [1, 2], "application/json; charset=utf-8"),
  );
  assertEquals(listed.structuredContent, { value: [1, 2] });
});

Deno.test("[MCP-C1] an empty success is a short confirmation", async () => {
  for (const response of [answer(204), answer(200, "", "application/json")]) {
    const result = await toolResult(response);
    assert(result.isError !== true, "an empty success is no error");
    assert(result.structuredContent === undefined, "nothing to structure");
    const [block] = result.content;
    assert(
      block?.type === "text" && block.text.includes(String(response.status)),
      "the confirmation names the status",
    );
  }
});

Deno.test("[MCP-C1] a problem is an error result the agent can correct itself from", async () => {
  const result = await toolResult(answer(400, {
    type: "https://kinship.test/problems/task_invalid",
    title: "Invalid task",
    status: 400,
    detail: "Check the task fields.",
    code: "task_invalid",
    errors: { title: "Too short" },
  }, "application/problem+json"));
  assert(result.isError === true, "a problem is an error");
  assertEquals(result.structuredContent, {
    code: "task_invalid",
    detail: "Check the task fields.",
    errors: { title: "Too short" },
    status: 400,
    title: "Invalid task",
  });
  const [block] = result.content;
  assert(block?.type === "text", "one text block");
  for (const part of ["task_invalid", "Invalid task", "title: Too short"]) {
    assert(block.text.includes(part), `the text names ${part}: ${block.text}`);
  }
});

Deno.test("[MCP-C1] anything else is an error naming the status", async () => {
  for (
    const response of [
      answer(502, "<html>bad gateway</html>", "text/html"),
      answer(200, "not json", "text/plain"),
      answer(200, "{oops", "application/json"),
      answer(400, "{oops", "application/problem+json"),
    ]
  ) {
    const status = response.status;
    const result = await toolResult(response);
    assert(result.isError === true, `${status} is an error`);
    const [block] = result.content;
    assert(
      block?.type === "text" && block.text.includes(String(status)),
      `the error names ${status}`,
    );
  }
});
