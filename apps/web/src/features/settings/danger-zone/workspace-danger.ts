/**
 * The workspace danger zone's state (GAP-033): the current impact of
 * resetting or deleting the workspace, and which action is in flight. A pure
 * reducer; `workspace-danger.tsx` renders it.
 *
 * Both actions stay disabled until the impact is shown, and both forms are
 * withdrawn when no owner session or no impact can be confirmed.
 */

import type { WorkspaceLifecyclePreview } from "../../../../../../packages/contracts/generated/auth-client.ts";

export type DangerAction = "reset" | "delete";

export interface DangerState {
  readonly phase: "loading" | "ready" | "withdrawn";
  readonly preview: WorkspaceLifecyclePreview | undefined;
  readonly workspaceId: string | undefined;
  readonly status: string;
  readonly busy: DangerAction | undefined;
}

export type DangerEvent =
  | {
    readonly type: "loaded";
    readonly preview: WorkspaceLifecyclePreview;
    readonly workspaceId: string;
  }
  | { readonly type: "withdrawn"; readonly message: string }
  | { readonly type: "submitting"; readonly action: DangerAction }
  | { readonly type: "refused"; readonly message: string };

export const initialDanger: DangerState = {
  busy: undefined,
  phase: "loading",
  preview: undefined,
  status: "Loading current impact…",
  workspaceId: undefined,
};

export function dangerReducer(
  state: DangerState,
  event: DangerEvent,
): DangerState {
  switch (event.type) {
    case "loaded":
      return {
        ...state,
        phase: "ready",
        preview: event.preview,
        status: "Current impact loaded. Review it before confirming.",
        workspaceId: event.workspaceId,
      };
    case "withdrawn":
      return { ...state, phase: "withdrawn", status: event.message };
    case "submitting":
      return {
        ...state,
        busy: event.action,
        status: "Reauthenticating and revalidating current impact…",
      };
    case "refused":
      return { ...state, busy: undefined, status: event.message };
  }
}

/** A count's name as the impact list shows it: `journalPosts` → `journal posts`. */
export function countLabel(name: string): string {
  return name.replace(/([A-Z])/g, " $1").toLowerCase();
}
