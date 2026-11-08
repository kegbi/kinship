import {
  type CalendarFeedHttpServices,
  createCalendarFeedSettingsRoutes,
} from "./routes.ts";
import type { CalendarFeedTokens } from "../../public.ts";
import { assert, assertEquals } from "../../../../testing/assert.ts";
import * as fixtures from "../../../../testing/fixtures.ts";

const member = fixtures.sessionActor({
  memberId: fixtures.uuid(1),
  role: "member",
  userId: fixtures.uuid(2),
  workspaceName: "Circle",
});
const ORIGIN = "https://kinship.example";
const SECRET = "kin_cal_00000000-0000-4000-8000-000000000009.minted-secret-1";
const FEED = { createdAt: "2026-09-28T10:00:00.000Z", id: fixtures.uuid(9) };

function fixture(overrides: Partial<CalendarFeedTokens> = {}) {
  const calls: string[] = [];
  const calendarFeeds: CalendarFeedTokens = {
    authenticate: () => Promise.resolve({ status: "invalid" }),
    create: (actor) => {
      calls.push(`create:${actor.role}`);
      return Promise.resolve({ feed: FEED, secret: SECRET, status: "created" });
    },
    current: () => {
      calls.push("current");
      return Promise.resolve({
        feed: { ...FEED, lastUsedAt: "2026-09-28T11:00:00.000Z" },
        status: "ready",
      });
    },
    revoke: () => {
      calls.push("revoke");
      return Promise.resolve({ status: "revoked" });
    },
    rotate: () => {
      calls.push("rotate");
      return Promise.resolve({ feed: FEED, secret: SECRET, status: "rotated" });
    },
    ...overrides,
  };
  const services: CalendarFeedHttpServices = {
    browserSecurity: { origin: ORIGIN, secureCookie: true },
    calendarFeeds,
    protectedSessions: { resolve: () => Promise.resolve(member) },
  };
  return { calls, routes: createCalendarFeedSettingsRoutes(services) };
}

const write = { Cookie: "__Host-kinship_session=s", Origin: ORIGIN };

Deno.test("[INTEGRATION-002] any member reads their feed without its URL", async () => {
  const { calls, routes } = fixture();
  const response = await routes.request(
    "http://localhost/api/v1/settings/calendar-feed",
    { headers: { Cookie: "__Host-kinship_session=s" } },
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("cache-control"), "private, no-store");
  assertEquals(await response.json(), {
    feed: {
      createdAt: "2026-09-28T10:00:00.000Z",
      lastUsedAt: "2026-09-28T11:00:00.000Z",
    },
    status: "ready",
  });
  assertEquals(calls, ["current"]);
});

Deno.test("[INTEGRATION-002] creating and rotating show the subscription URL once", async () => {
  const { calls, routes } = fixture();
  const url = `${ORIGIN}/api/v1/calendar-feeds/${SECRET}.ics`;
  const created = await routes.request(
    "http://localhost/api/v1/settings/calendar-feed",
    { headers: write, method: "POST" },
  );
  assertEquals(created.status, 201);
  assertEquals(created.headers.get("cache-control"), "private, no-store");
  assertEquals(await created.json(), {
    feed: { createdAt: FEED.createdAt },
    status: "created",
    url,
  });
  const rotated = await routes.request(
    "http://localhost/api/v1/settings/calendar-feed/rotation",
    { headers: write, method: "POST" },
  );
  assertEquals(rotated.status, 201);
  assertEquals(await rotated.json(), {
    feed: { createdAt: FEED.createdAt },
    status: "rotated",
    url,
  });
  const revoked = await routes.request(
    "http://localhost/api/v1/settings/calendar-feed",
    { headers: write, method: "DELETE" },
  );
  assertEquals(revoked.status, 200);
  assertEquals(await revoked.json(), { status: "revoked" });
  assertEquals(calls, ["create:member", "rotate", "revoke"]);
});

Deno.test("[INTEGRATION-002] feed writes need the origin and name their refusals", async () => {
  const { calls, routes } = fixture({
    create: () => Promise.resolve({ status: "conflict" }),
    revoke: () => Promise.resolve({ status: "not-found" }),
    rotate: () => Promise.resolve({ status: "not-found" }),
  });
  const crossSite = await routes.request(
    "http://localhost/api/v1/settings/calendar-feed",
    {
      headers: {
        Cookie: "__Host-kinship_session=s",
        Origin: "https://evil.example",
      },
      method: "POST",
    },
  );
  assertEquals(crossSite.status, 403);
  assertEquals(calls, [], "a cross-site write never reaches the use case");

  const conflict = await routes.request(
    "http://localhost/api/v1/settings/calendar-feed",
    { headers: write, method: "POST" },
  );
  assertEquals(conflict.status, 409);
  assertEquals((await conflict.json()).code, "calendar_feed_exists");
  for (
    const [path, method] of [
      ["/api/v1/settings/calendar-feed/rotation", "POST"],
      ["/api/v1/settings/calendar-feed", "DELETE"],
    ] as const
  ) {
    const missing = await routes.request(`http://localhost${path}`, {
      headers: write,
      method,
    });
    assertEquals(missing.status, 404, `${method} ${path}`);
    assertEquals((await missing.json()).code, "calendar_feed_not_found");
  }
});

Deno.test("[INTEGRATION-002] a revoked member or an outage is told apart", async () => {
  const forbidden = fixture({
    current: () => Promise.resolve({ status: "forbidden" }),
  });
  const refused = await forbidden.routes.request(
    "http://localhost/api/v1/settings/calendar-feed",
    { headers: { Cookie: "__Host-kinship_session=s" } },
  );
  assertEquals(refused.status, 403);
  const down = fixture({
    create: () => Promise.reject(new Error("pool exhausted")),
    current: () => Promise.reject(new Error("pool exhausted")),
    revoke: () => Promise.reject(new Error("pool exhausted")),
    rotate: () => Promise.reject(new Error("pool exhausted")),
  });
  for (
    const [path, method] of [
      ["/api/v1/settings/calendar-feed", "GET"],
      ["/api/v1/settings/calendar-feed", "POST"],
      ["/api/v1/settings/calendar-feed/rotation", "POST"],
      ["/api/v1/settings/calendar-feed", "DELETE"],
    ] as const
  ) {
    const response = await down.routes.request(`http://localhost${path}`, {
      headers: write,
      method,
    });
    assertEquals(response.status, 503, `${method} ${path}`);
    const body = await response.json();
    assertEquals(body.code, "calendar_feed_settings_unavailable");
    assert(!JSON.stringify(body).includes("pool"), "no internal detail");
  }
  const anonymous = fixture();
  const signedOut = await createCalendarFeedSettingsRoutes({
    browserSecurity: { origin: ORIGIN, secureCookie: true },
    calendarFeeds: {} as CalendarFeedTokens,
    protectedSessions: { resolve: () => Promise.resolve(undefined) },
  }).request("http://localhost/api/v1/settings/calendar-feed");
  assertEquals(signedOut.status, 401);
  assertEquals(anonymous.calls, []);
});
