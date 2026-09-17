/**
 * Interactions, communications, and the activity report, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { request } from "./request.ts";
import type {
  ActivityReport,
  CommunicationList,
  CommunicationOptions,
  Interaction,
  InteractionInput,
  InteractionOption,
  TodayFavoriteNotes,
  TodayRecentActivity,
} from "./types.ts";

export function recordInteraction(
  input: InteractionInput,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly record: Interaction; readonly status: "created" }>
> {
  return request("/api/v1/interactions", {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function listInteractionOptions(
  input: {
    readonly activityTypeCursor?: string;
    readonly activityTypeSearch?: string;
    readonly emotionCursor?: string;
    readonly emotionSearch?: string;
    readonly limit?: number;
  } = {},
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly activityTypes: readonly InteractionOption[];
      readonly activityTypesNextCursor?: string;
      readonly availability: {
        readonly activity: boolean;
        readonly note: boolean;
      };
      readonly emotions: readonly InteractionOption[];
      readonly emotionsNextCursor?: string;
      readonly status: "ready";
    }
  >
> {
  const query = new URLSearchParams();
  if (input.activityTypeCursor) {
    query.set("activityTypeCursor", input.activityTypeCursor);
  }
  if (input.activityTypeSearch) {
    query.set("activityTypeSearch", input.activityTypeSearch);
  }
  if (input.emotionCursor) query.set("emotionCursor", input.emotionCursor);
  if (input.emotionSearch) query.set("emotionSearch", input.emotionSearch);
  if (input.limit) query.set("limit", String(input.limit));
  const suffix = query.size ? `?${query.toString()}` : "";
  return request(`/api/v1/interaction-options${suffix}`, {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function listCommunicationOptions(
  workspaceId?: string,
): Promise<ApiResult<CommunicationOptions>> {
  return request("/api/v1/communication-options", {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function listPersonCommunications(
  personId: string,
  workspaceId?: string,
): Promise<ApiResult<CommunicationList>> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/communications`,
    { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined },
  );
}

export function getActivityReport(
  personId: string,
  input: {
    readonly cursor?: string;
    readonly kind?: "activity" | "note";
    readonly limit?: number;
    readonly year?: number;
  } = {},
  workspaceId?: string,
): Promise<ApiResult<ActivityReport>> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.kind) query.set("kind", input.kind);
  if (input.limit) query.set("limit", String(input.limit));
  if (input.year) query.set("year", String(input.year));
  const suffix = query.size ? `?${query.toString()}` : "";
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/activity-report${suffix}`,
    { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined },
  );
}

export function getTodayFavoriteNotes(
  workspaceId?: string,
): Promise<ApiResult<TodayFavoriteNotes>> {
  return request("/api/v1/today/favorite-notes", {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function getTodayRecentActivity(
  workspaceId?: string,
): Promise<ApiResult<TodayRecentActivity>> {
  return request("/api/v1/today/recent-activity", {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}
