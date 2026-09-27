/**
 * The DAV integrations page's state (GAP-033): the workspace's DAV
 * connections, the page's one status line, and the one DAV operation that
 * may run at a time. A pure reducer with the words the page shows;
 * `integrations.tsx` renders it.
 */

import type { DavSubscription } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  formatInstant,
  type TimePreferences,
} from "../../../lib/time-presentation.ts";

export type IntegrationsPhase = "loading" | "ready" | "no-session" | "member";

export interface IntegrationsState {
  readonly phase: IntegrationsPhase;
  readonly subscriptions: readonly DavSubscription[] | undefined;
  readonly timePreferences: TimePreferences | undefined;
  readonly status: string;
  /** Whether a DAV operation runs; they run one at a time. */
  readonly busy: boolean;
}

export type IntegrationsAction =
  | {
    readonly type: "context";
    readonly timePreferences: TimePreferences | undefined;
  }
  | { readonly type: "no-session" }
  | { readonly type: "member" }
  | {
    readonly type: "loaded";
    readonly subscriptions: readonly DavSubscription[];
  }
  | { readonly type: "status"; readonly message: string }
  | {
    readonly type: "busy";
    readonly busy: boolean;
    readonly message?: string;
  };

export const initialIntegrations: IntegrationsState = {
  busy: false,
  phase: "loading",
  status: "",
  subscriptions: undefined,
  timePreferences: undefined,
};

export function integrationsReducer(
  state: IntegrationsState,
  action: IntegrationsAction,
): IntegrationsState {
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
          "Integration management requires workspace owner or administrator access.",
      };
    case "loaded":
      return {
        ...state,
        status: "DAV connection status is current.",
        subscriptions: action.subscriptions,
      };
    case "status":
      return { ...state, status: action.message };
    case "busy":
      return {
        ...state,
        busy: action.busy,
        ...(action.message === undefined ? {} : { status: action.message }),
      };
  }
}

const OUTCOME_LABELS = {
  "auth-failure": "Authentication failed",
  conflict: "Conflict needs retry",
  partial: "Partially synchronized",
} as const;

const ERROR_ADVICE: Readonly<Record<string, string>> = {
  dav_authentication_failed: "Check the saved DAV credentials.",
  dav_claim_lost: "Another synchronization took ownership. Retry.",
  dav_remote_conflict: "Retry to refresh the remote collection.",
  dav_sync_failed: "Retry the synchronization.",
};

/** A connection's last outcome, worded without the server's error codes. */
export function subscriptionStatus(
  subscription: DavSubscription,
  timePreferences: TimePreferences | undefined,
): string {
  if (!subscription.isActive) return "Disabled";
  if (subscription.lastOutcome === "never") return "Not synchronized yet";
  if (subscription.lastOutcome === "success") {
    return subscription.lastSyncedAt
      ? `Synchronized ${
        formatInstant(subscription.lastSyncedAt, timePreferences)
      }`
      : "Synchronized";
  }
  const label = OUTCOME_LABELS[subscription.lastOutcome];
  const error = subscription.lastError;
  const advice = error && Object.hasOwn(ERROR_ADVICE, error)
    ? ERROR_ADVICE[error]
    : undefined;
  return advice ? `${label}: ${advice}` : label;
}

/** Whether the connection's synchronize action retries a failed one. */
export function needsRetry(subscription: DavSubscription): boolean {
  return subscription.lastOutcome === "partial" ||
    subscription.lastOutcome === "conflict" ||
    subscription.lastOutcome === "auth-failure";
}
