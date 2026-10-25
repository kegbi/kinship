/**
 * The other half of the contract check: what the app actually mounted.
 *
 * `deno task contracts:check` proves the registry and the published document
 * describe the same surface. It cannot prove the app mounted that surface
 * without building the app, and building the app is this module's job — it
 * assembles every route factory over a stand-in for the services, reads what
 * Hono ended up holding, and compares it with `API_ROUTES`. No adapter is
 * reached and no database is opened: a factory only stores what it is handed.
 *
 * A route mounted around `mount` — a literal path written straight onto Hono —
 * fails here, and so does a descriptor nothing mounts. That pair is what the
 * hand-written generator could never check, and it is why three routes had
 * been matching on one parameter name while the document published another.
 */

import { type ApiServices, createApiApp } from "./composition.ts";
import { mountedRoutes } from "../../packages/http-kit/route.ts";
import {
  API_ROUTES,
  DOCUMENTED_ROUTES,
} from "../../packages/contracts/routes/mod.ts";
import { routeKey } from "../../packages/contracts/registry.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  personId,
  sessionActor,
  uuid,
} from "../../packages/backend/testing/fixtures.ts";

/**
 * Something every optional service can be.
 *
 * `createApiApp` mounts a surface when the services it needs are present, so a
 * value that answers to any property mounts all of them. Nothing here is
 * called: a factory captures what it is given and only reaches into it on a
 * request, which this module never makes.
 */
function everything(): unknown {
  // deno-lint-ignore no-explicit-any
  const stub: any = new Proxy(function () {}, {
    get: (_target, property) => (property === "then" ? undefined : stub),
    apply: () => stub,
    construct: () => stub,
    has: () => true,
  });
  return stub;
}

Deno.test("interaction composition uses its configured token authority and fails closed without one", async () => {
  const actor = sessionActor();
  for (const enabled of [false, true]) {
    const base = everything() as ApiServices;
    const overrides = {
      apiTokens: enabled
        ? {
          authenticate: (token: string, scope: string) => {
            assert(
              token === "capture" && scope === "interactions:create",
              "composition forwards capture authority",
            );
            return Promise.resolve({ actor, status: "authenticated" });
          },
        }
        : undefined,
      browserSecurity: { origin: "http://localhost", secureCookie: false },
      interactions: {
        record: () =>
          Promise.resolve({
            status: "created",
            record: {
              id: uuid(800),
              kind: "note",
              body: "Reference",
              createdAt: "2026-10-25T10:00:00Z",
              isFavorited: false,
            },
          }),
      },
      legal: undefined,
    };
    const services = new Proxy(base, {
      get: (target, property) =>
        property in overrides
          ? Reflect.get(overrides, property)
          : Reflect.get(target, property),
    });
    const response = await createApiApp(services).request(
      "/api/v1/interactions",
      {
        method: "POST",
        headers: {
          authorization: "Bearer capture",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "note",
          personId: personId(),
          requestId: uuid(801),
          body: "Reference",
        }),
      },
    );
    assert(
      response.status === (enabled ? 201 : 401),
      "capture authority is optional and never borrowed",
    );
  }
});

Deno.test("[GAP-022] every mounted route is one the registry describes", () => {
  const app = createApiApp(everything() as Parameters<typeof createApiApp>[0]);
  const mounted = new Set(mountedRoutes(app));
  const registered = new Set(API_ROUTES.map(routeKey));

  const unregistered = [...mounted].filter((route) => !registered.has(route));
  assert(
    unregistered.length === 0,
    `these routes are mounted and in no registry: ${unregistered.join(", ")}`,
  );

  const unmounted = [...registered].filter((route) => !mounted.has(route));
  assert(
    unmounted.length === 0,
    `these routes are registered and never mounted: ${unmounted.join(", ")}`,
  );
});

Deno.test("[GAP-022] only the container probes stay out of the document", () => {
  const undocumented = API_ROUTES.filter(
    (route) => route.undocumented !== undefined,
  );
  assert(
    undocumented.length === API_ROUTES.length - DOCUMENTED_ROUTES.length,
    "the documented split must be the excused routes",
  );
  assert(
    JSON.stringify(undocumented.map((route) => routeKey(route))) ===
      JSON.stringify([
        "GET /api/v1/health",
        "GET /livez",
        "GET /readyz",
      ]),
    "only the three probes may leave the published document",
  );
});
