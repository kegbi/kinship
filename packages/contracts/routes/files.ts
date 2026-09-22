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
  originAndWorkspaceHeaders,
  problemResponses,
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
  security: [{ kinship_session: [] }],
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
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: z.object({
      Origin: z.url().meta({
        description: "Must exactly match the configured public web origin.",
      }),
      "X-Workspace-Id": z.uuid().optional().meta({
        description:
          "Optional requested workspace; validated against active membership.",
      }),
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
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
      fileId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
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
  security: [{ kinship_session: [] }],
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
