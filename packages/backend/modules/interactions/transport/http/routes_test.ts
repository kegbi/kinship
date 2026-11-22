import type {
  CommunicationManagement,
  InteractionManagement,
} from "../../public.ts";
import type { ActivityReport } from "../../../../read-models/activity-report/public.ts";
import type { TodayInteractions } from "../../../../read-models/today/public.ts";
import { createInteractionRoutes } from "./routes.ts";
import { assert, assertStatus } from "../../../../testing/assert.ts";
import * as fixtures from "../../../../testing/fixtures.ts";
import type { ScopedTokenAuthority } from "../../../../../http-kit/session.ts";

const personId = fixtures.personId();
const otherPersonId = "00000000-0000-4000-8000-000000000101";
const requestId = "00000000-0000-4000-8000-000000000800";
const actor = fixtures.sessionActor({ workspaceName: "Circle" });

type Interactions = InteractionManagement & CommunicationManagement;

function services(overrides: Partial<Interactions> = {}) {
  const record = {
    activityType: "Shared meal",
    createdAt: "2026-08-17T12:30:00.000Z",
    emotions: [],
    happenedAt: "2026-08-16T18:15:00.000Z",
    id: "00000000-0000-4000-8000-000000000800",
    kind: "activity" as const,
    participants: [
      { id: personId, name: "Ada Lovelace" },
      { id: otherPersonId, name: "Grace Hopper" },
    ],
    summary: "Dinner together",
  };
  return {
    activityReport: {
      list: () =>
        Promise.resolve({
          items: [record],
          person: { id: personId, name: "Ada Lovelace" },
          status: "ready" as const,
        }),
    } as ActivityReport,
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    interactions: {
      communicationOptions: () =>
        Promise.resolve({
          availability: { call: true, conversation: true },
          channelTypes: [],
          emotions: [],
          status: "ready",
        }),
      listCommunications: () => Promise.resolve({ items: [], status: "ready" }),
      options: () =>
        Promise.resolve({
          activityTypes: [],
          availability: { activity: true, note: true },
          emotions: [],
          status: "ready",
        }),
      record: () => Promise.resolve({ record, status: "created" }),
      recordCommunication: () =>
        Promise.resolve({
          record: {
            calledAt: "2026-08-16T18:15:00.000Z",
            contactWasCaller: true,
            createdAt: "2026-08-17T12:30:00.000Z",
            emotions: [],
            id: requestId,
            kind: "call",
            person: { id: personId, name: "Ada Lovelace" },
          },
          status: "created",
        }),
      ...overrides,
    } as Interactions,
    protectedSessions: { resolve: () => Promise.resolve(actor) },
    today: {
      getFavoriteNotes: () =>
        Promise.resolve({
          items: [],
          status: "ready" as const,
        }),
      getRecentActivity: () =>
        Promise.resolve({
          items: [record],
          status: "ready" as const,
        }),
    } as TodayInteractions,
  };
}

const headers = {
  cookie: "kinship_session=test",
  "content-type": "application/json",
  origin: "http://localhost",
};

Deno.test("capture token admits four strict kinds and forwards bounded options without Cookie or Origin", async () => {
  const received: unknown[] = [];
  let optionInput: unknown;
  const apiTokens: ScopedTokenAuthority<"interactions:create"> = {
    authenticate: (token, scope, workspace) => {
      assert(
        token === "capture" && scope === "interactions:create",
        "exact capture grant requested",
      );
      assert(workspace === actor.workspaceId, "workspace selection forwarded");
      return Promise.resolve({
        actor,
        status: "authenticated",
        tokenId: "00000000-0000-4000-8000-0000000000aa",
      });
    },
  };
  const current = services({
    record: (actor, input) => {
      received.push(input);
      return services().interactions.record(actor, input);
    },
    recordCommunication: (actor, input) => {
      received.push(input);
      return services().interactions.recordCommunication(actor, input);
    },
    options: (actor, input) => {
      optionInput = input;
      return services().interactions.options(actor, input);
    },
  });
  const app = createInteractionRoutes({ ...current, ...{ apiTokens } });
  const tokenHeaders = {
    authorization: "Bearer capture",
    "content-type": "application/json",
    "X-Workspace-Id": actor.workspaceId,
  };
  for (
    const input of [
      { kind: "note", personId, body: "Reference", isFavorited: true },
      {
        kind: "activity",
        participantIds: [personId, otherPersonId],
        summary: "Dinner",
        happenedAt: "2026-08-16T18:15:00Z",
        activityTypeId: requestId,
        description: "Together",
        emotionIds: [requestId],
      },
      {
        kind: "call",
        personId,
        calledAt: "2026-08-16T18:15:00Z",
        contactWasCaller: false,
        content: "Plans",
        emotionIds: [requestId],
      },
      {
        kind: "conversation",
        personId,
        channelTypeId: requestId,
        contactMethodId: requestId,
        happenedAt: "2026-08-16T18:15:00Z",
        title: "Plans",
        messages: [{
          content: "Hello",
          direction: "outbound",
          writtenAt: "2026-08-16T18:15:00Z",
        }],
      },
    ]
  ) {
    const body = { ...input, requestId };
    const response = await app.request("/api/v1/interactions", {
      method: "POST",
      headers: tokenHeaders,
      body: JSON.stringify(body),
    });
    assertStatus(response, 201, input.kind);
    assert(JSON.stringify(received.at(-1)) !== undefined, "input forwarded");
    // All supported fields survive the transport normalization.
    const forwarded = received.at(-1) as Record<string, unknown>;
    for (const [key, value] of Object.entries(body)) {
      assert(
        JSON.stringify(forwarded[key]) === JSON.stringify(value),
        `${input.kind}.${key} retained`,
      );
    }
  }
  for (
    const path of [
      "/api/v1/interaction-options?activityTypeSearch=meal&activityTypeCursor=next-type&emotionSearch=joy&emotionCursor=next-emotion&limit=2",
      "/api/v1/communication-options",
    ]
  ) {
    const response = await app.request(path, { headers: tokenHeaders });
    assertStatus(response, 200, path);
    assert(
      response.headers.get("Cache-Control") === "private, no-store",
      "options remain private",
    );
  }
  assert(
    JSON.stringify(optionInput) ===
      JSON.stringify({
        activityTypeCursor: "next-type",
        activityTypeSearch: "meal",
        emotionCursor: "next-emotion",
        emotionSearch: "joy",
        limit: 2,
      }),
    "all option filters forwarded",
  );
});

Deno.test("capture routes never borrow cookie authority for a refused bearer and retain browser Origin", async () => {
  let sessionCalls = 0;
  let writes = 0;
  const current = {
    ...services({
      record: () => {
        writes++;
        return Promise.resolve({ status: "forbidden" });
      },
    }),
    protectedSessions: {
      resolve: () => {
        sessionCalls++;
        return Promise.resolve(actor);
      },
    },
    apiTokens: {
      authenticate: () => Promise.resolve({ status: "invalid" as const }),
    },
  };
  const app = createInteractionRoutes(current);
  const body = JSON.stringify({
    kind: "note",
    personId,
    requestId,
    body: "Reference",
  });
  for (
    const path of [
      "/api/v1/interactions",
      "/api/v1/interaction-options",
      "/api/v1/communication-options",
    ]
  ) {
    const method = path === "/api/v1/interactions" ? "POST" : "GET";
    for (
      const authorization of [
        "Bearer wrong-scope",
        "Bearer expired",
        "Bearer revoked",
        "Bearer malformed",
        "Basic invalid",
        "",
      ]
    ) {
      const response = await app.request(path, {
        method,
        headers: { ...headers, authorization },
        ...(method === "POST" ? { body } : {}),
      });
      assertStatus(response, 401, `${path}: refused bearer`);
    }
  }
  for (const origin of [undefined, "http://foreign.test"]) {
    const response = await app.request("/api/v1/interactions", {
      method: "POST",
      body,
      headers: {
        cookie: headers.cookie,
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
    });
    assertStatus(response, 403, "browser exact Origin required");
  }
  assert(writes === 0, "refused admission never reaches writes");
  // sessionActor is lazy; Authorization admission must not resolve a cookie.
  assert(sessionCalls === 0, "bearer or bad Origin resolved cookie authority");
});

Deno.test("INTERACTION-001 HTTP records strict activities and exposes read-only projections", async () => {
  let received: unknown;
  const app = createInteractionRoutes(services({
    record: (_actor, input) => {
      received = input;
      return services().interactions.record(_actor, input);
    },
  }));
  const created = await app.request("http://localhost/api/v1/interactions", {
    body: JSON.stringify({
      happenedAt: "2026-08-16T18:15:00.000Z",
      kind: "activity",
      participantIds: [personId, otherPersonId],
      requestId,
      summary: "Dinner together",
    }),
    headers,
    method: "POST",
  });
  assertStatus(created, 201);
  assert(
    (received as { readonly participantIds?: readonly string[] })
      .participantIds?.length === 2,
    "multi-person input was not forwarded",
  );
  for (
    const path of [
      "/api/v1/interaction-options",
      `/api/v1/people/${personId}/activity-report?year=2026&limit=10`,
      "/api/v1/today/favorite-notes",
      "/api/v1/today/recent-activity",
    ]
  ) {
    const response = await app.request(`http://localhost${path}`, { headers });
    assertStatus(response, 200, path);
    if (path === "/api/v1/today/recent-activity") {
      assert(
        (await response.json() as {
          readonly items: readonly { readonly activityType?: string }[];
        }).items[0]?.activityType === "Shared meal",
        "Today HTTP omitted the persisted activity type",
      );
    }
  }
  const extra = await app.request("http://localhost/api/v1/interactions", {
    body: JSON.stringify({
      happenedAt: "2026-08-16T18:15:00.000Z",
      kind: "activity",
      participantIds: [personId],
      requestId,
      summary: "Dinner",
      callDirection: "outbound",
    }),
    headers,
    method: "POST",
  });
  assertStatus(extra, 400, "APP-005B call fields were accepted");
});

Deno.test("INTERACTION-002 HTTP records calls/conversations and exposes the person projection", async () => {
  const received: unknown[] = [];
  const app = createInteractionRoutes(services({
    listCommunications: () =>
      Promise.resolve({
        items: [{
          channelType: { id: requestId, name: "Email" },
          createdAt: "2026-08-17T12:30:00.000Z",
          happenedAt: "2026-08-16T18:15:00.000Z",
          id: requestId,
          kind: "conversation",
          messages: [],
          person: { id: personId, name: "Ada Lovelace" },
        }],
        status: "ready",
      }),
    recordCommunication: (_actor, input) => {
      received.push(input);
      return services().interactions.recordCommunication(_actor, input);
    },
  }));
  const call = await app.request("http://localhost/api/v1/interactions", {
    body: JSON.stringify({
      calledAt: "2026-08-16T18:15:00.000Z",
      contactWasCaller: true,
      kind: "call",
      personId,
      requestId,
    }),
    headers,
    method: "POST",
  });
  const conversation = await app.request(
    "http://localhost/api/v1/interactions",
    {
      body: JSON.stringify({
        channelTypeId: requestId,
        happenedAt: "2026-08-16T18:15:00.000Z",
        kind: "conversation",
        messages: [],
        personId,
        requestId,
      }),
      headers,
      method: "POST",
    },
  );
  const projection = await app.request(
    `http://localhost/api/v1/people/${personId}/communications`,
    { headers },
  );
  const options = await app.request(
    "http://localhost/api/v1/communication-options",
    { headers },
  );
  assert(
    call.status === 201 && conversation.status === 201 &&
      projection.status === 200 && options.status === 200,
    "communication HTTP boundary failed",
  );
  assert(received.length === 2, "communication inputs were not forwarded");
});

Deno.test("INTERACTION-001 HTTP maps tenant, archive, session, origin, and outage states", async () => {
  for (
    const [status, expected] of [
      ["not-found", 404],
      ["forbidden", 403],
      ["hidden", 403],
      ["archived-write-rejected", 409],
    ] as const
  ) {
    const response = await createInteractionRoutes(services({
      record: () => Promise.resolve({ status }),
    })).request("http://localhost/api/v1/interactions", {
      body: JSON.stringify({
        body: "Reference",
        kind: "note",
        personId,
        requestId,
      }),
      headers,
      method: "POST",
    });
    assert(
      response.status === expected,
      `${status} mapped to ${response.status}`,
    );
  }
  const badOrigin = await createInteractionRoutes(services()).request(
    "http://localhost/api/v1/interactions",
    {
      body: JSON.stringify({
        body: "Reference",
        kind: "note",
        personId,
        requestId,
      }),
      headers: { ...headers, origin: "http://attacker.test" },
      method: "POST",
    },
  );
  assertStatus(badOrigin, 403, "cross-origin mutation was accepted");
  const noSession = await createInteractionRoutes({
    ...services(),
    protectedSessions: { resolve: () => Promise.resolve(undefined) },
  }).request("http://localhost/api/v1/today/recent-activity", { headers });
  assertStatus(noSession, 401, "projection accepted a missing session");
  const outage = await createInteractionRoutes(services({
    record: () => Promise.reject(new Error("offline")),
  })).request("http://localhost/api/v1/interactions", {
    body: JSON.stringify({
      body: "Reference",
      kind: "note",
      personId,
      requestId,
    }),
    headers,
    method: "POST",
  });
  assertStatus(outage, 503, "outage was concealed as a domain result");
});

Deno.test("INTERACTION-001 HTTP isolates Today region outages", async () => {
  const current = services();
  const favoriteOutage = createInteractionRoutes({
    ...current,
    today: {
      getFavoriteNotes: () => Promise.reject(new Error("offline")),
      getRecentActivity: current.today.getRecentActivity,
    },
  });
  const [failedFavorite, readyRecent] = await Promise.all([
    favoriteOutage.request("http://localhost/api/v1/today/favorite-notes", {
      headers,
    }),
    favoriteOutage.request("http://localhost/api/v1/today/recent-activity", {
      headers,
    }),
  ]);
  assert(
    failedFavorite.status === 503 && readyRecent.status === 200,
    "favorite outage concealed recent activity",
  );

  const recentOutage = createInteractionRoutes({
    ...current,
    today: {
      getFavoriteNotes: current.today.getFavoriteNotes,
      getRecentActivity: () => Promise.reject(new Error("offline")),
    },
  });
  const [readyFavorite, failedRecent] = await Promise.all([
    recentOutage.request("http://localhost/api/v1/today/favorite-notes", {
      headers,
    }),
    recentOutage.request("http://localhost/api/v1/today/recent-activity", {
      headers,
    }),
  ]);
  assert(
    readyFavorite.status === 200 && failedRecent.status === 503,
    "recent outage concealed favorite notes",
  );
});

Deno.test("INTERACTION-001 HTTP forwards bounded cursors and keeps note timestamps and request ids strict", async () => {
  let optionInput: unknown;
  let reportInput: unknown;
  const current = services({
    options: (_actor, input) => {
      optionInput = input;
      return Promise.resolve({
        activityTypes: [],
        availability: { activity: true, note: false },
        emotions: [],
        status: "ready" as const,
      });
    },
    record: () => Promise.resolve({ status: "idempotency-conflict" as const }),
  });
  const app = createInteractionRoutes({
    ...current,
    activityReport: {
      list: (_actor, _personId, input) => {
        reportInput = input;
        return Promise.resolve({
          items: [],
          person: { id: personId, name: "Ada" },
          status: "ready" as const,
        });
      },
    } as ActivityReport,
  });
  const options = await app.request(
    "http://localhost/api/v1/interaction-options?activityTypeSearch=meal&activityTypeCursor=opaque&limit=7",
    { headers },
  );
  assertStatus(options, 200, "bounded options query failed");
  assert(
    (optionInput as { readonly limit?: number }).limit === 7,
    "options query was not forwarded",
  );
  const report = await app.request(
    `http://localhost/api/v1/people/${personId}/activity-report?cursor=opaque&kind=activity&limit=9&year=2026`,
    { headers },
  );
  assertStatus(report, 200, "report cursor query failed");
  assert(
    (reportInput as { readonly cursor?: string; readonly kind?: string })
          .cursor === "opaque" &&
      (reportInput as { readonly kind?: string }).kind === "activity",
    "report cursor or kind was not forwarded",
  );
  for (
    const body of [
      {
        body: "Reference",
        happenedAt: "2026-08-17T00:00:00.000Z",
        kind: "note",
        personId,
        requestId,
      },
      { body: "Reference", kind: "note", personId },
    ]
  ) {
    const invalid = await app.request("http://localhost/api/v1/interactions", {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    });
    assertStatus(
      invalid,
      400,
      "note timestamp or missing request id was accepted",
    );
  }
  const conflict = await app.request("http://localhost/api/v1/interactions", {
    body: JSON.stringify({
      body: "Reference",
      kind: "note",
      personId,
      requestId,
    }),
    headers,
    method: "POST",
  });
  assertStatus(conflict, 409, "idempotency conflict was not stable HTTP 409");
  const stale = services({
    options: () => Promise.resolve({ status: "stale-cursor" as const }),
  });
  const staleApp = createInteractionRoutes({
    ...stale,
    activityReport: {
      list: () => Promise.resolve({ status: "stale-cursor" as const }),
    } as ActivityReport,
  });
  const [staleOptions, staleReport] = await Promise.all([
    staleApp.request(
      "http://localhost/api/v1/interaction-options?activityTypeCursor=tampered",
      { headers },
    ),
    staleApp.request(
      `http://localhost/api/v1/people/${personId}/activity-report?cursor=tampered`,
      { headers },
    ),
  ]);
  assert(
    staleOptions.status === 409 && staleReport.status === 409,
    "stale cursor was not mapped to stable HTTP 409",
  );
});
