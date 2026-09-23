/**
 * The three things that answer "is this process up, and can it work?".
 *
 * `GET /api/v1/health` is a published contract: the gateway's
 * `/gateway-health` proxies it, Compose health checks poll it, the development
 * launcher waits on it, and `packages/contracts/health.ts` pins its body. It
 * is reproduced here exactly as `createApiApp` wrote it, down to the 503 body
 * a failed readiness probe answers with.
 *
 * `/livez` and `/readyz` are the orchestrator-facing pair and sit outside
 * `/api/v1/`, which is the only prefix the gateway proxies and the only prefix
 * the legal-acceptance guard watches. Liveness says the process is answering;
 * readiness runs the same probe the health contract does. Neither is public,
 * and neither is cached.
 */

import { Hono } from "hono";
import { HEALTH_RESPONSE } from "../contracts/health.ts";
import {
  readHealth,
  readLiveness,
  readReadiness,
} from "../contracts/routes/health.ts";
import { mount } from "./route.ts";

/** What a deployment lends the probes. */
export interface HealthServices {
  /** Whether the dependencies this process needs are reachable. */
  readonly readiness?: () => Promise<boolean>;
}

/** The liveness body: this process is running and routing. */
export const LIVENESS_RESPONSE = Object.freeze({ status: "alive" });

/** The readiness bodies, in the two states a probe can report. */
export const READINESS_RESPONSE = Object.freeze({ status: "ready" });
export const UNAVAILABLE_RESPONSE = Object.freeze({ status: "unavailable" });

/** The health contract's own answer when the readiness probe fails. */
export const HEALTH_UNAVAILABLE_RESPONSE = Object.freeze({
  status: "healthy",
  readiness: "unavailable",
});

/** The published health contract plus the orchestrator's two probes. */
export function healthRoutes(services: HealthServices = {}): Hono {
  const routes = new Hono();

  mount(routes, readHealth, async (context) => {
    context.header("Cache-Control", "no-store");
    if (services.readiness && !(await services.readiness())) {
      return context.json(HEALTH_UNAVAILABLE_RESPONSE, 503);
    }
    return context.json(HEALTH_RESPONSE);
  });

  // Liveness is the one probe with nothing to wait for, and `mount` takes
  // Hono's middleware handler, which answers with a promise; hence the
  // already-resolved one rather than an `async` that never awaits.
  mount(routes, readLiveness, (context) => {
    context.header("Cache-Control", "no-store");
    return Promise.resolve(context.json(LIVENESS_RESPONSE));
  });

  mount(routes, readReadiness, async (context) => {
    context.header("Cache-Control", "no-store");
    if (services.readiness && !(await services.readiness())) {
      return context.json(UNAVAILABLE_RESPONSE, 503);
    }
    return context.json(READINESS_RESPONSE);
  });

  return routes;
}
