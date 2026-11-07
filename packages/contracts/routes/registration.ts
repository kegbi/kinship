/**
 * Registration and email verification: every route of this surface, once.
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
  applicationEntry,
  registrationAccepted,
  registrationInput,
  verificationAccepted,
  verificationDeliveryInput,
  verificationInput,
} from "../schemas/registration.ts";

export const consumeApplicationEntry = defineRoute({
  method: "post",
  path: "/api/v1/application-entry",
  operationId: "consumeApplicationEntry",
  description:
    "Browser-only one-time application entry. Requires the exact Origin header configured for the public web origin and the HttpOnly kinship_entry cookie. The cookie is SameSite=Strict and is Secure outside explicit loopback HTTP development/test use.",
  security: [{ kinship_entry: [] }],
  request: {
    headers: originHeaders,
  },
  responses: {
    200: {
      description: "Narrow application entry context",
      headers: setCookieHeader,
      content: {
        "application/json": applicationEntry,
      },
    },
    ...problemResponses(403, 409, 429, 503),
  },
});

export const retryVerificationDelivery = defineRoute({
  method: "post",
  path: "/api/v1/email-verification-deliveries",
  operationId: "retryVerificationDelivery",
  secrecy: "credential",
  description:
    "Asks for another verification link. Requires the exact Origin header configured for the public web origin. Answers the same whether or not the address has a pending registration.",
  request: {
    headers: originHeaders,
    body: {
      required: true,
      content: {
        "application/json": verificationDeliveryInput,
      },
    },
  },
  responses: {
    202: {
      description: "Delivery retry accepted without identity disclosure",
      content: {
        "application/json": z.strictObject({
          status: z.literal("accepted"),
        }),
      },
    },
    ...problemResponses(400, 403, 503),
  },
});

export const verifyEmail = defineRoute({
  method: "post",
  path: "/api/v1/email-verifications",
  operationId: "verifyEmail",
  secrecy: "credential",
  description:
    "Verifies an address from its emailed link. Requires the exact Origin header configured for the public web origin. With the registering browser's HttpOnly kinship_registrant cookie it answers `verified` and sets the one-time kinship_entry handoff; without it the address is still verified, but the registrant's password is discarded and it answers `password-required` with the password-reset step to continue at.",
  request: {
    headers: originHeaders,
    body: {
      required: true,
      content: {
        "application/json": verificationInput,
      },
    },
  },
  responses: {
    200: {
      description: "Email verified",
      headers: setCookieHeader,
      content: {
        "application/json": verificationAccepted,
      },
    },
    ...problemResponses(400, 403, 409, 410, 503),
  },
});

export const createFirstWorkspace = defineRoute({
  method: "post",
  path: "/api/v1/registrations",
  operationId: "createFirstWorkspace",
  secrecy: "credential",
  description:
    "Registers a first workspace. Requires the exact Origin header configured for the public web origin. Answers the same 202 whether or not the address already has an account, and sets the HttpOnly kinship_registrant cookie that a verification from the same browser presents.",
  request: {
    headers: originHeaders,
    body: {
      required: true,
      content: {
        "application/json": registrationInput,
      },
    },
  },
  responses: {
    202: {
      description: "Verification required",
      headers: setCookieHeader,
      content: {
        "application/json": registrationAccepted,
      },
    },
    ...problemResponses(400, 403, 429, 503),
  },
});

/** Every registration route, in the order the surface mounts them. */
export const REGISTRATION_ROUTES: readonly RouteDescriptor[] = [
  consumeApplicationEntry,
  retryVerificationDelivery,
  verifyEmail,
  createFirstWorkspace,
];
