/**
 * The bounded people directory: what it lists, and who may read it.
 *
 * The one route in the surface that a personal access token can reach, which
 * is why the bearer test lives here — and why it also proves that the same
 * token cannot reach the create route beside it.
 */

import {
  createPeopleDirectory,
} from "../../../../read-models/people-directory/public.ts";
import { createPeopleRoutes } from "./routes.ts";
import {
  assert,
  assertEquals,
  assertStatus,
} from "../../../../testing/assert.ts";
import {
  NAME_FOLD_STEPS,
  nameSearchForms,
} from "../../../../../contracts/schemas/name_search.ts";
import { actor, headers, services } from "./people.test-helper.ts";

Deno.test("API-001 bearer scope authenticates only the people directory read", async () => {
  let listedWorkspace = "";
  const routes = createPeopleRoutes({
    ...services({ create: () => Promise.reject(new Error("unused")) }),
    apiTokens: {
      authenticate: (token, scope, workspaceId) => {
        assert(
          token === "accepted-token",
          "bearer passed without logging or mutation",
        );
        assert(
          scope === "people:read",
          "directory requires explicit read scope",
        );
        assert(
          workspaceId === actor.workspaceId,
          "requested workspace is verified",
        );
        return Promise.resolve({ actor, status: "authenticated" });
      },
    },
    directory: {
      list: (resolved) => {
        listedWorkspace = resolved.workspaceId;
        return Promise.resolve({ people: [], status: "ready" });
      },
    },
  });
  const accepted = await routes.request("http://localhost/api/v1/people", {
    headers: {
      authorization: "bEaReR accepted-token",
      "X-Workspace-Id": actor.workspaceId,
    },
  });
  assert(
    accepted.status === 200 && listedWorkspace === actor.workspaceId,
    "bearer reads its active workspace",
  );
  assert(
    (await routes.request("http://localhost/api/v1/people", {
      headers: { authorization: "Bearer accepted-token extra" },
    })).status === 401,
    "bearer accepts exactly one credential",
  );
  const mutation = await routes.request("http://localhost/api/v1/people", {
    body: JSON.stringify({ givenName: "Rejected", isPartial: false }),
    headers: {
      authorization: "Bearer accepted-token",
      "content-type": "application/json",
      origin: "http://localhost",
    },
    method: "POST",
  });
  assertStatus(mutation, 401, "bearer cannot reuse browser mutation boundary");
});

Deno.test("PEOPLE-002 HTTP lists only the resolved active workspace", async () => {
  let received: unknown;
  const personTags = Array.from({ length: 8 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 200).padStart(12, "0")}`,
    name: `Tag ${index + 1}`,
  }));
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    createPeopleDirectory({
      actors: { revalidate: () => Promise.resolve("active" as const) },
      transaction: { run: (work) => work({ opaque: undefined }) },
      repository: {
        list: (command) => {
          received = command;
          return Promise.resolve({
            people: [{
              cursor: {
                id: "00000000-0000-4000-8000-000000000100",
                primary: "lovelace",
                secondary: "ada",
              },
              familyName: "Lovelace",
              givenName: "Ada",
              id: "00000000-0000-4000-8000-000000000100",
              isPartial: false,
              isStarred: false,
              lifecycle: "active",
              tagCount: personTags.length,
              tags: personTags,
            }],
            status: "ready",
          });
        },
      },
    }),
  ));

  const response = await app.request(
    "http://localhost/api/v1/people?search=Ada&lifecycle=active&sort=family-name&limit=20",
    { headers },
  );
  assertStatus(response, 200, "directory response is ready");
  const body = await response.json() as {
    readonly people?: readonly {
      readonly id: string;
      readonly tagCount: number;
      readonly tags: readonly unknown[];
    }[];
  };

  assert(
    body.people?.[0]?.id === "00000000-0000-4000-8000-000000000100" &&
      body.people[0].tags.length === 5 && body.people[0].tagCount === 8,
    "directory returns a bounded tag preview and exact count",
  );
  assert(
    (received as typeof actor & { readonly search: string })?.workspaceId ===
        actor.workspaceId &&
      (received as typeof actor & { readonly search: string })?.search ===
        "Ada",
    "resolved actor and query criteria reach the directory use case",
  );
  const named = received as {
    readonly nameFold?: unknown;
    readonly nameForms?: unknown;
  };
  assertEquals(named.nameForms, nameSearchForms("Ada"));
  assertEquals(named.nameFold, NAME_FOLD_STEPS);
});

Deno.test("PEOPLE-006 HTTP hydrates one bounded introducer descriptor", async () => {
  const subjectId = "00000000-0000-4000-8000-000000000100";
  const selectedId = "00000000-0000-4000-8000-000000000101";
  let selectedCommand: unknown;
  const selected = {
    cursor: { id: selectedId, primary: "hopper", secondary: "grace" },
    familyName: "Hopper",
    givenName: "Grace",
    id: selectedId,
    isPartial: false,
    isStarred: false,
    lifecycle: "active" as const,
    tagCount: 0,
    tags: [],
  };
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    createPeopleDirectory({
      actors: { revalidate: () => Promise.resolve("active" as const) },
      transaction: { run: (work) => work({ opaque: undefined }) },
      repository: {
        findSelected: (command) => {
          selectedCommand = command;
          return Promise.resolve(
            command.personId === selectedId ? selected : undefined,
          );
        },
        list: () => Promise.resolve({ people: [], status: "ready" }),
      },
    }),
  ));

  const response = await app.request(
    `http://localhost/api/v1/people?limit=1&selectedPersonId=${selectedId}&excludePersonId=${subjectId}`,
    { headers },
  );
  const body = await response.json() as {
    readonly selected?: { readonly id: string; readonly givenName: string };
  };
  assert(
    response.status === 200 && body.selected?.id === selectedId &&
      body.selected.givenName === "Grace",
    "selected introducer is hydrated outside the bounded page",
  );
  assert(
    (selectedCommand as { readonly workspaceId?: string })?.workspaceId ===
      actor.workspaceId,
    "selected lookup stays in the resolved tenant boundary",
  );
});

Deno.test("PEOPLE-006 HTTP binds excluded people to directory continuation", async () => {
  const subjectId = "00000000-0000-4000-8000-000000000100";
  const otherExcludeId = "00000000-0000-4000-8000-000000000101";
  const candidate = (id: string, givenName: string) => ({
    cursor: { id, primary: givenName.toLowerCase(), secondary: "" },
    givenName,
    id,
    isPartial: false,
    isStarred: false,
    lifecycle: "active" as const,
    tagCount: 0,
    tags: [],
  });
  let receivedExclude = "";
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    createPeopleDirectory({
      actors: { revalidate: () => Promise.resolve("active" as const) },
      transaction: { run: (work) => work({ opaque: undefined }) },
      repository: {
        list: (command) => {
          receivedExclude = command.excludePersonId ?? "";
          return Promise.resolve({
            people: [
              candidate(
                "00000000-0000-4000-8000-000000000201",
                "Barbara",
              ),
              candidate(
                "00000000-0000-4000-8000-000000000202",
                "Charles",
              ),
            ],
            status: "ready" as const,
          });
        },
      },
    }),
  ));

  const first = await app.request(
    `http://localhost/api/v1/people?limit=1&excludePersonId=${subjectId}`,
    { headers },
  );
  const firstBody = await first.json() as {
    readonly nextCursor?: string;
    readonly people: readonly { readonly id: string }[];
  };
  assert(
    first.status === 200 && firstBody.people.length === 1 &&
      firstBody.people[0]?.id !== subjectId && receivedExclude === subjectId &&
      firstBody.nextCursor,
    "excluded subject does not consume the bounded result slot",
  );
  const mismatch = await app.request(
    `http://localhost/api/v1/people?limit=1&excludePersonId=${otherExcludeId}&cursor=${
      encodeURIComponent(firstBody.nextCursor ?? "")
    }`,
    { headers },
  );
  assertStatus(
    mismatch,
    409,
    "opaque continuation rejects a changed excluded-person criterion",
  );
});

Deno.test("PEOPLE-002 HTTP maps directory validation, denial, stale cursor, and outage safely", async () => {
  let calls = 0;
  const invalidApp = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    {
      list: () => {
        calls += 1;
        return Promise.resolve({ status: "forbidden" });
      },
    },
  ));
  const invalid = await invalidApp.request(
    "http://localhost/api/v1/people?lifecycle=deleted&limit=500",
    { headers },
  );
  assert(
    invalid.status === 400 && calls === 0,
    "invalid query is rejected early",
  );

  for (
    const scenario of [
      { expected: 403, result: { status: "forbidden" as const } },
      { expected: 409, result: { status: "stale-cursor" as const } },
    ]
  ) {
    const app = createPeopleRoutes(services(
      { create: () => Promise.reject(new Error("must not create")) },
      { list: () => Promise.resolve(scenario.result) },
    ));
    const response = await app.request("http://localhost/api/v1/people", {
      headers,
    });
    assert(
      response.status === scenario.expected,
      "directory state maps safely",
    );
    assert(
      response.headers.get("content-type") === "application/problem+json",
      "directory failure uses problem details",
    );
  }

  const unavailable = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    { list: () => Promise.reject(new Error("private database detail")) },
  ));
  const outage = await unavailable.request("http://localhost/api/v1/people", {
    headers,
  });
  assertStatus(outage, 503, "dependency outage is retryable");
  assert(
    !(await outage.text()).includes("private database detail"),
    "dependency detail stays private",
  );
});
