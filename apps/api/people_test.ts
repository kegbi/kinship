import { type ApiServices, createApiApp } from "./composition.ts";
import type {
  ImportantDateManagement,
  PeopleManagement,
  PersonLifecycle,
  ProfileFactManagement,
} from "../../packages/backend/modules/people/public.ts";
import type { RecentPeopleManagement } from "../../packages/backend/modules/workspaces/public.ts";
import { createPeopleDirectory } from "../../packages/backend/read-models/people-directory/public.ts";
import { createPeopleRoutes, type PeopleHttpServices } from "./people.ts";
import type { TodayRecentPeople } from "../../packages/backend/read-models/today/public.ts";

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
      listLifeEvents: () => Promise.reject(new Error("must not be called")),
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
  profile: Partial<PeopleHttpServices["profile"]> = {},
  importantDates?: ImportantDateManagement,
  profileFacts?: ProfileFactManagement,
  recentPeople?: RecentPeopleManagement,
  todayRecentPeople?: TodayRecentPeople,
): PeopleHttpServices {
  return {
    browserSecurity: {
      origin: "http://localhost",
      secureCookie: false,
    },
    directory,
    ...(importantDates ? { importantDates } : {}),
    ...(profileFacts ? { profileFacts } : {}),
    ...(recentPeople ? { recentPeople } : {}),
    people: {
      archive: () => Promise.reject(new Error("must not archive")),
      delete: () => Promise.reject(new Error("must not delete")),
      edit: () => Promise.reject(new Error("must not edit")),
      get: () => Promise.resolve({ status: "not-found" }),
      previewDeletion: () => Promise.reject(new Error("must not preview")),
      restore: () => Promise.reject(new Error("must not restore")),
      ...people,
    },
    profile: {
      get: () => Promise.resolve({ status: "not-found" }),
      listLifeEvents: () => Promise.resolve({ status: "not-found" }),
      ...profile,
    },
    protectedSessions: { resolve: () => Promise.resolve(actor) },
    tagOptions,
    ...(todayRecentPeople ? { todayRecentPeople } : {}),
  };
}

function todayRoutes(overrides: Partial<PeopleHttpServices>) {
  const base = services({ create: () => Promise.reject(new Error("unused")) });
  return createPeopleRoutes({ ...base, ...overrides });
}

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
  assert(
    mutation.status === 401,
    "bearer cannot reuse browser mutation boundary",
  );
});

Deno.test("PEOPLE-006 HTTP refreshes one strict profile-fact section", async () => {
  const personId = "00000000-0000-4000-8000-000000000100";
  const factId = "00000000-0000-4000-8000-000000000200";
  const record = {
    id: factId,
    section: "contact-methods" as const,
    updatedAt: "2026-08-16T12:00:00.000000Z",
    value: {
      isPrimary: true,
      labelIds: [] as readonly string[],
      typeId: "00000000-0000-4000-8000-000000000300",
      value: "ada@example.test",
    },
  };
  let savedPersonId = "";
  const listInputs: unknown[] = [];
  const save: ProfileFactManagement["create"] = (
    _actor,
    receivedPersonId,
    section,
    input,
  ) => {
    savedPersonId = receivedPersonId;
    if (section === "work" && "endOn" in input) {
      return Promise.resolve({
        errors: {
          endOn: "End date must be on or after the start date.",
        },
        status: "validation-error" as const,
      });
    }
    return Promise.resolve({
      personUpdatedAt: "2026-08-16T12:00:00.000001Z",
      record,
      status: "saved",
    });
  };
  const profileFacts: ProfileFactManagement = {
    create: save,
    delete: () =>
      Promise.resolve({
        factId,
        personUpdatedAt: "2026-08-16T12:00:00.000001Z",
        status: "deleted",
      }),
    list: (_actor, _personId, _section, input) => {
      const receivedInput = input ?? {};
      listInputs.push(receivedInput);
      if (
        receivedInput.cursor === "forged-fact" ||
        receivedInput.optionCursor === "forged-option"
      ) {
        return Promise.resolve({ status: "stale-cursor" as const });
      }
      return Promise.resolve({
        options: [],
        personUpdatedAt: "2026-08-16T12:00:00.000000Z",
        records: [record],
        status: "ready",
      });
    },
    update: save,
  };
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create person")) },
    undefined,
    undefined,
    undefined,
    undefined,
    profileFacts,
  ));
  const listed = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods`,
    { headers },
  );
  const listedBody = await listed.clone().json() as {
    readonly records?: readonly {
      readonly value?: { readonly section?: string };
    }[];
  };
  assert(
    listed.status === 200 &&
      listedBody.records?.[0]?.value?.section === "contact-methods",
    "section read is available with a discriminated value",
  );
  const falseOptions = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods?includeOptions=false`,
    { headers },
  );
  assert(
    falseOptions.status === 400,
    "includeOptions rejects every value except the literal true semantic",
  );
  const beforeMissingInclude = listInputs.length;
  for (const cursor of ["valid-looking", "stale", "forged-option"]) {
    const missingInclude = await app.request(
      `http://localhost/api/v1/people/${personId}/facts/contact-methods?optionCursor=${cursor}`,
      { headers },
    );
    assert(
      missingInclude.status === 400,
      "option cursors require the explicit options continuation mode",
    );
  }
  assert(
    listInputs.length === beforeMissingInclude,
    "invalid option cursor combinations stop before the people facade",
  );
  const forgedFactCursor = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods?cursor=forged-fact`,
    { headers },
  );
  const forgedOptionCursor = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods?includeOptions=true&optionSearch=Email&optionCursor=forged-option`,
    { headers },
  );
  assert(
    forgedFactCursor.status === 409 && forgedOptionCursor.status === 409 &&
      JSON.stringify(listInputs.at(-1)) === JSON.stringify({
          includeOptions: true,
          optionCursor: "forged-option",
          optionSearch: "Email",
        }),
    "opaque fact and option cursors are passed through and stale cursors map to 409",
  );
  const saved = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods`,
    {
      body: JSON.stringify({
        ...record.value,
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        section: "contact-methods",
      }),
      headers,
      method: "POST",
    },
  );
  assert(
    saved.status === 200 && savedPersonId === personId,
    "strict local save reaches the resolved person",
  );
  const createWithId = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods`,
    {
      body: JSON.stringify({
        ...record.value,
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        id: factId,
        section: "contact-methods",
      }),
      headers,
      method: "POST",
    },
  );
  const incompleteUpdate = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods/${factId}`,
    {
      body: JSON.stringify({
        ...record.value,
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        section: "contact-methods",
      }),
      headers,
      method: "PUT",
    },
  );
  const updated = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods/${factId}`,
    {
      body: JSON.stringify({
        ...record.value,
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        expectedUpdatedAt: record.updatedAt,
        id: factId,
        section: "contact-methods",
      }),
      headers,
      method: "PUT",
    },
  );
  assert(
    createWithId.status === 400 && incompleteUpdate.status === 400 &&
      updated.status === 200,
    "create forbids IDs while item update requires matching ID and revision",
  );
  for (
    const [section, value] of [
      ["addresses", { city: "London", isPrimary: false, labelIds: [] }],
      ["first-meeting", { notes: "Met at a salon" }],
      ["food-preferences", { foodPreferences: "Tea" }],
      ["pets", { name: "Byron" }],
      ["tags", { tagIds: [] }],
      ["work", { isCurrent: true, title: "Engineer" }],
    ] as const
  ) {
    const body = {
      ...value,
      expectedPersonUpdatedAt: record.updatedAt,
      expectedUpdatedAt: record.updatedAt,
      id: factId,
      section,
    };
    const createRejected = await app.request(
      `http://localhost/api/v1/people/${personId}/facts/${section}`,
      { body: JSON.stringify(body), headers, method: "POST" },
    );
    const updateAccepted = await app.request(
      `http://localhost/api/v1/people/${personId}/facts/${section}/${factId}`,
      { body: JSON.stringify(body), headers, method: "PUT" },
    );
    assert(
      createRejected.status === 400 && updateAccepted.status === 200,
      `${section} keeps create and update transport identities separate`,
    );
  }
  const extra = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/contact-methods`,
    {
      body: JSON.stringify({
        ...record.value,
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        section: "contact-methods",
        workspaceId: actor.workspaceId,
      }),
      headers,
      method: "POST",
    },
  );
  assert(extra.status === 400, "route rejects undeclared workspace evidence");
  for (
    const [section, value] of [
      ["addresses", { isPrimary: false, labelIds: [] }],
      ["first-meeting", {}],
      ["food-preferences", {}],
      ["pets", { notes: "Notes alone are not a pet identity" }],
    ] as const
  ) {
    const rejected = await app.request(
      `http://localhost/api/v1/people/${personId}/facts/${section}`,
      {
        body: JSON.stringify({
          ...value,
          expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
          section,
        }),
        headers,
        method: "POST",
      },
    );
    assert(rejected.status === 400, `${section} rejects an empty fact`);
  }
  for (
    const invalid of [
      {},
      {
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        foodPreferences: "Tea",
        isPrimary: true,
        labelIds: [],
        typeId: "00000000-0000-4000-8000-000000000300",
        value: "ada@example.test",
      },
      {
        city: "London",
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        isPrimary: false,
        labelIds: [],
        section: "addresses",
      },
    ]
  ) {
    const rejected = await app.request(
      `http://localhost/api/v1/people/${personId}/facts/contact-methods`,
      { body: JSON.stringify(invalid), headers, method: "POST" },
    );
    assert(rejected.status === 400, "empty and cross-section inputs fail");
  }
  const invalidRange = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/work`,
    {
      body: JSON.stringify({
        endOn: "2025-12-31",
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        isCurrent: false,
        section: "work",
        startOn: "2026-01-01",
        title: "Engineer",
      }),
      headers,
      method: "POST",
    },
  );
  const rangeProblem = await invalidRange.json() as {
    readonly errors?: Readonly<Record<string, string>>;
  };
  assert(
    invalidRange.status === 400 && rangeProblem.errors?.endOn,
    "work range failures remain field-level 400 responses",
  );
  const clearedFood = await app.request(
    `http://localhost/api/v1/people/${personId}/facts/food-preferences/${personId}`,
    {
      body: JSON.stringify({
        expectedPersonUpdatedAt: record.updatedAt,
        expectedUpdatedAt: record.updatedAt,
        section: "food-preferences",
      }),
      headers,
      method: "DELETE",
    },
  );
  assert(
    clearedFood.status === 200,
    "food preferences expose an explicit clear command",
  );
});

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
  assert(
    mismatch.status === 409,
    "opaque continuation rejects a changed excluded-person criterion",
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
  const personId = "00000000-0000-4000-8000-000000000100";
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

  assert(response.status === 200, "person workspace summary is readable");
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

Deno.test("[PEOPLE-003] HTTP reads person life events through the profile projection", async () => {
  const personId = "00000000-0000-4000-8000-000000000100";
  let received: unknown;
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      listLifeEvents: (resolved, id) => {
        received = [resolved, id];
        return Promise.resolve({
          events: [{
            date: { month: 12, precision: "year_month", year: 1843 },
            id: "00000000-0000-4000-8000-000000000200",
            name: "Published Notes",
          }],
          status: "ready",
        });
      },
    },
  ));

  const response = await app.request(
    `http://localhost/api/v1/people/${personId}/life-events`,
    { headers },
  );
  const body = await response.json() as {
    readonly events?: readonly { readonly name?: string }[];
  };

  assert(
    response.status === 200 && body.events?.[0]?.name === "Published Notes",
    "person-linked journal history remains readable on the canonical profile",
  );
  assert(
    (received as [typeof actor, string])[0].workspaceId === actor.workspaceId &&
      (received as [typeof actor, string])[1] === personId,
    "resolved tenant context reaches only the approved profile read model",
  );
  assert(
    response.headers.get("cache-control") === "private, no-store",
    "life-event history is never publicly cacheable",
  );
});

Deno.test("[PEOPLE-003] HTTP isolates life-event section failures", async () => {
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
      {
        listLifeEvents: () => Promise.resolve({ status: scenario.status }),
      },
    ));
    const response = await app.request(
      `http://localhost/api/v1/people/${personId}/life-events`,
      { headers },
    );
    assert(
      response.status === scenario.expected &&
        response.headers.get("content-type") === "application/problem+json",
      `${scenario.status} life-event result maps without profile disclosure`,
    );
  }
  const unavailable = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      listLifeEvents: () =>
        Promise.reject(new Error("private database detail")),
    },
  ));
  const outage = await unavailable.request(
    `http://localhost/api/v1/people/${personId}/life-events`,
    { headers },
  );
  assert(
    outage.status === 503 &&
      !(await outage.text()).includes("private database detail"),
    "life-event dependency failure is local and conceals internals",
  );
  const invalid = await unavailable.request(
    "http://localhost/api/v1/people/not-a-person/life-events",
    { headers },
  );
  assert(invalid.status === 400, "invalid life-event person ID is rejected");
});

Deno.test("[PEOPLE-003] HTTP returns the non-disclosing hidden life-event projection", async () => {
  const personId = "00000000-0000-4000-8000-000000000100";
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create")) },
    undefined,
    undefined,
    {
      listLifeEvents: () => Promise.resolve({ events: [], status: "hidden" }),
    },
  ));

  const response = await app.request(
    `http://localhost/api/v1/people/${personId}/life-events`,
    { headers },
  );
  const body = await response.json() as {
    readonly events?: readonly unknown[];
    readonly status?: string;
  };
  assert(
    response.status === 200 && body.status === "hidden" &&
      body.events?.length === 0,
    "hidden life-event history must disclose neither retained rows nor failure",
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

Deno.test("TODAY-001 HTTP records a resolved profile view only through explicit origin POST", async () => {
  const personId = "00000000-0000-4000-8000-000000000100";
  const effects: string[] = [];
  const app = todayRoutes({
    profile: {
      get(resolved, id) {
        effects.push(`profile:${resolved.workspaceId}:${id}`);
        return Promise.resolve({ status: "ready" } as never);
      },
      listLifeEvents: () => Promise.reject(new Error("must not list history")),
    },
    recentPeople: {
      record(resolved, id) {
        effects.push(`workspace:${resolved.workspaceId}:${id}`);
        return Promise.resolve({ status: "recorded" });
      },
    },
  });
  const missingOrigin = await app.request(
    `http://localhost/api/v1/people/${personId}/view`,
    { headers: { Cookie: "kinship_session=token" }, method: "POST" },
  );
  assert(
    missingOrigin.status === 403 && effects.length === 0,
    "origin denial reached use case",
  );

  const malformedBody = await app.request(
    `http://localhost/api/v1/people/${personId}/view`,
    { body: "{}", headers, method: "POST" },
  );
  assert(
    malformedBody.status === 400 && effects.length === 0,
    "no-body contract was not strict",
  );

  const response = await app.request(
    `http://localhost/api/v1/people/${personId}/view`,
    { headers, method: "POST" },
  );
  assert(
    response.status === 200 &&
      (await response.json() as { readonly status: string }).status ===
        "recorded",
    "profile view was not accepted without a body",
  );
  assert(
    effects.join(",") ===
      `profile:${actor.workspaceId}:${personId},workspace:${actor.workspaceId}:${personId}`,
    "profile tenant resolution did not precede the owning workspaces write",
  );
  assert(
    response.headers.get("cache-control") === "private, no-store",
    "write response was cacheable",
  );
});

Deno.test("TODAY-001 HTTP returns bounded recent people and safe failure states", async () => {
  const recent = [{
    archived: true,
    id: "00000000-0000-4000-8000-000000000100",
    name: "Ada Lovelace",
  }];
  const ready = todayRoutes({
    todayRecentPeople: {
      get: () => Promise.resolve({ people: recent, status: "ready" }),
    },
  });
  const response = await ready.request(
    "http://localhost/api/v1/today/recent-people",
    { headers },
  );
  const body = await response.json() as { readonly people: readonly unknown[] };
  assert(
    response.status === 200 && body.people.length === 1,
    "recent people response missing",
  );
  assert(
    response.headers.get("cache-control") === "private, no-store",
    "recent people was cacheable",
  );

  for (
    const scenario of [
      {
        expected: 403,
        get: () => Promise.resolve({ status: "forbidden" as const }),
      },
      { expected: 503, get: () => Promise.reject(new Error("private detail")) },
    ]
  ) {
    const app = todayRoutes({ todayRecentPeople: { get: scenario.get } });
    const failed = await app.request(
      "http://localhost/api/v1/today/recent-people",
      { headers },
    );
    assert(
      failed.status === scenario.expected,
      "recent people failure mapped unsafely",
    );
    assert(
      !(await failed.text()).includes("private detail"),
      "dependency detail leaked",
    );
  }
});
