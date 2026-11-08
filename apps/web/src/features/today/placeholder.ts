/**
 * How Today holds each section's place while its first read is on the wire
 * (FER-06). `pages/app.astro` draws these placeholders, and each island draws
 * the same ones until its first answer lands, so the loading page already
 * occupies about the room a typical answer takes and the sections below never
 * jump when it arrives. One rule holds for every island: a placeholder shows
 * while a read is on the wire and the region has shown no answer yet, so a
 * retry after a failed first read shows it again, and a refresh or retry
 * after an answer keeps the rows it shows instead.
 */

export type TodayPlaceholderKind =
  | "attention"
  | "upcoming"
  | "cadences"
  | "recent-people"
  | "favorite-notes"
  | "recent-activity";

/** The rows each placeholder draws: a typical answer, never more than shows. */
export const TODAY_PLACEHOLDER_ROWS: Readonly<
  Record<TodayPlaceholderKind, number>
> = {
  attention: 5,
  cadences: 3,
  "favorite-notes": 2,
  "recent-activity": 4,
  "recent-people": 3,
  upcoming: 3,
};

/** The rows of one placeholder, as keys both renderers iterate. */
export function placeholderRows(kind: TodayPlaceholderKind): number[] {
  return Array.from({ length: TODAY_PLACEHOLDER_ROWS[kind] }, (_, row) => row);
}
