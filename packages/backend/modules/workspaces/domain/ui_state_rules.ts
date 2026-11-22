/**
 * The scratch space a member's browser keeps in their membership row.
 *
 * One JSON column holds two unrelated things — which tab of a person's page
 * they last had open and which theme they chose, and the eight people they
 * most recently looked at — so every rule here is about reading that column
 * defensively and writing back only what is understood.
 *
 * Reading is a projection, never a cast. The column may hold text, or a
 * record, or something an older version wrote, so it is decoded, checked, and
 * reduced to the two fields this module knows; anything else is dropped. That
 * is what keeps a stale or hand-edited value from reaching a page as a view
 * name the frontend has no route for.
 *
 * Writing merges rather than replaces, so saving a theme does not erase
 * somebody's recent people, and a save is refused outright unless it names at
 * least one known field and nothing else — an empty or unrecognised save would
 * otherwise look like it worked.
 *
 * Recent people are capped at eight, de-duplicated, lower-cased, and refused
 * unless they are identifiers. Every UUID version counts: a person a DAV sync
 * or a retry-safe create made carries the version 8 identifier the backend
 * derives, and somebody opens that person's page like any other (MCP-R3).
 */

import { uuid } from "../../../shared-kernel/validation.ts";

/** The tabs a person's page can be left on. */
export type PersonWorkspaceView =
  | "all"
  | "timeline"
  | "planning"
  | "things"
  | "admin";

/** Everything this module reads back out of the column. */
export interface MemberUiState {
  /**
   * The member's notifications read-through watermark (GAP-053,
   * `TODAY-002`): a UTC instant with at most millisecond precision. A
   * notification is unread while its time is after it.
   */
  readonly notificationsReadThrough?: string;
  readonly personWorkspaceView?: PersonWorkspaceView;
  readonly theme?: "system" | "light" | "dark";
}

/** The keys a save may name. */
const SAVED_KEYS = new Set([
  "notificationsReadThrough",
  "personWorkspaceView",
  "theme",
]);

/** An RFC 3339 UTC instant with at most three fractional digits. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** The most recently viewed people a membership remembers. */
export const RECENT_PEOPLE_LIMIT = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decoded(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isPersonWorkspaceView(value: unknown): value is PersonWorkspaceView {
  return value === "all" || value === "timeline" || value === "planning" ||
    value === "things" || value === "admin";
}

function isTheme(value: unknown): value is "system" | "light" | "dark" {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * The watermark as it is stored and read back: the instant in the one
 * millisecond form `Date` writes, or nothing when the value is not a real
 * UTC instant. A calendar date that does not exist (February 30) is refused
 * rather than rolled over.
 */
export function readThroughInstant(value: unknown): string | undefined {
  if (typeof value !== "string" || !INSTANT.test(value)) return undefined;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return undefined;
  const normalized = instant.toISOString();
  return normalized.slice(0, 19) === value.slice(0, 19)
    ? normalized
    : undefined;
}

/** Whatever the column holds, as a record, or an empty one. */
export function storedUiState(value: unknown): Record<string, unknown> {
  const stored = decoded(value);
  return isRecord(stored) ? stored : {};
}

/** The fields this module knows, and nothing the column also holds. */
export function projection(value: unknown): MemberUiState {
  const stored = storedUiState(value);
  const readThrough = readThroughInstant(stored.notificationsReadThrough);
  return {
    ...(readThrough ? { notificationsReadThrough: readThrough } : {}),
    ...(isPersonWorkspaceView(stored.personWorkspaceView)
      ? { personWorkspaceView: stored.personWorkspaceView }
      : {}),
    ...(isTheme(stored.theme) ? { theme: stored.theme } : {}),
  };
}

/** True when a save names at least one known field and nothing else. */
export function validMemberUiState(value: unknown): value is MemberUiState {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => !SAVED_KEYS.has(key))) {
    return false;
  }
  const hasPersonWorkspaceView = Object.hasOwn(value, "personWorkspaceView");
  const hasTheme = Object.hasOwn(value, "theme");
  const hasReadThrough = Object.hasOwn(value, "notificationsReadThrough");
  return (!hasPersonWorkspaceView ||
    isPersonWorkspaceView(value.personWorkspaceView)) &&
    (!hasTheme || isTheme(value.theme)) &&
    (!hasReadThrough ||
      readThroughInstant(value.notificationsReadThrough) !== undefined);
}

/**
 * The watermark a save leaves: the later of the stored one and the one
 * saved, so a stale tab marking an older page read never makes a newer
 * notification unread again.
 */
function laterReadThrough(
  stored: unknown,
  saved: string | undefined,
): string | undefined {
  const next = readThroughInstant(saved);
  const current = readThroughInstant(stored);
  if (!next) return current;
  return current && current > next ? current : next;
}

/** The column as it will be written back, with everything else preserved. */
export function mergedUiState(
  stored: unknown,
  input: MemberUiState,
): Readonly<Record<string, unknown>> {
  const base = storedUiState(stored);
  const readThrough = input.notificationsReadThrough === undefined
    ? undefined
    : laterReadThrough(
      base.notificationsReadThrough,
      input.notificationsReadThrough,
    );
  return {
    ...base,
    ...(readThrough === undefined
      ? {}
      : { notificationsReadThrough: readThrough }),
    ...(input.personWorkspaceView === undefined
      ? {}
      : { personWorkspaceView: input.personWorkspaceView }),
    ...(input.theme === undefined ? {} : { theme: input.theme }),
  };
}

/** A person identifier as the list stores it, or nothing. */
export function canonicalPersonId(value: string): string | undefined {
  return uuid(value);
}

/** The stored list, cleaned: known identifiers, no repeats, at most eight. */
export function recentPersonIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (
    let index = 0;
    index < value.length && ids.length < RECENT_PEOPLE_LIMIT;
    index++
  ) {
    const candidate = value[index];
    if (typeof candidate !== "string") continue;
    const id = canonicalPersonId(candidate);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * The recent list a stored column holds, cleaned as {@link recentPersonIds}
 * cleans it: what the search read model answers an empty query with (FEQ-05).
 */
export function storedRecentPersonIds(stored: unknown): readonly string[] {
  return recentPersonIds(storedUiState(stored).recentPersonIds);
}

/** The column as it will be written back with one person moved to the front. */
export function withRecentPerson(
  stored: unknown,
  personId: string,
): Readonly<Record<string, unknown>> {
  const base = storedUiState(stored);
  return {
    ...base,
    recentPersonIds: [
      personId,
      ...recentPersonIds(base.recentPersonIds).filter((id) => id !== personId),
    ].slice(0, RECENT_PEOPLE_LIMIT),
  };
}
