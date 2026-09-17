/**
 * The one RFC 9457 responder.
 *
 * Eighteen route files had each written the same `problem()` out again, in
 * three signatures that had already drifted apart: two of them could not carry
 * field errors at all. The body and the two headers below are the ones every
 * one of those copies produced, so a route that moves onto this module answers
 * byte for byte what it answered before.
 *
 * `type` is a stable URI built from the code. It is an identifier, not a
 * document to fetch, which is why the prefix is a constant here and not a
 * deployment setting.
 */

import type { Context } from "hono";

/** The URI prefix every problem `type` is built from. */
export const PROBLEM_TYPE_PREFIX = "https://kinship.test/problems/";

/** Every HTTP status this API answers a refused request with. */
export type ProblemStatus = 400 | 401 | 403 | 404 | 409 | 413 | 503;

/** Field name to the message shown against that field. */
export type ProblemErrors = Readonly<Record<string, string>>;

/** A problem worth naming once: the status, code, and prose of one refusal. */
export interface ProblemDefinition {
  readonly code: string;
  readonly detail: string;
  readonly status: ProblemStatus;
  readonly title: string;
}

/** The problem body as it goes on the wire. */
export interface ProblemBody {
  readonly code: string;
  readonly detail: string;
  readonly errors?: ProblemErrors;
  readonly status: ProblemStatus;
  readonly title: string;
  readonly type: string;
}

/** The serialized body, without the response around it. */
export function problemBody(
  status: ProblemStatus,
  code: string,
  title: string,
  detail: string,
  errors?: ProblemErrors,
): ProblemBody {
  return {
    type: `${PROBLEM_TYPE_PREFIX}${code}`,
    title,
    status,
    detail,
    code,
    ...(errors ? { errors } : {}),
  };
}

/**
 * Answers one refused request.
 *
 * `Cache-Control: no-store` keeps a refusal out of every cache between here
 * and the browser, and `application/problem+json` is what the web app reads
 * the `code` out of.
 */
export function problem(
  context: Context,
  status: ProblemStatus,
  code: string,
  title: string,
  detail: string,
  errors?: ProblemErrors,
): Response {
  return context.body(
    JSON.stringify(problemBody(status, code, title, detail, errors)),
    status,
    {
      "Cache-Control": "no-store",
      "Content-Type": "application/problem+json",
    },
  );
}

/** The same answer, from a definition a module named once. */
export function definedProblem(
  context: Context,
  definition: ProblemDefinition,
  errors?: ProblemErrors,
): Response {
  return problem(
    context,
    definition.status,
    definition.code,
    definition.title,
    definition.detail,
    errors,
  );
}
