/**
 * Resetting and deleting a workspace: the shapes this surface accepts and
 * answers with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/workspace_lifecycle` and
 * out of the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";
import { blockingWorkspace } from "./shared.ts";

export const workspaceDeleted = z.strictObject({
  cleanupStatus: z.enum(["complete", "pending"]),
  next: z.literal("/auth/sign-in"),
  status: z.literal("deleted"),
}).meta({ id: "WorkspaceDeleted" });

export const workspaceLifecycleConfirmation = z.strictObject({
  confirmation: z.string().min(1).max(300),
  impactToken: z.string().regex(/^[0-9a-f]{64}$/),
  password: z.string().min(1).max(1024),
}).meta({ id: "WorkspaceLifecycleConfirmation" });

export const workspaceLifecyclePreview = z.strictObject({
  activeSessionCount: z.number().int().min(0),
  confirmations: z.strictObject({
    deleteWorkspace: z.string(),
    resetWorkspace: z.string(),
  }),
  counts: z.strictObject({
    activities: z.number().int().min(0),
    auditEvents: z.number().int().min(0),
    calls: z.number().int().min(0),
    debts: z.number().int().min(0),
    exports: z.number().int().min(0),
    files: z.number().int().min(0),
    gifts: z.number().int().min(0),
    imports: z.number().int().min(0),
    integrations: z.number().int().min(0),
    journalPosts: z.number().int().min(0),
    lifeEvents: z.number().int().min(0),
    members: z.number().int().min(0),
    messages: z.number().int().min(0),
    notes: z.number().int().min(0),
    operations: z.number().int().min(0),
    people: z.number().int().min(0),
    relationships: z.number().int().min(0),
    reminders: z.number().int().min(0),
    tasks: z.number().int().min(0),
  }),
  impactToken: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.literal("ready"),
  workspace: blockingWorkspace,
}).meta({ id: "WorkspaceLifecyclePreview" });

export const workspaceReset = z.strictObject({
  cleanupStatus: z.enum(["complete", "pending"]),
  next: z.literal("/auth/sign-in"),
  status: z.literal("reset"),
}).meta({ id: "WorkspaceReset" });
