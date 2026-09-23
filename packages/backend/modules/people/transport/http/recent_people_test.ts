/**
 * Recording that a person was opened, and reading the recent list back.
 *
 * Two routes of the directory concern that belong to each other: nothing
 * reaches the list that the view route did not record.
 */

import { assert } from "../../../../testing/assert.ts";
import * as fixtures from "../../../../testing/fixtures.ts";
import { actor, headers, todayRoutes } from "./people.test-helper.ts";

Deno.test("TODAY-001 HTTP records a resolved profile view only through explicit origin POST", async () => {
  const personId = fixtures.personId();
  const effects: string[] = [];
  const app = todayRoutes({
    profile: {
      get(resolved, id) {
        effects.push(`profile:${resolved.workspaceId}:${id}`);
        return Promise.resolve({ status: "ready" } as never);
      },
      listLifeEvents: () => Promise.reject(new Error("must not list history")),
      listTimeline: () => Promise.reject(new Error("must not list timeline")),
    },
    recentPeople: {
      record(resolved, id) {
        effects.push(`workspace:${resolved.workspaceId}:${id}`);
        return Promise.resolve({ status: "recorded" });
      },
    },
  });
  const missingOrigin = await app.request(
    `http://localhost/api/v1/people/${personId}/view`,
    { headers: { Cookie: "kinship_session=token" }, method: "POST" },
  );
  assert(
    missingOrigin.status === 403 && effects.length === 0,
    "origin denial reached use case",
  );

  const malformedBody = await app.request(
    `http://localhost/api/v1/people/${personId}/view`,
    { body: "{}", headers, method: "POST" },
  );
  assert(
    malformedBody.status === 400 && effects.length === 0,
    "no-body contract was not strict",
  );

  const response = await app.request(
    `http://localhost/api/v1/people/${personId}/view`,
    { headers, method: "POST" },
  );
  assert(
    response.status === 200 &&
      (await response.json() as { readonly status: string }).status ===
        "recorded",
    "profile view was not accepted without a body",
  );
  assert(
    effects.join(",") ===
      `profile:${actor.workspaceId}:${personId},workspace:${actor.workspaceId}:${personId}`,
    "profile tenant resolution did not precede the owning workspaces write",
  );
  assert(
    response.headers.get("cache-control") === "private, no-store",
    "write response was cacheable",
  );
});

Deno.test("TODAY-001 HTTP returns bounded recent people and safe failure states", async () => {
  const recent = [{
    archived: true,
    id: "00000000-0000-4000-8000-000000000100",
    name: "Ada Lovelace",
  }];
  const ready = todayRoutes({
    todayRecentPeople: {
      get: () => Promise.resolve({ people: recent, status: "ready" }),
    },
  });
  const response = await ready.request(
    "http://localhost/api/v1/today/recent-people",
    { headers },
  );
  const body = await response.json() as { readonly people: readonly unknown[] };
  assert(
    response.status === 200 && body.people.length === 1,
    "recent people response missing",
  );
  assert(
    response.headers.get("cache-control") === "private, no-store",
    "recent people was cacheable",
  );

  for (
    const scenario of [
      {
        expected: 403,
        get: () => Promise.resolve({ status: "forbidden" as const }),
      },
      { expected: 503, get: () => Promise.reject(new Error("private detail")) },
    ]
  ) {
    const app = todayRoutes({ todayRecentPeople: { get: scenario.get } });
    const failed = await app.request(
      "http://localhost/api/v1/today/recent-people",
      { headers },
    );
    assert(
      failed.status === scenario.expected,
      "recent people failure mapped unsafely",
    );
    assert(
      !(await failed.text()).includes("private detail"),
      "dependency detail leaked",
    );
  }
});
