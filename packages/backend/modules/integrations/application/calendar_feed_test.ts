import { assert, assertEquals } from "../../../testing/assert.ts";
import { createCalendarFeedPublication } from "../public.ts";
import type {
  CalendarFeedAuthority,
  CalendarFeedSource,
} from "../ports/calendar_feed.ts";

const actor = {
  memberId: "30000000-0000-4000-8000-000000000001",
  role: "member" as const,
  userId: "30000000-0000-4000-8000-000000000002",
  workspaceId: "30000000-0000-4000-8000-000000000003",
};
const SECRET = "kin_cal_30000000-0000-4000-8000-000000000004.secret-value";

function publication(
  source: CalendarFeedSource["read"],
  accepted = SECRET,
) {
  const presented: string[] = [];
  const authority: CalendarFeedAuthority = {
    authenticate: (raw) => {
      presented.push(raw);
      return Promise.resolve(
        raw === accepted
          ? { actor, status: "authenticated" as const }
          : { status: "invalid" as const },
      );
    },
  };
  return {
    presented,
    feed: createCalendarFeedPublication({
      authority,
      origin: "https://kinship.example",
      source: { read: source },
    }),
  };
}

Deno.test("[INTEGRATION-002] a good secret publishes the member's calendar", async () => {
  const read: unknown[] = [];
  const { feed } = publication((who) => {
    read.push(who);
    return Promise.resolve({
      calendarName: "Circle",
      dates: [{
        day: 1,
        id: "d",
        label: "Birthday",
        month: 5,
        personId: "p",
        personName: "Ada",
        updatedAt: "2026-01-01T00:00:00Z",
      }],
      reminders: [],
      status: "ready" as const,
    });
  });
  const result = await feed.publish(SECRET);
  assert(result.status === "ready", "published");
  assertEquals(read, [actor], "the source reads exactly the token's member");
  assert(result.body.startsWith("BEGIN:VCALENDAR\r\n"), result.body);
  assert(
    result.body.includes("SUMMARY:Ada — Birthday\r\n") &&
      result.body.includes("UID:person-date-d@kinship.example\r\n"),
    result.body,
  );
});

Deno.test("[INTEGRATION-002] a refused secret or member is not found, and an outage is unavailable", async () => {
  const never = () => Promise.reject(new Error("the source is never read"));
  assertEquals(await publication(never).feed.publish("kin_cal_other"), {
    status: "not-found",
  });
  assertEquals(
    await publication(() => Promise.resolve({ status: "forbidden" as const }))
      .feed.publish(SECRET),
    { status: "not-found" },
    "a member revoked since the token was checked sees nothing either",
  );
  assertEquals(
    await publication(() => Promise.resolve({ status: "unavailable" as const }))
      .feed.publish(SECRET),
    { status: "unavailable" },
  );
});
