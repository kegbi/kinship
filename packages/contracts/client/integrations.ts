/**
 * CalDAV and CardDAV subscriptions, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { request, workspaceHeader } from "./request.ts";
import type { DavSubscription, DavSubscriptionList } from "./types.ts";

export function getDavSubscriptions(
  workspaceId?: string,
): Promise<ApiResult<DavSubscriptionList>> {
  return request("/api/v1/settings/integrations/dav", {
    headers: workspaceHeader(workspaceId),
  });
}

export function createDavSubscription(
  input: {
    readonly name: string;
    readonly password: string;
    readonly remoteUrl: string;
    readonly username?: string;
  },
  workspaceId?: string,
): Promise<
  ApiResult<
    { readonly status: "configured"; readonly subscription: DavSubscription }
  >
> {
  return request("/api/v1/settings/integrations/dav", {
    method: "POST",
    headers: workspaceHeader(workspaceId),
    body: JSON.stringify(input),
  });
}

export function synchronizeDavSubscription(
  subscriptionId: string,
  workspaceId?: string,
): Promise<
  ApiResult<
    {
      readonly processed?: number;
      readonly status: "auth-failure" | "conflict" | "partial" | "success";
      readonly subscription: DavSubscription;
    }
  >
> {
  return request(
    `/api/v1/settings/integrations/dav/${
      encodeURIComponent(subscriptionId)
    }/sync`,
    { method: "POST", headers: workspaceHeader(workspaceId) },
  );
}

export function disableDavSubscription(
  subscriptionId: string,
  workspaceId?: string,
): Promise<
  ApiResult<
    { readonly status: "disabled"; readonly subscription: DavSubscription }
  >
> {
  return request(
    `/api/v1/settings/integrations/dav/${encodeURIComponent(subscriptionId)}`,
    { method: "DELETE", headers: workspaceHeader(workspaceId) },
  );
}
