/**
 * Person files and storage settings: the shapes this surface accepts and
 * answers with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/files` and out of the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";

/**
 * The `X-File-Kind` an upload declares.
 *
 * It carries no `id` because the document inlines it into
 * `uploadPersonFile`'s header parameter rather than naming a component, and
 * `apps/api/files` parses the header with this exact schema.
 */
export const personFileKind = z.enum(["document", "photo"]);

export const personFile = z.strictObject({
  byteSize: z.number().int().min(0).max(10485760),
  createdAt: z.iso.datetime({ offset: true }),
  fileId: z.uuid(),
  filename: z.string(),
  kind: z.string(),
  mimeType: z.string(),
  personId: z.uuid(),
  status: z.enum(["available", "missing", "processing", "quarantined"]),
  title: z.string(),
}).meta({ id: "PersonFile" });

export const personFileCreated = z.strictObject({
  file: personFile,
  status: z.literal("created"),
}).meta({ id: "PersonFileCreated" });

export const personFileList = z.strictObject({
  files: z.array(personFile),
  status: z.literal("ready"),
}).meta({ id: "PersonFileList" });

export const storageFileLookupItem = z.strictObject({
  byteSize: z.number().int().min(0),
  createdAt: z.iso.datetime({ offset: true }),
  fileId: z.uuid(),
  filename: z.string(),
  kind: z.string(),
  mimeType: z.string(),
  personId: z.uuid().optional(),
  personName: z.string().optional(),
  status: z.enum(["available", "missing", "processing", "quarantined"]),
  title: z.string(),
}).meta({ id: "StorageFileLookupItem" });

export const storageSettings = z.strictObject({
  files: z.array(storageFileLookupItem).max(20),
  maximumUploadBytes: z.number().int().min(1),
  provider: z.strictObject({
    bucket: z.string(),
    health: z.enum(["available", "not-initialized", "unavailable"]),
    name: z.string(),
  }),
  status: z.literal("ready"),
  usage: z.strictObject({
    available: z.number().int().min(0),
    missing: z.number().int().min(0),
    processing: z.number().int().min(0),
    quarantined: z.number().int().min(0),
    totalBytes: z.number().int().min(0),
    totalFiles: z.number().int().min(0),
  }),
}).meta({ id: "StorageSettings" });
