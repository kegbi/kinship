import { Hono } from "hono";
import {
  createPersonalLifecycleRoutes,
  type PersonalLifecycleHttpServices,
} from "./personal_lifecycle.ts";
import { assert, assertStatus } from "../../../../testing/assert.ts";

function fixture(overrides: {
  readonly deleteResult?: unknown;
  readonly leaveResult?: unknown;
  readonly previewResult?: unknown;
  readonly resolved?: boolean;
} = {}) {
  const lifecycle = {
    deleteIdentity: () =>
      Promise.resolve(
        overrides.deleteResult ?? {
          status: "deleted",
        },
      ),
    leaveWorkspace: () =>
      Promise.resolve(
        overrides.leaveResult ?? {
          nextWorkspaceId: "00000000-0000-4000-8000-000000000102",
          signedOut: false,
          status: "left",
        },
      ),
    preview: () =>
      Promise.resolve(
        overrides.previewResult ?? {
          activeSessionCount: 2,
          blockingWorkspaces: [],
          deleteConfirmation: "DELETE owner@example.test",
          leaveConfirmation: "LEAVE Family",
          memberships: [{
            finalOwner: false,
            memberId: "00000000-0000-4000-8000-000000000011",
            role: "owner",
            status: "active",
            workspaceId: "00000000-0000-4000-8000-000000000101",
            workspaceName: "Family",
          }],
          retainedLegalRecords: true,
          status: "ready",
        },
      ),
  };
  const services = {
    browserSecurity: {
      origin: "https://app.kinship.test",
      secureCookie: true,
    },
    personalLifecycle: lifecycle,
    protectedSessions: {
      resolve: () =>
        Promise.resolve(
          overrides.resolved === false ? undefined : {
            memberId: "00000000-0000-4000-8000-000000000011",
            role: "owner",
            userId: "00000000-0000-4000-8000-000000000001",
            workspaceId: "00000000-0000-4000-8000-000000000101",
            workspaceName: "Family",
          },
        ),
    },
  } as unknown as PersonalLifecycleHttpServices;
  const app = new Hono();
  app.route("/", createPersonalLifecycleRoutes(services));
  return app;
}

const headers = {
  Cookie: "kinship_session=session-token",
  Origin: "https://app.kinship.test",
  "X-Workspace-Id": "00000000-0000-4000-8000-000000000101",
};

Deno.test("AUTH-005 preview returns private current impact", async () => {
  const response = await fixture().request(
    "/api/v1/settings/personal-lifecycle",
    { headers },
  );
  const body = await response.json();
  assertStatus(response, 200, "preview status");
  assert(
    response.headers.get("Cache-Control") === "private, no-store",
    "private cache",
  );
  assert(
    body.confirmations.leaveWorkspace === "LEAVE Family",
    "leave confirmation",
  );
  assert(body.memberships[0].workspace.name === "Family", "membership impact");
  assert(body.retainedLegalRecords === true, "legal retention marker");
});

Deno.test("AUTH-005 leave returns next workspace without clearing a valid session", async () => {
  const response = await fixture().request(
    "/api/v1/settings/personal-lifecycle/leave",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        confirmation: "LEAVE Family",
        password: "correct",
      }),
    },
  );
  const body = await response.json();
  assertStatus(response, 200, "leave status");
  assert(body.next === "/app", "next route");
  assert(body.nextWorkspaceId.endsWith("102"), "next workspace");
  assert(response.headers.get("Set-Cookie") === null, "session remains active");
});

Deno.test("AUTH-005 last membership leave and identity deletion expire the session cookie", async () => {
  const leave = await fixture({
    leaveResult: { signedOut: true, status: "left" },
  }).request("/api/v1/settings/personal-lifecycle/leave", {
    method: "POST",
    headers,
    body: JSON.stringify({ confirmation: "LEAVE Family", password: "correct" }),
  });
  assertStatus(leave, 200, "signed-out leave status");
  assert(
    leave.headers.get("Set-Cookie")?.includes("Max-Age=0"),
    "leave cookie expiry",
  );

  const deletion = await fixture().request(
    "/api/v1/settings/personal-lifecycle",
    {
      method: "DELETE",
      headers,
      body: JSON.stringify({
        confirmation: "DELETE owner@example.test",
        password: "correct password",
      }),
    },
  );
  const body = await deletion.json();
  assert(
    deletion.status === 200 && body.next === "/auth/sign-in",
    "deletion redirect",
  );
  assert(
    deletion.headers.get("Set-Cookie")?.includes("Secure"),
    "secure cookie expiry",
  );
});

Deno.test("AUTH-005 rejects missing session, origin, and malformed confirmation", async () => {
  const app = fixture();
  const unauthenticated = await app.request(
    "/api/v1/settings/personal-lifecycle",
  );
  assertStatus(unauthenticated, 401, "missing session");
  const crossOrigin = await app.request(
    "/api/v1/settings/personal-lifecycle/leave",
    {
      method: "POST",
      headers: { ...headers, Origin: "https://evil.example" },
      body: JSON.stringify({ confirmation: "LEAVE Family" }),
    },
  );
  assertStatus(crossOrigin, 403, "cross origin");
  const invalid = await app.request(
    "/api/v1/settings/personal-lifecycle/leave",
    { method: "POST", headers, body: "{}" },
  );
  assertStatus(invalid, 400, "invalid confirmation");
});

Deno.test("AUTH-005 maps reauthentication and final-owner safeguards", async () => {
  const leaveReauth = await fixture({
    leaveResult: { status: "reauthentication-required" },
  }).request("/api/v1/settings/personal-lifecycle/leave", {
    method: "POST",
    headers,
    body: JSON.stringify({ confirmation: "LEAVE Family", password: "wrong" }),
  });
  assertStatus(leaveReauth, 403, "leave reauth status");

  const reauth = await fixture({
    deleteResult: { status: "reauthentication-required" },
  }).request("/api/v1/settings/personal-lifecycle", {
    method: "DELETE",
    headers,
    body: JSON.stringify({
      confirmation: "DELETE owner@example.test",
      password: "wrong",
    }),
  });
  assertStatus(reauth, 403, "reauth status");

  const finalOwner = await fixture({
    leaveResult: {
      blockingWorkspaces: [{
        id: "00000000-0000-4000-8000-000000000101",
        name: "Family",
      }],
      status: "final-owner",
    },
  }).request("/api/v1/settings/personal-lifecycle/leave", {
    method: "POST",
    headers,
    body: JSON.stringify({ confirmation: "LEAVE Family", password: "correct" }),
  });
  const problem = await finalOwner.json();
  assertStatus(finalOwner, 409, "final owner status");
  assert(problem.blockingWorkspaces[0].name === "Family", "blocking workspace");
  assert(problem.detail.includes("Transfer ownership"), "truthful alternative");
});

Deno.test("AUTH-005 exposes retryable bounded step-up rate limits", async () => {
  const limited = await fixture({
    leaveResult: { retryAfterSeconds: 47, status: "rate-limited" },
  }).request("/api/v1/settings/personal-lifecycle/leave", {
    method: "POST",
    headers: { ...headers, "X-Kinship-Client-Address": "203.0.113.8" },
    body: JSON.stringify({ confirmation: "LEAVE Family", password: "wrong" }),
  });
  const problem = await limited.json();
  assertStatus(limited, 429, "rate-limit status");
  assert(limited.headers.get("Retry-After") === "47", "retry interval");
  assert(problem.code === "authentication_rate_limited", "bounded policy code");
});

Deno.test("[GAP-020] every account-lifecycle route needs a session and a body", async () => {
  const anonymous = fixture({ resolved: false });
  const body = JSON.stringify({
    confirmation: "LEAVE Family",
    password: "correct",
  });
  const routes = [
    {
      body: undefined,
      method: "GET",
      path: "/api/v1/settings/personal-lifecycle",
    },
    {
      body,
      method: "POST",
      path: "/api/v1/settings/personal-lifecycle/leave",
    },
    { body, method: "DELETE", path: "/api/v1/settings/personal-lifecycle" },
  ];

  for (const route of routes) {
    const response = await anonymous.request(route.path, {
      ...(route.body ? { body: route.body } : {}),
      headers,
      method: route.method,
    });
    assertStatus(
      response,
      401,
      `${route.method} ${route.path} needs a session`,
    );
  }

  const malformed = await fixture().request(
    "/api/v1/settings/personal-lifecycle",
    { body: JSON.stringify({ confirmation: "" }), headers, method: "DELETE" },
  );
  const outage = await fixture({ previewResult: { status: "unavailable" } })
    .request("/api/v1/settings/personal-lifecycle", { headers });

  assertStatus(malformed, 400, "a deletion without a password is refused");
  assertStatus(outage, 503, "a preview that cannot be revalidated says so");
});
