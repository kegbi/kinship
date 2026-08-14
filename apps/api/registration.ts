import { type Context, Hono } from "hono";
import { z } from "zod";
import type { PasswordHasher } from "../../packages/backend/modules/identity/public.ts";
import type { EmailVerificationFacade } from "../../packages/backend/modules/identity/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";
import {
  type FirstWorkspaceRegistrationCommand,
  type FirstWorkspaceRegistrationResult,
  type ProtectedSessionResult,
  RegistrationError,
} from "../../packages/backend/modules/workspaces/public.ts";

const registrationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100),
  password: z.string().min(12).max(128),
  workspaceName: z.string().trim().min(2).max(120),
}).strict();

const verificationSchema = z.object({
  token: z.string().min(32).max(256),
}).strict();

const verificationDeliverySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
}).strict();

export interface RegistrationHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly hasher: PasswordHasher;
  readonly register: (
    command: FirstWorkspaceRegistrationCommand,
  ) => Promise<FirstWorkspaceRegistrationResult>;
  readonly retryVerificationDelivery?: (email: string) => Promise<void>;
  readonly verification: EmailVerificationFacade;
  readonly establishVerifiedEntry?: (command: {
    readonly previousSessionToken?: string;
    readonly userAgent?: string;
    readonly userId: string;
  }) => Promise<ProtectedSessionResult>;
}

function sessionCookie(
  value: string,
  policy: BrowserSecurityPolicy,
  maxAge: number,
): string {
  return [
    `kinship_session=${value}`,
    "HttpOnly",
    "SameSite=Strict",
    policy.secureCookie ? "Secure" : undefined,
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    "Path=/",
  ].filter(Boolean).join("; ");
}

function problem(
  context: Context,
  status: 400 | 403 | 409 | 410 | 503,
  code: string,
  title: string,
  detail: string,
  errors?: Record<string, string>,
): Response {
  const body = {
    type: `https://kinship.test/problems/${code}`,
    title,
    status,
    detail,
    code,
    ...(errors ? { errors } : {}),
  };
  return context.body(JSON.stringify(body), status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/problem+json",
  });
}

function entryCookie(
  value: string,
  policy: BrowserSecurityPolicy,
  maxAge: number,
  path = "/api/v1/application-entry",
): string {
  return [
    `kinship_entry=${value}`,
    "HttpOnly",
    "SameSite=Strict",
    policy.secureCookie ? "Secure" : undefined,
    `Max-Age=${maxAge}`,
    `Path=${path}`,
  ].filter(Boolean).join("; ");
}

function cookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  return header?.split(";").map((value) => value.trim()).find((value) =>
    value.startsWith(`${name}=`)
  )?.slice(name.length + 1);
}

export function createRegistrationRoutes(
  services: RegistrationHttpServices,
): Hono {
  const routes = new Hono();

  routes.post("/api/v1/registrations", async (context) => {
    const parsed = registrationSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "body");
        errors[key] ??= issue.message;
      }
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid registration",
        "Check the highlighted fields.",
        errors,
      );
    }
    try {
      const passwordHash = await services.hasher.hash(parsed.data.password);
      const result = await services.register({
        email: parsed.data.email,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        passwordHash,
        workspaceName: parsed.data.workspaceName,
      });
      context.header("Cache-Control", "no-store");
      return context.json(result, 202);
    } catch (error) {
      if (
        error instanceof RegistrationError && error.code === "duplicate_email"
      ) {
        return problem(
          context,
          409,
          "duplicate_email",
          "Registration unavailable",
          "An account already uses that email address.",
        );
      }
      if (
        typeof error === "object" && error !== null && "code" in error &&
        error.code === "verification_delivery_failed"
      ) {
        return problem(
          context,
          503,
          "verification_delivery_failed",
          "Verification email delayed",
          "Your account was created with its workspace, but the verification email could not be delivered. Retry delivery.",
        );
      }
      return problem(
        context,
        503,
        "registration_failed",
        "Registration unavailable",
        "Nothing was created. Please try again.",
      );
    }
  });

  routes.post("/api/v1/email-verifications", async (context) => {
    const parsed = verificationSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "invalid_verification",
        "Verification link invalid",
        "Request a new verification link.",
      );
    }
    let result;
    try {
      result = await services.verification.verify(parsed.data.token);
    } catch {
      return problem(
        context,
        503,
        "verification_unavailable",
        "Verification unavailable",
        "Email verification is temporarily unavailable. Please try again.",
      );
    }
    if (result.status !== "verified") {
      const status = result.status === "expired" ? 410 : 409;
      const code = result.status === "expired"
        ? "verification_expired"
        : result.status === "replayed"
        ? "verification_replayed"
        : "invalid_verification";
      return problem(
        context,
        status,
        code,
        "Email not verified",
        "This verification link cannot be used.",
      );
    }
    const hasInvitation = cookieValue(
      context.req.header("Cookie"),
      "kinship_invitation_pending",
    ) !== undefined;
    context.header(
      "Set-Cookie",
      entryCookie(
        result.entryToken,
        services.browserSecurity,
        600,
        hasInvitation
          ? "/api/v1/workspace-invitations"
          : "/api/v1/application-entry",
      ),
    );
    context.header("Cache-Control", "no-store");
    if (hasInvitation) {
      context.header(
        "Set-Cookie",
        [
          "kinship_invitation_pending=",
          "HttpOnly",
          "SameSite=Strict",
          services.browserSecurity.secureCookie ? "Secure" : undefined,
          "Max-Age=0",
          "Path=/api/v1/email-verifications",
        ].filter(Boolean).join("; "),
        { append: true },
      );
    }
    return context.json({
      status: "verified",
      next: hasInvitation ? "/invite/continue" : "/app",
    });
  });

  routes.post("/api/v1/application-entry", async (context) => {
    if (context.req.header("Origin") !== services.browserSecurity.origin) {
      return problem(
        context,
        403,
        "origin_invalid",
        "Application entry forbidden",
        "This request did not come from the configured application origin.",
      );
    }
    const entryToken = cookieValue(
      context.req.header("Cookie"),
      "kinship_entry",
    );
    if (!entryToken) {
      return problem(
        context,
        409,
        "entry_handoff_invalid",
        "Application entry unavailable",
        "Use the link from a completed verification.",
      );
    }
    let applicationContext;
    try {
      applicationContext = await services.verification
        .consumeApplicationEntry(entryToken);
    } catch {
      return problem(
        context,
        503,
        "entry_handoff_unavailable",
        "Application entry unavailable",
        "Application entry is temporarily unavailable. Please try again.",
      );
    }
    context.header(
      "Set-Cookie",
      entryCookie("", services.browserSecurity, 0),
    );
    context.header("Cache-Control", "private, no-store");
    if (!applicationContext) {
      return problem(
        context,
        409,
        "entry_handoff_invalid",
        "Application entry unavailable",
        "This application-entry handoff cannot be used.",
      );
    }
    if (services.establishVerifiedEntry) {
      let session;
      try {
        const previousSessionToken = cookieValue(
          context.req.header("Cookie"),
          "kinship_session",
        );
        const userAgent = context.req.header("User-Agent")?.slice(0, 1_000);
        session = await services.establishVerifiedEntry({
          ...(previousSessionToken ? { previousSessionToken } : {}),
          ...(userAgent ? { userAgent } : {}),
          userId: applicationContext.userId,
        });
      } catch {
        return problem(
          context,
          503,
          "entry_handoff_unavailable",
          "Application entry unavailable",
          "Application entry is temporarily unavailable. Please try again.",
        );
      }
      if (session.status !== "authenticated") {
        return problem(
          context,
          409,
          "entry_handoff_invalid",
          "Application entry unavailable",
          "Workspace access is no longer active.",
        );
      }
      context.header(
        "Set-Cookie",
        sessionCookie(
          session.sessionToken,
          services.browserSecurity,
          (session.expiresAt.getTime() - Date.now()) / 1_000,
        ),
        { append: true },
      );
    }
    return context.json({
      status: "ready",
      workspace: {
        id: applicationContext.workspaceId,
        name: applicationContext.workspaceName,
      },
      member: {
        id: applicationContext.memberId,
        firstName: applicationContext.firstName,
      },
    });
  });

  routes.post("/api/v1/email-verification-deliveries", async (context) => {
    const parsed = verificationDeliverySchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid delivery request",
        "Provide a valid email address.",
      );
    }
    await services.retryVerificationDelivery?.(parsed.data.email).catch(() =>
      undefined
    );
    context.header("Cache-Control", "no-store");
    return context.json({ status: "accepted" }, 202);
  });

  return routes;
}
