/**
 * Workspace invitations and everything an invitee does: the shapes this surface
 * accepts and answers with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/invitations` and out of the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";
import { authenticatedWorkspace } from "./authentication.ts";
import { singleLineText } from "./shared.ts";

export const invitationAccepted = z.strictObject({
  status: z.literal("accepted"),
  next: z.literal("/app"),
  workspace: authenticatedWorkspace,
}).meta({ id: "InvitationAccepted" });

/** What an invitee signs in with against their link, which the document inlines. */
export const invitationAuthenticationInput = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  token: z.string().min(32).max(256).optional(),
});

export const invitationInput = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(["admin", "member"]),
}).meta({ id: "InvitationInput" });

export const invitationInspection = z.strictObject({
  status: z.literal("pending"),
  email: z.email(),
  role: z.enum(["admin", "member"]),
  workspaceName: z.string(),
}).meta({ id: "InvitationInspection" });

/** The second factor an invitation-scoped challenge takes, which the document inlines. */
export const invitationMfaInput = z.strictObject({
  factor: z.string().trim().min(6).max(128),
});

export const invitationRegistrationInput = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(254),
  firstName: singleLineText().min(1).max(100),
  lastName: singleLineText().max(100),
  password: z.string().min(12).max(128).meta({ writeOnly: true }),
  token: z.string().min(32).max(256).meta({ writeOnly: true }),
}).meta({ id: "InvitationRegistrationInput" });

export const invitationToken = z.strictObject({
  token: z.string().min(32).max(256).meta({ writeOnly: true }),
}).meta({ id: "InvitationToken" });

export const optionalInvitationToken = z.strictObject({
  token: z.string().min(32).max(256).meta({ writeOnly: true }).optional(),
}).meta({ id: "OptionalInvitationToken" });

export const workspaceMembers = z.strictObject({
  status: z.literal("ready"),
  members: z.array(z.strictObject({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    role: z.enum(["owner", "admin", "member"]),
    status: z.literal("active"),
  })),
  invitations: z.array(z.strictObject({
    id: z.uuid(),
    email: z.email(),
    role: z.enum(["admin", "member"]),
    status: z.literal("pending"),
    createdAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    invitedBy: z.strictObject({
      id: z.uuid(),
      name: z.string(),
    }).nullable().meta({
      description:
        "The member who sent the invitation, or null when their identity is no longer available.",
    }),
  })),
}).meta({ id: "WorkspaceMembers" });

export const invitationRevoked = z.strictObject({
  status: z.literal("revoked"),
}).meta({ id: "InvitationRevoked" });
