import type { AuditHistory } from "../../packages/backend/read-models/audit-history/public.ts";
import { createGovernanceRoutes } from "./governance.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ids = {
  actor: "00000000-0000-4000-8000-000000000002",
  event: "00000000-0000-4000-8000-000000000901",
  person: "00000000-0000-4000-8000-000000000100",
  user: "00000000-0000-4000-8000-000000000001",
  workspace: "00000000-0000-4000-8000-000000000003",
};

function services(
  list: AuditHistory["list"],
  role: "admin" | "member" | "owner" = "owner",
) {
  return {
    auditHistory: { list } as AuditHistory,
    protectedSessions: {
      resolve: () =>
        Promise.resolve({
          accessibleWorkspaces: [],
          memberId: ids.actor,
          role,
          userId: ids.user,
          workspaceId: ids.workspace,
          workspaceName: "Circle",
        }),
    },
  };
}

Deno.test("GOVERNANCE-002 HTTP authorizes and forwards workspace audit filters", async () => {
  let received: unknown;
  const app = createGovernanceRoutes(services((actor, input) => {
    received = { actor, input };
    return Promise.resolve({
      items: [{
        action: "people.person-created",
        actor: { id: ids.actor, name: "Owner" },
        details: { isPartial: false },
        id: ids.event,
        occurredAt: "2026-08-17T12:30:00.000Z",
        person: { id: ids.person, name: "Ada Lovelace" },
        redacted: false,
        subject: { id: ids.person, type: "person" },
      }],
      status: "ready",
    });
  }));
  const response = await app.request(
    `http://localhost/api/v1/audit-events?personId=${ids.person}&actorMemberId=${ids.actor}&action=people.person-created&from=2026-08-01T00%3A00%3A00.000Z&to=2026-09-01T00%3A00%3A00.000Z&limit=25`,
    { headers: { cookie: "kinship_session=test" } },
  );
  assert(response.status === 200, `expected 200, received ${response.status}`);
  assert(
    response.headers.get("cache-control") === "private, no-store",
    "audit response can be cached",
  );
  assert(
    JSON.stringify(received).includes(ids.workspace) &&
      JSON.stringify(received).includes("people.person-created"),
    "resolved actor or audit filters were lost",
  );
});

Deno.test("GOVERNANCE-002 HTTP conceals scope and rejects stale pages", async () => {
  const headers = { cookie: "kinship_session=test" };
  for (
    const [status, expected] of [
      ["forbidden", 403],
      ["not-found", 404],
      ["stale-cursor", 409],
    ] as const
  ) {
    const app = createGovernanceRoutes(
      services(() =>
        Promise.resolve({ status } as Awaited<ReturnType<AuditHistory["list"]>>)
      ),
    );
    const response = await app.request(
      `http://localhost/api/v1/people/${ids.person}/audit?cursor=opaque`,
      { headers },
    );
    assert(
      response.status === expected,
      `${status} mapped to ${response.status}, expected ${expected}`,
    );
    assert(
      response.headers.get("content-type")?.includes(
        "application/problem+json",
      ),
      `${status} did not use the problem contract`,
    );
  }
});

Deno.test("GOVERNANCE-002 HTTP rejects invalid filters before the read model", async () => {
  let called = false;
  const app = createGovernanceRoutes(services(() => {
    called = true;
    return Promise.resolve({ items: [], status: "ready" });
  }));
  const invalid = await app.request(
    "http://localhost/api/v1/audit-events?from=2026-09-01T00%3A00%3A00Z&to=2026-08-01T00%3A00%3A00Z",
    { headers: { cookie: "kinship_session=test" } },
  );
  assert(invalid.status === 400 && !called, "invalid range reached storage");
  const anonymous = await app.request("http://localhost/api/v1/audit-events");
  assert(anonymous.status === 401, "anonymous audit access was not rejected");
});
