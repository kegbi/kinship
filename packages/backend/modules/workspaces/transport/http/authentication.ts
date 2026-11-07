/**
 * Signing in, the second factor, password recovery, and signing out.
 *
 * Six routes and one shared success: an authenticated result sets the session
 * cookie and answers the same body whichever round produced it. The problem
 * responder, the cookie composer, the origin check, the client address, and
 * the kernel status map came from `packages/http-kit` (GAP-019, GAP-020); the six paths
 * with the shapes they accept came from `packages/contracts` (GAP-022), so
 * what this file mounts and what the document publishes are the one
 * description.
 *
 * The two failure tables mirror `protectedSessionHttpStatus`, which is where
 * the domain decides what each refusal is worth over HTTP; `apps/api/failures_test.ts`
 * pins the two against each other, so a domain that starts answering a factor
 * failure differently cannot leave this file saying the old thing.
 *
 * `GET /api/v1/session` resolves its own session rather than taking the
 * middleware, because it is the one route that tells "you never had a session"
 * from "your session is over", and because it needs the whole resolution: the
 * workspace's name and the list of workspaces the same user may switch to.
 */

import { type Context, Hono } from "hono";
import type { PasswordRecoveryFacade } from "../../../identity/public.ts";
import type { z } from "zod";
import {
  type createProtectedSessionCoordinator,
  type MemberUiStateManagement,
  protectedSessionHttpStatus,
  type SignInDevice,
} from "../../public.ts";
import {
  completeMfa,
  getSession,
  requestPasswordReset,
  resetPassword,
  signIn,
  signOut,
} from "../../../../../contracts/routes/authentication.ts";
import {
  mfaInput,
  passwordResetInput,
  recoveryRequestInput,
  type sessionContext,
  signInInput,
} from "../../../../../contracts/schemas/authentication.ts";
import type { BrowserSecurityPolicy } from "../../../../../http-kit/security_policy.ts";
import { clientAddress } from "../../../../../http-kit/client_address.ts";
import {
  cookieValue,
  SESSION_COOKIE,
  setCookie,
} from "../../../../../http-kit/cookies.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import { requireMatchingOrigin } from "../../../../../http-kit/origin.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  actorOf,
  type SessionActor,
  sessionActor,
  sessionOf,
} from "../../../../../http-kit/session.ts";
import { parseJsonBody } from "../../../../../http-kit/validate.ts";

/** The cookie a pending second factor is carried in, and its one route. */
const MFA_COOKIE = "kinship_mfa";
const MFA_PATH = "/api/v1/mfa-challenges";
/** How long a challenge stays usable. */
const MFA_COOKIE_SECONDS = 300;
/**
 * The cookie a browser that signed in before carries back to the sign-in
 * route, which exempts it from the per-account ceiling (AUD-A3). It is sent
 * to that route alone and is not a session.
 */
const SIGN_IN_DEVICE_COOKIE = "kinship_signin_device";
const SIGN_IN_PATH = "/api/v1/sessions";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

/** One legal document a member still has to accept, as the session reports it. */
type RequiredLegalDocument = z.infer<
  typeof sessionContext
>["requiredLegalDocuments"][number];

/**
 * What the session read needs of governance: the legal documents the member
 * still owes. Workspaces does not depend on governance, so this route owns the
 * port it consumes and the composition root hands governance's legal
 * acceptance facade in, which satisfies it.
 */
export interface SessionLegalRequirements {
  requirements(actor: SessionActor): Promise<
    | {
      readonly documents: readonly RequiredLegalDocument[];
      readonly status: "ready";
    }
    | { readonly status: "forbidden" | "unavailable" }
  >;
}

export interface AuthenticationHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly legal?: SessionLegalRequirements;
  readonly memberUiState?: MemberUiStateManagement;
  readonly passwordRecovery: PasswordRecoveryFacade;
  readonly protectedSessions: ProtectedSessions;
}

/** What a refused sign-in says. */
export const SIGN_IN_FAILURES: FailureTable = {
  fallback: {
    code: "invalid_credentials",
    detail: "The email address or password is incorrect.",
    status: 401,
    title: "Sign-in failed",
  },
  statuses: {
    "membership-inactive": {
      code: "membership_inactive",
      detail: "Your workspace membership is not active.",
      status: 403,
      title: "Workspace access unavailable",
    },
    "rate-limited": {
      code: "authentication_rate_limited",
      detail: "Too many attempts. Wait before trying again.",
      status: 429,
      title: "Try again later",
    },
  },
};

/** What a refused second factor says. */
export const MFA_FAILURES: FailureTable = {
  fallback: {
    code: "invalid_mfa",
    detail: "That authenticator or recovery code is not valid.",
    status: 401,
    title: "Challenge failed",
  },
  statuses: {
    "challenge-expired": {
      code: "mfa_challenge_expired",
      detail: "Return to sign-in and start again.",
      status: 410,
      title: "Challenge expired",
    },
    "membership-inactive": {
      code: "membership_inactive",
      detail: "Your workspace membership is not active.",
      status: 403,
      title: "Workspace access unavailable",
    },
    "rate-limited": {
      code: "authentication_rate_limited",
      detail:
        "Too many attempts. Return to sign-in when the challenge expires.",
      status: 429,
      title: "Try again later",
    },
  },
};

const signInFailure = failureResponder(SIGN_IN_FAILURES);
const mfaFailure = failureResponder(MFA_FAILURES);

const SIGN_IN_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Provide a valid email address and password.",
  status: 400,
  title: "Invalid sign-in",
};
const SIGN_IN_UNAVAILABLE: ProblemDefinition = {
  code: "authentication_unavailable",
  detail: "Sign-in is temporarily unavailable. Please try again.",
  status: 503,
  title: "Sign-in unavailable",
};
const MFA_CHALLENGE_EXPIRED: ProblemDefinition = {
  code: "mfa_challenge_expired",
  detail: "Return to sign-in and start again.",
  status: 410,
  title: "Challenge expired",
};
const MFA_UNAVAILABLE: ProblemDefinition = {
  code: "authentication_unavailable",
  detail: "The challenge could not be completed. Please try again.",
  status: 503,
  title: "MFA unavailable",
};
const RECOVERY_REQUEST_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Provide a valid email address.",
  status: 400,
  title: "Invalid recovery request",
};
const RECOVERY_UNAVAILABLE: ProblemDefinition = {
  code: "password_recovery_unavailable",
  detail: "The recovery request could not be submitted. Please try again.",
  status: 503,
  title: "Recovery unavailable",
};
const RESET_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Use a valid link and a password of at least 12 characters.",
  status: 400,
  title: "Invalid password reset",
};
const RESET_UNAVAILABLE: ProblemDefinition = {
  code: "password_reset_unavailable",
  detail: "Password reset is temporarily unavailable. Please try again.",
  status: 503,
  title: "Reset unavailable",
};
const RESET_EXPIRED: ProblemDefinition = {
  code: "password_reset_expired",
  detail: "Request a new password reset link.",
  status: 410,
  title: "Reset link expired",
};
const SIGN_IN_REQUIRED: ProblemDefinition = {
  code: "session_invalid",
  detail: "Sign in to continue.",
  status: 401,
  title: "Authentication required",
};
const SESSION_ENDED: ProblemDefinition = {
  code: "session_invalid",
  detail: "The session or workspace access is no longer active.",
  status: 401,
  title: "Authentication required",
};
const LEGAL_UNAVAILABLE: ProblemDefinition = {
  code: "legal_unavailable",
  detail: "Required legal documents cannot be confirmed right now.",
  status: 503,
  title: "Legal review unavailable",
};
const SIGN_OUT_UNAVAILABLE: ProblemDefinition = {
  code: "sign_out_unavailable",
  detail: "Your session could not be revoked. Please try again.",
  status: 503,
  title: "Sign-out unavailable",
};

/** Every problem this file answers on its own, for the pinning suite. */
export const AUTHENTICATION_PROBLEMS: readonly ProblemDefinition[] = [
  LEGAL_UNAVAILABLE,
  MFA_CHALLENGE_EXPIRED,
  MFA_UNAVAILABLE,
  RECOVERY_REQUEST_INVALID,
  RECOVERY_UNAVAILABLE,
  RESET_EXPIRED,
  RESET_INVALID,
  RESET_UNAVAILABLE,
  SESSION_ENDED,
  SIGN_IN_INVALID,
  SIGN_IN_REQUIRED,
  SIGN_IN_UNAVAILABLE,
  SIGN_OUT_UNAVAILABLE,
];

/** What the request says about the client it came from. */
function client(context: Context): {
  readonly ipAddress: string;
  readonly userAgent?: string;
} {
  const userAgent = context.req.header("User-Agent")?.slice(0, 1_000);
  return {
    ipAddress: clientAddress(context),
    ...(userAgent ? { userAgent } : {}),
  };
}

/** The session cookie an authenticated round sets. */
function sessionCookie(
  policy: BrowserSecurityPolicy,
  token: string,
  expiresAt: Date,
): string {
  return setCookie(policy, {
    maxAgeSeconds: Math.max(0, (expiresAt.getTime() - Date.now()) / 1_000),
    name: SESSION_COOKIE,
    path: "/",
    value: token,
  });
}

/** The challenge cookie, scoped to the one route that completes it. */
function mfaCookie(
  policy: BrowserSecurityPolicy,
  token: string,
  maxAgeSeconds: number,
): string {
  return setCookie(policy, {
    maxAgeSeconds,
    name: MFA_COOKIE,
    path: MFA_PATH,
    value: token,
  });
}

/** The sign-in device cookie, scoped to the route that reads it. */
function signInDeviceCookie(
  policy: BrowserSecurityPolicy,
  device: SignInDevice,
): string {
  return setCookie(policy, {
    maxAgeSeconds: device.maxAgeSeconds,
    name: SIGN_IN_DEVICE_COOKIE,
    path: SIGN_IN_PATH,
    value: device.token,
  });
}

function authenticated(
  context: Context,
  result: Extract<
    Awaited<ReturnType<ProtectedSessions["signIn"]>>,
    { readonly status: "authenticated" }
  >,
  policy: BrowserSecurityPolicy,
): Response {
  context.header(
    "Set-Cookie",
    sessionCookie(policy, result.sessionToken, result.expiresAt),
  );
  context.header("Cache-Control", "private, no-store");
  return context.json(
    {
      status: "authenticated",
      next: "/app",
      workspace: result.workspace,
      member: result.member,
    },
    protectedSessionHttpStatus(result),
  );
}

export function createAuthenticationRoutes(
  services: AuthenticationHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(routes, signIn, origin, async (context) => {
    const parsed = await parseJsonBody(context, signInInput);
    if ("errors" in parsed) {
      return definedProblem(context, SIGN_IN_INVALID);
    }
    const previousSessionToken = cookieValue(
      context.req.header("Cookie"),
      SESSION_COOKIE,
    );
    const deviceToken = cookieValue(
      context.req.header("Cookie"),
      SIGN_IN_DEVICE_COOKIE,
    );
    let result;
    try {
      result = await services.protectedSessions.signIn({
        ...client(context),
        ...(deviceToken ? { deviceToken } : {}),
        email: parsed.data.email,
        password: parsed.data.password,
        ...(previousSessionToken ? { previousSessionToken } : {}),
        ...(parsed.data.workspaceId
          ? { requestedWorkspaceId: parsed.data.workspaceId }
          : {}),
      });
    } catch {
      return definedProblem(context, SIGN_IN_UNAVAILABLE);
    }
    if (result.status === "authenticated") {
      const response = authenticated(
        context,
        result,
        services.browserSecurity,
      );
      if (result.device) {
        response.headers.append(
          "Set-Cookie",
          signInDeviceCookie(services.browserSecurity, result.device),
        );
      }
      return response;
    }
    if (result.status === "mfa-required") {
      context.header(
        "Set-Cookie",
        mfaCookie(
          services.browserSecurity,
          result.challengeToken,
          MFA_COOKIE_SECONDS,
        ),
      );
      if (result.device) {
        context.header(
          "Set-Cookie",
          signInDeviceCookie(services.browserSecurity, result.device),
          { append: true },
        );
      }
      context.header("Cache-Control", "no-store");
      return context.json(
        { status: "mfa-required", next: "/auth/mfa" },
        protectedSessionHttpStatus(result),
      );
    }
    if (result.status === "rate-limited") {
      context.header("Retry-After", String(result.retryAfterSeconds));
    }
    return signInFailure(context, result);
  });

  mount(routes, completeMfa, origin, async (context) => {
    const parsed = await parseJsonBody(context, mfaInput);
    const challengeToken = cookieValue(
      context.req.header("Cookie"),
      MFA_COOKIE,
    );
    if ("errors" in parsed || !challengeToken) {
      return definedProblem(context, MFA_CHALLENGE_EXPIRED);
    }
    const previousSessionToken = cookieValue(
      context.req.header("Cookie"),
      SESSION_COOKIE,
    );
    let result;
    try {
      result = await services.protectedSessions.completeMfa({
        ...client(context),
        challengeToken,
        factor: parsed.data.factor,
        ...(previousSessionToken ? { previousSessionToken } : {}),
        ...(parsed.data.workspaceId
          ? { requestedWorkspaceId: parsed.data.workspaceId }
          : {}),
      });
    } catch {
      return definedProblem(context, MFA_UNAVAILABLE);
    }
    if (result.status === "authenticated") {
      const response = authenticated(
        context,
        result,
        services.browserSecurity,
      );
      response.headers.append(
        "Set-Cookie",
        mfaCookie(services.browserSecurity, "", 0),
      );
      return response;
    }
    if (result.status === "rate-limited") {
      context.header("Retry-After", String(result.retryAfterSeconds));
    }
    return mfaFailure(context, result);
  });

  mount(routes, requestPasswordReset, origin, async (context) => {
    const parsed = await parseJsonBody(context, recoveryRequestInput);
    if ("errors" in parsed) {
      return definedProblem(context, RECOVERY_REQUEST_INVALID);
    }
    try {
      await services.passwordRecovery.request({
        email: parsed.data.email,
        ipAddress: clientAddress(context),
      });
    } catch {
      return definedProblem(context, RECOVERY_UNAVAILABLE);
    }
    context.header("Cache-Control", "no-store");
    return context.json({ status: "accepted" }, 202);
  });

  mount(routes, resetPassword, origin, async (context) => {
    const parsed = await parseJsonBody(context, passwordResetInput);
    if ("errors" in parsed) {
      return definedProblem(context, RESET_INVALID);
    }
    const result = await services.passwordRecovery.reset(parsed.data).catch(
      () => "unavailable" as const,
    );
    if (result === "reset") {
      context.header(
        "Set-Cookie",
        setCookie(services.browserSecurity, {
          maxAgeSeconds: 0,
          name: SESSION_COOKIE,
          path: "/",
          value: "",
        }),
      );
      context.header("Cache-Control", "no-store");
      return context.json({ status: "reset", next: "/auth/sign-in" });
    }
    if (result === "unavailable") {
      return definedProblem(context, RESET_UNAVAILABLE);
    }
    return definedProblem(context, RESET_EXPIRED);
  });

  mount(routes, getSession, session, async (context) => {
    const token = cookieValue(context.req.header("Cookie"), SESSION_COOKIE);
    if (!token) return definedProblem(context, SIGN_IN_REQUIRED);
    const resolved = await sessionOf(context);
    // The request's own membership, from the same resolution: the use cases
    // below know it was resolved just now and do not revalidate it (BEQ-04).
    const actor = await actorOf(context);
    if (!resolved || !actor) return definedProblem(context, SESSION_ENDED);
    const requirements = services.legal
      ? await services.legal.requirements(actor)
      : { documents: [], status: "ready" as const };
    if (requirements.status === "forbidden") {
      return definedProblem(context, SESSION_ENDED);
    }
    if (requirements.status !== "ready") {
      return definedProblem(context, LEGAL_UNAVAILABLE);
    }
    const memberUiState = services.memberUiState
      ? await services.memberUiState.read(actor).catch(() => undefined)
      : undefined;
    context.header("Cache-Control", "private, no-store");
    return context.json({
      status: "authenticated",
      principal: { userId: resolved.userId },
      member: { id: resolved.memberId, role: resolved.role },
      requiredLegalDocuments: requirements.documents,
      ...(memberUiState?.status === "ready"
        ? { uiState: memberUiState.uiState }
        : {}),
      workspace: { id: resolved.workspaceId, name: resolved.workspaceName },
      workspaces: resolved.accessibleWorkspaces.map((workspace) => ({
        id: workspace.workspaceId,
        name: workspace.workspaceName,
      })),
    });
  });

  mount(routes, signOut, origin, async (context) => {
    const token = cookieValue(context.req.header("Cookie"), SESSION_COOKIE);
    if (token) {
      try {
        await services.protectedSessions.signOut(token);
      } catch {
        return definedProblem(context, SIGN_OUT_UNAVAILABLE);
      }
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
    context.header("Cache-Control", "no-store");
    return context.json({ status: "signed-out", next: "/auth/sign-in" });
  });

  return routes;
}
