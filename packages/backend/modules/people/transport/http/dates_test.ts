/**
 * The dates a person is remembered by, and the precision they are known to.
 *
 * The transport must carry exactly the components the stated precision
 * declares and invent none of the others, in both directions.
 */

import type { ImportantDateManagement } from "../../public.ts";
import { createPeopleRoutes } from "./routes.ts";
import { assert, assertStatus } from "../../../../testing/assert.ts";
import * as fixtures from "../../../../testing/fixtures.ts";
import { actor, headers, services } from "./people.test-helper.ts";

Deno.test("PEOPLE-005 HTTP preserves precision across list, create, update, and delete", async () => {
  const personId = fixtures.personId();
  const date = {
    createdAt: "2026-08-15T12:00:00.000000Z",
    id: "00000000-0000-4000-8000-000000000200",
    isAgeBased: true,
    isYearApproximate: true,
    kind: "birthday" as const,
    personId,
    precision: "year" as const,
    scheduling: "not-schedulable" as const,
    updatedAt: "2026-08-15T12:00:00.000000Z",
    year: 1984,
  };
  let createdInput: unknown;
  const importantDates: ImportantDateManagement = {
    create: (_actor, _personId, input) => {
      createdInput = input;
      return Promise.resolve({ date, status: "created" });
    },
    delete: () => Promise.resolve({ dateId: date.id, status: "deleted" }),
    list: () => Promise.resolve({ dates: [date], status: "ready" }),
    update: (_actor, _personId, _dateId, input) =>
      Promise.resolve({
        date: { ...date, ...input, scheduling: "not-schedulable" },
        status: "updated",
      }),
  };
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create person")) },
    undefined,
    undefined,
    undefined,
    importantDates,
  ));
  const listed = await app.request(
    `http://localhost/api/v1/people/${personId}/dates`,
    { headers },
  );
  assert(
    listed.status === 200 &&
      (await listed.json() as { dates: typeof date[] }).dates[0]
          ?.isYearApproximate === true,
    "list keeps approximation explicit",
  );
  const body = JSON.stringify({
    isAgeBased: true,
    isYearApproximate: true,
    kind: "birthday",
    precision: "year",
    year: 1984,
  });
  const created = await app.request(
    `http://localhost/api/v1/people/${personId}/dates`,
    { body, headers, method: "POST" },
  );
  assertStatus(created, 201, "create route is ready");
  assert(
    (createdInput as { year?: number; month?: number }).year === 1984 &&
      !("month" in (createdInput as object)),
    "transport does not invent missing components",
  );
  const updated = await app.request(
    `http://localhost/api/v1/people/${personId}/dates/${date.id}`,
    {
      body: JSON.stringify({
        ...JSON.parse(body),
        expectedUpdatedAt: date.updatedAt,
      }),
      headers,
      method: "PATCH",
    },
  );
  assertStatus(updated, 200, "update route is ready");
  const deleted = await app.request(
    `http://localhost/api/v1/people/${personId}/dates/${date.id}`,
    {
      body: JSON.stringify({ expectedUpdatedAt: date.updatedAt }),
      headers,
      method: "DELETE",
    },
  );
  assertStatus(deleted, 200, "delete route is ready");
});

Deno.test("PEOPLE-005 HTTP maps invalid precision, conflicts, stale versions, and tenancy safely", async () => {
  const personId = fixtures.personId();
  let calls = 0;
  const base: ImportantDateManagement = {
    create: () => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? {
            errors: { month: "Remove month; it contradicts year precision." },
            status: "validation-error",
          }
          : { status: "conflict" },
      );
    },
    delete: () => Promise.resolve({ status: "stale" }),
    list: () => Promise.resolve({ status: "not-found" }),
    update: () => Promise.resolve({ status: "forbidden" }),
  };
  const app = createPeopleRoutes(services(
    { create: () => Promise.reject(new Error("must not create person")) },
    undefined,
    undefined,
    undefined,
    base,
  ));
  const invalid = await app.request(
    `http://localhost/api/v1/people/${personId}/dates`,
    {
      body: JSON.stringify({
        isAgeBased: false,
        isYearApproximate: false,
        kind: "birthday",
        month: 2,
        precision: "year",
        year: 2020,
      }),
      headers,
      method: "POST",
    },
  );
  assert(invalid.status === 400 && calls === 1, "domain shape error is safe");
  const conflict = await app.request(
    `http://localhost/api/v1/people/${personId}/dates`,
    {
      body: JSON.stringify({
        isAgeBased: false,
        isYearApproximate: false,
        kind: "birthday",
        precision: "unknown",
      }),
      headers,
      method: "POST",
    },
  );
  assertStatus(conflict, 409, "singleton conflict is explicit");
  const concealed = await app.request(
    `http://localhost/api/v1/people/${personId}/dates`,
    { headers },
  );
  assertStatus(concealed, 404, "cross-workspace person is concealed");
});

Deno.test("[MCP-B2] important-date writes admit only a people:write bearer and keep the cookie Origin", async () => {
  const personId = fixtures.personId();
  const tokenId = "00000000-0000-4000-8000-0000000000bb";
  const date = {
    createdAt: "2026-08-15T12:00:00.000000Z",
    id: "00000000-0000-4000-8000-000000000200",
    isAgeBased: false,
    isYearApproximate: false,
    kind: "birthday" as const,
    month: 12,
    personId,
    precision: "month_day" as const,
    day: 10,
    scheduling: "annual-reminder" as const,
    updatedAt: "2026-08-15T12:00:00.000000Z",
  };
  const calls: string[] = [];
  const importantDates: ImportantDateManagement = {
    create: (resolved) => {
      calls.push(`create:${resolved.apiTokenId}`);
      return Promise.resolve({ date, status: "created" });
    },
    delete: (resolved) => {
      calls.push(`delete:${resolved.apiTokenId}`);
      return Promise.resolve({ dateId: date.id, status: "deleted" });
    },
    list: () => Promise.reject(new Error("a write grant must not read")),
    update: (resolved) => {
      calls.push(`update:${resolved.apiTokenId}`);
      return Promise.resolve({ date, status: "updated" });
    },
  };
  let sessionCalls = 0;
  const base = services(
    { create: () => Promise.reject(new Error("must not create person")) },
    undefined,
    undefined,
    undefined,
    importantDates,
  );
  const app = createPeopleRoutes({
    ...base,
    apiTokens: {
      authenticate: (token, scope: string) =>
        Promise.resolve(
          (token === "write" && scope === "people:write") ||
            (token === "profile" && scope === "people:profile:read")
            ? { actor, status: "authenticated" as const, tokenId }
            : { status: "invalid" as const },
        ),
    },
    protectedSessions: {
      resolve: () => {
        sessionCalls++;
        return Promise.resolve(actor);
      },
    },
  });
  const value = {
    day: 10,
    isAgeBased: false,
    isYearApproximate: false,
    kind: "birthday",
    month: 12,
    precision: "month_day",
  };
  const writes = [
    ["POST", "dates", value, 201],
    ["PATCH", `dates/${date.id}`, {
      ...value,
      expectedUpdatedAt: date.updatedAt,
    }, 200],
    ["DELETE", `dates/${date.id}`, { expectedUpdatedAt: date.updatedAt }, 200],
  ] as const;
  const send = (
    method: string,
    suffix: string,
    body: unknown,
    extra: Record<string, string>,
  ) =>
    app.request(`http://localhost/api/v1/people/${personId}/${suffix}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...extra },
      method,
    });

  for (const [method, suffix, body, status] of writes) {
    assertStatus(
      await send(method, suffix, body, { authorization: "Bearer write" }),
      status,
      `${method} ${suffix}: a people:write bearer needs no Origin or cookie`,
    );
    for (
      const authorization of [
        "Bearer profile",
        "Bearer directory",
        "Bearer malformed",
      ]
    ) {
      assertStatus(
        await send(method, suffix, body, {
          authorization,
          cookie: headers.cookie,
          origin: headers.origin,
        }),
        401,
        `${method} ${suffix}: ${authorization} is refused and never borrows the cookie`,
      );
    }
    assertStatus(
      await send(method, suffix, { precision: "never" }, {
        authorization: "Bearer write",
      }),
      400,
      `${method} ${suffix}: a bearer write keeps the body validation answer`,
    );
  }
  assert(
    JSON.stringify(calls) ===
        JSON.stringify(
          ["create", "update", "delete"].map((use) => `${use}:${tokenId}`),
        ) && sessionCalls === 0,
    "only the granted bearer reached the use cases, naming its token, and no cookie was read",
  );
  assertStatus(
    await app.request(`http://localhost/api/v1/people/${personId}/dates`, {
      headers: { authorization: "Bearer write" },
    }),
    401,
    "a write grant does not imply the people:profile:read list",
  );

  for (const [method, suffix, body, status] of writes) {
    assertStatus(
      await send(method, suffix, body, { cookie: headers.cookie }),
      403,
      `${method} ${suffix}: a cookie write still needs the exact Origin`,
    );
    assertStatus(
      await send(method, suffix, { precision: "never" }, {
        cookie: headers.cookie,
        origin: "http://attacker.test",
      }),
      403,
      `${method} ${suffix}: a cookie write answers its Origin before its body`,
    );
    assertStatus(
      await send(method, suffix, body, {
        cookie: headers.cookie,
        origin: headers.origin,
      }),
      status,
      `${method} ${suffix}: a same-origin cookie write is unchanged`,
    );
  }
});
