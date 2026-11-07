/**
 * Mounting the people palette into the application header.
 *
 * `ApplicationLayout.astro` draws the header's search field and Search button
 * statically, so they hold their place in the tab order from the first paint.
 * The shell imports this on the member's first intent toward them (FER-01)
 * and it replaces them with the island in one task. A query typed into the
 * static field before the island mounted fired no handler; it is carried
 * over, and a field that had the focus opens the palette with it (REL-039);
 * a Search button that had the focus keeps it. A Ctrl+K pressed on either
 * before it mounted returns the focus to the one that replaces it.
 */

import { mountIsland } from "../core/index.ts";
import { GlobalPeopleSearch } from "./global-people-search.tsx";

export const GLOBAL_PEOPLE_SEARCH_ISLAND = "global-people-search";

const browserNavigate = (path: string) => globalThis.location.assign(path);

/**
 * Mounts the palette and answers the function that unmounts it. An
 * `initialOpener` (Ctrl+K pressed before it mounted) opens it at once.
 */
export function mountGlobalPeopleSearch(
  navigate: (path: string) => void = browserNavigate,
  initialOpener?: HTMLElement | null,
): () => void {
  const container = document.querySelector<HTMLElement>(
    "[data-global-people-search]",
  );
  if (!container) return () => undefined;
  const field = container.querySelector<HTMLInputElement>(
    "#global-people-search-input",
  );
  const staticButton = container.querySelector<HTMLElement>(
    "[data-global-people-search-open]",
  );
  const buttonFocused = document.activeElement !== null &&
    document.activeElement === staticButton;
  // Ctrl+K pressed on the static field or button: the island replaces them,
  // so the palette hands the focus back to its own (APR-008).
  const opener = !initialOpener
    ? initialOpener
    : initialOpener === field
    ? "field"
    : initialOpener === staticButton
    ? "button"
    : initialOpener;
  const unmount = mountIsland(
    container,
    GLOBAL_PEOPLE_SEARCH_ISLAND,
    <GlobalPeopleSearch
      initialFocus={field !== null && document.activeElement === field}
      initialOpener={opener}
      initialQuery={field?.value ?? ""}
      navigate={navigate}
    />,
  );
  // Focusing the compact Search button is what mounted the island; the
  // focus stays on the button that replaces it unless the palette opened.
  if (buttonFocused && opener === undefined) {
    container.querySelector<HTMLButtonElement>(
      "[data-global-people-search-open]",
    )?.focus();
  }
  return unmount;
}
