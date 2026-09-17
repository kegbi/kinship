/**
 * Legal acceptance and the audit history, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { request } from "./request.ts";
import type {
  AuditHistory,
  AuditHistoryInput,
  LegalDocument,
} from "./types.ts";

function auditQuery(input: AuditHistoryInput): string {
  const query = new URLSearchParams();
  if (input.action) query.set("action", input.action);
  if (input.actorMemberId) query.set("actorMemberId", input.actorMemberId);
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.from) query.set("from", input.from);
  if (input.limit) query.set("limit", String(input.limit));
  if (input.personId) query.set("personId", input.personId);
  if (input.to) query.set("to", input.to);
  return query.size ? `?${query.toString()}` : "";
}

export function listWorkspaceAudit(
  input: AuditHistoryInput = {},
  workspaceId?: string,
): Promise<ApiResult<AuditHistory>> {
  return request(`/api/v1/audit-events${auditQuery(input)}`, {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function listPersonAudit(
  personId: string,
  input: Omit<AuditHistoryInput, "personId"> = {},
  workspaceId?: string,
): Promise<ApiResult<AuditHistory>> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/audit${auditQuery(input)}`,
    { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined },
  );
}

export function getPublicLegalDocument(
  documentType: "privacy" | "terms",
): Promise<
  ApiResult<{ readonly document: LegalDocument; readonly status: "ready" }>
> {
  return request(`/api/v1/legal-documents/${documentType}`);
}

export function getLegalRequirements(
  workspaceId?: string,
): Promise<
  ApiResult<
    { readonly documents: readonly LegalDocument[]; readonly status: "ready" }
  >
> {
  return request("/api/v1/legal-requirements", {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function acceptLegalDocument(
  documentId: string,
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly acceptedAt: string;
      readonly documentId: string;
      readonly status: "accepted" | "already-accepted";
    }
  >
> {
  return request("/api/v1/legal-acceptances", {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify({ documentId }),
  });
}
