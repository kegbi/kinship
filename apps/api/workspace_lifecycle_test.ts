import { Hono } from "hono";
import {
  createWorkspaceLifecycleRoutes,
  type WorkspaceLifecycleHttpServices,
} from "./workspace_lifecycle.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const impactToken = "a".repeat(64);
const headers = {
  Cookie: "kinship_session=session-token",
  Origin: "https://app.kinship.test",
  "X-Workspace-Id": "00000000-0000-4000-8000-000000000101",
};

function fixture(status: string = "ready") {
  const lifecycle = {
    deleteWorkspace: () =>
      Promise.resolve(
        status === "ready"
          ? {
            cleanupStatus: "pending",
            status: "deleted",
          }
          : status === "rate-limited"
          ? { retryAfterSeconds: 17, status }
          : { status },
      ),
    preview: () =>
      Promise.resolve(
        status === "ready"
          ? {
            activeSessionCount: 2,
            counts: {
              activities: 3,
              auditEvents: 0,
              calls: 0,
              debts: 0,
              exports: 1,
              files: 2,
              gifts: 0,
              imports: 1,
              integrations: 0,
              journalPosts: 4,
              lifeEvents: 0,
              members: 2,
              messages: 0,
              notes: 0,
              operations: 0,
              people: 5,
              relationships: 0,
              reminders: 6,
              tasks: 7,
            },
            deleteConfirmation: "DELETE Family",
            impactToken,
            resetConfirmation: "RESET Family",
            status: "ready",
            workspaceName: "Family",
          }
          : status === "rate-limited"
          ? { retryAfterSeconds: 17, status }
          : { status },
      ),
    reconcilePendingCleanup: () =>
      Promise.resolve({ completed: 0, inspected: 0 }),
    resetWorkspace: () =>
      Promise.resolve(
        status === "ready"
          ? {
            cleanupStatus: "complete",
            status: "reset",
          }
          : { status },
      ),
  };
  const app = new Hono();
  app.route(
    "/",
    createWorkspaceLifecycleRoutes({
      browserSecurity: {
        origin: "https://app.kinship.test",
        secureCookie: true,
      },
      protectedSessions: {
        resolve: () =>
          Promise.resolve({
            memberId: "00000000-0000-4000-8000-000000000011",
            role: "owner",
            userId: "00000000-0000-4000-8000-000000000001",
            workspaceId: "00000000-0000-4000-8000-000000000101",
            workspaceName: "Family",
          }),
      },
      workspaceLifecycle: lifecycle,
    } as unknown as WorkspaceLifecycleHttpServices),
  );
  return app;
}

Deno.test("WORKSPACE-002 API exposes private impact and destructive session effects", async () => {
  const app = fixture();
  const preview = await app.request("/api/v1/settings/workspace-lifecycle", {
    headers,
  });
  const body = await preview.json();
  assert(preview.status === 200, "preview should succeed");
  assert(
    preview.headers.get("Cache-Control") === "private, no-store",
    "preview must not cache",
  );
  assert(
    body.counts.people === 5 && body.impactToken === impactToken,
    "current impact returned",
  );

  const deleted = await app.request("/api/v1/settings/workspace-lifecycle", {
    body: JSON.stringify({
      confirmation: "DELETE Family",
      impactToken,
      password: "valid",
    }),
    headers,
    method: "DELETE",
  });
  const result = await deleted.json();
  assert(
    deleted.status === 200 && result.cleanupStatus === "pending",
    "cleanup remains explicit",
  );
  assert(
    deleted.headers.get("Set-Cookie")?.includes("Max-Age=0"),
    "affected session is cleared",
  );
});

Deno.test("WORKSPACE-002 API rejects stale impact and unsafe requests", async () => {
  const stale = await fixture("stale-impact").request(
    "/api/v1/settings/workspace-lifecycle",
    {
      body: JSON.stringify({
        confirmation: "DELETE Family",
        impactToken,
        password: "valid",
      }),
      headers,
      method: "DELETE",
    },
  );
  assert(stale.status === 409, "stale preview should conflict");
  const invalid = await fixture().request(
    "/api/v1/settings/workspace-lifecycle/reset",
    {
      body: "{}",
      headers,
      method: "POST",
    },
  );
  assert(invalid.status === 400, "malformed mutation rejected");
  const origin = await fixture().request(
    "/api/v1/settings/workspace-lifecycle/reset",
    {
      body: JSON.stringify({
        confirmation: "RESET Family",
        impactToken,
        password: "valid",
      }),
      headers: { ...headers, Origin: "https://evil.example" },
      method: "POST",
    },
  );
  assert(origin.status === 403, "cross-origin mutation rejected");
});

Deno.test("WORKSPACE-002 API maps lifecycle authorization and revalidation failures", async () => {
  for (
    const [status, expected] of [
      ["forbidden", 403],
      ["reauthentication-required", 403],
      ["confirmation-invalid", 400],
      ["unavailable", 503],
    ] as const
  ) {
    const response = await fixture(status).request(
      "/api/v1/settings/workspace-lifecycle",
      { headers },
    );
    assert(
      response.status === expected,
      `${status} preview mapped to ${response.status}`,
    );
  }

  const anonymous = await fixture().request(
    "/api/v1/settings/workspace-lifecycle",
  );
  assert(anonymous.status === 401, "anonymous preview allowed");

  const reset = await fixture().request(
    "/api/v1/settings/workspace-lifecycle/reset",
    {
      body: JSON.stringify({
        confirmation: "RESET Family",
        impactToken,
        password: "valid",
      }),
      headers,
      method: "POST",
    },
  );
  const result = await reset.json();
  assert(
    reset.status === 200 && result.cleanupStatus === "complete",
    "reset result lost cleanup status",
  );

  const limited = await fixture("rate-limited").request(
    "/api/v1/settings/workspace-lifecycle",
    {
      body: JSON.stringify({
        confirmation: "DELETE Family",
        impactToken,
        password: "wrong",
      }),
      headers,
      method: "DELETE",
    },
  );
  assert(limited.status === 429, "destructive password guessing is unbounded");
  assert(limited.headers.get("Retry-After") === "17", "retry delay is missing");
});
