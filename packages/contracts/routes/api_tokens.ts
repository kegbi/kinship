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
      description: "Personal API token metadata",
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

/** Every api tokens route, in the order the surface mounts them. */
export const API_TOKENS_ROUTES: readonly RouteDescriptor[] = [
  getApiTokens,
  createApiToken,
  revokeApiToken,
];
