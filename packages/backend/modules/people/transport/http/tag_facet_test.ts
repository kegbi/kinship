/**
 * The directory's tag facet and new orders over HTTP (GAP-053, PEOPLE-010).
 */

import type { PeopleTagFacet } from "../../../../read-models/people-directory/public.ts";
import type { PeopleHttpServices } from "./routes.ts";
import { createPeopleRoutes } from "./routes.ts";
import { assertEquals, assertStatus } from "../../../../testing/assert.ts";
import { actor, headers, services } from "./people.test-helper.ts";

const tagId = "00000000-0000-4000-8000-000000000300";

function app(
  tagFacet?: PeopleTagFacet["list"],
  directory?: PeopleHttpServices["directory"]["list"],
) {
  const base = services(
    { create: () => Promise.reject(new Error("unused")) },
    directory ? { list: directory } : undefined,
  );
  return createPeopleRoutes({
    ...base,
    ...(tagFacet ? { tagFacet: { list: tagFacet } } : {}),
  });
}

Deno.test("[PEOPLE-010] the tag facet answers counts for the view asked for", async () => {
  const calls: unknown[][] = [];
  const response = await app((...args) => {
    calls.push(args);
    return Promise.resolve({
      lifecycle: args[1].lifecycle,
      status: "ready",
      tags: [{ count: 3, id: tagId, name: "Friends" }],
      truncated: true,
    });
  }).request(
    "http://localhost/api/v1/people/tag-facet?lifecycle=archived",
    { headers },
  );
  assertStatus(response, 200, "the facet reads");
  assertEquals(await response.json(), {
    lifecycle: "archived",
    status: "ready",
    tags: [{ count: 3, id: tagId, name: "Friends" }],
    truncated: true,
  });
  assertEquals(response.headers.get("cache-control"), "private, no-store");
  assertEquals(calls[0]![1], { lifecycle: "archived" });
  assertEquals(
    (calls[0]![0] as { readonly workspaceId: string }).workspaceId,
    actor.workspaceId,
  );
  const active = await app((_actor, input) =>
    Promise.resolve({
      lifecycle: input.lifecycle,
      status: "ready",
      tags: [],
      truncated: false,
    })
  ).request("http://localhost/api/v1/people/tag-facet", { headers });
  assertEquals((await active.json()).lifecycle, "active", "active by default");
});

Deno.test("[PEOPLE-010] the tag facet's refusals", async () => {
  const invalid = await app(() => Promise.reject(new Error("unused")))
    .request("http://localhost/api/v1/people/tag-facet?lifecycle=deleted", {
      headers,
    });
  assertStatus(invalid, 400, "an unknown view is refused");
  assertEquals((await invalid.json()).code, "tag_facet_query_invalid");
  const forbidden = await app(() => Promise.resolve({ status: "forbidden" }))
    .request("http://localhost/api/v1/people/tag-facet", { headers });
  assertStatus(forbidden, 403, "a revoked member reads nothing");
  const down = await app(() => Promise.reject(new Error("private detail")))
    .request("http://localhost/api/v1/people/tag-facet", { headers });
  assertStatus(down, 503, "an outage is retryable");
  assertEquals((await down.json()).code, "tag_facet_unavailable");
  const unwired = await app().request(
    "http://localhost/api/v1/people/tag-facet",
    { headers },
  );
  assertStatus(unwired, 503, "an unwired facet answers unavailable");
});

Deno.test("[PEOPLE-010] the directory takes the new orders and starred criteria", async () => {
  const inputs: unknown[] = [];
  const routes = app(undefined, (_actor, input) => {
    inputs.push(input);
    return Promise.resolve({ people: [], status: "ready" });
  });
  for (const sort of ["last-contacted", "recently-updated"]) {
    const response = await routes.request(
      `http://localhost/api/v1/people?sort=${sort}&starred=true&starredFirst=true`,
      { headers },
    );
    assertStatus(response, 200, `${sort} is an order`);
  }
  const plain = await routes.request("http://localhost/api/v1/people", {
    headers,
  });
  assertStatus(plain, 200, "the criteria are optional");
  assertEquals(
    inputs.map((input) => {
      const { sort, starred, starredFirst } = input as Record<string, unknown>;
      return { sort, starred, starredFirst };
    }),
    [
      { sort: "last-contacted", starred: true, starredFirst: true },
      { sort: "recently-updated", starred: true, starredFirst: true },
      { sort: "given-name", starred: false, starredFirst: false },
    ],
  );
  const refused = await routes.request(
    "http://localhost/api/v1/people?starred=yes",
    { headers },
  );
  assertStatus(refused, 400, "a starred value is true or false");
});
