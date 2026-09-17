/**
 * Person files and storage settings, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { request, workspaceHeader } from "./request.ts";
import type { PersonFile, StorageSettings } from "./types.ts";

export function getStorageSettings(
  query?: string,
  workspaceId?: string,
): Promise<ApiResult<StorageSettings>> {
  const search = query ? `?query=${encodeURIComponent(query)}` : "";
  return request(`/api/v1/settings/storage${search}`, {
    headers: workspaceHeader(workspaceId),
  });
}

export function listPersonFiles(
  personId: string,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly files: readonly PersonFile[]; readonly status: "ready" }>
> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}/files`, {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function uploadPersonFile(
  personId: string,
  input: {
    readonly file: File;
    readonly kind: PersonFile["kind"];
    readonly title: string;
  },
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly file: PersonFile; readonly status: "created" }>
> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}/files`, {
    method: "POST",
    body: input.file,
    headers: {
      "content-type": input.file.type,
      "X-File-Kind": input.kind,
      "X-File-Name": encodeURIComponent(input.file.name),
      "X-File-Title": encodeURIComponent(input.title),
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
    },
  });
}

export function personFileContentUrl(personId: string, fileId: string): string {
  return `/api/v1/people/${encodeURIComponent(personId)}/files/${
    encodeURIComponent(fileId)
  }/content`;
}

export function removePersonFile(
  personId: string,
  fileId: string,
  workspaceId?: string,
): Promise<ApiResult<{ readonly fileId: string; readonly status: "removed" }>> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/files/${
      encodeURIComponent(fileId)
    }`,
    {
      method: "DELETE",
      headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    },
  );
}
