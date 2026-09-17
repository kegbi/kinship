/**
 * The settings surface as one mounted whole.
 *
 * The role, origin, and validation test spans the workspace, member, profile,
 * and preference concerns at once, so it belongs to the mount rather than to
 * any one of them. The registration order is pinned beside it: no two
 * settings paths overlap, and this suite is what would notice if one started
 * to.
 */

import { createSettingsRoutes } from "../settings.ts";
import {
  assert,
  assertEquals,
  assertStatus,
} from "../../../packages/backend/testing/assert.ts";
import { headers, services, settings } from "./settings.test-helper.ts";

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
  // The rule that decides this lives in the settings use case (GAP-020); the
  // route's job is to turn its refusal back into the field the form marks.
  const unschedulable = createSettingsRoutes(services(settings({
    updatePreferences: () =>
      Promise.resolve({ status: "invalid-timezone" as const }),
    updateWorkspace: () => Promise.resolve("invalid-timezone" as const),
  })));
  const invalidTimezone = await unschedulable.request(
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
  const invalidWorkspaceTimezone = await unschedulable.request(
    "http://localhost/api/v1/settings/workspace",
    {
      method: "PUT",
      headers,
      body: JSON.stringify({
        defaultLocale: "en",
        defaultReminderTime: "12:00",
        defaultTimezone: "Not/AZone",
        name: "Circle",
      }),
    },
  );
  assertStatus(invalidWorkspaceTimezone, 400, "invalid default zone rejected");
  const workspaceTimezoneProblem = await invalidWorkspaceTimezone.json() as {
    readonly errors?: Readonly<Record<string, string>>;
  };
  assert(
    workspaceTimezoneProblem.errors?.defaultTimezone ===
      "Enter a valid IANA time zone.",
    "an invalid workspace default names its own field",
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

Deno.test("[GAP-021] the mounted settings concerns register every route in order", () => {
  assertEquals(
    mounted(createSettingsRoutes(services())).join("\n"),
    [
      "GET /api/v1/member/ui-state",
      "PATCH /api/v1/member/ui-state",
      "GET /api/v1/settings/profile",
      "PUT /api/v1/settings/profile",
      "GET /api/v1/settings/preferences",
      "PUT /api/v1/settings/preferences",
      "GET /api/v1/settings/sessions",
      "DELETE /api/v1/settings/sessions/:sessionId",
      "GET /api/v1/settings/workspace",
      "PUT /api/v1/settings/workspace",
      "GET /api/v1/settings/members",
      "PATCH /api/v1/settings/members/:memberId",
      "GET /api/v1/settings/personalization/:section",
      "POST /api/v1/settings/personalization/:section",
      "PATCH /api/v1/settings/personalization/:section/:id",
      "DELETE /api/v1/settings/personalization/:section/:id",
    ].join("\n"),
    "seven mounted concerns register what one file used to",
  );
});

Deno.test("[GAP-021] every mounted settings path answers from its own concern", async () => {
  const app = createSettingsRoutes(services());
  for (
    const path of [
      "/api/v1/member/ui-state",
      "/api/v1/settings/profile",
      "/api/v1/settings/preferences",
      "/api/v1/settings/sessions",
      "/api/v1/settings/workspace",
      "/api/v1/settings/members",
      "/api/v1/settings/personalization/tags",
    ]
  ) {
    const response = await app.request(`http://localhost${path}`, { headers });
    assertStatus(response, 200, `${path} is served by the mounted whole`);
  }
});
