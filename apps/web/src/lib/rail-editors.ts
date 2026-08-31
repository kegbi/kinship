export const RAIL_EDITOR_OPENED_EVENT = "kinship:rail-editor-opened";

export function announceRailEditorOpened(form: HTMLFormElement): void {
  document.dispatchEvent(
    new CustomEvent<HTMLFormElement>(RAIL_EDITOR_OPENED_EVENT, {
      detail: form,
    }),
  );
}

export function onForeignRailEditorOpened(
  ownForms: readonly HTMLFormElement[],
  close: (form: HTMLFormElement) => void,
): () => void {
  const listener = (event: Event): void => {
    const opened = (event as CustomEvent<unknown>).detail;
    if (!(opened instanceof HTMLFormElement)) return;
    for (const form of ownForms) {
      if (form !== opened && form.isConnected && !form.hidden) close(form);
    }
  };
  document.addEventListener(RAIL_EDITOR_OPENED_EVENT, listener);
  return () => document.removeEventListener(RAIL_EDITOR_OPENED_EVENT, listener);
}
