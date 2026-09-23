/**
 * An invitee who has no account yet, registering against their invitation.
 *
 * Two routes: the registration itself, and the retry for the verification
 * email it sends. Neither takes a session, because the person using them does
 * not have one yet.
 *
 * Both cookies the registration sets are scoped to the narrowest path that
 * needs them: the invitation token to the invitation routes, and the pending
 * marker to the verification route, so a half-finished registration leaves
 * nothing behind that a wider route could replay.
 *
 * A registration that commits but cannot send its email says so truthfully
 * and keeps both cookies, because the retry route is the invitee's way out.
 *
 * Both paths and the shape a registration is asked for in came from
 * `packages/contracts` (GAP-022).
 */

import { Hono } from "hono";
import {
  registerInvitedIdentity,
  retryInvitedVerificationDelivery,
} from "../../../../../../contracts/routes/invitations.ts";
import { invitationRegistrationInput } from "../../../../../../contracts/schemas/invitations.ts";
import { setCookie } from "../../../../../../http-kit/cookies.ts";
import { requireMatchingOrigin } from "../../../../../../http-kit/origin.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../../http-kit/problem.ts";
import { mount } from "../../../../../../http-kit/route.ts";
import type { ActorEnv } from "../../../../../../http-kit/session.ts";
import { parseJsonBody } from "../../../../../../http-kit/validate.ts";
import { deliveryFailure, registrationFailure } from "./failures.ts";
import {
  INVITATION_COOKIE,
  INVITATION_COOKIE_SECONDS,
  INVITATION_PATH,
  type InvitationHttpServices,
  invitationToken,
} from "./shared.ts";

/** What an invitee's own registration is served from. */
export type InvitationRegistrationHttpServices = Pick<
  InvitationHttpServices,
  "browserSecurity" | "hasher" | "invitations"
>;

/** The cookie that marks a verification the invitee is still waiting for. */
const PENDING_COOKIE = "kinship_invitation_pending";
const VERIFICATION_PATH = "/api/v1/email-verifications";

export const REGISTRATION_REQUEST_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Check the invitation and registration fields.",
  status: 400,
  title: "Registration unavailable",
};
export const INVITEE_VERIFICATION_DELAYED: ProblemDefinition = {
  code: "invitation_verification_delivery_failed",
  detail:
    "Your account was created for this invitation, but the verification email could not be delivered. Retry delivery.",
  status: 503,
  title: "Verification email delayed",
};
export const DELIVERY_TOKEN_MISSING: ProblemDefinition = {
  code: "invitation_invalid",
  detail: "Return to the invitation and try again.",
  status: 404,
  title: "Verification delivery unavailable",
};
export const DELIVERY_RATE_LIMITED: ProblemDefinition = {
  code: "verification_delivery_rate_limited",
  detail: "Wait a few minutes before requesting another verification email.",
  status: 429,
  title: "Verification retry delayed",
};
export const DELIVERY_STILL_FAILING: ProblemDefinition = {
  code: "invitation_verification_delivery_failed",
  detail:
    "The verification email still could not be delivered. Please try again.",
  status: 503,
  title: "Verification email delayed",
};

export function createInvitationRegistrationRoutes(
  services: InvitationRegistrationHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const origin = requireMatchingOrigin(services.browserSecurity);
  const policy = services.browserSecurity;

  mount(routes, registerInvitedIdentity, origin, async (context) => {
    const parsed = await parseJsonBody(context, invitationRegistrationInput);
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

  mount(
    routes,
    retryInvitedVerificationDelivery,
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
  return routes;
}
