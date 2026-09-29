/**
 * The regions one Today read fills (GAP-033).
 *
 * Today's attention and upcoming lists come from one read, and so do the
 * reminder-delivery and reconnect lists. A region's retry asks for that read
 * again, and so does an event such as a recorded reconnect; each surface keeps
 * one latest-request slot, so a newer request retires the one in flight. A
 * region a request put in `loading` is therefore settled by whichever answer
 * lands last, never by the one it started: every region still loading takes
 * that answer, and a region nobody asked about keeps what it shows. A failed
 * answer keeps the region's last good value beside its failure, so a retry
 * that fails never blanks a list the reader was using.
 */

/**
 * Sent on `globalThis` once planning confirmed that Today's attention queue
 * dismissed an undelivered reminder (REL-088). Today's reminder panel ranks
 * undelivered occurrences first, so it reads its reminders again.
 */
export const REMINDER_ACKNOWLEDGED_EVENT = "kinship:reminder-acknowledged";

export type RegionStatus = "loading" | "ready" | "failed";

export interface Region<T> {
  readonly status: RegionStatus;
  /** What the region last showed; a failed read keeps it. */
  readonly value?: T | undefined;
}

/** A region nothing has answered yet. */
export function initialRegion<T>(): Region<T> {
  return { status: "loading" };
}

/** `region` waiting for the next answer, still showing what it had. */
export function loadingRegion<T>(region: Region<T>): Region<T> {
  return region.status === "loading"
    ? region
    : { ...region, status: "loading" };
}

/**
 * `region` once an answer landed: `value` when the answer carried one, a
 * failure over the last good value when it did not. A region that was not
 * waiting is left as it is.
 */
export function settleRegion<T>(
  region: Region<T>,
  value: T | undefined,
): Region<T> {
  if (region.status !== "loading") return region;
  return value === undefined
    ? { ...region, status: "failed" }
    : { status: "ready", value };
}

/** A request for the page to move focus, fresh each time it is made. */
export interface FocusRequest<T> {
  readonly target: T;
  readonly sequence: number;
}

export function focusRequest<T>(
  previous: FocusRequest<T> | undefined,
  target: T | undefined,
): FocusRequest<T> | undefined {
  return target === undefined
    ? previous
    : { sequence: (previous?.sequence ?? 0) + 1, target };
}
