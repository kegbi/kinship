/**
 * The personal lifecycle panel's state (GAP-033): what leaving this
 * workspace or deleting the member's identity would affect, and which of the
 * two actions is in flight. A pure reducer with the words the panel shows;
 * `personal-lifecycle.tsx` renders it.
 *
 * Both actions stay unavailable until the current impact is shown. Leaving
 * is blocked while the member is the final active owner of this workspace,
 * and deleting while they are the final active owner of any.
 */

import type { PersonalLifecyclePreview } from "../../../../../../packages/contracts/generated/auth-client.ts";

export type LifecycleAction = "leave" | "delete";

export interface LifecycleState {
  readonly phase: "loading" | "ready" | "unavailable";
  readonly preview: PersonalLifecyclePreview | undefined;
  /** The workspace the impact was read for, which both actions act on. */
  readonly workspaceId: string | undefined;
  readonly status: string;
  readonly busy: LifecycleAction | undefined;
}

export type LifecycleEvent =
  | {
    readonly type: "loaded";
    readonly preview: PersonalLifecyclePreview;
    readonly workspaceId: string;
  }
  | { readonly type: "unavailable"; readonly message: string }
  | { readonly type: "submitting"; readonly action: LifecycleAction }
  | { readonly type: "refused"; readonly message: string };

export const initialLifecycle: LifecycleState = {
  busy: undefined,
  phase: "loading",
  preview: undefined,
  status: "",
  workspaceId: undefined,
};

const SUBMITTING: Readonly<Record<LifecycleAction, string>> = {
  delete: "Reauthenticating and revalidating every membership…",
  leave: "Revalidating membership impact…",
};

export function lifecycleReducer(
  state: LifecycleState,
  event: LifecycleEvent,
): LifecycleState {
  switch (event.type) {
    case "loaded":
      return {
        ...state,
        phase: "ready",
        preview: event.preview,
        workspaceId: event.workspaceId,
      };
    case "unavailable":
      return { ...state, phase: "unavailable", status: event.message };
    case "submitting":
      return { ...state, busy: event.action, status: SUBMITTING[event.action] };
    case "refused":
      return { ...state, busy: undefined, status: event.message };
  }
}

type Membership = PersonalLifecyclePreview["memberships"][number];

/** How one affected membership is described beside its workspace. */
export function membershipDetail(membership: Membership): string {
  if (membership.finalOwner) return `${membership.role} · final active owner`;
  if (membership.status === "suspended") {
    return `${membership.role} · suspended`;
  }
  return membership.role;
}

/** Whether each action is blocked by the impact `preview` describes. */
export function lifecycleBlocks(
  preview: PersonalLifecyclePreview,
  workspaceId: string,
): { readonly leave: boolean; readonly delete: boolean } {
  return {
    delete: preview.blockingWorkspaces.length > 0,
    leave:
      preview.memberships.find((membership) =>
        membership.workspace.id === workspaceId
      )?.finalOwner === true,
  };
}

/** Why deleting is blocked, or `undefined` when it is not. */
export function blockersText(
  preview: PersonalLifecyclePreview,
): string | undefined {
  if (preview.blockingWorkspaces.length === 0) return undefined;
  const names = preview.blockingWorkspaces.map((workspace) => workspace.name)
    .join(", ");
  return `You are the final active owner of ${names}. Transfer ownership in Members before leaving an owned workspace or deleting your identity. Workspace deletion is a separate owner action.`;
}
