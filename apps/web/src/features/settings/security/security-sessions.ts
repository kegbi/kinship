/**
 * The active-sessions list's state (GAP-033): the member's own sessions and
 * which of them are being revoked. A pure reducer; `security-sessions.tsx`
 * renders it.
 */

import type { MemberSession } from "../../../../../../packages/contracts/generated/auth-client.ts";
import type { TimePreferences } from "../../../lib/time-presentation.ts";

export interface SessionsState {
  readonly sessions: readonly MemberSession[] | undefined;
  readonly status: string;
  readonly revoking: readonly string[];
  readonly timePreferences: TimePreferences | undefined;
}

export type SessionsAction =
  | {
    readonly type: "context";
    readonly timePreferences: TimePreferences | undefined;
  }
  | { readonly type: "loaded"; readonly sessions: readonly MemberSession[] }
  | { readonly type: "status"; readonly message: string }
  | { readonly type: "revoking"; readonly id: string }
  | {
    readonly type: "revoked";
    readonly id: string;
    readonly message: string;
  };

export const initialSessions: SessionsState = {
  revoking: [],
  sessions: undefined,
  status: "Loading sessions securely…",
  timePreferences: undefined,
};

export function sessionsReducer(
  state: SessionsState,
  action: SessionsAction,
): SessionsState {
  switch (action.type) {
    case "context":
      return { ...state, timePreferences: action.timePreferences };
    case "loaded":
      return {
        ...state,
        sessions: action.sessions,
        status: action.sessions.length ? "" : "No active sessions.",
      };
    case "status":
      return { ...state, status: action.message };
    case "revoking":
      return { ...state, revoking: [...state.revoking, action.id] };
    case "revoked":
      return {
        ...state,
        revoking: state.revoking.filter((id) => id !== action.id),
        status: action.message,
      };
  }
}

/** The line under a session's name: when it was last active, and where. */
export function sessionDetail(
  session: MemberSession,
  lastActive: string,
): string {
  return `Last active ${lastActive}${
    session.ipAddress ? ` · ${session.ipAddress}` : ""
  }`;
}
