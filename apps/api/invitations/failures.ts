/**
 * Everything an invitation can refuse to do, in five tables.
 *
 * Every refusal that names the invitation's own state — expired, revoked,
 * already used, not an invitation at all — is one table, because the four are
 * one vocabulary and the three routes that meet them said the same three
 * sentences. The other four tables exist because the same four states have to
 * be said differently to somebody registering, to somebody waiting for a
 * verification email, and to somebody signing in.
 *
 * They live together rather than with their routes because the create, the
 * register, and the accept steps read across them.
 */

import { failureResponder, type FailureTable } from "../http/failures.ts";

/**
 * What an invitation that cannot be used says.
 *
 * `invalid` is 404 and the three spent states are 410, which is the
 * distinction a page needs: a link that was never an invitation is a wrong
 * address, and one that has expired, been revoked, or been used is an address
 * that no longer leads anywhere.
 */
export const INVITATION_FAILURES: FailureTable = {
  fallback: {
    code: "invitation_used",
    detail: "This invitation has already been used.",
    status: 410,
    title: "Invitation unavailable",
  },
  statuses: {
    "already-member": {
      code: "already_member",
      detail:
        "A membership record for this workspace already exists and this invitation was not consumed.",
      status: 409,
      title: "Membership already exists",
    },
    expired: {
      code: "invitation_expired",
      detail: "This invitation has expired.",
      status: 410,
      title: "Invitation unavailable",
    },
    invalid: {
      code: "invitation_invalid",
      detail: "This invitation link is invalid.",
      status: 404,
      title: "Invitation unavailable",
    },
    revoked: {
      code: "invitation_revoked",
      detail: "This invitation was revoked.",
      status: 410,
      title: "Invitation unavailable",
    },
    used: {
      code: "invitation_used",
      detail: "This invitation has already been used.",
      status: 410,
      title: "Invitation unavailable",
    },
    "wrong-user": {
      code: "invitation_wrong_user",
      detail: "This invitation belongs to a different email address.",
      status: 403,
      title: "Use the invited account",
    },
  },
};

/**
 * What a refused invitation registration says.
 *
 * A spent invitation says so; anything else — a wrong address, an identity
 * store that will not answer — says the same sentence, because the invitee's
 * next step is the same either way and the difference is not theirs to act on.
 */
export const INVITATION_REGISTRATION_FAILURES: FailureTable = {
  fallback: {
    code: "invitation_registration_unavailable",
    detail: "Use the invited email address or sign in to an existing account.",
    status: 409,
    title: "Registration unavailable",
  },
  statuses: {
    expired: {
      code: "invitation_expired",
      detail: "This invitation can no longer be used.",
      status: 410,
      title: "Registration unavailable",
    },
    invalid: {
      code: "invitation_registration_unavailable",
      detail:
        "Use the invited email address or sign in to an existing account.",
      status: 404,
      title: "Registration unavailable",
    },
    revoked: {
      code: "invitation_revoked",
      detail: "This invitation can no longer be used.",
      status: 410,
      title: "Registration unavailable",
    },
    used: {
      code: "invitation_used",
      detail: "This invitation can no longer be used.",
      status: 410,
      title: "Registration unavailable",
    },
  },
};

/** What a refused retry of the invitee's verification email says. */
export const INVITATION_DELIVERY_FAILURES: FailureTable = {
  fallback: {
    code: "invitation_used",
    detail: "This invitation can no longer continue.",
    status: 410,
    title: "Verification delivery unavailable",
  },
  statuses: {
    expired: {
      code: "invitation_expired",
      detail: "This invitation can no longer continue.",
      status: 410,
      title: "Verification delivery unavailable",
    },
    invalid: {
      code: "invitation_invalid",
      detail: "This invitation can no longer continue.",
      status: 404,
      title: "Verification delivery unavailable",
    },
    revoked: {
      code: "invitation_revoked",
      detail: "This invitation can no longer continue.",
      status: 410,
      title: "Verification delivery unavailable",
    },
    used: {
      code: "invitation_used",
      detail: "This invitation can no longer continue.",
      status: 410,
      title: "Verification delivery unavailable",
    },
  },
};

/** What a refused invitation sign-in says. */
export const INVITATION_SIGN_IN_FAILURES: FailureTable = {
  fallback: {
    code: "invalid_credentials",
    detail: "The email address or password is incorrect.",
    status: 401,
    title: "Sign-in failed",
  },
  statuses: {
    "rate-limited": {
      code: "authentication_rate_limited",
      detail: "Wait before trying again.",
      status: 429,
      title: "Sign-in delayed",
    },
  },
};

/** What a refused invitation second factor says. */
export const INVITATION_MFA_FAILURES: FailureTable = {
  fallback: {
    code: "invalid_mfa",
    detail: "That authenticator or recovery code is not valid.",
    status: 401,
    title: "Challenge failed",
  },
  statuses: {
    "challenge-expired": {
      code: "mfa_challenge_expired",
      detail: "Return to the invitation and sign in again.",
      status: 410,
      title: "Challenge failed",
    },
    "rate-limited": {
      code: "authentication_rate_limited",
      detail: "Wait before trying again.",
      status: 429,
      title: "Challenge delayed",
    },
  },
};

export const failure = failureResponder(INVITATION_FAILURES);
export const registrationFailure = failureResponder(
  INVITATION_REGISTRATION_FAILURES,
);
export const deliveryFailure = failureResponder(INVITATION_DELIVERY_FAILURES);
export const signInFailure = failureResponder(INVITATION_SIGN_IN_FAILURES);
export const mfaFailure = failureResponder(INVITATION_MFA_FAILURES);
