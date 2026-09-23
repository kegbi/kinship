import type { RelationshipManagement } from "../../public.ts";
import {
  createRelationshipRoutes,
  type RelationshipHttpServices,
} from "./routes.ts";
import { assert, assertStatus } from "../../../../testing/assert.ts";
import * as fixtures from "../../../../testing/fixtures.ts";

const sourceId = "00000000-0000-4000-8000-000000000100";
const targetId = "00000000-0000-4000-8000-000000000101";
const typeId = "00000000-0000-4000-8000-000000000200";
const relationshipId = "00000000-0000-4000-8000-000000000300";
const updatedAt = "2026-08-16T12:00:00.000000Z";
const actor = fixtures.sessionActor({ workspaceName: "Circle" });

function services(
  overrides: Partial<RelationshipManagement> = {},
): RelationshipHttpServices {
  const relationship = {
    createdAt: updatedAt,
    forwardLabel: "parent",
    fromPersonId: sourceId,
    id: relationshipId,
    relationshipTypeId: typeId,
    relationshipTypeArchived: false,
    reverseLabel: "child",
    status: "active" as const,
    toPersonId: targetId,
    updatedAt,
  };
  return {
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    protectedSessions: { resolve: () => Promise.resolve(actor) },
    relationships: {
      create: () =>
        Promise.resolve({
          affectedPersonIds: [sourceId, targetId],
          forward: { label: "parent", personId: targetId, relationshipId },
          inverse: { label: "child", personId: sourceId, relationshipId },
          relationship,
          status: "created",
        }),
      createRelatedPerson: () =>
        Promise.resolve({
          affectedPersonIds: [sourceId, targetId],
          forward: { label: "parent", personId: targetId, relationshipId },
          inverse: { label: "child", personId: sourceId, relationshipId },
          person: {
            familyName: "Hopper",
            givenName: "Grace",
            id: targetId,
            isPartial: false,
          },
          relationship,
          status: "created",
        }),
      delete: () =>
        Promise.resolve({
          affectedPersonIds: [sourceId, targetId],
          relationshipId,
          status: "deleted",
        }),
      list: () =>
        Promise.resolve({
          relationships: [{
            ...relationship,
            display: {
              label: "parent",
              name: "Target Person",
              personId: targetId,
              relationshipId,
            },
          }],
          status: "ready",
        }),
      listTypes: () =>
        Promise.resolve({
          options: [{
            archived: false,
            forwardLabel: "parent",
            id: typeId,
            reverseLabel: "child",
          }],
          selected: [],
          status: "ready",
        }),
      update: () =>
        Promise.resolve({
          affectedPersonIds: [sourceId, targetId],
          forward: { label: "parent", personId: targetId, relationshipId },
          inverse: { label: "child", personId: sourceId, relationshipId },
          relationship,
          status: "updated",
        }),
      ...overrides,
    } as RelationshipManagement,
  };
}

Deno.test("RELATIONSHIP-001 HTTP exposes strict directional create, update, list, types, and unlink", async () => {
  let listInput: { readonly cursor?: string; readonly limit?: number } = {};
  let typeInput: {
    readonly cursor?: string;
    readonly search?: string;
    readonly selectedTypeIds?: readonly string[];
  } = {};
  const app = createRelationshipRoutes(services({
    list: (_actor, _personId, input) => {
      listInput = input ?? {};
      return Promise.resolve({
        nextCursor: "opaque-next",
        relationships: [],
        status: "ready",
      });
    },
    listTypes: (_actor, input) => {
      typeInput = input ?? {};
      return Promise.resolve({ options: [], selected: [], status: "ready" });
    },
  }));
  const headers = {
    cookie: "kinship_session=test",
    "content-type": "application/json",
    origin: "http://localhost",
  };
  const created = await app.request(
    `http://localhost/api/v1/people/${sourceId}/relationships`,
    {
      body: JSON.stringify({
        relationshipTypeId: typeId,
        targetPersonId: targetId,
      }),
      headers,
      method: "POST",
    },
  );
  assertStatus(created, 201);
  assert((await created.json()).inverse.label === "child", "inverse missing");
  const related = await app.request(
    `http://localhost/api/v1/people/${sourceId}/relationships/related-person`,
    {
      body: JSON.stringify({
        person: { givenName: "Grace", isPartial: false },
        relationshipTypeId: typeId,
      }),
      headers,
      method: "POST",
    },
  );
  assert(
    related.status === 201 && (await related.json()).person.id === targetId,
    "atomic related-person route failed",
  );
  const listed = await app.request(
    `http://localhost/api/v1/people/${targetId}/relationships?limit=7&cursor=opaque`,
    { headers },
  );
  assertStatus(listed, 200, "list failed");
  assert(
    listInput.limit === 7 && listInput.cursor === "opaque",
    "bounded cursor query was not forwarded",
  );
  const unicodeTypeSearch = "Родство关系😀";
  const types = await app.request(
    `http://localhost/api/v1/relationship-types?search=${
      encodeURIComponent(unicodeTypeSearch)
    }&cursor=opaque&selected=${typeId},${targetId}`,
    { headers },
  );
  assert(
    types.status === 200 && typeInput.cursor === "opaque" &&
      typeInput.search === unicodeTypeSearch &&
      typeInput.selectedTypeIds?.join(",") === `${typeId},${targetId}`,
    "type search cursor or selected hydration was not forwarded",
  );
  const changed = await app.request(
    `http://localhost/api/v1/people/${sourceId}/relationships/${relationshipId}`,
    {
      body: JSON.stringify({
        expectedUpdatedAt: updatedAt,
        relationshipTypeId: typeId,
      }),
      headers,
      method: "PATCH",
    },
  );
  assertStatus(changed, 200, "update failed");
  const removed = await app.request(
    `http://localhost/api/v1/people/${sourceId}/relationships/${relationshipId}`,
    {
      body: JSON.stringify({ expectedUpdatedAt: updatedAt }),
      headers,
      method: "DELETE",
    },
  );
  assertStatus(removed, 200, "unlink failed");
  const extra = await app.request(
    `http://localhost/api/v1/people/${sourceId}/relationships`,
    {
      body: JSON.stringify({
        relationshipTypeId: typeId,
        targetPersonId: targetId,
        romantic: true,
      }),
      headers,
      method: "POST",
    },
  );
  assertStatus(extra, 400, "unknown romantic metadata was accepted");
});

Deno.test("RELATIONSHIP-001 HTTP maps invalid, stale, missing, forbidden, and outage reads and writes", async () => {
  const headers = {
    cookie: "kinship_session=test",
    "content-type": "application/json",
    origin: "http://localhost",
  };
  for (
    const [override, expected] of [
      [{ list: () => Promise.resolve({ status: "forbidden" as const }) }, 403],
      [{ list: () => Promise.resolve({ status: "not-found" as const }) }, 404],
      [{ list: () => Promise.reject(new Error("offline")) }, 503],
    ] as const
  ) {
    const response = await createRelationshipRoutes(services(override)).request(
      `http://localhost/api/v1/people/${sourceId}/relationships`,
      { headers },
    );
    assert(
      response.status === expected,
      `list state mapped to ${response.status}`,
    );
  }
  assert(
    (await createRelationshipRoutes(services()).request(
      "http://localhost/api/v1/people/not-a-uuid/relationships",
      { headers },
    )).status === 400,
    "invalid list id accepted",
  );
  assert(
    (await createRelationshipRoutes(services({
      listTypes: () => Promise.resolve({ status: "stale-cursor" }),
    })).request("http://localhost/api/v1/relationship-types?cursor=stale", {
      headers,
    })).status === 409,
    "stale relationship type cursor was not mapped",
  );
  const hiddenTypes = await createRelationshipRoutes(services({
    listTypes: () =>
      Promise.resolve({
        options: [],
        selected: [],
        status: "hidden" as const,
      }),
  })).request(
    `http://localhost/api/v1/relationship-types?selected=${typeId}`,
    { headers },
  );
  const hiddenTypesBody = await hiddenTypes.json();
  assert(
    hiddenTypes.status === 200 && hiddenTypesBody.status === "hidden" &&
      hiddenTypesBody.options.length === 0 &&
      hiddenTypesBody.selected.length === 0,
    "hidden module disclosed a selected relationship type over HTTP",
  );
  assert(
    (await createRelationshipRoutes(services()).request(
      "http://localhost/api/v1/relationship-types?selected=no",
      { headers },
    )).status === 400,
    "invalid type query accepted",
  );
  assert(
    (await createRelationshipRoutes(services({
      listTypes: () => Promise.reject(new Error("offline")),
    })).request("http://localhost/api/v1/relationship-types", { headers }))
      .status === 503,
    "type outage concealed as empty",
  );
  for (
    const [override, expected] of [
      [{ create: () => Promise.resolve({ status: "stale" as const }) }, 409],
      [{
        create: () =>
          Promise.resolve({
            errors: { targetPersonId: "Choose another person." },
            status: "validation-error" as const,
          }),
      }, 400],
      [{ create: () => Promise.reject(new Error("offline")) }, 503],
    ] as const
  ) {
    const response = await createRelationshipRoutes(services(override)).request(
      `http://localhost/api/v1/people/${sourceId}/relationships`,
      {
        body: JSON.stringify({
          relationshipTypeId: typeId,
          targetPersonId: targetId,
        }),
        headers,
        method: "POST",
      },
    );
    assert(
      response.status === expected,
      `create state mapped to ${response.status}`,
    );
  }
  const patchUrl =
    `http://localhost/api/v1/people/${sourceId}/relationships/${relationshipId}`;
  const invalidPatch = await createRelationshipRoutes(services()).request(
    patchUrl,
    { body: "{}", headers, method: "PATCH" },
  );
  const stalePatch = await createRelationshipRoutes(
    services({ update: () => Promise.resolve({ status: "stale" }) }),
  ).request(patchUrl, {
    body: JSON.stringify({
      expectedUpdatedAt: updatedAt,
      relationshipTypeId: typeId,
    }),
    headers,
    method: "PATCH",
  });
  const unavailablePatch = await createRelationshipRoutes(
    services({ update: () => Promise.reject(new Error("offline")) }),
  ).request(patchUrl, {
    body: JSON.stringify({
      expectedUpdatedAt: updatedAt,
      relationshipTypeId: typeId,
    }),
    headers,
    method: "PATCH",
  });
  assert(
    invalidPatch.status === 400 && stalePatch.status === 409 &&
      unavailablePatch.status === 503,
    "patch states mapped incorrectly",
  );
  const invalidDelete = await createRelationshipRoutes(services()).request(
    patchUrl,
    { body: "{}", headers, method: "DELETE" },
  );
  const unavailableDelete = await createRelationshipRoutes(
    services({ delete: () => Promise.reject(new Error("offline")) }),
  ).request(patchUrl, {
    body: JSON.stringify({ expectedUpdatedAt: updatedAt }),
    headers,
    method: "DELETE",
  });
  assert(
    invalidDelete.status === 400 && unavailableDelete.status === 503,
    "delete states mapped incorrectly",
  );
});

Deno.test("RELATIONSHIP-001 HTTP enforces session, origin, tenant concealment, and archive state", async () => {
  const headers = {
    cookie: "kinship_session=test",
    "content-type": "application/json",
    origin: "http://localhost",
  };
  for (
    const [status, expected] of [["not-found", 404], ["forbidden", 403], [
      "archived-write-rejected",
      409,
    ]] as const
  ) {
    const app = createRelationshipRoutes(
      services({ create: () => Promise.resolve({ status }) }),
    );
    const response = await app.request(
      `http://localhost/api/v1/people/${sourceId}/relationships`,
      {
        body: JSON.stringify({
          relationshipTypeId: typeId,
          targetPersonId: targetId,
        }),
        headers,
        method: "POST",
      },
    );
    assert(
      response.status === expected,
      `${status} mapped to ${response.status}`,
    );
  }
  const app = createRelationshipRoutes({
    ...services(),
    protectedSessions: { resolve: () => Promise.resolve(undefined) },
  });
  const noSession = await app.request(
    `http://localhost/api/v1/people/${sourceId}/relationships`,
    {
      body: JSON.stringify({
        relationshipTypeId: typeId,
        targetPersonId: targetId,
      }),
      headers: { ...headers, cookie: "" },
      method: "POST",
    },
  );
  assertStatus(noSession, 401, "missing session accepted");
  const badOrigin = await app.request(
    `http://localhost/api/v1/people/${sourceId}/relationships`,
    {
      body: JSON.stringify({
        relationshipTypeId: typeId,
        targetPersonId: targetId,
      }),
      headers: { ...headers, origin: "http://attacker.test" },
      method: "POST",
    },
  );
  assertStatus(badOrigin, 403, "cross-origin mutation accepted");
});
