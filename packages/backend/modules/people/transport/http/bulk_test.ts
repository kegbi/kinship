/**
 * Bulk directory actions over HTTP (GAP-051, PEOPLE-009).
 */

import { assertEquals } from "../../../../testing/assert.ts";
import * as fixtures from "../../../../testing/fixtures.ts";
import type { BulkPeopleInput, BulkPeopleResult } from "../../public.ts";
import { headers, todayRoutes } from "./people.test-helper.ts";

const [ada, grace] = [101, 102].map(fixtures.uuid);
const tagId = fixtures.uuid(900);

function routes(run?: (input: BulkPeopleInput) => Promise<BulkPeopleResult>) {
  const calls: BulkPeopleInput[] = [];
  const app = todayRoutes(
    run
      ? {
        bulk: {
          run: (_actor, input) => {
            calls.push(input);
            return run(input);
          },
        },
      }
      : {},
  );
  return { app, calls };
}

function post(
  app: ReturnType<typeof routes>["app"],
  body: unknown,
  requestHeaders: Record<string, string> = headers,
) {
  return app.request("http://localhost/api/v1/people/bulk", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: requestHeaders,
    method: "POST",
  });
}

async function code(response: Response): Promise<string> {
  return (await response.json() as { code: string }).code;
}

Deno.test("[PEOPLE-009] a bulk action answers every person's outcome", async () => {
  const { app, calls } = routes(() =>
    Promise.resolve({
      action: "archive",
      results: [
        { outcome: "done", personId: ada! },
        { code: "not_found", outcome: "failed", personId: grace! },
      ],
      status: "ready",
      summary: { done: 1, failed: 1, skipped: 0, unchanged: 0 },
    })
  );
  const response = await post(app, {
    action: "archive",
    personIds: [ada, grace],
  });
  assertEquals(response.status, 200, "partial success is a 200");
  assertEquals(
    response.headers.get("cache-control"),
    "private, no-store",
    "not cached",
  );
  assertEquals(await response.json(), {
    action: "archive",
    results: [
      { outcome: "done", personId: ada },
      { code: "not_found", outcome: "failed", personId: grace },
    ],
    summary: { done: 1, failed: 1, skipped: 0, unchanged: 0 },
  }, "the results");
  assertEquals(
    calls,
    [{ action: "archive", personIds: [ada!, grace!] }],
    "ran",
  );
});

Deno.test("[PEOPLE-009] a malformed bulk request is refused before it runs", async () => {
  const { app, calls } = routes(() => Promise.reject(new Error("unused")));
  const ids = (count: number) =>
    Array.from({ length: count }, (_, index) => fixtures.uuid(200 + index));
  for (
    const body of [
      "{",
      { action: "archive", personIds: [] },
      { action: "archive", personIds: ids(101) },
      { action: "archive", personIds: [ada, ada] },
      { action: "archive", personIds: ["not-a-person"] },
      { action: "tag", personIds: [ada] },
      { action: "archive", personIds: [ada], tagId },
      { action: "delete", personIds: [ada] },
      { action: "archive", extra: true, personIds: [ada] },
    ]
  ) {
    const response = await post(app, body);
    assertEquals(response.status, 400, `${JSON.stringify(body)} is refused`);
    assertEquals(await code(response), "validation_failed", "code");
  }
  const tagged = routes(() =>
    Promise.resolve({
      action: "tag",
      results: [],
      status: "ready",
      summary: { done: 0, failed: 0, skipped: 0, unchanged: 0 },
    })
  );
  const accepted = await post(tagged.app, {
    action: "tag",
    personIds: ids(100),
    tagId,
  });
  assertEquals(accepted.status, 200, "one hundred people are accepted");
  assertEquals(calls, [], "nothing ran");
});

Deno.test("[PEOPLE-009] whole-request refusals and outages are problems", async () => {
  for (
    const [result, status, expected] of [
      [{ status: "forbidden" }, 403, "people_forbidden"],
      [{ status: "tag-unavailable" }, 400, "profile_fact_reference_invalid"],
      [
        {
          errors: { personIds: "Select each person once." },
          status: "validation-error",
        },
        400,
        "validation_failed",
      ],
    ] as const
  ) {
    const { app } = routes(() => Promise.resolve(result as BulkPeopleResult));
    const response = await post(app, {
      action: "tag",
      personIds: [ada],
      tagId,
    });
    assertEquals(response.status, status, `${result.status} status`);
    assertEquals(await code(response), expected, `${result.status} code`);
  }
  const failing = routes(() => Promise.reject(new Error("database down")));
  const outage = await post(failing.app, {
    action: "restore",
    personIds: [ada],
  });
  assertEquals(outage.status, 503, "an outage");
  assertEquals(await code(outage), "people_unavailable", "outage code");
  const unconfigured = routes();
  const missing = await post(unconfigured.app, {
    action: "restore",
    personIds: [ada],
  });
  assertEquals(missing.status, 503, "no bulk service");
  const { origin: _origin, ...crossSite } = headers;
  const refused = await post(
    routes(() => Promise.reject(new Error("unused"))).app,
    { action: "restore", personIds: [ada] },
    { ...crossSite, origin: "https://elsewhere.example" },
  );
  assertEquals(refused.status, 403, "another origin is refused");
});
