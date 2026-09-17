import type {
  MemberUiState,
  MemberUiStateManagement,
  SettingsManagement,
} from "../../packages/backend/modules/workspaces/public.ts";
import { browserSecurityPolicy } from "./security_config.ts";
import { createSettingsRoutes, type SettingsHttpServices } from "./settings.ts";
import { assert, assertStatus } from "../../packages/backend/testing/assert.ts";
import * as fixtures from "../../packages/backend/testing/fixtures.ts";

const actor = fixtures.sessionActor({ role: "owner", workspaceName: "Circle" });

function settings(
  overrides: Partial<SettingsManagement> = {},
): SettingsManagement {
  const base: SettingsManagement = {
    getProfile: () =>
      Promise.resolve({
        email: "owner@example.test",
        firstName: "Owner",
        lastName: "Person",
      }),
    updateProfile: (_actor, input) =>
      Promise.resolve({
        profile: { email: "owner@example.test", ...input },
        status: "ready",
      }),
    getPreferences: () =>
      Promise.resolve({
        effectiveTimezone: "Europe/Belgrade",
        contactNameOrder: "given_family_nickname",
        contactSortOrder: "given_name_asc",
        fluidLayout: false,
        locale: "en",
        measurementSystem: "metric",
        temperatureScale: "celsius",
      }),
    updatePreferences: (_actor, input) =>
      Promise.resolve({
        preferences: {
          ...input,
          effectiveTimezone: input.timezone ?? "Europe/Belgrade",
        },
        status: "ready",
      }),
    listSessions: () =>
      Promise.resolve([{
        createdAt: new Date("2026-08-15T08:00:00Z"),
        current: true,
        expiresAt: new Date("2026-08-15T20:00:00Z"),
        id: "00000000-0000-4000-8000-000000000010",
        lastSeenAt: new Date("2026-08-15T10:00:00Z"),
      }]),
    revokeSession: () => Promise.resolve({ current: true, status: "revoked" }),
    getWorkspace: () =>
      Promise.resolve({
        defaultLocale: "en",
        defaultReminderTime: "12:00",
        name: "Circle",
      }),
    updateWorkspace: (_actor, input) => Promise.resolve(input),
    listMembers: () => Promise.resolve([]),
    updateMember: () => Promise.resolve("not-found"),
  };
  return { ...base, ...overrides };
}

function memberUiState(
  overrides: Partial<MemberUiStateManagement> = {},
): MemberUiStateManagement {
  return {
    read: () => Promise.resolve({ status: "ready", uiState: {} }),
    save: (_actor, input) =>
      Promise.resolve({ status: "ready", uiState: input }),
    ...overrides,
  };
}

function services(
  settingsService: SettingsManagement = settings(),
  memberUiStateService: MemberUiStateManagement = memberUiState(),
): SettingsHttpServices {
  return {
    browserSecurity: browserSecurityPolicy("test", "http://localhost"),
    memberUiState: memberUiStateService,
    personalization: {
      isSection: (value): value is "tags" => value === "tags",
      list: () =>
        Promise.resolve({
          capabilities: { create: true, editValue: false },
          entries: [],
          readOnly: false,
          status: "ready",
        }),
      mutate: () => Promise.resolve({ status: "not-found" }),
    },
    protectedSessions: {
      completeMfa: () => Promise.resolve({ status: "challenge-expired" }),
      establishVerifiedEntry: () =>
        Promise.resolve({ status: "membership-inactive" }),
      resolve: () => Promise.resolve(actor),
      signIn: () => Promise.resolve({ status: "invalid-credentials" }),
      signOut: () => Promise.resolve(),
    },
    settings: settingsService,
  };
}

const headers = {
  cookie: "kinship_session=current-token",
  "content-type": "application/json",
  origin: "http://localhost",
};

Deno.test("APR-009 member preference response exposes resolved timezone as read-only", async () => {
  const configuration = services();
  const app = createSettingsRoutes({
    ...configuration,
    protectedSessions: {
      ...configuration.protectedSessions,
      resolve: () => Promise.resolve({ ...actor, role: "member" }),
    },
  });
  const read = await app.request(
    "http://localhost/api/v1/settings/preferences",
    { headers },
  );
  const body = await read.json();
  assert(
    read.status === 200 &&
      body.preferences.effectiveTimezone === "Europe/Belgrade",
    "ordinary member receives resolved settings",
  );
  assert(
    !("timezone" in body.preferences),
    "inherited timezone remains unset in editable input",
  );
  const rejected = await app.request(
    "http://localhost/api/v1/settings/preferences",
    {
      headers,
      method: "PUT",
      body: JSON.stringify(body.preferences),
    },
  );
  assertStatus(rejected, 400, "read-only resolved field cannot be written");
  const { effectiveTimezone: _resolved, ...input } = body.preferences;
  const saved = await app.request(
    "http://localhost/api/v1/settings/preferences",
    {
      headers,
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  const savedBody = await saved.json();
  assert(
    saved.status === 200 &&
      savedBody.preferences.effectiveTimezone === "Europe/Belgrade" &&
      !("timezone" in savedBody.preferences),
    "saving editable fields preserves inheritance",
  );
});

Deno.test("UXD-002C3 HTTP reads and saves private member UI state", async () => {
  let current: MemberUiState = { personWorkspaceView: "timeline" };
  const app = createSettingsRoutes(services(
    settings(),
    memberUiState({
      read: () => Promise.resolve({ status: "ready", uiState: current }),
      save: (_actor, input) => {
        current = input;
        return Promise.resolve({ status: "ready", uiState: current });
      },
    }),
  ));

  const read = await app.request("http://localhost/api/v1/member/ui-state", {
    headers,
  });
  assertStatus(read, 200, "member UI state reads");
  assert(
    read.headers.get("cache-control") === "private, no-store",
    "member UI state read is private and uncached",
  );
  assert(
    (await read.json()).uiState.personWorkspaceView === "timeline",
    "read response exposes the recognised state",
  );

  const saved = await app.request(
    "http://localhost/api/v1/member/ui-state",
    {
      body: JSON.stringify({ personWorkspaceView: "admin" }),
      headers,
      method: "PATCH",
    },
  );
  assertStatus(saved, 200, "member UI state saves");
  assert(
    saved.headers.get("cache-control") === "private, no-store",
    "member UI state write is private and uncached",
  );
  assert(
    (await saved.json()).uiState.personWorkspaceView === "admin",
    "write response returns saved state",
  );

  const themed = await app.request(
    "http://localhost/api/v1/member/ui-state",
    {
      body: JSON.stringify({ theme: "dark" }),
      headers,
      method: "PATCH",
    },
  );
  assertStatus(themed, 200, "theme UI state saves");
  assert(
    (await themed.json()).uiState.theme === "dark",
    "theme write response returns saved state",
  );
});

Deno.test("UXD-002C3 HTTP validates and attributes every member UI-state problem", async () => {
  const invalid = await createSettingsRoutes(services()).request(
    "http://localhost/api/v1/member/ui-state",
    {
      body: JSON.stringify({
        personWorkspaceView: "timeline",
        recentPersonIds: [],
      }),
      headers,
      method: "PATCH",
    },
  );
  assertStatus(invalid, 400, "unknown body key is rejected");

  for (const body of [{}, { theme: "sepia" }] as const) {
    const rejected = await createSettingsRoutes(services()).request(
      "http://localhost/api/v1/member/ui-state",
      {
        body: JSON.stringify(body),
        headers,
        method: "PATCH",
      },
    );
    assertStatus(rejected, 400, "empty or invalid theme is rejected");
  }

  const unauthenticatedServices = services();
  const unauthenticated = await createSettingsRoutes({
    ...unauthenticatedServices,
    protectedSessions: {
      ...unauthenticatedServices.protectedSessions,
      resolve: () => Promise.resolve(undefined),
    },
  }).request("http://localhost/api/v1/member/ui-state", { headers });
  assertStatus(unauthenticated, 401, "missing actor is unauthenticated");

  const forbidden = await createSettingsRoutes(
    services(
      settings(),
      memberUiState({
        read: () => Promise.resolve({ status: "forbidden" }),
        save: () => Promise.resolve({ status: "forbidden" }),
      }),
    ),
  ).request("http://localhost/api/v1/member/ui-state", { headers });
  assertStatus(forbidden, 403, "facade denial is forbidden");

  const unavailable = await createSettingsRoutes(
    services(
      settings(),
      memberUiState({
        read: () => Promise.reject(new Error("private database detail")),
      }),
    ),
  ).request("http://localhost/api/v1/member/ui-state", { headers });
  assertStatus(unavailable, 503, "dependency failure is retryable");

  const badOrigin = await createSettingsRoutes(services()).request(
    "http://localhost/api/v1/member/ui-state",
    {
      body: JSON.stringify({ personWorkspaceView: "all" }),
      headers: { ...headers, origin: "https://attacker.test" },
      method: "PATCH",
    },
  );
  assertStatus(badOrigin, 403, "write requires the configured origin");

  const unresolvedServices = services();
  const unresolvedWrite = await createSettingsRoutes({
    ...unresolvedServices,
    protectedSessions: {
      ...unresolvedServices.protectedSessions,
      resolve: () => Promise.resolve(undefined),
    },
  }).request("http://localhost/api/v1/member/ui-state", {
    body: JSON.stringify({ personWorkspaceView: "all" }),
    headers,
    method: "PATCH",
  });
  assertStatus(unresolvedWrite, 401, "write requires an active actor");

  const forbiddenWrite = await createSettingsRoutes(
    services(
      settings(),
      memberUiState({
        save: () => Promise.resolve({ status: "forbidden" }),
      }),
    ),
  ).request("http://localhost/api/v1/member/ui-state", {
    body: JSON.stringify({ personWorkspaceView: "all" }),
    headers,
    method: "PATCH",
  });
  assertStatus(forbiddenWrite, 403, "write denial is forbidden");

  const unavailableWrite = await createSettingsRoutes(
    services(
      settings(),
      memberUiState({
        save: () => Promise.reject(new Error("private database detail")),
      }),
    ),
  ).request("http://localhost/api/v1/member/ui-state", {
    body: JSON.stringify({ personWorkspaceView: "all" }),
    headers,
    method: "PATCH",
  });
  assertStatus(unavailableWrite, 503, "write outage is retryable");

  for (
    const response of [
      invalid,
      unauthenticated,
      forbidden,
      unavailable,
      badOrigin,
      unresolvedWrite,
      forbiddenWrite,
      unavailableWrite,
    ]
  ) {
    const body = await response.json() as { readonly code?: string };
    assert(
      body.code?.startsWith("member_ui_state_") === true,
      `${response.status} problem is attributable`,
    );
  }
});

Deno.test("AUTH-004 HTTP lists ISO sessions and clears only a revoked current cookie", async () => {
  const app = createSettingsRoutes(services());
  const listed = await app.request(
    "http://localhost/api/v1/settings/sessions",
    {
      headers,
    },
  );
  const body = await listed.json() as {
    readonly sessions?: readonly { readonly createdAt?: string }[];
  };
  assertStatus(listed, 200, "owned sessions list");
  assert(
    body.sessions?.[0]?.createdAt === "2026-08-15T08:00:00.000Z",
    "dates are RFC3339",
  );
  const revoked = await app.request(
    "http://localhost/api/v1/settings/sessions/00000000-0000-4000-8000-000000000010",
    { method: "DELETE", headers },
  );
  assertStatus(revoked, 200, "current session revokes");
  assert(
    revoked.headers.get("set-cookie")?.includes("Max-Age=0"),
    "current credential clears",
  );
});

Deno.test("AUTH-004 HTTP preserves stale and forbidden session distinctions", async () => {
  for (
    const scenario of [
      { result: { status: "stale" as const }, expected: 404 },
      { result: { status: "forbidden" as const }, expected: 403 },
    ]
  ) {
    const app = createSettingsRoutes(services(settings({
      revokeSession: () => Promise.resolve(scenario.result),
    })));
    const response = await app.request(
      "http://localhost/api/v1/settings/sessions/00000000-0000-4000-8000-000000000010",
      { method: "DELETE", headers },
    );
    assert(response.status === scenario.expected, "exact session result maps");
    assert(
      response.headers.get("set-cookie") === null,
      "failed revocation retains credential",
    );
  }
});

Deno.test("WORKSPACE-001 HTTP enforces role outcomes, origin, and validation", async () => {
  const app = createSettingsRoutes(services(settings({
    getWorkspace: () => Promise.resolve("forbidden"),
    updateMember: () => Promise.resolve("last-owner"),
  })));
  const forbidden = await app.request(
    "http://localhost/api/v1/settings/workspace",
    { headers },
  );
  assertStatus(forbidden, 403, "member workspace access forbidden");
  const lastOwner = await app.request(
    "http://localhost/api/v1/settings/members/00000000-0000-4000-8000-000000000002",
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ role: "member", status: "active" }),
    },
  );
  assertStatus(lastOwner, 409, "last owner protected");
  const invalidOrigin = await app.request(
    "http://localhost/api/v1/settings/profile",
    {
      method: "PUT",
      headers: { ...headers, origin: "https://attacker.test" },
      body: JSON.stringify({ firstName: "Ada", lastName: "" }),
    },
  );
  assertStatus(invalidOrigin, 403, "mutations require exact origin");
  const invalidTimezone = await app.request(
    "http://localhost/api/v1/settings/preferences",
    {
      method: "PUT",
      headers,
      body: JSON.stringify({
        contactNameOrder: "given_family_nickname",
        contactSortOrder: "given_name_asc",
        fluidLayout: false,
        locale: "en",
        measurementSystem: "metric",
        temperatureScale: "celsius",
        timezone: "Not/AZone",
      }),
    },
  );
  assertStatus(invalidTimezone, 400, "invalid time zone rejected");
  const invalidTimezoneProblem = await invalidTimezone.json() as {
    readonly errors?: Readonly<Record<string, string>>;
  };
  assert(
    invalidTimezoneProblem.errors?.timezone ===
      "Enter a valid IANA time zone.",
    "invalid time zone identifies its responsible field",
  );

  const unsupported = createSettingsRoutes(services(settings({
    updatePreferences: () =>
      Promise.resolve({ status: "invalid-currency" as const }),
    updateWorkspace: () => Promise.resolve("invalid-currency" as const),
  })));
  for (
    const scenario of [
      {
        body: {
          contactNameOrder: "given_family_nickname",
          contactSortOrder: "given_name_asc",
          currencyCode: "ZZZ",
          fluidLayout: false,
          locale: "en",
          measurementSystem: "metric",
          temperatureScale: "celsius",
        },
        field: "currencyCode",
        path: "/api/v1/settings/preferences",
      },
      {
        body: {
          defaultCurrencyCode: "ZZZ",
          defaultLocale: "en",
          defaultReminderTime: "12:00",
          name: "Circle",
        },
        field: "defaultCurrencyCode",
        path: "/api/v1/settings/workspace",
      },
    ]
  ) {
    const response = await unsupported.request(
      `http://localhost${scenario.path}`,
      { method: "PUT", headers, body: JSON.stringify(scenario.body) },
    );
    const body = await response.json() as {
      readonly errors?: Readonly<Record<string, string>>;
    };
    assertStatus(response, 400, "unsupported currency is invalid input");
    assert(
      body.errors?.[scenario.field] === "Choose a supported currency.",
      "unsupported currency identifies its responsible field",
    );
  }
});

Deno.test("WORKSPACE-003 HTTP keeps personalization private and maps lifecycle outcomes", async () => {
  const base = services();
  const app = createSettingsRoutes({
    ...base,
    personalization: {
      isSection: (value): value is "tags" => value === "tags",
      list: () =>
        Promise.resolve({
          capabilities: { create: true, editValue: false },
          entries: [{
            capabilities: {
              delete: true,
              disable: false,
              editValue: false,
              rename: true,
              reorder: false,
              replace: true,
              setDefault: false,
            },
            canDelete: true,
            id: "00000000-0000-4000-8000-000000000020",
            isActive: true,
            isDefault: false,
            kind: "named",
            name: "Friends",
            readOnly: false,
            referenceCount: 2,
            sortOrder: 0,
            updatedAt: "2026-08-16T10:00:00.000Z",
          }],
          readOnly: false,
          status: "ready",
        }),
      mutate: () => Promise.resolve({ status: "conflict" }),
    },
  });
  const listed = await app.request(
    "http://localhost/api/v1/settings/personalization/tags",
    { headers },
  );
  assertStatus(listed, 200, "accepted section loads");
  assert(
    listed.headers.get("cache-control") === "private, no-store",
    "workspace vocabulary is never shared-cached",
  );
  const listedBody = await listed.json() as {
    readonly capabilities: {
      readonly create: boolean;
      readonly editValue: boolean;
    };
    readonly entries: readonly {
      readonly capabilities: { readonly editValue: boolean };
      readonly readOnly: boolean;
    }[];
    readonly readOnly: boolean;
  };
  assert(
    listedBody.capabilities.create && !listedBody.readOnly &&
      listedBody.entries.every((entry) =>
        !entry.readOnly && entry.capabilities.editValue === false
      ),
    "HTTP contract declares section and item capabilities",
  );
  const duplicate = await app.request(
    "http://localhost/api/v1/settings/personalization/tags",
    {
      body: JSON.stringify({ name: "Friends" }),
      headers,
      method: "POST",
    },
  );
  assertStatus(duplicate, 409, "duplicate name remains distinct");
  assert(
    (await duplicate.json()).code === "personalization_duplicate",
    "safe problem code is stable",
  );
  const collisionApp = createSettingsRoutes({
    ...base,
    personalization: {
      ...base.personalization,
      isSection: (value): value is "relationship-types" =>
        value === "relationship-types",
      list: () => Promise.resolve({ status: "forbidden" }),
      mutate: () => Promise.resolve({ status: "replacement-conflict" }),
    },
  });
  const collision = await collisionApp.request(
    "http://localhost/api/v1/settings/personalization/relationship-types/00000000-0000-4000-8000-000000000020?expectedUpdatedAt=2026-08-16T10%3A00%3A00.000Z&replacementId=00000000-0000-4000-8000-000000000021",
    { headers, method: "DELETE" },
  );
  assertStatus(collision, 409, "relationship replacement collision is stable");
  const collisionBody = await collision.json() as {
    readonly code: string;
    readonly detail: string;
  };
  assert(
    collisionBody.code === "personalization_replacement_conflict" &&
      collisionBody.detail.includes("both the source and replacement"),
    "collision response is actionable",
  );
  const unknown = await app.request(
    "http://localhost/api/v1/settings/personalization/not-a-section",
    { headers },
  );
  assertStatus(unknown, 404, "uncataloged section is not a route surface");
});

Deno.test("WORKSPACE-003 HTTP rejects fields unsupported by the selected section", async () => {
  let mutations = 0;
  const base = services();
  const app = createSettingsRoutes({
    ...base,
    personalization: {
      isSection: (value): value is
        | "gender-options"
        | "reminder-rules"
        | "relationship-types" =>
        value === "gender-options" || value === "reminder-rules" ||
        value === "relationship-types",
      list: () => Promise.resolve({ status: "forbidden" }),
      mutate: () => {
        mutations += 1;
        return Promise.resolve({ status: "conflict" });
      },
    },
  });
  const id = "00000000-0000-4000-8000-000000000020";
  const expectedUpdatedAt = "2026-08-16T10:00:00.000Z";
  const attempts = [
    {
      body: { expectedUpdatedAt, name: "Ignored", sortOrder: 4 },
      section: "reminder-rules",
    },
    {
      body: { expectedUpdatedAt, isDefault: true },
      section: "reminder-rules",
    },
    {
      body: { expectedUpdatedAt, name: "Generic relationship" },
      section: "relationship-types",
    },
    {
      body: { expectedUpdatedAt, isDefault: false },
      section: "gender-options",
    },
  ];
  for (const attempt of attempts) {
    const response = await app.request(
      `http://localhost/api/v1/settings/personalization/${attempt.section}/${id}`,
      {
        body: JSON.stringify(attempt.body),
        headers,
        method: "PATCH",
      },
    );
    assertStatus(response, 400, `${attempt.section} input is strict`);
  }
  assert(mutations === 0, "invalid section fields never enter the application");
});
