/**
 * Inviting somebody into a workspace, and everything they do to accept.
 *
 * Eight routes over one flow: an owner invites, the invitee registers or signs
 * in — possibly through a second factor — and finally accepts. The problem
 * responder, the cookie composer, the origin check, the client address, and
 * the kernel status map came from `http/` (GAP-019, GAP-020).
 *
 * The cookies are what hold the flow together, and each is scoped to the
 * narrowest path that needs it: the invitation token and the entry handoff to
 * the invitation routes, the challenge to the one route that completes it, the
 * pending marker to the verification route, and only the established session
 * to `/`. Accepting clears all three of the temporary ones, so a finished
 * invitation leaves nothing behind that could be replayed.
 *
 * Every refusal that names the invitation's own state — expired, revoked,
 * already used, not an invitation at all — is one table, because the four are
 * one vocabulary and the three routes that meet them said the same three
 * sentences.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import type { createWorkspaceInvitationCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { PasswordHasher } from "../../packages/backend/modules/identity/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";
import { clientAddress } from "./http/client_address.ts";
import { cookieValue, SESSION_COOKIE, setCookie } from "./http/cookies.ts";
import { failureResponder, type FailureTable } from "./http/failures.ts";
import { requireMatchingOrigin } from "./http/origin.ts";
import { definedProblem, type ProblemDefinition } from "./http/problem.ts";
import {
  type ActorEnv,
  requireSession,
  sessionActor,
  sessionOf,
} from "./http/session.ts";
import { parseJsonBody } from "./http/validate.ts";

type Invitations = ReturnType<typeof createWorkspaceInvitationCoordinator>;
type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface InvitationHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly hasher: PasswordHasher;
  readonly invitations: Invitations;
  readonly protectedSessions: ProtectedSessions;
}

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(["admin", "member"]),
}).strict();
const optionalTokenSchema = z.object({
  token: z.string().min(32).max(256).optional(),
}).strict();
const invitationRegistrationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100),
  password: z.string().min(12).max(128),
  token: z.string().min(32).max(256),
}).strict();
const invitationAuthenticationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  token: z.string().min(32).max(256).optional(),
}).strict();
const invitationMfaSchema = z.object({
  factor: z.string().trim().min(6).max(128),
}).strict();

/** The cookies this flow carries, and the paths they are scoped to. */
const INVITATION_COOKIE = "kinship_invitation";
const ENTRY_COOKIE = "kinship_entry";
const MFA_COOKIE = "kinship_mfa";
const PENDING_COOKIE = "kinship_invitation_pending";
const INVITATION_PATH = "/api/v1/workspace-invitations";
const MFA_PATH = "/api/v1/workspace-invitations/mfa";
const VERIFICATION_PATH = "/api/v1/email-verifications";
/** A day for the invitation itself, five minutes for a pending factor. */
const INVITATION_COOKIE_SECONDS = 24 * 60 * 60;
const MFA_COOKIE_SECONDS = 5 * 60;

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

const failure = failureResponder(INVITATION_FAILURES);
const registrationFailure = failureResponder(
  INVITATION_REGISTRATION_FAILURES,
);
const deliveryFailure = failureResponder(INVITATION_DELIVERY_FAILURES);
const signInFailure = failureResponder(INVITATION_SIGN_IN_FAILURES);
const mfaFailure = failureResponder(INVITATION_MFA_FAILURES);

const INVITATION_REQUEST_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Provide a valid email address and allowed role.",
  status: 400,
  title: "Invalid invitation",
};
const ALREADY_MEMBER: ProblemDefinition = {
  code: "already_member",
  detail:
    "That email already has a membership record in this workspace. Manage its lifecycle explicitly instead of inviting it again.",
  status: 409,
  title: "Membership already exists",
};
const INVITATION_FORBIDDEN: ProblemDefinition = {
  code: "invitation_forbidden",
  detail: "Only an active workspace owner or admin may invite members.",
  status: 403,
  title: "Invitation forbidden",
};
const INVITATION_DELIVERY_FAILED: ProblemDefinition = {
  code: "invitation_delivery_failed",
  detail:
    "The invitation was saved but its email could not be delivered. Contact an administrator before trying again.",
  status: 503,
  title: "Invitation delivery unavailable",
};
const INVITATION_NOT_CREATED: ProblemDefinition = {
  code: "invitation_delivery_failed",
  detail: "The invitation could not be created. Please try again.",
  status: 503,
  title: "Invitation delivery unavailable",
};
const REGISTRATION_REQUEST_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Check the invitation and registration fields.",
  status: 400,
  title: "Registration unavailable",
};
const INVITEE_VERIFICATION_DELAYED: ProblemDefinition = {
  code: "invitation_verification_delivery_failed",
  detail:
    "Your account was created for this invitation, but the verification email could not be delivered. Retry delivery.",
  status: 503,
  title: "Verification email delayed",
};
const DELIVERY_TOKEN_MISSING: ProblemDefinition = {
  code: "invitation_invalid",
  detail: "Return to the invitation and try again.",
  status: 404,
  title: "Verification delivery unavailable",
};
const DELIVERY_RATE_LIMITED: ProblemDefinition = {
  code: "verification_delivery_rate_limited",
  detail: "Wait a few minutes before requesting another verification email.",
  status: 429,
  title: "Verification retry delayed",
};
const DELIVERY_STILL_FAILING: ProblemDefinition = {
  code: "invitation_verification_delivery_failed",
  detail:
    "The verification email still could not be delivered. Please try again.",
  status: 503,
  title: "Verification email delayed",
};
const INVALID_CREDENTIALS: ProblemDefinition = {
  code: "invalid_credentials",
  detail: "The email address or password is incorrect.",
  status: 401,
  title: "Sign-in failed",
};
const SIGN_IN_UNAVAILABLE: ProblemDefinition = {
  code: "authentication_unavailable",
  detail: "Please try again.",
  status: 503,
  title: "Sign-in unavailable",
};
const MFA_CHALLENGE_EXPIRED: ProblemDefinition = {
  code: "mfa_challenge_expired",
  detail: "Return to the invitation and sign in again.",
  status: 410,
  title: "Challenge expired",
};
const INVITATION_DISCONTINUED: ProblemDefinition = {
  code: "invitation_unavailable",
  detail: "This invitation can no longer continue.",
  status: 410,
  title: "Invitation unavailable",
};
const MFA_UNAVAILABLE: ProblemDefinition = {
  code: "authentication_unavailable",
  detail: "Please try again.",
  status: 503,
  title: "Challenge unavailable",
};
const MEMBERS_UNAVAILABLE: ProblemDefinition = {
  code: "members_unavailable",
  detail: "Members and invitations could not be loaded.",
  status: 503,
  title: "Members unavailable",
};
const MEMBERS_FORBIDDEN: ProblemDefinition = {
  code: "members_forbidden",
  detail: "Only an active workspace owner or admin may view this page.",
  status: 403,
  title: "Members unavailable",
};
const INVITATION_LINK_INVALID: ProblemDefinition = {
  code: "invitation_invalid",
  detail: "This invitation link is invalid.",
  status: 404,
  title: "Invitation unavailable",
};
const INVITATION_NOT_CHECKED: ProblemDefinition = {
  code: "invitation_unavailable",
  detail: "The invitation could not be checked. Please try again.",
  status: 503,
  title: "Invitation unavailable",
};
const INVITATION_SIGN_IN_REQUIRED: ProblemDefinition = {
  code: "session_invalid",
  detail: "Sign in as the invited email address to accept.",
  status: 401,
  title: "Sign in required",
};
const INVITATION_NOT_ACCEPTED: ProblemDefinition = {
  code: "invitation_unavailable",
  detail: "The invitation could not be accepted. Please try again.",
  status: 503,
  title: "Invitation unavailable",
};

/** Every problem this file answers on its own, for the pinning suite. */
export const INVITATION_PROBLEMS: readonly ProblemDefinition[] = [
  ALREADY_MEMBER,
  DELIVERY_RATE_LIMITED,
  DELIVERY_STILL_FAILING,
  DELIVERY_TOKEN_MISSING,
  INVALID_CREDENTIALS,
  INVITATION_DELIVERY_FAILED,
  INVITATION_DISCONTINUED,
  INVITATION_FORBIDDEN,
  INVITATION_LINK_INVALID,
  INVITATION_NOT_ACCEPTED,
  INVITATION_NOT_CHECKED,
  INVITATION_NOT_CREATED,
  INVITATION_REQUEST_INVALID,
  INVITATION_SIGN_IN_REQUIRED,
  INVITEE_VERIFICATION_DELAYED,
  MEMBERS_FORBIDDEN,
  MEMBERS_UNAVAILABLE,
  MFA_CHALLENGE_EXPIRED,
  MFA_UNAVAILABLE,
  REGISTRATION_REQUEST_INVALID,
  SIGN_IN_UNAVAILABLE,
];

/** The invitation token this request carries in its cookie. */
function invitationToken(context: Context): string | undefined {
  return cookieValue(context.req.header("Cookie"), INVITATION_COOKIE);
}

/** The user agent, bounded to what an audit row will hold. */
function userAgent(context: Context): { readonly userAgent?: string } {
  const value = context.req.header("User-Agent")?.slice(0, 1_000);
  return value ? { userAgent: value } : {};
}

/** The two cookies that carry a signed-in invitee to the accept step. */
function invitationContinuationCookies(
  context: Context,
  policy: BrowserSecurityPolicy,
  invitation: string,
  entry: string,
  expiresAt: Date,
): void {
  context.header(
    "Set-Cookie",
    setCookie(policy, {
      maxAgeSeconds: (expiresAt.getTime() - Date.now()) / 1_000,
      name: ENTRY_COOKIE,
      path: INVITATION_PATH,
      value: entry,
    }),
    { append: true },
  );
  context.header(
    "Set-Cookie",
    setCookie(policy, {
      maxAgeSeconds: INVITATION_COOKIE_SECONDS,
      name: INVITATION_COOKIE,
      path: INVITATION_PATH,
      value: invitation,
    }),
    { append: true },
  );
}

export function createInvitationRoutes(
  services: InvitationHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);
  const policy = services.browserSecurity;

  routes.post(INVITATION_PATH, origin, session, async (context) => {
    const parsed = await parseJsonBody(context, createSchema);
    if ("errors" in parsed) {
      return definedProblem(context, INVITATION_REQUEST_INVALID);
    }
    const actor = await requireSession(context);
    if (actor instanceof Response) return actor;
    const result = await services.invitations.create({
      actor: {
        memberId: actor.memberId,
        role: actor.role,
        userId: actor.userId,
        workspaceId: actor.workspaceId,
      },
      email: parsed.data.email,
      role: parsed.data.role,
      workspaceName: actor.workspaceName,
    }).catch(() => "unavailable" as const);
    if (result === "created") {
      context.header("Cache-Control", "private, no-store");
      return context.json({ status: "invited" }, 201);
    }
    if (result === "already-member") {
      return definedProblem(context, ALREADY_MEMBER);
    }
    if (result === "forbidden") {
      return definedProblem(context, INVITATION_FORBIDDEN);
    }
    return definedProblem(
      context,
      result === "delivery-failed"
        ? INVITATION_DELIVERY_FAILED
        : INVITATION_NOT_CREATED,
    );
  });

  routes.post(`${INVITATION_PATH}/register`, origin, async (context) => {
    const parsed = await parseJsonBody(context, invitationRegistrationSchema);
    if ("errors" in parsed) {
      return definedProblem(context, REGISTRATION_REQUEST_INVALID);
    }
    const passwordHash = await services.hasher.hash(parsed.data.password);
    const result = await services.invitations.registerInvitee({
      email: parsed.data.email,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      passwordHash,
      token: parsed.data.token,
    }).catch(() => "unavailable" as const);
    if (result === "verification-required" || result === "delivery-failed") {
      context.header(
        "Set-Cookie",
        setCookie(policy, {
          maxAgeSeconds: INVITATION_COOKIE_SECONDS,
          name: INVITATION_COOKIE,
          path: INVITATION_PATH,
          value: parsed.data.token,
        }),
      );
      context.header(
        "Set-Cookie",
        setCookie(policy, {
          maxAgeSeconds: INVITATION_COOKIE_SECONDS,
          name: PENDING_COOKIE,
          path: VERIFICATION_PATH,
          value: "1",
        }),
        { append: true },
      );
      context.header("Cache-Control", "private, no-store");
      if (result === "delivery-failed") {
        return definedProblem(context, INVITEE_VERIFICATION_DELAYED);
      }
      return context.json({ status: "verification-required" }, 202);
    }
    return registrationFailure(context, result);
  });

  routes.post(
    `${INVITATION_PATH}/verification-delivery`,
    origin,
    async (context) => {
      const token = invitationToken(context);
      if (!token) {
        return definedProblem(context, DELIVERY_TOKEN_MISSING);
      }
      const result = await services.invitations.retryInviteeVerification(token)
        .catch(() => "delivery-failed" as const);
      if (result === "sent") {
        context.header("Cache-Control", "private, no-store");
        return context.json({ status: "accepted" }, 202);
      }
      if (result === "rate-limited") {
        return definedProblem(context, DELIVERY_RATE_LIMITED);
      }
      if (result === "delivery-failed") {
        return definedProblem(context, DELIVERY_STILL_FAILING);
      }
      return deliveryFailure(context, result);
    },
  );

  routes.post(`${INVITATION_PATH}/authenticate`, origin, async (context) => {
    const parsed = await parseJsonBody(
      context,
      invitationAuthenticationSchema,
    );
    const token = "errors" in parsed
      ? undefined
      : parsed.data.token ?? invitationToken(context);
    if ("errors" in parsed || !token) {
      return definedProblem(context, INVALID_CREDENTIALS);
    }
    const invitation = await services.invitations.inspect(token).catch(() =>
      undefined
    );
    if (
      !invitation || invitation.status !== "pending" ||
      invitation.email.toLowerCase() !== parsed.data.email
    ) return definedProblem(context, INVALID_CREDENTIALS);
    const result = await services.protectedSessions.signIn({
      email: parsed.data.email,
      expectedEmail: invitation.email.toLowerCase(),
      identityOnly: true,
      ipAddress: clientAddress(context),
      password: parsed.data.password,
      ...userAgent(context),
    }).catch(() => undefined);
    if (!result) return definedProblem(context, SIGN_IN_UNAVAILABLE);
    if (result.status === "identity-authenticated") {
      invitationContinuationCookies(
        context,
        policy,
        token,
        result.entryToken,
        result.expiresAt,
      );
      context.header("Cache-Control", "private, no-store");
      return context.json({
        status: "authenticated",
        next: "/invite/continue",
      });
    }
    if (result.status === "mfa-required") {
      context.header(
        "Set-Cookie",
        setCookie(policy, {
          maxAgeSeconds: MFA_COOKIE_SECONDS,
          name: MFA_COOKIE,
          path: MFA_PATH,
          value: result.challengeToken,
        }),
        { append: true },
      );
      context.header(
        "Set-Cookie",
        setCookie(policy, {
          maxAgeSeconds: INVITATION_COOKIE_SECONDS,
          name: INVITATION_COOKIE,
          path: INVITATION_PATH,
          value: token,
        }),
        { append: true },
      );
      return context.json({ status: "mfa-required", next: "/auth/mfa" }, 202);
    }
    return signInFailure(context, result);
  });

  routes.post(MFA_PATH, origin, async (context) => {
    const parsed = await parseJsonBody(context, invitationMfaSchema);
    const token = invitationToken(context);
    const challengeToken = cookieValue(
      context.req.header("Cookie"),
      MFA_COOKIE,
    );
    if ("errors" in parsed || !token || !challengeToken) {
      return definedProblem(context, MFA_CHALLENGE_EXPIRED);
    }
    const invitation = await services.invitations.inspect(token).catch(() =>
      undefined
    );
    if (!invitation || invitation.status !== "pending") {
      return definedProblem(context, INVITATION_DISCONTINUED);
    }
    const result = await services.protectedSessions.completeMfa({
      challengeToken,
      expectedEmail: invitation.email.toLowerCase(),
      factor: parsed.data.factor,
      identityOnly: true,
      ipAddress: clientAddress(context),
      ...userAgent(context),
    }).catch(() => undefined);
    if (!result) return definedProblem(context, MFA_UNAVAILABLE);
    if (result.status === "identity-authenticated") {
      invitationContinuationCookies(
        context,
        policy,
        token,
        result.entryToken,
        result.expiresAt,
      );
      context.header(
        "Set-Cookie",
        setCookie(policy, {
          maxAgeSeconds: 0,
          name: MFA_COOKIE,
          path: MFA_PATH,
          value: "",
        }),
        { append: true },
      );
      context.header("Cache-Control", "private, no-store");
      return context.json({
        status: "authenticated",
        next: "/invite/continue",
      });
    }
    return mfaFailure(context, result);
  });

  routes.get("/api/v1/workspace-members", session, async (context) => {
    const actor = await requireSession(context);
    if (actor instanceof Response) return actor;
    const result = await services.invitations.list({
      memberId: actor.memberId,
      role: actor.role,
      userId: actor.userId,
      workspaceId: actor.workspaceId,
    }).catch(() => undefined);
    if (!result) return definedProblem(context, MEMBERS_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, MEMBERS_FORBIDDEN);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  routes.post(`${INVITATION_PATH}/inspect`, origin, async (context) => {
    const parsed = await parseJsonBody(context, optionalTokenSchema);
    const token = "errors" in parsed
      ? undefined
      : parsed.data.token ?? invitationToken(context);
    if (!token) return definedProblem(context, INVITATION_LINK_INVALID);
    const result = await services.invitations.inspect(token).catch(
      () => undefined,
    );
    if (!result) return definedProblem(context, INVITATION_NOT_CHECKED);
    if (result.status === "pending") {
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    }
    return failure(context, result);
  });

  routes.post(
    `${INVITATION_PATH}/accept`,
    origin,
    session,
    async (context) => {
      const parsed = await parseJsonBody(context, optionalTokenSchema);
      const token = "errors" in parsed
        ? undefined
        : parsed.data.token ?? invitationToken(context);
      if (!token) return definedProblem(context, INVITATION_LINK_INVALID);
      const signedIn = await sessionOf(context);
      const entryToken = cookieValue(
        context.req.header("Cookie"),
        ENTRY_COOKIE,
      );
      if (!signedIn && !entryToken) {
        return definedProblem(context, INVITATION_SIGN_IN_REQUIRED);
      }
      const result =
        await (signedIn
          ? services.invitations.accept({ token, userId: signedIn.userId })
          : services.invitations.acceptVerifiedEntry({
            entryToken: entryToken!,
            ipAddress: clientAddress(context),
            invitationToken: token,
            ...userAgent(context),
          })).catch(() => undefined);
      if (!result) return definedProblem(context, INVITATION_NOT_ACCEPTED);
      if (result.status !== "accepted") return failure(context, result);
      if (
        "sessionToken" in result && typeof result.sessionToken === "string" &&
        "expiresAt" in result && result.expiresAt instanceof Date
      ) {
        context.header(
          "Set-Cookie",
          setCookie(policy, {
            maxAgeSeconds: (result.expiresAt.getTime() - Date.now()) / 1_000,
            name: SESSION_COOKIE,
            path: "/",
            value: result.sessionToken,
          }),
          { append: true },
        );
        for (const name of [ENTRY_COOKIE, INVITATION_COOKIE] as const) {
          context.header(
            "Set-Cookie",
            setCookie(policy, {
              maxAgeSeconds: 0,
              name,
              path: INVITATION_PATH,
              value: "",
            }),
            { append: true },
          );
        }
      }
      context.header("Cache-Control", "private, no-store");
      return context.json({
        status: "accepted",
        next: "/app",
        workspace: { id: result.workspaceId, name: result.workspaceName },
      });
    },
  );

  return routes;
}
