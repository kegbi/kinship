/**
 * CalDAV and CardDAV subscriptions: every route of this surface, once.
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
  davSubscriptionConfigured,
  davSubscriptionDisabled,
  davSubscriptionInput,
  davSubscriptionList,
  davSyncResult,
} from "../schemas/integrations.ts";
import { uuid } from "../schemas/shared.ts";

export const getDavSubscriptions = defineRoute({
  method: "get",
  path: "/api/v1/settings/integrations/dav",
  operationId: "getDavSubscriptions",
  security: [{ kinship_session: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "DAV subscription metadata",
      content: {
        "application/json": davSubscriptionList,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const createDavSubscription = defineRoute({
  method: "post",
  path: "/api/v1/settings/integrations/dav",
  operationId: "createDavSubscription",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": davSubscriptionInput,
      },
    },
  },
  responses: {
    201: {
      description: "DAV subscription configured",
      content: {
        "application/json": davSubscriptionConfigured,
      },
    },
    ...problemResponses(400, 401, 403, 503),
  },
});

export const disableDavSubscription = defineRoute({
  method: "delete",
  path: "/api/v1/settings/integrations/dav/{subscriptionId}",
  operationId: "disableDavSubscription",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      subscriptionId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
  },
  responses: {
    200: {
      description: "DAV subscription disabled without deleting core data",
      content: {
        "application/json": davSubscriptionDisabled,
      },
    },
    ...problemResponses(401, 403, 404, 503),
  },
});

export const synchronizeDavSubscription = defineRoute({
  method: "post",
  path: "/api/v1/settings/integrations/dav/{subscriptionId}/sync",
  operationId: "synchronizeDavSubscription",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      subscriptionId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
  },
  responses: {
    200: {
      description:
        "DAV synchronization completed or produced a recoverable outcome",
      content: {
        "application/json": davSyncResult,
      },
    },
    ...problemResponses(401, 403, 404, 409, 503),
  },
});

/** Every integrations route, in the order the surface mounts them. */
export const INTEGRATIONS_ROUTES: readonly RouteDescriptor[] = [
  getDavSubscriptions,
  createDavSubscription,
  disableDavSubscription,
  synchronizeDavSubscription,
];
