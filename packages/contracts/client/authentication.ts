/**
 * Sign-in, sessions, and password recovery, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { request } from "./request.ts";
import type { Authenticated, SessionContext } from "./types.ts";

export function signIn(
  input: {
    readonly email: string;
    readonly password: string;
    readonly workspaceId?: string;
  },
): Promise<
  ApiResult<
    Authenticated | {
      readonly status: "mfa-required";
      readonly next: "/auth/mfa";
    }
  >
> {
  return request("/api/v1/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function completeMfa(
  factor: string,
  workspaceId?: string,
): Promise<ApiResult<Authenticated>> {
  return request("/api/v1/mfa-challenges", {
    method: "POST",
    body: JSON.stringify({ factor, ...(workspaceId ? { workspaceId } : {}) }),
  });
}

export function requestPasswordReset(
  email: string,
): Promise<ApiResult<{ readonly status: "accepted" }>> {
  return request("/api/v1/password-reset-requests", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(
  token: string,
  password: string,
): Promise<
  ApiResult<{ readonly status: "reset"; readonly next: "/auth/sign-in" }>
> {
  return request("/api/v1/password-resets", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

export function getSession(
  workspaceId?: string,
): Promise<ApiResult<SessionContext>> {
  return request("/api/v1/session", {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function signOut(): Promise<
  ApiResult<{ readonly status: "signed-out"; readonly next: "/auth/sign-in" }>
> {
  return request("/api/v1/sign-out", { method: "POST" });
}
