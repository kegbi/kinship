/**
 * Workspace invitations and everything an invitee does, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { request } from "./request.ts";
import type {
  Authenticated,
  InvitationInspection,
  WorkspaceMembers,
} from "./types.ts";

export function getWorkspaceMembers(
  workspaceId?: string,
): Promise<ApiResult<WorkspaceMembers>> {
  return request("/api/v1/workspace-members", {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function createWorkspaceInvitation(
  input: { readonly email: string; readonly role: "admin" | "member" },
  workspaceId?: string,
): Promise<ApiResult<{ readonly status: "invited" }>> {
  return request("/api/v1/workspace-invitations", {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function registerInvitedIdentity(
  input: {
    readonly email: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly password: string;
    readonly token: string;
  },
): Promise<ApiResult<{ readonly status: "verification-required" }>> {
  return request("/api/v1/workspace-invitations/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function retryInvitedVerificationDelivery(): Promise<
  ApiResult<{ readonly status: "accepted" }>
> {
  return request("/api/v1/workspace-invitations/verification-delivery", {
    method: "POST",
    body: "{}",
  });
}

export function authenticateWorkspaceInvitation(
  input: {
    readonly email: string;
    readonly password: string;
    readonly token?: string;
  },
): Promise<
  ApiResult<
    { readonly status: "authenticated"; readonly next: "/invite/continue" } | {
      readonly status: "mfa-required";
      readonly next: "/auth/mfa";
    }
  >
> {
  return request("/api/v1/workspace-invitations/authenticate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function completeWorkspaceInvitationMfa(
  factor: string,
): Promise<
  ApiResult<
    { readonly status: "authenticated"; readonly next: "/invite/continue" }
  >
> {
  return request("/api/v1/workspace-invitations/mfa", {
    method: "POST",
    body: JSON.stringify({ factor }),
  });
}

export function inspectWorkspaceInvitation(
  token?: string,
): Promise<ApiResult<InvitationInspection>> {
  return request("/api/v1/workspace-invitations/inspect", {
    method: "POST",
    body: JSON.stringify(token ? { token } : {}),
  });
}

export function acceptWorkspaceInvitation(
  token?: string,
): Promise<
  ApiResult<
    {
      readonly status: "accepted";
      readonly next: "/app";
      readonly workspace: Authenticated["workspace"];
    }
  >
> {
  return request("/api/v1/workspace-invitations/accept", {
    method: "POST",
    body: JSON.stringify(token ? { token } : {}),
  });
}
