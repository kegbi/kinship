/**
 * Workspace invitations and everything an invitee does: every route of this
 * surface, once.
 *
 * Each descriptor is what `apps/api` mounts and what
 * `tools/contracts/build.ts` documents. A route the document does not describe
 * fails `deno task contracts:check`, and one that is mounted and not here, or
 * here and never mounted, fails `apps/api/routes_test.ts`.
 */

import { z } from "zod";
import { defineRoute, type RouteDescriptor } from "../registry.ts";
import {
  originAndWorkspaceHeaders,
  originHeaders,
  problemResponses,
  setCookieHeader,
  workspaceHeaders,
} from "./common.ts";
import { mfaRequired } from "../schemas/authentication.ts";
import {
  invitationAccepted,
  invitationAuthenticationInput,
  invitationInput,
  invitationInspection,
  invitationMfaInput,
  invitationRegistrationInput,
  invitationRevoked,
  optionalInvitationToken,
  workspaceMembers,
} from "../schemas/invitations.ts";
import { registrationAccepted } from "../schemas/registration.ts";
import { uuid } from "../schemas/shared.ts";

export const createWorkspaceInvitation = defineRoute({
  method: "post",
  path: "/api/v1/workspace-invitations",
  operationId: "createWorkspaceInvitation",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": invitationInput,
      },
    },
  },
  responses: {
    201: {
      description: "Invitation created and delivered",
      content: {
        "application/json": z.strictObject({
          status: z.literal("invited"),
        }),
      },
    },
    ...problemResponses(400, 401, 403, 409, 429, 503),
  },
});

export const acceptWorkspaceInvitation = defineRoute({
  method: "post",
  path: "/api/v1/workspace-invitations/accept",
  operationId: "acceptWorkspaceInvitation",
  secrecy: "credential",
  description:
    "Atomically consumes a single-use invitation for the authenticated intended user.",
  security: [{ kinship_session: [] }, { kinship_entry: [] }],
  request: {
    headers: originHeaders,
    body: {
      required: false,
      content: {
        "application/json": optionalInvitationToken,
      },
    },
  },
  responses: {
    200: {
      description: "Invitation accepted",
      content: {
        "application/json": invitationAccepted,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 410, 503),
  },
});

export const authenticateWorkspaceInvitation = defineRoute({
  method: "post",
  path: "/api/v1/workspace-invitations/authenticate",
  operationId: "authenticateWorkspaceInvitation",
  secrecy: "credential",
  description:
    "Runs the equalized password challenge for the verified identity matching a pending invitation, without creating a normal workspace session.",
  request: {
    headers: originHeaders,
    body: {
      required: true,
      content: {
        "application/json": invitationAuthenticationInput,
      },
    },
  },
  responses: {
    200: {
      description: "One-use verified identity entry issued",
      headers: setCookieHeader,
      content: {
        "application/json": z.strictObject({
          status: z.literal("authenticated"),
          next: z.literal("/invite/continue"),
        }),
      },
    },
    202: {
      description: "Invitation-scoped MFA challenge required",
      headers: setCookieHeader,
      content: {
        "application/json": mfaRequired,
      },
    },
    ...problemResponses(401, 403, 429, 503),
  },
});

export const inspectWorkspaceInvitation = defineRoute({
  method: "post",
  path: "/api/v1/workspace-invitations/inspect",
  operationId: "inspectWorkspaceInvitation",
  secrecy: "credential",
  description:
    "Inspects an invitation using a bearer token in the request body so gateway logs never contain it.",
  request: {
    headers: originHeaders,
    body: {
      required: false,
      content: {
        "application/json": optionalInvitationToken,
      },
    },
  },
  responses: {
    200: {
      description: "Pending invitation",
      content: {
        "application/json": invitationInspection,
      },
    },
    ...problemResponses(403, 404, 410, 503),
  },
});

export const completeWorkspaceInvitationMfa = defineRoute({
  method: "post",
  path: "/api/v1/workspace-invitations/mfa",
  operationId: "completeWorkspaceInvitationMfa",
  secrecy: "credential",
  description:
    "Completes the equalized MFA challenge for the identity matching the scoped pending invitation.",
  security: [{ kinship_mfa: [], kinship_invitation: [] }],
  request: {
    headers: originHeaders,
    body: {
      required: true,
      content: {
        "application/json": invitationMfaInput,
      },
    },
  },
  responses: {
    200: {
      description: "One-use verified identity entry issued",
      headers: setCookieHeader,
      content: {
        "application/json": z.strictObject({
          status: z.literal("authenticated"),
          next: z.literal("/invite/continue"),
        }),
      },
    },
    ...problemResponses(401, 403, 410, 429, 503),
  },
});

export const registerInvitedIdentity = defineRoute({
  method: "post",
  path: "/api/v1/workspace-invitations/register",
  operationId: "registerInvitedIdentity",
  secrecy: "credential",
  description:
    "Creates a pending identity for an invitation without creating another workspace.",
  request: {
    headers: originHeaders,
    body: {
      required: true,
      content: {
        "application/json": invitationRegistrationInput,
      },
    },
  },
  responses: {
    202: {
      description: "Verification required",
      content: {
        "application/json": registrationAccepted,
      },
    },
    ...problemResponses(400, 404, 409, 410, 429, 503),
  },
});

export const retryInvitedVerificationDelivery = defineRoute({
  method: "post",
  path: "/api/v1/workspace-invitations/verification-delivery",
  operationId: "retryInvitedVerificationDelivery",
  secrecy: "credential",
  description:
    "Retries verification delivery only for the identity bound to the scoped pending invitation cookie.",
  security: [{ kinship_invitation: [] }],
  request: {
    headers: originHeaders,
  },
  responses: {
    202: {
      description: "Verification delivery accepted",
      content: {
        "application/json": z.strictObject({
          status: z.literal("accepted"),
        }),
      },
    },
    ...problemResponses(403, 404, 410, 429, 503),
  },
});

export const listWorkspaceMembers = defineRoute({
  method: "get",
  path: "/api/v1/workspace-members",
  operationId: "listWorkspaceMembers",
  security: [{ kinship_session: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Active members and pending invitations",
      content: {
        "application/json": workspaceMembers,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const revokeWorkspaceInvitation = defineRoute({
  method: "delete",
  path: "/api/v1/workspace-invitations/{invitationId}",
  operationId: "revokeWorkspaceInvitation",
  description:
    "Revokes a pending invitation of the active workspace so its link no longer works. Owners and admins only.",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      invitationId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
  },
  responses: {
    200: {
      description: "Invitation revoked",
      content: {
        "application/json": invitationRevoked,
      },
    },
    ...problemResponses(401, 403, 404, 503),
  },
});

/** Every invitations route, in the order the surface mounts them. */
export const INVITATIONS_ROUTES: readonly RouteDescriptor[] = [
  createWorkspaceInvitation,
  acceptWorkspaceInvitation,
  authenticateWorkspaceInvitation,
  inspectWorkspaceInvitation,
  completeWorkspaceInvitationMfa,
  registerInvitedIdentity,
  retryInvitedVerificationDelivery,
  listWorkspaceMembers,
  revokeWorkspaceInvitation,
];
