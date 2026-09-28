/**
 * The member's calendar feed (GAP-052, `INTEGRATION-002`): every route of this
 * surface, once.
 *
 * Four routes manage the feed from the integrations settings page under the
 * session, and the fifth is what a calendar application subscribes to. That
 * one carries no session and no cookie — its secret is its path — and answers
 * `text/calendar`, as the vCard download answers `text/vcard`.
 */

import { z } from "zod";
import { defineRoute, type RouteDescriptor } from "../registry.ts";
import {
  originAndWorkspaceHeaders,
  problemResponses,
  workspaceHeaders,
} from "./common.ts";
import {
  calendarFeedFile,
  calendarFeedIssued,
  calendarFeedRevoked,
  calendarFeedStatus,
} from "../schemas/calendar_feeds.ts";

export const getCalendarFeed = defineRoute({
  method: "get",
  path: "/api/v1/settings/calendar-feed",
  operationId: "getCalendarFeed",
  security: [{ kinship_session: [] }],
  request: { headers: workspaceHeaders },
  responses: {
    200: {
      description: "The member's live calendar feed, if any, without its URL",
      content: { "application/json": calendarFeedStatus },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const createCalendarFeed = defineRoute({
  method: "post",
  path: "/api/v1/settings/calendar-feed",
  operationId: "createCalendarFeed",
  security: [{ kinship_session: [] }],
  request: { headers: originAndWorkspaceHeaders },
  responses: {
    201: {
      description: "Calendar feed created; the URL is shown this once",
      content: { "application/json": calendarFeedIssued },
    },
    ...problemResponses(401, 403, 409, 503),
  },
});

export const rotateCalendarFeed = defineRoute({
  method: "post",
  path: "/api/v1/settings/calendar-feed/rotation",
  operationId: "rotateCalendarFeed",
  security: [{ kinship_session: [] }],
  request: { headers: originAndWorkspaceHeaders },
  responses: {
    201: {
      description: "The old URL is revoked and a new one is shown this once",
      content: { "application/json": calendarFeedIssued },
    },
    ...problemResponses(401, 403, 404, 503),
  },
});

export const revokeCalendarFeed = defineRoute({
  method: "delete",
  path: "/api/v1/settings/calendar-feed",
  operationId: "revokeCalendarFeed",
  security: [{ kinship_session: [] }],
  request: { headers: originAndWorkspaceHeaders },
  responses: {
    200: {
      description: "Calendar feed revoked; its URL answers 404 from now on",
      content: { "application/json": calendarFeedRevoked },
    },
    ...problemResponses(401, 403, 404, 503),
  },
});

const cacheHeaders = z.object({
  "Cache-Control": z.literal("private, max-age=300"),
  ETag: z.string().meta({ description: "A strong tag of the exact body." }),
});

export const getCalendarFeedDocument = defineRoute({
  method: "get",
  path: "/api/v1/calendar-feeds/{feedFile}",
  operationId: "getCalendarFeedDocument",
  description:
    "The read-only iCalendar subscription: yearly all-day events for person dates with a known month and day, and the member's reminder days from 30 days back to 365 days ahead, at most 2000 events. It needs no session or cookie; an unknown, revoked, or out-of-scope secret answers 404.",
  request: {
    params: z.object({ feedFile: calendarFeedFile }),
    headers: z.object({
      "If-None-Match": z.string().optional().meta({
        description: "A tag from an earlier answer; a match answers 304.",
      }),
    }),
  },
  responses: {
    200: {
      description: "The member's calendar feed",
      headers: cacheHeaders,
      content: {
        "text/calendar": z.string().meta({ format: "binary" }),
      },
    },
    304: {
      description: "The feed has not changed since the tag presented",
      headers: cacheHeaders,
    },
    ...problemResponses(404, 503),
  },
});

/** Every calendar-feed route, in the order the surfaces mount them. */
export const CALENDAR_FEEDS_ROUTES: readonly RouteDescriptor[] = [
  getCalendarFeed,
  createCalendarFeed,
  rotateCalendarFeed,
  revokeCalendarFeed,
  getCalendarFeedDocument,
];
