/**
 * Personal API tokens over HTTP.
 *
 * Three routes and the prose each refusal carries. The problem responder, the
 * session cookie, the origin check, and the kernel status map came from
 * `http/` (GAP-019, GAP-020); the paths these routes answer on and the shape a
 * token is created from come from `packages/contracts` (GAP-022).
 *
 * The three outages are named separately rather than shared, because a caller
 * needs to know whether nothing was loaded, nothing was created, or nothing
 * was revoked — the word the page shows is the difference between "try again"
 * and "check before trying again".
 */

import { Hono } from "hono";
import {
  API_TOKEN_SCOPES,
  type ApiTokenManagement,
} from "../../packages/backend/modules/api-access/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import {
  createApiToken,
  getApiTokens,
  revokeApiToken,
} from "../../packages/contracts/routes/api_tokens.ts";
import { apiTokenCreateInput } from "../../packages/contracts/schemas/api_tokens.ts";
import { uuid } from "../../packages/contracts/schemas/shared.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";
import { failureResponder, type FailureTable } from "./http/failures.ts";
import { requireMatchingOrigin } from "./http/origin.ts";
import { definedProblem, type ProblemDefinition } from "./http/problem.ts";
import { mount } from "./http/route.ts";
import { type ActorEnv, requireActor, sessionActor } from "./http/session.ts";
import { parseJsonBody, parseValue } from "./http/validate.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;
export interface ApiTokenHttpServices {
  readonly apiTokens: ApiTokenManagement;
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
}

const TOKENS_NOT_LOADED: ProblemDefinition = {
  code: "api_tokens_unavailable",
  detail: "Your API tokens could not be loaded.",
  status: 503,
  title: "API tokens unavailable",
};

/** What a refused token management request says. */
export const API_TOKEN_FAILURES: FailureTable = {
  fallback: TOKENS_NOT_LOADED,
  statuses: {
    forbidden: {
      code: "api_tokens_forbidden",
      detail:
        "Only an active workspace owner or administrator may manage API tokens.",
      title: "API tokens unavailable",
    },
    invalid: {
      code: "api_token_invalid",
      detail: "Choose a name, accepted scopes, and a future expiry.",
      status: 400,
      title: "Invalid API token",
    },
    "not-found": {
      code: "api_token_not_found",
      detail:
        "That API token does not exist in this workspace or is already revoked.",
      title: "API token unavailable",
    },
  },
};

const failure = failureResponder(API_TOKEN_FAILURES);

const TOKEN_REQUEST_INVALID: ProblemDefinition = {
  code: "api_token_invalid",
  detail: "Choose a name, at least one accepted scope, and a future expiry.",
  status: 400,
  title: "Invalid API token",
};
const TOKEN_NOT_FOUND: ProblemDefinition = {
  code: "api_token_not_found",
  detail: "That API token does not exist in this workspace.",
  status: 404,
  title: "API token unavailable",
};
const TOKEN_NOT_CREATED: ProblemDefinition = {
  code: "api_tokens_unavailable",
  detail: "The API token could not be created.",
  status: 503,
  title: "API token unavailable",
};
const TOKEN_NOT_REVOKED: ProblemDefinition = {
  code: "api_tokens_unavailable",
  detail: "The API token could not be revoked.",
  status: 503,
  title: "API token unavailable",
};

/** Every problem this file answers on its own, for the pinning suite. */
export const API_TOKEN_PROBLEMS: readonly ProblemDefinition[] = [
  TOKEN_NOT_CREATED,
  TOKEN_NOT_FOUND,
  TOKEN_NOT_REVOKED,
  TOKEN_REQUEST_INVALID,
];

export function createApiTokenRoutes(
  services: ApiTokenHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(routes, getApiTokens, session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.apiTokens.list(actor).catch(() => undefined);
    if (!result) return definedProblem(context, TOKENS_NOT_LOADED);
    if (result.status !== "ready") return failure(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json({
      records: result.records,
      scopes: API_TOKEN_SCOPES,
      status: "ready",
    });
  });

  mount(routes, createApiToken, origin, session, async (
    context,
  ) => {
    const body = await parseJsonBody(context, apiTokenCreateInput);
    if ("errors" in body) {
      return definedProblem(context, TOKEN_REQUEST_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.apiTokens.create(actor, {
      ...(body.data.expiresAt ? { expiresAt: body.data.expiresAt } : {}),
      name: body.data.name,
      scopes: body.data.scopes,
    }).catch(() => undefined);
    if (!result) return definedProblem(context, TOKEN_NOT_CREATED);
    if (result.status !== "created") return failure(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json(result, 201);
  });

  mount(
    routes,
    revokeApiToken,
    origin,
    session,
    async (context) => {
      const tokenId = parseValue(uuid, context.req.param("tokenId"));
      if ("errors" in tokenId) {
        return definedProblem(context, TOKEN_NOT_FOUND);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.apiTokens.revoke(actor, tokenId.data).catch(
        () => undefined,
      );
      if (!result) return definedProblem(context, TOKEN_NOT_REVOKED);
      if (result.status !== "revoked") return failure(context, result.status);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );
  return routes;
}
