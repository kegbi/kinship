/**
 * Leaving a workspace and deleting an identity: every route of this surface,
 * once.
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
  workspaceHeaders,
} from "./common.ts";
import {
  personalIdentityDeleted,
  personalIdentityDeletionInput,
  personalLifecycleConfirmation,
  personalLifecyclePreview,
  workspaceLeft,
} from "../schemas/personal_lifecycle.ts";

export const deletePersonalIdentity = defineRoute({
  method: "delete",
  path: "/api/v1/settings/personal-lifecycle",
  operationId: "deletePersonalIdentity",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": personalIdentityDeletionInput,
      },
    },
  },
  responses: {
    200: {
      description: "Personal identity deleted and sessions revoked",
      content: {
        "application/json": personalIdentityDeleted,
      },
    },
    ...problemResponses(400, 401, 403, 409, 429, 503),
  },
});

export const getPersonalLifecyclePreview = defineRoute({
  method: "get",
  path: "/api/v1/settings/personal-lifecycle",
  operationId: "getPersonalLifecyclePreview",
  security: [{ kinship_session: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Current member settings",
      content: {
        "application/json": personalLifecyclePreview,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const leaveCurrentWorkspace = defineRoute({
  method: "post",
  path: "/api/v1/settings/personal-lifecycle/leave",
  operationId: "leaveCurrentWorkspace",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": personalLifecycleConfirmation,
      },
    },
  },
  responses: {
    200: {
      description: "Current workspace left with next valid destination",
      content: {
        "application/json": workspaceLeft,
      },
    },
    ...problemResponses(400, 401, 403, 409, 429, 503),
  },
});

/** Every personal lifecycle route, in the order the surface mounts them. */
export const PERSONAL_LIFECYCLE_ROUTES: readonly RouteDescriptor[] = [
  deletePersonalIdentity,
  getPersonalLifecyclePreview,
  leaveCurrentWorkspace,
];
