/**
 * Personal API tokens, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { request, workspaceHeader } from "./request.ts";
import type {
  ApiTokenCreated,
  ApiTokenList,
  ApiTokenRecord,
  ApiTokenScope,
} from "./types.ts";

export function getApiTokens(
  workspaceId?: string,
): Promise<ApiResult<ApiTokenList>> {
  return request("/api/v1/settings/api-tokens", {
    headers: workspaceHeader(workspaceId),
  });
}

export function createApiToken(
  input: {
    readonly expiresAt?: string;
    readonly name: string;
    readonly scopes: readonly ApiTokenScope[];
  },
  workspaceId?: string,
): Promise<ApiResult<ApiTokenCreated>> {
  return request("/api/v1/settings/api-tokens", {
    method: "POST",
    headers: workspaceHeader(workspaceId),
    body: JSON.stringify(input),
  });
}

export function revokeApiToken(
  tokenId: string,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly record: ApiTokenRecord; readonly status: "revoked" }>
> {
  return request(`/api/v1/settings/api-tokens/${encodeURIComponent(tokenId)}`, {
    method: "DELETE",
    headers: workspaceHeader(workspaceId),
  });
}
