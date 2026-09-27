/**
 * The duplicate review and the merge over HTTP (GAP-049, PEOPLE-008).
 */

import { assertEquals } from "../../../../testing/assert.ts";
import * as fixtures from "../../../../testing/fixtures.ts";
import type {
  MergePeopleResult,
  PersonMerge,
  PreviewPeopleMergeResult,
} from "../../public.ts";
import type { PeopleDuplicates } from "../../../../read-models/people-directory/public.ts";
import { headers, todayRoutes } from "./people.test-helper.ts";

const primaryId = fixtures.uuid(101);
const duplicateId = fixtures.uuid(102);
const REVISION = "2026-09-27T10:00:00.000000Z";
const DIGEST = "ab".repeat(32);

function routes(
  merge?: (input: unknown) => Promise<MergePeopleResult>,
  duplicates?: PeopleDuplicates["list"],
  preview?: (primary: string, duplicate: string) => Promise<
    PreviewPeopleMergeResult
  >,
) {
  const calls: unknown[] = [];
  const app = todayRoutes({
    ...(duplicates ? { duplicates: { list: duplicates } } : {}),
    ...(merge || preview
      ? {
        merge: {
          merge: (_actor, primary, input) => {
            calls.push({ input, primary });
            return merge
              ? merge(input)
              : Promise.reject(new Error("must not merge"));
          },
          preview: (_actor, primary, duplicate) =>
            preview
              ? preview(primary, duplicate)
              : Promise.reject(new Error("must not preview")),
        } satisfies Pick<PersonMerge, "merge" | "preview">,
      }
      : {}),
  });
  return { app, calls };
}

const CONFIRMED = {
  confirmed: true,
  conflictsDigest: DIGEST,
  duplicateRevision: REVISION,
  primaryRevision: REVISION,
};

function post(
  app: ReturnType<typeof routes>["app"],
  body: unknown,
  primary = primaryId,
  requestHeaders: Record<string, string> = headers,
) {
  return app.request(`http://localhost/api/v1/people/${primary}/merge`, {
    body: JSON.stringify(body),
    headers: requestHeaders,
    method: "POST",
  });
}

async function problemCode(response: Response): Promise<string> {
  return (await response.json() as { code: string }).code;
}

Deno.test("[PEOPLE-008] a merge answers the primary and where it lives", async () => {
  const { app, calls } = routes(() =>
    Promise.resolve({
      duplicateId,
      moved: 3,
      person: {
        familyName: "Lovelace",
        foodPreferences: "Tea",
        givenName: "Ada",
        id: primaryId,
        isDeceased: false,
        isPartial: false,
        isStarred: true,
        lifecycle: "active",
        updatedAt: REVISION,
      },
      status: "merged",
    })
  );
  const response = await post(app, { duplicateId, ...CONFIRMED });
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("cache-control"), "private, no-store");
  assertEquals(await response.json(), {
    duplicateId,
    moved: 3,
    next: `/app/people/${primaryId}`,
    // The lifecycle presenter's own key order.
    person: {
      familyName: "Lovelace",
      givenName: "Ada",
      id: primaryId,
      isPartial: false,
      isDeceased: false,
      lifecycle: "active",
      updatedAt: REVISION,
    },
    status: "merged",
  });
  assertEquals(calls, [{
    input: {
      conflictsDigest: DIGEST,
      duplicateId,
      duplicateRevision: REVISION,
      primaryRevision: REVISION,
    },
    primary: primaryId,
  }]);
});

Deno.test("[PEOPLE-008] each refused merge is its own problem", async () => {
  const cases: readonly [MergePeopleResult, number, string][] = [
    [{ status: "self-merge" }, 400, "merge_self"],
    [{ status: "forbidden" }, 403, "people_forbidden"],
    [{ status: "not-found" }, 404, "person_not_found"],
    [{ status: "stale" }, 409, "person_stale"],
    [{ status: "archived-write-rejected" }, 409, "archived_write_rejected"],
    [{ status: "both-members" }, 409, "merge_both_members"],
    [{ status: "conflicts-changed" }, 409, "merge_conflicts_changed"],
  ];
  for (const [result, status, code] of cases) {
    const { app } = routes(() => Promise.resolve(result));
    const response = await post(app, { duplicateId, ...CONFIRMED });
    assertEquals(response.status, status, code);
    assertEquals(await problemCode(response), code);
  }
  const failing = routes(() => Promise.reject(new Error("rolled back")));
  const unavailable = await post(failing.app, { duplicateId, ...CONFIRMED });
  assertEquals(unavailable.status, 503);
  assertEquals(await problemCode(unavailable), "people_unavailable");
  const missing = routes();
  assertEquals(
    (await post(missing.app, { duplicateId, ...CONFIRMED })).status,
    503,
  );
});

Deno.test("[PEOPLE-008] a malformed merge request never reaches the use case", async () => {
  const { app, calls } = routes(() => Promise.resolve({ status: "stale" }));
  for (
    const [body, primary] of [
      [{ ...CONFIRMED, duplicateId: "not-a-uuid" }, primaryId],
      [{}, primaryId],
      [{ ...CONFIRMED, duplicateId, extra: true }, primaryId],
      [{ ...CONFIRMED, duplicateId }, "not-a-uuid"],
      // The member must have confirmed, against both revisions they saw.
      [
        { duplicateId, duplicateRevision: REVISION, primaryRevision: REVISION },
        primaryId,
      ],
      [{ ...CONFIRMED, confirmed: false, duplicateId }, primaryId],
      [{ confirmed: true, duplicateId, primaryRevision: REVISION }, primaryId],
      [
        { confirmed: true, duplicateId, duplicateRevision: REVISION },
        primaryId,
      ],
      // ...and against the conflicts the preview listed.
      [{ ...CONFIRMED, conflictsDigest: undefined, duplicateId }, primaryId],
      [{ ...CONFIRMED, conflictsDigest: "ABC", duplicateId }, primaryId],
      [
        { ...CONFIRMED, conflictsDigest: "AB".repeat(32), duplicateId },
        primaryId,
      ],
    ] as const
  ) {
    const response = await post(app, body, primary);
    assertEquals(response.status, 400);
    assertEquals(await problemCode(response), "validation_failed");
  }
  assertEquals(calls, []);
});

Deno.test("[PEOPLE-008] the duplicate review lists pairs with avatar descriptors", async () => {
  const person = (id: string) => ({
    avatar: { backgroundColor: "#b3d5fe" },
    givenName: "Ada",
    id,
    updatedAt: REVISION,
  });
  const { app } = routes(undefined, () =>
    Promise.resolve({
      pairs: [{
        people: [person(primaryId), person(duplicateId)] as const,
        reasons: ["name"] as const,
      }],
      status: "ready",
      truncated: false,
    }));
  const response = await app.request(
    "http://localhost/api/v1/people/duplicates",
    { headers },
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    pairs: [{
      // The descriptor replaces the record after the person's own fields.
      people: [primaryId, duplicateId].map((id) => ({
        givenName: "Ada",
        id,
        updatedAt: REVISION,
        avatar: { color: "#b3d5fe" },
      })),
      reasons: ["name"],
    }],
    status: "ready",
    truncated: false,
  });
});

Deno.test("[PEOPLE-008] the duplicate review refuses a lost membership and a missing service", async () => {
  const forbidden = routes(
    undefined,
    () => Promise.resolve({ status: "forbidden" }),
  );
  const refused = await forbidden.app.request(
    "http://localhost/api/v1/people/duplicates",
    { headers },
  );
  assertEquals(refused.status, 403);
  const failing = routes(undefined, () => Promise.reject(new Error("down")));
  assertEquals(
    (await failing.app.request("http://localhost/api/v1/people/duplicates", {
      headers,
    })).status,
    503,
  );
  const missing = routes();
  assertEquals(
    (await missing.app.request("http://localhost/api/v1/people/duplicates", {
      headers,
    })).status,
    503,
  );
});

Deno.test("[PEOPLE-008] a merge from another origin, or none, is refused before it is read", async () => {
  const { app, calls } = routes(() => Promise.resolve({ status: "stale" }));
  const { origin: _origin, ...withoutOrigin } = headers;
  for (
    const requestHeaders of [
      withoutOrigin,
      { ...headers, origin: "https://elsewhere.example" },
    ]
  ) {
    const response = await post(
      app,
      { duplicateId, ...CONFIRMED },
      primaryId,
      requestHeaders,
    );
    assertEquals(response.status, 403);
  }
  assertEquals(calls, []);
});

Deno.test("[PEOPLE-008] the merge preview names what is kept, discarded, and moved, with both revisions", async () => {
  const seen: string[][] = [];
  const person = (id: string, familyName: string) => ({
    familyName,
    givenName: "Ada",
    id,
    isDeceased: false,
    isPartial: false,
    isStarred: false,
    lifecycle: "active" as const,
    updatedAt: REVISION,
  });
  const { app } = routes(undefined, undefined, (primary, duplicate) => {
    seen.push([primary, duplicate]);
    return Promise.resolve({
      conflicts: [{
        discarded: "12 March",
        fact: "birthday",
        kept: "10 December",
        keptSnapshot: { month: 12 },
        snapshot: { month: 3 },
      }],
      conflictsDigest: DIGEST,
      duplicate: person(duplicateId, "King"),
      moves: 5,
      primary: person(primaryId, "Lovelace"),
      status: "ready",
    });
  });
  const response = await app.request(
    `http://localhost/api/v1/people/${primaryId}/merge-preview?duplicateId=${duplicateId}`,
    { headers },
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json() as Record<string, unknown>;
  assertEquals(body.conflicts, [{
    discarded: "12 March",
    fact: "birthday",
    kept: "10 December",
  }]);
  assertEquals(body.moves, 5);
  assertEquals(body.conflictsDigest, DIGEST);
  assertEquals(
    (body.duplicate as { updatedAt: string; familyName: string }).familyName,
    "King",
  );
  assertEquals(
    (body.primary as { updatedAt: string }).updatedAt,
    REVISION,
  );
  assertEquals(seen, [[primaryId, duplicateId]]);
});

Deno.test("[PEOPLE-008] each refused preview is its own problem", async () => {
  const cases: readonly [PreviewPeopleMergeResult, number, string][] = [
    [{ status: "self-merge" }, 400, "merge_self"],
    [{ status: "forbidden" }, 403, "people_forbidden"],
    [{ status: "not-found" }, 404, "person_not_found"],
    [{ status: "archived-write-rejected" }, 409, "archived_write_rejected"],
    [{ status: "both-members" }, 409, "merge_both_members"],
  ];
  const url = (query: string, primary = primaryId) =>
    `http://localhost/api/v1/people/${primary}/merge-preview${query}`;
  for (const [result, status, code] of cases) {
    const { app } = routes(undefined, undefined, () => Promise.resolve(result));
    const response = await app.request(url(`?duplicateId=${duplicateId}`), {
      headers,
    });
    assertEquals(response.status, status, code);
    assertEquals(await problemCode(response), code);
  }
  const { app } = routes(
    undefined,
    undefined,
    () => Promise.reject(new Error("down")),
  );
  for (
    const query of ["", "?duplicateId=nope", `?duplicateId=${duplicateId}&x=1`]
  ) {
    assertEquals((await app.request(url(query), { headers })).status, 400);
  }
  assertEquals(
    (await app.request(url(`?duplicateId=${duplicateId}`, "nope"), {
      headers,
    })).status,
    400,
  );
  assertEquals(
    (await app.request(url(`?duplicateId=${duplicateId}`), { headers }))
      .status,
    503,
  );
  const missing = routes();
  assertEquals(
    (await missing.app.request(url(`?duplicateId=${duplicateId}`), {
      headers,
    })).status,
    503,
  );
});
