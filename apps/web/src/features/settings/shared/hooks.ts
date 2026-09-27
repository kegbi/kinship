/**
 * Hooks every settings island shares (GAP-033).
 *
 * `useUnsavedGuard` keeps a draft from being lost silently: while `dirty()`
 * answers true, leaving the page asks the browser's own question, and a
 * workspace switch asks `confirmMessage` first; a reader who accepts has the
 * draft discarded through `onDiscard` once the switch actually proceeds.
 *
 * `useHeldSubmit` is REL-041's early submission for an island: the form is
 * wired from its first render, so a native submission never falls through
 * to the browser, but its work waits until the surface is `ready`. A
 * submission made before then is replayed once, when the surface becomes
 * ready, unless `replay` is false, for a surface whose submission needs a
 * review the reader has not seen yet.
 */

import {
  type SyntheticEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
} from "react";
import {
  WORKSPACE_CHANGE_REQUEST_EVENT,
  type WorkspaceChangeRequestDetail,
} from "../../../lib/workspace-context.ts";

export function useUnsavedGuard(
  options: {
    readonly dirty: () => boolean;
    readonly confirmMessage: string;
    readonly onDiscard: () => void;
  },
): void {
  const dirty = useEffectEvent(options.dirty);
  const discard = useEffectEvent(options.onDiscard);
  const { confirmMessage } = options;
  useEffect(() => {
    const beforeUnload = (event: Event) => {
      if (!dirty()) return;
      event.preventDefault();
      (event as BeforeUnloadEvent).returnValue = true;
    };
    const workspaceChange = (event: Event) => {
      if (!dirty()) return;
      if (!globalThis.confirm(confirmMessage)) {
        event.preventDefault();
        return;
      }
      (event as CustomEvent<WorkspaceChangeRequestDetail>).detail.onProceed(
        () => discard(),
      );
    };
    globalThis.addEventListener("beforeunload", beforeUnload);
    globalThis.addEventListener(
      WORKSPACE_CHANGE_REQUEST_EVENT,
      workspaceChange,
    );
    return () => {
      globalThis.removeEventListener("beforeunload", beforeUnload);
      globalThis.removeEventListener(
        WORKSPACE_CHANGE_REQUEST_EVENT,
        workspaceChange,
      );
    };
  }, [confirmMessage]);
}

export function useHeldSubmit(
  ready: boolean,
  handler: (form: HTMLFormElement) => void,
  options: { readonly replay?: boolean } = {},
): (event: SyntheticEvent<HTMLFormElement>) => void {
  const held = useRef<HTMLFormElement | undefined>(undefined);
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  const replay = options.replay !== false;
  useEffect(() => {
    const form = held.current;
    if (!ready || !form) return;
    held.current = undefined;
    latest.current(form);
  }, [ready]);
  return (event) => {
    event.preventDefault();
    if (ready) latest.current(event.currentTarget);
    else held.current = replay ? event.currentTarget : undefined;
  };
}
