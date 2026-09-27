/**
 * The life-event section of a person's page.
 *
 * One of the three reads that must degrade on its own, so its failures are
 * asserted apart from the identity header they sit beside.
 */

import { createPeopleRoutes } from "./routes.ts";
import { assert, assertStatus } from "../../../../testing/assert.ts";
import * as fixtures from "../../../../testing/fixtures.ts";
import { actor, headers, services } from "./people.test-helper.ts";

Deno.test("[PEOPLE-003] HTTP reads person life events through the profile projection", async () => {
  const personId = fixtures.personId();
  let received: unknown;
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      listLifeEvents: (resolved, id) => {
        received = [resolved, id];
        return Promise.resolve({
          events: [{
            date: { month: 12, precision: "year_month", year: 1843 },
            id: "00000000-0000-4000-8000-000000000200",
            name: "Published Notes",
            updatedAt: "2026-09-27T10:00:00.000000Z",
          }],
          status: "ready",
          types: [],
        });
      },
    },
  ));

  const response = await app.request(
    `http://localhost/api/v1/people/${personId}/life-events`,
    { headers },
  );
  const body = await response.json() as {
    readonly events?: readonly { readonly name?: string }[];
  };

  assert(
    response.status === 200 && body.events?.[0]?.name === "Published Notes",
    "person-linked journal history remains readable on the canonical profile",
  );
  assert(
    (received as [typeof actor, string])[0].workspaceId === actor.workspaceId &&
      (received as [typeof actor, string])[1] === personId,
    "resolved tenant context reaches only the approved profile read model",
  );
  assert(
    response.headers.get("cache-control") === "private, no-store",
    "life-event history is never publicly cacheable",
  );
});

Deno.test("[PEOPLE-003] HTTP isolates life-event section failures", async () => {
  const personId = fixtures.personId();
  for (
    const scenario of [
      { expected: 403, status: "forbidden" as const },
      { expected: 404, status: "not-found" as const },
    ]
  ) {
    const app = createPeopleRoutes(services(
      { create: () => Promise.reject(new Error("must not create")) },
      undefined,
      undefined,
      {
        listLifeEvents: () => Promise.resolve({ status: scenario.status }),
      },
    ));
    const response = await app.request(
      `http://localhost/api/v1/people/${personId}/life-events`,
      { headers },
    );
    assert(
      response.status === scenario.expected &&
        response.headers.get("content-type") === "application/problem+json",
      `${scenario.status} life-event result maps without profile disclosure`,
    );
  }
  const unavailable = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      listLifeEvents: () =>
        Promise.reject(new Error("private database detail")),
    },
  ));
  const outage = await unavailable.request(
    `http://localhost/api/v1/people/${personId}/life-events`,
    { headers },
  );
  assert(
    outage.status === 503 &&
      !(await outage.text()).includes("private database detail"),
    "life-event dependency failure is local and conceals internals",
  );
  const invalid = await unavailable.request(
    "http://localhost/api/v1/people/not-a-person/life-events",
    { headers },
  );
  assertStatus(invalid, 400, "invalid life-event person ID is rejected");
});

Deno.test("[PEOPLE-003] HTTP returns the non-disclosing hidden life-event projection", async () => {
  const personId = fixtures.personId();
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      listLifeEvents: () =>
        Promise.resolve({ events: [], status: "hidden", types: [] }),
    },
  ));

  const response = await app.request(
    `http://localhost/api/v1/people/${personId}/life-events`,
    { headers },
  );
  const body = await response.json() as {
    readonly events?: readonly unknown[];
    readonly status?: string;
  };
  assert(
    response.status === 200 && body.status === "hidden" &&
      body.events?.length === 0,
    "hidden life-event history must disclose neither retained rows nor failure",
  );
});
