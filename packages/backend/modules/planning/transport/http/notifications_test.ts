/**
 * The member's notifications over HTTP (GAP-053, `TODAY-002`).
 */

import type { TaskManagement } from "../../public.ts";
import type {
  ListNotificationsResult,
  Notifications,
} from "../../../../read-models/notifications/public.ts";
import type { TodayTasks } from "../../../../read-models/today/public.ts";
import { createPlanningRoutes } from "./routes.ts";
import { assertEquals, assertStatus } from "../../../../testing/assert.ts";
import * as fixtures from "../../../../testing/fixtures.ts";

const actor = fixtures.sessionActor({ workspaceName: "Circle" });
const headers = { cookie: "kinship_session=test" };
const path = "http://localhost/api/v1/notifications";

function app(list?: Notifications["list"]) {
  return createPlanningRoutes({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    ...(list ? { notifications: { list } } : {}),
    protectedSessions: { resolve: () => Promise.resolve(actor) },
    tasks: {} as TaskManagement,
    todayTasks: {} as TodayTasks,
  });
}

const page: ListNotificationsResult = {
  items: [{
    href: `/app/people/${fixtures.personId()}?section=reminders`,
    id: fixtures.uuid(1),
    kind: "reminder",
    occurredAt: "2026-09-28T12:00:00.000Z",
    person: { archived: false, id: fixtures.personId(), name: "Ada" },
    title: "Call Ada",
    unread: true,
  }],
  nextCursor: "next",
  readThrough: "2026-09-28T11:00:00.000Z",
  status: "ready",
  unreadCount: 1,
};

Deno.test("[TODAY-002] HTTP answers the member's notification page", async () => {
  const calls: unknown[][] = [];
  const response = await app((...args) => {
    calls.push(args);
    return Promise.resolve(page);
  }).request(`${path}?cursor=abc`, { headers });
  assertStatus(response, 200, "the feed reads");
  assertEquals(await response.json(), page);
  assertEquals(response.headers.get("cache-control"), "private, no-store");
  assertEquals(calls[0]![1], { cursor: "abc" });
  assertEquals(
    (calls[0]![0] as { readonly memberId: string }).memberId,
    actor.memberId,
    "the session's member is the one read for",
  );
});

Deno.test("[TODAY-002] HTTP maps the feed's refusals", async () => {
  const cases = [
    [() => Promise.resolve({ status: "invalid-cursor" }), 400],
    [() => Promise.resolve({ status: "forbidden" }), 403],
    [() => Promise.reject(new Error("private detail")), 503],
  ] as const;
  for (const [list, status] of cases) {
    const response = await app(list as Notifications["list"]).request(path, {
      headers,
    });
    assertStatus(response, status, String(status));
  }
  assertStatus(await app().request(path, { headers }), 503, "unwired");
  const unknown = await app(() => Promise.resolve(page)).request(
    `${path}?page=2`,
    { headers },
  );
  assertStatus(unknown, 400, "an unknown query parameter is refused");
  const signedOut = createPlanningRoutes({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    notifications: { list: () => Promise.resolve(page) },
    protectedSessions: { resolve: () => Promise.resolve(undefined) },
    tasks: {} as TaskManagement,
    todayTasks: {} as TodayTasks,
  });
  assertStatus(
    await signedOut.request(path, { headers }),
    401,
    "a signed-out request reads nothing",
  );
});
