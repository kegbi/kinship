/**
 * A valid request for any route the registry describes (AUD-K5).
 *
 * The default-deny sweep and the role table both have to reach a route's
 * authorization decision, and a route that validates its body before it asks
 * who is calling would answer 400 to a made-up body and hide that decision.
 * So every request here is built from the route's own descriptor: each path
 * parameter, required query parameter, required header, and body is sampled
 * from the schema the handler parses with, and the sample is parsed back with
 * that schema before it is sent. A route whose schema the sampler cannot
 * satisfy takes a hand-written value from `OVERRIDES`, and a sample that still
 * does not parse fails the suite rather than probing with an invalid request.
 *
 * This mirrors the generator of the 2026-11-07 audit
 * (`docs/validation/audit-2026-11-07/03-security-authentication-and-edge.md`,
 * "Reproduction"), which built the same requests from the same registry.
 */

import { z } from "zod";
import type { RouteDescriptor } from "../../packages/contracts/registry.ts";
import { isJsonMediaType } from "../../packages/contracts/registry.ts";
import { uuid } from "../../packages/backend/testing/fixtures.ts";
import type { ApiServices } from "./composition.ts";

/** The origin every sampled write sends; the suites configure the same one. */
export const SAMPLE_ORIGIN = "http://localhost";

/** One request, ready for `app.request(path, init)`. */
export interface SampledRequest {
  readonly path: string;
  readonly init: RequestInit & { readonly headers: Record<string, string> };
}

// deno-lint-ignore no-explicit-any
type JsonSchema = any;

/**
 * Hand-written values where a schema is not enough to sample from: the
 * refinements and cross-field rules JSON Schema does not carry. Keyed by
 * operation id; each part replaces the sampled one.
 */
const INSTANT = "2026-01-02T03:04:05.000Z";
const ADDRESS = {
  city: "Paris",
  expectedPersonUpdatedAt: INSTANT,
  isPrimary: true,
  labelIds: [],
  section: "addresses",
};
const OVERRIDES: Readonly<
  Record<string, {
    readonly body?: unknown;
    readonly params?: Readonly<Record<string, string>>;
  }>
> = {
  // Each of these refines its object to "at least one change".
  changeTask: { body: { expectedUpdatedAt: INSTANT, title: "Ada" } },
  updateReminder: { body: { expectedUpdatedAt: INSTANT, title: "Ada" } },
  saveMemberUiState: { body: { theme: "dark" } },
  updateRecurringDebt: { body: { active: true } },
  updateNote: { body: { body: "Ada", expectedUpdatedAt: INSTANT } },
  updateActivity: { body: { expectedUpdatedAt: INSTANT, summary: "Ada" } },
  updateCall: { body: { content: "Ada", expectedUpdatedAt: INSTANT } },
  updateConversation: { body: { expectedUpdatedAt: INSTANT, title: "Ada" } },
  updateGift: { body: { expectedUpdatedAt: INSTANT, name: "Ada" } },
  updateDebt: { body: { expectedUpdatedAt: INSTANT, reason: "Ada" } },
  // Unions the sampler cannot choose a member of on its own.
  updatePersonalizationEntry: {
    body: { expectedUpdatedAt: INSTANT, name: "Ada" },
  },
  createProfileFact: { body: ADDRESS, params: { section: "addresses" } },
  updateProfileFact: {
    body: { ...ADDRESS, expectedUpdatedAt: INSTANT, id: uuid(1) },
    params: { section: "addresses" },
  },
};

/** A value the schema accepts, or `undefined` when it has nothing to offer. */
function sample(schema: JsonSchema, defs: Record<string, JsonSchema>): unknown {
  if (schema === undefined || schema === true) return "sample";
  if (schema.$ref) {
    return sample(defs[String(schema.$ref).split("/").pop() ?? ""], defs);
  }
  if ("const" in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  if ("default" in schema && schema.default !== undefined) {
    return schema.default;
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    if (schema[key]) {
      const options = (schema[key] as JsonSchema[]).filter((option) =>
        option.type !== "null"
      );
      return sample(options[0], defs);
    }
  }
  if (schema.allOf) {
    return Object.assign(
      {},
      ...(schema.allOf as JsonSchema[]).map((part) => sample(part, defs)),
    );
  }
  const type = Array.isArray(schema.type)
    ? schema.type.find((name: string) => name !== "null")
    : schema.type;
  switch (type) {
    case "object":
      return Object.fromEntries(
        ((schema.required ?? []) as string[]).map((name) => [
          name,
          sample(schema.properties?.[name], defs),
        ]),
      );
    case "array":
      return Array.from(
        { length: Math.max(1, schema.minItems ?? 1) },
        (_, index) => {
          const item = sample(schema.items, defs);
          return typeof item === "string" && schema.uniqueItems
            ? uniqueString(item, index)
            : item;
        },
      );
    case "integer":
    case "number":
      return Math.max(schema.minimum ?? 1, (schema.exclusiveMinimum ?? 0) + 1);
    case "boolean":
      return true;
    case "string":
      return sampleString(schema);
    default:
      return "sample";
  }
}

/** A second, distinct value for an array that must not repeat itself. */
function uniqueString(value: string, index: number): string {
  if (index === 0) return value;
  return /^[0-9a-f-]{36}$/.test(value) ? uuid(9000 + index) : value + index;
}

/** The string candidates the formats and patterns of this API accept. */
function sampleString(schema: JsonSchema): string {
  switch (schema.format) {
    case "uuid":
      return uuid(1);
    case "email":
      return "ada@example.com";
    case "date-time":
      return INSTANT;
    case "date":
      return "2026-01-02";
    case "time":
      return "09:30:00";
    case "uri":
    case "url":
      return "https://example.com/";
  }
  const candidates = [
    "Ada",
    "2026-01-02",
    "09:30",
    "en",
    "UTC",
    "Europe/Paris",
    "EUR",
    "terms",
    "kin_pat_00000000-0000-4000-8000-000000000001.AAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "0123456789abcdef".repeat(4),
    "kin_cal_00000000-0000-4000-8000-000000000001.AAAAAAAAAAAAAAAAAAAAAA.ics",
    "123456",
    "a.ics",
  ];
  const pattern = schema.pattern ? new RegExp(schema.pattern) : undefined;
  const min = schema.minLength ?? 1;
  const max = schema.maxLength ?? Infinity;
  const fits = (value: string) =>
    value.length >= min && value.length <= max &&
    (!pattern || pattern.test(value));
  return candidates.find(fits) ?? "a".repeat(min);
}

/** A sample of one Zod schema, parsed back with that schema. */
function sampleOf(
  operationId: string,
  part: string,
  schema: z.ZodType,
  override?: unknown,
): unknown {
  const value = override ?? (() => {
    const json = z.toJSONSchema(schema, {
      io: "input",
      unrepresentable: "any",
    }) as JsonSchema;
    return sample(json, json.$defs ?? json.definitions ?? {});
  })();
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `${operationId}: the sampled ${part} does not parse: ${
        JSON.stringify(value)
      } (${parsed.error.message})`,
    );
  }
  return value;
}

/** Whether a schema accepts leaving its value out. */
function optional(schema: z.ZodType): boolean {
  return schema.safeParse(undefined).success;
}

/** The required members of an object schema, each sampled. */
function requiredMembers(
  operationId: string,
  part: string,
  schema: z.ZodObject | undefined,
): Record<string, string> {
  const members: Record<string, string> = {};
  for (const [name, member] of Object.entries(schema?.shape ?? {})) {
    if (optional(member as z.ZodType)) continue;
    members[name] = String(
      sampleOf(operationId, `${part} ${name}`, member as z.ZodType),
    );
  }
  return members;
}

/**
 * A valid request for this route: what its descriptor says it takes, with
 * the configured `Origin` on every unsafe method.
 */
export function sampleRequest(route: RouteDescriptor): SampledRequest {
  const { operationId } = route;
  const override = OVERRIDES[operationId] ?? {};
  const params = route.request?.params;
  const path = route.path.replace(
    /\{([^}]+)\}/g,
    (_match, name: string) =>
      encodeURIComponent(
        String(
          sampleOf(
            operationId,
            `path ${name}`,
            params?.shape[name] as z.ZodType,
            override.params?.[name],
          ),
        ),
      ),
  );
  const query = new URLSearchParams(
    requiredMembers(operationId, "query", route.request?.query),
  ).toString();
  const headers: Record<string, string> = {
    ...requiredMembers(operationId, "header", route.request?.headers),
  };
  if (route.method !== "get") headers.Origin = SAMPLE_ORIGIN;

  const content = route.request?.body?.content ?? {};
  const mediaTypes = Object.keys(content);
  let body: string | undefined;
  const json = mediaTypes.find(isJsonMediaType);
  if (json) {
    headers["content-type"] = json;
    body = JSON.stringify(
      sampleOf(
        operationId,
        "body",
        content[json] as z.ZodType,
        override.body,
      ),
    );
  } else if (mediaTypes.length > 0) {
    const media = mediaTypes.includes("text/plain")
      ? "text/plain"
      : mediaTypes[0] as string;
    headers["content-type"] = media;
    body = "sample";
  }
  return {
    path: query ? `${path}?${query}` : path,
    init: {
      method: route.method.toUpperCase(),
      headers,
      ...(body === undefined ? {} : { body }),
    },
  };
}

/**
 * Something every optional service can be.
 *
 * `createApiApp` mounts a surface when the services it needs are present, so a
 * value that answers to any property mounts all of them. A factory captures
 * what it is given and only reaches into it on a request; a request that does
 * reach it gets the stub back, which no route can turn into a 401.
 */
export function everything(): unknown {
  // deno-lint-ignore no-explicit-any
  const stub: any = new Proxy(function () {}, {
    get: (_target, property) => (property === "then" ? undefined : stub),
    apply: () => stub,
    construct: () => stub,
    has: () => true,
  });
  return stub;
}

/** The stand-in services, with the named ones replaced. */
export function servicesWith(overrides: Record<string, unknown>): ApiServices {
  const base = everything() as ApiServices;
  return new Proxy(base, {
    get: (target, property) =>
      property in overrides
        ? Reflect.get(overrides, property)
        : Reflect.get(target, property),
  });
}
