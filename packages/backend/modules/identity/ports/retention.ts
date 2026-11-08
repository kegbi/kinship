/**
 * How identity deletes the authentication rows nobody can use any more
 * (SECA-04, BEQ-15, AUD-A2).
 *
 * Each method deletes at most `limit` rows written before its cutoff and says
 * how many it deleted, so the use case works through a backlog in short
 * statements. None of them touches a row anything still reads: a session is
 * only ever looked up while it is live, a reset request only within its hour,
 * and of a verified user's spent verification tokens the newest stays, because
 * it is what tells an account that proved its address here from one imported
 * with a credential that must never activate.
 */

export interface RetentionBatch {
  readonly before: Date;
  readonly limit: number;
}

export interface AuthenticationRetentionRepository {
  /** Sessions that expired, or were revoked, before `before`. */
  deleteEndedSessions(batch: RetentionBatch): Promise<number>;
  /** Password reset requests written before `before`, used or not. */
  deleteResetRequests(batch: RetentionBatch): Promise<number>;
  /**
   * A verified user's verification tokens and registrant verifiers written
   * before `before`, except the newest spent verification token, which proves
   * the address. A pending user's tokens go only with the pending user.
   */
  deleteSpentVerificationTokens(batch: RetentionBatch): Promise<number>;
}
