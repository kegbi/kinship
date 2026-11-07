/**
 * Registering, verifying an address, and entering the application, over HTTP.
 *
 * Four routes that run before anybody has a session, which is why this is the
 * one file with no actor in it at all. The problem responder, the cookie
 * composer, and the origin comparison came from `packages/http-kit` (GAP-019, GAP-020),
 * and the four paths with the shapes they accept came from
 * `packages/contracts` (GAP-022), so what this file mounts and what the
 * document publishes are the one description.
 *
 * The cookies are the substance. `kinship_registrant` is the registering
 * browser's verifier (SECA-01), scoped to the verification route: a
 * verification that carries it enters the application, and one that does not
 * still proves the address but is sent to choose a password, because the
 * password on the account was chosen by whoever registered. `kinship_entry`
 * is a one-use handoff scoped to the single route that consumes it, so a
 * verified link cannot be replayed anywhere else; `kinship_invitation_pending`
 * is scoped to the verification route alone and is cleared the moment it is
 * read, which is what makes a verified invitee land on the invitation rather
 * than the application; and `kinship_session` is only ever set once the entry
 * handoff has been spent.
 *
 * Registration never says whether an address already has an account
 * (SECA-02), and the three public writes — registering, verifying, and asking
 * for another link — refuse a request from any other origin (SECA-13).
 */

import { type Context, Hono } from "hono";
import type { PasswordHasher } from "../../../identity/public.ts";
import type { EmailVerificationFacade } from "../../../identity/public.ts";
import type { BrowserSecurityPolicy } from "../../../../../http-kit/security_policy.ts";
import {
  type FirstWorkspaceRegistrationCommand,
  type FirstWorkspaceRegistrationResult,
  type ProtectedSessionResult,
  RegistrationError,
} from "../../public.ts";
import {
  consumeApplicationEntry,
  createFirstWorkspace,
  retryVerificationDelivery,
  verifyEmail,
} from "../../../../../contracts/routes/registration.ts";
import {
  registrationInput,
  verificationDeliveryInput,
  verificationInput,
} from "../../../../../contracts/schemas/registration.ts";
import {
  cookieValue,
  SESSION_COOKIE,
  setCookie,
} from "../../../../../http-kit/cookies.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import {
  matchingOrigin,
  requireMatchingOrigin,
} from "../../../../../http-kit/origin.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import { parseJsonBody } from "../../../../../http-kit/validate.ts";
import {
  newRegistrantVerifier,
  REGISTRANT_COOKIE,
  registrantCookie,
} from "./registrant_cookie.ts";

/** The cookie that carries a verified identity to the application entry. */
const ENTRY_COOKIE = "kinship_entry";
/** The cookie that says a verification belongs to an invitation. */
const INVITATION_PENDING_COOKIE = "kinship_invitation_pending";
/** The one route the entry handoff may be spent on. */
const ENTRY_PATH = "/api/v1/application-entry";
/** The route a verified invitee is sent to instead. */
const INVITATION_PATH = "/api/v1/workspace-invitations";
/** The route the pending-invitation marker is scoped to. */
const VERIFICATION_PATH = "/api/v1/email-verifications";
/** How long a verified identity has to enter the application. */
const ENTRY_COOKIE_SECONDS = 600;

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

/**
 * What a verification link that cannot be used says.
 *
 * All three say the same sentence on purpose: a caller learns that the link is
 * spent, and the `code` tells the page which of "expired", "already used", or
 * "not a link at all" to explain.
 */
export const VERIFICATION_FAILURES: FailureTable = {
  fallback: {
    code: "invalid_verification",
    detail: "This verification link cannot be used.",
    status: 409,
    title: "Email not verified",
  },
  statuses: {
    expired: {
      code: "verification_expired",
      detail: "This verification link cannot be used.",
      status: 410,
      title: "Email not verified",
    },
    replayed: {
      code: "verification_replayed",
      detail: "This verification link cannot be used.",
      status: 409,
      title: "Email not verified",
    },
  },
};

const verificationFailure = failureResponder(VERIFICATION_FAILURES);

const REGISTRATION_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Check the highlighted fields.",
  status: 400,
  title: "Invalid registration",
};
const VERIFICATION_DELIVERY_FAILED: ProblemDefinition = {
  code: "verification_delivery_failed",
  detail:
    "Your account was created with its workspace, but the verification email could not be delivered. Retry delivery.",
  status: 503,
  title: "Verification email delayed",
};
const REGISTRATION_FAILED: ProblemDefinition = {
  code: "registration_failed",
  detail: "Nothing was created. Please try again.",
  status: 503,
  title: "Registration unavailable",
};
const VERIFICATION_LINK_INVALID: ProblemDefinition = {
  code: "invalid_verification",
  detail: "Request a new verification link.",
  status: 400,
  title: "Verification link invalid",
};
const VERIFICATION_UNAVAILABLE: ProblemDefinition = {
  code: "verification_unavailable",
  detail: "Email verification is temporarily unavailable. Please try again.",
  status: 503,
  title: "Verification unavailable",
};
const ENTRY_ORIGIN_INVALID: ProblemDefinition = {
  code: "origin_invalid",
  detail: "This request did not come from the configured application origin.",
  status: 403,
  title: "Application entry forbidden",
};
const ENTRY_HANDOFF_MISSING: ProblemDefinition = {
  code: "entry_handoff_invalid",
  detail: "Use the link from a completed verification.",
  status: 409,
  title: "Application entry unavailable",
};
const ENTRY_HANDOFF_UNAVAILABLE: ProblemDefinition = {
  code: "entry_handoff_unavailable",
  detail: "Application entry is temporarily unavailable. Please try again.",
  status: 503,
  title: "Application entry unavailable",
};
const ENTRY_HANDOFF_SPENT: ProblemDefinition = {
  code: "entry_handoff_invalid",
  detail: "This application-entry handoff cannot be used.",
  status: 409,
  title: "Application entry unavailable",
};
const ENTRY_WORKSPACE_INACTIVE: ProblemDefinition = {
  code: "entry_handoff_invalid",
  detail: "Workspace access is no longer active.",
  status: 409,
  title: "Application entry unavailable",
};
const DELIVERY_REQUEST_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Provide a valid email address.",
  status: 400,
  title: "Invalid delivery request",
};

/** Every problem this file answers on its own, for the pinning suite. */
export const REGISTRATION_PROBLEMS: readonly ProblemDefinition[] = [
  DELIVERY_REQUEST_INVALID,
  ENTRY_HANDOFF_MISSING,
  ENTRY_HANDOFF_SPENT,
  ENTRY_HANDOFF_UNAVAILABLE,
  ENTRY_ORIGIN_INVALID,
  ENTRY_WORKSPACE_INACTIVE,
  REGISTRATION_FAILED,
  REGISTRATION_INVALID,
  VERIFICATION_DELIVERY_FAILED,
  VERIFICATION_LINK_INVALID,
  VERIFICATION_UNAVAILABLE,
];

/** The entry handoff cookie, scoped to the one route that may spend it. */
function entryCookie(
  policy: BrowserSecurityPolicy,
  value: string,
  maxAgeSeconds: number,
  path: string = ENTRY_PATH,
): string {
  return setCookie(policy, {
    maxAgeSeconds,
    name: ENTRY_COOKIE,
    path,
    value,
  });
}

export function createRegistrationRoutes(
  services: RegistrationHttpServices,
): Hono {
  const routes = new Hono();
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(routes, createFirstWorkspace, origin, async (context) => {
    const parsed = await parseJsonBody(context, registrationInput);
    if ("errors" in parsed) {
      return definedProblem(context, REGISTRATION_INVALID, parsed.errors);
    }
    const registrantVerifier = newRegistrantVerifier();
    try {
      const passwordHash = await services.hasher.hash(parsed.data.password);
      const result = await services.register({
        email: parsed.data.email,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        passwordHash,
        registrantVerifier,
        workspaceName: parsed.data.workspaceName,
      });
      context.header(
        "Set-Cookie",
        registrantCookie(services.browserSecurity, registrantVerifier),
      );
      context.header("Cache-Control", "no-store");
      return context.json({ status: result.status }, 202);
    } catch (error) {
      if (
        !(error instanceof RegistrationError) &&
        typeof error === "object" && error !== null && "code" in error &&
        error.code === "verification_delivery_failed"
      ) {
        context.header(
          "Set-Cookie",
          registrantCookie(services.browserSecurity, registrantVerifier),
        );
        return definedProblem(context, VERIFICATION_DELIVERY_FAILED);
      }
      return definedProblem(context, REGISTRATION_FAILED);
    }
  });

  mount(routes, verifyEmail, origin, async (context) => {
    const parsed = await parseJsonBody(context, verificationInput);
    if ("errors" in parsed) {
      return definedProblem(context, VERIFICATION_LINK_INVALID);
    }
    const registrantVerifier = cookieValue(
      context.req.header("Cookie"),
      REGISTRANT_COOKIE,
    );
    let result;
    try {
      result = await services.verification.verify(
        parsed.data.token,
        registrantVerifier || undefined,
      );
    } catch {
      return definedProblem(context, VERIFICATION_UNAVAILABLE);
    }
    if (result.status === "password-required") {
      context.header("Cache-Control", "no-store");
      return context.json({
        status: "password-required",
        next: `/auth/reset-password?token=${
          encodeURIComponent(result.resetToken)
        }`,
      });
    }
    if (result.status !== "verified") {
      return verificationFailure(context, result);
    }
    const hasInvitation = cookieValue(
      context.req.header("Cookie"),
      INVITATION_PENDING_COOKIE,
    ) !== undefined;
    context.header(
      "Set-Cookie",
      entryCookie(
        services.browserSecurity,
        result.entryToken,
        ENTRY_COOKIE_SECONDS,
        hasInvitation ? INVITATION_PATH : ENTRY_PATH,
      ),
    );
    context.header("Cache-Control", "no-store");
    context.header(
      "Set-Cookie",
      registrantCookie(services.browserSecurity, ""),
      { append: true },
    );
    if (hasInvitation) {
      context.header(
        "Set-Cookie",
        setCookie(services.browserSecurity, {
          maxAgeSeconds: 0,
          name: INVITATION_PENDING_COOKIE,
          path: VERIFICATION_PATH,
          value: "",
        }),
        { append: true },
      );
    }
    return context.json({
      status: "verified",
      next: hasInvitation ? "/invite/continue" : "/app",
    });
  });

  mount(routes, consumeApplicationEntry, async (context) => {
    if (!matchingOrigin(context, services.browserSecurity)) {
      return definedProblem(context, ENTRY_ORIGIN_INVALID);
    }
    const entryToken = cookieValue(context.req.header("Cookie"), ENTRY_COOKIE);
    if (!entryToken) {
      return definedProblem(context, ENTRY_HANDOFF_MISSING);
    }
    let applicationContext;
    try {
      applicationContext = await services.verification
        .consumeApplicationEntry(entryToken);
    } catch {
      return definedProblem(context, ENTRY_HANDOFF_UNAVAILABLE);
    }
    context.header(
      "Set-Cookie",
      entryCookie(services.browserSecurity, "", 0),
    );
    context.header("Cache-Control", "private, no-store");
    if (!applicationContext) {
      return definedProblem(context, ENTRY_HANDOFF_SPENT);
    }
    const establish = services.establishVerifiedEntry;
    if (establish) {
      const refused = await establishSession(
        context,
        services.browserSecurity,
        establish,
        applicationContext.userId,
      );
      if (refused) return refused;
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

  mount(routes, retryVerificationDelivery, origin, async (context) => {
    const parsed = await parseJsonBody(context, verificationDeliveryInput);
    if ("errors" in parsed) {
      return definedProblem(context, DELIVERY_REQUEST_INVALID);
    }
    await services.retryVerificationDelivery?.(parsed.data.email).catch(() =>
      undefined
    );
    context.header("Cache-Control", "no-store");
    return context.json({ status: "accepted" }, 202);
  });

  return routes;
}

/**
 * The session a spent entry handoff establishes, or the refusal instead.
 *
 * The cookie is appended rather than set, because the cleared entry cookie is
 * already on the response by the time this runs.
 */
async function establishSession(
  context: Context,
  policy: BrowserSecurityPolicy,
  establish: NonNullable<RegistrationHttpServices["establishVerifiedEntry"]>,
  userId: string,
): Promise<Response | undefined> {
  let session;
  try {
    const previousSessionToken = cookieValue(
      context.req.header("Cookie"),
      SESSION_COOKIE,
    );
    const userAgent = context.req.header("User-Agent")?.slice(0, 1_000);
    session = await establish({
      ...(previousSessionToken ? { previousSessionToken } : {}),
      ...(userAgent ? { userAgent } : {}),
      userId,
    });
  } catch {
    return definedProblem(context, ENTRY_HANDOFF_UNAVAILABLE);
  }
  if (session.status !== "authenticated") {
    return definedProblem(context, ENTRY_WORKSPACE_INACTIVE);
  }
  context.header(
    "Set-Cookie",
    setCookie(policy, {
      maxAgeSeconds: (session.expiresAt.getTime() - Date.now()) / 1_000,
      name: SESSION_COOKIE,
      path: "/",
      value: session.sessionToken,
    }),
    { append: true },
  );
  return undefined;
}
