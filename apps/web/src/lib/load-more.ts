/**
 * Wiring a "Load more" control to the cursor the last page answered with.
 *
 * Six surfaces page now — tasks, gifts, debts, files, reminders, and the
 * journal — and each had, or would have grown, the same four lines: remember
 * the cursor, hide the button when it is absent, ignore a second click while a
 * page is in flight, and put the label back afterwards. They live here once.
 *
 * A keyboard user must not lose their place. A loading control is therefore
 * marked `aria-disabled` rather than `disabled`, which would drop focus to the
 * page body, and a control that hides while it holds focus hands focus to the
 * list it extends, named by its `aria-controls`.
 *
 * `present` is what a surface calls after every answer, with the answer's
 * `nextCursor`. `undefined` hides the control, which is also what a failed load
 * leaves behind: a button that offers a page the server did not name would
 * otherwise repeat a request that already failed.
 *
 * A control may be rendered more than once for one listing — a person's photos
 * and documents are two cards served by one request — so a mount takes every
 * button that names the list and drives them together.
 */

/** The busy label a control wears while its page is in flight. */
export const LOADING_LABEL = "Loading…";

/** What a surface holds after wiring its control. */
export interface LoadMoreControl {
  /** Reflects the cursor the most recent answer carried. */
  present(cursor: string | undefined): void;
  /** The cursor the control would continue from, if any. */
  readonly cursor: string | undefined;
}

/** Every rendered control for one list, in document order. */
export function loadMoreControls(
  list: string,
  root: ParentNode = document,
): readonly HTMLButtonElement[] {
  return [
    ...root.querySelectorAll<HTMLButtonElement>(`[data-load-more="${list}"]`),
  ];
}

/**
 * Moves focus from a control that just hid to the list it extends, so the
 * reader lands on what they loaded rather than at the top of the page.
 */
function handOffFocus(control: HTMLElement): void {
  const id = control.getAttribute("aria-controls");
  const target = id ? control.ownerDocument.getElementById(id) : null;
  if (!target) return;
  if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
  }
  target.focus();
}

/**
 * Wires a list's controls to the loader that fetches its next page.
 *
 * `load` is given the cursor rather than reading it, so a surface cannot
 * continue from a cursor the control is not currently offering. While it runs
 * the button is marked unavailable and busy but stays focusable, and its label
 * says so, which is what a screen reader announces; the original label comes
 * back either way.
 */
export function mountLoadMore(
  list: string,
  load: (cursor: string) => Promise<unknown>,
  options: {
    readonly root?: ParentNode;
    readonly signal?: AbortSignal;
  } = {},
): LoadMoreControl {
  const controls = loadMoreControls(list, options.root ?? document);
  const labels = controls.map((control) => control.textContent ?? "");
  let cursor: string | undefined;
  let loading = false;

  const paint = (): void => {
    const focused = controls.find((control) =>
      control === document.activeElement
    );
    for (const [index, control] of controls.entries()) {
      control.hidden = cursor === undefined;
      if (loading) {
        control.setAttribute("aria-disabled", "true");
        control.setAttribute("aria-busy", "true");
      } else {
        control.removeAttribute("aria-disabled");
        control.removeAttribute("aria-busy");
      }
      control.textContent = loading ? LOADING_LABEL : labels[index] ?? "";
    }
    if (focused?.hidden) handOffFocus(focused);
  };

  const activate = async (): Promise<void> => {
    const resuming = cursor;
    if (loading || resuming === undefined) return;
    loading = true;
    paint();
    try {
      await load(resuming);
    } catch {
      // A loader reports its own failure in the surface's own words; all this
      // control owes the reader afterwards is a button that is no longer busy.
    } finally {
      loading = false;
      paint();
    }
  };

  for (const control of controls) {
    control.addEventListener(
      "click",
      () => void activate(),
      options.signal ? { signal: options.signal } : {},
    );
  }
  paint();

  return {
    get cursor(): string | undefined {
      return cursor;
    },
    present(next: string | undefined): void {
      cursor = next;
      paint();
    },
  };
}
