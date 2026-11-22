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
  problemResponses,
  tokenOrSessionWriteHeaders,
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
  description:
    "Personal tokens require journal:read. Journal posts and day ratings are workspace-wide, not private to their author: any member, and so any token, can read, edit, or delete any of them. Items may carry the content of linked activities. Does not grant writing.",
  tokenScope: "journal:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
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
  description:
    "Personal tokens require journal:write. Links an existing activity of the token's workspace to the journal; an activity that is already linked, or is not in the workspace, answers 404. Does not grant reading. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "journal:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    headers: tokenOrSessionWriteHeaders,
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
  description:
    "Personal tokens require journal:write. Upserts the one workspace-wide rating for its date: an existing rating for that date is replaced, an omitted comment cleared (200), otherwise one is created (201). Does not grant reading. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "journal:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    headers: tokenOrSessionWriteHeaders,
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
  description:
    "Personal tokens require journal:write. Journal posts and day ratings are workspace-wide, not private to their author: any member, and so any token, can read, edit, or delete any of them. Deleting an activity item removes its journal link, not the activity. Does not grant reading. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "journal:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      itemId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
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
  description:
    "Personal tokens require journal:read. Journal posts and day ratings are workspace-wide, not private to their author: any member, and so any token, can read, edit, or delete any of them. An activity item carries the linked activity's content. Does not grant writing.",
  tokenScope: "journal:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
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
  description:
    "Personal tokens require journal:write. Journal posts and day ratings are workspace-wide, not private to their author: any member, and so any token, can read, edit, or delete any of them. A retry creates a second post. Does not grant reading. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "journal:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    headers: tokenOrSessionWriteHeaders,
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
  description:
    "Personal tokens require journal:write. Journal posts and day ratings are workspace-wide, not private to their author: any member, and so any token, can read, edit, or delete any of them. Replaces the post with the body sent: an omitted title is cleared, and there is no revision check, so a concurrent edit is overwritten. Does not grant reading. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "journal:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      itemId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
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
