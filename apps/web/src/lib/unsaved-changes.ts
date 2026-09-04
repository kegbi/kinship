import {
  WORKSPACE_CHANGE_REQUEST_EVENT,
  type WorkspaceChangeRequestDetail,
} from "./workspace-context.ts";

export interface UnsavedChangesGuardOptions {
  readonly confirmMessage: string;
  readonly root: HTMLElement;
}

const FORM_SAVED_EVENT = "kinship:form-saved";

/** Call only after the owning mutation acknowledges a successful save. */
export function markFormSaved(form: HTMLFormElement): void {
  form.dispatchEvent(new Event(FORM_SAVED_EVENT, { bubbles: true }));
}

/** Keep the submitted values stable until the owning mutation settles. */
export async function saveWithLockedForm<T>(
  form: HTMLFormElement,
  save: () => Promise<T>,
): Promise<T> {
  const wasInert = form.inert;
  form.inert = true;
  try {
    return await save();
  } finally {
    form.inert = wasInert;
  }
}

let activeBeforeUnload: ((event: Event) => void) | undefined;
let activeWorkspaceChangeRequest: ((event: Event) => void) | undefined;
let activeRootCleanup: (() => void) | undefined;

function formSnapshot(form: HTMLFormElement): string {
  return JSON.stringify(Array.from(new FormData(form).entries()));
}

function eventForm(
  root: HTMLElement,
  event: Event,
): HTMLFormElement | undefined {
  const target = event.target;
  if (!(target instanceof Element)) return undefined;
  const form = target instanceof HTMLFormElement
    ? target
    : target.closest<HTMLFormElement>("form");
  return form && root.contains(form) ? form : undefined;
}

export function mountUnsavedChangesGuard(
  options: UnsavedChangesGuardOptions,
): void {
  activeRootCleanup?.();
  const baselines = new Map<HTMLFormElement, string>();
  const dirtyForms = new Set<HTMLFormElement>();
  const rebaseline = (form: HTMLFormElement): void => {
    baselines.set(form, formSnapshot(form));
    dirtyForms.delete(form);
  };
  const updateDirty = (form: HTMLFormElement): void => {
    const baseline = baselines.get(form);
    if (baseline === undefined) return;
    if (formSnapshot(form) === baseline) dirtyForms.delete(form);
    else dirtyForms.add(form);
  };
  const hasUnsavedChanges = (): boolean =>
    [...dirtyForms].some((form) => form.isConnected);
  const focusin = (event: Event): void => {
    const form = eventForm(options.root, event);
    if (form && !baselines.has(form)) rebaseline(form);
  };
  const changed = (event: Event): void => {
    const form = eventForm(options.root, event);
    if (form) updateDirty(form);
  };
  const saved = (event: Event): void => {
    const form = eventForm(options.root, event);
    if (form) rebaseline(form);
  };
  const reset = (event: Event): void => {
    const form = eventForm(options.root, event);
    if (!form || !baselines.has(form)) return;
    dirtyForms.delete(form);
    queueMicrotask(() => rebaseline(form));
  };
  options.root.addEventListener("focusin", focusin);
  options.root.addEventListener("input", changed);
  options.root.addEventListener("change", changed);
  options.root.addEventListener(FORM_SAVED_EVENT, saved);
  options.root.addEventListener("reset", reset);
  activeRootCleanup = () => {
    options.root.removeEventListener("focusin", focusin);
    options.root.removeEventListener("input", changed);
    options.root.removeEventListener("change", changed);
    options.root.removeEventListener(FORM_SAVED_EVENT, saved);
    options.root.removeEventListener("reset", reset);
  };

  if (activeBeforeUnload) {
    globalThis.removeEventListener("beforeunload", activeBeforeUnload);
  }
  activeBeforeUnload = (event: Event): void => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = true;
  };
  globalThis.addEventListener("beforeunload", activeBeforeUnload);

  if (activeWorkspaceChangeRequest) {
    globalThis.removeEventListener(
      WORKSPACE_CHANGE_REQUEST_EVENT,
      activeWorkspaceChangeRequest,
    );
  }
  activeWorkspaceChangeRequest = (event: Event): void => {
    if (!hasUnsavedChanges()) return;
    const request = event as CustomEvent<WorkspaceChangeRequestDetail>;
    if (!globalThis.confirm(options.confirmMessage)) {
      event.preventDefault();
      return;
    }
    request.detail.onProceed(() => {
      for (const form of baselines.keys()) rebaseline(form);
    });
  };
  globalThis.addEventListener(
    WORKSPACE_CHANGE_REQUEST_EVENT,
    activeWorkspaceChangeRequest,
  );
}
