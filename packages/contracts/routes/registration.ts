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
  request: {
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
    ...problemResponses(400, 503),
  },
});

export const verifyEmail = defineRoute({
  method: "post",
  path: "/api/v1/email-verifications",
  operationId: "verifyEmail",
  request: {
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
    ...problemResponses(400, 409, 410, 503),
  },
});

export const createFirstWorkspace = defineRoute({
  method: "post",
  path: "/api/v1/registrations",
  operationId: "createFirstWorkspace",
  request: {
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
      content: {
        "application/json": registrationAccepted,
      },
    },
    ...problemResponses(400, 409, 429, 503),
  },
});

/** Every registration route, in the order the surface mounts them. */
export const REGISTRATION_ROUTES: readonly RouteDescriptor[] = [
  consumeApplicationEntry,
  retryVerificationDelivery,
  verifyEmail,
  createFirstWorkspace,
];
