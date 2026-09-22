/**
 * The journal and its timeline: every route of this surface, once.
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
  journalActivityInput,
  journalActivityLinked,
  journalDayRatingInput,
  journalDayRatingSaved,
  journalDeleted,
  journalItemReady,
  journalPostCreated,
  journalPostInput,
  journalPostUpdated,
  journalTimelineList,
} from "../schemas/journal.ts";
import { pageQuery, uuid } from "../schemas/shared.ts";

/** What `listJournal` accepts in the query string. */
export const listJournalQuery = pageQuery;

export const listJournal = defineRoute({
  method: "get",
  path: "/api/v1/journal",
  operationId: "listJournal",
  security: [{ kinship_session: [] }],
  request: {
    query: listJournalQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Ordered personal journal",
      content: {
        "application/json": journalTimelineList,
      },
    },
    ...problemResponses(400, 401, 403, 503),
  },
});

export const linkJournalActivity = defineRoute({
  method: "post",
  path: "/api/v1/journal/activities",
  operationId: "linkJournalActivity",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": journalActivityInput,
      },
    },
  },
  responses: {
    201: {
      description: "Activity linked",
      content: {
        "application/json": journalActivityLinked,
      },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

export const saveJournalDayRating = defineRoute({
  method: "put",
  path: "/api/v1/journal/day-ratings",
  operationId: "saveJournalDayRating",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": journalDayRatingInput,
      },
    },
  },
  responses: {
    200: {
      description: "Day rating updated",
      content: {
        "application/json": journalDayRatingSaved,
      },
    },
    201: {
      description: "Day rating created",
      content: {
        "application/json": journalDayRatingSaved,
      },
    },
    ...problemResponses(400, 401, 403, 503),
  },
});

export const deleteJournalItem = defineRoute({
  method: "delete",
  path: "/api/v1/journal/items/{itemId}",
  operationId: "deleteJournalItem",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      itemId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
  },
  responses: {
    200: {
      description: "Journal item removed",
      content: {
        "application/json": journalDeleted,
      },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

export const getJournalItem = defineRoute({
  method: "get",
  path: "/api/v1/journal/items/{itemId}",
  operationId: "getJournalItem",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      itemId: uuid,
    }),
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "One journal item",
      content: {
        "application/json": journalItemReady,
      },
    },
    ...problemResponses(401, 403, 404, 503),
  },
});

export const createJournalPost = defineRoute({
  method: "post",
  path: "/api/v1/journal/posts",
  operationId: "createJournalPost",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": journalPostInput,
      },
    },
  },
  responses: {
    201: {
      description: "Journal post created",
      content: {
        "application/json": journalPostCreated,
      },
    },
    ...problemResponses(400, 401, 403, 503),
  },
});

export const updateJournalPost = defineRoute({
  method: "put",
  path: "/api/v1/journal/posts/{itemId}",
  operationId: "updateJournalPost",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      itemId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": journalPostInput,
      },
    },
  },
  responses: {
    200: {
      description: "Journal post updated",
      content: {
        "application/json": journalPostUpdated,
      },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

/** Every journal route, in the order the surface mounts them. */
export const JOURNAL_ROUTES: readonly RouteDescriptor[] = [
  listJournal,
  linkJournalActivity,
  saveJournalDayRating,
  deleteJournalItem,
  getJournalItem,
  createJournalPost,
  updateJournalPost,
];
