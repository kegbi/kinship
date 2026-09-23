import { Hono } from "hono";
import { z } from "zod";
import {
  assert,
  assertEquals,
  assertStatus,
} from "../backend/testing/assert.ts";
import {
  fieldErrors,
  invalidRequest,
  parseJsonBody,
  parseQuery,
  parseValue,
} from "./validate.ts";

const uuid = z.uuid();
const task = z.object({
  dueAt: z.iso.datetime({ offset: true }).optional(),
  title: z.string().trim().min(1).max(500),
}).strict();
const query = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
}).strict();

const TASK_INVALID = {
  code: "task_request_invalid",
  detail: "Use supported task fields.",
  status: 400,
  title: "Invalid task",
} as const;

Deno.test("[GAP-019] a path parameter parses into data or field messages", () => {
  const good = parseValue(uuid, "00000000-0000-4000-8000-000000000100");
  const bad = parseValue(uuid, "not-a-uuid");

  assert("data" in good, "a canonical identifier parses");
  assertEquals(
    good.data,
    "00000000-0000-4000-8000-000000000100",
    "the value is handed back whole",
  );
  assert("errors" in bad, "an unparsable identifier is a rejection");
  assert(
    typeof bad.errors["body"] === "string",
    "a value with no path is named for the body it came in",
  );
});

Deno.test("[GAP-019] field messages are one per field, first message wins", () => {
  const rejected = task.safeParse({ dueAt: "yesterday", title: "" });
  assert(!rejected.success, "the payload is rejected");

  const errors = fieldErrors(rejected.error);

  assertEquals(
    Object.keys(errors).sort().join(","),
    "dueAt,title",
    "one entry per rejected field",
  );
  assert(
    errors.title !== undefined && errors.title.length > 0,
    "the field carries a message",
  );
});

Deno.test("[GAP-019] a body that is not JSON at all is a rejection, not a crash", async () => {
  const app = new Hono();
  app.post("/tasks", async (context) => {
    const body = await parseJsonBody(context, task);
    return "errors" in body
      ? invalidRequest(context, TASK_INVALID, body.errors)
      : context.json(body.data);
  });

  const truncated = await app.request("http://localhost/tasks", {
    body: "{",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const rejected = await app.request("http://localhost/tasks", {
    body: JSON.stringify({ title: "" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const accepted = await app.request("http://localhost/tasks", {
    body: JSON.stringify({ title: "Call Ada" }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  assertStatus(truncated, 400, "a truncated body");
  assertStatus(rejected, 400, "an ill-typed body");
  assertStatus(accepted, 200, "a good body");
  assertEquals(
    ((await rejected.json()) as { readonly errors?: Record<string, string> })
      .errors !== undefined,
    true,
    "the refusal carries the field messages",
  );
  assertEquals(
    ((await accepted.json()) as { readonly title: string }).title,
    "Call Ada",
    "the parsed value reaches the route",
  );
});

Deno.test("[GAP-019] a query string parses as one flat record", async () => {
  const app = new Hono();
  app.get("/tasks", (context) => {
    const parsed = parseQuery(context, query);
    return "errors" in parsed
      ? invalidRequest(context, TASK_INVALID)
      : context.json(parsed.data);
  });

  const defaulted = await app.request("http://localhost/tasks");
  const coerced = await app.request("http://localhost/tasks?limit=20");
  const refused = await app.request("http://localhost/tasks?limit=nope");
  const refusedBody = await refused.json() as {
    readonly errors?: Record<string, string>;
  };

  assertEquals(
    ((await defaulted.json()) as { readonly limit: number }).limit,
    100,
    "an absent bound takes the default",
  );
  assertEquals(
    ((await coerced.json()) as { readonly limit: number }).limit,
    20,
    "a supplied bound is coerced from its string",
  );
  assertStatus(refused, 400, "an unparsable bound");
  assert(
    refusedBody.errors === undefined,
    "a route that tells no field-level story carries no errors member",
  );
});
