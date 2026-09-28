/**
 * Starring a person over HTTP (GAP-053, PEOPLE-010): `PUT` stars and
 * `DELETE` unstars, each through the people use case, and every refusal keeps
 * the status the rest of the person surface answers with.
 */

import type { PersonStarManagement } from "../../public.ts";
import { createPeopleRoutes } from "./routes.ts";
import { assertEquals, assertStatus } from "../../../../testing/assert.ts";
import { actor, headers, services } from "./people.test-helper.ts";

const personId = "00000000-0000-4000-8000-000000000100";
const path = `http://localhost/api/v1/people/${personId}/star`;

function app(set?: PersonStarManagement["set"]) {
  return createPeopleRoutes({
    ...services({ create: () => Promise.reject(new Error("unused")) }),
    ...(set ? { stars: { set } } : {}),
  });
}

Deno.test("[PEOPLE-010] PUT stars and DELETE unstars through the use case", async () => {
  const calls: unknown[][] = [];
  const set: PersonStarManagement["set"] = (...args) => {
    calls.push(args);
    return Promise.resolve({ isStarred: args[2], status: "ready" });
  };
  const starred = await app(set).request(path, { headers, method: "PUT" });
  assertStatus(starred, 200, "a star saves");
  assertEquals(await starred.json(), { isStarred: true, status: "ready" });
  assertEquals(starred.headers.get("cache-control"), "private, no-store");
  const unstarred = await app(set).request(path, {
    headers,
    method: "DELETE",
  });
  assertStatus(unstarred, 200, "a star is removed");
  assertEquals(await unstarred.json(), { isStarred: false, status: "ready" });
  assertEquals(calls.length, 2);
  assertEquals(calls[0]![1], personId);
  assertEquals(calls[0]![2], true);
  assertEquals(calls[1]![2], false);
  assertEquals(
    (calls[0]![0] as { readonly workspaceId: string }).workspaceId,
    actor.workspaceId,
    "the session's workspace is the one starred in",
  );
});

Deno.test("[PEOPLE-010] a star's refusals keep their statuses", async () => {
  const cases = [
    ["archived-write-rejected", 409, "archived_write_rejected"],
    ["forbidden", 403, "people_forbidden"],
    ["not-found", 404, "person_not_found"],
    ["unavailable", 503, "person_star_unavailable"],
  ] as const;
  for (const [status, code, problem] of cases) {
    const response = await app(() => Promise.resolve({ status })).request(
      path,
      { headers, method: "PUT" },
    );
    assertStatus(response, code, status);
    assertEquals((await response.json()).code, problem);
  }
  const thrown = await app(() => Promise.reject(new Error("private detail")))
    .request(path, { headers, method: "DELETE" });
  assertStatus(thrown, 503, "an outage is retryable");
  const missing = await app().request(path, { headers, method: "PUT" });
  assertStatus(missing, 503, "an unwired use case answers unavailable");
});

Deno.test("[PEOPLE-010] a star needs a person identifier and the origin", async () => {
  const never: PersonStarManagement["set"] = () =>
    Promise.reject(new Error("must not be called"));
  const invalid = await app(never).request(
    "http://localhost/api/v1/people/not-a-uuid/star",
    { headers, method: "PUT" },
  );
  assertStatus(invalid, 400, "an invalid identifier is refused");
  const foreign = await app(never).request(path, {
    headers: { ...headers, origin: "https://attacker.test" },
    method: "PUT",
  });
  assertStatus(foreign, 403, "a foreign origin is refused");
});
