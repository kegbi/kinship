/**
 * Resetting and deleting a workspace, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { request, workspaceHeader } from "./request.ts";
import type { WorkspaceLifecyclePreview } from "./types.ts";

export function getWorkspaceLifecyclePreview(
  workspaceId?: string,
): Promise<ApiResult<WorkspaceLifecyclePreview>> {
  return request("/api/v1/settings/workspace-lifecycle", {
    headers: workspaceHeader(workspaceId),
  });
}

export function resetWorkspace(
  input: {
    readonly confirmation: string;
    readonly impactToken: string;
    readonly password: string;
  },
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly cleanupStatus: "complete" | "pending";
      readonly next: "/auth/sign-in";
      readonly status: "reset";
    }
  >
> {
  return request("/api/v1/settings/workspace-lifecycle/reset", {
    method: "POST",
    headers: workspaceHeader(workspaceId),
    body: JSON.stringify(input),
  });
}

export function deleteWorkspace(
  input: {
    readonly confirmation: string;
    readonly impactToken: string;
    readonly password: string;
  },
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly cleanupStatus: "complete" | "pending";
      readonly next: "/auth/sign-in";
      readonly status: "deleted";
    }
  >
> {
  return request("/api/v1/settings/workspace-lifecycle", {
    method: "DELETE",
    headers: workspaceHeader(workspaceId),
    body: JSON.stringify(input),
  });
}
