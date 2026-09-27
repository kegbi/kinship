/**
 * Mounting Today (GAP-033). `pages/app.astro` draws every section in its
 * loading state and its script calls this once; each section is its own
 * island with its own read, so one slow or failed projection never holds
 * the others: the attention queue with upcoming work and the date, the
 * reconnect and reminder-delivery section, recently viewed people, and the
 * favorite-note and recent-activity projections.
 */

import { mountTodayAttention } from "./attention/today-attention.tsx";
import { mountTodayInteractions } from "./interactions/today-interactions.tsx";
import { mountTodayRecentPeople } from "./recent-people/today-recent-people.tsx";
import { mountTodayReminders } from "./reminders/today-reminders.tsx";

/**
 * Mounts every Today island `root` has a section for and resolves, once each
 * first read has settled, with the function that unmounts them all.
 */
export async function mountToday(
  root: ParentNode = document,
): Promise<() => void> {
  const unmounts = await Promise.all([
    mountTodayAttention(root),
    mountTodayReminders(root),
    mountTodayRecentPeople(root),
    mountTodayInteractions(root),
  ]);
  return () => {
    for (const unmount of unmounts) unmount();
  };
}
