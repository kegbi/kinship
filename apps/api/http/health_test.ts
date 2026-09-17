import {
  assert,
  assertEquals,
  assertStatus,
} from "../../../packages/backend/testing/assert.ts";
import { isHealthResponse } from "../../../packages/contracts/health.ts";
import { healthRoutes } from "./health.ts";

Deno.test("[GAP-019] the published health contract is byte for byte what it was", async () => {
  const response = await healthRoutes().request(
    "http://localhost/api/v1/health",
  );
  const body: unknown = await response.json();

  assertStatus(response, 200);
  assertEquals(
    response.headers.get("Cache-Control"),
    "no-store",
    "readiness is never cached",
  );
  assert(isHealthResponse(body), "the shared contract accepts the body");
  assertEquals(
    JSON.stringify(body),
    JSON.stringify({ status: "healthy", readiness: "ready" }),
    "and nothing else is in it",
  );
});

Deno.test("[GAP-019] a failed readiness probe answers 503 on both surfaces", async () => {
  const routes = healthRoutes({ readiness: () => Promise.resolve(false) });
  const health = await routes.request("http://localhost/api/v1/health");
  const ready = await routes.request("http://localhost/readyz");
  const alive = await routes.request("http://localhost/livez");

  assertStatus(health, 503, "the published contract");
  assertEquals(
    JSON.stringify(await health.json()),
    JSON.stringify({ status: "healthy", readiness: "unavailable" }),
    "the unavailable body the gateway already knows",
  );
  assertStatus(ready, 503, "the orchestrator's readiness probe");
  assertEquals(
    JSON.stringify(await ready.json()),
    JSON.stringify({ status: "unavailable" }),
    "which says only that",
  );
  assertStatus(alive, 200, "liveness does not depend on a dependency");
});

Deno.test("[GAP-019] a passing probe leaves every surface healthy", async () => {
  const routes = healthRoutes({ readiness: () => Promise.resolve(true) });
  const health = await routes.request("http://localhost/api/v1/health");
  const ready = await routes.request("http://localhost/readyz");
  const alive = await routes.request("http://localhost/livez");

  assertStatus(health, 200);
  assertStatus(ready, 200);
  assertStatus(alive, 200);
  assertEquals(
    JSON.stringify(await ready.json()),
    JSON.stringify({ status: "ready" }),
    "the readiness body",
  );
  assertEquals(
    JSON.stringify(await alive.json()),
    JSON.stringify({ status: "alive" }),
    "the liveness body",
  );
  assertEquals(
    alive.headers.get("Cache-Control"),
    "no-store",
    "no probe is cached",
  );
});

Deno.test("[GAP-019] the probes answer only GET", async () => {
  const routes = healthRoutes();

  for (const path of ["/api/v1/health", "/livez", "/readyz"]) {
    assertStatus(
      await routes.request(`http://localhost${path}`, { method: "POST" }),
      404,
      `POST ${path}`,
    );
  }
});
