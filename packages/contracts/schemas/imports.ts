/**
 * Workspace imports: the shapes this surface accepts and answers with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/imports` and out of the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";

export const importReport = z.strictObject({
  counts: z.strictObject({
    contacts: z.number().int().min(0),
    legacyCredentialsDiscarded: z.number().int().min(0),
    missingFiles: z.number().int().min(0),
    orphans: z.number().int().min(0),
    unsupported: z.number().int().min(0),
  }),
  diagnostics: z.array(z.strictObject({
    code: z.string(),
    message: z.string(),
    severity: z.enum(["info", "skipped", "warning"]),
  })),
}).meta({ id: "ImportReport" });

export const importDryRun = z.strictObject({
  importId: z.uuid(),
  report: importReport,
  status: z.literal("dry_run"),
}).meta({ id: "ImportDryRun" });

export const importSummary = z.strictObject({
  completedAt: z.iso.datetime({ offset: true }).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  importId: z.uuid(),
  report: importReport,
  sourceProfile: z.literal("json_export"),
  status: z.enum(["completed", "dry_run", "failed"]),
}).meta({ id: "ImportSummary" });
