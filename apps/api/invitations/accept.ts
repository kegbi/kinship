/**
 * Everything between opening an invitation link and belonging to a workspace.
 *
 * Four routes for one person: inspecting the link, signing in against it,
 * answering a second factor if the account has one, and accepting. They are
 * one file because they are one sitting — the invitee moves through them
 * without ever leaving the page — and because the cookies they set are only
 * meaningful to each other.
 *
 * Each cookie is scoped to the narrowest path that needs it: the challenge to
 * the one route that completes it, the invitation token and the entry handoff
 * to the invitation routes. Accepting clears both of the temporary ones and
 * sets the established session at `/`, so a finished invitation leaves
 * nothing behind that could be replayed.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import { clientAddress } from "../http/client_address.ts";
import { cookieValue, SESSION_COOKIE, setCookie } from "../http/cookies.ts";
import { requireMatchingOrigin } from "../http/origin.ts";
import { definedProblem, type ProblemDefinition } from "../http/problem.ts";
import { type ActorEnv, sessionActor, sessionOf } from "../http/session.ts";
import { parseJsonBody } from "../http/validate.ts";
import type { BrowserSecurityPolicy } from "../security_config.ts";
import { failure, mfaFailure, signInFailure } from "./failures.ts";
import {
  INVITATION_COOKIE,
  INVITATION_COOKIE_SECONDS,
  INVITATION_PATH,
  type InvitationHttpServices,
  invitationToken,
} from "./shared.ts";

/** What inspecting, signing in against, and accepting an invitation needs. */
export type InvitationAcceptanceHttpServices = Pick<
  InvitationHttpServices,
  "browserSecurity" | "invitations" | "protectedSessions"
>;

/** The two cookies this sitting sets for itself. */
const ENTRY_COOKIE = "kinship_entry";
const MFA_COOKIE = "kinship_mfa";
const MFA_PATH = "/api/v1/workspace-invitations/mfa";
/** Five minutes for a pending factor. */
const MFA_COOKIE_SECONDS = 5 * 60;

const optionalTokenSchema = z.object({
  token: z.string().min(32).max(256).optional(),
}).strict();
const invitationAuthenticationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  token: z.string().min(32).max(256).optional(),
}).strict();
const invitationMfaSchema = z.object({
  factor: z.string().trim().min(6).max(128),
}).strict();

export const INVALID_CREDENTIALS: ProblemDefinition = {
  code: "invalid_credentials",
  detail: "The email address or password is incorrect.",
  status: 401,
  title: "Sign-in failed",
};
export const SIGN_IN_UNAVAILABLE: ProblemDefinition = {
  code: "authentication_unavailable",
  detail: "Please try again.",
  status: 503,
  title: "Sign-in unavailable",
};
export const MFA_CHALLENGE_EXPIRED: ProblemDefinition = {
  code: "mfa_challenge_expired",
  detail: "Return to the invitation and sign in again.",
  status: 410,
  title: "Challenge expired",
};
export const INVITATION_DISCONTINUED: ProblemDefinition = {
  code: "invitation_unavailable",
  detail: "This invitation can no longer continue.",
  status: 410,
  title: "Invitation unavailable",
};
export const MFA_UNAVAILABLE: ProblemDefinition = {
  code: "authentication_unavailable",
  detail: "Please try again.",
  status: 503,
  title: "Challenge unavailable",
};
export const INVITATION_LINK_INVALID: ProblemDefinition = {
  code: "invitation_invalid",
  detail: "This invitation link is invalid.",
  status: 404,
  title: "Invitation unavailable",
};
export const INVITATION_NOT_CHECKED: ProblemDefinition = {
  code: "invitation_unavailable",
  detail: "The invitation could not be checked. Please try again.",
  status: 503,
  title: "Invitation unavailable",
};
export const INVITATION_SIGN_IN_REQUIRED: ProblemDefinition = {
  code: "session_invalid",
  detail: "Sign in as the invited email address to accept.",
  status: 401,
  title: "Sign in required",
};
export const INVITATION_NOT_ACCEPTED: ProblemDefinition = {
  code: "invitation_unavailable",
  detail: "The invitation could not be accepted. Please try again.",
  status: 503,
  title: "Invitation unavailable",
};

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

export function createInvitationAcceptanceRoutes(
  services: InvitationAcceptanceHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);
  const policy = services.browserSecurity;

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
