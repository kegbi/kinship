import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  DAV_REMOTE_URL_MAX_BYTES,
  type DavSyncManagement,
} from "../../packages/backend/modules/integrations/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;
export interface IntegrationHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly dav: DavSyncManagement;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
}

const configureSchema = z.object({
  name: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(4096),
  remoteUrl: z.url().max(DAV_REMOTE_URL_MAX_BYTES).refine(
    (value) =>
      new TextEncoder().encode(value).length <= DAV_REMOTE_URL_MAX_BYTES,
  ),
  username: z.string().trim().max(255).optional(),
}).strict();

function problem(
  context: Context,
  status: 400 | 401 | 403 | 404 | 409 | 503,
  code: string,
  detail: string,
) {
  return context.body(
    JSON.stringify({
      code,
      detail,
      status,
      title: status === 401 ? "Authentication required" : "DAV unavailable",
      type: `https://kinship.test/problems/${code}`,
    }),
    status,
    {
      "Cache-Control": "no-store",
      "Content-Type": "application/problem+json",
    },
  );
}

function cookie(header: string | undefined): string | undefined {
  return header?.split(";").map((item) => item.trim()).find((item) =>
    item.startsWith("kinship_session=")
  )?.slice("kinship_session=".length);
}

async function actor(context: Context, services: IntegrationHttpServices) {
  const token = cookie(context.req.header("Cookie"));
  if (!token) return undefined;
  const requestedWorkspaceId = context.req.header("X-Workspace-Id");
  return await services.protectedSessions.resolve({
    sessionToken: token,
    ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
  }).catch(() => undefined);
}

function origin(context: Context, services: IntegrationHttpServices) {
  return context.req.header("Origin") === services.browserSecurity.origin;
}

function failure(context: Context, status: string) {
  if (status === "forbidden") {
    return problem(
      context,
      403,
      "integrations_forbidden",
      "Only an active workspace owner or administrator may manage integrations.",
    );
  }
  if (status === "not-found") {
    return problem(
      context,
      404,
      "integration_not_found",
      "That integration does not exist in this workspace.",
    );
  }
  if (status === "busy") {
    return problem(
      context,
      409,
      "integration_busy",
      "Synchronization is already running. Retry after it finishes.",
    );
  }
  if (status === "invalid") {
    return problem(
      context,
      400,
      "integration_invalid",
      "Use a public HTTPS DAV URL and valid credentials.",
    );
  }
  return undefined;
}

export function createIntegrationRoutes(services: IntegrationHttpServices) {
  const routes = new Hono();
  routes.get("/api/v1/settings/integrations/dav", async (context) => {
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.dav.list(resolved).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "integrations_unavailable",
        "Integrations could not be loaded.",
      );
    }
    const rejected = failure(context, result.status);
    if (rejected) return rejected;
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.post("/api/v1/settings/integrations/dav", async (context) => {
    if (!origin(context, services)) {
      return problem(
        context,
        403,
        "origin_invalid",
        "Request origin is not allowed.",
      );
    }
    const parsed = configureSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "integration_invalid",
        "Enter a name, public HTTPS URL, username, and secret.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.dav.configure(resolved, {
      name: parsed.data.name,
      password: parsed.data.password,
      remoteUrl: parsed.data.remoteUrl,
      ...(parsed.data.username ? { username: parsed.data.username } : {}),
    }).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "integrations_unavailable",
        "The integration could not be configured.",
      );
    }
    const rejected = failure(context, result.status);
    if (rejected) return rejected;
    context.header("Cache-Control", "private, no-store");
    return context.json(result, 201);
  });
  routes.post("/api/v1/settings/integrations/dav/:id/sync", async (context) => {
    if (!origin(context, services)) {
      return problem(
        context,
        403,
        "origin_invalid",
        "Request origin is not allowed.",
      );
    }
    const id = z.uuid().safeParse(context.req.param("id"));
    if (!id.success) {
      return problem(
        context,
        404,
        "integration_not_found",
        "That integration does not exist.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.dav.synchronize(resolved, id.data).catch(() =>
      undefined
    );
    if (!result) {
      return problem(
        context,
        503,
        "integrations_unavailable",
        "Synchronization could not finish.",
      );
    }
    const rejected = failure(context, result.status);
    if (rejected) return rejected;
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.delete("/api/v1/settings/integrations/dav/:id", async (context) => {
    if (!origin(context, services)) {
      return problem(
        context,
        403,
        "origin_invalid",
        "Request origin is not allowed.",
      );
    }
    const id = z.uuid().safeParse(context.req.param("id"));
    if (!id.success) {
      return problem(
        context,
        404,
        "integration_not_found",
        "That integration does not exist.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.dav.disable(resolved, id.data).catch(() =>
      undefined
    );
    if (!result) {
      return problem(
        context,
        503,
        "integrations_unavailable",
        "The integration could not be disabled.",
      );
    }
    const rejected = failure(context, result.status);
    if (rejected) return rejected;
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  return routes;
}
