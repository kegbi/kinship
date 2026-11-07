/**
 * The little identity decides for itself.
 *
 * This domain is deliberately small, and it is worth saying why rather than
 * padding it. Almost everything identity knows is enforced by the database or
 * by a cryptographic adapter: whether an email is already taken is a unique
 * index, whether a password matches is Argon2id, whether a session is still
 * good is a row with an expiry. A rule re-implemented in TypeScript beside any
 * of those would be a second opinion, and a second opinion about a credential
 * is a way to be wrong.
 *
 * What is genuinely this module's own decision is here: what a conflict is
 * called, how long a password reset link lives, and how long the request
 * endpoint takes to answer.
 *
 * That last one is a security rule, not a timeout. Requesting a reset for an
 * address that has an account and for one that does not must take the same
 * observable time, or the endpoint becomes a way to ask whether somebody has
 * an account here. The window is held open whatever happens, which is why it
 * is bounded on both sides — too short and the mail provider's own latency
 * shows through it, too long and it is a way to hold connections open.
 */

/** Somebody has already registered what this registration is claiming. */
export class IdentityConflictError extends Error {
  constructor() {
    super("Identity already exists.");
    this.name = "IdentityConflictError";
  }
}

/** How long a password reset link works for. */
export const PASSWORD_RESET_WINDOW_MS = 60 * 60_000;

/**
 * How many reset requests one address may make: three in any fifteen
 * minutes, and ten in any rolling day (SECA-03, AUD-M3). A request past either
 * writes nothing and sends nothing, and is answered exactly as one that sent a
 * link, so neither limit says whether the address has an account. A reset
 * link carried by a "you already have an account" notice is a request too.
 */
export const PASSWORD_RESET_REQUEST_LIMITS = {
  burst: { count: 3, windowMilliseconds: 15 * 60_000 },
  daily: { count: 10, windowMilliseconds: 24 * 60 * 60_000 },
} as const;

/** The constant-time answer window, and the bounds it has to fall inside. */
export const PASSWORD_RESET_DELIVERY_WINDOW = {
  default: 1_500,
  minimum: 100,
  maximum: 5_000,
} as const;

/** When a reset link requested now stops working. */
export function passwordResetExpiry(now: Date): Date {
  return new Date(now.getTime() + PASSWORD_RESET_WINDOW_MS);
}

/**
 * The window the request endpoint holds open, or a refusal to start at all.
 *
 * A misconfigured window is raised when the use case is built rather than when
 * somebody requests a reset, because a deployment that would leak whether an
 * address is registered should not come up.
 */
export function deliveryWindow(requested: number | undefined): number {
  const milliseconds = requested ?? PASSWORD_RESET_DELIVERY_WINDOW.default;
  if (
    !Number.isFinite(milliseconds) ||
    milliseconds < PASSWORD_RESET_DELIVERY_WINDOW.minimum ||
    milliseconds > PASSWORD_RESET_DELIVERY_WINDOW.maximum
  ) {
    throw new Error("Password recovery delivery window must be 100-5000ms.");
  }
  return milliseconds;
}
