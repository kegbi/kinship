import { type Context, Hono } from "hono";
import { z } from "zod";
import type {
  createProtectedSessionCoordinator,
  WorkspaceLifecycle,
} from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface WorkspaceLifecycleHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly protectedSessions: ProtectedSessions;
  readonly workspaceLifecycle: WorkspaceLifecycle;
}

const mutationSchema = z.object({
  confirmation: z.string().min(1).max(300),
  impactToken: z.string().regex(/^[0-9a-f]{64}$/),
  password: z.string().min(1).max(1024),
}).strict();

function problem(
  context: Context,
  status: 400 | 401 | 403 | 409 | 429 | 503,
  code: string,
  title: string,
  detail: string,
): Response {
  return context.body(
    JSON.stringify({
      code,
      detail,
      status,
      title,
      type: `https://kinship.test/problems/${code}`,
    }),
    status,
    {
      "Cache-Control": "no-store",
      "Content-Type": "application/problem+json",
    },
  );
}

function clientAddress(context: Context): string {
  const suppliedAddress = context.req.header("X-Kinship-Client-Address");
  return suppliedAddress && suppliedAddress.length <= 64 &&
      /^[0-9A-Fa-f:.]+$/.test(suppliedAddress)
    ? suppliedAddress
    : "127.0.0.1";
}

function cookieValue(header: string | undefined) {
  return header?.split(";").map((item) => item.trim()).find((item) =>
    item.startsWith("kinship_session=")
  )?.slice("kinship_session=".length);
}

async function actor(
  context: Context,
  services: WorkspaceLifecycleHttpServices,
) {
  const token = cookieValue(context.req.header("Cookie"));
  if (!token) return undefined;
  const requestedWorkspaceId = context.req.header("X-Workspace-Id");
  return await services.protectedSessions.resolve({
    sessionToken: token,
    ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
  }).catch(() => undefined);
}

function failure(
  context: Context,
  status: string,
  retryAfterSeconds?: number,
): Response {
  if (status === "forbidden") {
    return problem(
      context,
      403,
      "workspace_owner_required",
      "Owner required",
      "Only an active workspace owner can use the danger zone.",
    );
  }
  if (status === "reauthentication-required") {
    return problem(
      context,
      403,
      "reauthentication_required",
      "Recent authentication required",
      "Enter your current password before continuing.",
    );
  }
  if (status === "confirmation-invalid") {
    return problem(
      context,
      400,
      "confirmation_invalid",
      "Confirmation does not match",
      "Type the exact confirmation from the current impact preview.",
    );
  }
  if (status === "stale-impact") {
    return problem(
      context,
      409,
      "stale_impact_preview",
      "Impact changed",
      "Reload the current impact before confirming this action.",
    );
  }
  if (status === "rate-limited") {
    context.header("Retry-After", String(retryAfterSeconds ?? 1));
    return problem(
      context,
      429,
      "authentication_rate_limited",
      "Try again later",
      "Too many recent password attempts. Wait before trying again.",
    );
  }
  return problem(
    context,
    503,
    "workspace_lifecycle_unavailable",
    "Workspace lifecycle unavailable",
    "Nothing was changed. Try again after the current impact can be revalidated.",
  );
}

function clearCookie(context: Context, policy: BrowserSecurityPolicy) {
  context.header(
    "Set-Cookie",
    `kinship_session=; HttpOnly; SameSite=Strict; ${
      policy.secureCookie ? "Secure; " : ""
    }Max-Age=0; Path=/`,
  );
}

export function createWorkspaceLifecycleRoutes(
  services: WorkspaceLifecycleHttpServices,
): Hono {
  const routes = new Hono();
  routes.get("/api/v1/settings/workspace-lifecycle", async (context) => {
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const preview = await services.workspaceLifecycle.preview(resolved).catch(
      () => undefined,
    );
    if (preview?.status !== "ready") {
      return failure(context, preview?.status ?? "unavailable");
    }
    return context.json(
      {
        activeSessionCount: preview.activeSessionCount,
        confirmations: {
          deleteWorkspace: preview.deleteConfirmation,
          resetWorkspace: preview.resetConfirmation,
        },
        counts: preview.counts,
        impactToken: preview.impactToken,
        status: "ready",
        workspace: { id: resolved.workspaceId, name: preview.workspaceName },
      },
      200,
      { "Cache-Control": "private, no-store" },
    );
  });

  const mutate = (action: "delete" | "reset") => async (context: Context) => {
    if (context.req.header("Origin") !== services.browserSecurity.origin) {
      return problem(
        context,
        403,
        "origin_invalid",
        "Request forbidden",
        "This request did not come from the configured application origin.",
      );
    }
    const input = mutationSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!input.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Current confirmation required",
        "Submit the current impact token, exact confirmation, and current password.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result =
      await (action === "reset"
        ? services.workspaceLifecycle.resetWorkspace(resolved, input.data, {
          clientAddress: clientAddress(context),
        })
        : services.workspaceLifecycle.deleteWorkspace(resolved, input.data, {
          clientAddress: clientAddress(context),
        })).catch(() => undefined);
    if (!result || (result.status !== "reset" && result.status !== "deleted")) {
      return failure(
        context,
        result?.status ?? "unavailable",
        result && "retryAfterSeconds" in result
          ? result.retryAfterSeconds
          : undefined,
      );
    }
    clearCookie(context, services.browserSecurity);
    return context.json(
      action === "reset"
        ? {
          cleanupStatus: "cleanupStatus" in result
            ? result.cleanupStatus
            : "pending",
          next: "/auth/sign-in",
          status: "reset",
        }
        : {
          cleanupStatus: "cleanupStatus" in result
            ? result.cleanupStatus
            : "pending",
          next: "/auth/sign-in",
          status: "deleted",
        },
      200,
      { "Cache-Control": "private, no-store" },
    );
  };
  routes.post("/api/v1/settings/workspace-lifecycle/reset", mutate("reset"));
  routes.delete("/api/v1/settings/workspace-lifecycle", mutate("delete"));
  return routes;
}
