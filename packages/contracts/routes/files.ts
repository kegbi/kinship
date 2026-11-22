/**
 * Person files and storage settings: every route of this surface, once.
 *
 * Each descriptor is what `apps/api` mounts and what
 * `tools/contracts/build.ts` documents. A route the document does not describe
 * fails `deno task contracts:check`, and one that is mounted and not here, or
 * here and never mounted, fails `apps/api/routes_test.ts`.
 */

import { z } from "zod";
import { defineRoute, type RouteDescriptor } from "../registry.ts";
import {
  problemResponses,
  tokenOrSessionWriteHeaders,
  workspaceHeaders,
} from "./common.ts";
import {
  personFileCreated,
  personFileKind,
  personFileList,
  storageSettings,
} from "../schemas/files.ts";
import { pageQuery, uuid } from "../schemas/shared.ts";

/** What `listPersonFiles` accepts in the query string. */
export const listPersonFilesQuery = pageQuery;

export const listPersonFiles = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/files",
  operationId: "listPersonFiles",
  description:
    "Personal tokens require files:read. Lists one person's photos and then documents, a page at a time, with each file's metadata and availability (available, missing, processing, or quarantined); a person's avatar image and removed files are never listed. Does not return file bytes, which only the REST download route serves, and does not grant uploading or removing.",
  tokenScope: "files:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    query: listPersonFilesQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Explicit document and photo states for one person",
      content: {
        "application/json": personFileList,
      },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

export const uploadPersonFile = defineRoute({
  method: "post",
  path: "/api/v1/people/{personId}/files",
  operationId: "uploadPersonFile",
  description:
    "Personal tokens require files:write. Stores one document or photo for a person from the raw request body, whose Content-Type must be one of the listed media types, up to 10485760 bytes; the kind travels in X-File-Kind and the percent-encoded filename and title in X-File-Name and X-File-Title. A token without files:write is refused before the body is read. Does not grant listing or downloading. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "files:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders.extend({
      "X-File-Kind": personFileKind,
      "X-File-Name": z.string().max(500),
      "X-File-Title": z.string().max(500),
    }),
    body: {
      required: true,
      content: {
        "application/pdf": z.string().max(10485760).meta({ format: "binary" }),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
          z.string().max(10485760).meta({ format: "binary" }),
        "image/jpeg": z.string().max(10485760).meta({ format: "binary" }),
        "image/png": z.string().max(10485760).meta({ format: "binary" }),
        "image/webp": z.string().max(10485760).meta({ format: "binary" }),
        "text/plain": z.string().max(10485760).meta({ format: "binary" }),
      },
    },
  },
  responses: {
    201: {
      description: "Stored metadata and typed person link created",
      content: {
        "application/json": personFileCreated,
      },
    },
    ...problemResponses(400, 401, 403, 404, 413, 415, 503),
  },
});

export const removePersonFile = defineRoute({
  method: "delete",
  path: "/api/v1/people/{personId}/files/{fileId}",
  operationId: "removePersonFile",
  description:
    "Personal tokens require files:write. Removes one of the person's documents or photos: its stored bytes and its link to the person are deleted and its metadata is kept as deleted, so it stops being listed or downloadable. There is no revision check; a file still being processed answers 409, and an avatar image, a file of another person, or a file of an archived person answers 404. A gift that links the file keeps its attachmentFileId, and a debt settlement whose photo it was reports that photo as unavailable. Does not grant reading. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "files:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
      fileId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
  },
  responses: {
    200: {
      description: "Person file safely removed",
      content: {
        "application/json": z.strictObject({
          fileId: z.uuid(),
          status: z.literal("removed"),
        }),
      },
    },
    ...problemResponses(401, 403, 404, 409, 503),
  },
});

export const downloadPersonFile = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/files/{fileId}/content",
  operationId: "downloadPersonFile",
  description:
    "Personal tokens require files:read. Answers the file's bytes as an attachment, with its stored media type, length, and filename, and records the read of a document or photo in the audit history; it also serves the person's avatar image, unrecorded. A removed file, or a file of another person, answers 404; one whose stored bytes are missing answers 410, one still being processed 409, and a quarantined one 423. Does not grant uploading or removing.",
  tokenScope: "files:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
      fileId: uuid,
    }),
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Authorized private file bytes",
      content: {
        "application/pdf": z.string().meta({ format: "binary" }),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
          z.string().meta({ format: "binary" }),
        "text/plain": z.string().meta({ format: "binary" }),
        "image/jpeg": z.string().meta({ format: "binary" }),
        "image/png": z.string().meta({ format: "binary" }),
        "image/webp": z.string().meta({ format: "binary" }),
      },
    },
    ...problemResponses(401, 403, 404, 410, 423, 503),
  },
});

/** What `getStorageSettings` accepts in the query string. */
export const getStorageSettingsQuery = z.object({
  query: z.string().trim().max(100).optional(),
});

export const getStorageSettings = defineRoute({
  method: "get",
  path: "/api/v1/settings/storage",
  operationId: "getStorageSettings",
  security: [{ kinship_session: [] }],
  request: {
    query: getStorageSettingsQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Admin-only safe workspace storage diagnostics",
      content: {
        "application/json": storageSettings,
      },
    },
    ...problemResponses(400, 401, 403, 503),
  },
});

/** Every files route, in the order the surface mounts them. */
export const FILES_ROUTES: readonly RouteDescriptor[] = [
  listPersonFiles,
  uploadPersonFile,
  removePersonFile,
  downloadPersonFile,
  getStorageSettings,
];
