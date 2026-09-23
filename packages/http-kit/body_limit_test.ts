import { Hono } from "hono";
import {
  assert,
  assertEquals,
  assertStatus,
} from "../backend/testing/assert.ts";
import {
  JSON_BODY_MAX_BYTES,
  REQUEST_TOO_LARGE,
  requestBodyLimit,
} from "./body_limit.ts";

function capped(maxBytes: number, exempt?: (path: string) => boolean): Hono {
  const app = new Hono();
  app.use(requestBodyLimit({
    maxBytes,
    ...(exempt ? { exempt: (context) => exempt(context.req.path) } : {}),
  }));
  app.post("/api/v1/tasks", async (context) => {
    const body = await context.req.text();
    return context.json({ bytes: body.length });
  });
  app.post("/api/v1/imports/dry-runs", async (context) => {
    const body = await context.req.text();
    return context.json({ bytes: body.length });
  });
  app.get("/api/v1/tasks", (context) => context.json({ read: true }));
  return app;
}

Deno.test("[GAP-019] a body past the cap is refused before a handler reads it", async () => {
  const response = await capped(16).request("http://localhost/api/v1/tasks", {
    body: "x".repeat(64),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const body = await response.json() as {
    readonly code: string;
    readonly title: string;
  };

  assertStatus(response, 413);
  assertEquals(body.code, REQUEST_TOO_LARGE.code, "the refusal names itself");
  assertEquals(body.title, REQUEST_TOO_LARGE.title, "with its title");
  assertEquals(
    response.headers.get("Content-Type"),
    "application/problem+json",
    "and it is a problem like every other refusal",
  );
});

Deno.test("[GAP-019] a body inside the cap, and a request with no body at all, pass", async () => {
  const app = capped(64);
  const within = await app.request("http://localhost/api/v1/tasks", {
    body: "x".repeat(16),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const read = await app.request("http://localhost/api/v1/tasks");

  assertStatus(within, 200, "a small body reaches the route");
  assertEquals(
    ((await within.json()) as { readonly bytes: number }).bytes,
    16,
    "and arrives whole",
  );
  assertStatus(read, 200, "a request with no body is untouched");
});

Deno.test("[GAP-019] a route that bounds its own body is left alone", async () => {
  const app = capped(16, (path) => path === "/api/v1/imports/dry-runs");
  const exempt = await app.request(
    "http://localhost/api/v1/imports/dry-runs",
    {
      body: "x".repeat(64),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
  const capped64 = await app.request("http://localhost/api/v1/tasks", {
    body: "x".repeat(64),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  assertStatus(exempt, 200, "the exempt route keeps its own, larger ceiling");
  assertEquals(
    ((await exempt.json()) as { readonly bytes: number }).bytes,
    64,
    "and still receives the whole body",
  );
  assertStatus(capped64, 413, "its neighbour is still capped");
});

Deno.test("[GAP-019] the declared cap sits above every ordinary JSON payload", () => {
  assert(
    JSON_BODY_MAX_BYTES === 1_048_576,
    "one mebibyte is the documented cap",
  );
  assertEquals(REQUEST_TOO_LARGE.status, 413, "and it answers 413");
});
