/**
 * The people surface as one mounted whole.
 *
 * GAP-021 moved twenty-one routes out of one file into six, and Hono matches
 * in the order routes were added, so the order the concerns are mounted in is
 * contract rather than taste. Two things are pinned here: the whole
 * registration order, which would notice a route that went missing or moved,
 * and the one overlap that could actually change an answer — the literal
 * `tag-options` path sitting in front of `:personId`.
 *
 * MCP-B1 adds the admission of the people-identity routes a personal token
 * may reach: each one's own grant and no other, a bearer write without an
 * `Origin`, and a cookie client's Origin rule and check order unchanged.
 */

import { createPeopleRoutes } from "./routes.ts";
import { assert, assertEquals } from "../../../../testing/assert.ts";
import * as fixtures from "../../../../testing/fixtures.ts";
import { headers, services } from "./people.test-helper.ts";

/** Every route the mounted surface registers, in registration order. */
function mounted(
  app: {
    readonly routes: readonly {
      readonly method: string;
      readonly path: string;
    }[];
  },
): string[] {
  const registered = new Set<string>();
  for (const route of app.routes) {
    if (route.method !== "ALL") registered.add(`${route.method} ${route.path}`);
  }
  return [...registered];
}

Deno.test("[GAP-021] the mounted people concerns register every route in order", () => {
  const app = createPeopleRoutes(
    services({ create: () => Promise.reject(new Error("unused")) }),
  );
  assertEquals(
    mounted(app).join("\n"),
    [
      "GET /api/v1/people",
      "GET /api/v1/people/tag-options",
      "GET /api/v1/people/tag-facet",
      "POST /api/v1/people/:personId/view",
      "GET /api/v1/today/recent-people",
      "GET /api/v1/people/duplicates",
      "POST /api/v1/people/duplicates/dismissals",
      "GET /api/v1/people/:primaryId/merge-preview",
      "POST /api/v1/people/:primaryId/merge",
      "POST /api/v1/people/bulk",
      "GET /api/v1/people/:personId/life-events",
      "GET /api/v1/people/:personId/timeline",
      "GET /api/v1/people/:personId",
      "GET /api/v1/people/:personId/facts/:section",
      "POST /api/v1/people/:personId/facts/:section",
      "PUT /api/v1/people/:personId/facts/:section/:factId",
      "DELETE /api/v1/people/:personId/facts/:section/:factId",
      "GET /api/v1/people/:personId/dates",
      "POST /api/v1/people/:personId/dates",
      "PATCH /api/v1/people/:personId/dates/:dateId",
      "DELETE /api/v1/people/:personId/dates/:dateId",
      "GET /api/v1/people/:personId/identity",
      "PATCH /api/v1/people/:personId",
      "POST /api/v1/people",
      "POST /api/v1/people/:personId/archive",
      "POST /api/v1/people/:personId/restore",
      "GET /api/v1/people/:personId/deletion-impact",
      "DELETE /api/v1/people/:personId",
      "PUT /api/v1/people/:personId/avatar",
      "DELETE /api/v1/people/:personId/avatar",
      "PUT /api/v1/people/:personId/star",
      "DELETE /api/v1/people/:personId/star",
      "GET /api/v1/search",
    ].join("\n"),
    "eleven mounted concerns register what one file used to, plus the avatar, search, the merge, bulk actions, the star, and the tag facet",
  );
});

Deno.test("[GAP-021] the people literal paths still answer ahead of :personId", async () => {
  const reached: string[] = [];
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    {
      list: () => {
        reached.push("directory");
        return Promise.resolve({ people: [], status: "ready" });
      },
    },
    {
      list: () => {
        reached.push("tag-options");
        return Promise.resolve({ options: [], status: "ready" });
      },
    },
    {
      get: () => {
        reached.push("person");
        return Promise.resolve({ status: "not-found" });
      },
    },
  ));
  const responses: number[] = [];
  for (
    const path of [
      "/api/v1/people",
      "/api/v1/people/tag-options",
      `/api/v1/people/${fixtures.personId()}`,
    ]
  ) {
    responses.push(
      (await app.request(`http://localhost${path}`, { headers })).status,
    );
  }
  assertEquals(
    reached.join(" "),
    "directory tag-options person",
    "tag-options reaches its own read rather than the person read",
  );
  assert(
    responses[0] === 200 && responses[1] === 200 && responses[2] === 404,
    "each overlapping path answers from the handler that owns it",
  );
});

/** Each people-identity route a token may reach (MCP-B1), and a body it takes. */
interface TokenRoute {
  readonly body?: unknown;
  readonly method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  /** A grant beside the one required, which must not stand in for it. */
  readonly neighbour: string;
  readonly path: string;
  readonly scope: string;
}

const TOKEN_ID = "00000000-0000-4000-8000-0000000000aa";
const TOKEN_PERSON = fixtures.personId();
const TOKEN_OTHER = fixtures.uuid(102);
const TOKEN_REVISION = "2026-09-27T10:00:00.000000Z";
const WRITE = { neighbour: "people:read", scope: "people:write" } as const;
const DESTROY = { neighbour: "people:write", scope: "people:delete" } as const;
const MERGE = { neighbour: "people:write", scope: "people:merge" } as const;

const TOKEN_ROUTES: readonly TokenRoute[] = [
  {
    ...WRITE,
    body: { givenName: "Ada", isPartial: false },
    method: "POST",
    path: "/api/v1/people",
  },
  {
    ...WRITE,
    body: {
      expectedUpdatedAt: TOKEN_REVISION,
      givenName: "Ada",
      isPartial: false,
    },
    method: "PATCH",
    path: `/api/v1/people/${TOKEN_PERSON}`,
  },
  {
    ...WRITE,
    body: { expectedUpdatedAt: TOKEN_REVISION },
    method: "POST",
    path: `/api/v1/people/${TOKEN_PERSON}/archive`,
  },
  {
    ...WRITE,
    body: { expectedUpdatedAt: TOKEN_REVISION },
    method: "POST",
    path: `/api/v1/people/${TOKEN_PERSON}/restore`,
  },
  { ...WRITE, method: "PUT", path: `/api/v1/people/${TOKEN_PERSON}/star` },
  { ...WRITE, method: "DELETE", path: `/api/v1/people/${TOKEN_PERSON}/star` },
  {
    ...WRITE,
    body: { action: "archive", personIds: [TOKEN_PERSON] },
    method: "POST",
    path: "/api/v1/people/bulk",
  },
  {
    ...DESTROY,
    method: "GET",
    path: `/api/v1/people/${TOKEN_PERSON}/deletion-impact`,
  },
  {
    ...DESTROY,
    body: { confirmation: "Delete Ada", expectedUpdatedAt: TOKEN_REVISION },
    method: "DELETE",
    path: `/api/v1/people/${TOKEN_PERSON}`,
  },
  { ...MERGE, method: "GET", path: "/api/v1/people/duplicates" },
  {
    ...MERGE,
    body: { personIds: [TOKEN_PERSON, TOKEN_OTHER] },
    method: "POST",
    path: "/api/v1/people/duplicates/dismissals",
  },
  {
    ...MERGE,
    method: "GET",
    path:
      `/api/v1/people/${TOKEN_PERSON}/merge-preview?duplicateId=${TOKEN_OTHER}`,
  },
  {
    ...MERGE,
    body: {
      confirmed: true,
      conflictsDigest: "ab".repeat(32),
      duplicateId: TOKEN_OTHER,
      duplicateRevision: TOKEN_REVISION,
      primaryRevision: TOKEN_REVISION,
    },
    method: "POST",
    path: `/api/v1/people/${TOKEN_PERSON}/merge`,
  },
  {
    method: "GET",
    neighbour: "people:profile:read",
    path: "/api/v1/people/tag-options",
    scope: "people:read",
  },
  {
    method: "GET",
    neighbour: "people:profile:read",
    path: "/api/v1/people/tag-facet",
    scope: "people:read",
  },
  {
    method: "GET",
    neighbour: "people:read",
    path: "/api/v1/search?q=Ada",
    scope: "search:read",
  },
  {
    method: "GET",
    neighbour: "people:read",
    path: "/api/v1/today/recent-people",
    scope: "today:read",
  },
];

/**
 * The surface with every use case behind these routes recording the actor it
 * was handed and then failing, so a request that reaches one answers that
 * route's own 503, and a token whose secret is its one grant.
 */
function tokenSurface() {
  const reached: { readonly apiTokenId?: string; readonly path: string }[] = [];
  let current = "";
  const record = (resolved: object) => {
    const { apiTokenId } = resolved as { readonly apiTokenId?: string };
    reached.push({
      ...(apiTokenId ? { apiTokenId } : {}),
      path: current,
    });
    return Promise.reject(new Error("recorded"));
  };
  const base = services({ create: record });
  const app = createPeopleRoutes({
    ...base,
    apiTokens: {
      authenticate: (token, scope, workspaceId) =>
        Promise.resolve(
          token === scope && !workspaceId
            ? {
              actor: fixtures.sessionActor({ workspaceName: "Circle" }),
              status: "authenticated" as const,
              tokenId: TOKEN_ID,
            }
            : { status: "invalid" as const },
        ),
    },
    bulk: { run: record },
    duplicateDismissals: { dismiss: record },
    duplicates: { list: record },
    merge: { merge: record, preview: record },
    people: {
      ...base.people,
      archive: record,
      create: record,
      delete: record,
      edit: record,
      previewDeletion: record,
      restore: record,
    },
    search: { search: record },
    stars: { set: record },
    tagFacet: { list: record },
    tagOptions: { list: record },
    todayRecentPeople: { get: record },
  });
  const send = async (
    route: TokenRoute,
    extra: Record<string, string>,
    body: unknown = route.body,
  ) => {
    current = route.path;
    const response = await app.request(`http://localhost${route.path}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...extra,
      },
      method: route.method,
    });
    await response.body?.cancel();
    return response.status;
  };
  return { reached, send };
}

Deno.test("[MCP-B1] each people-identity route admits only its own grant, and a bearer write needs no Origin", async () => {
  for (const route of TOKEN_ROUTES) {
    const { reached, send } = tokenSurface();
    const label = `${route.method} ${route.path}`;
    assertEquals(
      await send(route, { authorization: `Bearer ${route.scope}` }),
      503,
      `${label}: ${route.scope} reaches the use case without cookie or Origin`,
    );
    assertEquals(
      JSON.stringify(reached),
      JSON.stringify([{ apiTokenId: TOKEN_ID, path: route.path }]),
      `${label}: the use case acts as the token, named on the actor`,
    );
    for (const refused of [route.neighbour, "malformed"]) {
      assertEquals(
        await send(route, {
          authorization: `Bearer ${refused}`,
          cookie: headers.cookie,
          origin: headers.origin,
        }),
        401,
        `${label}: ${refused} is refused and never borrows the cookie`,
      );
    }
    assertEquals(
      await send(route, {
        authorization: `Bearer ${route.scope}`,
        "X-Workspace-Id": fixtures.uuid(999),
      }),
      401,
      `${label}: a token cannot name another workspace`,
    );
    assertEquals(reached.length, 1, `${label}: no refusal reached a use case`);
  }
});

Deno.test("[MCP-B1] cookie clients of the people-identity routes keep their Origin rule and their order", async () => {
  for (const route of TOKEN_ROUTES) {
    const { reached, send } = tokenSurface();
    const label = `${route.method} ${route.path}`;
    const cookie = { cookie: headers.cookie };
    assertEquals(
      await send(route, { ...cookie, origin: headers.origin }),
      503,
      `${label}: a same-origin cookie request reaches the use case`,
    );
    assertEquals(
      JSON.stringify(reached),
      JSON.stringify([{ path: route.path }]),
      `${label}: a cookie actor names no token`,
    );
    if (route.method !== "GET") {
      assertEquals(
        await send(route, cookie),
        403,
        `${label}: a cookie write without Origin is refused`,
      );
    }
    if (route.body !== undefined) {
      assertEquals(
        await send(route, { ...cookie, origin: "http://evil.test" }, {
          unexpected: true,
        }),
        403,
        `${label}: the origin is still checked before the body`,
      );
      assertEquals(
        await send(route, { authorization: `Bearer ${route.scope}` }, {
          unexpected: true,
        }),
        400,
        `${label}: a bearer write's body is validated as a cookie's is`,
      );
    }
    assertEquals(reached.length, 1, `${label}: no refusal reached a use case`);
  }
});
