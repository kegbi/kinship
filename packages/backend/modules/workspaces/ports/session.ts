/**
 * What a sign-in needs of the world outside identity.
 *
 * `ActiveWorkspaceResolver` answers the question this module exists for: given
 * a user, which workspace are they acting in, and which others could they
 * switch to. It has an `assert...Postcondition` beside its read, as the audit
 * port does, because a sign-in re-reads what it just established inside the
 * same transaction — a session issued against a membership that turned out not
 * to be there unwinds instead of being handed out.
 *
 * `AuthenticationAudit` records both outcomes, and its failure path is the
 * careful one: a failed sign-in often has no member to name, so the event is
 * written with a null actor and whatever context could be resolved, and it is
 * written inside the same transaction as the attempt.
 *
 * `AuthenticationAttemptBudget` is the throttle. Every attempt reserves before
 * it is made and finalizes with the status it ended in, so what counts towards
 * a lock-out is exactly what the caller was told — `domain/session_rules.ts`
 * owns that mapping. `finalize` takes an optional transaction so a successful
 * attempt's reset commits with the session it issued.
 *
 * `AuthenticationResponseEqualizer` is why an attempt against an unknown
 * address takes as long as one against a real one.
 */

import type {
  ActiveWorkspaceContext,
  ProtectedSessionTransaction,
} from "./context.ts";
import type { AuthenticationRequestStatusCode } from "../domain/session_rules.ts";

export interface ActiveWorkspaceResolver {
  listActiveContexts(command: {
    readonly transaction: ProtectedSessionTransaction;
    readonly userId: string;
  }): Promise<readonly ActiveWorkspaceContext[]>;
  resolveAuditContext(command: {
    readonly transaction: ProtectedSessionTransaction;
    readonly userId: string;
  }): Promise<ActiveWorkspaceContext | undefined>;
  resolveActiveContext(command: {
    readonly requestedWorkspaceId?: string;
    readonly transaction: ProtectedSessionTransaction;
    readonly userId: string;
  }): Promise<ActiveWorkspaceContext | undefined>;
  assertActiveContextPostcondition(
    command: ActiveWorkspaceContext & {
      readonly transaction: ProtectedSessionTransaction;
    },
  ): Promise<void>;
}

export interface AuthenticationAudit {
  record(command: {
    readonly context: ActiveWorkspaceContext;
    readonly occurredAt: Date;
    readonly outcome: "failed" | "succeeded";
    readonly transaction: ProtectedSessionTransaction;
  }): Promise<string>;
  assertPostcondition(command: {
    readonly auditEventId: string;
    readonly context: ActiveWorkspaceContext;
    readonly occurredAt: Date;
    readonly outcome: "failed" | "succeeded";
    readonly transaction: ProtectedSessionTransaction;
  }): Promise<void>;
  recordFailure(command: {
    readonly actorMemberId: null;
    readonly context?: ActiveWorkspaceContext;
    readonly occurredAt: Date;
    readonly transaction: ProtectedSessionTransaction;
  }): Promise<string | undefined>;
  assertFailurePostcondition(command: {
    readonly actorMemberId: null;
    readonly auditEventId?: string;
    readonly context?: ActiveWorkspaceContext;
    readonly occurredAt: Date;
    readonly transaction: ProtectedSessionTransaction;
  }): Promise<void>;
}

export type AuthenticationAttemptBudgetResult =
  | {
    readonly reservationId: string;
    readonly retryAfterSeconds: number;
    readonly status: "rate-limited";
  }
  | { readonly reservationId: string; readonly status: "admitted" };

export interface AuthenticationAttemptBudget {
  reserve(
    command: {
      readonly clientAddress: string;
      readonly occurredAt: Date;
      readonly scope: "mfa" | "password";
      readonly subject: string;
    },
  ): Promise<AuthenticationAttemptBudgetResult>;
  finalize(command: {
    readonly reservationId: string;
    readonly statusCode: AuthenticationRequestStatusCode;
    readonly transaction?: ProtectedSessionTransaction;
    readonly userId?: string;
  }): Promise<void>;
}

export interface AuthenticationResponseEqualizer {
  run<T>(work: () => Promise<T>): Promise<T>;
}
