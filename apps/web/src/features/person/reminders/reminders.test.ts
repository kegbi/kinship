import { describe, expect, it } from "vitest";
import type {
  Reminder,
  StayInTouchCadence,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { formatInstant } from "../../../lib/time-presentation.ts";
import {
  cadenceText,
  initialRemindersState,
  intervalText,
  nextReminderText,
  remindersReducer,
  reminderStateText,
  reminderSummary,
  stayInTouchText,
} from "./reminders.ts";

const utc = { effectiveTimezone: "UTC", locale: "en" };
const personId = "00000000-0000-4000-8000-000000000100";

const reminder: Reminder = {
  anchorOn: "2026-08-20",
  createdAt: "2026-08-18T10:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000900",
  isActive: true,
  nextOccurrence: {
    attemptCount: 0,
    deliverAt: "2026-08-20T07:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000901",
    occursOn: "2026-08-20",
    status: "manual_attention",
  },
  personId,
  recurrenceInterval: 1,
  recurrenceUnit: "month",
  sendTime: "09:00:00",
  title: "Call Ada",
  updatedAt: "2026-08-18T10:00:00.000Z",
};

const cadence = (
  overrides: Partial<StayInTouchCadence> = {},
): StayInTouchCadence => ({
  id: "cadence",
  intervalCount: 2,
  intervalUnit: "week",
  isActive: true,
  nextDueAt: "2026-09-20T07:00:00.000000Z",
  personId,
  updatedAt: "2026-09-01T07:00:00.000000Z",
  ...overrides,
});

describe("PLANNING-002 reminder presentation", () => {
  it("says what a reminder's next occurrence is, or why there is none", () => {
    const when = formatInstant("2026-08-20T07:00:00.000Z", utc);
    expect(reminderStateText(reminder, utc)).toBe(`manual attention · ${when}`);
    expect(
      reminderStateText({
        ...reminder,
        nextOccurrence: {
          ...reminder.nextOccurrence!,
          status: "sent",
          visibleAt: "2026-08-20T07:00:01.000Z",
        },
      }, utc),
    ).toBe(`Notification visible · ${when}`);
    const { nextOccurrence: _next, ...none } = reminder;
    expect(reminderStateText(none, utc)).toBe("No future occurrence");
    expect(reminderStateText({ ...none, isActive: false }, utc)).toBe(
      "Disabled",
    );
    expect(reminderStateText(reminder, undefined)).toBe(
      "manual attention · Time unavailable",
    );
  });

  it("names the date an advance notice is for, in the member's time zone", () => {
    const notice: Reminder = {
      ...reminder,
      nextOccurrence: {
        ...reminder.nextOccurrence!,
        deliverAt: "2026-11-25T11:00:00.000Z",
        occursOn: "2026-12-02",
        status: "pending",
      },
    };
    expect(reminderStateText(notice, utc)).toBe(
      `pending · ${
        formatInstant("2026-11-25T11:00:00.000Z", utc)
      } · notice for Dec 2, 2026`,
    );
    // A day-of delivery that is still the date locally names nothing more.
    const tokyo = { effectiveTimezone: "Asia/Tokyo", locale: "en" };
    const dayOf: Reminder = {
      ...reminder,
      nextOccurrence: {
        ...reminder.nextOccurrence!,
        deliverAt: "2026-12-01T22:00:00.000Z",
        occursOn: "2026-12-02",
        status: "pending",
      },
    };
    expect(reminderStateText(dayOf, tokyo)).toBe(
      `pending · ${formatInstant("2026-12-01T22:00:00.000Z", tokyo)}`,
    );
  });

  it("words cadences, the hero's due state, and the next reminder", () => {
    expect(intervalText(1, "month")).toBe("Every 1 month");
    expect(intervalText(2, "week")).toBe("Every 2 weeks");
    expect(cadenceText(cadence(), utc)).toBe(
      `Every 2 weeks · due ${
        formatInstant("2026-09-20T07:00:00.000000Z", utc)
      }`,
    );
    expect(stayInTouchText([])).toBe("Not set");
    expect(
      stayInTouchText([
        cadence(),
        cadence({ intervalCount: 1, intervalUnit: "year" }),
      ]),
    ).toBe("Every 2 weeks · Every 1 year");
    expect(nextReminderText(undefined, utc)).toBe("Unavailable");
    expect(
      nextReminderText({ detail: "", openTaskCount: 0, status: "ready" }, utc),
    ).toBe("Not recorded");
    expect(
      nextReminderText({
        detail: "",
        nextReminderAt: "2026-09-21T07:00:00.000000Z",
        openTaskCount: 0,
        status: "ready",
      }, utc),
    ).toBe(formatInstant("2026-09-21T07:00:00.000000Z", utc));
  });

  it("APR-006 identifies a full reminder preview without claiming a known total", () => {
    expect(reminderSummary(50, true)).toBe("Showing first 50 reminders.");
    expect(reminderSummary(2, false)).toBe("2 reminders.");
    expect(reminderSummary(1, false)).toBe("1 reminder.");
    expect(reminderSummary(0, false)).toBe("No reminders yet.");
  });
});

describe("GAP-031 reminders reducer", () => {
  const start = initialRemindersState(false);

  it("loads a page, continues it, and keeps only active cadences", () => {
    const first = remindersReducer(
      remindersReducer(start, { type: "loading" }),
      {
        cadences: [cadence(), cadence({ id: "old", isActive: false })],
        continued: false,
        nextCursor: "next",
        reminders: [reminder],
        type: "loaded",
      },
    );
    expect(first).toMatchObject({ nextCursor: "next", status: "ready" });
    expect(first.cadences.map((entry) => entry.id)).toEqual(["cadence"]);
    const second = remindersReducer(first, {
      cadences: [],
      continued: true,
      reminders: [{ ...reminder, id: "second" }],
      type: "loaded",
    });
    expect(second.reminders.map((entry) => entry.id)).toEqual([
      reminder.id,
      "second",
    ]);
    expect(second.nextCursor).toBeUndefined();
    const failed = remindersReducer(first, { type: "failed" });
    expect(failed.status).toBe("error");
    expect(failed.nextCursor).toBeUndefined();
    expect(failed.reminders).toEqual([reminder]);
  });

  it("REL-127 a refused read keeps neither section's records nor editors", () => {
    const loaded = remindersReducer(
      remindersReducer(start, { editor: "cadence", type: "open" }),
      {
        cadences: [cadence()],
        continued: false,
        nextCursor: "next",
        reminders: [reminder],
        type: "loaded",
      },
    );
    const refused = remindersReducer(loaded, {
      forbidden: true,
      type: "failed",
    });
    expect(refused).toMatchObject({
      cadenceOpen: false,
      cadences: [],
      reminderOpen: false,
      reminders: [],
      status: "forbidden",
    });
    expect(refused.nextCursor).toBeUndefined();
  });

  it("clears each section's notice when a read starts", () => {
    const noticed = remindersReducer(
      remindersReducer(start, {
        notice: "Saving reminder…",
        section: "reminder",
        type: "notice",
      }),
      {
        focus: true,
        notice: "Cadence could not be saved.",
        section: "cadence",
        type: "notice",
      },
    );
    expect(noticed).toMatchObject({
      cadenceNotice: "Cadence could not be saved.",
      focus: { target: "cadence-state" },
      reminderNotice: "Saving reminder…",
    });
    const loading = remindersReducer(noticed, { type: "loading" });
    expect(loading.reminderNotice).toBeUndefined();
    expect(loading.cadenceNotice).toBeUndefined();
    expect(
      remindersReducer(start, {
        notice: "Saving cadence…",
        section: "cadence",
        type: "notice",
      }).focus,
    ).toBeUndefined();
  });

  it("opens and closes each editor, focusing on request", () => {
    const reminderOpen = remindersReducer(start, {
      editor: "reminder",
      type: "open",
    });
    expect(reminderOpen).toMatchObject({
      focus: { target: "reminder-field", tick: 1 },
      reminderOpen: true,
    });
    const both = remindersReducer(reminderOpen, {
      editor: "cadence",
      type: "open",
    });
    expect(both).toMatchObject({
      cadenceOpen: true,
      focus: { target: "cadence-field", tick: 2 },
    });
    const quietly = remindersReducer(both, {
      editor: "cadence",
      type: "close",
    });
    expect(quietly.cadenceOpen).toBe(false);
    expect(quietly.focus?.target).toBe("cadence-field");
    const cancelled = remindersReducer(quietly, {
      editor: "reminder",
      focus: true,
      type: "close",
    });
    expect(cancelled).toMatchObject({
      focus: { target: "reminder-add" },
      reminderOpen: false,
    });
    expect(
      remindersReducer(both, { editor: "cadence", focus: true, type: "close" })
        .focus?.target,
    ).toBe("cadence-add");
  });

  it("shows and retires a pending row, holds busy, and follows the lifecycle", () => {
    const pending = remindersReducer(start, {
      row: { detail: "Saving…", title: "Call Ada" },
      section: "reminder",
      type: "pending",
    });
    expect(pending.pendingReminder?.title).toBe("Call Ada");
    const cadenceRow = remindersReducer(pending, {
      row: { detail: "Saving…", title: "Every 1 week" },
      section: "cadence",
      type: "pending",
    });
    expect(cadenceRow.pendingCadence?.title).toBe("Every 1 week");
    const retired = remindersReducer(cadenceRow, {
      row: undefined,
      section: "reminder",
      type: "pending",
    });
    expect(retired.pendingReminder).toBeUndefined();
    expect(retired.pendingCadence).toBeDefined();
    expect(remindersReducer(start, { busy: true, type: "busy" }).busy).toBe(
      true,
    );
    expect(
      remindersReducer(start, { archived: true, type: "lifecycle" }).archived,
    ).toBe(true);
  });
});
