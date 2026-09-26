/**
 * Test support: the API a web suite talks to.
 *
 * `stubApi` replaces `fetch` for one test with a table of routes, each keyed
 * `"METHOD /path/:param"`. A request matches the first route whose method and
 * path template fit it; a template that carries a query (`?cursor=next`)
 * also requires those parameters. `*` as the method matches any method, and a
 * final `/*` segment matches the rest of the path, so `"* /api/v1/*"` is a
 * catch-all for a suite that answers from one handler. The answer is a `Response` (cloned for
 * every call, so one answer serves many), a promise of one, a handler given
 * the parsed request, or a list of those consumed one call at a time.
 *
 * Every call is recorded. A request no route answers — or a list answer
 * asked once too often — rejects, which an island folds into "unavailable",
 * so the stub also fails the test when it finishes. Either way `fetch` is
 * restored when the test ends; no suite restores it by hand.
 */

import { onTestFinished, vi } from "vitest";
import type { ProblemDetails } from "../../../../packages/contracts/generated/auth-client.ts";

/** A JSON answer, as the API writes it. */
export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
    status,
  });
}

/** The RFC 9457 body `packages/http-kit/problem.ts` writes. */
export function problemBody(
  status: number,
  fields: Partial<ProblemDetails> = {},
): ProblemDetails {
  return {
    code: "rejected",
    detail: "Private failure details",
    status,
    title: "Rejected",
    type: "about:blank",
    ...fields,
  };
}

/** A refused request: the problem body under `application/problem+json`. */
export function problemResponse(
  status: number,
  fields: Partial<ProblemDetails> = {},
): Response {
  return jsonResponse(problemBody(status, fields), status, {
    "content-type": "application/problem+json",
  });
}

/** A promise the test settles by hand, for an answer held back. */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

/** One request `fetch` received. */
export interface ApiRequest {
  readonly method: string;
  readonly url: URL;
  /** The route template's `:name` segments, decoded. */
  readonly params: Readonly<Record<string, string>>;
  readonly headers: Headers;
  /** The JSON body, parsed; `undefined` without one. */
  readonly body: unknown;
  readonly init: RequestInit | undefined;
}

export type ApiHandler = (
  request: ApiRequest,
) => Response | Promise<Response>;

export type ApiAnswer = Response | Promise<Response> | ApiHandler;

export type ApiRoutes = Readonly<
  Record<string, ApiAnswer | readonly ApiAnswer[]>
>;

export interface StubbedApi {
  /** Each request as `"METHOD /path?query"`, in order. */
  readonly calls: () => readonly string[];
  /** Each request, parsed. */
  readonly requests: () => readonly ApiRequest[];
  /** The JSON bodies the requests carried, in order. */
  readonly bodies: () => readonly unknown[];
  /** Adds a route ahead of the others for the rest of the test. */
  readonly route: (
    key: string,
    answer: ApiAnswer | readonly ApiAnswer[],
  ) => void;
  /** The `fetch` mock itself. */
  readonly fetch: ReturnType<typeof vi.fn>;
}

interface Route {
  readonly method: string;
  readonly path: RegExp;
  readonly names: readonly string[];
  readonly query: URLSearchParams;
  readonly answers: readonly ApiAnswer[];
  readonly repeat: boolean;
  used: number;
}

function compile(
  key: string,
  answer: ApiAnswer | readonly ApiAnswer[],
): Route {
  const match = /^([A-Z]+|\*) (\/[^?]*)(?:\?(.*))?$/.exec(key);
  if (!match) throw new Error(`stubApi: "${key}" is not "METHOD /path"`);
  const [, method, template, query] = match;
  const names: string[] = [];
  const source = template!.split("/").map((segment, index, all) => {
    if (segment === "*" && index === all.length - 1) return ".*";
    if (!segment.startsWith(":")) {
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    names.push(segment.slice(1));
    return "([^/]+)";
  }).join("/");
  const list = Array.isArray(answer);
  return {
    answers: list ? answer as readonly ApiAnswer[] : [answer as ApiAnswer],
    method: method!,
    names,
    path: new RegExp(`^${source}$`),
    query: new URLSearchParams(query ?? ""),
    repeat: !list,
    used: 0,
  };
}

function matches(
  route: Route,
  method: string,
  url: URL,
): Record<string, string> | undefined {
  if (route.method !== "*" && route.method !== method) return undefined;
  const found = route.path.exec(url.pathname);
  if (!found) return undefined;
  for (const [name, value] of route.query) {
    if (url.searchParams.get(name) !== value) return undefined;
  }
  return Object.fromEntries(
    route.names.map((name, index) => [
      name,
      decodeURIComponent(found[index + 1]!),
    ]),
  );
}

function parseBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") return init?.body ?? undefined;
  try {
    return JSON.parse(init.body);
  } catch {
    return init.body;
  }
}

async function answer(
  given: ApiAnswer,
  request: ApiRequest,
): Promise<Response> {
  const response = typeof given === "function"
    ? await given(request)
    : await given;
  return response.clone();
}

/** The line a call is recorded as: `"METHOD /path?query"`. */
function line(method: string, url: URL): string {
  return `${method} ${url.pathname}${url.search}`;
}

/** An answer that never arrives: the server could not be reached. */
export const unreachable: ApiHandler = () =>
  Promise.reject(new TypeError("Failed to fetch"));

let realFetch: typeof fetch | undefined;

/** Replaces `fetch` with `routes` until the test finishes. */
export function stubApi(routes: ApiRoutes = {}): StubbedApi {
  const table: Route[] = Object.entries(routes).map(([key, value]) =>
    compile(key, value)
  );
  const received: ApiRequest[] = [];
  const unmatched: string[] = [];
  const mock = vi.fn(
    (resource: string | URL | Request, init?: RequestInit) => {
      const sent = resource instanceof Request ? resource : undefined;
      const url = new URL(sent?.url ?? String(resource), "http://localhost");
      const method = (init?.method ?? sent?.method ?? "GET").toUpperCase();
      const request: Omit<ApiRequest, "params"> = {
        body: parseBody(init),
        headers: new Headers(init?.headers ?? sent?.headers),
        init,
        method,
        url,
      };
      for (const route of table) {
        const params = matches(route, method, url);
        if (!params) continue;
        const given = route.repeat
          ? route.answers[0]
          : route.answers[route.used];
        if (given === undefined) break;
        route.used += 1;
        const matched = { ...request, params };
        received.push(matched);
        return answer(given, matched);
      }
      received.push({ ...request, params: {} });
      unmatched.push(line(method, url));
      return Promise.reject(
        new Error(`stubApi: no route answers ${line(method, url)}`),
      );
    },
  );
  // A test that stubs twice still restores the `fetch` it started with.
  realFetch ??= globalThis.fetch;
  globalThis.fetch = mock as unknown as typeof fetch;
  onTestFinished(() => {
    if (realFetch) globalThis.fetch = realFetch;
    realFetch = undefined;
    if (unmatched.length > 0) {
      throw new Error(`stubApi: no route answered ${unmatched.join(", ")}`);
    }
  });
  return {
    bodies: () =>
      received.flatMap(({ body }) => body === undefined ? [] : [body]),
    calls: () => received.map(({ method, url }) => line(method, url)),
    fetch: mock,
    requests: () => received,
    route: (key, value) => {
      table.unshift(compile(key, value));
    },
  };
}
