/**
 * Leaving a workspace and deleting an identity: the shapes this surface accepts
 * and answers with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/personal_lifecycle` and out
 * of the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";
import { blockingWorkspace } from "./shared.ts";

export const personalIdentityDeleted = z.strictObject({
  next: z.literal("/auth/sign-in"),
  status: z.literal("deleted"),
}).meta({ id: "PersonalIdentityDeleted" });

export const personalIdentityDeletionInput = z.strictObject({
  confirmation: z.string().min(1).max(300),
  password: z.string().min(1).max(1024),
}).meta({ id: "PersonalIdentityDeletionInput" });

export const personalLifecycleConfirmation = z.strictObject({
  confirmation: z.string().min(1).max(300),
  password: z.string().min(1).max(1024),
}).meta({ id: "PersonalLifecycleConfirmation" });

export const personalLifecyclePreview = z.strictObject({
  activeSessionCount: z.number().int().min(0),
  blockingWorkspaces: z.array(blockingWorkspace),
  confirmations: z.strictObject({
    deleteIdentity: z.string(),
    leaveWorkspace: z.string(),
  }),
  memberships: z.array(z.strictObject({
    finalOwner: z.boolean(),
    id: z.uuid(),
    role: z.enum(["owner", "admin", "member"]),
    status: z.enum(["active", "suspended"]),
    workspace: blockingWorkspace,
  })),
  retainedLegalRecords: z.literal(true),
  status: z.literal("ready"),
}).meta({ id: "PersonalLifecyclePreview" });

export const workspaceLeft = z.strictObject({
  next: z.enum(["/app", "/auth/sign-in"]),
  nextWorkspaceId: z.uuid().optional(),
  status: z.literal("left"),
}).meta({ id: "WorkspaceLeft" });
