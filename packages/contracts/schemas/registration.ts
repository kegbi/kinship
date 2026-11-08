/**
 * Registration and email verification: the shapes this surface accepts and
 * answers with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/registration` and out of
 * the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";
import { singleLineText } from "./shared.ts";

export const applicationEntry = z.strictObject({
  status: z.literal("ready"),
  workspace: z.strictObject({
    id: z.uuid(),
    name: z.string(),
  }),
  member: z.strictObject({
    id: z.uuid(),
    firstName: z.string(),
  }),
}).meta({ id: "ApplicationEntry" });

export const registrationAccepted = z.strictObject({
  status: z.literal("verification-required"),
}).meta({ id: "RegistrationAccepted" });

export const registrationInput = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(254),
  firstName: singleLineText().min(1).max(100),
  lastName: singleLineText().max(100),
  password: z.string().min(12).max(128).meta({ writeOnly: true }),
  workspaceName: singleLineText().min(2).max(120),
}).meta({ id: "RegistrationInput" });

/**
 * What a usable verification link answers. `verified` came from the browser
 * that registered and enters the application or the invitation;
 * `password-required` did not (SECA-01), so the address is verified but the
 * registrant's password is gone, and `next` is the single-use reset step.
 */
export const verificationAccepted = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("verified"),
    next: z.enum(["/app", "/invite/continue"]),
  }),
  z.strictObject({
    status: z.literal("password-required"),
    next: z.string().regex(/^\/auth\/reset-password\?token=[A-Za-z0-9_-]+$/),
  }),
]).meta({ id: "VerificationAccepted" });

/** The address a delivery retry is asked for, which the document inlines. */
export const verificationDeliveryInput = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(254),
});

/** The link a browser posts back to verify, which the document inlines. */
export const verificationInput = z.strictObject({
  token: z.string().min(32).max(256),
});
