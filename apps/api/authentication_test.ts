import { browserSecurityPolicy } from "./security_config.ts";
import {
  type AuthenticationHttpServices,
  createAuthenticationRoutes,
} from "./authentication.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function services(
  signOut: (token: string) => Promise<void>,
): AuthenticationHttpServices {
  return {
    browserSecurity: browserSecurityPolicy("test", "http://localhost"),
    passwordRecovery: {
      request: () => Promise.resolve({ delivery: "not-applicable" }),
      reset: () => Promise.resolve("invalid"),
    },
    protectedSessions: {
      completeMfa: () => Promise.resolve({ status: "challenge-expired" }),
      establishVerifiedEntry: () =>
        Promise.resolve({ status: "membership-inactive" }),
      resolve: () => Promise.resolve(undefined),
      signIn: () => Promise.resolve({ status: "invalid-credentials" }),
      signOut,
    },
  };
}

Deno.test("recovery dependency failure is retryable and never reported accepted", async () => {
  const base = services(() => Promise.resolve());
  const app = createAuthenticationRoutes({
    ...base,
    passwordRecovery: {
      ...base.passwordRecovery,
      request: () => Promise.reject(new Error("private database detail")),
    },
  });
  const response = await app.request(
    "http://localhost/api/v1/password-reset-requests",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      body: JSON.stringify({ email: "owner@example.test" }),
    },
  );
  assert(response.status === 503, "failed durable request is not accepted");
  const body = await response.json() as { code?: string };
  assert(
    body.code === "password_recovery_unavailable",
    "recovery outage has a stable safe problem",
  );
});

Deno.test("provider delivery failure keeps the public recovery response non-enumerating", async () => {
  const base = services(() => Promise.resolve());
  const app = createAuthenticationRoutes({
    ...base,
    passwordRecovery: {
      ...base.passwordRecovery,
      request: () => Promise.resolve({ delivery: "failed" }),
    },
  });
  const response = await app.request(
    "http://localhost/api/v1/password-reset-requests",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      body: JSON.stringify({ email: "owner@example.test" }),
    },
  );
  assert(response.status === 202, "provider failure remains non-enumerating");
  assert(
    JSON.stringify(await response.json()) ===
      JSON.stringify({ status: "accepted" }),
    "provider failure returns only the generic public response",
  );
});

Deno.test("sign-out reports revocation failure without discarding the session cookie", async () => {
  const app = createAuthenticationRoutes(
    services(() => Promise.reject(new Error("private database detail"))),
  );
  const response = await app.request("http://localhost/api/v1/sign-out", {
    method: "POST",
    headers: {
      cookie: "kinship_session=secret-token",
      origin: "http://localhost",
    },
  });
  assert(response.status === 503, "failed revocation must not report sign-out");
  assert(
    response.headers.get("set-cookie") === null,
    "failed revocation keeps the cookie so the person can retry",
  );
  const body = await response.json() as { code?: string; detail?: string };
  assert(body.code === "sign_out_unavailable", "failure uses a stable code");
  assert(
    !JSON.stringify(body).includes("private database detail"),
    "failure does not expose adapter details",
  );
});

Deno.test("rate-limit completion and required-work failure map to their exact public statuses", async () => {
  const base = services(() => Promise.resolve());
  for (
    const scenario of [
      {
        expectedCode: "authentication_rate_limited",
        expectedStatus: 429,
        signIn: () =>
          Promise.resolve({
            retryAfterSeconds: 37,
            status: "rate-limited" as const,
          }),
      },
      {
        expectedCode: "authentication_unavailable",
        expectedStatus: 503,
        signIn: () => Promise.reject(new Error("private audit failure")),
      },
    ] as const
  ) {
    const app = createAuthenticationRoutes({
      ...base,
      protectedSessions: {
        ...base.protectedSessions,
        signIn: scenario.signIn,
      },
    });
    const response = await app.request(
      "http://localhost/api/v1/sessions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          email: "owner@example.test",
          password: "correct horse battery staple",
        }),
      },
    );
    assert(
      response.status === scenario.expectedStatus,
      `expected public ${scenario.expectedStatus}, received ${response.status}`,
    );
    const body = await response.json() as { readonly code?: string };
    assert(
      body.code === scenario.expectedCode,
      `expected ${scenario.expectedCode}, received ${body.code}`,
    );
    if (scenario.expectedStatus === 429) {
      assert(
        response.headers.get("retry-after") === "37",
        "completed rate-limit response preserves its retry interval",
      );
    }
  }
});

Deno.test("session context exposes the active workspace and accessible switcher choices", async () => {
  const base = services(() => Promise.resolve());
  const workspace = {
    id: "00000000-0000-4000-8000-000000000003",
    name: "Ada's circle",
  };
  const second = {
    id: "00000000-0000-4000-8000-000000000005",
    name: "Community circle",
  };
  const app = createAuthenticationRoutes({
    ...base,
    legal: {
      accept: () => Promise.resolve({ status: "unavailable" }),
      publicDocument: () => Promise.resolve({ status: "not-found" }),
      requirements: () =>
        Promise.resolve({
          documents: [{
            content: "Exact terms",
            documentType: "terms",
            id: "00000000-0000-4000-8000-000000000101",
            version: "2026-08",
          }],
          status: "ready",
        }),
    },
    protectedSessions: {
      ...base.protectedSessions,
      resolve: () =>
        Promise.resolve({
          accessibleWorkspaces: [
            {
              memberId: "00000000-0000-4000-8000-000000000002",
              role: "owner" as const,
              userId: "00000000-0000-4000-8000-000000000001",
              workspaceId: workspace.id,
              workspaceName: workspace.name,
            },
            {
              memberId: "00000000-0000-4000-8000-000000000004",
              role: "member" as const,
              userId: "00000000-0000-4000-8000-000000000001",
              workspaceId: second.id,
              workspaceName: second.name,
            },
          ],
          memberId: "00000000-0000-4000-8000-000000000002",
          role: "owner" as const,
          userId: "00000000-0000-4000-8000-000000000001",
          workspaceId: workspace.id,
          workspaceName: workspace.name,
        }),
    },
  });

  const response = await app.request("http://localhost/api/v1/session", {
    headers: { cookie: "kinship_session=active-session-token" },
  });
  const body = await response.json() as {
    readonly requiredLegalDocuments?: readonly { readonly id?: string }[];
    readonly workspace?: { readonly id?: string };
    readonly workspaces?: readonly { readonly id?: string }[];
  };
  assert(response.status === 200, "active session resolves");
  assert(
    body.requiredLegalDocuments?.[0]?.id ===
      "00000000-0000-4000-8000-000000000101",
    "session refresh omitted the required legal interruption",
  );
  assert(body.workspace?.id === workspace.id, "active workspace is explicit");
  assert(
    body.workspaces?.map((item) => item.id).join(",") ===
      `${workspace.id},${second.id}`,
    "accessible workspace choices are ordered and explicit",
  );
});
