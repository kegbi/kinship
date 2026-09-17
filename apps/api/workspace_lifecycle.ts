/**
 * The workspace danger zone over HTTP.
 *
 * One read that prices the damage and two writes that do it. The problem
 * responder, the session cookie, the origin check, and the kernel status map
 * came from `http/` (GAP-019, GAP-020), and the session cookie both writes
 * clear is composed by `http/cookies.ts` rather than spelled out here.
 *
 * Both writes need the active workspace's name, not just the membership, so
 * they take `requireSession` rather than `requireActor`: the impact preview is
 * about a named workspace and the confirmation a member types is that name.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import type {
  createProtectedSessionCoordinator,
  WorkspaceLifecycle,
} from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";
import { clientAddress } from "./http/client_address.ts";
import { SESSION_COOKIE, setCookie } from "./http/cookies.ts";
import { failureResponder, type FailureTable } from "./http/failures.ts";
import { requireMatchingOrigin } from "./http/origin.ts";
import { definedProblem, type ProblemDefinition } from "./http/problem.ts";
import { type ActorEnv, requireSession, sessionActor } from "./http/session.ts";
import { parseJsonBody } from "./http/validate.ts";

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

/** What a refused danger-zone request says. */
export const WORKSPACE_LIFECYCLE_FAILURES: FailureTable = {
  fallback: {
    code: "workspace_lifecycle_unavailable",
    detail:
      "Nothing was changed. Try again after the current impact can be revalidated.",
    status: 503,
    title: "Workspace lifecycle unavailable",
  },
  statuses: {
    "confirmation-invalid": {
      code: "confirmation_invalid",
      detail: "Type the exact confirmation from the current impact preview.",
      status: 400,
      title: "Confirmation does not match",
    },
    forbidden: {
      code: "workspace_owner_required",
      detail: "Only an active workspace owner can use the danger zone.",
      title: "Owner required",
    },
    "rate-limited": {
      code: "authentication_rate_limited",
      detail: "Too many recent password attempts. Wait before trying again.",
      status: 429,
      title: "Try again later",
    },
    "reauthentication-required": {
      code: "reauthentication_required",
      detail: "Enter your current password before continuing.",
      status: 403,
      title: "Recent authentication required",
    },
    "stale-impact": {
      code: "stale_impact_preview",
      detail: "Reload the current impact before confirming this action.",
      status: 409,
      title: "Impact changed",
    },
  },
};

const failure = failureResponder(WORKSPACE_LIFECYCLE_FAILURES);

const VALIDATION_FAILED: ProblemDefinition = {
  code: "validation_failed",
  detail:
    "Submit the current impact token, exact confirmation, and current password.",
  status: 400,
  title: "Current confirmation required",
};

/** Every problem this file answers on its own, for the pinning suite. */
export const WORKSPACE_LIFECYCLE_PROBLEMS: readonly ProblemDefinition[] = [
  VALIDATION_FAILED,
];

/**
 * The refusal, and the retry budget it came with.
 *
 * A throttled attempt is the only one that says when to come back, so the
 * header is set here rather than inside the failure table, which knows only
 * about prose.
 */
function refused(
  context: Context,
  result: { readonly retryAfterSeconds?: number; readonly status: string },
): Response {
  if (result.status === "rate-limited") {
    context.header("Retry-After", String(result.retryAfterSeconds ?? 1));
  }
  return failure(context, result);
}

export function createWorkspaceLifecycleRoutes(
  services: WorkspaceLifecycleHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  routes.get(
    "/api/v1/settings/workspace-lifecycle",
    session,
    async (context) => {
      const actor = await requireSession(context);
      if (actor instanceof Response) return actor;
      const preview = await services.workspaceLifecycle.preview(actor).catch(
        () => undefined,
      );
      if (preview?.status !== "ready") {
        return refused(context, preview ?? { status: "unavailable" });
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
          workspace: { id: actor.workspaceId, name: preview.workspaceName },
        },
        200,
        { "Cache-Control": "private, no-store" },
      );
    },
  );

  const mutate =
    (action: "delete" | "reset") => async (context: Context<ActorEnv>) => {
      const input = await parseJsonBody(context, mutationSchema);
      if ("errors" in input) {
        return definedProblem(context, VALIDATION_FAILED);
      }
      const actor = await requireSession(context);
      if (actor instanceof Response) return actor;
      const request = { clientAddress: clientAddress(context) };
      const result =
        await (action === "reset"
          ? services.workspaceLifecycle.resetWorkspace(
            actor,
            input.data,
            request,
          )
          : services.workspaceLifecycle.deleteWorkspace(
            actor,
            input.data,
            request,
          )).catch(() => undefined);
      if (
        !result || (result.status !== "reset" && result.status !== "deleted")
      ) {
        return refused(context, result ?? { status: "unavailable" });
      }
      context.header(
        "Set-Cookie",
        setCookie(services.browserSecurity, {
          maxAgeSeconds: 0,
          name: SESSION_COOKIE,
          path: "/",
          value: "",
        }),
      );
      return context.json(
        {
          cleanupStatus: "cleanupStatus" in result
            ? result.cleanupStatus
            : "pending",
          next: "/auth/sign-in",
          status: action === "reset" ? "reset" : "deleted",
        },
        200,
        { "Cache-Control": "private, no-store" },
      );
    };
  routes.post(
    "/api/v1/settings/workspace-lifecycle/reset",
    origin,
    session,
    mutate("reset"),
  );
  routes.delete(
    "/api/v1/settings/workspace-lifecycle",
    origin,
    session,
    mutate("delete"),
  );
  return routes;
}
