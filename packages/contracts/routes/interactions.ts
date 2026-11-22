/**
 * Interactions, communications, and the activity report: every route of this
 * surface, once.
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
  activityReport,
  communicationList,
  communicationOptions,
  interactionCreated,
  interactionInput,
  interactionOptions,
  todayFavoriteNotes,
  todayRecentActivity,
} from "../schemas/interactions.ts";
import { uuid } from "../schemas/shared.ts";

export const listCommunicationOptions = defineRoute({
  method: "get",
  path: "/api/v1/communication-options",
  operationId: "listCommunicationOptions",
  description:
    "Requires a browser session or a personal token with interactions:create. Returns current capture vocabulary and availability only; no historic content.",
  tokenScope: "interactions:create",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Active communication channels, emotions, and availability",
      content: {
        "application/json": communicationOptions,
      },
    },
    ...problemResponses(401, 403, 409, 503),
  },
});

/** What `listInteractionOptions` accepts in the query string. */
export const listInteractionOptionsQuery = z.strictObject({
  activityTypeCursor: z.string().max(2000).optional(),
  activityTypeSearch: z.string().trim().max(100).optional(),
  emotionCursor: z.string().max(2000).optional(),
  emotionSearch: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(20),
});

export const listInteractionOptions = defineRoute({
  method: "get",
  path: "/api/v1/interaction-options",
  operationId: "listInteractionOptions",
  description:
    "Requires a browser session or a personal token with interactions:create. Returns bounded current capture vocabulary and availability only; no historic content. Cursors remain bound to their workspace and search filters.",
  tokenScope: "interactions:create",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    query: listInteractionOptionsQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Bounded active activity types and emotions",
      content: {
        "application/json": interactionOptions,
      },
    },
    ...problemResponses(400, 401, 403, 409, 503),
  },
});

export const recordInteraction = defineRoute({
  method: "post",
  path: "/api/v1/interactions",
  operationId: "recordInteraction",
  description:
    "Requires a browser session or a personal token with the independent interactions:create grant. Records a note, activity, call, or conversation through its owning use case; grants no historic-content read, edit, or delete access. Reuse body requestId for retries; changed payloads conflict. Bearer requests need no Cookie or Origin. Cookie writes require the exact configured public Origin.",
  tokenScope: "interactions:create",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: {
        "application/json": interactionInput,
      },
    },
  },
  responses: {
    201: {
      description: "Interaction or communication persisted atomically",
      content: {
        "application/json": interactionCreated,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

/** What `getActivityReport` accepts in the query string. */
export const getActivityReportQuery = z.strictObject({
  cursor: z.string().max(2000).optional(),
  kind: z.enum(["activity", "note"]).optional(),
  year: z.coerce.number().int().min(1).max(9999).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const getActivityReport = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/activity-report",
  operationId: "getActivityReport",
  description:
    "Requires a browser session or a personal token with interactions:read. Returns one person's activities and notes, including their summaries, descriptions, and note bodies, newest first; filter by kind and year and page with the opaque cursor, which stays bound to its workspace, person, and filters. Grants no capture, edit, or delete access.",
  tokenScope: "interactions:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    query: getActivityReportQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Tenant-scoped person activity report",
      content: {
        "application/json": activityReport,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const listPersonCommunications = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/communications",
  operationId: "listPersonCommunications",
  description:
    "Requires a browser session or a personal token with interactions:read. Returns one person's calls and conversations, including call content and conversation message text. Grants no capture, edit, or delete access.",
  tokenScope: "interactions:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Tenant-scoped person communication history",
      content: {
        "application/json": communicationList,
      },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

export const getTodayFavoriteNotes = defineRoute({
  method: "get",
  path: "/api/v1/today/favorite-notes",
  operationId: "getTodayFavoriteNotes",
  description:
    "Requires a browser session or a personal token with today:read. A dashboard projection across people: returns the workspace's favorite notes, including their bodies and the people they are about.",
  tokenScope: "today:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Read-only favorite-note Today region",
      content: {
        "application/json": todayFavoriteNotes,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const getTodayRecentActivity = defineRoute({
  method: "get",
  path: "/api/v1/today/recent-activity",
  operationId: "getTodayRecentActivity",
  description:
    "Requires a browser session or a personal token with today:read. A dashboard projection across people: returns recent notes and activities, including their content and participants.",
  tokenScope: "today:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Read-only recent-activity Today region",
      content: {
        "application/json": todayRecentActivity,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

/** Every interactions route, in the order the surface mounts them. */
export const INTERACTIONS_ROUTES: readonly RouteDescriptor[] = [
  listCommunicationOptions,
  listInteractionOptions,
  recordInteraction,
  getActivityReport,
  listPersonCommunications,
  getTodayFavoriteNotes,
  getTodayRecentActivity,
];
