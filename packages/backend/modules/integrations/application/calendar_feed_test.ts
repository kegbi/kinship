import { assert, assertEquals } from "../../../testing/assert.ts";
import { createCalendarFeedPublication } from "../public.ts";
import {
  CALENDAR_FEED_FORMAT,
  calendarFeedTag,
} from "../domain/calendar_feed_rules.ts";
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
const ORIGIN = "https://kinship.example";

const REVISION = {
  revision: '["2026-09-28","Circle",0,null,1,"2026-01-01T00:00:00Z"]',
  status: "ready" as const,
};

function publication(
  source: CalendarFeedSource["read"],
  accepted = SECRET,
  revision: CalendarFeedSource["revision"] = () => Promise.resolve(REVISION),
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
      origin: ORIGIN,
      source: { read: source, revision },
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
  assertEquals(result.tag, await calendarFeedTag(REVISION.revision, ORIGIN));
  assert(/^"[A-Za-z0-9_-]{43}"$/.test(result.tag), result.tag);
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
  assertEquals(
    await publication(
      never,
      SECRET,
      () => Promise.resolve({ status: "forbidden" as const }),
    ).feed.publish(SECRET),
    { status: "not-found" },
    "a member revoked before the revision is taken sees nothing",
  );
  assertEquals(
    await publication(
      never,
      SECRET,
      () => Promise.resolve({ status: "unavailable" as const }),
    ).feed.publish(SECRET),
    { status: "unavailable" },
    "an outage taking the revision is an outage",
  );
});

Deno.test("[INTEGRATION-002] BEQ-14 a caller holding the current tag is answered before any event is read", async () => {
  let reads = 0;
  const { feed } = publication(() => {
    reads += 1;
    return Promise.resolve({
      calendarName: "Circle",
      dates: [],
      reminders: [],
      status: "ready" as const,
    });
  });
  const first = await feed.publish(SECRET);
  assert(first.status === "ready", "the first poll renders");
  const asked: string[] = [];
  const held = await feed.publish(SECRET, (tag) => {
    asked.push(tag);
    return tag === first.tag;
  });
  assertEquals(held, { status: "not-modified", tag: first.tag });
  assertEquals(asked, [first.tag], "the caller is asked about one tag");
  assertEquals(reads, 1, "a held tag reads no event");
  const stale = await feed.publish(SECRET, () => false);
  assert(stale.status === "ready" && stale.tag === first.tag, "re-rendered");
  assertEquals(stale.body, first.body, "the same revision, the same bytes");
  assertEquals(reads, 2);
});

Deno.test("[INTEGRATION-002] BEQ-14 a refusal presenting any tag is not found, never not modified", async () => {
  const never = () => Promise.reject(new Error("the source is never read"));
  let revisions = 0;
  const counted: CalendarFeedSource["revision"] = () => {
    revisions += 1;
    return Promise.resolve(REVISION);
  };
  const holdsEverything = () => true;
  assertEquals(
    await publication(never, SECRET, counted).feed.publish(
      "kin_cal_other",
      holdsEverything,
    ),
    { status: "not-found" },
    "a refused secret is not found whatever tag it presents",
  );
  assertEquals(revisions, 0, "and no revision is taken for it");
  assertEquals(
    await publication(
      never,
      SECRET,
      () => Promise.resolve({ status: "forbidden" as const }),
    ).feed.publish(SECRET, holdsEverything),
    { status: "not-found" },
    "a revoked member holding the last tag is not found",
  );
});

Deno.test("[INTEGRATION-002] the tag names the format, the origin, and the revision", async () => {
  const tag = await calendarFeedTag("r1", ORIGIN);
  assertEquals(await calendarFeedTag("r1", ORIGIN), tag, "deterministic");
  assert(await calendarFeedTag("r2", ORIGIN) !== tag, "a new revision");
  assert(
    await calendarFeedTag("r1", "https://other.example") !== tag,
    "links at another origin are another body",
  );
  assertEquals(CALENDAR_FEED_FORMAT, "kinship-calendar-feed/1");
});
