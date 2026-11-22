/**
 * File tools: listing a person's documents and photos, and removing one.
 *
 * Uploading and downloading carry the file's bytes rather than JSON, so they
 * stay REST routes and are excluded from the catalog with that reason. What a
 * tool can do is read the metadata, hand a file id to a gift or a debt
 * settlement, and remove a file.
 */

import { listPersonFiles, removePersonFile } from "../routes/files.ts";
import { type AgentTool, defineTool } from "./define.ts";

export const FILE_TOOLS: readonly AgentTool[] = [
  defineTool({
    name: "list_files",
    title: "List a person's files",
    description:
      "Lists one person's photos and then documents with their fileId, filename, title, kind, mimeType, byteSize, and availability (available, missing, processing, or quarantined); the avatar image and removed files are never listed. It returns no file bytes: uploading and downloading are REST routes, not tools. A file id names a gift's attachmentFileId or a settlement's settlementPhotoFileId. Pages with limit and nextCursor.",
    route: listPersonFiles,
  }),
  defineTool({
    name: "delete_file",
    title: "Delete a person's file",
    description:
      "Permanently deletes one of the person's documents or photos: its stored bytes and its link to the person are deleted, so it is no longer listed or downloadable, and no tool can restore it. A gift that attached it keeps its attachmentFileId, now naming a removed file, and a debt settlement whose photo it was reports that photo as unavailable. fileId comes from list_files, which requires files:read; a token without it cannot obtain one. There is no revision check; a file still being processed is refused as a conflict, and an avatar, another person's file, or an archived person's file is not found.",
    route: removePersonFile,
  }),
];
