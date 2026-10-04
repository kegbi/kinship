/**
 * Workspace imports: every route of this surface, once.
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
  csvColumnMapping,
  importCommit,
  importDryRun,
  importMappingRequired,
  importSummary,
} from "../schemas/imports.ts";
import { uuid } from "../schemas/shared.ts";

export const listImports = defineRoute({
  method: "get",
  path: "/api/v1/imports",
  operationId: "listImports",
  security: [{ kinship_session: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Admin-only import history",
      content: {
        "application/json": z.strictObject({
          imports: z.array(importSummary),
        }),
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const createImportDryRun = defineRoute({
  method: "post",
  path: "/api/v1/imports/dry-runs",
  operationId: "createImportDryRun",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": z.strictObject({
          source: z.object({}).meta({
            description:
              'A Monica JSON export, or `{ format: "vcard" | "csv", text }` with the file\'s UTF-8 text.',
          }),
        }),
      },
    },
  },
  responses: {
    201: {
      description:
        "Validated bounded dry-run, or a CSV import awaiting its column mapping",
      content: {
        "application/json": z.union([importDryRun, importMappingRequired]),
      },
    },
    ...problemResponses(400, 401, 403, 413, 503),
  },
});

export const getImportReport = defineRoute({
  method: "get",
  path: "/api/v1/imports/{importId}",
  operationId: "getImportReport",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      importId: uuid,
    }),
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Import report",
      content: {
        "application/json": importSummary,
      },
    },
    ...problemResponses(401, 403, 404, 503),
  },
});

export const commitImport = defineRoute({
  method: "post",
  path: "/api/v1/imports/{importId}/commit",
  operationId: "commitImport",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      importId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": importCommit,
      },
    },
  },
  responses: {
    200: {
      description: "Atomic idempotent import commit",
      content: {
        "application/json": z.strictObject({
          importId: z.uuid(),
          peopleCreated: z.number().int().min(0),
          peopleReused: z.number().int().min(0),
          /** People an earlier import made that a member deleted since (REL-065). */
          peopleSkippedDeleted: z.number().int().min(0),
          status: z.literal("completed"),
        }),
      },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

export const mapImportColumns = defineRoute({
  method: "post",
  path: "/api/v1/imports/{importId}/mapping",
  operationId: "mapImportColumns",
  description:
    "Applies the member's column mapping to a pending CSV import and returns its dry-run report.",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      importId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": csvColumnMapping,
      },
    },
  },
  responses: {
    200: {
      description: "Mapped CSV dry-run",
      content: {
        "application/json": importDryRun,
      },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

/** Every imports route, in the order the surface mounts them. */
export const IMPORTS_ROUTES: readonly RouteDescriptor[] = [
  listImports,
  createImportDryRun,
  getImportReport,
  mapImportColumns,
  commitImport,
];
