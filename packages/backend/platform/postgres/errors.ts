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

/**
 * The codes Postgres.js gives a query whose connection went away under it,
 * the socket's own when it is reset or written to after the server ended it,
 * and the SQLSTATEs a server sends as it drops one: a connection exception
 * (class 08), or an administrator, crash, or startup shutdown (`57P01` to
 * `57P03`, which `pg_terminate_backend()` and a failover produce).
 */
const LOST_CONNECTION_CODES = new Set([
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  "CONNECT_TIMEOUT",
  "ECONNRESET",
  "EPIPE",
  "57P01",
  "57P02",
  "57P03",
]);

/**
 * Whether `error`, or an error it wraps, is the driver reporting that its
 * connection to the database is gone rather than a statement that failed.
 */
export function isConnectionLost(error: unknown): boolean {
  for (
    let current: unknown = error, depth = 0;
    typeof current === "object" && current !== null && depth < 4;
    current = (current as { readonly cause?: unknown }).cause, depth += 1
  ) {
    const code = postgresErrorCode(current);
    if (
      code !== undefined &&
      (LOST_CONNECTION_CODES.has(code) || /^08[0-9A-Z]{3}$/.test(code))
    ) {
      return true;
    }
  }
  return false;
}

/** A stack frame inside the Postgres.js package, however it is installed. */
const DRIVER_FRAME =
  /[\/]postgres(?:[\/][^\/]+|@[^\/]+[\/]node_modules[\/]postgres)[\/](?:cjs[\/]|cf[\/])?src[\/]/;

/** A frame of the runtime itself rather than of any program it runs. */
const RUNTIME_FRAME = /^(?:ext:|node:|internal[\/]|native\b|<anonymous>)/;

/**
 * Whether `error` is the database driver failing on its own, rather than a
 * program fault: a lost connection, or an uncoded error raised inside
 * Postgres.js (or by the runtime on its behalf) before any application frame.
 * Postgres.js raises those from its own timers when a connection dies with a
 * write still queued (BEQ-09), out of reach of the query that queued it.
 *
 * Every error that carries a code and is not a lost connection is a program
 * fault, however driver-shaped its stack: Postgres.js builds each statement
 * error (a SQLSTATE) and each of its own client errors (`UNDEFINED_VALUE`,
 * `MAX_PARAMETERS_EXCEEDED`) inside itself, so the stack starts there for a
 * query the program forgot to await as well.
 */
export function isDriverFault(error: unknown): boolean {
  if (isConnectionLost(error)) return true;
  if (
    !(error instanceof Error) || typeof error.stack !== "string" ||
    (error as { readonly code?: unknown }).code !== undefined
  ) {
    return false;
  }
  for (const line of error.stack.split("\n")) {
    const frame = line.match(/^\s+at (?:.*? \()?(.*?)\)?$/)?.[1];
    if (frame === undefined) continue;
    if (DRIVER_FRAME.test(frame)) return true;
    if (!RUNTIME_FRAME.test(frame)) return false;
  }
  return false;
}
