/**
 * The three probes, and why they are the only routes outside the document.
 *
 * `GET /api/v1/health` is a published contract that
 * `packages/contracts/health.ts` pins, and `/livez` and `/readyz` are the
 * orchestrator's pair. None of them is part of the versioned API: no client
 * calls them, the gateway proxies the first for its own health check, and
 * Compose polls the other two. They are registered here anyway, because
 * `apps/api/routes_test.ts` compares the mounted surface against this
 * registry — a probe that vanished or gained a sibling has to be a deliberate
 * edit to this file, not something a check misses.
 */

import { z } from "zod";
import { defineRoute, type RouteDescriptor } from "../registry.ts";

const OPERATIONAL =
  "An operational probe, not part of the versioned API the clients call.";

const healthy = z.strictObject({
  status: z.literal("healthy"),
  readiness: z.enum(["ready", "unavailable"]),
});

const alive = z.strictObject({ status: z.literal("alive") });

const ready = z.strictObject({
  status: z.enum(["ready", "unavailable"]),
});

export const readHealth = defineRoute({
  method: "get",
  path: "/api/v1/health",
  operationId: "readHealth",
  undocumented: OPERATIONAL,
  responses: {
    200: {
      description: "The process is up and its dependencies are reachable",
      content: { "application/json": healthy },
    },
    503: {
      description: "The process is up and a dependency is not reachable",
      content: { "application/json": healthy },
    },
  },
});

export const readLiveness = defineRoute({
  method: "get",
  path: "/livez",
  operationId: "readLiveness",
  undocumented: OPERATIONAL,
  responses: {
    200: {
      description: "The process is answering",
      content: { "application/json": alive },
    },
  },
});

export const readReadiness = defineRoute({
  method: "get",
  path: "/readyz",
  operationId: "readReadiness",
  undocumented: OPERATIONAL,
  responses: {
    200: {
      description: "The dependencies this process needs are reachable",
      content: { "application/json": ready },
    },
    503: {
      description: "A dependency this process needs is not reachable",
      content: { "application/json": ready },
    },
  },
});

/** Every probe, in the order the app mounts them. */
export const HEALTH_ROUTES: readonly RouteDescriptor[] = [
  readHealth,
  readLiveness,
  readReadiness,
];
