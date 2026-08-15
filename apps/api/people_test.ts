import { type ApiServices, createApiApp } from "./composition.ts";
import type { PeopleManagement } from "../../packages/backend/modules/people/public.ts";
import { createPeopleRoutes, type PeopleHttpServices } from "./people.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("PEOPLE-001 person creation requires an active session", async () => {
  const app = createApiApp({
    browserSecurity: {
      origin: "http://localhost",
      secureCookie: false,
    },
    people: {
      create: () => Promise.reject(new Error("must not be called")),
    },
    protectedSessions: {
      resolve: () => Promise.resolve(undefined),
    },
  } as unknown as ApiServices);

  const response = await app.request("http://localhost/api/v1/people", {
    body: JSON.stringify({ givenName: "Ada", isPartial: false }),
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    method: "POST",
  });

  assert(
    response.status === 401,
    `expected protected route status 401, received ${response.status}`,
  );
});

const actor = {
  accessibleWorkspaces: [],
  memberId: "00000000-0000-4000-8000-000000000002",
  role: "member" as const,
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000003",
  workspaceName: "Circle",
};

function services(
  people: Pick<PeopleManagement, "create"> & Partial<PeopleManagement>,
): PeopleHttpServices {
  return {
    browserSecurity: {
      origin: "http://localhost",
      secureCookie: false,
    },
    people: {
      get: () => Promise.resolve({ status: "not-found" }),
      ...people,
    },
    protectedSessions: { resolve: () => Promise.resolve(actor) },
  };
}

const headers = {
  cookie: "kinship_session=current-token",
  "content-type": "application/json",
  origin: "http://localhost",
  "X-Workspace-Id": actor.workspaceId,
};

Deno.test("PEOPLE-001 HTTP creates in only the resolved active workspace", async () => {
  let received: Parameters<PeopleManagement["create"]> | undefined;
  const app = createPeopleRoutes(services({
    create: (resolved, input) => {
      received = [resolved, input];
      return Promise.resolve({
        person: {
          familyName: "Lovelace",
          givenName: "Ada",
          id: "00000000-0000-4000-8000-000000000100",
          isPartial: false,
        },
        status: "created",
      });
    },
  }));
  const response = await app.request("http://localhost/api/v1/people", {
    body: JSON.stringify({
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    }),
    headers,
    method: "POST",
  });
  const body = await response.json() as { readonly next: string };
  assert(response.status === 201, "created response");
  assert(
    body.next === "/app/people/00000000-0000-4000-8000-000000000100",
    "canonical next route returned",
  );
  assert(
    received?.[0].workspaceId === actor.workspaceId &&
      received?.[1].givenName === "Ada",
    "body workspace is never authorization evidence",
  );
  assert(
    response.headers.get("cache-control") === "private, no-store",
    "person response is private",
  );
});

Deno.test("PEOPLE-001 HTTP reads canonical identity only in the resolved workspace", async () => {
  const personId = "00000000-0000-4000-8000-000000000100";
  let received: unknown;
  const app = createPeopleRoutes(services({
    create: () => Promise.reject(new Error("must not create")),
    get: (resolved: unknown, id: string) => {
      received = [resolved, id];
      return Promise.resolve({
        person: {
          familyName: "Lovelace",
          givenName: "Ada",
          id: personId,
          isPartial: false,
        },
        status: "ready",
      });
    },
  } as unknown as PeopleManagement));
  const response = await app.request(
    `http://localhost/api/v1/people/${personId}`,
    { headers },
  );
  const body = await response.json() as {
    readonly person?: { readonly id: string };
    readonly status?: string;
  };
  assert(response.status === 200, "canonical person identity is readable");
  assert(
    body.status === "ready" && body.person?.id === personId,
    "ready identity is returned",
  );
  assert(
    (received as [typeof actor, string])?.[0].workspaceId ===
        actor.workspaceId &&
      (received as [typeof actor, string])?.[1] === personId,
    "resolved actor and route ID reach the public application facade",
  );
  assert(
    response.headers.get("cache-control") === "private, no-store",
    "person identity response is private",
  );
});

Deno.test("PEOPLE-001 HTTP maps canonical identity read states safely", async () => {
  const personId = "00000000-0000-4000-8000-000000000100";
  for (
    const scenario of [
      { expected: 403, status: "forbidden" as const },
      { expected: 404, status: "not-found" as const },
    ]
  ) {
    const app = createPeopleRoutes(services({
      create: () => Promise.reject(new Error("must not create")),
      get: () => Promise.resolve({ status: scenario.status }),
    }));
    const response = await app.request(
      `http://localhost/api/v1/people/${personId}`,
      { headers },
    );
    assert(response.status === scenario.expected, "read state maps safely");
    assert(
      response.headers.get("content-type") === "application/problem+json",
      "read failure uses problem details",
    );
  }

  const unavailable = createPeopleRoutes(services({
    create: () => Promise.reject(new Error("must not create")),
    get: () => Promise.reject(new Error("private dependency detail")),
  }));
  const unavailableResponse = await unavailable.request(
    `http://localhost/api/v1/people/${personId}`,
    { headers },
  );
  assert(unavailableResponse.status === 503, "read dependency failure retries");
  assert(
    !(await unavailableResponse.text()).includes("private dependency detail"),
    "read dependency detail stays private",
  );

  const malformed = await unavailable.request(
    "http://localhost/api/v1/people/not-a-uuid",
    { headers },
  );
  assert(malformed.status === 400, "malformed canonical ID is rejected");
});

Deno.test("PEOPLE-001 HTTP maps validation, duplicate, denial, and dependency outcomes", async () => {
  for (
    const scenario of [
      {
        result: {
          errors: { isPartial: "Mark partial." },
          status: "validation-error" as const,
        },
        expected: 400,
      },
      {
        result: {
          duplicates: [{
            displayName: "Ada Lovelace",
            id: "00000000-0000-4000-8000-000000000099",
          }],
          status: "possible-duplicate" as const,
        },
        expected: 409,
      },
      { result: { status: "forbidden" as const }, expected: 403 },
    ]
  ) {
    const app = createPeopleRoutes(services({
      create: () => Promise.resolve(scenario.result),
    }));
    const response = await app.request("http://localhost/api/v1/people", {
      body: JSON.stringify({ givenName: "Ada", isPartial: false }),
      headers,
      method: "POST",
    });
    assert(response.status === scenario.expected, "application result maps");
    assert(
      response.headers.get("content-type") === "application/problem+json",
      "non-success uses problem details",
    );
  }

  const unavailable = createPeopleRoutes(services({
    create: () => Promise.reject(new Error("private dependency detail")),
  }));
  const response = await unavailable.request(
    "http://localhost/api/v1/people",
    {
      body: JSON.stringify({ givenName: "Ada", isPartial: false }),
      headers,
      method: "POST",
    },
  );
  assert(response.status === 503, "dependency failure is safe and retryable");
  assert(
    !(await response.text()).includes("private dependency detail"),
    "safe problem",
  );
});

Deno.test("PEOPLE-001 HTTP rejects forged origin and malformed identity before use case", async () => {
  let calls = 0;
  const app = createPeopleRoutes(services({
    create: () => {
      calls += 1;
      return Promise.resolve({ status: "forbidden" });
    },
  }));
  const forged = await app.request("http://localhost/api/v1/people", {
    body: JSON.stringify({ givenName: "Ada", isPartial: false }),
    headers: { ...headers, origin: "https://attacker.invalid" },
    method: "POST",
  });
  const malformed = await app.request("http://localhost/api/v1/people", {
    body: JSON.stringify({
      givenName: "Ada",
      isPartial: false,
      workspaceId: actor.workspaceId,
    }),
    headers,
    method: "POST",
  });
  assert(forged.status === 403, "exact origin required");
  assert(malformed.status === 400, "unknown body fields rejected");
  assert(calls === 0, "invalid requests do not invoke application behavior");
});
