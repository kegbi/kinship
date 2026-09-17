/**
 * What a route declaration repeats.
 *
 * Seventy routes take an `Origin`, a hundred and four accept a requested
 * workspace, and five hundred and seventy-four answers are the same RFC 9457
 * problem body. Naming those once is what keeps a route file readable: what is
 * left in a descriptor is the part that is about that route.
 */

import { z } from "zod";
import type { RouteResponse } from "../registry.ts";
import { problem } from "../schemas/shared.ts";

const origin = z.url().meta({
  description: "Must exactly match the configured public web origin.",
});

const workspace = z.uuid().optional().meta({
  description:
    "Optional requested workspace; validated against active membership.",
});

/** The write routes' origin check, as a header the document declares. */
export const originHeaders = z.object({ Origin: origin });

/** The optional workspace selection every workspace-scoped read accepts. */
export const workspaceHeaders = z.object({ "X-Workspace-Id": workspace });

/** Both, which is what a workspace-scoped write takes. */
export const originAndWorkspaceHeaders = z.object({
  Origin: origin,
  "X-Workspace-Id": workspace,
});

/** The cookie a session transition sets, which no client may read back. */
export const setCookieHeader = z.object({
  "Set-Cookie": z.string().optional().meta({ writeOnly: true }),
});

/** One refused request. */
export const problemResponse: RouteResponse = {
  description: "RFC 9457 problem details",
  content: { "application/problem+json": problem },
};

/** The same refusal, plus the wait a throttled caller has to serve. */
export const rateLimitedProblem: RouteResponse = {
  description: "RFC 9457 problem details",
  content: { "application/problem+json": problem },
  headers: z.object({
    "Retry-After": z.number().int().min(1).optional().meta({
      description: "Seconds before another current-password attempt.",
    }),
  }),
};

/** Every status that answers with the plain problem body. */
export function problemResponses(
  ...statuses: readonly number[]
): Readonly<Record<string, RouteResponse>> {
  return Object.fromEntries(
    statuses.map((status) => [String(status), problemResponse]),
  );
}
