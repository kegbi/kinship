/**
 * Gifts and debts, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { pageQuery, request } from "./request.ts";
import type {
  Debt,
  DebtCreateInput,
  DebtStatus,
  Gift,
  GiftCreateInput,
  GiftDebtList,
  GiftStatus,
} from "./types.ts";

/**
 * Where each half of the answer resumes, and how many rows each page carries.
 *
 * Gifts and debts continue independently, so a caller extending one sends only
 * that cursor and still receives the first page of the other.
 */
export interface GiftDebtPageInput {
  readonly debtCursor?: string;
  readonly giftCursor?: string;
  readonly limit?: number;
}

/**
 * One page of a person's gifts and one of their debts.
 *
 * The page argument trails the workspace so the two-argument call every
 * caller already made keeps its meaning; a first page names neither cursor.
 */
export function listPersonGifts(
  personId: string,
  workspaceId?: string,
  input: GiftDebtPageInput = {},
): Promise<ApiResult<GiftDebtList>> {
  const suffix = pageQuery(
    input.limit === undefined ? {} : { limit: input.limit },
    { debtCursor: input.debtCursor, giftCursor: input.giftCursor },
  );
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/gifts${suffix}`,
    { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined },
  );
}

export function createGift(
  personId: string,
  input: GiftCreateInput,
  workspaceId?: string,
): Promise<ApiResult<{ readonly gift: Gift; readonly status: "created" }>> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}/gifts`, {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function changeGiftStatus(
  personId: string,
  giftId: string,
  status: GiftStatus,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly gift: Gift; readonly status: "saved" | "unchanged" }>
> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/gifts/${
      encodeURIComponent(giftId)
    }/status`,
    {
      method: "PATCH",
      headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
      body: JSON.stringify({ status }),
    },
  );
}

export function createDebt(
  personId: string,
  input: DebtCreateInput,
  workspaceId?: string,
): Promise<ApiResult<{ readonly debt: Debt; readonly status: "created" }>> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}/debts`, {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function changeDebtStatus(
  personId: string,
  debtId: string,
  status: DebtStatus,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly debt: Debt; readonly status: "saved" | "unchanged" }>
> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/debts/${
      encodeURIComponent(debtId)
    }/status`,
    {
      method: "PATCH",
      headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
      body: JSON.stringify({ status }),
    },
  );
}
