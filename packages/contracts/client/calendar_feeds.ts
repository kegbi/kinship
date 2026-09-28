/**
 * The member's calendar feed (GAP-052), over fetch: read whether one is live,
 * create it, rotate it, and revoke it. The feed itself is read by a calendar
 * application at the URL `createCalendarFeed` answers with, never through this
 * client.
 */

import type { ApiResult } from "./request.ts";
import { request, workspaceHeader } from "./request.ts";
import type {
  CalendarFeedIssued,
  CalendarFeedRevoked,
  CalendarFeedStatus,
} from "./types.ts";

export function getCalendarFeed(
  workspaceId?: string,
): Promise<ApiResult<CalendarFeedStatus>> {
  return request("/api/v1/settings/calendar-feed", {
    headers: workspaceHeader(workspaceId),
  });
}

export function createCalendarFeed(
  workspaceId?: string,
): Promise<ApiResult<CalendarFeedIssued>> {
  return request("/api/v1/settings/calendar-feed", {
    method: "POST",
    headers: workspaceHeader(workspaceId),
  });
}

export function rotateCalendarFeed(
  workspaceId?: string,
): Promise<ApiResult<CalendarFeedIssued>> {
  return request("/api/v1/settings/calendar-feed/rotation", {
    method: "POST",
    headers: workspaceHeader(workspaceId),
  });
}

export function revokeCalendarFeed(
  workspaceId?: string,
): Promise<ApiResult<CalendarFeedRevoked>> {
  return request("/api/v1/settings/calendar-feed", {
    method: "DELETE",
    headers: workspaceHeader(workspaceId),
  });
}
