/**
 * Member and workspace settings, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { request, workspaceHeader } from "./request.ts";
import type {
  ManagedMember,
  MemberPreferences,
  MemberSession,
  MemberUiState,
  PersonalizationCreateInputBySection,
  PersonalizationEntry,
  PersonalizationSection,
  PersonalizationUpdateInputBySection,
  PersonWorkspaceView,
  ProfileSettings,
  ResolvedMemberPreferences,
  WorkspaceSettings,
} from "./types.ts";

export function getSettingsProfile(
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly status: "ready"; readonly profile: ProfileSettings }>
> {
  return request("/api/v1/settings/profile", {
    headers: workspaceHeader(workspaceId),
  });
}

export function updateSettingsProfile(
  input: Pick<ProfileSettings, "firstName" | "lastName">,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly status: "ready"; readonly profile: ProfileSettings }>
> {
  return request("/api/v1/settings/profile", {
    method: "PUT",
    headers: workspaceHeader(workspaceId),
    body: JSON.stringify(input),
  });
}

export function getMemberPreferences(
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly status: "ready";
      readonly preferences: ResolvedMemberPreferences;
    }
  >
> {
  return request("/api/v1/settings/preferences", {
    headers: workspaceHeader(workspaceId),
  });
}

export function getMemberUiState(
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly status: "ready"; readonly uiState: MemberUiState }>
> {
  return request("/api/v1/member/ui-state", {
    headers: workspaceHeader(workspaceId),
  });
}

export function saveMemberUiState(
  input: {
    readonly personWorkspaceView?: PersonWorkspaceView;
    readonly theme?: "system" | "light" | "dark";
  },
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly status: "ready"; readonly uiState: MemberUiState }>
> {
  return request("/api/v1/member/ui-state", {
    method: "PATCH",
    headers: workspaceHeader(workspaceId),
    body: JSON.stringify(input),
  });
}

export function updateMemberPreferences(
  input: MemberPreferences,
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly status: "ready";
      readonly preferences: ResolvedMemberPreferences;
    }
  >
> {
  return request("/api/v1/settings/preferences", {
    method: "PUT",
    headers: workspaceHeader(workspaceId),
    body: JSON.stringify(input),
  });
}

export function listMemberSessions(
  workspaceId?: string,
): Promise<
  ApiResult<
    { readonly status: "ready"; readonly sessions: readonly MemberSession[] }
  >
> {
  return request("/api/v1/settings/sessions", {
    headers: workspaceHeader(workspaceId),
  });
}

export function revokeMemberSession(
  sessionId: string,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly status: "revoked"; readonly current: boolean }>
> {
  return request(`/api/v1/settings/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: workspaceHeader(workspaceId),
  });
}

export function getWorkspaceSettings(
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly status: "ready"; readonly workspace: WorkspaceSettings }>
> {
  return request("/api/v1/settings/workspace", {
    headers: workspaceHeader(workspaceId),
  });
}

export function updateWorkspaceSettings(
  input: WorkspaceSettings,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly status: "ready"; readonly workspace: WorkspaceSettings }>
> {
  return request("/api/v1/settings/workspace", {
    method: "PUT",
    headers: workspaceHeader(workspaceId),
    body: JSON.stringify(input),
  });
}

export function listPersonalizationEntries(
  section: PersonalizationSection,
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly capabilities: {
        readonly create: boolean;
        readonly editValue: boolean;
      };
      readonly entries: readonly PersonalizationEntry[];
      readonly readOnly: boolean;
      readonly section: PersonalizationSection;
      readonly status: "ready";
    }
  >
> {
  return request(
    `/api/v1/settings/personalization/${encodeURIComponent(section)}`,
    { headers: workspaceHeader(workspaceId) },
  );
}

export function createPersonalizationEntry<S extends PersonalizationSection>(
  section: S,
  input: PersonalizationCreateInputBySection[S],
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly entry: PersonalizationEntry; readonly status: "saved" }>
> {
  return request(
    `/api/v1/settings/personalization/${encodeURIComponent(section)}`,
    {
      method: "POST",
      headers: workspaceHeader(workspaceId),
      body: JSON.stringify(input),
    },
  );
}

export function updatePersonalizationEntry<S extends PersonalizationSection>(
  section: S,
  id: string,
  input: PersonalizationUpdateInputBySection[S],
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly entry: PersonalizationEntry; readonly status: "saved" }>
> {
  return request(
    `/api/v1/settings/personalization/${encodeURIComponent(section)}/${
      encodeURIComponent(id)
    }`,
    {
      method: "PATCH",
      headers: workspaceHeader(workspaceId),
      body: JSON.stringify(input),
    },
  );
}

export function deletePersonalizationEntry(
  section: PersonalizationSection,
  id: string,
  expectedUpdatedAt: string,
  replacementId?: string,
  workspaceId?: string,
): Promise<ApiResult<{ readonly id: string; readonly status: "deleted" }>> {
  const query = new URLSearchParams({ expectedUpdatedAt });
  if (replacementId) query.set("replacementId", replacementId);
  return request(
    `/api/v1/settings/personalization/${encodeURIComponent(section)}/${
      encodeURIComponent(id)
    }?${query}`,
    { method: "DELETE", headers: workspaceHeader(workspaceId) },
  );
}

export function listManagedMembers(
  workspaceId?: string,
): Promise<
  ApiResult<
    { readonly status: "ready"; readonly members: readonly ManagedMember[] }
  >
> {
  return request("/api/v1/settings/members", {
    headers: workspaceHeader(workspaceId),
  });
}

export function updateManagedMember(
  memberId: string,
  input: Pick<ManagedMember, "role" | "status">,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly status: "ready"; readonly member: ManagedMember }>
> {
  return request(`/api/v1/settings/members/${encodeURIComponent(memberId)}`, {
    method: "PATCH",
    headers: workspaceHeader(workspaceId),
    body: JSON.stringify(input),
  });
}
