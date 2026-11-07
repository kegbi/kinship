/**
 * How a sign-in ends, and what that means to the caller.
 *
 * `protectedSessionHttpStatus` is the whole reason this file exists. The same
 * mapping decides three different things: what the API answers, what the
 * attempt budget records against the client, and therefore whether a given
 * outcome counts towards being locked out. Two copies of that mapping would
 * eventually disagree, and the way they would disagree is that a refusal would
 * stop being counted.
 *
 * The switch is exhaustive with no default, so a new result status is a
 * compile error here rather than a silently mis-recorded attempt, and 503 is
 * excluded from what it can answer because that is what the coordinator
 * reports when something threw — never what a result means.
 *
 * `client` and `requested` are the small rule underneath: an empty address, an
 * empty user agent, and an empty requested workspace are all absent, because
 * `exactOptionalPropertyTypes` makes the difference between a missing property
 * and a present empty one real, and every caller wants the missing one.
 */

import type { WorkspaceRole } from "./roles.ts";

/** The user identifier a failure is recorded against when there is none. */
export const UNKNOWN_USER_ID = "00000000-0000-0000-0000-000000000000";

/** Every status an authentication request may be finalized under. */
export type AuthenticationRequestStatusCode =
  | 200
  | 202
  | 401
  | 403
  | 410
  | 429
  | 503;

/** The sign-in device token a password sign-in hands its browser (AUD-A3). */
export interface SignInDevice {
  readonly expiresAt: Date;
  /**
   * The cookie lifetime, fixed by the issuer from the clock that dated the
   * token, so the browser never has to be told it by a second clock.
   */
  readonly maxAgeSeconds: number;
  readonly token: string;
}

export type ProtectedSessionResult =
  | { readonly status: "invalid-credentials" | "invalid-mfa" }
  | { readonly status: "challenge-expired" | "membership-inactive" }
  | { readonly retryAfterSeconds: number; readonly status: "rate-limited" }
  | {
    readonly challengeToken: string;
    readonly device?: SignInDevice;
    readonly status: "mfa-required";
  }
  | {
    readonly entryToken: string;
    readonly expiresAt: Date;
    readonly status: "identity-authenticated";
  }
  | {
    readonly device?: SignInDevice;
    readonly expiresAt: Date;
    readonly member: {
      readonly id: string;
      readonly role: WorkspaceRole;
    };
    readonly sessionToken: string;
    readonly status: "authenticated";
    readonly userId: string;
    readonly workspace: { readonly id: string; readonly name: string };
  };

/** What the delivery layer answers, and what the budget records. */
export function protectedSessionHttpStatus(
  result: ProtectedSessionResult,
): Exclude<AuthenticationRequestStatusCode, 503> {
  switch (result.status) {
    case "authenticated":
    case "identity-authenticated":
      return 200;
    case "mfa-required":
      return 202;
    case "invalid-credentials":
    case "invalid-mfa":
      return 401;
    case "membership-inactive":
      return 403;
    case "challenge-expired":
      return 410;
    case "rate-limited":
      return 429;
  }
}

/** What the request said about itself, with the blanks left out. */
export function client(command: {
  readonly ipAddress?: string;
  readonly userAgent?: string;
}): { readonly ipAddress?: string; readonly userAgent?: string } {
  return {
    ...(command.ipAddress ? { ipAddress: command.ipAddress } : {}),
    ...(command.userAgent ? { userAgent: command.userAgent } : {}),
  };
}

/** The workspace the caller asked for, if they asked for one. */
export function requested(command: {
  readonly requestedWorkspaceId?: string;
}): { readonly requestedWorkspaceId?: string } {
  return command.requestedWorkspaceId
    ? { requestedWorkspaceId: command.requestedWorkspaceId }
    : {};
}
