/**
 * One person's page, read on its canonical route.
 *
 * The identity header, the optional workspace summary, and the states the
 * read can be refused in — archived included, which is a readable state
 * rather than a missing person.
 */

import { createPeopleRoutes } from "./routes.ts";
import {
  assert,
  assertEquals,
  assertStatus,
} from "../../../../testing/assert.ts";
import { avatarColor } from "../../public.ts";
import * as fixtures from "../../../../testing/fixtures.ts";
import { actor, headers, services } from "./people.test-helper.ts";

Deno.test("PEOPLE-002 HTTP distinguishes an archived canonical identity", async () => {
  const personId = fixtures.personId();
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      get: () =>
        Promise.resolve({
          dueInformation: {
            detail: "0 open tasks.",
            openTaskCount: 0,
            status: "ready",
          },
          person: {
            givenName: "Harriet",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            tagCount: 0,
            tags: [],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          status: "archived",
        }),
    },
  ));
  const response = await app.request(
    `http://localhost/api/v1/people/${personId}`,
    { headers },
  );
  assert(
    response.status === 200 &&
      (await response.json() as { readonly status: string }).status ===
        "archived",
    "archived identity remains readable on its canonical route",
  );
});

Deno.test("[APP-003C] HTTP opens the read-only person workspace summary", async () => {
  const personId = fixtures.personId();
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      get: () =>
        Promise.resolve({
          dueInformation: {
            detail: "2 open tasks; next reminder 2026-08-20T09:00:00.000Z.",
            nextReminderAt: "2026-08-20T09:00:00.000Z",
            openTaskCount: 2,
            status: "ready",
          },
          person: {
            description: "Mathematician and correspondent.",
            familyName: "Lovelace",
            givenName: "Ada",
            id: personId,
            isDeceased: true,
            isPartial: false,
            isSelf: false,
            isStarred: true,
            tagCount: 0,
            tags: [],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          status: "ready",
        }),
    },
  ));

  const response = await app.request(
    `http://localhost/api/v1/people/${personId}`,
    { headers },
  );
  const body = await response.json() as {
    readonly dueInformation?: { readonly status?: string };
    readonly person?: {
      readonly description?: string;
      readonly isDeceased?: boolean;
      readonly isStarred?: boolean;
    };
  };

  assertStatus(response, 200, "person workspace summary is readable");
  assert(
    body.person?.description === "Mathematician and correspondent." &&
      body.person.isStarred === true && body.person.isDeceased === true,
    "identity orientation fields remain in the profile response",
  );
  assert(
    body.dueInformation?.status === "ready",
    "the shell returns the delivered due projection with orientation",
  );
});

Deno.test("[UXD-013] HTTP includes person section counts when summary is requested", async () => {
  const personId = fixtures.personId();
  let includeSummary = false;
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      get: (_resolved, _id, options) => {
        includeSummary = options?.includeSummary === true;
        return Promise.resolve({
          dueInformation: {
            detail: "0 open tasks.",
            openTaskCount: 0,
            status: "ready",
          },
          person: {
            givenName: "Ada",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            tagCount: 0,
            tags: [],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          status: "ready",
          summary: {
            primaryContactMethods: [],
            relationshipCounts: [],
            sectionCounts: [
              { count: 2, id: "activities", status: "ready" },
              { count: 12, id: "notes", status: "ready" },
              { count: 3, id: "tasks", status: "ready" },
            ],
          },
        } as never);
      },
    },
  ));

  const response = await app.request(
    `http://localhost/api/v1/people/${personId}?include=summary`,
    { headers },
  );
  const body = await response.json() as {
    readonly summary?: {
      readonly sectionCounts?: readonly {
        readonly count?: number;
        readonly id?: string;
      }[];
    };
  };

  assertStatus(response, 200, "summary person response is readable");
  assert(
    includeSummary &&
      JSON.stringify(body.summary?.sectionCounts) === JSON.stringify([
          { count: 2, id: "activities", status: "ready" },
          { count: 12, id: "notes", status: "ready" },
          { count: 3, id: "tasks", status: "ready" },
        ]),
    "summary includes the requested per-section record counts",
  );
});

Deno.test("[UXD-013] HTTP leaves the person response unchanged without include", async () => {
  const personId = fixtures.personId();
  let argumentCount = 0;
  const dueInformation = {
    detail: "0 open tasks.",
    openTaskCount: 0,
    status: "ready" as const,
  };
  const person = {
    givenName: "Ada",
    id: personId,
    isDeceased: false,
    isPartial: false,
    isSelf: false,
    isStarred: false,
    tagCount: 0,
    tags: [],
    updatedAt: "2026-08-15T08:00:00.000Z",
  };
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      get: (...args) => {
        argumentCount = args.length;
        return Promise.resolve({
          dueInformation,
          person,
          status: "ready",
          summary: {
            primaryContactMethods: [],
            relationshipCounts: [],
            sectionCounts: [],
          },
        });
      },
    },
  ));

  const response = await app.request(
    `http://localhost/api/v1/people/${personId}`,
    { headers },
  );

  assertStatus(response, 200, "base person response is readable");
  assert(
    await response.text() === JSON.stringify({
          dueInformation,
          person,
          status: "ready",
        }) && argumentCount === 2,
    "the absent include preserves bytes and does not request summary work",
  );
  const invalid = await app.request(
    `http://localhost/api/v1/people/${personId}?include=everything`,
    { headers },
  );
  assert(
    invalid.status === 400 && argumentCount === 2,
    "unsupported include values are rejected before summary work",
  );
});

Deno.test("AUD-Q3 HTTP answers the composed rail as each section's own endpoint presents it", async () => {
  const personId = fixtures.personId();
  let options: unknown;
  const unavailable = { status: "unavailable" } as const;
  const hidden = { status: "hidden" } as const;
  const record = {
    id: fixtures.personId(),
    section: "pets",
    updatedAt: "2026-08-15T08:00:00.000Z",
    value: { categoryId: fixtures.personId(), name: "Puff" },
  };
  const date = {
    createdAt: "2026-08-15T08:00:00.000Z",
    id: fixtures.personId(),
    isAgeBased: false,
    isYearApproximate: false,
    kind: "birthday",
    month: 12,
    personId,
    precision: "month",
    scheduling: { status: "scheduled" },
    updatedAt: "2026-08-15T08:00:00.000Z",
  };
  const reminders = { cadences: [], reminders: [], status: "ready" } as const;
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      get: (_resolved, _id, received) => {
        options = received;
        return Promise.resolve({
          dueInformation: {
            detail: "0 open tasks.",
            openTaskCount: 0,
            status: "ready",
          },
          person: {
            givenName: "Ada",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            tagCount: 0,
            tags: [],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          rail: {
            addresses: unavailable,
            "contact-methods": unavailable,
            "first-meeting": unavailable,
            "food-preferences": unavailable,
            "important-dates": {
              status: "ready",
              value: { dates: [date], status: "ready" },
            },
            pets: {
              status: "ready",
              value: {
                options: [],
                personUpdatedAt: "2026-08-15T08:00:00.000Z",
                records: [record],
                status: "ready",
              },
            },
            relationships: hidden,
            reminders: { status: "ready", value: reminders },
            tags: hidden,
            work: unavailable,
          },
          status: "ready",
          summary: {
            primaryContactMethods: [],
            relationshipCounts: [],
            sectionCounts: [],
          },
        } as never);
      },
    },
  ));

  const response = await app.request(
    `http://localhost/api/v1/people/${personId}?include=rail`,
    { headers },
  );
  const body = await response.json() as {
    readonly rail: Record<string, unknown>;
    readonly summary?: unknown;
  };

  assertStatus(response, 200, "the rail read answers");
  assertEquals(options, { includeRail: true }, "the read asks for the rail");
  assert(body.summary !== undefined, "the rail read carries the summary");
  assertEquals(body.rail.pets, {
    status: "ready",
    value: {
      options: [],
      personUpdatedAt: "2026-08-15T08:00:00.000Z",
      records: [{
        ...record,
        value: { section: "pets", ...record.value },
      }],
      status: "ready",
    },
  }, "a fact carries its section, as the fact endpoint presents it");
  assertEquals(body.rail["important-dates"], {
    status: "ready",
    value: { dates: [date], status: "ready" },
  }, "a date is presented as the dates endpoint presents it");
  assertEquals(
    body.rail.reminders,
    { status: "ready", value: reminders },
    "reminders",
  );
  for (const section of ["addresses", "contact-methods", "work"]) {
    assertEquals(body.rail[section], unavailable, `${section} is unavailable`);
  }
  for (const section of ["relationships", "tags"]) {
    assertEquals(body.rail[section], hidden, `${section} is hidden`);
  }

  const summary = await app.request(
    `http://localhost/api/v1/people/${personId}?include=summary`,
    { headers },
  );
  assert(
    !("rail" in (await summary.json() as Record<string, unknown>)),
    "a summary read never carries a rail",
  );
});

Deno.test("PEOPLE-001 HTTP reads canonical identity only in the resolved workspace", async () => {
  const personId = fixtures.personId();
  let received: unknown;
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      get: (resolved, id) => {
        received = [resolved, id];
        return Promise.resolve({
          dueInformation: {
            detail: "0 open tasks.",
            openTaskCount: 0,
            status: "ready",
          },
          person: {
            familyName: "Lovelace",
            givenName: "Ada",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            tagCount: 0,
            tags: [],
            updatedAt: "2026-08-15T08:00:00.000Z",
          },
          status: "ready",
        });
      },
    },
  ));
  const response = await app.request(
    `http://localhost/api/v1/people/${personId}`,
    { headers },
  );
  const body = await response.json() as {
    readonly person?: { readonly id: string };
    readonly status?: string;
  };
  assertStatus(response, 200, "canonical person identity is readable");
  assert(
    body.status === "ready" && body.person?.id === personId,
    "ready identity is returned",
  );
  assert(
    (received as [typeof actor, string])?.[0].workspaceId ===
        actor.workspaceId &&
      (received as [typeof actor, string])?.[1] === personId,
    "resolved actor and route ID reach the person-profile read model",
  );
  assert(
    response.headers.get("cache-control") === "private, no-store",
    "person identity response is private",
  );
});

Deno.test("PEOPLE-001 HTTP maps canonical identity read states safely", async () => {
  const personId = fixtures.personId();
  for (
    const scenario of [
      { expected: 403, status: "forbidden" as const },
      { expected: 404, status: "not-found" as const },
    ]
  ) {
    const app = createPeopleRoutes(services(
      { create: () => Promise.reject(new Error("must not create")) },
      undefined,
      undefined,
      { get: () => Promise.resolve({ status: scenario.status }) },
    ));
    const response = await app.request(
      `http://localhost/api/v1/people/${personId}`,
      { headers },
    );
    assert(response.status === scenario.expected, "read state maps safely");
    assert(
      response.headers.get("content-type") === "application/problem+json",
      "read failure uses problem details",
    );
  }

  const unavailable = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      get: () => Promise.reject(new Error("private dependency detail")),
    },
  ));
  const unavailableResponse = await unavailable.request(
    `http://localhost/api/v1/people/${personId}`,
    { headers },
  );
  assertStatus(unavailableResponse, 503, "read dependency failure retries");
  assert(
    !(await unavailableResponse.text()).includes("private dependency detail"),
    "read dependency detail stays private",
  );

  const malformed = await unavailable.request(
    "http://localhost/api/v1/people/not-a-uuid",
    { headers },
  );
  assertStatus(malformed, 400, "malformed canonical ID is rejected");
});

Deno.test("[REL-080] the profile avatar says whether an image is stored, drawn or held", async () => {
  const personId = fixtures.personId();
  const fileId = "00000000-0000-4000-8000-000000000200";
  const read = async (avatar: Record<string, unknown>) => {
    const app = createPeopleRoutes(services(
      { create: () => Promise.reject(new Error("must not create")) },
      undefined,
      undefined,
      {
        get: () =>
          Promise.resolve({
            dueInformation: {
              detail: "0 open tasks.",
              openTaskCount: 0,
              status: "ready",
            },
            person: {
              avatar,
              givenName: "Ada",
              id: personId,
              isDeceased: false,
              isPartial: false,
              isSelf: false,
              isStarred: false,
              tagCount: 0,
              tags: [],
              updatedAt: "2026-08-15T08:00:00.000Z",
            },
            status: "ready",
          }),
      },
    ));
    const response = await app.request(
      `http://localhost/api/v1/people/${personId}`,
      { headers },
    );
    assertStatus(response, 200);
    return (await response.json() as {
      readonly person: { readonly avatar?: unknown };
    }).person.avatar;
  };
  const color = avatarColor(personId);

  assertEquals(await read({}), { color, hasStoredImage: false });
  assertEquals(
    await read({ hasStoredImage: true }),
    { color, hasStoredImage: true },
    "an image held for review is stored though it is not drawn",
  );
  assertEquals(await read({ fileId, hasStoredImage: true }), {
    color,
    hasStoredImage: true,
    imageUrl: `/api/v1/people/${personId}/files/${fileId}/content`,
  });
});
