/**
 * The one description of a route.
 *
 * Until GAP-022 a route was written down three times: the Zod schema the
 * handler validated with, the OpenAPI literal the generator hand-encoded, and
 * the client function the generator printed as a template string. Nothing
 * compared the three, so a schema could tighten while the document kept
 * advertising the old shape and the drift check saw nothing — it only diffed
 * the generator against its own output.
 *
 * A `RouteDescriptor` is that single description. `defineRoute` returns one
 * after checking what a route can be wrong about on its own: the method, the
 * shape of the path, and whether every `{parameter}` in the path is declared.
 * `packages/http-kit/route.ts` mounts descriptors onto Hono, and
 * `tools/contracts/build.ts` reads the same descriptors to emit the document
 * and the client, so mounting and documenting cannot disagree.
 *
 * This module knows only Zod. The Hono binding lives beside the handlers it
 * serves, and the OpenAPI rendering lives in the generator, because a
 * descriptor is worth reading in a route file without either of them.
 */

import type { z } from "zod";

/** Every method the API answers on. */
export const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
] as const;

export type HttpMethod = typeof HTTP_METHODS[number];

/** Media type to the schema of the body carried under it. */
export type RouteContent = Readonly<Record<string, z.ZodType>>;

/** A request body: the media types it may arrive as, and whether it may be absent. */
export interface RouteBody {
  readonly required: boolean;
  readonly content: RouteContent;
}

/** One answer: the prose that names it, what it carries, and the headers it sets. */
export interface RouteResponse {
  readonly description: string;
  readonly content?: RouteContent;
  readonly headers?: z.ZodObject;
}

/**
 * Everything a request may carry.
 *
 * `params` is the path template's own parameters, `query` the query string as
 * one flat record, `headers` the named request headers, and `body` the
 * payload. Each is the schema the handler parses with, so the document cannot
 * advertise a shape the route does not enforce.
 */
export interface RouteRequest {
  readonly params?: z.ZodObject;
  readonly query?: z.ZodObject;
  readonly headers?: z.ZodObject;
  readonly body?: RouteBody;
}

/** One OpenAPI security requirement: a scheme name to the scopes it needs. */
export type SecurityRequirement = Readonly<Record<string, readonly string[]>>;

/** A route, as the app mounts it and the generator documents it. */
export interface RouteDescriptor {
  readonly method: HttpMethod;
  /** The OpenAPI template, `{personId}` and all. */
  readonly path: string;
  readonly operationId: string;
  /** Prose the published document carries about the operation as a whole. */
  readonly description?: string;
  readonly security?: readonly SecurityRequirement[];
  readonly request?: RouteRequest;
  readonly responses: Readonly<Record<string, RouteResponse>>;
  /**
   * Why a mounted route is absent from the published document. Only the
   * container probes set it: they are an operational surface, not part of the
   * versioned API, and `contracts:check` proves every other mounted route is
   * documented.
   */
  readonly undocumented?: string;
}

const PATH_PARAMETER = /\{([^}]*)\}/g;

/** The parameter names a path template declares, in the order it declares them. */
export function pathParameters(path: string): readonly string[] {
  return [...path.matchAll(PATH_PARAMETER)].map(([, name]) => name ?? "");
}

/** The same path, written the way Hono matches it. */
export function honoPath(path: string): string {
  return path.replace(PATH_PARAMETER, (_match, name: string) => `:${name}`);
}

/**
 * Declares one route.
 *
 * The checks here are the ones a descriptor can fail on its own, and they run
 * when the module is loaded rather than on the request that would have hit
 * them: a path that is not rooted, a parameter in the template that nothing
 * declares, a declared parameter the template never mentions, and an answer
 * under a status that is not a status.
 */
export function defineRoute<const Descriptor extends RouteDescriptor>(
  descriptor: Descriptor,
): Descriptor {
  const { operationId, path } = descriptor;
  if (!path.startsWith("/")) {
    throw new Error(`${operationId} must declare a rooted path, not ${path}`);
  }
  const declared = new Set(
    Object.keys(descriptor.request?.params?.shape ?? {}),
  );
  const templated = new Set(pathParameters(path));
  for (const name of templated) {
    if (!declared.has(name)) {
      throw new Error(
        `${operationId} leaves the path parameter ${name} undeclared`,
      );
    }
  }
  for (const name of declared) {
    if (!templated.has(name)) {
      throw new Error(
        `${operationId} declares the path parameter ${name}, which ${path} never names`,
      );
    }
  }
  for (const status of Object.keys(descriptor.responses)) {
    const code = Number(status);
    if (!Number.isInteger(code) || code < 100 || code > 599) {
      throw new Error(
        `${operationId} answers under ${status}, which is not an HTTP status`,
      );
    }
  }
  return descriptor;
}

/** Whether a media type is JSON: `application/json` or a `+json` suffix. */
export function isJsonMediaType(mediaType: string | undefined): boolean {
  const essence = mediaType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return essence === "application/json" ||
    /^application\/[^\s/]+\+json$/.test(essence);
}

/**
 * Whether a route takes its body as JSON and nothing else.
 *
 * Such a route answers 415 to a body of any other media type (SECA-13), so
 * `packages/http-kit/route.ts` enforces it and the generator documents it from
 * this one reading.
 */
export function takesJsonBody(route: RouteDescriptor): boolean {
  const media = Object.keys(route.request?.body?.content ?? {});
  return media.length > 0 && media.every(isJsonMediaType);
}

/**
 * The refusals the admission pipeline answers on a route's behalf (AUD-K1).
 *
 * A route that accepts `X-Workspace-Id` answers 400 to a value that is not a
 * workspace id, and a route that takes JSON answers 415 to any other body.
 * Neither is written in the route's own descriptor, because neither is about
 * the route; the generator documents them from here, and `apps/api/routes_test.ts`
 * proves every route that answers one of them is covered by this rule.
 */
export function admissionStatuses(route: RouteDescriptor): readonly number[] {
  return [
    ...("X-Workspace-Id" in (route.request?.headers?.shape ?? {}) ? [400] : []),
    ...(takesJsonBody(route) ? [415] : []),
  ];
}

/** `method path`, which is what identifies a route to both sides of the check. */
export function routeKey(route: RouteDescriptor): string {
  return `${route.method.toUpperCase()} ${honoPath(route.path)}`;
}

/**
 * Gathers the surfaces into one registry.
 *
 * Two routes may not share an operation id or a method and path: the first
 * would give the document two operations with one name, and the second would
 * leave the later mount unreachable behind the earlier one.
 */
export function collectRoutes(
  surfaces: readonly (readonly RouteDescriptor[])[],
): readonly RouteDescriptor[] {
  const routes = surfaces.flat();
  const operations = new Set<string>();
  const keys = new Set<string>();
  for (const route of routes) {
    if (operations.has(route.operationId)) {
      throw new Error(`two routes are named ${route.operationId}`);
    }
    operations.add(route.operationId);
    const key = routeKey(route);
    if (keys.has(key)) {
      throw new Error(`two routes answer ${key}`);
    }
    keys.add(key);
  }
  return routes;
}
