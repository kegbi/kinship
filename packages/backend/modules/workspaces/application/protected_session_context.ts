/**
 * What every sign-in path shares: the throttle, and the failure trail.
 *
 * `recordFailure` is why a failed sign-in is useful at all. Whoever failed has
 * no session and often no resolvable membership, so the event is written
 * against whatever audit context could be found and against a placeholder user
 * when there is none — an attempt nobody can attribute is still an attempt
 * somebody should be able to see.
 *
 * `rejectedByBudget` and `admittedAttempt` are the two halves of finalizing a
 * reservation, and the shape they share is that a thrown error finalizes as
 * 503 and re-throws. A reservation that is never finalized would hold a slot
 * against the client until it expired, so a database outage would start
 * locking people out of their own accounts.
 *
 * A successful attempt is deliberately not finalized here: it is finalized
 * inside the transaction that issues the session, so resetting the throttle
 * and handing out the session commit together.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import {
  protectedSessionHttpStatus,
  type ProtectedSessionResult,
  UNKNOWN_USER_ID,
} from "../domain/session_rules.ts";
import type { ProtectedSessionTransactionRunner } from "../ports/context.ts";
import type {
  ActiveWorkspaceResolver,
  AuthenticationAttemptBudget,
  AuthenticationAudit,
  AuthenticationResponseEqualizer,
  SignInDeviceIssuer,
} from "../ports/session.ts";
import type {
  IdentityAuthenticationFacade,
  VerifiedIdentityEntryFacade,
} from "../../identity/public.ts";

export interface ProtectedSessionDependencies {
  readonly attemptBudget: AuthenticationAttemptBudget;
  readonly audit: AuthenticationAudit;
  readonly clock: Clock;
  readonly identity: IdentityAuthenticationFacade;
  readonly identityEntry?: Pick<
    VerifiedIdentityEntryFacade,
    "issueVerifiedIdentityEntry"
  >;
  readonly responseEqualizer: AuthenticationResponseEqualizer;
  /** Issues sign-in device tokens; without it none are issued (AUD-A3). */
  readonly signInDevices?: SignInDeviceIssuer;
  readonly transaction: ProtectedSessionTransactionRunner;
  /**
   * Runs a session resolution's reads on one connection without a
   * transaction. A deployment passes it; without it a resolution runs inside
   * `transaction`, which answers the same at two more round trips.
   */
  readonly connection?: ProtectedSessionTransactionRunner;
  readonly workspace: ActiveWorkspaceResolver;
}

export interface SignInCommand {
  /** The sign-in device token the browser carried, if any. */
  readonly deviceToken?: string;
  readonly email: string;
  readonly expectedEmail?: string;
  readonly identityOnly?: boolean;
  readonly ipAddress: string;
  readonly password: string;
  readonly previousSessionToken?: string;
  readonly requestedWorkspaceId?: string;
  readonly userAgent?: string;
}

export interface CompleteMfaCommand {
  readonly challengeToken: string;
  readonly expectedEmail?: string;
  readonly factor: string;
  readonly ipAddress: string;
  readonly identityOnly?: boolean;
  readonly previousSessionToken?: string;
  readonly requestedWorkspaceId?: string;
  readonly userAgent?: string;
}

/** The audit trail a failed attempt leaves, whoever it turns out to be. */
export async function recordFailure(
  dependencies: ProtectedSessionDependencies,
  userId: string | undefined,
): Promise<void> {
  await dependencies.transaction.run(async (transaction) => {
    const context = await dependencies.workspace.resolveAuditContext({
      transaction,
      userId: userId ?? UNKNOWN_USER_ID,
    });
    const occurredAt = dependencies.clock.now();
    const auditEventId = await dependencies.audit.recordFailure({
      actorMemberId: null,
      ...(context ? { context } : {}),
      occurredAt,
      transaction,
    });
    await dependencies.audit.assertFailurePostcondition({
      actorMemberId: null,
      ...(auditEventId ? { auditEventId } : {}),
      ...(context ? { context } : {}),
      occurredAt,
      transaction,
    });
  });
}

/** An attempt the throttle turned away, recorded and finalized. */
export async function rejectedByBudget(
  dependencies: ProtectedSessionDependencies,
  scope: "mfa" | "password",
  subject: string,
  reservationId: string,
  retryAfterSeconds: number,
): Promise<ProtectedSessionResult> {
  try {
    const auditUserId = await dependencies.identity
      .resolveAuthenticationAuditUser({ scope, subject });
    await recordFailure(dependencies, auditUserId);
  } catch (error) {
    await dependencies.attemptBudget.finalize({
      reservationId,
      statusCode: 503,
    });
    throw error;
  }
  await dependencies.attemptBudget.finalize({
    reservationId,
    statusCode: 429,
  });
  return { retryAfterSeconds, status: "rate-limited" };
}

/**
 * An attempt the throttle let through, finalized with what it came to.
 *
 * A success is left alone: it is finalized inside the transaction that issues
 * the session, so the reset and the session commit together.
 */
export async function admittedAttempt(
  dependencies: ProtectedSessionDependencies,
  reservationId: string,
  work: (reservationId: string) => Promise<ProtectedSessionResult>,
): Promise<ProtectedSessionResult> {
  try {
    const result = await work(reservationId);
    if (
      result.status !== "authenticated" &&
      result.status !== "identity-authenticated"
    ) {
      await dependencies.attemptBudget.finalize({
        reservationId,
        statusCode: protectedSessionHttpStatus(result),
      });
    }
    return result;
  } catch (error) {
    await dependencies.attemptBudget.finalize({
      reservationId,
      statusCode: 503,
    });
    throw error;
  }
}
