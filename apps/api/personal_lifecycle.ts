/**
 * Leaving a workspace, and deleting an account, over HTTP.
 *
 * One read that prices both, and two writes that do them. The problem
 * responder, the session cookie, the origin check, the client address, and the
 * kernel status map came from `http/` (GAP-019, GAP-020).
 *
 * Two refusals are not what they look like. A lifecycle action whose
 * membership has gone answers 401 rather than 404, because the caller's
 * session is what went missing; and the final-owner conflict is the one
 * refusal in the API that carries an extension member, because the page cannot
 * say which ownership to transfer without naming the workspaces.
 */

import { type Context, Hono } from "hono";
import type {
  createProtectedSessionCoordinator,
  PersonalLifecycle,
} from "../../packages/backend/modules/workspaces/public.ts";
import {
  deletePersonalIdentity,
  getPersonalLifecyclePreview,
  leaveCurrentWorkspace,
} from "../../packages/contracts/routes/personal_lifecycle.ts";
import {
  personalIdentityDeletionInput,
  personalLifecycleConfirmation,
} from "../../packages/contracts/schemas/personal_lifecycle.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";
import { clientAddress } from "./http/client_address.ts";
import { SESSION_COOKIE, setCookie } from "./http/cookies.ts";
import { failureResponder, type FailureTable } from "./http/failures.ts";
import { requireMatchingOrigin } from "./http/origin.ts";
import { definedProblem, type ProblemDefinition } from "./http/problem.ts";
import { mount } from "./http/route.ts";
import {
  type ActorEnv,
  requireSession,
  SESSION_INVALID,
  sessionActor,
} from "./http/session.ts";
import { parseJsonBody } from "./http/validate.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface PersonalLifecycleHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly personalLifecycle: PersonalLifecycle;
  readonly protectedSessions: ProtectedSessions;
}

/** One workspace that keeps an account from being given up. */
interface BlockingWorkspace {
  readonly id: string;
  readonly name: string;
}

/** What a refused account-lifecycle request says. */
export const PERSONAL_LIFECYCLE_FAILURES: FailureTable = {
  fallback: {
    code: "personal_lifecycle_unavailable",
    detail: "The current impact could not be revalidated. Nothing was changed.",
    status: 503,
    title: "Account lifecycle unavailable",
  },
  statuses: {
    "confirmation-invalid": {
      code: "confirmation_invalid",
      detail:
        "Type the exact confirmation shown in the current impact preview.",
      status: 400,
      title: "Confirmation does not match",
    },
    "not-found": {
      code: SESSION_INVALID.code,
      detail: SESSION_INVALID.detail,
      status: SESSION_INVALID.status,
      title: SESSION_INVALID.title,
    },
    "rate-limited": {
      code: "authentication_rate_limited",
      detail: "Too many attempts. Wait before trying again.",
      status: 429,
      title: "Try again later",
    },
    "reauthentication-required": {
      code: "reauthentication_required",
      detail:
        "Enter your current password before continuing with this lifecycle action.",
      status: 403,
      title: "Recent authentication required",
    },
  },
};

const failure = failureResponder(PERSONAL_LIFECYCLE_FAILURES);

const LEAVE_VALIDATION_FAILED: ProblemDefinition = {
  code: "validation_failed",
  detail:
    "Enter your current password and exact leave confirmation from the current preview.",
  status: 400,
  title: "Confirmation required",
};
const DELETE_VALIDATION_FAILED: ProblemDefinition = {
  code: "validation_failed",
  detail: "Enter your current password and exact deletion confirmation.",
  status: 400,
  title: "Reauthentication and confirmation required",
};

/**
 * The final-owner conflict, named for the workspaces that cause it.
 *
 * A result that names no workspaces at all falls back to "an owned
 * workspace"; one that names an empty list is taken at its word, which is what
 * the hand-written responder did and what the suite pins.
 */
export function finalOwnerProblem(
  blocking: readonly BlockingWorkspace[] | undefined,
): ProblemDefinition {
  const names = blocking?.map((workspace) => workspace.name).join(", ") ??
    "an owned workspace";
  return {
    code: "final_owner",
    detail:
      `Transfer ownership in Members before leaving ${names}. Workspace deletion is a separate owner action.`,
    status: 409,
    title: "Final owner protected",
  };
}

/** Every problem this file answers on its own, for the pinning suite. */
export const PERSONAL_LIFECYCLE_PROBLEMS: readonly ProblemDefinition[] = [
  DELETE_VALIDATION_FAILED,
  LEAVE_VALIDATION_FAILED,
];

/** One refused lifecycle result, however it refused. */
function refused(
  context: Context,
  result: {
    readonly blockingWorkspaces?: readonly BlockingWorkspace[];
    readonly retryAfterSeconds?: number;
    readonly status: string;
  },
): Response {
  if (result.status === "final-owner") {
    return definedProblem(
      context,
      finalOwnerProblem(result.blockingWorkspaces),
      undefined,
      { blockingWorkspaces: result.blockingWorkspaces ?? [] },
    );
  }
  if (result.status === "rate-limited") {
    context.header("Retry-After", String(result.retryAfterSeconds ?? 1));
  }
  return failure(context, result);
}

/** The cleared session cookie both writes may send. */
function clearSessionCookie(
  context: Context,
  policy: BrowserSecurityPolicy,
): void {
  context.header(
    "Set-Cookie",
    setCookie(policy, {
      maxAgeSeconds: 0,
      name: SESSION_COOKIE,
      path: "/",
      value: "",
    }),
  );
}

export function createPersonalLifecycleRoutes(
  services: PersonalLifecycleHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(
    routes,
    getPersonalLifecyclePreview,
    session,
    async (context) => {
      const actor = await requireSession(context);
      if (actor instanceof Response) return actor;
      const preview = await services.personalLifecycle.preview(actor).catch(
        () => undefined,
      );
      if (preview?.status !== "ready") {
        return refused(context, preview ?? { status: "unavailable" });
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
    },
  );

  mount(
    routes,
    leaveCurrentWorkspace,
    origin,
    session,
    async (context) => {
      const input = await parseJsonBody(context, personalLifecycleConfirmation);
      if ("errors" in input) {
        return definedProblem(context, LEAVE_VALIDATION_FAILED);
      }
      const actor = await requireSession(context);
      if (actor instanceof Response) return actor;
      const result = await services.personalLifecycle.leaveWorkspace(
        actor,
        input.data,
        { clientAddress: clientAddress(context) },
      ).catch(() => undefined);
      if (result?.status !== "left") {
        return refused(context, result ?? { status: "unavailable" });
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

  mount(
    routes,
    deletePersonalIdentity,
    origin,
    session,
    async (context) => {
      const input = await parseJsonBody(
        context,
        personalIdentityDeletionInput,
      );
      if ("errors" in input) {
        return definedProblem(context, DELETE_VALIDATION_FAILED);
      }
      const actor = await requireSession(context);
      if (actor instanceof Response) return actor;
      const result = await services.personalLifecycle.deleteIdentity(
        actor,
        input.data,
        { clientAddress: clientAddress(context) },
      ).catch(() => undefined);
      if (result?.status !== "deleted") {
        return refused(context, result ?? { status: "unavailable" });
      }
      clearSessionCookie(context, services.browserSecurity);
      return context.json({ status: "deleted", next: "/auth/sign-in" }, 200, {
        "Cache-Control": "private, no-store",
      });
    },
  );
  return routes;
}
