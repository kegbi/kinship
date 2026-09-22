/**
 * The journal and its timeline, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { pageQuery, request } from "./request.ts";
import type {
  JournalDayRatingInput,
  JournalItemType,
  JournalLinkableActivity,
  JournalPostInput,
  JournalStoredDayRating,
  JournalStoredPost,
  JournalTimelineItem,
  PageInput,
} from "./types.ts";

/**
 * One page of the journal.
 *
 * The page argument trails the workspace so the one-argument call every
 * caller already made keeps its meaning; a first page names neither.
 */
export function listJournal(
  workspaceId?: string,
  input: PageInput = {},
): Promise<
  ApiResult<
    {
      readonly activities: readonly JournalLinkableActivity[];
      readonly items: readonly JournalTimelineItem[];
      readonly nextCursor?: string;
      readonly status: "ready";
    }
  >
> {
  return request(`/api/v1/journal${pageQuery(input)}`, {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function getJournalItem(
  itemId: string,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly item: JournalTimelineItem; readonly status: "ready" }>
> {
  return request(`/api/v1/journal/items/${encodeURIComponent(itemId)}`, {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function createJournalPost(
  input: JournalPostInput,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly post: JournalStoredPost; readonly status: "created" }>
> {
  return request("/api/v1/journal/posts", {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function updateJournalPost(
  postId: string,
  input: JournalPostInput,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly post: JournalStoredPost; readonly status: "updated" }>
> {
  return request(`/api/v1/journal/posts/${encodeURIComponent(postId)}`, {
    method: "PUT",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function saveJournalDayRating(
  input: JournalDayRatingInput,
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly rating: JournalStoredDayRating;
      readonly status: "created" | "updated";
    }
  >
> {
  return request("/api/v1/journal/day-ratings", {
    method: "PUT",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function linkJournalActivity(
  activityId: string,
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly activityId: string;
      readonly id: string;
      readonly occurredAt: string;
      readonly status: "created";
    }
  >
> {
  return request("/api/v1/journal/activities", {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify({ activityId }),
  });
}

export function deleteJournalItem(
  itemId: string,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly itemType: JournalItemType; readonly status: "deleted" }>
> {
  return request(`/api/v1/journal/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}
