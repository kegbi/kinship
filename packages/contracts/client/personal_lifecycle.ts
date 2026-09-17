/**
 * Leaving a workspace and deleting an identity, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { request, workspaceHeader } from "./request.ts";
import type { PersonalLifecyclePreview } from "./types.ts";

export function getPersonalLifecyclePreview(
  workspaceId?: string,
): Promise<ApiResult<PersonalLifecyclePreview>> {
  return request("/api/v1/settings/personal-lifecycle", {
    headers: workspaceHeader(workspaceId),
  });
}

export function leaveCurrentWorkspace(
  input: { readonly confirmation: string; readonly password: string },
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly next: "/app" | "/auth/sign-in";
      readonly nextWorkspaceId?: string;
      readonly status: "left";
    }
  >
> {
  return request("/api/v1/settings/personal-lifecycle/leave", {
    method: "POST",
    headers: workspaceHeader(workspaceId),
    body: JSON.stringify(input),
  });
}

export function deletePersonalIdentity(
  input: { readonly confirmation: string; readonly password: string },
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly next: "/auth/sign-in"; readonly status: "deleted" }>
> {
  return request("/api/v1/settings/personal-lifecycle", {
    method: "DELETE",
    headers: workspaceHeader(workspaceId),
    body: JSON.stringify(input),
  });
}
