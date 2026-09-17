/**
 * The tag filter beside the directory.
 *
 * Its own suite rather than part of the directory's, because its bounded
 * page, its cursor, and its refusals are its own.
 */

import { createPeopleRoutes } from "../people.ts";
import {
  assert,
  assertStatus,
} from "../../../packages/backend/testing/assert.ts";
import { headers, services } from "./people.test-helper.ts";

Deno.test("PEOPLE-002 bounds tag options outside every people page", async () => {
  const unboundedTags = Array.from({ length: 25 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    name: `Tag ${String(index + 1).padStart(2, "0")}`,
  }));
  const selectedTag = unboundedTags[24]!;
  let tagOptionInput: unknown;
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    {
      list: () =>
        Promise.resolve({
          availableTags: unboundedTags,
          nextCursor: "people-cursor",
          people: [],
          status: "ready",
        }),
    },
    {
      list: (_resolved, input) => {
        tagOptionInput = input;
        return Promise.resolve({
          nextCursor: "tag-cursor",
          options: unboundedTags.slice(0, 20),
          selected: selectedTag,
          status: "ready",
        });
      },
    },
  ));

  for (const query of ["", "?cursor=people-cursor"]) {
    const response = await app.request(
      `http://localhost/api/v1/people${query}`,
      { headers },
    );
    const body = await response.json() as Record<string, unknown>;
    assert(
      response.status === 200 && !("availableTags" in body),
      "people pages never repeat the workspace tag vocabulary",
    );
  }

  const options = await app.request(
    `http://localhost/api/v1/people/tag-options?search=tag&selected=${selectedTag.id}`,
    { headers },
  );
  const body = await options.json() as { readonly options?: unknown[] };
  assert(
    options.status === 200 && (body.options?.length ?? 21) <= 20 &&
      (tagOptionInput as { readonly search?: string }).search === "tag",
    "tag options have their own fixed-size searchable page",
  );
});

Deno.test("PEOPLE-002 maps tag-option validation, denial, cursor, and outage safely", async () => {
  let calls = 0;
  const invalidApp = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    {
      list: () => {
        calls += 1;
        return Promise.resolve({ options: [], status: "ready" });
      },
    },
  ));
  const invalid = await invalidApp.request(
    "http://localhost/api/v1/people/tag-options?selected=not-a-uuid",
    { headers },
  );
  assert(invalid.status === 400 && calls === 0, "invalid tag query is early");

  for (
    const scenario of [
      { expected: 403, result: { status: "forbidden" as const } },
      { expected: 400, result: { status: "invalid-input" as const } },
    ]
  ) {
    const app = createPeopleRoutes(services(
      { create: () => Promise.reject(new Error("must not create")) },
      undefined,
      { list: () => Promise.resolve(scenario.result) },
    ));
    const response = await app.request(
      "http://localhost/api/v1/people/tag-options",
      { headers },
    );
    assert(
      response.status === scenario.expected &&
        response.headers.get("content-type") === "application/problem+json",
      "tag option state maps to safe problem details",
    );
  }

  const unavailable = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    { list: () => Promise.reject(new Error("private tag query detail")) },
  ));
  const outage = await unavailable.request(
    "http://localhost/api/v1/people/tag-options",
    { headers },
  );
  assertStatus(outage, 503, "tag option outage is retryable");
  assert(
    !(await outage.text()).includes("private tag query detail"),
    "tag option dependency detail stays private",
  );
});
