import { requestFormDiscard } from "./unsaved-changes.ts";
import {
  mountRailEditorPresentation,
  RAIL_EDITOR_OPEN_EVENT,
} from "../features/person/rail-editor-presentation.ts";

const RAIL_EDITOR_REQUEST_EVENT = "kinship:rail-editor-request";

interface RailEditorRequest {
  readonly collect: (form: HTMLFormElement, close: () => void) => void;
}

/** Decide before the caller changes either editor, including async preparation. */
export function requestRailEditorOpen(
  target: HTMLFormElement,
  replaceCurrent = false,
  opener = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : undefined,
): boolean {
  const closing = new Map<HTMLFormElement, () => void>();
  document.dispatchEvent(
    new CustomEvent<RailEditorRequest>(RAIL_EDITOR_REQUEST_EVENT, {
      detail: {
        collect: (form, close) => {
          if (form !== target || replaceCurrent || form.inert) {
            closing.set(form, close);
          }
        },
      },
    }),
  );
  if (
    !requestFormDiscard(
      [...closing.keys()],
      "You have unsaved changes in this editor. Discard them and open another editor?",
    )
  ) return false;
  for (const close of closing.values()) close();
  if (target.inert) return false;
  target.dispatchEvent(
    new CustomEvent(RAIL_EDITOR_OPEN_EVENT, { detail: opener }),
  );
  return true;
}

export function registerRailEditors(
  ownForms: readonly HTMLFormElement[],
  close: (form: HTMLFormElement) => void,
): () => void {
  const removePresentations = ownForms.map((form) =>
    mountRailEditorPresentation(form, () => close(form))
  );
  const listener = (event: Event): void => {
    const request = (event as CustomEvent<RailEditorRequest>).detail;
    for (const form of ownForms) {
      if (form.isConnected && (!form.hidden || form.inert)) {
        request.collect(form, () => close(form));
      }
    }
  };
  document.addEventListener(RAIL_EDITOR_REQUEST_EVENT, listener);
  return () => {
    document.removeEventListener(RAIL_EDITOR_REQUEST_EVENT, listener);
    for (const remove of removePresentations) remove();
  };
}
