import { app } from "./app.ts";
import { resolvePort } from "./main.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("GET /api/v1/health returns the stable public readiness contract", async () => {
  const response = await app.request("http://localhost/api/v1/health");

  assert(response.status === 200, `expected 200, received ${response.status}`);
  assert(
    response.headers.get("content-type")?.startsWith("application/json"),
    "health must use the JSON content type",
  );
  assert(
    response.headers.get("cache-control") === "no-store",
    "health must not be cached",
  );
  const body: unknown = await response.json();
  assert(
    JSON.stringify(body) ===
      JSON.stringify({ status: "healthy", readiness: "ready" }),
    "health must expose only the stable health and readiness fields",
  );
});

Deno.test("the health route does not accept unsupported methods", async () => {
  const response = await app.request("http://localhost/api/v1/health", {
    method: "POST",
  });

  assert(response.status === 404, `expected 404, received ${response.status}`);
});

Deno.test("the API entry point resolves a safe local port", () => {
  assert(
    resolvePort(undefined) === 8000,
    "expected the documented default port",
  );
  assert(resolvePort("8080") === 8080, "expected a valid configured port");

  for (const invalid of ["0", "65536", "not-a-port", "8.5"]) {
    let rejected = false;
    try {
      resolvePort(invalid);
    } catch {
      rejected = true;
    }
    assert(rejected, `expected ${invalid} to be rejected`);
  }
});
