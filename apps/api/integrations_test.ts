import type { DavSyncManagement } from "../../packages/backend/modules/integrations/public.ts";
import { createIntegrationRoutes } from "./integrations.ts";
import { assert, assertStatus } from "../../packages/backend/testing/assert.ts";
import * as fixtures from "../../packages/backend/testing/fixtures.ts";

const actor = fixtures.actor({
  role: "admin",
  userId: fixtures.uuid(3),
  workspaceId: fixtures.uuid(1),
});
const id = "00000000-0000-4000-8000-000000000010";
const subscription = {
  id,
  isActive: true,
  lastOutcome: "never" as const,
  name: "DAV",
  remoteUrl: "https://dav.example.test/collection/",
  username: "ada",
};

function app(overrides: Partial<DavSyncManagement> = {}) {
  const dav = {
    configure: () =>
      Promise.resolve({ status: "configured" as const, subscription }),
    disable: () =>
      Promise.resolve({
        status: "disabled" as const,
        subscription: { ...subscription, isActive: false },
      }),
    list: () =>
      Promise.resolve({
        status: "ready" as const,
        subscriptions: [subscription],
      }),
    synchronize: () =>
      Promise.resolve({
        processed: 2,
        status: "success" as const,
        subscription: { ...subscription, lastOutcome: "success" as const },
      }),
    ...overrides,
  } as DavSyncManagement;
  return createIntegrationRoutes({
    browserSecurity: { origin: "https://app.example.test", secureCookie: true },
    dav,
    protectedSessions: {
      resolve: () =>
        Promise.resolve({
          ...actor,
          accessibleWorkspaces: [{ ...actor, workspaceName: "Circle" }],
          workspaceName: "Circle",
        }),
    },
  });
}

const headers = {
  Cookie: "kinship_session=session",
  Origin: "https://app.example.test",
  "X-Workspace-Id": actor.workspaceId,
};

Deno.test("DAV HTTP surface configures, lists, syncs, and disables without exposing secret", async () => {
  const routes = app();
  const configured = await routes.request("/api/v1/settings/integrations/dav", {
    body: JSON.stringify({
      name: "DAV",
      password: "remote-secret",
      remoteUrl: "https://dav.example.test/collection/",
      username: "ada",
    }),
    headers,
    method: "POST",
  });
  assertStatus(configured, 201, "expected configured response");
  assert(
    !(await configured.text()).includes("remote-secret"),
    "secret must not be returned",
  );
  const listed = await routes.request("/api/v1/settings/integrations/dav", {
    headers,
  });
  assertStatus(listed, 200, "expected list response");
  const synced = await routes.request(
    `/api/v1/settings/integrations/dav/${id}/sync`,
    { headers, method: "POST" },
  );
  assertStatus(synced, 200, "expected sync response");
  const disabled = await routes.request(
    `/api/v1/settings/integrations/dav/${id}`,
    { headers, method: "DELETE" },
  );
  assertStatus(disabled, 200, "expected disable response");
});

Deno.test("DAV HTTP mutations reject another origin and concurrent sync", async () => {
  const routes = app({
    synchronize: () => Promise.resolve({ status: "busy" as const }),
  });
  const rejected = await routes.request("/api/v1/settings/integrations/dav", {
    body: "{}",
    headers: { ...headers, Origin: "https://evil.example" },
    method: "POST",
  });
  assertStatus(rejected, 403, "expected origin rejection");
  const busy = await routes.request(
    `/api/v1/settings/integrations/dav/${id}/sync`,
    { headers, method: "POST" },
  );
  assertStatus(busy, 409, "expected serialized sync conflict");
});

Deno.test("DAV HTTP maps authentication, validation, authorization, lookup, and outages", async () => {
  const routes = app({
    configure: () => Promise.resolve({ status: "forbidden" as const }),
    disable: () => Promise.resolve({ status: "not-found" as const }),
    list: () =>
      Promise.resolve({ status: "forbidden" as const, subscriptions: [] }),
  });
  assert(
    (await routes.request("/api/v1/settings/integrations/dav")).status === 401,
    "session required",
  );
  assert(
    (await routes.request("/api/v1/settings/integrations/dav", {
      body: "{}",
      headers,
      method: "POST",
    })).status === 400,
    "invalid configuration rejected",
  );
  assert(
    (await routes.request("/api/v1/settings/integrations/dav", {
      body: JSON.stringify({
        name: "DAV",
        password: "secret",
        remoteUrl: `https://dav.example.test/${"a".repeat(2_100)}`,
      }),
      headers,
      method: "POST",
    })).status === 400,
    "oversized DAV URL rejected at HTTP boundary",
  );
  assert(
    (await routes.request("/api/v1/settings/integrations/dav", {
      body: JSON.stringify({
        name: "DAV",
        password: "secret",
        remoteUrl: "https://dav.example.test",
      }),
      headers,
      method: "POST",
    })).status === 403,
    "forbidden configuration mapped",
  );
  assert(
    (await routes.request("/api/v1/settings/integrations/dav", { headers }))
      .status === 403,
    "forbidden list mapped",
  );
  assert(
    (await routes.request(`/api/v1/settings/integrations/dav/${id}`, {
      headers,
      method: "DELETE",
    })).status === 404,
    "missing disable mapped",
  );

  const unavailable = app({ list: () => Promise.reject(new Error("offline")) });
  assert(
    (await unavailable.request("/api/v1/settings/integrations/dav", {
      headers,
    })).status === 503,
    "outage mapped",
  );
  assert(
    (await unavailable.request(
      "/api/v1/settings/integrations/dav/not-a-uuid/sync",
      {
        headers,
        method: "POST",
      },
    )).status === 404,
    "invalid identifier hidden",
  );
});
