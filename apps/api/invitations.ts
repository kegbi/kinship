import { type Context, Hono } from "hono";
import { z } from "zod";
import type { createWorkspaceInvitationCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { PasswordHasher } from "../../packages/backend/modules/identity/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

type Invitations = ReturnType<typeof createWorkspaceInvitationCoordinator>;
type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface InvitationHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly hasher: PasswordHasher;
  readonly invitations: Invitations;
  readonly protectedSessions: ProtectedSessions;
}

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(["admin", "member"]),
}).strict();
const optionalTokenSchema = z.object({
  token: z.string().min(32).max(256).optional(),
}).strict();
const invitationRegistrationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100),
  password: z.string().min(12).max(128),
  token: z.string().min(32).max(256),
}).strict();
const invitationAuthenticationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  token: z.string().min(32).max(256).optional(),
}).strict();
const invitationMfaSchema = z.object({
  factor: z.string().trim().min(6).max(128),
}).strict();

function problem(
  context: Context,
  status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 503,
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

function cookie(
  name: string,
  value: string,
  policy: BrowserSecurityPolicy,
  maxAge: number,
  path: string,
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

function invitationToken(context: Context): string | undefined {
  return cookieValue(context.req.header("Cookie"), "kinship_invitation");
}

function clientAddress(context: Context): string {
  const supplied = context.req.header("X-Kinship-Client-Address");
  return supplied && supplied.length <= 64 && /^[0-9A-Fa-f:.]+$/.test(supplied)
    ? supplied
    : "127.0.0.1";
}

function invitationContinuationCookies(
  context: Context,
  services: InvitationHttpServices,
  invitation: string,
  entry: string,
  expiresAt: Date,
): void {
  context.header(
    "Set-Cookie",
    cookie(
      "kinship_entry",
      entry,
      services.browserSecurity,
      (expiresAt.getTime() - Date.now()) / 1_000,
      "/api/v1/workspace-invitations",
    ),
    { append: true },
  );
  context.header(
    "Set-Cookie",
    cookie(
      "kinship_invitation",
      invitation,
      services.browserSecurity,
      24 * 60 * 60,
      "/api/v1/workspace-invitations",
    ),
    { append: true },
  );
}

async function actor(context: Context, services: InvitationHttpServices) {
  const sessionToken = cookieValue(
    context.req.header("Cookie"),
    "kinship_session",
  );
  if (!sessionToken) return undefined;
  const requestedWorkspaceId = context.req.header("X-Workspace-Id");
  return await services.protectedSessions.resolve({
    sessionToken,
    ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
  }).catch(() => undefined);
}

export function createInvitationRoutes(services: InvitationHttpServices): Hono {
  const routes = new Hono();

  routes.post("/api/v1/workspace-invitations", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsed = createSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid invitation",
        "Provide a valid email address and allowed role.",
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
    const result = await services.invitations.create({
      actor: {
        memberId: resolved.memberId,
        role: resolved.role,
        userId: resolved.userId,
        workspaceId: resolved.workspaceId,
      },
      email: parsed.data.email,
      role: parsed.data.role,
      workspaceName: resolved.workspaceName,
    }).catch(() => "unavailable" as const);
    if (result === "created") {
      context.header("Cache-Control", "private, no-store");
      return context.json({ status: "invited" }, 201);
    }
    if (result === "already-member") {
      return problem(
        context,
        409,
        "already_member",
        "Membership already exists",
        "That email already has a membership record in this workspace. Manage its lifecycle explicitly instead of inviting it again.",
      );
    }
    if (result === "forbidden") {
      return problem(
        context,
        403,
        "invitation_forbidden",
        "Invitation forbidden",
        "Only an active workspace owner or admin may invite members.",
      );
    }
    return problem(
      context,
      503,
      "invitation_delivery_failed",
      "Invitation delivery unavailable",
      result === "delivery-failed"
        ? "The invitation was saved but its email could not be delivered. Contact an administrator before trying again."
        : "The invitation could not be created. Please try again.",
    );
  });

  routes.post("/api/v1/workspace-invitations/register", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsed = invitationRegistrationSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Registration unavailable",
        "Check the invitation and registration fields.",
      );
    }
    const passwordHash = await services.hasher.hash(parsed.data.password);
    const result = await services.invitations.registerInvitee({
      email: parsed.data.email,
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      passwordHash,
      token: parsed.data.token,
    }).catch(() => "unavailable" as const);
    if (result === "verification-required" || result === "delivery-failed") {
      context.header(
        "Set-Cookie",
        cookie(
          "kinship_invitation",
          parsed.data.token,
          services.browserSecurity,
          24 * 60 * 60,
          "/api/v1/workspace-invitations",
        ),
      );
      context.header(
        "Set-Cookie",
        cookie(
          "kinship_invitation_pending",
          "1",
          services.browserSecurity,
          24 * 60 * 60,
          "/api/v1/email-verifications",
        ),
        { append: true },
      );
      context.header("Cache-Control", "private, no-store");
      if (result === "delivery-failed") {
        return problem(
          context,
          503,
          "invitation_verification_delivery_failed",
          "Verification email delayed",
          "Your account was created for this invitation, but the verification email could not be delivered. Retry delivery.",
        );
      }
      return context.json({ status: "verification-required" }, 202);
    }
    const gone = result === "expired" || result === "revoked" ||
      result === "used";
    return problem(
      context,
      gone ? 410 : result === "invalid" ? 404 : 409,
      gone ? `invitation_${result}` : "invitation_registration_unavailable",
      "Registration unavailable",
      gone
        ? "This invitation can no longer be used."
        : "Use the invited email address or sign in to an existing account.",
    );
  });

  routes.post(
    "/api/v1/workspace-invitations/verification-delivery",
    async (context) => {
      const forbidden = requireOrigin(context, services.browserSecurity);
      if (forbidden) return forbidden;
      const token = invitationToken(context);
      if (!token) {
        return problem(
          context,
          404,
          "invitation_invalid",
          "Verification delivery unavailable",
          "Return to the invitation and try again.",
        );
      }
      const result = await services.invitations.retryInviteeVerification(token)
        .catch(() => "delivery-failed" as const);
      if (result === "sent") {
        context.header("Cache-Control", "private, no-store");
        return context.json({ status: "accepted" }, 202);
      }
      if (result === "rate-limited") {
        return problem(
          context,
          429,
          "verification_delivery_rate_limited",
          "Verification retry delayed",
          "Wait a few minutes before requesting another verification email.",
        );
      }
      if (result === "delivery-failed") {
        return problem(
          context,
          503,
          "invitation_verification_delivery_failed",
          "Verification email delayed",
          "The verification email still could not be delivered. Please try again.",
        );
      }
      return problem(
        context,
        result === "invalid" ? 404 : 410,
        `invitation_${result}`,
        "Verification delivery unavailable",
        "This invitation can no longer continue.",
      );
    },
  );

  routes.post(
    "/api/v1/workspace-invitations/authenticate",
    async (context) => {
      const forbidden = requireOrigin(context, services.browserSecurity);
      if (forbidden) return forbidden;
      const parsed = invitationAuthenticationSchema.safeParse(
        await context.req.json().catch(() => undefined),
      );
      const token = parsed.success
        ? parsed.data.token ?? invitationToken(context)
        : undefined;
      if (!parsed.success || !token) {
        return problem(
          context,
          401,
          "invalid_credentials",
          "Sign-in failed",
          "The email address or password is incorrect.",
        );
      }
      const invitation = await services.invitations.inspect(token).catch(() =>
        undefined
      );
      if (
        !invitation || invitation.status !== "pending" ||
        invitation.email.toLowerCase() !== parsed.data.email
      ) {
        return problem(
          context,
          401,
          "invalid_credentials",
          "Sign-in failed",
          "The email address or password is incorrect.",
        );
      }
      const result = await services.protectedSessions.signIn({
        email: parsed.data.email,
        expectedEmail: invitation.email.toLowerCase(),
        identityOnly: true,
        ipAddress: clientAddress(context),
        password: parsed.data.password,
        ...(context.req.header("User-Agent")
          ? { userAgent: context.req.header("User-Agent")!.slice(0, 1_000) }
          : {}),
      }).catch(() => undefined);
      if (!result) {
        return problem(
          context,
          503,
          "authentication_unavailable",
          "Sign-in unavailable",
          "Please try again.",
        );
      }
      if (result.status === "identity-authenticated") {
        invitationContinuationCookies(
          context,
          services,
          token,
          result.entryToken,
          result.expiresAt,
        );
        context.header("Cache-Control", "private, no-store");
        return context.json({
          status: "authenticated",
          next: "/invite/continue",
        });
      }
      if (result.status === "mfa-required") {
        context.header(
          "Set-Cookie",
          cookie(
            "kinship_mfa",
            result.challengeToken,
            services.browserSecurity,
            5 * 60,
            "/api/v1/workspace-invitations/mfa",
          ),
          { append: true },
        );
        context.header(
          "Set-Cookie",
          cookie(
            "kinship_invitation",
            token,
            services.browserSecurity,
            24 * 60 * 60,
            "/api/v1/workspace-invitations",
          ),
          { append: true },
        );
        return context.json({ status: "mfa-required", next: "/auth/mfa" }, 202);
      }
      if (result.status === "rate-limited") {
        return problem(
          context,
          429,
          "authentication_rate_limited",
          "Sign-in delayed",
          "Wait before trying again.",
        );
      }
      return problem(
        context,
        401,
        "invalid_credentials",
        "Sign-in failed",
        "The email address or password is incorrect.",
      );
    },
  );

  routes.post("/api/v1/workspace-invitations/mfa", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsed = invitationMfaSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    const token = invitationToken(context);
    const challengeToken = cookieValue(
      context.req.header("Cookie"),
      "kinship_mfa",
    );
    if (!parsed.success || !token || !challengeToken) {
      return problem(
        context,
        410,
        "mfa_challenge_expired",
        "Challenge expired",
        "Return to the invitation and sign in again.",
      );
    }
    const invitation = await services.invitations.inspect(token).catch(() =>
      undefined
    );
    if (!invitation || invitation.status !== "pending") {
      return problem(
        context,
        410,
        "invitation_unavailable",
        "Invitation unavailable",
        "This invitation can no longer continue.",
      );
    }
    const result = await services.protectedSessions.completeMfa({
      challengeToken,
      expectedEmail: invitation.email.toLowerCase(),
      factor: parsed.data.factor,
      identityOnly: true,
      ipAddress: clientAddress(context),
      ...(context.req.header("User-Agent")
        ? { userAgent: context.req.header("User-Agent")!.slice(0, 1_000) }
        : {}),
    }).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "authentication_unavailable",
        "Challenge unavailable",
        "Please try again.",
      );
    }
    if (result.status === "identity-authenticated") {
      invitationContinuationCookies(
        context,
        services,
        token,
        result.entryToken,
        result.expiresAt,
      );
      context.header(
        "Set-Cookie",
        cookie(
          "kinship_mfa",
          "",
          services.browserSecurity,
          0,
          "/api/v1/workspace-invitations/mfa",
        ),
        { append: true },
      );
      context.header("Cache-Control", "private, no-store");
      return context.json({
        status: "authenticated",
        next: "/invite/continue",
      });
    }
    if (result.status === "rate-limited") {
      return problem(
        context,
        429,
        "authentication_rate_limited",
        "Challenge delayed",
        "Wait before trying again.",
      );
    }
    return problem(
      context,
      result.status === "challenge-expired" ? 410 : 401,
      result.status === "challenge-expired"
        ? "mfa_challenge_expired"
        : "invalid_mfa",
      "Challenge failed",
      result.status === "challenge-expired"
        ? "Return to the invitation and sign in again."
        : "That authenticator or recovery code is not valid.",
    );
  });

  routes.get("/api/v1/workspace-members", async (context) => {
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
    const result = await services.invitations.list({
      memberId: resolved.memberId,
      role: resolved.role,
      userId: resolved.userId,
      workspaceId: resolved.workspaceId,
    }).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "members_unavailable",
        "Members unavailable",
        "Members and invitations could not be loaded.",
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "members_forbidden",
        "Members unavailable",
        "Only an active workspace owner or admin may view this page.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  routes.post("/api/v1/workspace-invitations/inspect", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsed = optionalTokenSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    const token = parsed.success
      ? parsed.data.token ?? invitationToken(context)
      : undefined;
    if (!token) {
      return problem(
        context,
        404,
        "invitation_invalid",
        "Invitation unavailable",
        "This invitation link is invalid.",
      );
    }
    const result = await services.invitations.inspect(token).catch(
      () => undefined,
    );
    if (!result) {
      return problem(
        context,
        503,
        "invitation_unavailable",
        "Invitation unavailable",
        "The invitation could not be checked. Please try again.",
      );
    }
    if (result.status === "pending") {
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    }
    if (result.status === "invalid") {
      return problem(
        context,
        404,
        "invitation_invalid",
        "Invitation unavailable",
        "This invitation link is invalid.",
      );
    }
    return problem(
      context,
      410,
      `invitation_${result.status}`,
      "Invitation unavailable",
      result.status === "expired"
        ? "This invitation has expired."
        : result.status === "revoked"
        ? "This invitation was revoked."
        : "This invitation has already been used.",
    );
  });

  routes.post("/api/v1/workspace-invitations/accept", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsed = optionalTokenSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    const token = parsed.success
      ? parsed.data.token ?? invitationToken(context)
      : undefined;
    if (!token) {
      return problem(
        context,
        404,
        "invitation_invalid",
        "Invitation unavailable",
        "This invitation link is invalid.",
      );
    }
    const resolved = await actor(context, services);
    const entryToken = cookieValue(
      context.req.header("Cookie"),
      "kinship_entry",
    );
    if (!resolved && !entryToken) {
      return problem(
        context,
        401,
        "session_invalid",
        "Sign in required",
        "Sign in as the invited email address to accept.",
      );
    }
    const result = await (resolved
      ? services.invitations.accept({ token, userId: resolved.userId })
      : services.invitations.acceptVerifiedEntry({
        entryToken: entryToken!,
        ipAddress: clientAddress(context),
        invitationToken: token,
        ...(context.req.header("User-Agent")
          ? { userAgent: context.req.header("User-Agent")!.slice(0, 1_000) }
          : {}),
      })).catch(() =>
        undefined
      );
    if (!result) {
      return problem(
        context,
        503,
        "invitation_unavailable",
        "Invitation unavailable",
        "The invitation could not be accepted. Please try again.",
      );
    }
    if (result.status === "accepted") {
      if (
        "sessionToken" in result &&
        typeof result.sessionToken === "string" &&
        "expiresAt" in result && result.expiresAt instanceof Date
      ) {
        context.header(
          "Set-Cookie",
          cookie(
            "kinship_session",
            result.sessionToken,
            services.browserSecurity,
            (result.expiresAt.getTime() - Date.now()) / 1_000,
            "/",
          ),
          { append: true },
        );
        for (
          const [name, path] of [
            ["kinship_entry", "/api/v1/workspace-invitations"],
            ["kinship_invitation", "/api/v1/workspace-invitations"],
          ] as const
        ) {
          context.header(
            "Set-Cookie",
            cookie(name, "", services.browserSecurity, 0, path),
            { append: true },
          );
        }
      }
      context.header("Cache-Control", "private, no-store");
      return context.json({
        status: "accepted",
        next: "/app",
        workspace: { id: result.workspaceId, name: result.workspaceName },
      });
    }
    if (result.status === "wrong-user") {
      return problem(
        context,
        403,
        "invitation_wrong_user",
        "Use the invited account",
        "This invitation belongs to a different email address.",
      );
    }
    if (result.status === "already-member") {
      return problem(
        context,
        409,
        "already_member",
        "Membership already exists",
        "A membership record for this workspace already exists and this invitation was not consumed.",
      );
    }
    if (result.status === "invalid") {
      return problem(
        context,
        404,
        "invitation_invalid",
        "Invitation unavailable",
        "This invitation link is invalid.",
      );
    }
    return problem(
      context,
      410,
      `invitation_${result.status}`,
      "Invitation unavailable",
      result.status === "expired"
        ? "This invitation has expired."
        : result.status === "revoked"
        ? "This invitation was revoked."
        : "This invitation has already been used.",
    );
  });

  return routes;
}
