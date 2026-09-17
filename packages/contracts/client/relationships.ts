/**
 * Relationships between people, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { request } from "./request.ts";
import type {
  PersonTransitionInput,
  RelatedPersonRelationshipChanged,
  RelatedPersonRelationshipInput,
  RelationshipChanged,
  RelationshipListInput,
  RelationshipListPage,
  RelationshipType,
} from "./types.ts";

export function listRelationshipTypes(
  input: {
    readonly cursor?: string;
    readonly search?: string;
    readonly selected?: readonly string[];
  } = {},
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly nextCursor?: string;
      readonly options: readonly RelationshipType[];
      readonly selected: readonly RelationshipType[];
      readonly status: "hidden" | "ready";
    }
  >
> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.search) query.set("search", input.search);
  if (input.selected?.length) query.set("selected", input.selected.join(","));
  const suffix = query.size ? `?${query.toString()}` : "";
  return request(`/api/v1/relationship-types${suffix}`, {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function listRelationships(
  personId: string,
  input: RelationshipListInput = {},
  workspaceId?: string,
): Promise<ApiResult<RelationshipListPage>> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.limit) query.set("limit", String(input.limit));
  const suffix = query.size ? `?${query.toString()}` : "";
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/relationships${suffix}`,
    { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined },
  );
}

export function createRelationship(
  personId: string,
  input: {
    readonly relationshipTypeId: string;
    readonly targetPersonId: string;
  },
  workspaceId?: string,
): Promise<ApiResult<RelationshipChanged>> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/relationships`,
    {
      method: "POST",
      headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
      body: JSON.stringify(input),
    },
  );
}

export function createRelatedPersonRelationship(
  personId: string,
  input: RelatedPersonRelationshipInput,
  workspaceId?: string,
): Promise<ApiResult<RelatedPersonRelationshipChanged>> {
  return request(
    `/api/v1/people/${
      encodeURIComponent(personId)
    }/relationships/related-person`,
    {
      method: "POST",
      headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
      body: JSON.stringify(input),
    },
  );
}

export function updateRelationship(
  personId: string,
  relationshipId: string,
  input: {
    readonly expectedUpdatedAt: string;
    readonly relationshipTypeId: string;
  },
  workspaceId?: string,
): Promise<ApiResult<RelationshipChanged>> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/relationships/${
      encodeURIComponent(relationshipId)
    }`,
    {
      method: "PATCH",
      headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
      body: JSON.stringify(input),
    },
  );
}

export function deleteRelationship(
  personId: string,
  relationshipId: string,
  input: PersonTransitionInput,
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly affectedPersonIds: readonly [string, string];
      readonly relationshipId: string;
      readonly status: "deleted";
    }
  >
> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/relationships/${
      encodeURIComponent(relationshipId)
    }`,
    {
      method: "DELETE",
      headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
      body: JSON.stringify(input),
    },
  );
}
