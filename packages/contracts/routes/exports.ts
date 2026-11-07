/**
 * Workspace exports and vCard downloads: every route of this surface, once.
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
  exportDownload,
  exportRequest,
  exportSummary,
  peopleVCardInput,
} from "../schemas/exports.ts";
import { uuid } from "../schemas/shared.ts";

export const listExports = defineRoute({
  method: "get",
  path: "/api/v1/exports",
  operationId: "listExports",
  security: [{ kinship_session: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Admin-only export history",
      content: {
        "application/json": z.strictObject({
          exports: z.array(exportSummary),
        }),
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const createWorkspaceExport = defineRoute({
  method: "post",
  path: "/api/v1/exports",
  operationId: "createWorkspaceExport",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: false,
      content: {
        "application/json": exportRequest,
      },
    },
  },
  responses: {
    201: {
      description:
        "Completed workspace export: portable JSON, a CSV archive, or an all-people vCard",
      content: {
        "application/json": exportSummary,
      },
    },
    ...problemResponses(400, 401, 403, 413, 503),
  },
});

/** What `downloadExport` accepts in the query string. */
export const downloadExportQuery = z.object({
  token: z.string().min(1).max(200),
  workspaceId: z.uuid().optional().meta({
    description:
      "Optional workspace selection for browser download links; validated against active membership.",
  }),
});

export const downloadExport = defineRoute({
  method: "get",
  path: "/api/v1/exports/{exportId}/download",
  operationId: "downloadExport",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      exportId: uuid,
    }),
    query: downloadExportQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Private export artifact",
      content: {
        "application/json": z.string().meta({ format: "binary" }),
        "application/zip": z.string().meta({ format: "binary" }),
        "text/vcard": z.string().meta({ format: "binary" }),
      },
    },
    ...problemResponses(401, 403, 404, 410, 503),
  },
});

export const createExportDownload = defineRoute({
  method: "post",
  path: "/api/v1/exports/{exportId}/downloads",
  operationId: "createExportDownload",
  secrecy: "issues-secret",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      exportId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
  },
  responses: {
    201: {
      description: "Short-lived authorized download reference",
      content: {
        "application/json": exportDownload,
      },
    },
    ...problemResponses(401, 403, 404, 503),
  },
});

/** What `exportPersonVCard` accepts in the query string. */
export const exportPersonVCardQuery = z.object({
  workspaceId: z.uuid().optional().meta({
    description:
      "Optional workspace selection for browser download links; validated against active membership.",
  }),
});

export const exportPersonVCard = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/vcard",
  operationId: "exportPersonVCard",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    query: exportPersonVCardQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Member-authorized person vCard",
      content: {
        "text/vcard": z.string().meta({ format: "binary" }),
      },
    },
    ...problemResponses(401, 404, 503),
  },
});

export const exportPeopleVCards = defineRoute({
  method: "post",
  path: "/api/v1/people/bulk/vcard",
  operationId: "exportPeopleVCards",
  description:
    "One vCard file of up to 100 selected people, in request order. People missing from the active workspace are skipped and counted in `X-Skipped-Count`.",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": peopleVCardInput,
      },
    },
  },
  responses: {
    200: {
      description: "Member-authorized vCard of the selected people",
      content: {
        "text/vcard": z.string().meta({ format: "binary" }),
      },
      headers: z.object({
        "X-Skipped-Count": z.string().regex(/^\d+$/).meta({
          description:
            "How many selected people were missing from the workspace and left out.",
        }),
      }),
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

/** Every exports route, in the order the surface mounts them. */
export const EXPORTS_ROUTES: readonly RouteDescriptor[] = [
  listExports,
  createWorkspaceExport,
  downloadExport,
  createExportDownload,
  exportPeopleVCards,
  exportPersonVCard,
];
