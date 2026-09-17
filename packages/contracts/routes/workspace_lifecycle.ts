/**
 * Resetting and deleting a workspace: every route of this surface, once.
 *
 * Each descriptor is what `apps/api` mounts and what
 * `tools/contracts/build.ts` documents. A route the document does not describe
 * fails `deno task contracts:check`, and one that is mounted and not here, or
 * here and never mounted, fails `apps/api/routes_test.ts`.
 */

import { defineRoute, type RouteDescriptor } from "../registry.ts";
import {
  originAndWorkspaceHeaders,
  problemResponses,
  rateLimitedProblem,
  workspaceHeaders,
} from "./common.ts";
import {
  workspaceDeleted,
  workspaceLifecycleConfirmation,
  workspaceLifecyclePreview,
  workspaceReset,
} from "../schemas/workspace_lifecycle.ts";

export const deleteWorkspace = defineRoute({
  method: "delete",
  path: "/api/v1/settings/workspace-lifecycle",
  operationId: "deleteWorkspace",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": workspaceLifecycleConfirmation,
      },
    },
  },
  responses: {
    200: {
      description: "Workspace deleted and cleanup recorded",
      content: {
        "application/json": workspaceDeleted,
      },
    },
    429: rateLimitedProblem,
    ...problemResponses(400, 401, 403, 409, 503),
  },
});

export const getWorkspaceLifecyclePreview = defineRoute({
  method: "get",
  path: "/api/v1/settings/workspace-lifecycle",
  operationId: "getWorkspaceLifecyclePreview",
  security: [{ kinship_session: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Current member settings",
      content: {
        "application/json": workspaceLifecyclePreview,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const resetWorkspace = defineRoute({
  method: "post",
  path: "/api/v1/settings/workspace-lifecycle/reset",
  operationId: "resetWorkspace",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": workspaceLifecycleConfirmation,
      },
    },
  },
  responses: {
    200: {
      description: "Workspace CRM data reset and sessions revoked",
      content: {
        "application/json": workspaceReset,
      },
    },
    429: rateLimitedProblem,
    ...problemResponses(400, 401, 403, 409, 503),
  },
});

/** Every workspace lifecycle route, in the order the surface mounts them. */
export const WORKSPACE_LIFECYCLE_ROUTES: readonly RouteDescriptor[] = [
  deleteWorkspace,
  getWorkspaceLifecyclePreview,
  resetWorkspace,
];
