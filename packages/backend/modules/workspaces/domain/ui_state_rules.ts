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
 * unless they are ordinary identifiers. The pattern excludes version 8 on
 * purpose: those are the identifiers the backend derives for itself, and a
 * list of recently viewed people is a list of rows somebody actually opened.
 */

/** The tabs a person's page can be left on. */
export type PersonWorkspaceView =
  | "all"
  | "timeline"
  | "planning"
  | "things"
  | "admin";

/** Everything this module reads back out of the column. */
export interface MemberUiState {
  readonly personWorkspaceView?: PersonWorkspaceView;
  readonly theme?: "system" | "light" | "dark";
}

/** The most recently viewed people a membership remembers. */
export const RECENT_PEOPLE_LIMIT = 8;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

/** Whatever the column holds, as a record, or an empty one. */
export function storedUiState(value: unknown): Record<string, unknown> {
  const stored = decoded(value);
  return isRecord(stored) ? stored : {};
}

/** The two fields this module knows, and nothing the column also holds. */
export function projection(value: unknown): MemberUiState {
  const stored = storedUiState(value);
  return {
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
  if (
    keys.length === 0 ||
    keys.some((key) => key !== "personWorkspaceView" && key !== "theme")
  ) {
    return false;
  }
  const hasPersonWorkspaceView = Object.hasOwn(value, "personWorkspaceView");
  const hasTheme = Object.hasOwn(value, "theme");
  return (!hasPersonWorkspaceView ||
    isPersonWorkspaceView(value.personWorkspaceView)) &&
    (!hasTheme || isTheme(value.theme));
}

/** The column as it will be written back, with everything else preserved. */
export function mergedUiState(
  stored: unknown,
  input: MemberUiState,
): Readonly<Record<string, unknown>> {
  return {
    ...storedUiState(stored),
    ...(input.personWorkspaceView === undefined
      ? {}
      : { personWorkspaceView: input.personWorkspaceView }),
    ...(input.theme === undefined ? {} : { theme: input.theme }),
  };
}

/** A person identifier as the list stores it, or nothing. */
export function canonicalPersonId(value: string): string | undefined {
  return UUID.test(value) ? value.toLowerCase() : undefined;
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
