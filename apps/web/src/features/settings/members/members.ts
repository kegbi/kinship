/**
 * The members page's state (GAP-033): the active members and pending
 * invitations, the role controls an owner or admin may use, the invitation
 * form, and revoking a pending invitation (SECT-04). A pure reducer with the
 * words the page shows; `members.tsx` renders it.
 */

import type {
  ManagedMember,
  ProblemDetails,
  WorkspaceMembers,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import type { TimePreferences } from "../../../lib/time-presentation.ts";

export type MembersPhase =
  | "loading"
  | "ready"
  | "no-session"
  | "forbidden"
  | "failed";

export interface MembersState {
  readonly phase: MembersPhase;
  readonly lists: WorkspaceMembers | undefined;
  /** The role controls, once read; `undefined` while they load. */
  readonly managed: readonly ManagedMember[] | undefined;
  /** What the role controls last said; `undefined` shows the list alone. */
  readonly managedStatus: string | undefined;
  readonly saving: readonly string[];
  /** The pending invitations whose revocation is in flight. */
  readonly revoking: readonly string[];
  /** What the pending list last said about a revocation. */
  readonly pendingStatus: string;
  readonly sending: boolean;
  readonly inviteStatus: string;
  readonly timePreferences: TimePreferences | undefined;
}

export type MembersAction =
  | {
    readonly type: "context";
    readonly timePreferences: TimePreferences | undefined;
  }
  | { readonly type: "no-session" }
  | { readonly type: "refused"; readonly forbidden: boolean }
  | { readonly type: "loaded"; readonly lists: WorkspaceMembers }
  | {
    readonly type: "managed";
    readonly members?: readonly ManagedMember[];
    readonly message?: string;
  }
  | { readonly type: "sending" }
  | { readonly type: "sent"; readonly message: string }
  | { readonly type: "saving"; readonly id: string }
  | { readonly type: "saved"; readonly id: string; readonly message: string }
  | { readonly type: "revoking"; readonly id: string }
  | {
    readonly type: "revoked";
    readonly id: string;
    readonly message: string;
  };

export const initialMembers: MembersState = {
  inviteStatus: "",
  lists: undefined,
  managed: undefined,
  managedStatus: "Loading role controls…",
  pendingStatus: "",
  phase: "loading",
  revoking: [],
  saving: [],
  sending: false,
  timePreferences: undefined,
};

export const SENDING = "Creating and delivering the invitation…";
export const INVITATION_SENT =
  "Invitation sent. The link can be used once within seven days.";

export function membersReducer(
  state: MembersState,
  action: MembersAction,
): MembersState {
  switch (action.type) {
    case "context":
      return { ...state, timePreferences: action.timePreferences };
    case "no-session":
      return {
        ...state,
        inviteStatus: "",
        phase: "no-session",
        sending: false,
      };
    case "refused":
      return { ...state, phase: action.forbidden ? "forbidden" : "failed" };
    case "loaded":
      return { ...state, lists: action.lists, phase: "ready" };
    case "managed":
      return action.members
        ? {
          ...state,
          managed: action.members,
          managedStatus: action.members.length === 0
            ? "No manageable members."
            : action.message,
        }
        : { ...state, managedStatus: action.message };
    case "sending":
      return { ...state, inviteStatus: SENDING, sending: true };
    case "sent":
      return { ...state, inviteStatus: action.message, sending: false };
    case "saving":
      return { ...state, saving: [...state.saving, action.id] };
    case "saved":
      return {
        ...state,
        managedStatus: action.message,
        saving: state.saving.filter((id) => id !== action.id),
      };
    case "revoking":
      return { ...state, revoking: [...state.revoking, action.id] };
    case "revoked":
      return {
        ...state,
        pendingStatus: action.message,
        revoking: state.revoking.filter((id) => id !== action.id),
      };
  }
}

/** Who sent a pending invitation, as its row says it. */
export function invitationSender(
  invitation: Pick<WorkspaceMembers["invitations"][number], "invitedBy">,
): string {
  return invitation.invitedBy
    ? `Invited by ${invitation.invitedBy.name}`
    : "Invited by a former member";
}

/** What the pending list says when a revocation is refused. */
export const REVOCATION_FAILED = "The invitation could not be revoked.";

/** What the invitation form says when the server refuses an invitation. */
export function invitationRefusal(problem: ProblemDetails | undefined): string {
  if (problem?.code === "already_member") {
    return "That person is already an active member.";
  }
  if (problem?.code === "invitation_forbidden") {
    return "Only a workspace owner or admin can send invitations.";
  }
  return problem?.detail ?? "The invitation could not be sent. Try again.";
}

/** The members and pending-invitation sections' state lines and badges. */
export function listWords(state: MembersState): {
  readonly members: string;
  readonly pending: string;
  readonly memberCount: string;
  readonly invitationCount: string;
} {
  switch (state.phase) {
    case "loading":
      return {
        invitationCount: "Loading…",
        memberCount: "Loading…",
        members: "Loading active members securely…",
        pending: "Loading pending invitations…",
      };
    case "no-session":
      return {
        invitationCount: "Loading…",
        memberCount: "Loading…",
        members: "Your session could not be confirmed.",
        pending: "Pending invitations are unavailable.",
      };
    case "forbidden":
      return {
        invitationCount: "Unavailable",
        memberCount: "Unavailable",
        members: "Only workspace owners and admins can view members.",
        pending: "Pending invitations are restricted.",
      };
    case "failed":
      return {
        invitationCount: "Unavailable",
        memberCount: "Unavailable",
        members: "Members could not be loaded. Try again.",
        pending: "Pending invitations could not be loaded.",
      };
    case "ready":
      return {
        invitationCount: `${state.lists?.invitations.length ?? 0} pending`,
        memberCount: `${state.lists?.members.length ?? 0} active`,
        members: "No active members are available.",
        pending: "No pending invitations.",
      };
  }
}

/** A role or status as its option shows it: `admin` → `Admin`. */
export function optionLabel(value: string): string {
  return value[0]!.toUpperCase() + value.slice(1);
}
