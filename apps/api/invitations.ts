/**
 * Inviting somebody into a workspace, and everything they do to accept.
 *
 * Eight routes over one flow, and GAP-021 cut it where the flow itself
 * changes hands: `invitations/create.ts` is what an owner does,
 * `invitations/register.ts` is what an invitee with no account does, and
 * `invitations/accept.ts` is the one sitting in which somebody inspects the
 * link, signs in against it, answers a second factor, and accepts. The five
 * refusal tables live in `invitations/failures.ts` because the three steps
 * read across them, and the cookie the token travels in lives in
 * `invitations/shared.ts`.
 *
 * `GET /api/v1/workspace-members` is mounted with the creation routes: it is
 * the list an owner reads on the same page they invite from, and it is served
 * by the invitation coordinator rather than by settings.
 *
 * No two invitation paths overlap — `/api/v1/workspace-invitations` and its
 * four literal children are distinct, and the member list is rooted
 * elsewhere — so the mounted order is free; `invitations/routes_test.ts`
 * requests each path through the mounted whole.
 */

import { Hono } from "hono";
import type { ActorEnv } from "./http/session.ts";
import type { ProblemDefinition } from "./http/problem.ts";
import {
  ALREADY_MEMBER,
  createInvitationCreationRoutes,
  INVITATION_DELIVERY_FAILED,
  INVITATION_FORBIDDEN,
  INVITATION_NOT_CREATED,
  INVITATION_REQUEST_INVALID,
  MEMBERS_FORBIDDEN,
  MEMBERS_UNAVAILABLE,
} from "./invitations/create.ts";
import {
  createInvitationRegistrationRoutes,
  DELIVERY_RATE_LIMITED,
  DELIVERY_STILL_FAILING,
  DELIVERY_TOKEN_MISSING,
  INVITEE_VERIFICATION_DELAYED,
  REGISTRATION_REQUEST_INVALID,
} from "./invitations/register.ts";
import {
  createInvitationAcceptanceRoutes,
  INVALID_CREDENTIALS,
  INVITATION_DISCONTINUED,
  INVITATION_LINK_INVALID,
  INVITATION_NOT_ACCEPTED,
  INVITATION_NOT_CHECKED,
  INVITATION_SIGN_IN_REQUIRED,
  MFA_CHALLENGE_EXPIRED,
  MFA_UNAVAILABLE,
  SIGN_IN_UNAVAILABLE,
} from "./invitations/accept.ts";
import type { InvitationHttpServices } from "./invitations/shared.ts";

export type { InvitationHttpServices } from "./invitations/shared.ts";
export {
  INVITATION_DELIVERY_FAILURES,
  INVITATION_FAILURES,
  INVITATION_MFA_FAILURES,
  INVITATION_REGISTRATION_FAILURES,
  INVITATION_SIGN_IN_FAILURES,
} from "./invitations/failures.ts";

/** Every problem the invitation flow answers on its own, for the pinning suite. */
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

export function createInvitationRoutes(
  services: InvitationHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  routes.route("/", createInvitationCreationRoutes(services));
  routes.route("/", createInvitationRegistrationRoutes(services));
  routes.route("/", createInvitationAcceptanceRoutes(services));
  return routes;
}
