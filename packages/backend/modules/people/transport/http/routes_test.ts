/**
 * The people surface as one mounted whole.
 *
 * GAP-021 moved twenty-one routes out of one file into six, and Hono matches
 * in the order routes were added, so the order the concerns are mounted in is
 * contract rather than taste. Two things are pinned here: the whole
 * registration order, which would notice a route that went missing or moved,
 * and the one overlap that could actually change an answer — the literal
 * `tag-options` path sitting in front of `:personId`.
 */

import { createPeopleRoutes } from "./routes.ts";
import { assert, assertEquals } from "../../../../testing/assert.ts";
import * as fixtures from "../../../../testing/fixtures.ts";
import { headers, services } from "./people.test-helper.ts";

/** Every route the mounted surface registers, in registration order. */
function mounted(
  app: {
    readonly routes: readonly {
      readonly method: string;
      readonly path: string;
    }[];
  },
): string[] {
  const registered = new Set<string>();
  for (const route of app.routes) {
    if (route.method !== "ALL") registered.add(`${route.method} ${route.path}`);
  }
  return [...registered];
}

Deno.test("[GAP-021] the mounted people concerns register every route in order", () => {
  const app = createPeopleRoutes(
    services({ create: () => Promise.reject(new Error("unused")) }),
  );
  assertEquals(
    mounted(app).join("\n"),
    [
      "GET /api/v1/people",
      "GET /api/v1/people/tag-options",
      "POST /api/v1/people/:personId/view",
      "GET /api/v1/today/recent-people",
      "GET /api/v1/people/:personId/life-events",
      "GET /api/v1/people/:personId/timeline",
      "GET /api/v1/people/:personId",
      "GET /api/v1/people/:personId/facts/:section",
      "POST /api/v1/people/:personId/facts/:section",
      "PUT /api/v1/people/:personId/facts/:section/:factId",
      "DELETE /api/v1/people/:personId/facts/:section/:factId",
      "GET /api/v1/people/:personId/dates",
      "POST /api/v1/people/:personId/dates",
      "PATCH /api/v1/people/:personId/dates/:dateId",
      "DELETE /api/v1/people/:personId/dates/:dateId",
      "PATCH /api/v1/people/:personId",
      "POST /api/v1/people",
      "POST /api/v1/people/:personId/archive",
      "POST /api/v1/people/:personId/restore",
      "GET /api/v1/people/:personId/deletion-impact",
      "DELETE /api/v1/people/:personId",
    ].join("\n"),
    "six mounted concerns register what one file used to",
  );
});

Deno.test("[GAP-021] the people literal paths still answer ahead of :personId", async () => {
  const reached: string[] = [];
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    {
      list: () => {
        reached.push("directory");
        return Promise.resolve({ people: [], status: "ready" });
      },
    },
    {
      list: () => {
        reached.push("tag-options");
        return Promise.resolve({ options: [], status: "ready" });
      },
    },
    {
      get: () => {
        reached.push("person");
        return Promise.resolve({ status: "not-found" });
      },
    },
  ));
  const responses: number[] = [];
  for (
    const path of [
      "/api/v1/people",
      "/api/v1/people/tag-options",
      `/api/v1/people/${fixtures.personId()}`,
    ]
  ) {
    responses.push(
      (await app.request(`http://localhost${path}`, { headers })).status,
    );
  }
  assertEquals(
    reached.join(" "),
    "directory tag-options person",
    "tag-options reaches its own read rather than the person read",
  );
  assert(
    responses[0] === 200 && responses[1] === 200 && responses[2] === 404,
    "each overlapping path answers from the handler that owns it",
  );
});
