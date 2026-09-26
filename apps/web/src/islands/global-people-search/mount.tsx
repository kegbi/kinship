/**
 * Mounting the people palette into the application header.
 *
 * `ApplicationLayout.astro` draws the header's search field and Search button
 * statically, so they hold their place in the tab order from the first paint.
 * This replaces them with the island in one task. A query typed into the
 * static field before the script ran fired no handler; it is carried over,
 * and a field that had the focus opens the palette with it (REL-039).
 */

import { mountIsland } from "../core/index.ts";
import { GlobalPeopleSearch } from "./global-people-search.tsx";

export const GLOBAL_PEOPLE_SEARCH_ISLAND = "global-people-search";

const browserNavigate = (path: string) => globalThis.location.assign(path);

/** Mounts the palette and answers the function that unmounts it. */
export function mountGlobalPeopleSearch(
  navigate: (path: string) => void = browserNavigate,
): () => void {
  const container = document.querySelector<HTMLElement>(
    "[data-global-people-search]",
  );
  if (!container) return () => undefined;
  const field = container.querySelector<HTMLInputElement>(
    "#global-people-search-input",
  );
  return mountIsland(
    container,
    GLOBAL_PEOPLE_SEARCH_ISLAND,
    <GlobalPeopleSearch
      initialFocus={field !== null && document.activeElement === field}
      initialQuery={field?.value ?? ""}
      navigate={navigate}
    />,
  );
}
