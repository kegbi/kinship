/**
 * One agent tool, declared over one route (ADR 0009, MCP-C1).
 *
 * A tool is a route as an agent sees it: a name, prose written for a model,
 * the route it calls, hints about what calling it does, and one flat argument
 * object. `defineTool` derives that object from the route's own schemas —
 * path parameters, query parameters, and, when the JSON body is a plain
 * object, its properties — and records where each argument goes, so the
 * endpoint can rebuild the route's request without knowing anything about the
 * route. The route stays the authority: its parse, its admission, and its use
 * case decide every call, and the argument schema is only what lets an agent
 * correct itself before it asks.
 *
 * Six declarations change the derived shape:
 *
 * - `body` and `fixed` serve a union body one member at a time. MCP requires
 *   an argument schema whose root is a plain object, so a tool names the
 *   member it sends and fixes its discriminator (`record_note` is the note
 *   member of `recordInteraction` with `kind` fixed to `note`). A fixed value
 *   may also be a path parameter, and then serves the path and any body member
 *   of the same name (`add_pet` fixes `section` to `pets` in both).
 * - `aliases` sends one argument again under a second name, where a route
 *   repeats a path value in its body under another one (`update_pet` sends
 *   `factId` as the body's `id`).
 * - `omit` leaves out an optional body member this tool never sends
 *   (`archive_people` names no tag).
 * - `require` makes an optional member required where this tool always sends
 *   it, because the route demands it for this tool's fixed values
 *   (`add_tag_to_people` must name the tag the route makes optional only for
 *   archiving and restoring).
 * - `minted` names arguments the endpoint fills in when the agent leaves them
 *   out — today only a `requestId` retry key. The description tells the agent
 *   to pass its own and reuse it, because a minted key cannot be retried.
 *
 * Everything a declaration can get wrong is refused when the module loads,
 * the way `defineRoute` refuses a descriptor. This module knows Zod and the
 * registry and nothing else: no protocol library and no HTTP framework.
 */

import { z } from "zod";
import {
  acceptsToken,
  type HttpMethod,
  isJsonMediaType,
  type RouteDescriptor,
  takesJsonBody,
} from "../registry.ts";
import { MCP_PATH } from "../routes/mcp.ts";

/** Which part of the route's request an argument travels in. */
export type ToolLocation = "path" | "query" | "body";

/** A value a tool may fix in its body. */
export type ToolValue = string | number | boolean | null;

/** What the endpoint mints for an argument the agent left out. */
export type MintedInput = "uuid";

/** The MCP tool annotations, each stated rather than left to a default. */
export interface ToolHints {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

/** What a tool declaration says. */
export interface ToolSpec {
  /** snake_case `verb_noun`, unique across the catalog. */
  readonly name: string;
  readonly title: string;
  /**
   * Written for an agent: what the tool does, what to read first, which
   * arguments make a retry or an edit safe, and notable side effects.
   */
  readonly description: string;
  readonly route: RouteDescriptor;
  /** Overrides the hints the route's method implies. */
  readonly annotations?: Partial<ToolHints>;
  /** The member of a union JSON body this tool sends. */
  readonly body?: z.ZodObject;
  /**
   * Request members this tool sends with a value of its own: a union body's
   * discriminator, or a path parameter together with any body member of the
   * same name.
   */
  readonly fixed?: Readonly<Record<string, ToolValue>>;
  /**
   * Request members that carry another argument's value, keyed by the member:
   * `{ id: "factId" }` sends the `factId` argument as the body's `id` too.
   */
  readonly aliases?: Readonly<Record<string, string>>;
  /** Optional body members this tool never sends. */
  readonly omit?: readonly string[];
  /**
   * Optional arguments this tool always sends, so its input requires them:
   * the route accepts them as optional because another tool of the same route
   * leaves them out.
   */
  readonly require?: readonly string[];
  /** Arguments the endpoint mints when the agent leaves them out. */
  readonly minted?: Readonly<Record<string, MintedInput>>;
  /**
   * Arguments more than one part of the request takes, declared to carry the
   * same value in each (a route that repeats a path value in its body).
   */
  readonly shared?: readonly string[];
}

/** A tool, as the endpoint serves it. */
export interface AgentTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly route: RouteDescriptor;
  readonly annotations: ToolHints;
  /** The token scope the route requires; absent when any token may call it. */
  readonly scope: string | undefined;
  /** The agent's flat argument object. */
  readonly input: z.ZodObject;
  /**
   * Where each request member goes — an argument, a fixed value, or an alias —
   * listing every part of the request that takes it.
   */
  readonly locations: Readonly<Record<string, readonly ToolLocation[]>>;
  readonly fixed: Readonly<Record<string, ToolValue>>;
  /** Request members sent with another argument's value, keyed by member. */
  readonly aliases: Readonly<Record<string, string>>;
  readonly minted: Readonly<Record<string, MintedInput>>;
}

const CLOSED_WORLD = { openWorldHint: false } as const;

/** What each method implies about calling a route, before any override. */
const METHOD_HINTS: Readonly<Record<HttpMethod, ToolHints>> = {
  get: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    ...CLOSED_WORLD,
  },
  post: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    ...CLOSED_WORLD,
  },
  patch: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    ...CLOSED_WORLD,
  },
  put: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    ...CLOSED_WORLD,
  },
  delete: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    ...CLOSED_WORLD,
  },
};

/** What an agent is told about an argument the endpoint can mint. */
export const MINTED_DESCRIPTIONS: Readonly<Record<MintedInput, string>> = {
  uuid:
    "Retry key, a UUID v4 you generate. Pass your own and reuse the same value when you retry this exact call, so a retry returns the original record instead of creating a second one; a changed payload under the same key is refused as a conflict. Left out, the server mints one and the call cannot be safely retried.",
};

const TOOL_NAME = /^[a-z]+(?:_[a-z]+)+$/;

/**
 * The JSON type and format a member is sent as, which an alias's source must
 * share with its target: a uuid argument cannot fill a member that takes a
 * name, and a free string cannot fill a uuid.
 */
function wireKind(member: z.ZodType): string {
  const json = z.toJSONSchema(member, {
    io: "input",
    unrepresentable: "any",
  }) as { type?: unknown; format?: unknown };
  return `${String(json.type)}:${String(json.format ?? "")}`;
}

/** The object a tool's body is built from, or nothing when it sends none. */
function bodyObject(
  spec: ToolSpec,
  fail: (reason: string) => never,
): z.ZodObject | undefined {
  const { route } = spec;
  const content = route.request?.body?.content;
  if (content === undefined) {
    if (spec.body !== undefined) fail("declares a body its route never takes");
    return undefined;
  }
  if (!takesJsonBody(route)) {
    fail(`targets ${route.operationId}, whose body is not JSON`);
  }
  const schema = Object.entries(content).find(([media]) =>
    isJsonMediaType(media)
  )?.[1];
  if (spec.body !== undefined) {
    const members: readonly unknown[] = schema instanceof z.ZodUnion
      ? schema.options
      : [schema];
    if (!members.includes(spec.body)) {
      fail(`declares a body that is not one of ${route.operationId}'s`);
    }
    return spec.body;
  }
  if (!(schema instanceof z.ZodObject)) {
    fail(
      `targets ${route.operationId}, whose body is not one object; declare the member it sends`,
    );
  }
  return schema;
}

/**
 * Declares one tool.
 *
 * The refusals are the ones a tool can earn on its own: a name that is not a
 * `verb_noun`, no title or description, a route that admits no personal
 * token, a body that is not JSON, the endpoint itself, an argument two parts
 * of the request take without being declared the same value, a fixed value a
 * part of the request refuses, an alias of something that is not an argument,
 * an alias whose source is sent as another type or format than its target,
 * an omitted member the body requires, a required member that is fixed,
 * aliased, minted, or already required, and a fixed, aliased, omitted,
 * required, or minted member the request does not take.
 */
export function defineTool(spec: ToolSpec): AgentTool {
  const { name, route } = spec;
  const fail: (reason: string) => never = (reason) => {
    throw new Error(`tool ${name} ${reason}`);
  };
  if (!TOOL_NAME.test(name)) fail("must be a snake_case verb_noun name");
  if (spec.title.trim() === "" || spec.description.trim() === "") {
    fail("needs a title and a description");
  }
  if (route.path === MCP_PATH) fail("cannot call the MCP endpoint itself");
  if (!acceptsToken(route)) {
    fail(`targets ${route.operationId}, which admits no personal token`);
  }

  const body = bodyObject(spec, fail);
  const omitted = new Set(spec.omit ?? []);
  for (const field of omitted) {
    const member = body?.shape[field] as z.ZodType | undefined;
    if (member === undefined) {
      fail(`omits ${field}, which its body never takes`);
    }
    if (!member.safeParse(undefined).success) {
      fail(`omits ${field}, which its body requires`);
    }
  }

  const parts: readonly (readonly [ToolLocation, z.ZodRawShape])[] = [
    ["path", route.request?.params?.shape ?? {}],
    ["query", route.request?.query?.shape ?? {}],
    ["body", body?.shape ?? {}],
  ];
  const locations: Record<string, ToolLocation[]> = {};
  const schemas: Record<string, z.ZodType[]> = {};
  for (const [location, shape] of parts) {
    for (const [field, member] of Object.entries(shape)) {
      if (location === "body" && omitted.has(field)) continue;
      (locations[field] ??= []).push(location);
      (schemas[field] ??= []).push(member as z.ZodType);
    }
  }

  const fixed = spec.fixed ?? {};
  for (const [field, value] of Object.entries(fixed)) {
    const taken = schemas[field];
    if (taken === undefined) {
      fail(`fixes ${field}, which its request never takes`);
    }
    if (!taken.every((member) => member.safeParse(value).success)) {
      fail(`fixes ${field} to a value its request refuses`);
    }
  }

  const aliases = spec.aliases ?? {};
  const derived = new Set([...Object.keys(fixed), ...Object.keys(aliases)]);
  for (const [member, source] of Object.entries(aliases)) {
    if (!(member in locations)) {
      fail(`aliases ${member}, which its request never takes`);
    }
    if (member in fixed) fail(`both fixes and aliases ${member}`);
    if (!(source in locations) || derived.has(source)) {
      fail(`aliases ${member} to ${source}, which is not an argument`);
    }
    const kind = wireKind(schemas[source]![0]!);
    if (!schemas[member]!.every((target) => wireKind(target) === kind)) {
      fail(`aliases ${member} to ${source}, which is sent as another type`);
    }
  }

  const shared = new Set(spec.shared ?? []);
  for (const [field, taken] of Object.entries(locations)) {
    if (derived.has(field)) continue;
    if (taken.length > 1 && !shared.has(field)) {
      fail(
        `takes ${field} in both the ${
          taken.join(" and the ")
        }; declare it shared when the values are the same`,
      );
    }
  }
  for (const field of shared) {
    if ((locations[field]?.length ?? 0) < 2 || derived.has(field)) {
      fail(`declares ${field} shared, but one part of the request takes it`);
    }
  }

  const members: Record<string, z.ZodType> = {};
  for (const [field, taken] of Object.entries(schemas)) {
    if (!derived.has(field)) members[field] = taken[0]!;
  }
  const minted = spec.minted ?? {};
  for (const field of spec.require ?? []) {
    if (derived.has(field) || field in minted) {
      fail(`requires ${field}, which it fixes, aliases, or mints`);
    }
    const member = members[field];
    if (member === undefined) fail(`requires ${field}, which it never sends`);
    if (!member.safeParse(undefined).success) {
      fail(`requires ${field}, which is already required`);
    }
    members[field] = member.nonoptional();
  }
  for (const [field, kind] of Object.entries(minted)) {
    const member = members[field];
    if (member === undefined) fail(`mints ${field}, which it never sends`);
    members[field] = member.optional().meta({
      description: MINTED_DESCRIPTIONS[kind],
    });
  }

  return {
    name,
    title: spec.title,
    description: spec.description,
    route,
    annotations: { ...METHOD_HINTS[route.method], ...spec.annotations },
    scope: route.tokenScope,
    input: z.strictObject(members),
    locations,
    fixed,
    aliases,
    minted,
  };
}

/**
 * A tool's arguments as the JSON Schema an MCP client lists: the one
 * conversion the endpoint and the generated catalog both use, so the two
 * cannot describe a tool differently.
 */
export function inputJsonSchema(input: z.ZodObject): Record<string, unknown> {
  return z.toJSONSchema(input, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
}
