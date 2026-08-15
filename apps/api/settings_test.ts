import type { SettingsManagement } from "../../packages/backend/modules/workspaces/public.ts";
import { browserSecurityPolicy } from "./security_config.ts";
import { createSettingsRoutes, type SettingsHttpServices } from "./settings.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const actor = {
  accessibleWorkspaces: [],
  memberId: "00000000-0000-4000-8000-000000000002",
  role: "owner" as const,
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000003",
  workspaceName: "Circle",
};

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
        contactNameOrder: "given_family_nickname",
        contactSortOrder: "given_name_asc",
        fluidLayout: false,
        locale: "en",
        measurementSystem: "metric",
        temperatureScale: "celsius",
      }),
    updatePreferences: (_actor, input) =>
      Promise.resolve({ preferences: input, status: "ready" }),
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

function services(
  settingsService: SettingsManagement = settings(),
): SettingsHttpServices {
  return {
    browserSecurity: browserSecurityPolicy("test", "http://localhost"),
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
  assert(listed.status === 200, "owned sessions list");
  assert(
    body.sessions?.[0]?.createdAt === "2026-08-15T08:00:00.000Z",
    "dates are RFC3339",
  );
  const revoked = await app.request(
    "http://localhost/api/v1/settings/sessions/00000000-0000-4000-8000-000000000010",
    { method: "DELETE", headers },
  );
  assert(revoked.status === 200, "current session revokes");
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
  assert(forbidden.status === 403, "member workspace access forbidden");
  const lastOwner = await app.request(
    "http://localhost/api/v1/settings/members/00000000-0000-4000-8000-000000000002",
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ role: "member", status: "active" }),
    },
  );
  assert(lastOwner.status === 409, "last owner protected");
  const invalidOrigin = await app.request(
    "http://localhost/api/v1/settings/profile",
    {
      method: "PUT",
      headers: { ...headers, origin: "https://attacker.test" },
      body: JSON.stringify({ firstName: "Ada", lastName: "" }),
    },
  );
  assert(invalidOrigin.status === 403, "mutations require exact origin");
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
  assert(invalidTimezone.status === 400, "invalid time zone rejected");
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
    assert(response.status === 400, "unsupported currency is invalid input");
    assert(
      body.errors?.[scenario.field] === "Choose a supported currency.",
      "unsupported currency identifies its responsible field",
    );
  }
});
