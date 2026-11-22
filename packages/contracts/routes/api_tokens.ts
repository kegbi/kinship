/**
 * Personal API tokens: every route of this surface, once.
 *
 * Each descriptor is what `apps/api` mounts and what
 * `tools/contracts/build.ts` documents. A route the document does not describe
 * fails `deno task contracts:check`, and one that is mounted and not here, or
 * here and never mounted, fails `apps/api/routes_test.ts`.
 */

import { z } from "zod";
import { defineRoute, type RouteDescriptor } from "../registry.ts";
import {
  originAndWorkspaceHeaders,
  problemResponses,
  workspaceHeaders,
} from "./common.ts";
import {
  apiTokenContext,
  apiTokenCreated,
  apiTokenCreateInput,
  apiTokenList,
  apiTokenRevoked,
} from "../schemas/api_tokens.ts";
import { uuid } from "../schemas/shared.ts";

export const getApiTokens = defineRoute({
  method: "get",
  path: "/api/v1/settings/api-tokens",
  operationId: "getApiTokens",
  security: [{ kinship_session: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description:
        "Every personal API token of the workspace, with its issuer, for an owner or administrator",
      content: {
        "application/json": apiTokenList,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const createApiToken = defineRoute({
  method: "post",
  path: "/api/v1/settings/api-tokens",
  operationId: "createApiToken",
  secrecy: "issues-secret",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": apiTokenCreateInput,
      },
    },
  },
  responses: {
    201: {
      description: "API token created; secret returned only once",
      content: {
        "application/json": apiTokenCreated,
      },
    },
    ...problemResponses(400, 401, 403, 503),
  },
});

export const revokeApiToken = defineRoute({
  method: "delete",
  path: "/api/v1/settings/api-tokens/{tokenId}",
  operationId: "revokeApiToken",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      tokenId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
  },
  responses: {
    200: {
      description: "API token revoked",
      content: {
        "application/json": apiTokenRevoked,
      },
    },
    ...problemResponses(401, 403, 404, 503),
  },
});

/**
 * What the presented token is and who it acts as (MCP-A1). It accepts any
 * valid personal token, so it names no `tokenScope`, and it never reads a
 * session cookie: without a valid bearer it answers 401.
 */
export const getTokenContext = defineRoute({
  method: "get",
  path: "/api/v1/me",
  operationId: "getTokenContext",
  description:
    "Accepts any valid personal token and requires no grant. Returns the presented token's id, name, scopes, and optional expiry, and the workspace, member, and current role it acts as. Never reads a session cookie; the optional X-Workspace-Id must match the token's workspace.",
  security: [{ kinship_api_token: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "The presented token and the membership it acts as",
      content: {
        "application/json": apiTokenContext,
      },
    },
    ...problemResponses(401, 403),
  },
});

/** Every api tokens route, in the order the surface mounts them. */
export const API_TOKENS_ROUTES: readonly RouteDescriptor[] = [
  getApiTokens,
  createApiToken,
  revokeApiToken,
  getTokenContext,
];
