import { type Context, Hono } from "hono";
import { z } from "zod";
import type {
  createProtectedSessionCoordinator,
  PersonalLifecycle,
} from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface PersonalLifecycleHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly personalLifecycle: PersonalLifecycle;
  readonly protectedSessions: ProtectedSessions;
}

const confirmationSchema = z.object({
  confirmation: z.string().min(1).max(300),
}).strict();
const deletionSchema = confirmationSchema.extend({
  password: z.string().min(1).max(1024),
}).strict();

function cookieValue(header: string | undefined, name: string) {
  return header?.split(";").map((value) => value.trim()).find((value) =>
    value.startsWith(`${name}=`)
  )?.slice(name.length + 1);
}

function problem(
  context: Context,
  status: 400 | 401 | 403 | 404 | 409 | 429 | 503,
  code: string,
  title: string,
  detail: string,
  extensions: Readonly<Record<string, unknown>> = {},
): Response {
  return context.body(
    JSON.stringify({
      type: `https://kinship.test/problems/${code}`,
      title,
      status,
      detail,
      code,
      ...extensions,
    }),
    status,
    {
      "Cache-Control": "no-store",
      "Content-Type": "application/problem+json",
    },
  );
}

function clearSessionCookie(
  context: Context,
  policy: BrowserSecurityPolicy,
): void {
  context.header(
    "Set-Cookie",
    `kinship_session=; HttpOnly; SameSite=Strict; ${
      policy.secureCookie ? "Secure; " : ""
    }Max-Age=0; Path=/`,
  );
}

function clientAddress(context: Context): string {
  const suppliedAddress = context.req.header("X-Kinship-Client-Address");
  return suppliedAddress && suppliedAddress.length <= 64 &&
      /^[0-9A-Fa-f:.]+$/.test(suppliedAddress)
    ? suppliedAddress
    : "127.0.0.1";
}

async function actor(
  context: Context,
  services: PersonalLifecycleHttpServices,
) {
  const token = cookieValue(context.req.header("Cookie"), "kinship_session");
  if (!token) return undefined;
  const requestedWorkspaceId = context.req.header("X-Workspace-Id");
  const resolved = await services.protectedSessions.resolve({
    sessionToken: token,
    ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
  }).catch(() => undefined);
  return resolved
    ? {
      memberId: resolved.memberId,
      role: resolved.role,
      userId: resolved.userId,
      workspaceId: resolved.workspaceId,
      workspaceName: resolved.workspaceName,
    }
    : undefined;
}

function authenticationRequired(context: Context): Response {
  return problem(
    context,
    401,
    "session_invalid",
    "Authentication required",
    "Sign in with an active workspace membership.",
  );
}

function originForbidden(
  context: Context,
  policy: BrowserSecurityPolicy,
): Response | undefined {
  return context.req.header("Origin") === policy.origin ? undefined : problem(
    context,
    403,
    "origin_invalid",
    "Request forbidden",
    "This request did not come from the configured application origin.",
  );
}

function lifecycleProblem(
  context: Context,
  result: {
    readonly blockingWorkspaces?: readonly {
      readonly id: string;
      readonly name: string;
    }[];
    readonly retryAfterSeconds?: number;
    readonly status: string;
  },
): Response {
  if (result.status === "confirmation-invalid") {
    return problem(
      context,
      400,
      "confirmation_invalid",
      "Confirmation does not match",
      "Type the exact confirmation shown in the current impact preview.",
    );
  }
  if (result.status === "reauthentication-required") {
    return problem(
      context,
      403,
      "reauthentication_required",
      "Recent authentication required",
      "Enter your current password before continuing with this lifecycle action.",
    );
  }
  if (result.status === "rate-limited") {
    const retryAfterSeconds = result.retryAfterSeconds ?? 1;
    context.header("Retry-After", String(retryAfterSeconds));
    return problem(
      context,
      429,
      "authentication_rate_limited",
      "Try again later",
      "Too many attempts. Wait before trying again.",
    );
  }
  if (result.status === "final-owner") {
    const names = result.blockingWorkspaces?.map((workspace) => workspace.name)
      .join(", ") ?? "an owned workspace";
    return problem(
      context,
      409,
      "final_owner",
      "Final owner protected",
      `Transfer ownership in Members before leaving ${names}. Workspace deletion is a separate owner action.`,
      { blockingWorkspaces: result.blockingWorkspaces ?? [] },
    );
  }
  if (result.status === "not-found") return authenticationRequired(context);
  return problem(
    context,
    503,
    "personal_lifecycle_unavailable",
    "Account lifecycle unavailable",
    "The current impact could not be revalidated. Nothing was changed.",
  );
}

export function createPersonalLifecycleRoutes(
  services: PersonalLifecycleHttpServices,
): Hono {
  const routes = new Hono();
  routes.get("/api/v1/settings/personal-lifecycle", async (context) => {
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const preview = await services.personalLifecycle.preview(resolved).catch(
      () => undefined,
    );
    if (preview?.status !== "ready") {
      return lifecycleProblem(
        context,
        preview ?? { status: "unavailable" },
      );
    }
    return context.json(
      {
        activeSessionCount: preview.activeSessionCount,
        blockingWorkspaces: preview.blockingWorkspaces,
        confirmations: {
          deleteIdentity: preview.deleteConfirmation,
          leaveWorkspace: preview.leaveConfirmation,
        },
        memberships: preview.memberships.map((membership) => ({
          finalOwner: membership.finalOwner,
          id: membership.memberId,
          role: membership.role,
          status: membership.status,
          workspace: {
            id: membership.workspaceId,
            name: membership.workspaceName,
          },
        })),
        retainedLegalRecords: preview.retainedLegalRecords,
        status: "ready",
      },
      200,
      { "Cache-Control": "private, no-store" },
    );
  });
  routes.post(
    "/api/v1/settings/personal-lifecycle/leave",
    async (context) => {
      const forbidden = originForbidden(context, services.browserSecurity);
      if (forbidden) return forbidden;
      const input = deletionSchema.safeParse(
        await context.req.json().catch(() => undefined),
      );
      if (!input.success) {
        return problem(
          context,
          400,
          "validation_failed",
          "Confirmation required",
          "Enter your current password and exact leave confirmation from the current preview.",
        );
      }
      const resolved = await actor(context, services);
      if (!resolved) return authenticationRequired(context);
      const result = await services.personalLifecycle.leaveWorkspace(
        resolved,
        input.data,
        { clientAddress: clientAddress(context) },
      ).catch(() => undefined);
      if (result?.status !== "left") {
        return lifecycleProblem(
          context,
          result ?? { status: "unavailable" },
        );
      }
      if (result.signedOut) {
        clearSessionCookie(context, services.browserSecurity);
      }
      return context.json(
        {
          next: result.signedOut ? "/auth/sign-in" : "/app",
          ...(result.nextWorkspaceId
            ? { nextWorkspaceId: result.nextWorkspaceId }
            : {}),
          status: "left",
        },
        200,
        { "Cache-Control": "private, no-store" },
      );
    },
  );
  routes.delete("/api/v1/settings/personal-lifecycle", async (context) => {
    const forbidden = originForbidden(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const input = deletionSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!input.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Reauthentication and confirmation required",
        "Enter your current password and exact deletion confirmation.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.personalLifecycle.deleteIdentity(
      resolved,
      input.data,
      { clientAddress: clientAddress(context) },
    ).catch(() => undefined);
    if (result?.status !== "deleted") {
      return lifecycleProblem(
        context,
        result ?? { status: "unavailable" },
      );
    }
    clearSessionCookie(context, services.browserSecurity);
    return context.json({ status: "deleted", next: "/auth/sign-in" }, 200, {
      "Cache-Control": "private, no-store",
    });
  });
  return routes;
}
