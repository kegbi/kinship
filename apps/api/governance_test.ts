import { Hono } from "hono";
import type { AuditHistory } from "../../packages/backend/read-models/audit-history/public.ts";
import type { LegalAcceptance } from "../../packages/backend/modules/governance/public.ts";
import { browserSecurityPolicy } from "./security_config.ts";
import {
  createGovernanceRoutes,
  createLegalRequirementGuard,
} from "./governance.ts";

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
  legal?: LegalAcceptance,
) {
  return {
    auditHistory: { list } as AuditHistory,
    browserSecurity: browserSecurityPolicy("test", undefined),
    ...(legal ? { legal } : {}),
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

Deno.test("GOVERNANCE-001 HTTP reviews and accepts an exact required version", async () => {
  const accepted: unknown[] = [];
  const legal = {
    requirements: () =>
      Promise.resolve({
        documents: [{
          content: "Terms content",
          documentType: "terms",
          id: ids.person,
          publishedAt: "2026-08-23T09:00:00.000Z",
          version: "2026-08",
        }],
        status: "ready" as const,
      }),
    publicDocument: () =>
      Promise.resolve({
        document: {
          content: "Terms content",
          documentType: "terms",
          id: ids.person,
          publishedAt: "2026-08-23T09:00:00.000Z",
          version: "2026-08",
        },
        status: "ready" as const,
      }),
    accept: (actor: unknown, input: unknown) => {
      accepted.push({ actor, input });
      return Promise.resolve({
        acceptedAt: "2026-08-23T10:00:00.000Z",
        documentId: ids.person,
        status: "accepted" as const,
      });
    },
  } as LegalAcceptance;
  const app = createGovernanceRoutes(services(
    () => Promise.resolve({ items: [], status: "ready" }),
    "member",
    legal,
  ));

  const publicDocument = await app.request(
    "http://localhost/api/v1/legal-documents/terms",
  );
  const requirements = await app.request(
    "http://localhost/api/v1/legal-requirements",
    { headers: { cookie: "kinship_session=test" } },
  );
  const acceptance = await app.request(
    "http://localhost/api/v1/legal-acceptances",
    {
      body: JSON.stringify({ documentId: ids.person }),
      headers: {
        cookie: "kinship_session=test",
        "content-type": "application/json",
        origin: "http://127.0.0.1:4321",
        "X-Forwarded-For": "203.0.113.200",
        "X-Kinship-Client-Address": "2001:db8::42",
      },
      method: "POST",
    },
  );
  const ipv4Acceptance = await app.request(
    "http://localhost/api/v1/legal-acceptances",
    {
      body: JSON.stringify({ documentId: ids.person }),
      headers: {
        cookie: "kinship_session=test",
        "content-type": "application/json",
        origin: "http://127.0.0.1:4321",
        "X-Kinship-Client-Address": "192.0.2.42",
      },
      method: "POST",
    },
  );

  assert(publicDocument.status === 200, "active public document was hidden");
  assert(requirements.status === 200, "required versions were unavailable");
  assert(
    acceptance.status === 201 && ipv4Acceptance.status === 201,
    "exact version was not accepted",
  );
  assert(
    JSON.stringify(accepted).includes(ids.workspace) &&
      JSON.stringify(accepted).includes(ids.person) &&
      JSON.stringify(accepted).includes("2001:db8::42") &&
      JSON.stringify(accepted).includes("192.0.2.42") &&
      !JSON.stringify(accepted).includes("203.0.113.200"),
    "acceptance lost its attributable user/workspace/document context",
  );
});

Deno.test("GOVERNANCE-001 HTTP rejects unsafe or superseded acceptance", async () => {
  let acceptanceInput: unknown;
  const legal = {
    requirements: () => Promise.resolve({ documents: [], status: "ready" }),
    publicDocument: () => Promise.resolve({ status: "not-found" }),
    accept: (_actor: unknown, input: unknown) => {
      acceptanceInput = input;
      return Promise.resolve({ status: "superseded-version" });
    },
  } as LegalAcceptance;
  const app = createGovernanceRoutes(services(
    () => Promise.resolve({ items: [], status: "ready" }),
    "member",
    legal,
  ));
  const headers = {
    cookie: "kinship_session=test",
    "content-type": "application/json",
  };
  const wrongOrigin = await app.request(
    "http://localhost/api/v1/legal-acceptances",
    {
      body: JSON.stringify({ documentId: ids.person }),
      headers,
      method: "POST",
    },
  );
  const stale = await app.request(
    "http://localhost/api/v1/legal-acceptances",
    {
      body: JSON.stringify({ documentId: ids.person }),
      headers: {
        ...headers,
        origin: "http://127.0.0.1:4321",
        "X-Forwarded-For": "198.51.100.24",
        "X-Kinship-Client-Address": "not-an-ip",
      },
      method: "POST",
    },
  );
  const absent = await app.request(
    "http://localhost/api/v1/legal-documents/privacy",
  );
  const unsupported = await app.request(
    "http://localhost/api/v1/legal-documents/cookies",
  );
  const malformed = await app.request(
    "http://localhost/api/v1/legal-acceptances",
    {
      body: "{}",
      headers: {
        ...headers,
        origin: "http://127.0.0.1:4321",
      },
      method: "POST",
    },
  );
  assert(wrongOrigin.status === 403, "cross-origin acceptance was allowed");
  assert(stale.status === 409, "superseded version was accepted");
  assert(
    absent.status === 404 && unsupported.status === 404 &&
      malformed.status === 400,
    "invalid or absent legal input did not use the bounded problem contract",
  );
  assert(
    !JSON.stringify(acceptanceInput).includes("ipAddress") &&
      !JSON.stringify(acceptanceInput).includes("198.51.100.24"),
    "invalid or untrusted forwarding address reached acceptance",
  );
});

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

Deno.test("GOVERNANCE-001 guard blocks pending and unavailable legal state before protected APIs", async () => {
  let mode: "pending" | "ready" | "unavailable" = "pending";
  const legal = {
    requirements: () =>
      Promise.resolve(
        mode === "pending"
          ? {
            documents: [{
              content: "Required",
              documentType: "terms",
              id: ids.person,
              version: "2026-08",
            }],
            status: "ready" as const,
          }
          : mode === "ready"
          ? { documents: [], status: "ready" as const }
          : { status: "unavailable" as const },
      ),
    publicDocument: () => Promise.resolve({ status: "not-found" as const }),
    accept: () => Promise.resolve({ status: "superseded-version" as const }),
  } as LegalAcceptance;
  const app = new Hono();
  app.use(
    "/api/v1/*",
    createLegalRequirementGuard({
      legal,
      protectedSessions: services(
        () => Promise.resolve({ items: [], status: "ready" }),
      ).protectedSessions,
    }),
  );
  app.get("/api/v1/people", (context) => context.json({ reached: true }));
  const request = () =>
    app.request("http://localhost/api/v1/people", {
      headers: { cookie: "kinship_session=test" },
    });

  const pending = await request();
  mode = "unavailable";
  const unavailable = await request();
  mode = "ready";
  const ready = await request();

  assert(pending.status === 403, "pending acceptance reached protected API");
  assert(unavailable.status === 503, "requirement outage bypassed protection");
  assert(ready.status === 200, "satisfied requirement remained blocked");
});

Deno.test("GOVERNANCE-001 guard fails closed when session resolution fails once", async () => {
  let resolutions = 0;
  const protectedSessions = {
    resolve: (_command?: unknown) => {
      resolutions += 1;
      return resolutions === 1
        ? Promise.reject(new Error("session store unavailable"))
        : Promise.resolve({
          accessibleWorkspaces: [],
          memberId: ids.actor,
          role: "member" as const,
          userId: ids.user,
          workspaceId: ids.workspace,
          workspaceName: "Circle",
        });
    },
  };
  const app = new Hono();
  app.use(
    "/api/v1/*",
    createLegalRequirementGuard({
      legal: {
        requirements: () =>
          Promise.resolve({ documents: [], status: "ready" as const }),
        publicDocument: () => Promise.resolve({ status: "not-found" as const }),
        accept: () =>
          Promise.resolve({ status: "superseded-version" as const }),
      } as LegalAcceptance,
      protectedSessions,
    }),
  );
  app.get("/api/v1/people", async (context) => {
    const resolved = await protectedSessions.resolve({
      sessionToken: "second-resolution-would-bypass",
    });
    return context.json({ resolved: Boolean(resolved) });
  });

  const response = await app.request("http://localhost/api/v1/people", {
    headers: { cookie: "kinship_session=test" },
  });

  assert(
    response.status === 503,
    "resolver outage reached the protected route",
  );
  assert(
    resolutions === 1,
    "guard allowed a second resolver call to bypass legal state",
  );
});

Deno.test("GOVERNANCE-001 guard leaves only resolution and bootstrap surfaces reachable", async () => {
  const legal = {
    requirements: () =>
      Promise.resolve({
        documents: [{
          content: "Required",
          documentType: "terms",
          id: ids.person,
          version: "2026-08",
        }],
        status: "ready" as const,
      }),
    publicDocument: () => Promise.resolve({ status: "not-found" as const }),
    accept: () => Promise.resolve({ status: "superseded-version" as const }),
  } as LegalAcceptance;
  const app = new Hono();
  app.use(
    "/api/v1/*",
    createLegalRequirementGuard({
      legal,
      protectedSessions: services(
        () => Promise.resolve({ items: [], status: "ready" }),
      ).protectedSessions,
    }),
  );
  for (
    const path of [
      "/api/v1/session",
      "/api/v1/legal-requirements",
      "/api/v1/legal-documents/terms",
    ]
  ) {
    app.get(path, (context) => context.body(null, 204));
  }
  for (
    const path of [
      "/api/v1/legal-acceptances",
      "/api/v1/sign-out",
      "/api/v1/registrations",
      "/api/v1/sessions",
    ]
  ) {
    app.post(path, (context) => context.body(null, 204));
  }
  for (
    const [method, path] of [
      ["GET", "/api/v1/session"],
      ["GET", "/api/v1/legal-requirements"],
      ["GET", "/api/v1/legal-documents/terms"],
      ["POST", "/api/v1/legal-acceptances"],
      ["POST", "/api/v1/sign-out"],
      ["POST", "/api/v1/registrations"],
      ["POST", "/api/v1/sessions"],
    ] as const
  ) {
    const response = await app.request(`http://localhost${path}`, {
      headers: { cookie: "kinship_session=test" },
      method,
    });
    assert(response.status === 204, `${method} ${path} was blocked`);
  }
});
