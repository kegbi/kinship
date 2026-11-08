/**
 * How long request-log rows live (SECA-04, BEQ-15, AUD-A2).
 *
 * The retention deletes two kinds of row, and each lives as long as something
 * reads it, plus a margin. A sign-in or MFA attempt is read by the throttle
 * for at most its longest window (`authentication_throttle.ts`, fifteen
 * minutes), so it is deleted after an hour. A mail-budget reservation (AUD-M3)
 * counts against a rolling day, so it is kept for two. Any other row the table
 * holds — API usage, such as Monica's imported `api_usage` — is not read by
 * either, and is not the retention's to delete.
 */

const HOUR_MS = 60 * 60_000;

export const REQUEST_LOG_RETENTION = {
  /** Mail-budget reservations: the 24 h budget window plus a day. */
  mailBudgetMilliseconds: 48 * HOUR_MS,
  /** Throttle attempts: the 15 min throttle window plus 45 min. */
  requestMilliseconds: HOUR_MS,
} as const;

/** The instants before which each kind of row is purged, at `now`. */
export function requestLogRetentionCutoffs(now: Date): {
  readonly mailBudgetBefore: Date;
  readonly requestsBefore: Date;
} {
  return {
    mailBudgetBefore: new Date(
      now.getTime() - REQUEST_LOG_RETENTION.mailBudgetMilliseconds,
    ),
    requestsBefore: new Date(
      now.getTime() - REQUEST_LOG_RETENTION.requestMilliseconds,
    ),
  };
}
