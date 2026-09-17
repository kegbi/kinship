/**
 * The backstop on how much body a request may carry.
 *
 * Two routes already bound their own input — the person-file upload streams
 * against a ten megabyte ceiling, the Monica import staging route refuses
 * anything past its 1.5 MB envelope — and every other route had nothing at
 * all between an unbounded request body and `context.req.json()`. The gateway
 * caps `/api/v1/` at the import envelope, but the API is also reached through
 * the development proxy, and a limit that only exists in one deployment is not
 * a limit.
 *
 * This is the cap for everything else. The two routes that declare a larger
 * ceiling of their own stay exempt, so each keeps answering its own, more
 * specific refusal, and this middleware never overtakes them.
 */

import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { definedProblem, type ProblemDefinition } from "./problem.ts";

/** The answer to a body past the cap. */
export const REQUEST_TOO_LARGE: ProblemDefinition = {
  code: "request_too_large",
  detail: "Send a smaller request body.",
  status: 413,
  title: "Request too large",
};

/** The cap for a route that declares no larger ceiling of its own. */
export const JSON_BODY_MAX_BYTES = 1_048_576;

export interface BodyLimitOptions {
  /** Requests this middleware leaves to a route's own, larger ceiling. */
  readonly exempt?: (context: Context) => boolean;
  readonly maxBytes: number;
}

/** Refuses a request body past `maxBytes`, unless the request is exempt. */
export function requestBodyLimit(
  options: BodyLimitOptions,
): MiddlewareHandler {
  const limited = bodyLimit({
    maxSize: options.maxBytes,
    onError: (context) => definedProblem(context, REQUEST_TOO_LARGE),
  });
  const exempt = options.exempt;
  return async (context, next) => {
    if (exempt?.(context)) return await next();
    return await limited(context, next);
  };
}
