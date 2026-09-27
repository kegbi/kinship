import { describe, expect, it } from "vitest";
import type {
  TodayCadenceItem,
  TodayReminderItem,
  TodayReminders,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  cadenceLine,
  initialRemindersState,
  reminderLine,
  type RemindersAction,
  remindersReducer,
  type RemindersState,
  remindersView,
} from "./reminders.ts";

const person = {
  archived: false,
  id: "00000000-0000-4000-8000-000000000100",
  name: "Ada Lovelace",
};
const utc = { effectiveTimezone: "UTC", locale: "en" };
const at = "2026-08-18T08:00:00.000Z";
const shown = "Aug 18, 2026, 8:00 AM";

function reminder(
  overrides: Partial<TodayReminderItem> = {},
): TodayReminderItem {
  return {
    attemptCount: 0,
    deliverAt: at,
    id: "00000000-0000-4000-8000-000000000900",
    person,
    status: "pending",
    title: "Call Ada",
    ...overrides,
  } as TodayReminderItem;
}

const cadence: TodayCadenceItem = {
  dueAt: at,
  id: "00000000-0000-4000-8000-000000000903",
  person,
};

function feed(
  reminders: readonly TodayReminderItem[] = [reminder()],
  cadences: readonly TodayCadenceItem[] = [cadence],
): TodayReminders {
  return { cadences, reminders, status: "ready", timezone: "UTC" };
}

function run(
  ...actions: readonly RemindersAction[]
): RemindersState {
  return actions.reduce(remindersReducer, initialRemindersState);
}

const full = { regions: ["reminder", "cadence"], type: "read" } as const;

describe("GAP-033 Today reminder regions reducer", () => {
  it("loads both regions first and words each one's count, emptiness, and failure", () => {
    expect(remindersView(initialRemindersState)).toEqual({
      cadenceRetry: false,
      cadenceStatus: "Loading reconnect suggestions…",
      reminderRetry: false,
      reminderStatus: "Loading reminder state…",
    });
    const loaded = run(full, {
      answer: { preferences: utc, value: feed() },
      type: "answered",
    });
    expect(remindersView(loaded)).toEqual({
      cadenceRetry: false,
      cadenceStatus: "1 people to reconnect with.",
      reminderRetry: false,
      reminderStatus: "1 reminder state.",
    });
    const plural = run(full, {
      answer: {
        preferences: utc,
        value: feed([reminder(), reminder({ id: "x" })], []),
      },
      type: "answered",
    });
    expect(remindersView(plural)).toMatchObject({
      cadenceStatus: "No one is due for contact.",
      reminderStatus: "2 reminder states.",
    });
    expect(
      remindersView(run(full, {
        answer: { preferences: utc, value: feed([], []) },
        type: "answered",
      })).reminderStatus,
    ).toBe("No reminders in the next 30 days.");
    expect(remindersView(run(full, { answer: undefined, type: "answered" })))
      .toEqual({
        cadenceRetry: true,
        cadenceStatus: "Reconnect suggestions are unavailable.",
        reminderRetry: true,
        reminderStatus:
          "Reminder state is unavailable. Other Today regions remain available.",
      });
  });

  it("settles only the regions asked for, keeps stale content on failure, and focuses the last one asked", () => {
    const loaded = run(full, {
      answer: { preferences: utc, value: feed() },
      type: "answered",
    });
    const retried = [
      { focus: "reminder", regions: ["reminder"], type: "read" },
      { answer: undefined, type: "answered" },
    ] as const;
    const failed = retried.reduce<RemindersState>(remindersReducer, loaded);
    expect(failed.cadence).toBe(loaded.cadence);
    expect(failed.reminder).toEqual({
      status: "failed",
      value: loaded.reminder.value,
    });
    expect(failed.focus).toEqual({ sequence: 1, target: "reminder" });
    const both = [
      { focus: "reminder", regions: ["reminder"], type: "read" },
      { focus: "cadence", regions: ["cadence"], type: "read" },
      {
        answer: { preferences: utc, value: feed([], []) },
        type: "answered",
      },
    ] as const;
    const settled = both.reduce<RemindersState>(remindersReducer, failed);
    expect(remindersView(settled)).toMatchObject({
      cadenceStatus: "No one is due for contact.",
      reminderStatus: "No reminders in the next 30 days.",
    });
    expect(settled.focus).toEqual({ sequence: 2, target: "cadence" });
    const quiet = [
      { focus: "cadence", regions: ["cadence"], type: "read" },
      full,
      { answer: undefined, type: "answered" },
    ] as const;
    expect(quiet.reduce<RemindersState>(remindersReducer, settled).focus)
      .toBe(settled.focus);
  });

  it("describes each delivery state with the member's time", () => {
    expect(reminderLine(reminder(), utc)).toBe(`Scheduled for ${shown}`);
    expect(reminderLine(reminder({ status: "claimed" }), utc)).toBe(
      "Delivery in progress",
    );
    expect(
      reminderLine(
        reminder({
          nextAttemptAt: "2026-08-20T10:00:00.000Z",
          status: "retry",
        } as Partial<TodayReminderItem>),
        utc,
      ),
    ).toBe("Retry scheduled for Aug 20, 2026, 10:00 AM");
    expect(reminderLine(reminder({ status: "failed" }), utc)).toBe(
      "Delivery failed",
    );
    expect(reminderLine(reminder({ status: "manual_attention" }), utc)).toBe(
      "Delivery needs manual attention",
    );
    expect(
      reminderLine(
        reminder({ status: "sent", visibleAt: "2026-08-18T09:00:01.000Z" }),
        utc,
      ),
    ).toBe("Notification visible · Aug 18, 2026, 9:00 AM");
    expect(reminderLine(reminder({ status: "sent" }), utc)).toBe(
      `Delivered · ${shown}`,
    );
    expect(cadenceLine(cadence, utc)).toBe(
      `Reconnect by ${shown} · No contact recorded`,
    );
    expect(
      cadenceLine({
        ...cadence,
        lastContactedAt: at,
        person: { ...person, archived: true },
      }, utc),
    ).toBe(`Reconnect by ${shown} · Last contact ${shown} · archived`);
  });
});
