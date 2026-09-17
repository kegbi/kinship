/**
 * Gifts and debts, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { request } from "./request.ts";
import type {
  Debt,
  DebtCreateInput,
  DebtStatus,
  Gift,
  GiftCreateInput,
  GiftDebtList,
  GiftStatus,
} from "./types.ts";

export function listPersonGifts(
  personId: string,
  workspaceId?: string,
): Promise<ApiResult<GiftDebtList>> {
  return request(`/api/v1/people/${encodeURIComponent(personId)}/gifts`, {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
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
