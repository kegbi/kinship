/**
 * PostgreSQL error codes as kernel failure statuses.
 *
 * A driver error is infrastructure detail and must not reach a use case: the
 * application layer reads a `status`, never a SQLSTATE. Four adapters each
 * rewrote the same `typeof error === "object" && error !== null && "code" in
 * error && error.code === "23505"` guard to keep it that way, and each knew
 * only about unique violations.
 *
 * The translation lives here instead, so an adapter maps once and returns the
 * shared status its use case already understands.
 */

import type { SharedFailureCode } from "../../shared-kernel/result.ts";

/** The SQLSTATE codes the backend translates rather than propagates. */
export const POSTGRES_FAILURE_STATUS = {
  /** `foreign_key_violation`: the row this one points at is not there. */
  "23503": "not-found",
  /** `unique_violation`: something else already claims this key. */
  "23505": "conflict",
  /** `serialization_failure`: concurrent work lost its snapshot; retryable. */
  "40001": "unavailable",
} as const satisfies Readonly<Record<string, SharedFailureCode>>;

export type PostgresFailureStatus =
  typeof POSTGRES_FAILURE_STATUS[keyof typeof POSTGRES_FAILURE_STATUS];

/** The SQLSTATE an error carries, if it is a driver error at all. */
export function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { readonly code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * The failure status this error maps to, or `undefined` when it maps to none.
 *
 * An unmapped error is a fault, not an outcome: the adapter rethrows it and
 * the transaction wrapper turns it into `unavailable` at the boundary.
 */
export function postgresFailureStatus(
  error: unknown,
): PostgresFailureStatus | undefined {
  const code = postgresErrorCode(error);
  return code !== undefined && code in POSTGRES_FAILURE_STATUS
    ? POSTGRES_FAILURE_STATUS[code as keyof typeof POSTGRES_FAILURE_STATUS]
    : undefined;
}

/** Whether this error is the unique violation an upsert races against. */
export function isUniqueViolation(error: unknown): boolean {
  return postgresErrorCode(error) === "23505";
}
