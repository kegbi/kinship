import { Hono } from "hono";
import type { AuditHistory } from "../../../../read-models/audit-history/public.ts";
import type { LegalAcceptance } from "../../public.ts";
import {
  createGovernanceRoutes,
  createLegalRequirementGuard,
} from "./routes.ts";
import { assert, assertStatus } from "../../../../testing/assert.ts";
import {
  type ActorEnv,
  requireTokenOrSessionActor,
} from "../../../../../http-kit/session.ts";

const ids = {
  actor: "00000000-0000-4000-8000-000000000002",
  event: "00000000-0000-4000-8000-000000000901",
  person: "00000000-0000-4000-8000-000000000100",
  user: "00000000-0000-4000-8000-000000000001",
  workspace: "00000000-0000-4000-8000-000000000003",
};

const LOOPBACK = { origin: "http://127.0.0.1:4321", secureCookie: false };

function services(
  list: AuditHistory["list"],
  role: "admin" | "member" | "owner" = "owner",
  legal?: LegalAcceptance,
) {
  return {
    auditHistory: { list } as AuditHistory,
    browserSecurity: LOOPBACK,
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

  assertStatus(publicDocument, 200, "active public document was hidden");
  assertStatus(requirements, 200, "required versions were unavailable");
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
  assertStatus(wrongOrigin, 403, "cross-origin acceptance was allowed");
  assertStatus(stale, 409, "superseded version was accepted");
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
  assertStatus(response, 200);
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
  assertStatus(anonymous, 401, "anonymous audit access was not rejected");
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
      browserSecurity: LOOPBACK,
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

  assertStatus(pending, 403, "pending acceptance reached protected API");
  assertStatus(unavailable, 503, "requirement outage bypassed protection");
  assertStatus(ready, 200, "satisfied requirement remained blocked");
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
      browserSecurity: LOOPBACK,
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

  assertStatus(response, 503, "resolver outage reached the protected route");
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
      browserSecurity: LOOPBACK,
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
    assertStatus(response, 204, `${method} ${path} was blocked`);
  }
});

Deno.test("[GAP-020] every legal and audit route refuses without a session or a document", async () => {
  const unavailable = {
    accept: () => Promise.resolve({ status: "unavailable" as const }),
    publicDocument: () => Promise.resolve({ status: "unavailable" as const }),
    requirements: () => Promise.resolve({ status: "unavailable" as const }),
  } as unknown as LegalAcceptance;
  const forbidden = {
    accept: () => Promise.resolve({ status: "forbidden" as const }),
    publicDocument: () => Promise.resolve({ status: "unavailable" as const }),
    requirements: () => Promise.resolve({ status: "forbidden" as const }),
  } as unknown as LegalAcceptance;
  const audit = () => Promise.resolve({ items: [], status: "ready" as const });
  const anonymous = {
    ...services(audit, "owner", unavailable),
    protectedSessions: { resolve: () => Promise.resolve(undefined) },
  };
  const accepting = {
    body: JSON.stringify({ documentId: ids.person }),
    headers: {
      "content-type": "application/json",
      cookie: "kinship_session=test",
      origin: "http://127.0.0.1:4321",
    },
    method: "POST",
  };

  const outages = createGovernanceRoutes(services(audit, "owner", unavailable));
  const refusals = createGovernanceRoutes(services(audit, "owner", forbidden));
  const signedOut = createGovernanceRoutes(anonymous);

  for (
    const scenario of [
      {
        app: outages,
        expected: 503,
        path: "/api/v1/legal-documents/terms",
        request: {},
      },
      {
        app: outages,
        expected: 503,
        path: "/api/v1/legal-requirements",
        request: { headers: { cookie: "kinship_session=test" } },
      },
      {
        app: refusals,
        expected: 403,
        path: "/api/v1/legal-requirements",
        request: { headers: { cookie: "kinship_session=test" } },
      },
      {
        app: signedOut,
        expected: 401,
        path: "/api/v1/legal-requirements",
        request: { headers: { cookie: "kinship_session=test" } },
      },
      {
        app: outages,
        expected: 503,
        path: "/api/v1/legal-acceptances",
        request: accepting,
      },
      {
        app: refusals,
        expected: 403,
        path: "/api/v1/legal-acceptances",
        request: accepting,
      },
      {
        app: signedOut,
        expected: 401,
        path: "/api/v1/legal-acceptances",
        request: accepting,
      },
      {
        app: signedOut,
        expected: 401,
        path: "/api/v1/audit-events",
        request: { headers: { cookie: "kinship_session=test" } },
      },
      {
        app: outages,
        expected: 400,
        path: "/api/v1/audit-events?limit=500",
        request: { headers: { cookie: "kinship_session=test" } },
      },
      {
        app: outages,
        expected: 400,
        path: `/api/v1/people/not-a-uuid/audit`,
        request: { headers: { cookie: "kinship_session=test" } },
      },
    ]
  ) {
    const response = await scenario.app.request(
      `http://localhost${scenario.path}`,
      scenario.request,
    );
    assertStatus(
      response,
      scenario.expected,
      `${scenario.path} answered the wrong refusal`,
    );
  }
});

Deno.test("[GAP-020] the legal guard refuses everything while it cannot see", async () => {
  const legal = {
    accept: () => Promise.resolve({ status: "unavailable" as const }),
    publicDocument: () => Promise.resolve({ status: "not-found" as const }),
    requirements: () =>
      Promise.resolve({ documents: [], status: "ready" as const }),
  } as unknown as LegalAcceptance;
  const guard = (resolve: () => Promise<unknown>) => {
    const app = new Hono();
    app.use(
      "/api/v1/*",
      createLegalRequirementGuard({
        browserSecurity: LOOPBACK,
        legal,
        protectedSessions: {
          resolve,
        } as ReturnType<typeof services>["protectedSessions"],
      }),
    );
    app.get("/api/v1/people", (context) => context.body(null, 204));
    return app;
  };
  const headers = { cookie: "kinship_session=test" };

  const outage = await guard(() => Promise.reject(new Error("offline")))
    .request("http://localhost/api/v1/people", { headers });
  const anonymous = await guard(() => Promise.resolve(undefined)).request(
    "http://localhost/api/v1/people",
  );

  assertStatus(outage, 503, "a session store that will not answer blocks");
  assertStatus(anonymous, 204, "nobody is passed on to the route that refuses");
});

Deno.test("[INTEGRATION-002] the calendar feed never waits on a session's legal acceptance", async () => {
  let asked = 0;
  const legal = {
    requirements: () => {
      asked += 1;
      return Promise.resolve({
        documents: [{
          content: "Required",
          documentType: "terms",
          id: ids.person,
          version: "2026-09",
        }],
        status: "ready" as const,
      });
    },
    publicDocument: () => Promise.resolve({ status: "not-found" as const }),
    accept: () => Promise.resolve({ status: "superseded-version" as const }),
  } as LegalAcceptance;
  const app = new Hono();
  app.use(
    "/api/v1/*",
    createLegalRequirementGuard({
      browserSecurity: LOOPBACK,
      legal,
      protectedSessions: services(
        () => Promise.resolve({ items: [], status: "ready" }),
      ).protectedSessions,
    }),
  );
  app.get("/api/v1/calendar-feeds/:feedFile", (context) => context.text("ok"));
  app.post("/api/v1/calendar-feeds/:feedFile", (context) => context.text("ok"));
  const feed = await app.request(
    "http://localhost/api/v1/calendar-feeds/kin_cal_x.secret.ics",
    { headers: { cookie: "kinship_session=test" } },
  );
  assertStatus(feed, 200, "a cookie beside the feed changed its answer");
  assert(asked === 0, "the guard read the session's legal state");
  const other = await app.request(
    "http://localhost/api/v1/calendar-feeds/kin_cal_x.secret.ics",
    { headers: { cookie: "kinship_session=test" }, method: "POST" },
  );
  assertStatus(other, 403, "only the feed read is exempt");
});

Deno.test("[AUD-K1] a token-admitted member owes the same legal documents", async () => {
  let mode: "pending" | "ready" | "unavailable" = "pending";
  const asked: string[] = [];
  const legal = {
    requirements: (actor: { readonly userId: string }) => {
      asked.push(actor.userId);
      return Promise.resolve(
        mode === "pending"
          ? {
            documents: [{
              content: "Required",
              documentType: "terms",
              id: ids.person,
              version: "2026-11",
            }],
            status: "ready" as const,
          }
          : mode === "ready"
          ? { documents: [], status: "ready" as const }
          : { status: "unavailable" as const },
      );
    },
    publicDocument: () => Promise.resolve({ status: "not-found" as const }),
    accept: () => Promise.resolve({ status: "superseded-version" as const }),
  } as unknown as LegalAcceptance;
  let resolutions = 0;
  const app = new Hono<ActorEnv>();
  app.use(
    "/api/v1/*",
    createLegalRequirementGuard({
      browserSecurity: LOOPBACK,
      legal,
      protectedSessions: {
        resolve: () => {
          resolutions += 1;
          return Promise.resolve(undefined);
        },
      },
    }),
  );
  app.get("/api/v1/people", async (context) => {
    const actor = await requireTokenOrSessionActor(context, {
      scope: "people:read",
      tokens: {
        authenticate: () =>
          Promise.resolve({
            actor: {
              memberId: ids.actor,
              role: "member" as const,
              userId: ids.user,
              workspaceId: ids.workspace,
            },
            status: "authenticated" as const,
            tokenId: "00000000-0000-4000-8000-0000000000aa",
          }),
      },
    });
    return actor instanceof Response ? actor : context.json({ reached: true });
  });
  const request = (headers: Record<string, string> = {}) =>
    app.request("http://localhost/api/v1/people", {
      headers: { authorization: "Bearer kinship_pat_x", ...headers },
    });

  const pending = await request();
  mode = "unavailable";
  const unavailable = await request();
  mode = "ready";
  const ready = await request();
  const malformed = await request({
    cookie: "kinship_session=test",
    "X-Workspace-Id": "not-a-uuid",
  });

  assertStatus(pending, 403, "a token reached data past a pending document");
  assert(
    (await pending.json() as { readonly code: string }).code ===
      "legal_acceptance_required",
    "the token refusal names the document",
  );
  assertStatus(unavailable, 503, "a token passed a legal outage");
  assertStatus(ready, 200, "a token with nothing outstanding was refused");
  assertStatus(malformed, 400, "a malformed header was reported as an outage");
  assert(
    asked.join(",") === [ids.user, ids.user, ids.user].join(","),
    "the token's own user is the one asked about",
  );
  assert(
    resolutions === 0,
    "a bearer request without a cookie reads no session",
  );
});
