/**
 * The application shell's non-UI contract (GAP-033): the document event a
 * saved layout preference announces, and the settings overview's filter,
 * which only hides and reveals items the page drew. The shell itself — the
 * session gate, member menu, and workspace switcher — is
 * `features/shell/application-shell/application-shell.ts`.
 */

/** Dispatched on `#protected-shell` once a member's layout width is saved. */
export const MEMBER_LAYOUT_SAVED_EVENT = "kinship:member-layout-saved";

export interface MemberLayoutSavedDetail {
  readonly workspaceId: string;
  readonly fluidLayout: boolean;
}

/** Whether every word of `query` occurs in `text`, in any order. */
export function settingsQueryMatches(text: string, query: string): boolean {
  const haystack = text.toLocaleLowerCase();
  return query.toLocaleLowerCase().split(/\s+/).filter(Boolean).every((
    word,
  ) => haystack.includes(word));
}

/**
 * The settings overview's search. With no query the page shows its category
 * cards. A query swaps each category's cards for the individual settings it
 * matches (`[data-settings-match]`, each linking straight to its control),
 * hides every category without a match from the page and from the category
 * navigation, and counts the matches beside each category left. Items are
 * read on every input, so whatever the shell removed for the member's role
 * is never shown or counted.
 */
export function mountSettingsSearch(): void {
  const input = document.querySelector<HTMLInputElement>("#settings-search");
  const noResults = document.querySelector<HTMLElement>(
    "#settings-no-results",
  );
  if (!input || !noResults) return;
  if (!document.querySelector("[data-settings-group]")) return;
  input.addEventListener("input", () => {
    const query = input.value.trim();
    let total = 0;
    for (
      const group of document.querySelectorAll<HTMLElement>(
        "[data-settings-group]",
      )
    ) {
      const id = group.dataset.settingsGroup ?? "";
      const cards = group.querySelector<HTMLElement>("[data-settings-cards]");
      const matches = group.querySelector<HTMLElement>(
        "[data-settings-matches]",
      );
      let found = 0;
      for (
        const item of group.querySelectorAll<HTMLElement>(
          "[data-settings-match]",
        )
      ) {
        item.hidden = !query ||
          !settingsQueryMatches(item.dataset.search ?? "", query);
        if (!item.hidden) found += 1;
      }
      total += found;
      if (cards) cards.hidden = query.length > 0;
      if (matches) matches.hidden = !query;
      group.hidden = query.length > 0 && found === 0;
      const link = document.querySelector<HTMLElement>(
        `[data-settings-nav="${CSS.escape(id)}"]`,
      );
      if (link) {
        link.hidden = group.hidden;
        const count = link.querySelector<HTMLElement>(
          "[data-settings-nav-count]",
        );
        if (count) {
          count.hidden = !query;
          count.textContent = query ? String(found) : "";
        }
      }
    }
    noResults.hidden = !query || total > 0;
  });
}
