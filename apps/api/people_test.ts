import { type ApiServices, createApiApp } from "./composition.ts";
import type {
  ImportantDateManagement,
  PeopleManagement,
  PersonLifecycle,
} from "../../packages/backend/modules/people/public.ts";
import { createPeopleDirectory } from "../../packages/backend/read-models/people-directory/public.ts";
import { createPeopleRoutes, type PeopleHttpServices } from "./people.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("PEOPLE-001 person creation requires an active session", async () => {
  const app = createApiApp({
    browserSecurity: {
      origin: "http://localhost",
      secureCookie: false,
    },
    directory: {
      list: () => Promise.reject(new Error("must not be called")),
    },
    tagOptions: {
      list: () => Promise.reject(new Error("must not be called")),
    },
    people: {
      archive: () => Promise.reject(new Error("must not be called")),
      create: () => Promise.reject(new Error("must not be called")),
      delete: () => Promise.reject(new Error("must not be called")),
      edit: () => Promise.reject(new Error("must not be called")),
      previewDeletion: () => Promise.reject(new Error("must not be called")),
      restore: () => Promise.reject(new Error("must not be called")),
    },
    profile: {
      get: () => Promise.reject(new Error("must not be called")),
    },
    protectedSessions: {
      resolve: () => Promise.resolve(undefined),
    },
  } as unknown as ApiServices);

  const response = await app.request("http://localhost/api/v1/people", {
    body: JSON.stringify({ givenName: "Ada", isPartial: false }),
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    method: "POST",
  });

  assert(
    response.status === 401,
    `expected protected route status 401, received ${response.status}`,
  );
});

const actor = {
  accessibleWorkspaces: [],
  memberId: "00000000-0000-4000-8000-000000000002",
  role: "member" as const,
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000003",
  workspaceName: "Circle",
};

function services(
  people:
    & Pick<PeopleManagement, "create">
    & Partial<PeopleManagement>
    & Partial<PersonLifecycle>,
  directory: PeopleHttpServices["directory"] = {
    list: () =>
      Promise.resolve({
        people: [],
        status: "ready",
      }),
  },
  tagOptions: PeopleHttpServices["tagOptions"] = {
    list: () => Promise.resolve({ options: [], status: "ready" }),
  },
  profile: PeopleHttpServices["profile"] = {
    get: () => Promise.resolve({ status: "not-found" }),
  },
  importantDates?: ImportantDateManagement,
): PeopleHttpServices {
  return {
    browserSecurity: {
      origin: "http://localhost",
      secureCookie: false,
    },
    directory,
    ...(importantDates ? { importantDates } : {}),
    people: {
      archive: () => Promise.reject(new Error("must not archive")),
      delete: () => Promise.reject(new Error("must not delete")),
      edit: () => Promise.reject(new Error("must not edit")),
      get: () => Promise.resolve({ status: "not-found" }),
      previewDeletion: () => Promise.reject(new Error("must not preview")),
      restore: () => Promise.reject(new Error("must not restore")),
      ...people,
    },
    profile,
    protectedSessions: { resolve: () => Promise.resolve(actor) },
    tagOptions,
  };
}

Deno.test("PEOPLE-005 HTTP preserves precision across list, create, update, and delete", async () => {
  const personId = "00000000-0000-4000-8000-000000000100";
  const date = {
    createdAt: "2026-08-15T12:00:00.000000Z",
    id: "00000000-0000-4000-8000-000000000200",
    isAgeBased: true,
    isYearApproximate: true,
    kind: "birthday" as const,
    personId,
    precision: "year" as const,
    scheduling: "not-schedulable" as const,
    updatedAt: "2026-08-15T12:00:00.000000Z",
    year: 1984,
  };
  let createdInput: unknown;
  const importantDates: ImportantDateManagement = {
    create: (_actor, _personId, input) => {
      createdInput = input;
      return Promise.resolve({ date, status: "created" });
    },
    delete: () => Promise.resolve({ dateId: date.id, status: "deleted" }),
    list: () => Promise.resolve({ dates: [date], status: "ready" }),
    update: (_actor, _personId, _dateId, input) =>
      Promise.resolve({
        date: { ...date, ...input, scheduling: "not-schedulable" },
        status: "updated",
      }),
  };
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create person")) },
    undefined,
    undefined,
    undefined,
    importantDates,
  ));
  const listed = await app.request(
    `http://localhost/api/v1/people/${personId}/dates`,
    { headers },
  );
  assert(
    listed.status === 200 &&
      (await listed.json() as { dates: typeof date[] }).dates[0]
          ?.isYearApproximate === true,
    "list keeps approximation explicit",
  );
  const body = JSON.stringify({
    isAgeBased: true,
    isYearApproximate: true,
    kind: "birthday",
    precision: "year",
    year: 1984,
  });
  const created = await app.request(
    `http://localhost/api/v1/people/${personId}/dates`,
    { body, headers, method: "POST" },
  );
  assert(created.status === 201, "create route is ready");
  assert(
    (createdInput as { year?: number; month?: number }).year === 1984 &&
      !("month" in (createdInput as object)),
    "transport does not invent missing components",
  );
  const updated = await app.request(
    `http://localhost/api/v1/people/${personId}/dates/${date.id}`,
    {
      body: JSON.stringify({
        ...JSON.parse(body),
        expectedUpdatedAt: date.updatedAt,
      }),
      headers,
      method: "PATCH",
    },
  );
  assert(updated.status === 200, "update route is ready");
  const deleted = await app.request(
    `http://localhost/api/v1/people/${personId}/dates/${date.id}`,
    {
      body: JSON.stringify({ expectedUpdatedAt: date.updatedAt }),
      headers,
      method: "DELETE",
    },
  );
  assert(deleted.status === 200, "delete route is ready");
});

Deno.test("PEOPLE-005 HTTP maps invalid precision, conflicts, stale versions, and tenancy safely", async () => {
  const personId = "00000000-0000-4000-8000-000000000100";
  let calls = 0;
  const base: ImportantDateManagement = {
    create: () => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? {
            errors: { month: "Remove month; it contradicts year precision." },
            status: "validation-error",
          }
          : { status: "conflict" },
      );
    },
    delete: () => Promise.resolve({ status: "stale" }),
    list: () => Promise.resolve({ status: "not-found" }),
    update: () => Promise.resolve({ status: "forbidden" }),
  };
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create person")) },
    undefined,
    undefined,
    undefined,
    base,
  ));
  const invalid = await app.request(
    `http://localhost/api/v1/people/${personId}/dates`,
    {
      body: JSON.stringify({
        isAgeBased: false,
        isYearApproximate: false,
        kind: "birthday",
        month: 2,
        precision: "year",
        year: 2020,
      }),
      headers,
      method: "POST",
    },
  );
  assert(invalid.status === 400 && calls === 1, "domain shape error is safe");
  const conflict = await app.request(
    `http://localhost/api/v1/people/${personId}/dates`,
    {
      body: JSON.stringify({
        isAgeBased: false,
        isYearApproximate: false,
        kind: "birthday",
        precision: "unknown",
      }),
      headers,
      method: "POST",
    },
  );
  assert(conflict.status === 409, "singleton conflict is explicit");
  const concealed = await app.request(
    `http://localhost/api/v1/people/${personId}/dates`,
    { headers },
  );
  assert(concealed.status === 404, "cross-workspace person is concealed");
});

const headers = {
  cookie: "kinship_session=current-token",
  "content-type": "application/json",
  origin: "http://localhost",
  "X-Workspace-Id": actor.workspaceId,
};

Deno.test("PEOPLE-002 HTTP lists only the resolved active workspace", async () => {
  let received: unknown;
  const personTags = Array.from({ length: 8 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 200).padStart(12, "0")}`,
    name: `Tag ${index + 1}`,
  }));
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    createPeopleDirectory({
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
  assert(response.status === 200, "directory response is ready");
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
});

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
  assert(outage.status === 503, "tag option outage is retryable");
  assert(
    !(await outage.text()).includes("private tag query detail"),
    "tag option dependency detail stays private",
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
  assert(outage.status === 503, "dependency outage is retryable");
  assert(
    !(await outage.text()).includes("private database detail"),
    "dependency detail stays private",
  );
});

Deno.test("PEOPLE-002 HTTP distinguishes an archived canonical identity", async () => {
  const personId = "00000000-0000-4000-8000-000000000100";
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      get: () =>
        Promise.resolve({
          dueInformation: {
            detail: "Planning unavailable.",
            status: "unavailable",
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
  const personId = "00000000-0000-4000-8000-000000000100";
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      get: () =>
        Promise.resolve({
          dueInformation: {
            detail: "Due information will become available with planning.",
            status: "unavailable",
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

  assert(response.status === 200, "person workspace summary is readable");
  assert(
    body.person?.description === "Mathematician and correspondent." &&
      body.person.isStarred === true && body.person.isDeceased === true,
    "identity orientation fields remain in the profile response",
  );
  assert(
    body.dueInformation?.status === "unavailable",
    "the shell reports its not-yet-delivered due projection honestly",
  );
});

Deno.test("PEOPLE-001 HTTP creates in only the resolved active workspace", async () => {
  let received: Parameters<PeopleManagement["create"]> | undefined;
  const app = createPeopleRoutes(services({
    create: (resolved, input) => {
      received = [resolved, input];
      return Promise.resolve({
        person: {
          familyName: "Lovelace",
          givenName: "Ada",
          id: "00000000-0000-4000-8000-000000000100",
          isPartial: false,
        },
        status: "created",
      });
    },
  }));
  const response = await app.request("http://localhost/api/v1/people", {
    body: JSON.stringify({
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    }),
    headers,
    method: "POST",
  });
  const body = await response.json() as { readonly next: string };
  assert(response.status === 201, "created response");
  assert(
    body.next === "/app/people/00000000-0000-4000-8000-000000000100",
    "canonical next route returned",
  );
  assert(
    received?.[0].workspaceId === actor.workspaceId &&
      received?.[1].givenName === "Ada",
    "body workspace is never authorization evidence",
  );
  assert(
    response.headers.get("cache-control") === "private, no-store",
    "person response is private",
  );
});

Deno.test("PEOPLE-001 HTTP reads canonical identity only in the resolved workspace", async () => {
  const personId = "00000000-0000-4000-8000-000000000100";
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
            detail: "Planning unavailable.",
            status: "unavailable",
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
  assert(response.status === 200, "canonical person identity is readable");
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
  const personId = "00000000-0000-4000-8000-000000000100";
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
  assert(unavailableResponse.status === 503, "read dependency failure retries");
  assert(
    !(await unavailableResponse.text()).includes("private dependency detail"),
    "read dependency detail stays private",
  );

  const malformed = await unavailable.request(
    "http://localhost/api/v1/people/not-a-uuid",
    { headers },
  );
  assert(malformed.status === 400, "malformed canonical ID is rejected");
});

Deno.test("PEOPLE-001 HTTP maps validation, duplicate, denial, and dependency outcomes", async () => {
  for (
    const scenario of [
      {
        result: {
          errors: { isPartial: "Mark partial." },
          status: "validation-error" as const,
        },
        expected: 400,
      },
      {
        result: {
          duplicates: [{
            displayName: "Ada Lovelace",
            id: "00000000-0000-4000-8000-000000000099",
          }],
          status: "possible-duplicate" as const,
        },
        expected: 409,
      },
      { result: { status: "forbidden" as const }, expected: 403 },
    ]
  ) {
    const app = createPeopleRoutes(services({
      create: () => Promise.resolve(scenario.result),
    }));
    const response = await app.request("http://localhost/api/v1/people", {
      body: JSON.stringify({ givenName: "Ada", isPartial: false }),
      headers,
      method: "POST",
    });
    assert(response.status === scenario.expected, "application result maps");
    assert(
      response.headers.get("content-type") === "application/problem+json",
      "non-success uses problem details",
    );
  }

  const unavailable = createPeopleRoutes(services({
    create: () => Promise.reject(new Error("private dependency detail")),
  }));
  const response = await unavailable.request(
    "http://localhost/api/v1/people",
    {
      body: JSON.stringify({ givenName: "Ada", isPartial: false }),
      headers,
      method: "POST",
    },
  );
  assert(response.status === 503, "dependency failure is safe and retryable");
  assert(
    !(await response.text()).includes("private dependency detail"),
    "safe problem",
  );
});

Deno.test("PEOPLE-001 HTTP rejects forged origin and malformed identity before use case", async () => {
  let calls = 0;
  const app = createPeopleRoutes(services({
    create: () => {
      calls += 1;
      return Promise.resolve({ status: "forbidden" });
    },
  }));
  const forged = await app.request("http://localhost/api/v1/people", {
    body: JSON.stringify({ givenName: "Ada", isPartial: false }),
    headers: { ...headers, origin: "https://attacker.invalid" },
    method: "POST",
  });
  const malformed = await app.request("http://localhost/api/v1/people", {
    body: JSON.stringify({
      givenName: "Ada",
      isPartial: false,
      workspaceId: actor.workspaceId,
    }),
    headers,
    method: "POST",
  });
  assert(forged.status === 403, "exact origin required");
  assert(malformed.status === 400, "unknown body fields rejected");
  assert(calls === 0, "invalid requests do not invoke application behavior");
});

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
  assert(edit.status === 200, "edit route is ready");
  for (const action of ["archive", "restore"] as const) {
    const response = await app.request(
      `http://localhost/api/v1/people/${person.id}/${action}`,
      {
        body: JSON.stringify({ expectedUpdatedAt: person.updatedAt }),
        headers,
        method: "POST",
      },
    );
    assert(response.status === 200, `${action} route is ready`);
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
  assert(deleted.status === 200, "confirmed deletion route is ready");
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
