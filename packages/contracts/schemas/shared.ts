/**
 * What every surface answers with.
 *
 * `Problem` is RFC 9457 as `apps/api/http/problem.ts` writes it, and it is the
 * body behind 574 of this API's documented answers. It lives here rather than
 * in a domain file because a refusal belongs to no one domain, and because the
 * generator has to be able to name it once.
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
