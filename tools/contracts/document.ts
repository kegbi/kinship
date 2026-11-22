/**
 * The OpenAPI document, rendered from the route registry.
 *
 * `tools/contracts/generate.ts` used to hand-encode all of this: 8,127 lines
 * of object literals that repeated, in a second dialect, what the route files
 * had already said in Zod. Nothing compared the two, so the document could
 * describe a shape the API no longer accepted and the drift check — which only
 * diffed the generator against its own output — stayed green. GAP-022 deleted
 * that file. What is left here walks `DOCUMENTED_ROUTES` and asks `zod-openapi`
 * to render the schemas the routes actually parse with.
 *
 * `normalise` is the one piece of judgement. Zod's JSON Schema is faithful but
 * chatty: it prints the safe-integer bounds of every unbounded integer, the
 * regular expression behind every named format, the key type of every record,
 * and the type a `const` already implies. None of that constrains a client,
 * none of it appeared in the document this replaced, and all of it would bury
 * the parts that do. The marker `EXACTLY_ONE` is read here too: a union that
 * means exactly one of its options becomes `oneOf`, which is what the
 * hand-written document said and what `packages/contracts` cannot say for
 * itself without importing a generator into the running API.
 */

import { createDocument } from "zod-openapi";
import type { z } from "zod";
import { DOCUMENTED_ROUTES } from "../../packages/contracts/routes/mod.ts";
import {
  admissionStatuses,
  type RouteDescriptor,
  type RouteResponse,
} from "../../packages/contracts/registry.ts";
import { problemResponse } from "../../packages/contracts/routes/common.ts";
import { EXACTLY_ONE } from "../../packages/contracts/schemas/shared.ts";
import { invitationToken } from "../../packages/contracts/schemas/invitations.ts";

/** How a caller proves who they are, as the published document names it. */
export const SECURITY_SCHEMES = {
  kinship_entry: {
    type: "apiKey",
    in: "cookie",
    name: "kinship_entry",
    description:
      "One-time HttpOnly browser handoff; SameSite=Strict and Secure outside loopback.",
  },
  kinship_invitation: {
    type: "apiKey",
    in: "cookie",
    name: "kinship_invitation",
    description:
      "Pending invitation authority scoped to invitation API transitions; HttpOnly, SameSite=Strict, and Secure outside loopback.",
  },
  kinship_mfa: {
    type: "apiKey",
    in: "cookie",
    name: "kinship_mfa",
    description:
      "Short-lived HttpOnly, SameSite=Strict MFA challenge; not an authenticated session.",
  },
  kinship_session: {
    type: "apiKey",
    in: "cookie",
    name: "__Host-kinship_session",
    description:
      "Revocable random browser session; HttpOnly, SameSite=Strict, Secure, Path=/, and host-only. A loopback deployment over plain HTTP names it kinship_session. A request carrying more than one is unauthenticated.",
  },
  kinship_api_token: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "kin_pat",
    description:
      "Workspace-bound personal API token accepted only for explicitly granted first-party scopes.",
  },
} as const;

/**
 * The one component nothing references.
 *
 * `InvitationToken` is the required-token body the invitation flow was
 * documented with before the optional form replaced it at every call site. It
 * stays published because removing a component from a released document is a
 * decision for the invitation surface to make, not a side effect of changing
 * how the document is produced.
 */
const UNREFERENCED_COMPONENTS = { InvitationToken: invitationToken };

const SAFE_INTEGER_BOUND = 9_007_199_254_740_991;

const PATTERNED_FORMATS = new Set(["uuid", "email", "date-time", "date"]);

type JsonSchema = Record<string, unknown>;

/**
 * Drops what JSON Schema already implies, and reads the `oneOf` marker.
 *
 * Every rule here removes a keyword that constrains nothing a client can act
 * on. Nothing is added, and no rule can change which values an operation
 * accepts or produces.
 */
export function normalise(jsonSchema: JsonSchema): void {
  if (jsonSchema[EXACTLY_ONE] === true) {
    delete jsonSchema[EXACTLY_ONE];
    if (jsonSchema.anyOf) {
      jsonSchema.oneOf = jsonSchema.anyOf;
      delete jsonSchema.anyOf;
    }
  }
  if (jsonSchema.type === "integer") {
    if (jsonSchema.minimum === -SAFE_INTEGER_BOUND) delete jsonSchema.minimum;
    if (jsonSchema.maximum === SAFE_INTEGER_BOUND) delete jsonSchema.maximum;
  }
  if (
    typeof jsonSchema.format === "string" &&
    PATTERNED_FORMATS.has(jsonSchema.format)
  ) {
    delete jsonSchema.pattern;
  }
  if (jsonSchema.propertyNames && jsonSchema.additionalProperties) {
    delete jsonSchema.propertyNames;
  }
  if (jsonSchema.const !== undefined) {
    delete jsonSchema.type;
  }
  const properties = jsonSchema.properties;
  if (
    jsonSchema.type === "object" && properties !== null &&
    typeof properties === "object" &&
    Object.keys(properties).length === 0 && jsonSchema.required === undefined
  ) {
    delete jsonSchema.properties;
  }
}

function content(
  media: Readonly<Record<string, z.ZodType>>,
): Record<string, { schema: z.ZodType }> {
  return Object.fromEntries(
    Object.entries(media).map(([type, schema]) => [type, { schema }]),
  );
}

/**
 * A route's own answers, plus the refusals the admission pipeline gives on
 * its behalf where the route does not already name that status.
 */
function answers(
  route: RouteDescriptor,
): Readonly<Record<string, RouteResponse>> {
  return {
    ...Object.fromEntries(
      admissionStatuses(route).map((
        status,
      ) => [String(status), problemResponse]),
    ),
    ...route.responses,
  };
}

function operation(route: RouteDescriptor): Record<string, unknown> {
  const request = route.request;
  const parameters: Record<string, z.ZodObject> = {};
  if (request?.params) parameters.path = request.params;
  if (request?.query) parameters.query = request.query;
  if (request?.headers) parameters.header = request.headers;
  return {
    operationId: route.operationId,
    ...(route.description ? { description: route.description } : {}),
    ...(route.security ? { security: route.security } : {}),
    // The one scope a personal token needs here (MCP-A1), machine-readable
    // for clients and the tool catalog; the prose says it in words.
    ...(route.tokenScope ? { "x-kinship-token-scope": route.tokenScope } : {}),
    ...(Object.keys(parameters).length > 0
      ? { requestParams: parameters }
      : {}),
    ...(request?.body
      ? {
        requestBody: {
          required: request.body.required,
          content: content(request.body.content),
        },
      }
      : {}),
    responses: Object.fromEntries(
      Object.entries(answers(route)).map(([status, response]) => [
        status,
        {
          description: response.description,
          ...(response.headers ? { headers: response.headers } : {}),
          ...(response.content ? { content: content(response.content) } : {}),
        },
      ]),
    ),
  };
}

/**
 * Builds the document.
 *
 * Paths and components come out in alphabetical order, which no route file
 * has to maintain and which keeps a later change to the mounted order from
 * rewriting the committed artefact.
 */
export function buildOpenApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of [...DOCUMENTED_ROUTES].sort(comparePaths)) {
    (paths[route.path] ??= {})[route.method] = operation(route);
  }
  const document = createDocument({
    openapi: "3.1.0",
    info: { title: "Kinship API", version: "1.0.0" },
    paths,
    components: {
      securitySchemes: SECURITY_SCHEMES,
      schemas: UNREFERENCED_COMPONENTS,
    },
    // deno-lint-ignore no-explicit-any
  } as any, {
    override: ({ jsonSchema }) => {
      normalise(jsonSchema as JsonSchema);
    },
  }) as unknown as Record<string, unknown>;
  return sortComponents(statedParameters(document));
}

/**
 * Says of every parameter whether it is required.
 *
 * `required` defaults to false, so `zod-openapi` leaves it out for an optional
 * parameter. The document this replaced stated it, and a reader should not
 * have to know the default to know whether a header is expected.
 */
function statedParameters(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const paths = document.paths as Record<string, Record<string, unknown>>;
  for (const operations of Object.values(paths)) {
    for (const operation of Object.values(operations)) {
      const parameters =
        (operation as { parameters?: Record<string, unknown>[] }).parameters;
      for (const parameter of parameters ?? []) {
        parameter.required ??= false;
        const schema = parameter.schema as Record<string, unknown> | undefined;
        if (schema && schema.description === parameter.description) {
          delete schema.description;
        }
      }
    }
  }
  return document;
}

function comparePaths(left: RouteDescriptor, right: RouteDescriptor): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function sortComponents(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const components = document.components as
    | { schemas?: Record<string, unknown> }
    | undefined;
  if (!components?.schemas) return document;
  const sorted = Object.fromEntries(
    Object.entries(components.schemas).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    ),
  );
  return { ...document, components: { ...components, schemas: sorted } };
}
