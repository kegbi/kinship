/**
 * One identifier per request, in the response and in the log line.
 *
 * The gateway logs a request and the API logs the same request, and until now
 * nothing joined the two. A caller may supply `X-Request-Id`; anything that is
 * not a short, safe token is replaced rather than trusted, because the value
 * is echoed back and written into a log line, and a header that carries a
 * newline or a hundred kilobytes is neither an identifier nor an accident.
 */

import type { Context, MiddlewareHandler } from "hono";

/** The header the identifier is read from and echoed in. */
export const REQUEST_ID_HEADER = "X-Request-Id";

/** What a supplied identifier must look like to be kept. */
const SUPPLIED = /^[\w-]{1,128}$/;

/** The context variable the middleware sets. */
export interface RequestIdEnv {
  Variables: {
    requestId: string;
  };
}

/** Whether a supplied identifier may be echoed and logged as it arrived. */
export function acceptableRequestId(
  value: string | undefined,
): value is string {
  return value !== undefined && SUPPLIED.test(value);
}

/** Accepts or mints this request's identifier, and echoes it. */
export function requestId(
  options: { readonly generate?: () => string } = {},
): MiddlewareHandler<RequestIdEnv> {
  const generate = options.generate ?? (() => crypto.randomUUID());
  return async (context, next) => {
    const supplied = context.req.header(REQUEST_ID_HEADER);
    const identifier = acceptableRequestId(supplied) ? supplied : generate();
    context.set("requestId", identifier);
    context.header(REQUEST_ID_HEADER, identifier);
    await next();
    // A route that answers with a `Response` of its own — a download — drops
    // the header set above, so the answer is stamped again once it is known.
    context.res.headers.set(REQUEST_ID_HEADER, identifier);
  };
}

/**
 * This request's identifier, or nothing when the middleware is not mounted.
 *
 * It takes any context: a module's router is typed by the variables its own
 * middleware sets, yet it runs inside the application that set this one.
 */
export function requestIdOf(context: Context): string | undefined {
  return (context as Context<RequestIdEnv>).get("requestId");
}
