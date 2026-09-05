import { requestFormDiscard } from "./unsaved-changes.ts";

export const RAIL_EDITOR_OPEN_EVENT = "kinship:rail-editor-open";

/** Present the existing form as a modal on phones and inline on wider screens. */
export function mountRailEditorPresentation(
  form: HTMLFormElement,
  discard: () => void,
): () => void {
  const section = form.closest<HTMLElement>(".profile-rail-block");
  if (!section) return () => {};
  const mobile = globalThis.matchMedia("(max-width: 760px)");
  const feedback = section.querySelector<HTMLElement>(
    "[data-rail-editor-feedback]",
  );
  let opener: HTMLElement | undefined;
  let dialog: HTMLDialogElement | undefined;
  let slot: Comment | undefined;
  let feedbackSlot: Comment | undefined;

  const restoreOpener = (): void => {
    if (!section.isConnected || section.hidden) return;
    const available = (element: HTMLElement | undefined): boolean =>
      !!element?.isConnected && !element.matches(":disabled") &&
      !element.closest("[hidden], [inert]");
    const add = section.querySelector<HTMLElement>(".profile-rail-add") ??
      undefined;
    (available(opener) ? opener : available(add) ? add : section)?.focus();
  };

  const focusedControl = (): HTMLElement | undefined => {
    const active = document.activeElement;
    return active instanceof HTMLElement &&
        (form.contains(active) || feedback?.contains(active))
      ? active
      : undefined;
  };
  const inline = (): void => {
    if (!dialog) return;
    dialog.close();
    slot!.replaceWith(form);
    if (feedback && feedbackSlot) feedbackSlot.replaceWith(feedback);
    dialog.remove();
    dialog = undefined;
    slot = undefined;
    feedbackSlot = undefined;
  };
  const sync = (): void => {
    const focus = focusedControl();
    if (form.hidden || !mobile.matches || !form.isConnected) {
      const wasModal = dialog !== undefined;
      inline();
      if (!form.hidden) focus?.focus();
      else if (wasModal) restoreOpener();
      return;
    }
    if (dialog) return;
    dialog = document.createElement("dialog");
    dialog.className = "profile-rail-dialog";
    dialog.setAttribute("aria-modal", "true");
    const heading = document.createElement("h2");
    heading.id = `${section.id}-editor-heading`;
    heading.textContent = section.querySelector(".profile-section-heading h3")!
      .textContent;
    dialog.setAttribute("aria-labelledby", heading.id);
    dialog.append(heading);
    slot = document.createComment("Inline rail editor");
    form.before(slot, dialog);
    if (feedback) {
      feedbackSlot = document.createComment("Inline rail feedback");
      feedback.before(feedbackSlot);
      dialog.append(feedback);
    }
    dialog.append(form);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (
        !requestFormDiscard(
          [form],
          "You have unsaved changes in this editor. Discard them and close the editor?",
        )
      ) return;
      discard();
      sync();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const controls = [...form.querySelectorAll<HTMLElement>(
        "a[href], button, input:not([type=hidden]), select, textarea, [tabindex]",
      )].filter((control) =>
        control.tabIndex >= 0 && !control.matches(":disabled") &&
        !control.closest("[hidden], [inert]") &&
        control.getClientRects().length > 0
      );
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (
        !controls.length || index < 0 ||
        (event.shiftKey ? index === 0 : index === controls.length - 1)
      ) {
        event.preventDefault();
        (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
      }
    });
    dialog.showModal();
    focus?.focus();
  };
  const opening = (event: Event): void => {
    opener = (event as CustomEvent<HTMLElement | undefined>).detail;
  };
  form.addEventListener(RAIL_EDITOR_OPEN_EVENT, opening);
  // The owning modules remain authoritative for visibility, including save,
  // Cancel, access changes and temporary option loading.
  const observer = new MutationObserver(sync);
  observer.observe(form, { attributes: true, attributeFilter: ["hidden"] });
  mobile.addEventListener("change", sync);
  sync();
  return () => {
    observer.disconnect();
    mobile.removeEventListener("change", sync);
    form.removeEventListener(RAIL_EDITOR_OPEN_EVENT, opening);
    inline();
  };
}
