/**
 * Workspace search over HTTP (GAP-048, `SEARCH-001`).
 *
 * The people surface serves it, beside the directory it extends: the palette
 * that used to ask the directory for people now asks this one route for every
 * group.
 */

import { z } from "zod";
import { defineRoute, type RouteDescriptor } from "../registry.ts";
import { problemResponses, workspaceHeaders } from "./common.ts";
import {
  SEARCH_GROUP_LIMIT_DEFAULT,
  SEARCH_GROUP_LIMIT_MAXIMUM,
  searchResults,
} from "../schemas/search.ts";

/**
 * What `searchWorkspace` accepts in the query string: the query, trimmed
 * before it is measured, a bounded size for each group, and the order people
 * are listed in — the member's contact sort preference, as the directory
 * takes it.
 */
export const searchWorkspaceQuery = z.strictObject({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(SEARCH_GROUP_LIMIT_MAXIMUM)
    .default(SEARCH_GROUP_LIMIT_DEFAULT),
  sort: z.enum(["given-name", "family-name"]).default("given-name"),
});

export const searchWorkspace = defineRoute({
  method: "get",
  path: "/api/v1/search",
  operationId: "searchWorkspace",
  description:
    "Searches the active workspace's people, notes, activities, journal posts, and tasks, each group bounded and filtered by the rules its owning module lists rows with. People are answered first; when the text groups cannot be, each is marked unavailable and the people still answer.",
  security: [{ kinship_session: [] }],
  request: {
    query: searchWorkspaceQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Grouped workspace search results",
      content: {
        "application/json": searchResults,
      },
    },
    ...problemResponses(400, 401, 403, 503),
  },
});

/** The search route. */
export const SEARCH_ROUTES: readonly RouteDescriptor[] = [searchWorkspace];
