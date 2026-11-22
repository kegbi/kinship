import { createJournalRoutes } from "./routes.ts";
import type { LifeEventManagement, StoredLifeEvent } from "../../public.ts";
import * as fixtures from "../../../../testing/fixtures.ts";

const actor = fixtures.actor();
const personId = fixtures.personId();
const lifeEventId = "00000000-0000-4000-8000-0000000000e1";
const now = "2026-09-27T10:00:00.000000Z";
const stored: StoredLifeEvent = {
  createdAt: now,
  id: lifeEventId,
  month: 6,
  name: "Moved to Lisbon",
  personId,
  precision: "year_month",
  typeId: "7d0b0a3e-8f1c-4c4b-9c55-0d9e3c1f2a10",
  typeName: "Relocation",
  updatedAt: now,
  year: 2019,
};

type Call = readonly [string, readonly unknown[]];

function app(lifeEvents: LifeEventManagement) {
  const context = { ...actor, workspaceName: "Life events" };
  const routes = createJournalRoutes({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    journal: {} as never,
    lifeEvents,
    protectedSessions: {
      resolve: () =>
        Promise.resolve({ ...context, accessibleWorkspaces: [context] }),
    },
    timeline: {} as never,
  });
  return (
    path: string,
    method: string,
    body?: unknown,
    origin = "http://localhost",
  ) =>
    routes.request(`http://localhost${path}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        cookie: "kinship_session=valid",
        "content-type": "application/json",
        origin,
      },
      method,
    });
}

function recording(
  answer: (name: string) => unknown,
): { readonly calls: Call[]; readonly lifeEvents: LifeEventManagement } {
  const calls: Call[] = [];
  const method = (name: string) => (...args: unknown[]) => {
    calls.push([name, args.slice(1)]);
    return Promise.resolve(answer(name));
  };
  return {
    calls,
    lifeEvents: {
      create: method("create"),
      delete: method("delete"),
      update: method("update"),
    } as unknown as LifeEventManagement,
  };
}

const path = `/api/v1/people/${personId}/life-events`;

Deno.test("[JOURNAL-002] life-event routes carry only the named components each way", async () => {
  const { calls, lifeEvents } = recording((name) =>
    name === "create"
      ? { event: stored, status: "created" }
      : name === "update"
      ? {
        event: {
          ...stored,
          happenedAt: "2019-06-01T00:00:00.000000Z",
          note: "Sunny",
        },
        status: "updated",
      }
      : { lifeEventId, status: "deleted" }
  );
  const call = app(lifeEvents);

  const created = await call(path, "POST", {
    month: 6,
    name: " Moved to Lisbon ",
    precision: "year_month",
    typeId: stored.typeId,
    year: 2019,
  });
  const createdBody = await created.json();
  const updated = await call(`${path}/${lifeEventId}`, "PATCH", {
    expectedUpdatedAt: now,
    note: "Sunny",
    precision: "unknown",
  });
  const updatedBody = await updated.json();
  const deleted = await call(`${path}/${lifeEventId}`, "DELETE", {
    expectedUpdatedAt: now,
  });

  if (
    created.status !== 201 ||
    created.headers.get("cache-control") !== "private, no-store" ||
    JSON.stringify(createdBody) !== JSON.stringify({
        event: {
          date: { month: 6, precision: "year_month", year: 2019 },
          id: lifeEventId,
          name: "Moved to Lisbon",
          typeId: stored.typeId,
          typeName: "Relocation",
          updatedAt: now,
        },
        status: "created",
      })
  ) throw new Error(`create answered ${JSON.stringify(createdBody)}`);
  if (
    updated.status !== 200 || updatedBody.event.note !== "Sunny" ||
    updatedBody.event.date.happenedAt !== "2019-06-01T00:00:00.000000Z"
  ) throw new Error(`update answered ${JSON.stringify(updatedBody)}`);
  if (
    deleted.status !== 200 ||
    JSON.stringify(await deleted.json()) !==
      JSON.stringify({ lifeEventId, status: "deleted" })
  ) throw new Error("delete did not answer the removed identifier");
  if (
    JSON.stringify(calls) !== JSON.stringify([
      ["create", [personId, {
        month: 6,
        name: "Moved to Lisbon",
        precision: "year_month",
        typeId: stored.typeId,
        year: 2019,
      }]],
      ["update", [personId, lifeEventId, {
        note: "Sunny",
        precision: "unknown",
        expectedUpdatedAt: now,
      }]],
      ["delete", [personId, lifeEventId, { expectedUpdatedAt: now }]],
    ])
  ) throw new Error(`the use case was asked ${JSON.stringify(calls)}`);
});

Deno.test("[JOURNAL-002] life-event refusals are stable problems", async () => {
  const statuses = [
    "archived-write-rejected",
    "forbidden",
    "hidden",
    "not-found",
    "stale",
    "unavailable",
  ];
  const expected = [
    [409, "archived_write_rejected"],
    [403, "life_events_forbidden"],
    [403, "life_events_forbidden"],
    [404, "life_event_not_found"],
    [409, "life_event_stale"],
    [503, "life_events_unavailable"],
  ];
  for (const [index, status] of statuses.entries()) {
    const { lifeEvents } = recording(() => ({ status }));
    const call = app(lifeEvents);
    for (
      const answer of [
        await call(path, "POST", { name: "Moved", precision: "unknown" }),
        await call(`${path}/${lifeEventId}`, "PATCH", {
          expectedUpdatedAt: now,
          name: "Moved",
          precision: "unknown",
        }),
        await call(`${path}/${lifeEventId}`, "DELETE", {
          expectedUpdatedAt: now,
        }),
      ]
    ) {
      const problem = await answer.json();
      if (
        answer.status !== expected[index]![0] ||
        problem.code !== expected[index]![1] ||
        answer.headers.get("content-type") !== "application/problem+json"
      ) {
        throw new Error(
          `${status} answered ${answer.status} ${JSON.stringify(problem)}`,
        );
      }
    }
  }

  const { calls, lifeEvents } = recording(() => ({
    errors: { name: "Enter a name or choose a type." },
    status: "validation-error",
  }));
  const call = app(lifeEvents);
  const refused = await call(path, "POST", { precision: "unknown" });
  const refusedBody = await refused.json();
  const malformed = await call(path, "POST", {
    precision: "sometime",
    year: 1.5,
  });
  const malformedBody = await malformed.json();
  const unversioned = await call(`${path}/${lifeEventId}`, "PATCH", {
    name: "Moved",
    precision: "unknown",
  });
  const badDelete = await call(`${path}/${lifeEventId}`, "DELETE", {});
  const badPerson = await call(
    "/api/v1/people/not-a-person/life-events",
    "POST",
    { name: "Moved", precision: "unknown" },
  );
  const badEvent = await call(`${path}/not-an-event`, "DELETE", {
    expectedUpdatedAt: now,
  });
  const foreignOrigin = await call(
    path,
    "POST",
    { name: "Moved", precision: "unknown" },
    "http://attacker.test",
  );
  if (
    refused.status !== 400 || refusedBody.code !== "validation_failed" ||
    refusedBody.errors.name !== "Enter a name or choose a type." ||
    malformed.status !== 400 || !malformedBody.errors.precision ||
    !malformedBody.errors.year || unversioned.status !== 400 ||
    badDelete.status !== 400 || badPerson.status !== 404 ||
    badEvent.status !== 404 || foreignOrigin.status !== 403 ||
    calls.length !== 1
  ) {
    throw new Error(
      `refused bodies reached the use case or answered wrongly: ${
        JSON.stringify([
          refused.status,
          malformed.status,
          unversioned.status,
          badDelete.status,
          badPerson.status,
          badEvent.status,
          foreignOrigin.status,
          calls.length,
        ])
      }`,
    );
  }
});

Deno.test("[JOURNAL-002] a full date and a note travel both ways; unparsable ids are concealed", async () => {
  const full: StoredLifeEvent = {
    createdAt: now,
    day: 4,
    id: lifeEventId,
    month: 3,
    note: "Leeds",
    personId,
    precision: "full",
    updatedAt: now,
    year: 1990,
  };
  const { calls, lifeEvents } = recording(() => ({
    event: full,
    status: "created",
  }));
  const call = app(lifeEvents);
  const created = await call(path, "POST", {
    day: 4,
    month: 3,
    note: "Leeds",
    precision: "full",
    year: 1990,
  });
  const body = await created.json();
  const badPerson = await call(
    `/api/v1/people/not-a-person/life-events/${lifeEventId}`,
    "PATCH",
    { expectedUpdatedAt: now, name: "Moved", precision: "unknown" },
  );
  if (
    created.status !== 201 ||
    JSON.stringify(body.event) !== JSON.stringify({
        date: { day: 4, month: 3, precision: "full", year: 1990 },
        id: lifeEventId,
        note: "Leeds",
        updatedAt: now,
      }) ||
    JSON.stringify(calls[0]?.[1]) !== JSON.stringify([personId, {
        day: 4,
        month: 3,
        note: "Leeds",
        precision: "full",
        year: 1990,
      }]) ||
    badPerson.status !== 404 || calls.length !== 1
  ) throw new Error(`answered ${JSON.stringify(body)} ${badPerson.status}`);
});

Deno.test("[MCP-B6] life-event writes admit a people:write token and never borrow the cookie", async () => {
  const tokenId = "00000000-0000-4000-8000-0000000000aa";
  const asked: string[] = [];
  const acted: (string | undefined)[] = [];
  const answer = (value: unknown) => (who: { apiTokenId?: string }) => {
    acted.push(who.apiTokenId);
    return Promise.resolve(value);
  };
  const context = { ...actor, workspaceName: "Life events" };
  const routes = createJournalRoutes({
    apiTokens: {
      authenticate: (token: string, scope: string) => {
        asked.push(scope);
        return Promise.resolve(
          token === scope
            ? { actor, status: "authenticated" as const, tokenId }
            : { status: "invalid" as const },
        );
      },
    },
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    journal: {} as never,
    lifeEvents: {
      create: answer({ event: stored, status: "created" }),
      delete: answer({ lifeEventId, status: "deleted" }),
      update: answer({ event: stored, status: "updated" }),
    } as unknown as LifeEventManagement,
    protectedSessions: {
      resolve: () =>
        Promise.resolve({ ...context, accessibleWorkspaces: [context] }),
    },
    timeline: {} as never,
  });
  const writes = [
    ["POST", path, { name: "Moved", precision: "unknown" }, 201],
    ["PATCH", `${path}/${lifeEventId}`, {
      expectedUpdatedAt: now,
      name: "Moved",
      precision: "unknown",
    }, 200],
    ["DELETE", `${path}/${lifeEventId}`, { expectedUpdatedAt: now }, 200],
  ] as const;
  for (const [method, target, body, status] of writes) {
    const send = (headers: Record<string, string>, payload: unknown = body) =>
      routes.request(`http://localhost${target}`, {
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json", ...headers },
        method,
      });
    const label = `${method} ${target}`;
    acted.length = 0;
    const admitted = await send({ authorization: "Bearer people:write" });
    if (admitted.status !== status || acted[0] !== tokenId) {
      throw new Error(`${label} bearer answered ${admitted.status}`);
    }
    for (
      const wrong of [
        "journal:write",
        "people:read",
        "people:delete",
        "revoked",
      ]
    ) {
      const refused = await send({
        authorization: `Bearer ${wrong}`,
        cookie: "kinship_session=valid",
        origin: "http://localhost",
      });
      if (refused.status !== 401) {
        throw new Error(`${label} admitted ${wrong}: ${refused.status}`);
      }
    }
    const early = await send({ authorization: "Bearer journal:write" }, {});
    if (early.status !== 401) {
      throw new Error(`${label} judged a refused token's body first`);
    }
    for (const origin of [undefined, "http://attacker.test"]) {
      const foreign = await send({
        cookie: "kinship_session=valid",
        ...(origin ? { origin } : {}),
      });
      if (foreign.status !== 403) {
        throw new Error(`${label} cookie write without Origin admitted`);
      }
    }
    acted.length = 0;
    const cookie = await send({
      cookie: "kinship_session=valid",
      origin: "http://localhost",
    });
    if (cookie.status !== status || acted[0] !== undefined) {
      throw new Error(`${label} cookie write answered ${cookie.status}`);
    }
  }
  if (!asked.every((scope) => scope === "people:write")) {
    throw new Error(`a life-event write asked for ${asked}`);
  }
});
