import { Hono } from "hono";
import {
  assert,
  assertEquals,
  assertStatus,
} from "../../../packages/backend/testing/assert.ts";
import {
  ALLOWED_METHODS,
  PREFLIGHT_MAX_AGE_SECONDS,
  sameOriginCors,
} from "./cors.ts";

const policy = { origin: "https://app.test", secureCookie: true };

function shared(): Hono {
  const app = new Hono();
  app.use("/api/v1/*", sameOriginCors(policy));
  app.post("/api/v1/tasks", (context) => context.json({ created: true }));
  app.get("/livez", (context) => context.json({ status: "alive" }));
  return app;
}

Deno.test("[GAP-019] the configured origin may read the answer, with credentials", async () => {
  const response = await shared().request("http://localhost/api/v1/tasks", {
    headers: { Origin: policy.origin },
    method: "POST",
  });

  assertStatus(response, 200);
  assertEquals(
    response.headers.get("Access-Control-Allow-Origin"),
    policy.origin,
    "the one configured origin is echoed",
  );
  assertEquals(
    response.headers.get("Access-Control-Allow-Credentials"),
    "true",
    "so the session cookie travels",
  );
  assert(
    response.headers.get("Vary")?.includes("Origin"),
    "and a cache is told the answer depends on the origin",
  );
});

Deno.test("[GAP-019] every other origin is denied by saying nothing", async () => {
  const response = await shared().request("http://localhost/api/v1/tasks", {
    headers: { Origin: "https://attacker.test" },
    method: "POST",
  });

  assertEquals(
    response.headers.get("Access-Control-Allow-Origin"),
    null,
    "a foreign origin is never admitted",
  );
});

Deno.test("[GAP-019] a preflight from the configured origin is answered once", async () => {
  const response = await shared().request("http://localhost/api/v1/tasks", {
    headers: {
      "Access-Control-Request-Method": "POST",
      Origin: policy.origin,
    },
    method: "OPTIONS",
  });

  assertStatus(response, 204);
  assertEquals(
    response.headers.get("Access-Control-Allow-Methods"),
    [...ALLOWED_METHODS].join(","),
    "the methods this API answers",
  );
  assertEquals(
    response.headers.get("Access-Control-Max-Age"),
    String(PREFLIGHT_MAX_AGE_SECONDS),
    "and how long the browser may remember them",
  );
  assert(
    response.headers.get("Access-Control-Allow-Headers")?.includes(
      "X-Workspace-Id",
    ),
    "the workspace switch header is allowed",
  );
});

Deno.test("[GAP-019] the policy covers the API prefix only", async () => {
  const response = await shared().request("http://localhost/livez", {
    headers: { Origin: policy.origin },
  });

  assertStatus(response, 200);
  assertEquals(
    response.headers.get("Access-Control-Allow-Origin"),
    null,
    "the orchestrator probes are not a browser surface",
  );
});

Deno.test("[GAP-019] a cookie a route appended to its own response survives", async () => {
  const app = new Hono();
  app.use("/api/v1/*", sameOriginCors(policy));
  app.post("/api/v1/mfa-challenges", (context) => {
    context.header("Set-Cookie", "kinship_session=new; Path=/", {
      append: true,
    });
    const response = context.json({ authenticated: true });
    response.headers.append("Set-Cookie", "kinship_mfa=; Max-Age=0; Path=/");
    return response;
  });

  const response = await app.request(
    "http://localhost/api/v1/mfa-challenges",
    { headers: { Origin: policy.origin }, method: "POST" },
  );
  const cookies = response.headers.getSetCookie();

  assertStatus(response, 200);
  assert(
    cookies.some((cookie) => cookie.startsWith("kinship_session=new")),
    "the cookie the route set through the context is sent",
  );
  assert(
    cookies.some((cookie) => cookie.startsWith("kinship_mfa=;")),
    "and so is the one it appended to the response it had already built",
  );
});
