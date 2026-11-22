/**
 * What `defineTool` derives from a route and what it refuses (MCP-C1).
 *
 * A tool is a route seen from an agent: one flat argument object whose
 * members land in the path, the query string, or the JSON body. The rules
 * that decide where each member goes, and the mistakes a declaration can
 * make, are checked when the module loads, the way `defineRoute` checks a
 * descriptor, so a tool the endpoint could not call is never served.
 */

import { z } from "zod";
import { defineRoute } from "../registry.ts";
import { mcp } from "../routes/mcp.ts";
import { defineTool } from "./define.ts";
import { collectTools } from "./mod.ts";
import {
  assert,
  assertEquals,
  assertThrows,
} from "../../backend/testing/assert.ts";

const answered = { 200: { description: "ok" } } as const;
const tokenOnly = [{ kinship_api_token: [] }] as const;
const both = [{ kinship_session: [] }, { kinship_api_token: [] }] as const;

const listThings = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/things",
  operationId: "listThingsFixture",
  tokenScope: "people:read",
  security: both,
  request: {
    params: z.object({ personId: z.uuid() }),
    query: z.object({ cursor: z.string().optional() }),
  },
  responses: answered,
});

const changeThing = defineRoute({
  method: "patch",
  path: "/api/v1/things/{section}/{thingId}",
  operationId: "changeThingFixture",
  tokenScope: "people:write",
  security: both,
  request: {
    params: z.object({ section: z.enum(["a", "b"]), thingId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": z.strictObject({
          section: z.enum(["a", "b"]),
          title: z.string().min(1),
        }),
      },
    },
  },
  responses: answered,
});

const noteInput = z.strictObject({
  body: z.string().min(1),
  kind: z.literal("note"),
  requestId: z.uuid(),
});
const callInput = z.strictObject({
  calledAt: z.iso.datetime({ offset: true }),
  kind: z.literal("call"),
  requestId: z.uuid(),
});
const recordThing = defineRoute({
  method: "post",
  path: "/api/v1/records",
  operationId: "recordThingFixture",
  tokenScope: "interactions:create",
  security: both,
  request: {
    body: {
      required: true,
      content: { "application/json": z.union([noteInput, callInput]) },
    },
  },
  responses: { 201: { description: "created" } },
});

const base = {
  title: "A tool",
  description: "Does one thing an agent asked for.",
};

Deno.test("[MCP-C1] path and query parameters are flat top-level arguments", () => {
  const tool = defineTool({ ...base, name: "list_things", route: listThings });
  assertEquals(tool.locations, { personId: ["path"], cursor: ["query"] });
  assertEquals(Object.keys(tool.input.shape).sort(), ["cursor", "personId"]);
  assert(tool.scope === "people:read", "the scope is the route's");
  assert(
    tool.input.safeParse({ personId: crypto.randomUUID() }).success,
    "an optional query member may be left out",
  );
  assert(
    !tool.input.safeParse({ personId: crypto.randomUUID(), extra: 1 }).success,
    "an argument no part of the request takes is refused",
  );
  const json = z.toJSONSchema(tool.input) as { type: string };
  assert(json.type === "object", "the input schema root is a plain object");
});

Deno.test("[MCP-C1] a plain object body is flattened beside the parameters", () => {
  const tool = defineTool({
    ...base,
    name: "update_thing",
    route: changeThing,
    shared: ["section"],
  });
  assertEquals(tool.locations, {
    section: ["path", "body"],
    thingId: ["path"],
    title: ["body"],
  });
});

Deno.test("[MCP-C1] a name taken by two parts of the request must be declared the same value", () => {
  const error = assertThrows(
    () => defineTool({ ...base, name: "update_thing", route: changeThing }),
    "a path and body collision must be refused",
  );
  assert(
    String(error).includes("section"),
    `the refusal names the field: ${error}`,
  );
  assertThrows(
    () =>
      defineTool({
        ...base,
        name: "list_things",
        route: listThings,
        shared: ["cursor"],
      }),
    "declaring a field shared that nothing shares is refused",
  );
});

Deno.test("[MCP-C1] a union body is served one object at a time with its discriminator fixed", () => {
  const tool = defineTool({
    ...base,
    name: "record_note",
    route: recordThing,
    body: noteInput,
    fixed: { kind: "note" },
    minted: { requestId: "uuid" },
  });
  assertEquals(Object.keys(tool.input.shape).sort(), ["body", "requestId"]);
  assertEquals(tool.fixed, { kind: "note" });
  assertEquals(tool.minted, { requestId: "uuid" });
  assert(
    tool.input.safeParse({ body: "Lunch" }).success,
    "a minted field may be left out",
  );
  const json = z.toJSONSchema(tool.input) as unknown as {
    properties: { requestId: { description?: string } };
    required: string[];
  };
  assert(
    json.properties.requestId.description?.includes("reuse") === true,
    "the minted field tells the agent to reuse its own retry key",
  );
  assertEquals(json.required, ["body"]);
  assert(tool.annotations.idempotentHint === false, "a create is no retry");

  assertThrows(
    () => defineTool({ ...base, name: "record_thing", route: recordThing }),
    "a union body needs the object the tool sends",
  );
  assertThrows(
    () =>
      defineTool({
        ...base,
        name: "record_note",
        route: recordThing,
        body: z.strictObject({ body: z.string() }),
      }),
    "the declared body must be one of the route's",
  );
  assertThrows(
    () =>
      defineTool({
        ...base,
        name: "record_note",
        route: recordThing,
        body: noteInput,
        fixed: { kind: "call" },
      }),
    "a fixed value the body refuses is refused",
  );
  assertThrows(
    () =>
      defineTool({
        ...base,
        name: "record_note",
        route: recordThing,
        body: noteInput,
        fixed: { colour: "red" },
      }),
    "a fixed field the body does not take is refused",
  );
  assertThrows(
    () =>
      defineTool({
        ...base,
        name: "list_things",
        route: listThings,
        minted: { requestId: "uuid" },
      }),
    "a minted field the request does not take is refused",
  );
});

Deno.test("[MCP-C1] annotation hints follow the method and may be overridden", () => {
  const read = defineTool({ ...base, name: "list_things", route: listThings });
  assertEquals(read.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const edit = defineTool({
    ...base,
    name: "update_thing",
    route: changeThing,
    shared: ["section"],
    annotations: { idempotentHint: true },
  });
  assert(edit.annotations.readOnlyHint === false, "an edit writes");
  assert(edit.annotations.idempotentHint, "an override wins");
  for (
    const [method, hints] of [
      ["put", { destructiveHint: false, idempotentHint: true }],
      ["delete", { destructiveHint: true, idempotentHint: true }],
    ] as const
  ) {
    const route = defineRoute({
      method,
      path: `/api/v1/things/${method}`,
      operationId: `${method}ThingFixture`,
      tokenScope: "people:write",
      security: both,
      responses: answered,
    });
    const tool = defineTool({ ...base, name: `${method}_thing`, route });
    assert(
      tool.annotations.destructiveHint === hints.destructiveHint &&
        tool.annotations.idempotentHint === hints.idempotentHint,
      `${method} hints`,
    );
  }
});

Deno.test("[MCP-C1] a tool targets only a token-enabled JSON route other than the endpoint", () => {
  const sessionOnly = defineRoute({
    method: "get",
    path: "/api/v1/session-only",
    operationId: "sessionOnlyFixture",
    security: [{ kinship_session: [] }],
    responses: answered,
  });
  assertThrows(
    () => defineTool({ ...base, name: "read_session", route: sessionOnly }),
    "a session-only route is not a tool",
  );
  const upload = defineRoute({
    method: "post",
    path: "/api/v1/uploads",
    operationId: "uploadFixture",
    tokenScope: "files:write",
    security: both,
    request: {
      body: {
        required: true,
        content: { "application/octet-stream": z.string() },
      },
    },
    responses: answered,
  });
  assertThrows(
    () => defineTool({ ...base, name: "upload_file", route: upload }),
    "a binary body is not a tool",
  );
  assertThrows(
    () => defineTool({ ...base, name: "call_mcp", route: mcp }),
    "the endpoint cannot be its own tool",
  );
  const context = defineRoute({
    method: "get",
    path: "/api/v1/context-fixture",
    operationId: "contextFixture",
    security: tokenOnly,
    responses: answered,
  });
  assert(
    defineTool({ ...base, name: "get_context", route: context }).scope ===
      undefined,
    "a route that accepts any token needs no scope",
  );
  for (const name of ["listThings", "list", "list-things", "_list_things"]) {
    assertThrows(
      () => defineTool({ ...base, name, route: listThings }),
      `${name} is not a snake_case verb_noun name`,
    );
  }
  assertThrows(
    () =>
      defineTool({
        ...base,
        name: "list_things",
        route: listThings,
        title: "",
      }),
    "a tool needs a title",
  );
});

Deno.test("[MCP-C1] tool names are unique and every tool's route is registered", () => {
  const tool = defineTool({ ...base, name: "list_things", route: listThings });
  assertThrows(
    () => collectTools([[tool], [tool]], [listThings]),
    "two tools may not share a name",
  );
  assertThrows(
    () => collectTools([[tool]], []),
    "a tool over an unregistered route is refused",
  );
  assertEquals(collectTools([[tool]], [listThings]).length, 1);
});
