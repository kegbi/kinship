/**
 * The two settings a member's browser remembers, and every refusal they
 * answer with.
 *
 * The codes matter more here than anywhere else in settings: a script on
 * every page reads them to decide whether to say anything at all.
 */

import type {
  MemberUiState,
} from "../../../packages/backend/modules/workspaces/public.ts";
import { createSettingsRoutes } from "../settings.ts";
import {
  assert,
  assertStatus,
} from "../../../packages/backend/testing/assert.ts";
import {
  headers,
  memberUiState,
  services,
  settings,
} from "./settings.test-helper.ts";

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
