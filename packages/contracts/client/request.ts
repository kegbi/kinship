/**
 * One fetch, one result.
 *
 * Every client function goes through `request`: it sends JSON, reads JSON, and
 * turns the two outcomes into one discriminated result, so a caller branches on
 * `ok` instead of on a status code. `ProblemDetails` is the published
 * `Problem` component: the client no longer keeps its own copy of that shape,
 * or of any other.
 */

import type { components } from "../generated/api-types.ts";

/** RFC 9457, as `apps/api/http/problem.ts` writes it. */
export type ProblemDetails = components["schemas"]["Problem"];

export type ApiResult<T> = { readonly ok: true; readonly value: T } | {
  readonly ok: false;
  readonly problem: ProblemDetails;
};

type RequestOptions = Omit<RequestInit, "headers"> & {
  readonly headers?: HeadersInit | undefined;
};

export async function request<T>(
  path: string,
  init?: RequestOptions,
): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await response.json() as T | ProblemDetails;
  return response.ok
    ? { ok: true, value: body as T }
    : { ok: false, problem: body as ProblemDetails };
}

export function workspaceHeader(workspaceId?: string): HeadersInit | undefined {
  return workspaceId ? { "X-Workspace-Id": workspaceId } : undefined;
}
