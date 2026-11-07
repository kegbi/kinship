/**
 * The people palette's keyboard shortcuts (GAP-027): Ctrl or Cmd+K opens the
 * palette from anywhere, and `/` moves the focus to the header's search
 * field unless the member is typing somewhere. Both the island and the
 * shell's loader, which mounts it on first intent (FER-01), read them here,
 * so a shortcut pressed before the island loads means the same thing.
 */

function isEditable(element: Element | null): boolean {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) return true;
  const editable = element?.closest<HTMLElement>("[contenteditable]");
  return Boolean(editable && editable.contentEditable !== "false");
}

/** What a key press asks of the palette, if anything. */
export function searchShortcut(
  event: KeyboardEvent,
): "focus-field" | "open" | undefined {
  if (
    (event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k"
  ) return "open";
  if (
    event.key !== "/" || event.altKey || event.ctrlKey || event.metaKey ||
    isEditable(document.activeElement)
  ) return undefined;
  return "focus-field";
}
