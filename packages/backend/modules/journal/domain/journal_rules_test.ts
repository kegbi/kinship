import { assert, assertEquals } from "../../../testing/assert.ts";
import {
  calendarDate,
  DAY_RATING_RANGE,
  deriveJournalPostId,
  instant,
  postMatches,
  validateDayRating,
  validateJournalPost,
} from "./journal_rules.ts";

Deno.test("[GAP-017] a point in time is the date the repository writes", () => {
  assertEquals(
    instant("2026-03-04T10:00:00.000Z")?.toISOString(),
    "2026-03-04T10:00:00.000Z",
  );
  assertEquals(
    instant("2026-03-04T11:00:00+01:00")?.toISOString(),
    "2026-03-04T10:00:00.000Z",
    "an offset is a spelling of the same instant",
  );
  assertEquals(instant("sometime"), undefined);
  assertEquals(instant(""), undefined);
});

Deno.test("[GAP-017] a day that the calendar does not have is not a day", () => {
  assertEquals(calendarDate("2026-03-04"), "2026-03-04");
  assertEquals(
    calendarDate("2024-02-29"),
    "2024-02-29",
    "a leap day is a day",
  );
  assertEquals(
    calendarDate("2026-02-29"),
    undefined,
    "the same day in a year without one is not",
  );
  assertEquals(calendarDate("2026-02-31"), undefined);
  assertEquals(calendarDate("2026-13-01"), undefined);
  assertEquals(calendarDate("2026-3-4"), undefined, "the shape is fixed too");
  assertEquals(calendarDate("not a day"), undefined);
  assertEquals(calendarDate("9999-99-99"), undefined);
});

Deno.test("[GAP-017] a post needs a body and a time, and keeps a title only if one works", () => {
  assertEquals(
    validateJournalPost({
      body: "  A quiet day  ",
      occurredAt: "2026-03-04T10:00:00.000Z",
    }),
    { body: "A quiet day", occurredAt: new Date("2026-03-04T10:00:00.000Z") },
  );
  assertEquals(
    validateJournalPost({
      body: "A quiet day",
      occurredAt: "2026-03-04T10:00:00.000Z",
      title: "  Sunday  ",
    }),
    {
      body: "A quiet day",
      occurredAt: new Date("2026-03-04T10:00:00.000Z"),
      title: "Sunday",
    },
  );
  assertEquals(
    validateJournalPost({
      body: "   ",
      occurredAt: "2026-03-04T10:00:00.000Z",
    }),
    undefined,
    "a blank post is nothing to keep",
  );
  assertEquals(
    validateJournalPost({
      body: "x".repeat(50_001),
      occurredAt: "2026-03-04T10:00:00.000Z",
    }),
    undefined,
  );
  assertEquals(
    validateJournalPost({ body: "A quiet day", occurredAt: "sometime" }),
    undefined,
  );
  assertEquals(
    validateJournalPost({
      body: "A quiet day",
      occurredAt: "2026-03-04T10:00:00.000Z",
      title: "   ",
    }),
    undefined,
    "a title that was offered and cannot be used is a rejection",
  );
  assertEquals(
    validateJournalPost({
      body: "A quiet day",
      occurredAt: "2026-03-04T10:00:00.000Z",
      title: "x".repeat(501),
    }),
    undefined,
  );
});

Deno.test("[GAP-017] a day rating falls inside the range and lands on a real day", () => {
  assertEquals(DAY_RATING_RANGE, { maximum: 5, minimum: 1 });
  assertEquals(
    validateDayRating({ ratedOn: "2026-03-04", rating: 3 }),
    { ratedOn: "2026-03-04", rating: 3 },
  );
  assertEquals(
    validateDayRating({
      comment: "  Good  ",
      ratedOn: "2026-03-04",
      rating: 5,
    }),
    { comment: "Good", ratedOn: "2026-03-04", rating: 5 },
  );
  assertEquals(
    validateDayRating({ ratedOn: "2026-03-04", rating: 1 }),
    { ratedOn: "2026-03-04", rating: 1 },
    "the lowest rating is still a rating",
  );
  assertEquals(
    validateDayRating({ ratedOn: "2026-03-04", rating: 0 }),
    undefined,
  );
  assertEquals(
    validateDayRating({ ratedOn: "2026-03-04", rating: 6 }),
    undefined,
  );
  assertEquals(
    validateDayRating({ ratedOn: "2026-03-04", rating: 3.5 }),
    undefined,
    "a day is rated in whole numbers",
  );
  assertEquals(
    validateDayRating({ ratedOn: "2026-02-31", rating: 3 }),
    undefined,
  );
  assertEquals(
    validateDayRating({ comment: "   ", ratedOn: "2026-03-04", rating: 3 }),
    undefined,
    "a comment that was offered and cannot be used is a rejection",
  );
  assertEquals(
    validateDayRating({
      comment: "x".repeat(10_001),
      ratedOn: "2026-03-04",
      rating: 3,
    }),
    undefined,
  );
});

Deno.test("[MCP-D4] a request identifier names one post per workspace", async () => {
  const workspace = "00000000-0000-4000-8000-000000000001";
  const request = "5b8a3c1d-2e4f-4a6b-9c8d-7e6f5a4b3c2d";
  const derived = await deriveJournalPostId(workspace, request);
  assertEquals(
    await deriveJournalPostId(workspace, request.toUpperCase()),
    derived,
    "a retry in another case names the same post",
  );
  assert(
    derived !== await deriveJournalPostId(
      "00000000-0000-4000-8000-000000000002",
      request,
    ),
    "another workspace's identical request names another post",
  );
  assert(/^[0-9a-f-]{36}$/.test(derived), "the identifier is a UUID");
});

Deno.test("[MCP-D4] a retried post is the stored one only when every part matches", () => {
  const stored = {
    body: "Walked.",
    createdAt: "2026-11-22T10:00:00.000000Z",
    id: "00000000-0000-4000-8000-000000000010",
    occurredAt: "2026-11-21T18:00:00.000000Z",
    title: "Evening",
    updatedAt: "2026-11-22T10:00:00.000000Z",
  };
  const values = {
    body: "Walked.",
    occurredAt: new Date("2026-11-21T19:00:00+01:00"),
    title: "Evening",
  };
  assert(
    postMatches(stored, values),
    "the same post, however the time is spelled",
  );
  assert(!postMatches(stored, { ...values, body: "Ran." }), "another body");
  assert(!postMatches(stored, { ...values, title: "Night" }), "another title");
  assert(
    !postMatches(stored, { body: values.body, occurredAt: values.occurredAt }),
    "no title where one was stored",
  );
  assert(
    !postMatches(stored, {
      ...values,
      occurredAt: new Date("2026-11-21T18:00:00.001Z"),
    }),
    "another moment",
  );
});
