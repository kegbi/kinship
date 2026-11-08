/**
 * What every surface answers with.
 *
 * `Problem` is RFC 9457 as `packages/http-kit/problem.ts` writes it, and it is the
 * body behind 574 of this API's documented answers. It lives here rather than
 * in a domain file because a refusal belongs to no one domain, and because the
 * generator has to be able to name it once.
 *
 * `pageQuery` is the third: GAP-023 gave every list endpoint one spelling of
 * "how many" and "from where", so a client learns the rule once and a new list
 * cannot invent its own bounds. A list that carries filters of its own extends
 * it rather than restating them.
 *
 * `oneOf` is the other shared thing: Zod has a single union and `zod-openapi`
 * renders it as `anyOf`, which says "at least one of these" where every union
 * in this package means "exactly one". Rather than teach twelve schemas to
 * rewrite their own rendering, a union that means exactly one carries
 * `EXACTLY_ONE`, and `tools/contracts/build.ts` turns the marker into `oneOf`
 * when it renders the document. That keeps this package free of the OpenAPI
 * library: nothing the API serves at runtime has to load a generator.
 */

import { z } from "zod";

/**
 * The marker a union carries when exactly one of its options may match.
 *
 * It never reaches the published document: the generator reads it, renders
 * `oneOf`, and drops the marker.
 */
export const EXACTLY_ONE = "x-exactly-one";

/**
 * A canonical identifier.
 *
 * Every path parameter and almost every identifier in this API is one, and a
 * route parses its own parameters with this exact schema, so the document
 * cannot advertise a format the route does not enforce.
 */
export const uuid = z.uuid();

/** What a name holding a control character is told. */
export const CONTROL_CHARACTER_MESSAGE =
  "Text may not contain control characters.";

/**
 * Text with no C0 control, DEL, or C1 control in it.
 *
 * PostgreSQL refuses U+0000 in `text`, so a NUL in a name that reached the
 * database would fail only for an address that writes one, and the answer
 * would say which addresses have accounts (SECA-02). The HTTP kit refuses a
 * NUL first (SECA-08); the contract says so too (REL-117). No name holds a
 * tab, a newline, or any other control either, so the pattern refuses them
 * all.
 */
// deno-lint-ignore no-control-regex
const CONTROL_FREE = /^[^\u0000-\u001F\u007F-\u009F]*$/;

/**
 * One line of trimmed text a person typed as a name: a person's first or last
 * name, a workspace's name. The caller adds its own bounds.
 */
export function singleLineText(): z.ZodString {
  return z.string().trim().regex(CONTROL_FREE, CONTROL_CHARACTER_MESSAGE);
}

/**
 * The continuation token a list resumes from.
 *
 * It is opaque: what it carries is the paging module's business, and the only
 * thing the transport says about it is that it is text a caller echoes back
 * unchanged. The ceiling is the same one every cursor parameter already
 * published, so a caller cannot make a listing read an unbounded string.
 */
export const pageCursor = z.string().max(2000);

/**
 * How many rows one page carries.
 *
 * One to fifty, twenty by default. A list whose own page is smaller keeps its
 * smaller bound; nothing raises the ceiling.
 */
export const pageLimit = z.coerce.number().int().min(1).max(50).default(20);

/**
 * What every list endpoint accepts.
 *
 * `cursor` is absent on a first page, and `limit` defaults rather than being
 * required, so `GET /api/v1/…` with no query is always a valid first page.
 */
export const pageQuery = z.strictObject({
  cursor: pageCursor.optional(),
  limit: pageLimit,
});

/** A union of disjoint options, rendered as `oneOf`. */
export function oneOf<
  const Options extends readonly [z.ZodType, z.ZodType, ...z.ZodType[]],
>(options: Options): z.ZodUnion<Options> {
  return z.union(options).meta({ [EXACTLY_ONE]: true });
}

export const blockingWorkspace = z.strictObject({
  id: z.uuid(),
  name: z.string(),
}).meta({ id: "BlockingWorkspace" });

export const problem = z.strictObject({
  type: z.url(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  code: z.string(),
  errors: z.record(z.string(), z.string()).optional(),
  blockingWorkspaces: z.array(blockingWorkspace).optional(),
}).meta({ id: "Problem" });
