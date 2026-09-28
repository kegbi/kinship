/**
 * The Today guards, which are the only responses the client checks.
 *
 * `packages/contracts/client/today.ts` is stricter than the published
 * document: it caps every list, insists on an IANA time zone the browser
 * actually knows, refuses a member nothing declared, and ties `nextAttemptAt`
 * to the retrying occurrence. That correlation is the reason the guards exist
 * — the widgets read the field without checking — so each rule is exercised
 * here in both directions rather than left to the one response that happens to
 * arrive.
 */

import {
  parseTodayAttention,
  parseTodayRecentPeople,
  parseTodayReminders,
} from "./generated/auth-client.ts";
import { assert, assertThrows } from "../backend/testing/assert.ts";

const PERSON = {
  archived: false,
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ada",
};
const INSTANT = "2026-01-01T09:00:00Z";

const REMINDERS = {
  cadences: [{ dueAt: INSTANT, id: PERSON.id, person: PERSON }],
  reminders: [{
    attemptCount: 0,
    deliverAt: INSTANT,
    id: PERSON.id,
    person: PERSON,
    status: "pending",
    title: "Call Ada",
  }],
  status: "ready",
  timezone: "Europe/Berlin",
};

const ATTENTION_ITEM = {
  dueAt: INSTANT,
  id: PERSON.id,
  kind: "task",
  title: "Write back",
};

const ATTENTION = {
  attention: { nextSevenDays: [], overdue: [], today: [ATTENTION_ITEM] },
  date: "2026-01-01",
  status: "ready",
  timezone: "Europe/Berlin",
  upcoming: [],
};

Deno.test("[GAP-022] the Today guards accept the responses the API sends", () => {
  assert(
    parseTodayReminders(REMINDERS).reminders.length === 1,
    "a well-formed reminder feed passes",
  );
  assert(
    parseTodayReminders({
      ...REMINDERS,
      reminders: [{
        ...REMINDERS.reminders[0],
        nextAttemptAt: INSTANT,
        status: "retry",
        visibleAt: INSTANT,
      }],
    }).reminders.length === 1,
    "a retrying occurrence carries its next attempt",
  );
  assert(
    parseTodayAttention(ATTENTION).upcoming.length === 0,
    "a well-formed attention feed passes",
  );
  assert(
    parseTodayAttention({
      ...ATTENTION,
      upcoming: [{
        ...ATTENTION_ITEM,
        channel: "in_app",
        kind: "reminder",
        occursOn: "2026-01-02",
        person: { ...PERSON, unavailable: true },
        reminderStatus: "pending",
      }],
    }).upcoming.length === 1,
    "a dated attention item carries the day it occurs on",
  );
  assert(
    parseTodayAttention({
      ...ATTENTION,
      attention: {
        ...ATTENTION.attention,
        overdue: [{
          ...ATTENTION_ITEM,
          channel: "email",
          kind: "important-date",
          occursOn: "2026-01-01",
          reminderStatus: "failed",
        }],
      },
    }).attention.overdue.length === 1,
    "an undelivered email reminder carries its channel (REL-059)",
  );
  assert(
    parseTodayAttention({
      ...ATTENTION,
      upcoming: [{
        ...ATTENTION_ITEM,
        kind: "cadence",
        lastContactedAt: INSTANT,
        person: PERSON,
      }],
    }).upcoming.length === 1,
    "a cadence item carries the person it is about",
  );
  assert(
    parseTodayRecentPeople({ people: [PERSON], status: "ready" }).people
      .length === 1,
    "a well-formed recent-people feed passes",
  );
});

Deno.test("[GAP-022] the Today guards refuse a response that drifted", () => {
  for (
    const [reason, feed] of [
      ["an unexpected member", { ...REMINDERS, extra: true }],
      ["a time zone the browser does not know", {
        ...REMINDERS,
        timezone: "Mars/Olympus",
      }],
      ["a status that is not ready", { ...REMINDERS, status: "stale" }],
      ["an unbounded list", {
        ...REMINDERS,
        reminders: Array.from({ length: 101 }, () => REMINDERS.reminders[0]),
      }],
      ["a retry with no next attempt", {
        ...REMINDERS,
        reminders: [{ ...REMINDERS.reminders[0], status: "retry" }],
      }],
      ["a next attempt on an occurrence that is not retrying", {
        ...REMINDERS,
        reminders: [{ ...REMINDERS.reminders[0], nextAttemptAt: INSTANT }],
      }],
      ["an instant that is not a date", {
        ...REMINDERS,
        reminders: [{
          ...REMINDERS.reminders[0],
          deliverAt: "2026-02-30T00:00:00Z",
        }],
      }],
      ["an identifier that is not one", {
        ...REMINDERS,
        reminders: [{ ...REMINDERS.reminders[0], id: "not-a-uuid" }],
      }],
      ["a person that is not one", {
        ...REMINDERS,
        cadences: [{
          dueAt: INSTANT,
          id: PERSON.id,
          person: { id: PERSON.id },
        }],
      }],
    ] as const
  ) {
    assertThrows(
      () => parseTodayReminders(feed),
      `the reminder feed must refuse ${reason}`,
    );
  }

  for (
    const [reason, feed] of [
      ["a date that is not one", { ...ATTENTION, date: "2026-02-30" }],
      ["a group missing a bucket", {
        ...ATTENTION,
        attention: { overdue: [], today: [] },
      }],
      ["an item of an unknown kind", {
        ...ATTENTION,
        upcoming: [{ ...ATTENTION_ITEM, kind: "rumour" }],
      }],
      ["a dated item with no day", {
        ...ATTENTION,
        upcoming: [{
          ...ATTENTION_ITEM,
          channel: "in_app",
          kind: "life-event",
          reminderStatus: "pending",
        }],
      }],
      ["a dated item with no channel", {
        ...ATTENTION,
        upcoming: [{
          ...ATTENTION_ITEM,
          kind: "reminder",
          occursOn: "2026-01-02",
          reminderStatus: "failed",
        }],
      }],
      ["a channel nothing delivers on", {
        ...ATTENTION,
        upcoming: [{
          ...ATTENTION_ITEM,
          channel: "sms",
          kind: "reminder",
          occursOn: "2026-01-02",
          reminderStatus: "failed",
        }],
      }],
      ["a channel on a task", {
        ...ATTENTION,
        upcoming: [{ ...ATTENTION_ITEM, channel: "email" }],
      }],
      ["an unbounded bucket", {
        ...ATTENTION,
        attention: {
          nextSevenDays: [],
          overdue: [],
          today: Array.from({ length: 21 }, () => ATTENTION_ITEM),
        },
      }],
    ] as const
  ) {
    assertThrows(
      () => parseTodayAttention(feed),
      `the attention feed must refuse ${reason}`,
    );
  }

  for (
    const [reason, feed] of [
      ["a person that is not one", {
        people: [{ archived: false, id: PERSON.id }],
        status: "ready",
      }],
      ["more people than the widget shows", {
        people: Array.from({ length: 9 }, () => PERSON),
        status: "ready",
      }],
      ["a feed that is not a record", "ready"],
    ] as const
  ) {
    assertThrows(
      () => parseTodayRecentPeople(feed),
      `the recent-people feed must refuse ${reason}`,
    );
  }
});
