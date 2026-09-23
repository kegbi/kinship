/**
 * Parsing a request into the shape a use case accepts.
 *
 * Every route repeated the same two lines to read a body —
 * `await context.req.json().catch(() => undefined)` handed to a schema's
 * `safeParse` — and a route that forgot the `.catch(…)` answered 500 to a
 * truncated body where its neighbour answered 400. Both readings live here,
 * and both return the same `ParseResult`, so a route branches on one shape
 * whether it parsed a path parameter, a query string, or a body.
 *
 * `fieldErrors` is the other half: a Zod issue list becomes the `errors` map
 * RFC 9457 carries, one message per field, so a form can mark the field the
 * message is about. A route that has no field-level story to tell simply
 * ignores the map, which is what the routes migrated so far do — their
 * refusals say nothing about which field was wrong, on purpose, and this
 * module does not make them start.
 *
 * `@hono/standard-validator` was declared for this job and never used. It
 * answers a rejected body with its own shape, not RFC 9457, and it cannot
 * refuse a path parameter, so it earns nothing here and GAP-019 removed it.
 */

import type { Context } from "hono";
import type { z } from "zod";
import {
  definedProblem,
  type ProblemDefinition,
  type ProblemErrors,
} from "./problem.ts";

/** A parsed value, or the field messages that stopped it. */
export type ParseResult<Value> =
  | { readonly data: Value }
  | { readonly errors: ProblemErrors };

/** One message per field path, as RFC 9457's `errors` member carries them. */
export function fieldErrors(error: z.ZodError): ProblemErrors {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path.map((segment) => String(segment)).join(".") ||
      "body";
    errors[field] ??= issue.message;
  }
  return errors;
}

/** Parses one already-read value: a path parameter, a header, a query map. */
export function parseValue<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): ParseResult<z.output<Schema>> {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { data: parsed.data }
    : { errors: fieldErrors(parsed.error) };
}

/**
 * Parses the request body as JSON.
 *
 * A body that is not JSON at all is a rejected body, not a crash: the reader
 * throws, and the throw becomes the same `errors` map an ill-typed body does.
 */
export async function parseJsonBody<Schema extends z.ZodType>(
  context: Context,
  schema: Schema,
): Promise<ParseResult<z.output<Schema>>> {
  const body = await context.req.json().catch(() => undefined);
  return parseValue(schema, body);
}

/** Parses the query string as one flat record of strings. */
export function parseQuery<Schema extends z.ZodType>(
  context: Context,
  schema: Schema,
): ParseResult<z.output<Schema>> {
  return parseValue(schema, context.req.query());
}

/** Answers a rejected request, carrying the field messages it produced. */
export function invalidRequest(
  context: Context,
  definition: ProblemDefinition,
  errors?: ProblemErrors,
): Response {
  return definedProblem(context, definition, errors);
}
