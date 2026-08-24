import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  API_TOKEN_SCOPES,
  type ApiTokenManagement,
} from "../../packages/backend/modules/api-access/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;
export interface ApiTokenHttpServices {
  readonly apiTokens: ApiTokenManagement;
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
}

const createSchema = z.object({
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(API_TOKEN_SCOPES)).min(1).max(API_TOKEN_SCOPES.length),
}).strict();

function problem(
  context: Context,
  status: 400 | 401 | 403 | 404 | 503,
  code: string,
  title: string,
  detail: string,
): Response {
  return context.body(
    JSON.stringify({
      type: `https://kinship.test/problems/${code}`,
      title,
      status,
      detail,
      code,
    }),
    status,
    {
      "Cache-Control": "no-store",
      "Content-Type": "application/problem+json",
    },
  );
}

function cookieValue(header: string | undefined, name: string) {
  return header?.split(";").map((value) => value.trim()).find((value) =>
    value.startsWith(`${name}=`)
  )?.slice(name.length + 1);
}

function requireOrigin(context: Context, policy: BrowserSecurityPolicy) {
  return context.req.header("Origin") === policy.origin ? undefined : problem(
    context,
    403,
    "origin_invalid",
    "Request forbidden",
    "This request did not come from the configured application origin.",
  );
}

async function actor(context: Context, services: ApiTokenHttpServices) {
  const sessionToken = cookieValue(
    context.req.header("Cookie"),
    "kinship_session",
  );
  if (!sessionToken) return undefined;
  const requestedWorkspaceId = context.req.header("X-Workspace-Id");
  const resolved = await services.protectedSessions.resolve({
    sessionToken,
    ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
  }).catch(() => undefined);
  return resolved
    ? {
      memberId: resolved.memberId,
      role: resolved.role,
      userId: resolved.userId,
      workspaceId: resolved.workspaceId,
    }
    : undefined;
}

const authenticationRequired = (context: Context) =>
  problem(
    context,
    401,
    "session_invalid",
    "Authentication required",
    "Sign in with an active workspace membership.",
  );
const forbidden = (context: Context) =>
  problem(
    context,
    403,
    "api_tokens_forbidden",
    "API tokens unavailable",
    "Only an active workspace owner or administrator may manage API tokens.",
  );

export function createApiTokenRoutes(services: ApiTokenHttpServices): Hono {
  const routes = new Hono();
  routes.get("/api/v1/settings/api-tokens", async (context) => {
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.apiTokens.list(resolved).catch(() =>
      undefined
    );
    if (!result) {
      return problem(
        context,
        503,
        "api_tokens_unavailable",
        "API tokens unavailable",
        "Your API tokens could not be loaded.",
      );
    }
    if (result.status === "forbidden") return forbidden(context);
    context.header("Cache-Control", "private, no-store");
    return context.json({
      records: result.records,
      scopes: API_TOKEN_SCOPES,
      status: "ready",
    });
  });
  routes.post("/api/v1/settings/api-tokens", async (context) => {
    const rejectedOrigin = requireOrigin(context, services.browserSecurity);
    if (rejectedOrigin) return rejectedOrigin;
    const parsed = createSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "api_token_invalid",
        "Invalid API token",
        "Choose a name, at least one accepted scope, and a future expiry.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.apiTokens.create(resolved, {
      ...(parsed.data.expiresAt ? { expiresAt: parsed.data.expiresAt } : {}),
      name: parsed.data.name,
      scopes: parsed.data.scopes,
    }).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "api_tokens_unavailable",
        "API token unavailable",
        "The API token could not be created.",
      );
    }
    if (result.status === "forbidden") return forbidden(context);
    if (result.status === "invalid") {
      return problem(
        context,
        400,
        "api_token_invalid",
        "Invalid API token",
        "Choose a name, accepted scopes, and a future expiry.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result, 201);
  });
  routes.delete("/api/v1/settings/api-tokens/:tokenId", async (context) => {
    const rejectedOrigin = requireOrigin(context, services.browserSecurity);
    if (rejectedOrigin) return rejectedOrigin;
    const id = z.uuid().safeParse(context.req.param("tokenId"));
    if (!id.success) {
      return problem(
        context,
        404,
        "api_token_not_found",
        "API token unavailable",
        "That API token does not exist in this workspace.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.apiTokens.revoke(resolved, id.data).catch(
      () => undefined,
    );
    if (!result) {
      return problem(
        context,
        503,
        "api_tokens_unavailable",
        "API token unavailable",
        "The API token could not be revoked.",
      );
    }
    if (result.status === "forbidden") return forbidden(context);
    if (result.status === "not-found") {
      return problem(
        context,
        404,
        "api_token_not_found",
        "API token unavailable",
        "That API token does not exist in this workspace or is already revoked.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  return routes;
}
