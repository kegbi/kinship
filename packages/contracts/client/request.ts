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

/** RFC 9457, as `packages/http-kit/problem.ts` writes it. */
export type ProblemDetails = components["schemas"]["Problem"];

export type ApiResult<T> = { readonly ok: true; readonly value: T } | {
  readonly ok: false;
  readonly problem: ProblemDetails;
};

type RequestOptions = Omit<RequestInit, "headers"> & {
  readonly headers?: HeadersInit | undefined;
};

/** The reads already on the wire, by path, query, and workspace. */
const inFlight = new Map<string, Promise<ApiResult<unknown>>>();

/**
 * Identical concurrent reads share one fetch.
 *
 * Several islands on one page ask for the same resource at once (FEQ-01). A
 * read joins the one already on the wire for its path, query, and workspace,
 * and every caller receives its own `structuredClone`, so one caller changing
 * its answer cannot change another's. The entry leaves when the read settles,
 * so a later read is always a new request.
 *
 * Writes are never shared, and a write forgets every read on the wire both
 * when it is sent and when it settles: a read asked for after a write may be
 * the refresh that write calls for, and must not receive an answer the server
 * wrote before it.
 */
export async function request<T>(
  path: string,
  init?: RequestOptions,
): Promise<ApiResult<T>> {
  if ((init?.method ?? "GET") !== "GET") {
    inFlight.clear();
    try {
      return await send<T>(path, init);
    } finally {
      inFlight.clear();
    }
  }
  const workspace = new Headers(init?.headers).get("X-Workspace-Id") ?? "";
  const key = `${path} ${workspace}`;
  let shared = inFlight.get(key);
  if (!shared) {
    const read = send(path, init).finally(() => {
      if (inFlight.get(key) === read) inFlight.delete(key);
    });
    inFlight.set(key, shared = read);
  }
  return structuredClone(await shared) as ApiResult<T>;
}

/**
 * One fetch. `no-store` because the API forbids caching these answers anyway,
 * and Chromium otherwise queues identical concurrent GETs behind one cache
 * entry, one round trip each.
 */
async function send<T>(
  path: string,
  init?: RequestOptions,
): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
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

/**
 * The `?cursor=…&limit=…` suffix every list call appends.
 *
 * A first page names neither, so the suffix is empty and the URL is the plain
 * collection path — which is what keeps the calls that never paged spelled the
 * way they always were.
 */
export function pageQuery(
  input: { readonly cursor?: string; readonly limit?: number } = {},
  extra: Readonly<Record<string, string | undefined>> = {},
): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(extra)) {
    if (value) query.set(name, value);
  }
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.limit) query.set("limit", String(input.limit));
  return query.size > 0 ? `?${query.toString()}` : "";
}
