import { HEALTH_RESPONSE, isHealthResponse } from "./health.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("the shared health contract accepts only the public stable shape", () => {
  assert(isHealthResponse(HEALTH_RESPONSE), "expected valid health");
  assert(
    !isHealthResponse({
      ...HEALTH_RESPONSE,
      version: "secret-internal-version",
    }),
    "unexpected fields must be rejected",
  );
  assert(
    !isHealthResponse({ status: "healthy", readiness: "starting" }),
    "unknown readiness values must be rejected",
  );
});
