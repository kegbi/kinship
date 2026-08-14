import { Hono } from "hono";
import { HEALTH_RESPONSE } from "../../packages/contracts/health.ts";

export function createApiApp(): Hono {
  const api = new Hono();

  api.get("/api/v1/health", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json(HEALTH_RESPONSE);
  });

  return api;
}
