import { type Context, Hono } from "hono";
import { z } from "zod";
import type { PasswordRecoveryFacade } from "../../packages/backend/modules/identity/public.ts";
import {
  type AuthenticationRequestStatusCode,
  type createProtectedSessionCoordinator,
  protectedSessionHttpStatus,
} from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  workspaceId: z.string().uuid().optional(),
}).strict();

const mfaSchema = z.object({
  factor: z.string().trim().min(6).max(128),
  workspaceId: z.string().uuid().optional(),
}).strict();

const recoveryRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
}).strict();

const resetSchema = z.object({
  password: z.string().min(12).max(128),
  token: z.string().min(32).max(256),
}).strict();

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface AuthenticationHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly passwordRecovery: PasswordRecoveryFacade;
  readonly protectedSessions: ProtectedSessions;
}

function problem(
  context: Context,
  status: 400 | AuthenticationRequestStatusCode,
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

function cookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  return header?.split(";").map((value) => value.trim()).find((value) =>
    value.startsWith(`${name}=`)
  )?.slice(name.length + 1);
}

function cookie(
  name: string,
  value: string,
  policy: BrowserSecurityPolicy,
  maxAge: number,
  path = "/",
): string {
  return [
    `${name}=${value}`,
    "HttpOnly",
    "SameSite=Strict",
    policy.secureCookie ? "Secure" : undefined,
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    `Path=${path}`,
  ].filter(Boolean).join("; ");
}

function requireOrigin(
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

function client(context: Context): {
  readonly ipAddress: string;
  readonly userAgent?: string;
} {
  const suppliedAddress = context.req.header("X-Kinship-Client-Address");
  const ipAddress = suppliedAddress && suppliedAddress.length <= 64 &&
      /^[0-9A-Fa-f:.]+$/.test(suppliedAddress)
    ? suppliedAddress
    : "127.0.0.1";
  const userAgent = context.req.header("User-Agent")?.slice(0, 1_000);
  return { ipAddress, ...(userAgent ? { userAgent } : {}) };
}

function authenticated(
  context: Context,
  result: Extract<
    Awaited<ReturnType<ProtectedSessions["signIn"]>>,
    { readonly status: "authenticated" }
  >,
  policy: BrowserSecurityPolicy,
): Response {
  const maxAge = Math.max(0, (result.expiresAt.getTime() - Date.now()) / 1_000);
  context.header(
    "Set-Cookie",
    cookie("kinship_session", result.sessionToken, policy, maxAge),
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
): Hono {
  const routes = new Hono();

  routes.post("/api/v1/sessions", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsed = signInSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid sign-in",
        "Provide a valid email address and password.",
      );
    }
    const previousSessionToken = cookieValue(
      context.req.header("Cookie"),
      "kinship_session",
    );
    let result;
    try {
      result = await services.protectedSessions.signIn({
        ...client(context),
        email: parsed.data.email,
        password: parsed.data.password,
        ...(previousSessionToken ? { previousSessionToken } : {}),
        ...(parsed.data.workspaceId
          ? { requestedWorkspaceId: parsed.data.workspaceId }
          : {}),
      });
    } catch {
      return problem(
        context,
        503,
        "authentication_unavailable",
        "Sign-in unavailable",
        "Sign-in is temporarily unavailable. Please try again.",
      );
    }
    if (result.status === "authenticated") {
      return authenticated(context, result, services.browserSecurity);
    }
    if (result.status === "mfa-required") {
      context.header(
        "Set-Cookie",
        cookie(
          "kinship_mfa",
          result.challengeToken,
          services.browserSecurity,
          300,
          "/api/v1/mfa-challenges",
        ),
      );
      context.header("Cache-Control", "no-store");
      return context.json(
        { status: "mfa-required", next: "/auth/mfa" },
        protectedSessionHttpStatus(result),
      );
    }
    if (result.status === "rate-limited") {
      context.header("Retry-After", String(result.retryAfterSeconds));
      return problem(
        context,
        protectedSessionHttpStatus(result),
        "authentication_rate_limited",
        "Try again later",
        "Too many attempts. Wait before trying again.",
      );
    }
    if (result.status === "membership-inactive") {
      return problem(
        context,
        protectedSessionHttpStatus(result),
        "membership_inactive",
        "Workspace access unavailable",
        "Your workspace membership is not active.",
      );
    }
    return problem(
      context,
      protectedSessionHttpStatus(result),
      "invalid_credentials",
      "Sign-in failed",
      "The email address or password is incorrect.",
    );
  });

  routes.post("/api/v1/mfa-challenges", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsed = mfaSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    const challengeToken = cookieValue(
      context.req.header("Cookie"),
      "kinship_mfa",
    );
    if (!parsed.success || !challengeToken) {
      return problem(
        context,
        410,
        "mfa_challenge_expired",
        "Challenge expired",
        "Return to sign-in and start again.",
      );
    }
    const previousSessionToken = cookieValue(
      context.req.header("Cookie"),
      "kinship_session",
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
      return problem(
        context,
        503,
        "authentication_unavailable",
        "MFA unavailable",
        "The challenge could not be completed. Please try again.",
      );
    }
    if (result.status === "authenticated") {
      const response = authenticated(
        context,
        result,
        services.browserSecurity,
      );
      response.headers.append(
        "Set-Cookie",
        cookie(
          "kinship_mfa",
          "",
          services.browserSecurity,
          0,
          "/api/v1/mfa-challenges",
        ),
      );
      return response;
    }
    if (result.status === "rate-limited") {
      context.header("Retry-After", String(result.retryAfterSeconds));
      return problem(
        context,
        protectedSessionHttpStatus(result),
        "authentication_rate_limited",
        "Try again later",
        "Too many attempts. Return to sign-in when the challenge expires.",
      );
    }
    if (result.status === "challenge-expired") {
      return problem(
        context,
        protectedSessionHttpStatus(result),
        "mfa_challenge_expired",
        "Challenge expired",
        "Return to sign-in and start again.",
      );
    }
    if (result.status === "membership-inactive") {
      return problem(
        context,
        protectedSessionHttpStatus(result),
        "membership_inactive",
        "Workspace access unavailable",
        "Your workspace membership is not active.",
      );
    }
    return problem(
      context,
      protectedSessionHttpStatus(result),
      "invalid_mfa",
      "Challenge failed",
      "That authenticator or recovery code is not valid.",
    );
  });

  routes.post("/api/v1/password-reset-requests", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsed = recoveryRequestSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid recovery request",
        "Provide a valid email address.",
      );
    }
    try {
      await services.passwordRecovery.request({
        email: parsed.data.email,
        ipAddress: client(context).ipAddress,
      });
    } catch {
      return problem(
        context,
        503,
        "password_recovery_unavailable",
        "Recovery unavailable",
        "The recovery request could not be submitted. Please try again.",
      );
    }
    context.header("Cache-Control", "no-store");
    return context.json({ status: "accepted" }, 202);
  });

  routes.post("/api/v1/password-resets", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsed = resetSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid password reset",
        "Use a valid link and a password of at least 12 characters.",
      );
    }
    const result = await services.passwordRecovery.reset(parsed.data).catch(
      () => "unavailable" as const,
    );
    if (result === "reset") {
      context.header(
        "Set-Cookie",
        cookie("kinship_session", "", services.browserSecurity, 0),
      );
      context.header("Cache-Control", "no-store");
      return context.json({ status: "reset", next: "/auth/sign-in" });
    }
    if (result === "unavailable") {
      return problem(
        context,
        503,
        "password_reset_unavailable",
        "Reset unavailable",
        "Password reset is temporarily unavailable. Please try again.",
      );
    }
    return problem(
      context,
      410,
      "password_reset_expired",
      "Reset link expired",
      "Request a new password reset link.",
    );
  });

  routes.get("/api/v1/session", async (context) => {
    const token = cookieValue(context.req.header("Cookie"), "kinship_session");
    if (!token) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in to continue.",
      );
    }
    const workspaceId = context.req.header("X-Workspace-Id");
    const resolved = await services.protectedSessions.resolve({
      sessionToken: token,
      ...(workspaceId ? { requestedWorkspaceId: workspaceId } : {}),
    }).catch(() => undefined);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "The session or workspace access is no longer active.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      status: "authenticated",
      principal: { userId: resolved.userId },
      member: { id: resolved.memberId, role: resolved.role },
      workspace: { id: resolved.workspaceId, name: resolved.workspaceName },
      workspaces: resolved.accessibleWorkspaces.map((workspace) => ({
        id: workspace.workspaceId,
        name: workspace.workspaceName,
      })),
    });
  });

  routes.post("/api/v1/sign-out", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const token = cookieValue(context.req.header("Cookie"), "kinship_session");
    if (token) {
      try {
        await services.protectedSessions.signOut(token);
      } catch {
        return problem(
          context,
          503,
          "sign_out_unavailable",
          "Sign-out unavailable",
          "Your session could not be revoked. Please try again.",
        );
      }
    }
    context.header(
      "Set-Cookie",
      cookie("kinship_session", "", services.browserSecurity, 0),
    );
    context.header("Cache-Control", "no-store");
    return context.json({ status: "signed-out", next: "/auth/sign-in" });
  });

  return routes;
}
