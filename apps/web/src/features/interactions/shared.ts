/**
 * What every interaction surface shares (GAP-031): the events a recorded
 * interaction sends, the person a page is about, and the local date-time
 * spelling `datetime-local` fields read and write.
 *
 * Quick capture, the person's notes and activities, calls and conversations,
 * and the Today and activity-report projections (`features/today/`,
 * `activity-report/`) all import these, so an event keeps one name and a
 * time field one format.
 */

/**
 * Sent on `globalThis` with the saved record as `detail` whenever Quick
 * capture records an activity or a note. Today, the activity report, and the
 * person's notes and activities refresh on it.
 */
export const INTERACTION_CREATED_EVENT = "kinship:interaction-created";

/**
 * Sent on `globalThis` with `{ personId, record }` when Quick capture saved
 * the interaction a Today reconnect opener asked for. Today's reconnect list
 * and tasks refresh on it.
 */
export const TODAY_RECONNECT_RECORDED_EVENT =
  "kinship:today-reconnect-recorded";

/** Sent on `document` with `{ personIds }`; the person timeline reloads. */
export const PERSON_TIMELINE_CHANGED_EVENT = "person-timeline-changed";

/** The value a `datetime-local` field shows for `date`, in local time. */
export function localDateTime(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** The instant a `datetime-local` value names, or `undefined` when none. */
export function parseLocalInstant(value: unknown): string | undefined {
  const date = new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

/** The person a profile or activity-report path is about. */
export function profilePersonId(
  pathname: string = globalThis.location.pathname,
): string | undefined {
  return /^\/app\/people\/([0-9a-f-]{36})(?:\/activity-report)?\/?$/i
    .exec(pathname)?.[1];
}

/** `value` as a lower-case canonical UUID, or `undefined` when it is not one. */
export function canonicalUuid(value: string): string | undefined {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
    ? value.toLowerCase()
    : undefined;
}
