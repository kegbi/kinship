/**
 * Sign-in, sessions, and password recovery: the shapes this surface accepts and
 * answers with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/authentication` and out of
 * the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";
import { legalDocument } from "./governance.ts";
import { memberUiState } from "./settings.ts";

export const authenticatedMember = z.strictObject({
  id: z.uuid(),
  role: z.enum(["owner", "admin", "member"]),
}).meta({ id: "AuthenticatedMember" });

export const authenticatedWorkspace = z.strictObject({
  id: z.uuid(),
  name: z.string(),
}).meta({ id: "AuthenticatedWorkspace" });

export const authenticated = z.strictObject({
  status: z.literal("authenticated"),
  next: z.literal("/app"),
  workspace: authenticatedWorkspace,
  member: authenticatedMember,
}).meta({ id: "Authenticated" });

export const mfaInput = z.strictObject({
  factor: z.string().trim().min(6).max(128).meta({ writeOnly: true }),
  workspaceId: z.uuid().optional(),
}).meta({ id: "MfaInput" });

export const mfaRequired = z.strictObject({
  status: z.literal("mfa-required"),
  next: z.literal("/auth/mfa"),
}).meta({ id: "MfaRequired" });

export const passwordResetAccepted = z.strictObject({
  status: z.literal("reset"),
  next: z.literal("/auth/sign-in"),
}).meta({ id: "PasswordResetAccepted" });

export const passwordResetInput = z.strictObject({
  password: z.string().min(12).max(128).meta({ writeOnly: true }),
  token: z.string().min(32).max(256).meta({ writeOnly: true }),
}).meta({ id: "PasswordResetInput" });

export const recoveryAccepted = z.strictObject({
  status: z.literal("accepted"),
}).meta({ id: "RecoveryAccepted" });

/** The address a password recovery is asked for, which the document inlines. */
export const recoveryRequestInput = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(254),
});

export const sessionContext = z.strictObject({
  status: z.literal("authenticated"),
  principal: z.strictObject({
    userId: z.uuid(),
  }),
  workspace: authenticatedWorkspace,
  member: authenticatedMember,
  workspaces: z.array(authenticatedWorkspace).min(1),
  requiredLegalDocuments: z.array(legalDocument),
  uiState: memberUiState.optional(),
}).meta({ id: "SessionContext" });

export const signInInput = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128).meta({ writeOnly: true }),
  workspaceId: z.uuid().optional(),
}).meta({ id: "SignInInput" });

export const signedOut = z.strictObject({
  status: z.literal("signed-out"),
  next: z.literal("/auth/sign-in"),
}).meta({ id: "SignedOut" });
