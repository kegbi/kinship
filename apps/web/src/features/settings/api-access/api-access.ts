/**
 * The API access page's state (GAP-033): the member's personal API tokens,
 * the one-time secret of the token just created, the page's one status
 * line, and the one token change that may run at a time. A pure reducer with
 * the words the page shows; `api-access.tsx` renders it.
 *
 * The secret lives only here, in memory, until it is dismissed or the page
 * is left; it never reaches the list.
 */

import type { ApiTokenRecord } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  formatInstant,
  type TimePreferences,
} from "../../../lib/time-presentation.ts";

export interface ApiAccessState {
  readonly phase: "loading" | "ready" | "no-session" | "member";
  readonly records: readonly ApiTokenRecord[] | undefined;
  readonly timePreferences: TimePreferences | undefined;
  readonly secret: string | undefined;
  readonly status: string;
  readonly busy: boolean;
}

export type ApiAccessAction =
  | {
    readonly type: "context";
    readonly timePreferences: TimePreferences | undefined;
  }
  | { readonly type: "no-session" }
  | { readonly type: "member" }
  | { readonly type: "loaded"; readonly records: readonly ApiTokenRecord[] }
  | { readonly type: "status"; readonly message: string }
  | { readonly type: "busy"; readonly busy: boolean; readonly message?: string }
  | { readonly type: "created"; readonly secret: string }
  | { readonly type: "dismissed" };

export const initialApiAccess: ApiAccessState = {
  busy: false,
  phase: "loading",
  records: undefined,
  secret: undefined,
  status: "",
  timePreferences: undefined,
};

export function apiAccessReducer(
  state: ApiAccessState,
  action: ApiAccessAction,
): ApiAccessState {
  switch (action.type) {
    case "context":
      return {
        ...state,
        phase: "ready",
        timePreferences: action.timePreferences,
      };
    case "no-session":
      return {
        ...state,
        phase: "no-session",
        status: "Your session could not be confirmed.",
      };
    case "member":
      return {
        ...state,
        phase: "member",
        status:
          "API token management requires workspace owner or administrator access.",
      };
    case "loaded":
      return {
        ...state,
        records: action.records,
        status: "API tokens are current.",
      };
    case "status":
      return { ...state, status: action.message };
    case "busy":
      return {
        ...state,
        busy: action.busy,
        ...(action.message === undefined ? {} : { status: action.message }),
      };
    case "created":
      return {
        ...state,
        secret: action.secret,
        status: "API token created. Copy the secret now.",
      };
    case "dismissed":
      return {
        ...state,
        secret: undefined,
        status: "The one-time secret has been dismissed.",
      };
  }
}

/** A token's scopes and expiry, as its row shows them. */
export function recordScope(
  record: ApiTokenRecord,
  timePreferences: TimePreferences | undefined,
): string {
  const scopes = record.scopes.join(", ");
  return record.expiresAt
    ? `${scopes} · Expires ${formatInstant(record.expiresAt, timePreferences)}`
    : `${scopes} · No expiry`;
}

/** When a token was revoked or last used, as its row shows it. */
export function recordActivity(
  record: ApiTokenRecord,
  timePreferences: TimePreferences | undefined,
): string {
  if (record.revokedAt) {
    return `Revoked ${formatInstant(record.revokedAt, timePreferences)}`;
  }
  if (record.lastUsedAt) {
    return `Last used ${formatInstant(record.lastUsedAt, timePreferences)}`;
  }
  return "Never used";
}
