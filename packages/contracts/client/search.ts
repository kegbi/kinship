/**
 * Workspace search (GAP-048), over fetch: one query, five groups. An empty
 * query answers the member's recent people in the people group (FEQ-05).
 * `signal` cancels a search a newer one superseded; such a search is never
 * shared with another caller.
 */

import type { ApiResult } from "./request.ts";
import { request, workspaceHeader } from "./request.ts";
import type { SearchResults, SearchWorkspaceInput } from "./types.ts";

export function searchWorkspace(
  input: SearchWorkspaceInput,
  workspaceId?: string,
  signal?: AbortSignal,
): Promise<ApiResult<SearchResults>> {
  const query = new URLSearchParams({ q: input.query });
  if (input.limit) query.set("limit", String(input.limit));
  if (input.sort) query.set("sort", input.sort);
  return request(`/api/v1/search?${query.toString()}`, {
    headers: workspaceHeader(workspaceId),
    ...(signal ? { signal } : {}),
  });
}
