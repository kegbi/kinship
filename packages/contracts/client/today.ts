/**
 * The three Today responses, checked before a widget is handed them.
 *
 * These are stricter than the document: they cap list lengths, insist on an
 * IANA time zone the browser actually knows, and refuse an unknown member, so
 * a hydrated widget cannot be driven by a response that drifted. They are the
 * only responses the client checks at runtime, which is deliberate — Today is
 * the one surface rendered from a response the page never asked a human about.
 */

import type {
  TodayAttention,
  TodayAttentionItem,
  TodayAttentionPerson,
  TodayRecentPeople,
  TodayReminderPerson,
  TodayReminders,
} from "./types.ts";

const todayReminderUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-58][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const todayRfc3339Instant =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/;

function exactTodayRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) =>
    Object.prototype.hasOwnProperty.call(record, key)
  ) &&
    Object.keys(record).every((key) => allowed.has(key));
}

function validTodayPerson(value: unknown): value is TodayReminderPerson {
  return exactTodayRecord(value, ["archived", "id", "name"]) &&
    typeof value.archived === "boolean" && typeof value.id === "string" &&
    todayReminderUuid.test(value.id) && typeof value.name === "string";
}

function validTodayInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = todayRfc3339Instant.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1] ?? 0;
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  return day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 && offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value));
}

function validTodayTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function parseTodayReminders(value: unknown): TodayReminders {
  const valid =
    exactTodayRecord(value, ["cadences", "reminders", "status", "timezone"]) &&
    value.status === "ready" && validTodayTimezone(value.timezone) &&
    Array.isArray(value.reminders) && value.reminders.length <= 100 &&
    value.reminders.every((item) =>
      exactTodayRecord(item, [
        "attemptCount",
        "deliverAt",
        "id",
        "person",
        "status",
        "title",
      ], ["nextAttemptAt", "visibleAt"]) &&
      typeof item.attemptCount === "number" &&
      Number.isInteger(item.attemptCount) && item.attemptCount >= 0 &&
      validTodayInstant(item.deliverAt) && typeof item.id === "string" &&
      todayReminderUuid.test(item.id) &&
      validTodayPerson(item.person) &&
      ["pending", "claimed", "retry", "sent", "failed", "manual_attention"]
        .includes(String(item.status)) &&
      (item.status === "retry"
        ? validTodayInstant(item.nextAttemptAt)
        : item.nextAttemptAt === undefined) &&
      typeof item.title === "string" &&
      (item.visibleAt === undefined || validTodayInstant(item.visibleAt))
    ) &&
    Array.isArray(value.cadences) && value.cadences.length <= 100 &&
    value.cadences.every((item) =>
      exactTodayRecord(item, ["dueAt", "id", "person"], ["lastContactedAt"]) &&
      validTodayInstant(item.dueAt) && typeof item.id === "string" &&
      todayReminderUuid.test(item.id) &&
      validTodayPerson(item.person) &&
      (item.lastContactedAt === undefined ||
        validTodayInstant(item.lastContactedAt))
    );
  if (!valid) throw new TypeError("Invalid Today reminders response.");
  return value as unknown as TodayReminders;
}

function validTodayAttentionPerson(
  value: unknown,
): value is TodayAttentionPerson {
  return exactTodayRecord(value, ["archived", "id", "name"], ["unavailable"]) &&
    typeof value.archived === "boolean" && typeof value.id === "string" &&
    todayReminderUuid.test(value.id) &&
    typeof value.name === "string" &&
    (value.unavailable === undefined || typeof value.unavailable === "boolean");
}

function validTodayDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().startsWith(value);
}

function validTodayAttentionItem(value: unknown): value is TodayAttentionItem {
  const base = ["dueAt", "id", "kind", "title"];
  if (
    !exactTodayRecord(value, base, [
      "channel",
      "lastContactedAt",
      "occursOn",
      "person",
      "reminderStatus",
    ])
  ) return false;
  if (
    !validTodayInstant(value.dueAt) || typeof value.id !== "string" ||
    !todayReminderUuid.test(value.id) || typeof value.title !== "string"
  ) return false;
  if (value.person !== undefined && !validTodayAttentionPerson(value.person)) {
    return false;
  }
  if (value.kind === "task") return exactTodayRecord(value, base, ["person"]);
  if (
    value.kind === "important-date" || value.kind === "life-event" ||
    value.kind === "reminder"
  ) {
    return exactTodayRecord(value, [
      ...base,
      "channel",
      "occursOn",
      "reminderStatus",
    ], ["person"]) && validTodayDate(value.occursOn) &&
      ["email", "in_app"].includes(String(value.channel)) &&
      ["failed", "manual_attention", "pending", "retry"].includes(
        String(value.reminderStatus),
      );
  }
  return value.kind === "cadence" &&
    exactTodayRecord(value, [...base, "person"], ["lastContactedAt"]) &&
    validTodayAttentionPerson(value.person) &&
    (value.lastContactedAt === undefined ||
      validTodayInstant(value.lastContactedAt));
}

export function parseTodayAttention(value: unknown): TodayAttention {
  const validGroup = (group: unknown) =>
    exactTodayRecord(group, ["nextSevenDays", "overdue", "today"]) &&
    [group.nextSevenDays, group.overdue, group.today].every((items) =>
      Array.isArray(items) && items.length <= 20 &&
      items.every(validTodayAttentionItem)
    );
  const valid = exactTodayRecord(value, [
    "attention",
    "date",
    "status",
    "timezone",
    "upcoming",
  ]) &&
    value.status === "ready" && validTodayDate(value.date) &&
    validTodayTimezone(value.timezone) &&
    validGroup(value.attention) && Array.isArray(value.upcoming) &&
    value.upcoming.length <= 30 &&
    value.upcoming.every(validTodayAttentionItem);
  if (!valid) throw new TypeError("Invalid Today attention response.");
  return value as unknown as TodayAttention;
}

export function parseTodayRecentPeople(value: unknown): TodayRecentPeople {
  const valid = exactTodayRecord(value, ["people", "status"]) &&
    value.status === "ready" &&
    Array.isArray(value.people) && value.people.length <= 8 &&
    value.people.every((person) =>
      exactTodayRecord(person, ["archived", "id", "name"]) &&
      typeof person.archived === "boolean" &&
      typeof person.id === "string" && todayReminderUuid.test(person.id) &&
      typeof person.name === "string"
    );
  if (!valid) throw new TypeError("Invalid Today recent people response.");
  return value as unknown as TodayRecentPeople;
}
