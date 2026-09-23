/**
 * Archiving, restoring, and deleting a person.
 *
 * The versioned edit is asserted here too, because the suite walks one person
 * through edit, archive, restore, impact, and delete in that order.
 */

import { createPeopleRoutes } from "./routes.ts";
import { assert, assertStatus } from "../../../../testing/assert.ts";
import { headers, services } from "./people.test-helper.ts";

Deno.test("PEOPLE-004 HTTP exposes versioned edit, archive, restore, impact, and delete", async () => {
  const person = {
    familyName: "Lovelace",
    givenName: "Ada",
    id: "00000000-0000-4000-8000-000000000100",
    isPartial: false,
    lifecycle: "active" as const,
    updatedAt: "2026-08-15T08:00:00.000Z",
  };
  const app = createPeopleRoutes(services({
    archive: () =>
      Promise.resolve({
        person: { ...person, lifecycle: "archived" },
        status: "archived",
      }),
    create: () => Promise.reject(new Error("must not create")),
    delete: () => Promise.resolve({ personId: person.id, status: "deleted" }),
    edit: () => Promise.resolve({ person, status: "updated" }),
    previewDeletion: () =>
      Promise.resolve({
        impact: {
          confirmation: "DELETE Ada Lovelace",
          dependentRecordPolicy: "retained",
          person,
        },
        status: "ready",
      }),
    restore: () => Promise.resolve({ person, status: "restored" }),
  }));
  const mutationBody = JSON.stringify({
    expectedUpdatedAt: person.updatedAt,
    givenName: "Ada",
    isPartial: false,
  });
  const edit = await app.request(
    `http://localhost/api/v1/people/${person.id}`,
    { body: mutationBody, headers, method: "PATCH" },
  );
  assertStatus(edit, 200, "edit route is ready");
  for (const action of ["archive", "restore"] as const) {
    const response = await app.request(
      `http://localhost/api/v1/people/${person.id}/${action}`,
      {
        body: JSON.stringify({ expectedUpdatedAt: person.updatedAt }),
        headers,
        method: "POST",
      },
    );
    assertStatus(response, 200, `${action} route is ready`);
  }
  const impact = await app.request(
    `http://localhost/api/v1/people/${person.id}/deletion-impact`,
    { headers },
  );
  assert(
    impact.status === 200 &&
      (await impact.json() as { impact: { dependentRecordPolicy: string } })
          .impact.dependentRecordPolicy === "retained",
    "impact route states canonical retention",
  );
  const deleted = await app.request(
    `http://localhost/api/v1/people/${person.id}`,
    {
      body: JSON.stringify({
        confirmation: "DELETE Ada Lovelace",
        expectedUpdatedAt: person.updatedAt,
      }),
      headers,
      method: "DELETE",
    },
  );
  assertStatus(deleted, 200, "confirmed deletion route is ready");
});

Deno.test("PEOPLE-004 HTTP maps lifecycle conflicts without leaking dependencies", async () => {
  for (
    const scenario of [
      { expected: 409, result: { status: "stale" as const } },
      {
        expected: 409,
        result: { status: "archived-write-rejected" as const },
      },
      { expected: 404, result: { status: "not-found" as const } },
      { expected: 403, result: { status: "forbidden" as const } },
    ]
  ) {
    const app = createPeopleRoutes(services({
      create: () => Promise.reject(new Error("must not create")),
      edit: () => Promise.resolve(scenario.result),
    }));
    const response = await app.request(
      "http://localhost/api/v1/people/00000000-0000-4000-8000-000000000100",
      {
        body: JSON.stringify({
          expectedUpdatedAt: "2026-08-15T08:00:00.000Z",
          givenName: "Ada",
          isPartial: false,
        }),
        headers,
        method: "PATCH",
      },
    );
    assert(response.status === scenario.expected, "lifecycle result maps");
  }
});
