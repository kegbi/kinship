/**
 * An owner inviting somebody, the list of who has been invited already, and
 * taking an invitation back.
 *
 * Three routes for the one person who can use them: an active owner or admin.
 * Creating an invitation never returns the token it created — the invitee
 * receives that by email, and nothing on this side of the flow may read it
 * back. Revoking one (SECT-04) is addressed by the invitation's id, which the
 * list shows, never by its token.
 *
 * An email that already has a membership record is a conflict rather than a
 * second invitation, because a membership's lifecycle is managed explicitly.
 *
 * Both paths and the shape an invitation is asked for in came from
 * `packages/contracts` (GAP-022).
 */

import { Hono } from "hono";
import {
  createWorkspaceInvitation,
  listWorkspaceMembers,
  revokeWorkspaceInvitation,
} from "../../../../../../contracts/routes/invitations.ts";
import { invitationInput } from "../../../../../../contracts/schemas/invitations.ts";
import { uuid } from "../../../../../../contracts/schemas/shared.ts";
import { requireMatchingOrigin } from "../../../../../../http-kit/origin.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../../http-kit/problem.ts";
import { mount } from "../../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  requireSession,
  sessionActor,
} from "../../../../../../http-kit/session.ts";
import {
  parseJsonBody,
  parseValue,
} from "../../../../../../http-kit/validate.ts";
import type { InvitationHttpServices } from "./shared.ts";

/** What inviting a member and listing the invited is served from. */
export type InvitationCreationHttpServices = Pick<
  InvitationHttpServices,
  "browserSecurity" | "invitations" | "protectedSessions"
>;

export const INVITATION_REQUEST_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Provide a valid email address and allowed role.",
  status: 400,
  title: "Invalid invitation",
};
export const ALREADY_MEMBER: ProblemDefinition = {
  code: "already_member",
  detail:
    "That email already has a membership record in this workspace. Manage its lifecycle explicitly instead of inviting it again.",
  status: 409,
  title: "Membership already exists",
};
export const INVITATION_FORBIDDEN: ProblemDefinition = {
  code: "invitation_forbidden",
  detail: "Only an active workspace owner or admin may invite members.",
  status: 403,
  title: "Invitation forbidden",
};
export const INVITATION_DELIVERY_FAILED: ProblemDefinition = {
  code: "invitation_delivery_failed",
  detail:
    "The invitation was saved but its email could not be delivered. Contact an administrator before trying again.",
  status: 503,
  title: "Invitation delivery unavailable",
};
export const INVITATION_NOT_CREATED: ProblemDefinition = {
  code: "invitation_delivery_failed",
  detail: "The invitation could not be created. Please try again.",
  status: 503,
  title: "Invitation delivery unavailable",
};
export const MEMBERS_UNAVAILABLE: ProblemDefinition = {
  code: "members_unavailable",
  detail: "Members and invitations could not be loaded.",
  status: 503,
  title: "Members unavailable",
};
export const MEMBERS_FORBIDDEN: ProblemDefinition = {
  code: "members_forbidden",
  detail: "Only an active workspace owner or admin may view this page.",
  status: 403,
  title: "Members unavailable",
};

export const INVITATION_NOT_FOUND: ProblemDefinition = {
  code: "invitation_not_found",
  detail: "That invitation is not pending in this workspace.",
  status: 404,
  title: "Invitation not found",
};
export const INVITATION_REVOKE_FORBIDDEN: ProblemDefinition = {
  code: "invitation_forbidden",
  detail: "Only an active workspace owner or admin may revoke invitations.",
  status: 403,
  title: "Invitation forbidden",
};
export const INVITATION_NOT_REVOKED: ProblemDefinition = {
  code: "invitation_unavailable",
  detail: "The invitation could not be revoked. Please try again.",
  status: 503,
  title: "Invitation unavailable",
};

export function createInvitationCreationRoutes(
  services: InvitationCreationHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(routes, createWorkspaceInvitation, origin, session, async (context) => {
    const parsed = await parseJsonBody(context, invitationInput);
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

  mount(routes, listWorkspaceMembers, session, async (context) => {
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

  mount(routes, revokeWorkspaceInvitation, origin, session, async (context) => {
    const invitationId = parseValue(uuid, context.req.param("invitationId"));
    if ("errors" in invitationId) {
      return definedProblem(context, INVITATION_NOT_FOUND);
    }
    const actor = await requireSession(context);
    if (actor instanceof Response) return actor;
    const result = await services.invitations.revoke({
      memberId: actor.memberId,
      role: actor.role,
      userId: actor.userId,
      workspaceId: actor.workspaceId,
    }, invitationId.data).catch(() => "unavailable" as const);
    if (result === "revoked") {
      context.header("Cache-Control", "private, no-store");
      return context.json({ status: "revoked" });
    }
    return definedProblem(
      context,
      result === "forbidden"
        ? INVITATION_REVOKE_FORBIDDEN
        : result === "not-found"
        ? INVITATION_NOT_FOUND
        : INVITATION_NOT_REVOKED,
    );
  });
  return routes;
}
