/**
 * The sign-in and MFA throttle's fixed policy (SECA-04, AUD-A3): which
 * request-log rows it writes, and how far back it reads them.
 *
 * The throttle tells its two scopes apart by `path`, the route each attempt
 * was made on. The request-log retention (AUD-A2) deletes exactly these rows
 * once the longest window has passed, so the windows live here, beside the
 * retention that depends on them, rather than private to the adapter that
 * counts them.
 */

/** The `path` each throttled scope records its attempts under. */
export const AUTHENTICATION_THROTTLE_PATHS = {
  mfa: "/api/v1/mfa-challenges",
  password: "/api/v1/sessions",
} as const;

/** Each (client address, subject) pair: failures within five minutes. */
export const ADDRESS_THROTTLE_WINDOW_MILLISECONDS = 5 * 60_000;

/** Each subject across every address: attempts within fifteen minutes. */
export const ACCOUNT_THROTTLE_WINDOW_MILLISECONDS = 15 * 60_000;

/** The furthest back the throttle ever reads an attempt. */
export const LONGEST_THROTTLE_WINDOW_MILLISECONDS = Math.max(
  ADDRESS_THROTTLE_WINDOW_MILLISECONDS,
  ACCOUNT_THROTTLE_WINDOW_MILLISECONDS,
);
