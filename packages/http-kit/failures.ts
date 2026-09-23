/**
 * The kernel result status to HTTP problem map.
 *
 * A use case reports an outcome as a `status`-discriminated union built from
 * `SHARED_FAILURE_STATUSES`; the delivery layer turns the failure half of that
 * union into a problem. Eighteen route files had each written that translation
 * as a chain of `if (status === …)`, and the chains disagreed about which HTTP
 * status a shared name deserved.
 *
 * The status half of the translation is shared here once, in
 * `KERNEL_FAILURE_STATUS`. The prose half stays with the domain, because a
 * refusal is only useful when it names what was refused: gifts answers
 * `gift_not_found` where planning answers `task_not_found`. A module declares
 * that prose as a table, adds whatever statuses only it can raise, and gets one
 * responder back.
 */

import type { Context } from "hono";
import { SHARED_FAILURE_STATUSES } from "../backend/shared-kernel/result.ts";
import {
  definedProblem,
  type ProblemDefinition,
  type ProblemErrors,
  type ProblemStatus,
} from "./problem.ts";

/**
 * The HTTP status each shared kernel failure answers with.
 *
 * A module's own extra statuses (`stale`, `idempotency-conflict`, and their
 * peers) carry their status in the module's own table, because only the module
 * knows whether its extra name is a conflict or a refused input.
 */
export const KERNEL_FAILURE_STATUS = {
  "archived-write-rejected": 409,
  conflict: 409,
  forbidden: 403,
  "not-found": 404,
  unavailable: 503,
  "validation-error": 400,
} as const satisfies Record<
  typeof SHARED_FAILURE_STATUSES[number],
  ProblemStatus
>;

/** One entry of a module's failure table. */
export interface DomainFailure {
  readonly code: string;
  readonly detail: string;
  /** Required for a status outside the shared kernel vocabulary. */
  readonly status?: ProblemStatus;
  readonly title: string;
}

/** What a module declares so its failures become problems. */
export interface FailureTable {
  /**
   * The answer for a status the table does not name. It is the only entry that
   * carries the result's field errors, which is where a rejected input's
   * messages come from.
   */
  readonly fallback: ProblemDefinition;
  readonly statuses: Readonly<Record<string, DomainFailure>>;
}

/** A use case result, or just the status it reported. */
export type FailureResult =
  | string
  | { readonly errors?: ProblemErrors; readonly status: string };

export type FailureResponder = (
  context: Context,
  result: FailureResult,
) => Response;

function definition(
  name: string,
  failure: DomainFailure,
): ProblemDefinition {
  const shared = (KERNEL_FAILURE_STATUS as Record<string, ProblemStatus>)[name];
  const status = failure.status ?? shared;
  if (status === undefined) {
    throw new Error(
      `The failure ${name} is outside the shared kernel vocabulary, so its table entry must declare a status.`,
    );
  }
  return {
    code: failure.code,
    detail: failure.detail,
    status,
    title: failure.title,
  };
}

/**
 * Resolves a table into the problem each status answers with.
 *
 * `http/failures_test.ts` pins every migrated route file's table through this,
 * which is what keeps a refactor from quietly rewording a refusal the web app
 * matches on.
 */
export function failureDefinitions(
  table: FailureTable,
): ReadonlyMap<string, ProblemDefinition> {
  return new Map<string, ProblemDefinition>(
    Object.entries(table.statuses).map((
      [name, failure],
    ) => [name, definition(name, failure)]),
  );
}

/**
 * Builds a module's failure responder.
 *
 * The table is resolved here, once, so a table that names a status outside the
 * kernel vocabulary without declaring its HTTP status fails when the module is
 * composed rather than on the one request that reaches it.
 */
export function failureResponder(table: FailureTable): FailureResponder {
  const defined = failureDefinitions(table);
  return (context, result) => {
    const status = typeof result === "string" ? result : result.status;
    const named = defined.get(status);
    if (named) return definedProblem(context, named);
    const errors = typeof result === "string" ? undefined : result.errors;
    return definedProblem(context, table.fallback, errors);
  };
}
