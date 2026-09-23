/**
 * The filtered, paged timeline of a person's page.
 *
 * Fetched by a script after the page has rendered, so every refusal it can
 * answer is pinned here, authentication included.
 */

import { createPeopleRoutes } from "./routes.ts";
import { assert } from "../../../../testing/assert.ts";
import * as fixtures from "../../../../testing/fixtures.ts";
import { actor, headers, services } from "./people.test-helper.ts";

Deno.test("[UXD-002C2A] HTTP returns a private filtered person timeline page", async () => {
  const personId = fixtures.personId();
  let received: unknown;
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      listTimeline: (resolved, id, input) => {
        received = [resolved, id, input];
        return Promise.resolve({
          items: [{
            contactWasCaller: true,
            datePrecision: "full",
            emotions: [{
              id: "00000000-0000-4000-8000-000000000301",
              name: "Grateful",
            }],
            excerpt: "Discussed the analytical engine.",
            id: "00000000-0000-4000-8000-000000000300",
            kind: "call",
            occurredAt: "2026-08-20T08:30:00.000000Z",
          }],
          nextCursor: "opaque-next",
          status: "ready",
        });
      },
    },
  ));

  const response = await app.request(
    `http://localhost/api/v1/people/${personId}/timeline?cursor=opaque&kind=call&limit=9`,
    { headers },
  );
  const body = await response.json() as {
    readonly items?: readonly {
      readonly contactWasCaller?: boolean;
      readonly emotions?: readonly {
        readonly id: string;
        readonly name: string;
      }[];
      readonly kind?: string;
    }[];
    readonly nextCursor?: string;
  };
  const input = (received as [typeof actor, string, {
    readonly cursor?: string;
    readonly kind?: string;
    readonly limit?: number;
  }])[2];
  assert(
    response.status === 200 && body.items?.[0]?.kind === "call" &&
      body.items[0].contactWasCaller === true &&
      body.items[0].emotions?.[0]?.name === "Grateful" &&
      body.nextCursor === "opaque-next" &&
      response.headers.get("cache-control") === "private, no-store",
    "timeline detail passes through unchanged without public caching",
  );
  assert(
    (received as [typeof actor, string])[0].workspaceId === actor.workspaceId &&
      (received as [typeof actor, string])[1] === personId &&
      input.cursor === "opaque" && input.kind === "call" && input.limit === 9,
    "resolved tenant, person, and validated query reach the profile operation",
  );
});

Deno.test("[UXD-002C2A] HTTP rejects invalid timeline queries before resolution", async () => {
  let calls = 0;
  const base = services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      listTimeline: () => {
        calls += 1;
        return Promise.resolve({ items: [], status: "ready" });
      },
    },
  );
  const app = createPeopleRoutes({
    ...base,
    protectedSessions: {
      resolve: () => {
        calls += 1;
        return Promise.resolve(actor);
      },
    },
  });
  for (
    const path of [
      "/api/v1/people/not-a-person/timeline",
      "/api/v1/people/00000000-0000-4000-8000-000000000100/timeline?kind=message",
      "/api/v1/people/00000000-0000-4000-8000-000000000100/timeline?limit=51",
      "/api/v1/people/00000000-0000-4000-8000-000000000100/timeline?extra=true",
    ]
  ) {
    const response = await app.request(`http://localhost${path}`, { headers });
    const body = await response.json() as { readonly code?: string };
    assert(
      response.status === 400 && body.code === "person_timeline_query_invalid",
      "invalid timeline input has one attributable problem",
    );
  }
  assert(
    calls === 0,
    "invalid timeline input performs no session or data work",
  );
});

Deno.test("[UXD-002C2A] HTTP maps every person timeline problem without disclosure", async () => {
  const personId = fixtures.personId();
  const unauthenticated = createPeopleRoutes({
    ...services({ create: () => Promise.reject(new Error("must not create")) }),
    protectedSessions: { resolve: () => Promise.resolve(undefined) },
  });
  const missingSession = await unauthenticated.request(
    `http://localhost/api/v1/people/${personId}/timeline`,
    { headers },
  );
  assert(
    missingSession.status === 401 &&
      (await missingSession.json() as { readonly code?: string }).code ===
        "person_timeline_authentication_required",
    "timeline authentication failure is attributable",
  );

  for (
    const scenario of [
      {
        code: "person_timeline_forbidden",
        expected: 403,
        status: "forbidden" as const,
      },
      {
        code: "person_timeline_not_found",
        expected: 404,
        status: "not-found" as const,
      },
      {
        code: "person_timeline_stale_cursor",
        expected: 409,
        status: "stale-cursor" as const,
      },
    ]
  ) {
    const app = createPeopleRoutes(services(
      { create: () => Promise.reject(new Error("must not create")) },
      undefined,
      undefined,
      {
        listTimeline: () => Promise.resolve({ status: scenario.status }),
      },
    ));
    const response = await app.request(
      `http://localhost/api/v1/people/${personId}/timeline`,
      { headers },
    );
    const body = await response.json() as { readonly code?: string };
    assert(
      response.status === scenario.expected && body.code === scenario.code &&
        response.headers.get("content-type") === "application/problem+json",
      `${scenario.status} timeline result maps to a stable problem`,
    );
  }

  const unavailable = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      listTimeline: () =>
        Promise.reject(new Error("private timeline database detail")),
    },
  ));
  const response = await unavailable.request(
    `http://localhost/api/v1/people/${personId}/timeline`,
    { headers },
  );
  const text = await response.text();
  assert(
    response.status === 503 &&
      JSON.parse(text).code === "person_timeline_unavailable" &&
      !text.includes("private timeline database detail"),
    "timeline dependency failures are attributable and conceal internals",
  );
});
