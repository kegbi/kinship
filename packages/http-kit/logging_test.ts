import { Hono } from "hono";
import {
  assert,
  assertEquals,
  assertRejects,
} from "../backend/testing/assert.ts";
import type { LogEvent } from "../backend/shared-kernel/telemetry.ts";
import {
  loggedRoute,
  REQUEST_EVENT,
  requestLogging,
  UNMATCHED_ROUTE,
} from "./logging.ts";
import { requestId, type RequestIdEnv } from "./request_id.ts";

function logged(lines: LogEvent[]): Hono<RequestIdEnv> {
  const app = new Hono<RequestIdEnv>();
  app.use(requestId({ generate: () => "minted-1" }));
  app.use(requestLogging({ log: (record) => lines.push(record) }));
  app.get(
    "/api/v1/people/:personId/gifts",
    (context) => context.json({ gifts: [] }),
  );
  app.post("/api/v1/boom", () => {
    throw new Error("handler failed");
  });
  return app;
}

Deno.test("[GAP-019] one line per request names the route, not the identifier in it", async () => {
  const lines: LogEvent[] = [];
  await logged(lines).request(
    "http://localhost/api/v1/people/00000000-0000-4000-8000-000000000100/gifts",
  );

  assertEquals(lines.length, 1, "exactly one line");
  const record = lines[0] as unknown as Record<string, string | number>;
  assertEquals(record.event, REQUEST_EVENT, "the event name");
  assertEquals(record.method, "GET", "the method");
  assertEquals(
    record.route,
    "/api/v1/people/:personId/gifts",
    "the registered pattern, never the person",
  );
  assertEquals(record.status, 200, "the status");
  assertEquals(record.request_id, "minted-1", "the request identifier");
  assert(typeof record.duration_ms === "number", "how long it took");
  assertEquals(
    Object.keys(record).sort().join(","),
    "duration_ms,event,method,request_id,route,status",
    "nothing else is logged: no header, no cookie, no body, no query",
  );
});

Deno.test("[GAP-019] a request nothing answered is logged as unmatched", async () => {
  const lines: LogEvent[] = [];
  await logged(lines).request("http://localhost/api/v1/nowhere");

  assertEquals(lines.length, 1, "a 404 is still one line");
  assertEquals(
    (lines[0] as unknown as Record<string, string>).route,
    UNMATCHED_ROUTE,
    "no route claims it",
  );
  assertEquals(
    (lines[0] as unknown as Record<string, number>).status,
    404,
    "and the status says so",
  );
});

Deno.test("[GAP-019] a handler that throws is logged before the error escapes", async () => {
  const lines: LogEvent[] = [];
  const app = logged(lines);
  app.onError((failure) => {
    throw failure;
  });

  await assertRejects(
    () => app.request("http://localhost/api/v1/boom", { method: "POST" }),
    "the failure still reaches the error handler",
  );
  assertEquals(lines.length, 1, "the failed request was logged");
  assertEquals(
    (lines[0] as unknown as Record<string, number>).status,
    500,
    "a thrown handler is reported as a server failure",
  );
});

Deno.test("[GAP-019] a route without the identifier middleware still logs", async () => {
  const lines: LogEvent[] = [];
  const app = new Hono();
  app.use(requestLogging({ log: (record) => lines.push(record) }));
  app.get("/livez", (context) => context.json({ status: "alive" }));

  await app.request("http://localhost/livez");

  assertEquals(lines.length, 1, "one line");
  assert(
    !("request_id" in (lines[0] as unknown as Record<string, unknown>)),
    "the identifier member is omitted rather than empty",
  );
});

Deno.test("[GAP-019] the route is readable from inside a handler too", async () => {
  const app = new Hono();
  app.get("/asked", (context) => context.json({ route: loggedRoute(context) }));

  const response = await app.request("http://localhost/asked");

  assertEquals(
    ((await response.json()) as { readonly route: string }).route,
    "/asked",
    "the route reports itself from inside the handler",
  );
});
