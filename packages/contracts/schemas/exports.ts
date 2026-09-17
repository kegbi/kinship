/**
 * Workspace exports and vCard downloads: the shapes this surface accepts and
 * answers with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/exports` and out of the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";

export const exportDownload = z.strictObject({
  expiresAt: z.iso.datetime({ offset: true }),
  href: z.string(),
  status: z.literal("ready"),
}).meta({ id: "ExportDownload" });

export const exportManifest = z.strictObject({
  attachments: z.strictObject({
    count: z.number().int().min(0),
    items: z.array(z.strictObject({
      byteSize: z.number().int().min(0),
      filename: z.string(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    })),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  limitations: z.array(z.string()),
  profile: z.literal("monica-json"),
  rows: z.strictObject({
    people: z.strictObject({
      count: z.number().int().min(0),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  }),
  version: z.literal(1),
}).meta({ id: "ExportManifest" });

export const exportSummary = z.strictObject({
  completedAt: z.iso.datetime({ offset: true }).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  error: z.string().optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  exportId: z.uuid(),
  format: z.literal("json"),
  manifest: exportManifest,
  status: z.enum([
    "cancelled",
    "completed",
    "expired",
    "failed",
    "pending",
    "running",
  ]),
}).meta({ id: "ExportSummary" });
