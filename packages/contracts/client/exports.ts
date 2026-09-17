/**
 * Workspace exports and vCard downloads, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { request, workspaceHeader } from "./request.ts";
import type { ExportSummary } from "./types.ts";

export function listExports(
  workspaceId?: string,
): Promise<ApiResult<{ readonly exports: readonly ExportSummary[] }>> {
  return request("/api/v1/exports", { headers: workspaceHeader(workspaceId) });
}

export function createWorkspaceExport(
  workspaceId?: string,
): Promise<ApiResult<ExportSummary>> {
  return request("/api/v1/exports", {
    method: "POST",
    headers: workspaceHeader(workspaceId),
  });
}

export function createExportDownload(
  exportId: string,
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly expiresAt: string;
      readonly href: string;
      readonly status: "ready";
    }
  >
> {
  return request(`/api/v1/exports/${encodeURIComponent(exportId)}/downloads`, {
    method: "POST",
    headers: workspaceHeader(workspaceId),
  });
}
