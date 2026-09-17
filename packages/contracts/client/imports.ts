/**
 * Workspace imports, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { request, workspaceHeader } from "./request.ts";
import type { ImportReport, ImportSummary } from "./types.ts";

export function listImports(
  workspaceId?: string,
): Promise<ApiResult<{ readonly imports: readonly ImportSummary[] }>> {
  return request("/api/v1/imports", { headers: workspaceHeader(workspaceId) });
}

export function createImportDryRun(
  source: unknown,
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly importId: string;
      readonly report: ImportReport;
      readonly status: "dry_run";
    }
  >
> {
  return request("/api/v1/imports/dry-runs", {
    method: "POST",
    headers: workspaceHeader(workspaceId),
    body: JSON.stringify({ source }),
  });
}

export function getImportReport(
  importId: string,
  workspaceId?: string,
): Promise<ApiResult<ImportSummary>> {
  return request(`/api/v1/imports/${encodeURIComponent(importId)}`, {
    headers: workspaceHeader(workspaceId),
  });
}

export function commitImport(
  importId: string,
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly importId: string;
      readonly peopleCreated: number;
      readonly peopleReused: number;
      readonly status: "completed";
    }
  >
> {
  return request(`/api/v1/imports/${encodeURIComponent(importId)}/commit`, {
    method: "POST",
    headers: workspaceHeader(workspaceId),
    body: JSON.stringify({ confirmed: true }),
  });
}
