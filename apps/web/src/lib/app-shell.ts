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

export function mountSettingsSearch(): void {
  const input = document.querySelector<HTMLInputElement>("#settings-search");
  const noResults = document.querySelector<HTMLElement>(
    "#settings-no-results",
  );
  const items = [...document.querySelectorAll<HTMLElement>(
    "[data-settings-item]",
  )];
  if (!input || !noResults || items.length === 0) return;
  input.addEventListener("input", () => {
    const query = input.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const item of items) {
      item.hidden = query.length > 0 &&
        !(item.dataset.search ?? item.textContent ?? "")
          .toLocaleLowerCase().includes(query);
      if (!item.hidden) visible += 1;
    }
    noResults.hidden = visible > 0;
  });
}
