/**
 * Workspace search over HTTP (GAP-048, `SEARCH-001`): the query the route
 * accepts, the groups it answers in order, and the refusals it names.
 */

import {
  createWorkspaceSearch,
  type SearchRecords,
  type SearchRepository,
} from "../../../../read-models/search/public.ts";

/** A repository answering both statements from one set of records. */
function answering(
  found: SearchRecords,
  seen: Parameters<SearchRepository["searchPeople"]>[0][] = [],
): SearchRepository {
  const { people, ...text } = found;
  return {
    searchPeople: (command) => {
      seen.push(command);
      return Promise.resolve({ people, status: "ready" });
    },
    searchText: () => Promise.resolve({ ...text, status: "ready" }),
  };
}

const failing = (error: Error): SearchRepository => ({
  searchPeople: () => Promise.reject(error),
  searchText: () => Promise.reject(error),
});
import { searchResults } from "../../../../../contracts/schemas/search.ts";
import { createPeopleRoutes } from "./routes.ts";
import {
  assert,
  assertEquals,
  assertStatus,
} from "../../../../testing/assert.ts";
import { actor, headers, services } from "./people.test-helper.ts";

const personId = "00000000-0000-4000-8000-000000000100";
const fileId = "00000000-0000-4000-8000-000000000200";
const noteId = "00000000-0000-4000-8000-000000000300";

const EMPTY: SearchRecords = {
  activities: [],
  journalPosts: [],
  notes: [],
  people: [],
  tasks: [],
};

function routes(
  repository: SearchRepository | undefined,
  standing: "active" | "revoked" = "active",
) {
  return createPeopleRoutes({
    ...services({ create: () => Promise.reject(new Error("unused")) }),
    ...(repository
      ? {
        search: createWorkspaceSearch({
          actors: { revalidate: () => Promise.resolve(standing) },
          repository,
          transaction: { run: (work) => work({ opaque: undefined }) },
        }),
      }
      : {}),
  });
}

async function problemCode(response: Response): Promise<string> {
  const body = await response.json() as { readonly code?: string };
  return body.code ?? "";
}

Deno.test("[SEARCH-001] HTTP answers the resolved workspace's groups with avatar descriptors", async () => {
  const seen: Parameters<SearchRepository["searchPeople"]>[0][] = [];
  const app = routes(answering(
    {
      ...EMPTY,
      notes: [{
        id: noteId,
        person: { archived: false, id: personId, name: "Ada Lovelace" },
        text: "<b>river</b> walk",
      }],
      people: [{
        avatar: { backgroundColor: "#123456", fileId },
        givenName: "Ada",
        id: personId,
      }],
    },
    seen,
  ));
  const response = await app.request(
    "http://localhost/api/v1/search?q=%20river%20&limit=3&sort=family-name",
    { headers },
  );
  assertStatus(response, 200, "search answers");
  assertEquals(response.headers.get("cache-control"), "private, no-store");
  const body = searchResults.parse(await response.json());
  assertEquals(body.query, "river");
  assertEquals(body.groups.map((group) => group.kind), [
    "people",
    "notes",
    "activities",
    "journal-posts",
    "tasks",
  ]);
  const people = body.groups[0]!;
  assert(people.kind === "people", "people lead");
  assertEquals(people.results[0]?.avatar, {
    color: "#123456",
    imageUrl: `/api/v1/people/${personId}/files/${fileId}/content`,
  });
  const notes = body.groups[1]!;
  assert(notes.kind === "notes", "notes follow");
  assertEquals(notes.results[0]?.snippet, "<b>river</b> walk");
  assertEquals(seen[0]?.workspaceId, actor.workspaceId);
  assertEquals(seen[0]?.limit, 3);
  assertEquals(seen[0]?.query, "river");
  assertEquals(seen[0]?.sort, "family-name");
});

Deno.test("[SEARCH-001] HTTP answers people with the text groups marked unavailable", async () => {
  const app = routes({
    searchPeople: () =>
      Promise.resolve({
        people: [{ givenName: "Ada", id: personId }],
        status: "ready",
      }),
    searchText: () => Promise.resolve({ status: "timed-out" }),
  });
  const response = await app.request(
    "http://localhost/api/v1/search?q=ada",
    { headers },
  );
  assertStatus(response, 200, "people still answer");
  const body = searchResults.parse(await response.json());
  assertEquals(
    body.groups.map((group) => [
      group.kind,
      group.results.length,
      "unavailable" in group ? group.unavailable : undefined,
    ]),
    [
      ["people", 1, undefined],
      ["notes", 0, true],
      ["activities", 0, true],
      ["journal-posts", 0, true],
      ["tasks", 0, true],
    ],
  );
  const timedOut = await routes({
    searchPeople: () => Promise.resolve({ status: "timed-out" }),
    searchText: () => Promise.reject(new Error("unused")),
  }).request("http://localhost/api/v1/search?q=ada", { headers });
  assertStatus(timedOut, 503, "a timed-out people statement");
  assertEquals(await problemCode(timedOut), "search_unavailable");
});

Deno.test("[SEARCH-001] HTTP refuses a blank, overlong, or unbounded query", async () => {
  const app = routes(failing(new Error("must not search")));
  for (
    const query of [
      "",
      "?q=",
      "?q=%20%20",
      `?q=${"x".repeat(201)}`,
      "?q=ada&limit=0",
      "?q=ada&limit=11",
      "?q=ada&limit=two",
      "?q=ada&extra=1",
      "?q=ada&sort=recently-added",
    ]
  ) {
    const response = await app.request(
      `http://localhost/api/v1/search${query}`,
      { headers },
    );
    assertStatus(response, 400, `query ${query}`);
    assertEquals(await problemCode(response), "search_query_invalid");
  }
  const longest = routes(answering(EMPTY));
  assertStatus(
    await longest.request(
      `http://localhost/api/v1/search?q=${"x".repeat(200)}`,
      { headers },
    ),
    200,
    "two hundred characters are accepted",
  );
});

Deno.test("[SEARCH-001] HTTP names a revoked member, a failed read, and a missing session", async () => {
  const revoked = await routes(
    answering(EMPTY),
    "revoked",
  )
    .request("http://localhost/api/v1/search?q=ada", { headers });
  assertStatus(revoked, 403, "a revoked member is refused");
  assertEquals(await problemCode(revoked), "search_forbidden");

  const failed = await routes(failing(new Error("database down"))).request(
    "http://localhost/api/v1/search?q=ada",
    { headers },
  );
  assertStatus(failed, 503, "a failed read is unavailable");
  assertEquals(await problemCode(failed), "search_unavailable");

  const unmounted = await routes(undefined).request(
    "http://localhost/api/v1/search?q=ada",
    { headers },
  );
  assertStatus(unmounted, 503, "no search service is unavailable");

  const anonymous = await routes(answering(EMPTY))
    .request("http://localhost/api/v1/search?q=ada");
  assertStatus(anonymous, 401, "a request without a session is refused");
});
