/**
 * Handing a static form's early input to the island that replaces it.
 *
 * A protected page draws its form as static markup, so the reader sees it at
 * once, and an island then renders the same form over it (GAP-033). A reader
 * — or a test — can type before that happens. The island takes what was
 * typed as its starting values and puts focus back on the field that held
 * it, so replacing the markup never loses a keystroke's result or the
 * reader's place. The static form's submit controls ship disabled, so
 * nothing is submitted before the island's handler exists (REL-041).
 */

/** What a static form held when its island took over. */
export interface StaticFormInput {
  /** Every named field's text value; a checked checkbox reads "on". */
  readonly values: Readonly<Record<string, string>>;
  /** Focuses the island's field of the same name, when one held focus. */
  readonly restoreFocus: (root: ParentNode) => void;
}

const NOTHING: StaticFormInput = { restoreFocus: () => undefined, values: {} };

/** Reads `form`'s current input; a page without the form reads nothing. */
export function readStaticForm(
  form: HTMLFormElement | null | undefined,
): StaticFormInput {
  if (!form) return NOTHING;
  const values: Record<string, string> = {};
  for (const [name, value] of new FormData(form)) {
    if (typeof value === "string") values[name] = value;
  }
  const active = document.activeElement;
  const focused = active instanceof HTMLElement && form.contains(active)
    ? active.getAttribute("name") ?? undefined
    : undefined;
  return {
    restoreFocus: (root) => {
      if (!focused) return;
      [...root.querySelectorAll<HTMLElement>("[name]")].find((field) =>
        field.getAttribute("name") === focused
      )?.focus();
    },
    values,
  };
}
