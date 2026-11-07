/**
 * Sign-in, sessions, and password recovery: every route of this surface, once.
 *
 * Each descriptor is what `apps/api` mounts and what
 * `tools/contracts/build.ts` documents. A route the document does not describe
 * fails `deno task contracts:check`, and one that is mounted and not here, or
 * here and never mounted, fails `apps/api/routes_test.ts`.
 */

import { z } from "zod";
import { defineRoute, type RouteDescriptor } from "../registry.ts";
import { originHeaders, problemResponses, setCookieHeader } from "./common.ts";
import {
  authenticated,
  mfaInput,
  mfaRequired,
  passwordResetAccepted,
  passwordResetInput,
  recoveryAccepted,
  recoveryRequestInput,
  sessionContext,
  signedOut,
  signInInput,
} from "../schemas/authentication.ts";

export const completeMfa = defineRoute({
  method: "post",
  path: "/api/v1/mfa-challenges",
  operationId: "completeMfa",
  secrecy: "credential",
  security: [{ kinship_mfa: [] }],
  request: {
    headers: originHeaders,
    body: {
      required: true,
      content: {
        "application/json": mfaInput,
      },
    },
  },
  responses: {
    200: {
      description: "MFA accepted and authenticated session created",
      headers: setCookieHeader,
      content: {
        "application/json": authenticated,
      },
    },
    ...problemResponses(401, 403, 410, 429, 503),
  },
});

export const requestPasswordReset = defineRoute({
  method: "post",
  path: "/api/v1/password-reset-requests",
  operationId: "requestPasswordReset",
  secrecy: "credential",
  request: {
    headers: originHeaders,
    body: {
      required: true,
      content: {
        "application/json": recoveryRequestInput,
      },
    },
  },
  responses: {
    202: {
      description: "Request accepted without identity disclosure",
      content: {
        "application/json": recoveryAccepted,
      },
    },
    ...problemResponses(400, 503),
  },
});

export const resetPassword = defineRoute({
  method: "post",
  path: "/api/v1/password-resets",
  operationId: "resetPassword",
  secrecy: "credential",
  request: {
    headers: originHeaders,
    body: {
      required: true,
      content: {
        "application/json": passwordResetInput,
      },
    },
  },
  responses: {
    200: {
      description: "Password reset and sessions revoked",
      headers: setCookieHeader,
      content: {
        "application/json": passwordResetAccepted,
      },
    },
    ...problemResponses(400, 410, 503),
  },
});

export const getSession = defineRoute({
  method: "get",
  path: "/api/v1/session",
  operationId: "getSession",
  security: [{ kinship_session: [] }],
  request: {
    headers: z.object({
      "X-Workspace-Id": z.uuid().optional().meta({
        description:
          "Optional requested workspace; always validated against active membership.",
      }),
    }),
  },
  responses: {
    200: {
      description: "Resolved principal and active workspace",
      content: {
        "application/json": sessionContext,
      },
    },
    ...problemResponses(401),
  },
});

export const signIn = defineRoute({
  method: "post",
  path: "/api/v1/sessions",
  operationId: "signIn",
  secrecy: "credential",
  request: {
    headers: originHeaders,
    body: {
      required: true,
      content: {
        "application/json": signInInput,
      },
    },
  },
  responses: {
    200: {
      description: "Authenticated session created and rotated",
      headers: setCookieHeader,
      content: {
        "application/json": authenticated,
      },
    },
    202: {
      description: "MFA challenge required",
      headers: setCookieHeader,
      content: {
        "application/json": mfaRequired,
      },
    },
    ...problemResponses(400, 401, 403, 429, 503),
  },
});

export const signOut = defineRoute({
  method: "post",
  path: "/api/v1/sign-out",
  operationId: "signOut",
  security: [{ kinship_session: [] }],
  request: {
    headers: originHeaders,
  },
  responses: {
    200: {
      description: "Current session revoked",
      headers: setCookieHeader,
      content: {
        "application/json": signedOut,
      },
    },
    ...problemResponses(403, 503),
  },
});

/** Every authentication route, in the order the surface mounts them. */
export const AUTHENTICATION_ROUTES: readonly RouteDescriptor[] = [
  completeMfa,
  requestPasswordReset,
  resetPassword,
  getSession,
  signIn,
  signOut,
];
