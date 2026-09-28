/**
 * Workspace exports and vCard downloads, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult, ProblemDetails } from "./request.ts";
import { request, workspaceHeader } from "./request.ts";
import type {
  ExportFormat,
  ExportSummary,
  PeopleVCardDownload,
  PeopleVCardInput,
} from "./types.ts";

export function listExports(
  workspaceId?: string,
): Promise<ApiResult<{ readonly exports: readonly ExportSummary[] }>> {
  return request("/api/v1/exports", { headers: workspaceHeader(workspaceId) });
}

export function createWorkspaceExport(
  workspaceId?: string,
  format?: ExportFormat,
): Promise<ApiResult<ExportSummary>> {
  return request("/api/v1/exports", {
    method: "POST",
    headers: workspaceHeader(workspaceId),
    ...(format ? { body: JSON.stringify({ format }) } : {}),
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

/** The filename a `Content-Disposition` offers, preferring its UTF-8 form. */
function dispositionFilename(header: string | null): string | undefined {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header ?? "")?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall through to the ASCII form.
    }
  }
  return /filename="([^"]*)"/i.exec(header ?? "")?.[1];
}

/**
 * One vCard of the directory's selection (GAP-051). The body is the file, so
 * it is read as bytes rather than JSON, and a refusal is the usual problem.
 */
export async function exportPeopleVCards(
  input: PeopleVCardInput,
  workspaceId?: string,
): Promise<ApiResult<PeopleVCardDownload>> {
  const response = await fetch("/api/v1/people/bulk/vcard", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    return { ok: false, problem: await response.json() as ProblemDetails };
  }
  return {
    ok: true,
    value: {
      blob: await response.blob(),
      filename:
        dispositionFilename(response.headers.get("content-disposition")) ??
          "kinship-people.vcf",
      skipped: Number(response.headers.get("x-skipped-count") ?? "0") || 0,
    },
  };
}
