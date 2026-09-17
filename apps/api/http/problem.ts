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
 * deployment setting. One of the eighteen copies — governance's — built it
 * from `kinship.invalid` instead; GAP-020 moved that file onto this one, so
 * its problems now carry the same prefix as everybody else's.
 */

import type { Context } from "hono";

/** The URI prefix every problem `type` is built from. */
export const PROBLEM_TYPE_PREFIX = "https://kinship.test/problems/";

/**
 * Every HTTP status this API answers a refused request with.
 *
 * The list is the union of what the route files actually answer, not of what
 * HTTP defines: a status that appears here is one some route reaches, and a
 * route that wants another has to add it here first, where the whole set is
 * visible at once.
 */
export type ProblemStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 410
  | 413
  | 415
  | 423
  | 429
  | 503;

/** Field name to the message shown against that field. */
export type ProblemErrors = Readonly<Record<string, string>>;

/**
 * Extra members a single refusal carries beyond RFC 9457's own.
 *
 * Only one refusal has any: the final-owner conflict names the workspaces
 * that block leaving, because the page cannot say what to do next without
 * them. They are serialized after `code`, which is where the hand-written
 * responder put them.
 */
export type ProblemExtensions = Readonly<Record<string, unknown>>;

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

/** That body, with whatever extension members a refusal added. */
export type ExtendedProblemBody = ProblemBody & ProblemExtensions;

/** The serialized body, without the response around it. */
export function problemBody(
  status: ProblemStatus,
  code: string,
  title: string,
  detail: string,
  errors?: ProblemErrors,
  extensions?: ProblemExtensions,
): ExtendedProblemBody {
  return {
    type: `${PROBLEM_TYPE_PREFIX}${code}`,
    title,
    status,
    detail,
    code,
    ...(errors ? { errors } : {}),
    ...extensions,
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
  extensions?: ProblemExtensions,
): Response {
  return context.body(
    JSON.stringify(
      problemBody(status, code, title, detail, errors, extensions),
    ),
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
  extensions?: ProblemExtensions,
): Response {
  return problem(
    context,
    definition.status,
    definition.code,
    definition.title,
    definition.detail,
    errors,
    extensions,
  );
}
