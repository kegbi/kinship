import { describe, expect, it } from "vitest";
import type { JournalTimelineItem } from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  activityChoice,
  initialJournalState,
  journalBody,
  journalBusy,
  journalHeading,
  journalReducer,
  type JournalState,
  journalStatus,
  journalWhen,
  localDateTimeValue,
  parseLocalDateTime,
} from "./journal.ts";

const utc = { effectiveTimezone: "UTC", locale: "en" };
const post = {
  id: "00000000-0000-4000-8000-000000000010",
  occurredAt: "2026-08-23T10:00:00.000Z",
  post: {
    body: "Entry",
    id: "00000000-0000-4000-8000-000000000010",
    title: "Today",
    updatedAt: "2026-08-23T10:00:00.000Z",
  },
  type: "post",
} as Extract<JournalTimelineItem, { type: "post" }>;
const rating = {
  dayRating: {
    comment: "Good day",
    id: "00000000-0000-4000-8000-000000000012",
    ratedOn: "2026-08-23",
    rating: 4,
  },
  id: "00000000-0000-4000-8000-000000000012",
  occurredAt: "2026-08-23T10:00:00.000Z",
  type: "day-rating",
} as JournalTimelineItem;
const activity = {
  activity: { id: "a", participants: [], summary: "Shared a walk" },
  id: "00000000-0000-4000-8000-000000000011",
  occurredAt: "2026-08-23T10:00:00.000Z",
  type: "activity",
} as JournalTimelineItem;

const loaded = (
  state: JournalState,
  items: readonly JournalTimelineItem[],
  append = false,
  nextCursor?: string,
) =>
  journalReducer(state, {
    append,
    items,
    nextCursor,
    preferences: utc,
    type: "loaded",
    workspaceId: "w",
  });

describe("JOURNAL-001 journal reducer", () => {
  it("loads, appends, fails, and loses its session with honest status words", () => {
    expect(journalStatus(initialJournalState)).toBe("Loading journal…");
    expect(journalStatus(initialJournalState, "Loading journal item…")).toBe(
      "Loading journal item…",
    );
    expect(journalBusy(initialJournalState)).toBe(true);
    const empty = loaded(initialJournalState, []);
    expect(journalStatus(empty)).toBe("No journal items yet.");
    expect(journalBusy(empty)).toBe(false);
    const one = loaded(empty, [post], false, "next");
    expect(journalStatus(one)).toBe("1 journal item.");
    expect(one.nextCursor).toBe("next");
    const two = loaded(one, [rating], true);
    expect(journalStatus(two)).toBe("2 journal items.");
    expect(two.nextCursor).toBeUndefined();
    expect(two.activities).toBeUndefined();
    const withChoices = journalReducer(two, {
      activities: [{ happenedAt: post.occurredAt, id: "a", summary: "Walk" }],
      append: false,
      items: [post],
      preferences: utc,
      type: "loaded",
      workspaceId: "w",
    });
    expect(loaded(withChoices, [post]).activities).toHaveLength(1);
    const failed = journalReducer(two, {
      problem: "Try again later.",
      type: "failed",
    });
    expect(failed.items).toEqual([]);
    expect(journalStatus(failed)).toBe("Try again later.");
    const lost = journalReducer(two, { type: "no-session" });
    expect(lost.workspaceId).toBeUndefined();
    expect(journalStatus(lost)).toBe(
      "Your journal session could not be confirmed.",
    );
    expect(journalReducer(two, { type: "loading" }).items).toHaveLength(2);
    expect(journalStatus({ ...failed, problem: undefined })).toBe("");
  });

  it("opens a fresh editor each time, keeps an edited post's type, and closes back to Add item", () => {
    const opened = journalReducer(initialJournalState, { type: "open" });
    expect(opened.editor).toEqual({
      generation: 1,
      post: undefined,
      type: "post",
    });
    expect(opened.focus).toEqual({ sequence: 1, target: "type" });
    const rated = journalReducer(opened, {
      itemType: "day-rating",
      type: "item-type",
    });
    expect(rated.editor?.type).toBe("day-rating");
    const editing = journalReducer(rated, { post, type: "open" });
    expect(editing.editor).toMatchObject({ generation: 2, post, type: "post" });
    expect(editing.focus).toEqual({ sequence: 2, target: "body" });
    expect(
      journalReducer(editing, { itemType: "activity", type: "item-type" }),
    ).toBe(editing);
    expect(
      journalReducer(initialJournalState, {
        itemType: "activity",
        type: "item-type",
      }),
    ).toBe(initialJournalState);
    const noticed = journalReducer(editing, {
      text: "Saving…",
      type: "form-notice",
    });
    expect(noticed.formNotice).toBe("Saving…");
    const closed = journalReducer(noticed, { type: "close" });
    expect(closed.editor).toBeUndefined();
    expect(closed.formNotice).toBe("");
    expect(closed.focus?.target).toBe("add");
    expect(journalReducer(noticed, { type: "saved" })).toMatchObject({
      editor: undefined,
      formNotice: "",
    });
  });

  it("holds the timeline while a save or a removal is in flight and reports a refused removal", () => {
    const ready = loaded(initialJournalState, [post]);
    const saving = journalReducer(ready, { saving: true, type: "saving" });
    expect(journalBusy(saving)).toBe(true);
    expect(
      journalBusy(journalReducer(saving, { saving: false, type: "saving" })),
    ).toBe(false);
    const removing = journalReducer(ready, {
      itemId: post.id,
      type: "removing",
    });
    expect(journalBusy(removing)).toBe(true);
    const refused = journalReducer(removing, {
      notice: "Try again later.",
      type: "remove-refused",
    });
    expect(refused.removing).toBeUndefined();
    expect(journalStatus(refused)).toBe("Try again later.");
    expect(journalStatus(loaded(refused, [post]))).toBe("1 journal item.");
    expect(
      journalReducer(removing, { itemId: undefined, type: "removing" })
        .removing,
    ).toBeUndefined();
  });
});

describe("JOURNAL-001 journal presentation", () => {
  it("names, dates, and describes every item type", () => {
    expect(journalHeading(post)).toBe("Today");
    const { title: _title, ...untitled } = post.post;
    expect(journalHeading({ ...post, post: untitled })).toBe("Journal post");
    expect(journalHeading(rating)).toBe("Day rating: 4/5");
    expect(journalHeading(activity)).toBe("Shared a walk");
    expect(journalBody(post)).toBe("Entry");
    expect(journalBody(rating)).toBe("Good day");
    expect(
      journalBody({
        ...rating,
        dayRating: { ...(rating as { dayRating: object }).dayRating },
      } as JournalTimelineItem),
    ).toBe("Good day");
    expect(
      journalBody({
        ...rating,
        dayRating: { id: "r", ratedOn: "2026-08-23", rating: 3 },
      } as JournalTimelineItem),
    ).toBe("");
    expect(journalBody(activity)).toBe("Activity linked to this timeline.");
    expect(journalWhen(rating, undefined)).toEqual({
      dateTime: "2026-08-23",
      text: "Aug 23, 2026",
    });
    expect(journalWhen(post, utc)).toEqual({
      dateTime: post.occurredAt,
      text: "Aug 23, 2026, 10:00 AM",
    });
    expect(
      activityChoice(
        { happenedAt: post.occurredAt, id: "a", summary: "Walk" },
        utc,
      ),
    ).toBe("Walk · Aug 23, 2026, 10:00 AM");
  });

  it("round-trips local date-times and refuses a minute that does not exist", () => {
    const local = new Date(2026, 7, 23, 18, 30);
    expect(localDateTimeValue(local)).toBe("2026-08-23T18:30");
    expect(parseLocalDateTime("2026-08-23T18:30")).toBe(local.toISOString());
    expect(parseLocalDateTime("")).toBeUndefined();
    expect(parseLocalDateTime("2026-02-31T10:00")).toBeUndefined();
    expect(parseLocalDateTime("2026-08-23T24:00")).toBeUndefined();
    expect(parseLocalDateTime("2026-08-23 18:30")).toBeUndefined();
  });
});
