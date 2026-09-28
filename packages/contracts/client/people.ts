/**
 * People: the directory, the page, and everything on it, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { request } from "./request.ts";
import { parseTodayRecentPeople } from "./today.ts";
import type {
  ImportantDate,
  ImportantDateInput,
  PeopleBulkInput,
  PeopleBulkResult,
  PeopleDirectoryInput,
  PeopleDirectoryLifecycle,
  PeopleDirectoryPage,
  PeopleDuplicates,
  PeopleTagFacet,
  PeopleTagOptionsInput,
  PeopleTagOptionsPage,
  PersonAvatarChanged,
  PersonDeletionImpact,
  PersonDueInformation,
  PersonEditInput,
  PersonGenderOption,
  PersonIdentity,
  PersonInput,
  PersonLifecycleIdentity,
  PersonLifeEvent,
  PersonLifeEventInput,
  PersonLifeEventType,
  PersonLifeEventUpdateInput,
  PersonMerged,
  PersonMergeInput,
  PersonMergePreview,
  PersonProfileIdentity,
  PersonProfileSummary,
  PersonStarChanged,
  PersonTimelineKind,
  PersonTimelinePage,
  PersonTransitionInput,
  ProfileFactCreateInputBySection,
  ProfileFactDeleteInput,
  ProfileFactListInput,
  ProfileFactRecord,
  ProfileFactSection,
  ProfileFactSectionId,
  ProfileFactUpdateInputBySection,
  TodayRecentPeople,
} from "./types.ts";

export function listPeople(
  input: PeopleDirectoryInput = {},
  workspaceId?: string,
): Promise<ApiResult<PeopleDirectoryPage>> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.excludePersonId) {
    query.set("excludePersonId", input.excludePersonId);
  }
  if (input.lifecycle) query.set("lifecycle", input.lifecycle);
  if (input.limit) query.set("limit", String(input.limit));
  if (input.search) query.set("search", input.search);
  if (input.selectedPersonId) {
    query.set("selectedPersonId", input.selectedPersonId);
  }
  if (input.sort) query.set("sort", input.sort);
  if (input.starred) query.set("starred", "true");
  if (input.starredFirst) query.set("starredFirst", "true");
  if (input.tagId) query.set("tag", input.tagId);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return request(`/api/v1/people${suffix}`, {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function listPeopleTagOptions(
  input: PeopleTagOptionsInput = {},
  workspaceId?: string,
): Promise<ApiResult<PeopleTagOptionsPage>> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.search) query.set("search", input.search);
  if (input.selectedTagId) query.set("selected", input.selectedTagId);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return request(`/api/v1/people/tag-options${suffix}`, {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

/** How many people of the view carry each of the top tags (GAP-053). */
export function listPeopleTagFacet(
  lifecycle: PeopleDirectoryLifecycle = "active",
  workspaceId?: string,
): Promise<ApiResult<PeopleTagFacet>> {
  return request(`/api/v1/people/tag-facet?lifecycle=${lifecycle}`, {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function createPerson(
  input: PersonInput,
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly status: "created";
      readonly person: PersonIdentity;
      readonly next: string;
    }
  >
> {
  return request("/api/v1/people", {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function getPerson(
  personId: string,
  workspaceId?: string,
  include?: "summary",
): Promise<
  ApiResult<
    {
      readonly dueInformation: PersonDueInformation;
      readonly genderOptions?: readonly PersonGenderOption[];
      readonly status: "ready" | "archived";
      readonly person: PersonProfileIdentity;
      readonly summary?: PersonProfileSummary;
    }
  >
> {
  const suffix = include ? `?include=${include}` : "";
  return request(`/api/v1/people/${encodeURIComponent(personId)}${suffix}`, {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function listPersonLifeEvents(
  personId: string,
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly events: readonly PersonLifeEvent[];
      readonly status: "hidden" | "ready";
      readonly types: readonly PersonLifeEventType[];
    }
  >
> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}/life-events`, {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function createPersonLifeEvent(
  personId: string,
  input: PersonLifeEventInput,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly event: PersonLifeEvent; readonly status: "created" }>
> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}/life-events`, {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function updatePersonLifeEvent(
  personId: string,
  lifeEventId: string,
  input: PersonLifeEventUpdateInput,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly event: PersonLifeEvent; readonly status: "updated" }>
> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/life-events/${
      encodeURIComponent(lifeEventId)
    }`,
    {
      method: "PATCH",
      headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
      body: JSON.stringify(input),
    },
  );
}

export function deletePersonLifeEvent(
  personId: string,
  lifeEventId: string,
  input: PersonTransitionInput,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly lifeEventId: string; readonly status: "deleted" }>
> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/life-events/${
      encodeURIComponent(lifeEventId)
    }`,
    {
      method: "DELETE",
      headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
      body: JSON.stringify(input),
    },
  );
}

export function listPersonTimeline(
  personId: string,
  input: {
    readonly cursor?: string;
    readonly kind?: PersonTimelineKind;
    readonly limit?: number;
  } = {},
  workspaceId?: string,
): Promise<ApiResult<PersonTimelinePage>> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.kind) query.set("kind", input.kind);
  if (input.limit) query.set("limit", String(input.limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/timeline${suffix}`,
    { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined },
  );
}

export function recordPersonView(
  personId: string,
  workspaceId?: string,
): Promise<ApiResult<{ readonly status: "recorded" }>> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}/view`, {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function getTodayRecentPeople(
  workspaceId?: string,
): Promise<ApiResult<TodayRecentPeople>> {
  return request<unknown>("/api/v1/today/recent-people", {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  }).then((result): ApiResult<TodayRecentPeople> =>
    result.ok
      ? { ok: true, value: parseTodayRecentPeople(result.value) }
      : result
  );
}

export function listProfileFacts(
  personId: string,
  section: ProfileFactSectionId,
  input: ProfileFactListInput = {},
  workspaceId?: string,
): Promise<ApiResult<ProfileFactSection>> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.includeOptions) query.set("includeOptions", "true");
  if (input.optionCursor) query.set("optionCursor", input.optionCursor);
  if (input.optionSearch) query.set("optionSearch", input.optionSearch);
  const suffix = query.size ? `?${query.toString()}` : "";
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/facts/${
      encodeURIComponent(section)
    }${suffix}`,
    { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined },
  );
}

export function createProfileFact<Section extends ProfileFactSectionId>(
  personId: string,
  section: Section,
  input: ProfileFactCreateInputBySection[Section],
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly personUpdatedAt: string;
      readonly record: Extract<
        ProfileFactRecord,
        { readonly section: Section }
      >;
      readonly status: "saved";
    }
  >
> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/facts/${
      encodeURIComponent(section)
    }`,
    {
      method: "POST",
      headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
      body: JSON.stringify(input),
    },
  );
}

export function updateProfileFact<Section extends ProfileFactSectionId>(
  personId: string,
  section: Section,
  factId: string,
  input: ProfileFactUpdateInputBySection[Section],
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly personUpdatedAt: string;
      readonly record: Extract<
        ProfileFactRecord,
        { readonly section: Section }
      >;
      readonly status: "saved";
    }
  >
> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/facts/${
      encodeURIComponent(section)
    }/${encodeURIComponent(factId)}`,
    {
      method: "PUT",
      headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
      body: JSON.stringify(input),
    },
  );
}

export function deleteProfileFact(
  personId: string,
  section: ProfileFactSectionId,
  factId: string,
  input: ProfileFactDeleteInput,
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly factId: string;
      readonly personUpdatedAt: string;
      readonly status: "deleted";
    }
  >
> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/facts/${
      encodeURIComponent(section)
    }/${encodeURIComponent(factId)}`,
    {
      method: "DELETE",
      headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
      body: JSON.stringify(input),
    },
  );
}

export function listImportantDates(
  personId: string,
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly dates: readonly ImportantDate[];
      readonly status: "ready" | "archived";
    }
  >
> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}/dates`, {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function createImportantDate(
  personId: string,
  input: ImportantDateInput,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly date: ImportantDate; readonly status: "created" }>
> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}/dates`, {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function updateImportantDate(
  personId: string,
  dateId: string,
  input: ImportantDateInput & PersonTransitionInput,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly date: ImportantDate; readonly status: "updated" }>
> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/dates/${
      encodeURIComponent(dateId)
    }`,
    {
      method: "PATCH",
      headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
      body: JSON.stringify(input),
    },
  );
}

export function deleteImportantDate(
  personId: string,
  dateId: string,
  input: PersonTransitionInput,
  workspaceId?: string,
): Promise<ApiResult<{ readonly dateId: string; readonly status: "deleted" }>> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/dates/${
      encodeURIComponent(dateId)
    }`,
    {
      method: "DELETE",
      headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
      body: JSON.stringify(input),
    },
  );
}

export function editPerson(
  personId: string,
  input: PersonEditInput,
  workspaceId?: string,
): Promise<
  ApiResult<
    { readonly person: PersonLifecycleIdentity; readonly status: "updated" }
  >
> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}`, {
    method: "PATCH",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

/**
 * Makes the image the person's avatar (GAP-045). The body is the file itself,
 * typed by its own media type, and the filename travels percent-encoded.
 */
export function replacePersonAvatar(
  personId: string,
  file: File,
  workspaceId?: string,
): Promise<ApiResult<PersonAvatarChanged>> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}/avatar`, {
    method: "PUT",
    body: file,
    headers: {
      "content-type": file.type,
      "X-File-Name": encodeURIComponent(file.name),
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
    },
  });
}

/** Draws the person with their initials again (GAP-045). */
export function removePersonAvatar(
  personId: string,
  workspaceId?: string,
): Promise<ApiResult<PersonAvatarChanged>> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}/avatar`, {
    method: "DELETE",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

/** Stars, or unstars, a person for the whole workspace (GAP-053). */
export function setPersonStar(
  personId: string,
  starred: boolean,
  workspaceId?: string,
): Promise<ApiResult<PersonStarChanged>> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}/star`, {
    method: starred ? "PUT" : "DELETE",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

/** The possible duplicates the directory offers for review (GAP-049). */
export function listPeopleDuplicates(
  workspaceId?: string,
): Promise<ApiResult<PeopleDuplicates>> {
  return request("/api/v1/people/duplicates", {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

/**
 * What merging the duplicate into the primary would keep, discard, and move,
 * with the revisions a confirmation names (GAP-049).
 */
export function previewPeopleMerge(
  primaryId: string,
  duplicateId: string,
  workspaceId?: string,
): Promise<ApiResult<PersonMergePreview>> {
  const query = new URLSearchParams({ duplicateId });
  return request(
    `/api/v1/people/${encodeURIComponent(primaryId)}/merge-preview?${query}`,
    { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined },
  );
}

/**
 * Merges the duplicate into the primary (GAP-049). The duplicate's records
 * move to the primary and the duplicate is deleted; this cannot be undone.
 */
export function mergePeople(
  primaryId: string,
  input: PersonMergeInput,
  workspaceId?: string,
): Promise<ApiResult<PersonMerged>> {
  return request(`/api/v1/people/${encodeURIComponent(primaryId)}/merge`, {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

/** Archives, restores, tags, or untags up to 100 people (GAP-051). */
export function bulkPeople(
  input: PeopleBulkInput,
  workspaceId?: string,
): Promise<ApiResult<PeopleBulkResult>> {
  return request("/api/v1/people/bulk", {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function archivePerson(
  personId: string,
  input: PersonTransitionInput,
  workspaceId?: string,
): Promise<
  ApiResult<
    { readonly person: PersonLifecycleIdentity; readonly status: "archived" }
  >
> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}/archive`, {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function restorePerson(
  personId: string,
  input: PersonTransitionInput,
  workspaceId?: string,
): Promise<
  ApiResult<
    { readonly person: PersonLifecycleIdentity; readonly status: "restored" }
  >
> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}/restore`, {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function getPersonDeletionImpact(
  personId: string,
  workspaceId?: string,
): Promise<ApiResult<PersonDeletionImpact>> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/deletion-impact`,
    { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined },
  );
}

export function deletePerson(
  personId: string,
  input: PersonTransitionInput & { readonly confirmation: string },
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly next: "/app/people";
      readonly personId: string;
      readonly status: "deleted";
    }
  >
> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}`, {
    method: "DELETE",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}
