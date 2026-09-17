/**
 * Creating a person and the session that has to be behind it.
 *
 * Creation is the only route that can warn rather than refuse, so the
 * duplicate warning and the override that answers it are pinned here.
 */

import { type ApiServices, createApiApp } from "../composition.ts";
import type {
  PeopleManagement,
} from "../../../packages/backend/modules/people/public.ts";
import { createPeopleRoutes } from "../people.ts";
import {
  assert,
  assertStatus,
} from "../../../packages/backend/testing/assert.ts";
import { actor, headers, services } from "./people.test-helper.ts";

Deno.test("PEOPLE-001 person creation requires an active session", async () => {
  const app = createApiApp({
    browserSecurity: {
      origin: "http://localhost",
      secureCookie: false,
    },
    directory: {
      list: () => Promise.reject(new Error("must not be called")),
    },
    tagOptions: {
      list: () => Promise.reject(new Error("must not be called")),
    },
    people: {
      archive: () => Promise.reject(new Error("must not be called")),
      create: () => Promise.reject(new Error("must not be called")),
      delete: () => Promise.reject(new Error("must not be called")),
      edit: () => Promise.reject(new Error("must not be called")),
      previewDeletion: () => Promise.reject(new Error("must not be called")),
      restore: () => Promise.reject(new Error("must not be called")),
    },
    profile: {
      get: () => Promise.reject(new Error("must not be called")),
      listLifeEvents: () => Promise.reject(new Error("must not be called")),
      listTimeline: () => Promise.reject(new Error("must not be called")),
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

  assertStatus(response, 401, "the protected route refuses an absent session");
});

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
  assertStatus(response, 201, "created response");
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
  assertStatus(response, 503, "dependency failure is safe and retryable");
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
  assertStatus(forged, 403, "exact origin required");
  assertStatus(malformed, 400, "unknown body fields rejected");
  assert(calls === 0, "invalid requests do not invoke application behavior");
});
