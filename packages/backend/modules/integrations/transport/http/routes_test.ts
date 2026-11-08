import type { DavSyncManagement } from "../../public.ts";
import { createIntegrationRoutes } from "./routes.ts";
import { assert, assertStatus } from "../../../../testing/assert.ts";
import * as fixtures from "../../../../testing/fixtures.ts";

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
  "content-type": "application/json",
  Cookie: "__Host-kinship_session=session",
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

Deno.test("[GAP-020] a run that reached the remote reports its outcome at 200", async () => {
  for (
    const outcome of [
      "auth-failure",
      "conflict",
      "disabled",
      "partial",
      "success",
    ] as const
  ) {
    const response = await app({
      synchronize: () =>
        Promise.resolve(
          { status: outcome, subscription } as Awaited<
            ReturnType<DavSyncManagement["synchronize"]>
          >,
        ),
    }).request(
      `https://api.example.test/api/v1/settings/integrations/dav/${id}/sync`,
      {
        headers,
        method: "POST",
      },
    );

    assertStatus(response, 200, `a ${outcome} run is a state, not a refusal`);
    assert(
      (await response.text()).includes(`"status":"${outcome}"`),
      `the ${outcome} outcome reaches the page`,
    );
  }
});

Deno.test("[GAP-020] every DAV route needs a session, an origin, and a real id", async () => {
  const offline = () => Promise.reject(new Error("offline"));
  const down = app({
    configure: offline,
    disable: offline,
    list: offline,
    synchronize: offline,
  } as unknown as Partial<DavSyncManagement>);
  const routes = [
    { detail: "Integrations could not be loaded.", method: "GET", path: "" },
    {
      detail: "The integration could not be configured.",
      method: "POST",
      path: "",
    },
    {
      detail: "Synchronization could not finish.",
      method: "POST",
      path: `/${id}/sync`,
    },
    {
      detail: "The integration could not be disabled.",
      method: "DELETE",
      path: `/${id}`,
    },
  ];
  const body = JSON.stringify({
    name: "DAV",
    password: "remote-secret",
    remoteUrl: "https://dav.example.test/collection/",
    username: "ada",
  });

  for (const route of routes) {
    const url =
      `https://api.example.test/api/v1/settings/integrations/dav${route.path}`;
    const sent = route.method === "GET" ? {} : { body };
    const outage = await down.request(url, {
      ...sent,
      headers,
      method: route.method,
    });
    const anonymous = await app().request(url, {
      ...sent,
      headers: { "content-type": "application/json", Origin: headers.Origin },
      method: route.method,
    });
    assertStatus(outage, 503, `${route.method} ${url} reports its outage`);
    assert(
      ((await outage.json()) as { readonly detail: string }).detail ===
        route.detail,
      `${route.method} ${url} says what did not happen`,
    );
    assertStatus(anonymous, 401, `${route.method} ${url} needs a session`);
  }

  for (const path of [`/${id}/sync`, `/${id}`]) {
    const foreign = await app().request(
      `https://api.example.test/api/v1/settings/integrations/dav${path}`,
      {
        headers: { ...headers, Origin: "https://attacker.test" },
        method: path.endsWith("sync") ? "POST" : "DELETE",
      },
    );
    const malformed = await app().request(
      `https://api.example.test/api/v1/settings/integrations/dav${
        path.replace(id, "not-a-uuid")
      }`,
      { headers, method: path.endsWith("sync") ? "POST" : "DELETE" },
    );
    assertStatus(foreign, 403, `${path} refuses a foreign origin`);
    assertStatus(malformed, 404, `${path} conceals a malformed identifier`);
  }
});
