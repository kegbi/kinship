/** How api-access deletes request-log rows nothing reads any more (AUD-A2). */

export interface RequestLogRetentionBatch {
  readonly limit: number;
  readonly mailBudgetBefore: Date;
  readonly requestsBefore: Date;
}

export interface RequestLogRetentionRepository {
  /**
   * Deletes at most `limit` rows: mail-budget reservations made before
   * `mailBudgetBefore`, and sign-in and MFA throttle rows made before
   * `requestsBefore`. Any other row is kept.
   */
  deleteExpired(batch: RequestLogRetentionBatch): Promise<number>;
}
