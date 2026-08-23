import { type Context, Hono, type MiddlewareHandler } from "hono";
import { isIP } from "node:net";
import { z } from "zod";
import type { AuditHistory } from "../../packages/backend/read-models/audit-history/public.ts";
import type { LegalAcceptance } from "../../packages/backend/modules/governance/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface GovernanceHttpServices {
  readonly auditHistory?: AuditHistory;
  readonly browserSecurity?: BrowserSecurityPolicy;
  readonly legal?: LegalAcceptance;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
}

export interface LegalRequirementGuardServices {
  readonly legal: LegalAcceptance;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
}

const id = z.uuid();
const acceptanceInput = z.object({ documentId: id }).strict();
const query = z.object({
  action: z.string().trim().min(1).max(200).optional(),
  actorMemberId: id.optional(),
  cursor: z.string().min(1).max(2_000).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  personId: id.optional(),
  to: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((value, context) => {
  if (
    value.from && value.to && Date.parse(value.from) >= Date.parse(value.to)
  ) {
    context.addIssue({
      code: "custom",
      message: "The audit start must precede its end.",
      path: ["from"],
    });
  }
});

function problem(
  context: Context,
  status: 400 | 401 | 403 | 404 | 409 | 503,
  code: string,
  title: string,
  detail: string,
) {
  return context.json(
    {
      code,
      detail,
      status,
      title,
      type: `https://kinship.invalid/problems/${code}`,
    },
    status,
    {
      "Cache-Control": "no-store",
      "Content-Type": "application/problem+json",
    },
  );
}

function requireOrigin(
  context: Context,
  policy: BrowserSecurityPolicy | undefined,
) {
  return policy && context.req.header("Origin") !== policy.origin
    ? problem(
      context,
      403,
      "origin_invalid",
      "Request forbidden",
      "This request did not come from the configured application origin.",
    )
    : undefined;
}

function trustedClientAddress(context: Context): string | undefined {
  const supplied = context.req.header("X-Kinship-Client-Address");
  return supplied && supplied.length <= 64 && isIP(supplied) !== 0
    ? supplied
    : undefined;
}

function cookieValue(header: string | undefined, name: string) {
  return header?.split(";").map((value) => value.trim()).find((value) =>
    value.startsWith(`${name}=`)
  )?.slice(name.length + 1);
}

async function resolveActor(
  context: Context,
  services: GovernanceHttpServices,
) {
  const sessionToken = cookieValue(
    context.req.header("Cookie"),
    "kinship_session",
  );
  if (!sessionToken) return undefined;
  const requestedWorkspaceId = context.req.header("X-Workspace-Id");
  const resolved = await services.protectedSessions.resolve({
    sessionToken,
    ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
  });
  return resolved && {
    memberId: resolved.memberId,
    role: resolved.role,
    userId: resolved.userId,
    workspaceId: resolved.workspaceId,
  };
}

function actor(context: Context, services: GovernanceHttpServices) {
  return resolveActor(context, services).catch(() => undefined);
}

const legalGuardExemptions = new Set([
  "GET /api/v1/health",
  "GET /api/v1/legal-requirements",
  "GET /api/v1/session",
  "POST /api/v1/application-entry",
  "POST /api/v1/email-verification-deliveries",
  "POST /api/v1/email-verifications",
  "POST /api/v1/legal-acceptances",
  "POST /api/v1/mfa-challenges",
  "POST /api/v1/password-reset-requests",
  "POST /api/v1/password-resets",
  "POST /api/v1/registrations",
  "POST /api/v1/sessions",
  "POST /api/v1/sign-out",
]);

export function createLegalRequirementGuard(
  services: LegalRequirementGuardServices,
): MiddlewareHandler {
  return async (context, next) => {
    const key = `${context.req.method} ${context.req.path}`;
    if (
      legalGuardExemptions.has(key) ||
      (context.req.method === "GET" &&
        /^\/api\/v1\/legal-documents\/(privacy|terms)$/.test(context.req.path))
    ) {
      return next();
    }
    const resolved = await resolveActor(context, services).catch(() =>
      "unavailable" as const
    );
    if (resolved === "unavailable") {
      return problem(
        context,
        503,
        "legal_unavailable",
        "Legal review unavailable",
        "Required legal documents cannot be confirmed right now.",
      );
    }
    if (!resolved) {
      return next();
    }
    const requirements = await services.legal.requirements(resolved);
    if (requirements.status === "unavailable") {
      return problem(
        context,
        503,
        "legal_unavailable",
        "Legal review unavailable",
        "Required legal documents cannot be confirmed right now.",
      );
    }
    if (requirements.status === "forbidden") {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "The session or workspace access is no longer active.",
      );
    }
    if (requirements.documents.length > 0) {
      return problem(
        context,
        403,
        "legal_acceptance_required",
        "Legal acceptance required",
        "Review and accept the required legal document before continuing.",
      );
    }
    return next();
  };
}

function failure(
  context: Context,
  status: "forbidden" | "not-found" | "stale-cursor",
) {
  if (status === "forbidden") {
    return problem(
      context,
      403,
      "audit_forbidden",
      "Audit history unavailable",
      "Audit history requires an active owner or administrator membership.",
    );
  }
  if (status === "not-found") {
    return problem(
      context,
      404,
      "audit_scope_not_found",
      "Audit history unavailable",
      "The selected audit scope does not exist in the active workspace.",
    );
  }
  return problem(
    context,
    409,
    "audit_cursor_stale",
    "Audit page changed",
    "Restart this bounded audit search.",
  );
}

function auditRoute(
  services: GovernanceHttpServices,
  routePerson: boolean,
) {
  return async (context: Context) => {
    const input = query.safeParse(context.req.query());
    const personId = routePerson
      ? id.safeParse(context.req.param("personId"))
      : undefined;
    if (!input.success || (personId && !personId.success)) {
      return problem(
        context,
        400,
        "audit_query_invalid",
        "Invalid audit search",
        "Use canonical identifiers, an ordered time range, and a bounded page size.",
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
    const result = await services.auditHistory!.list(resolved, {
      ...(input.data.action ? { action: input.data.action } : {}),
      ...(input.data.actorMemberId
        ? { actorMemberId: input.data.actorMemberId }
        : {}),
      ...(input.data.cursor ? { cursor: input.data.cursor } : {}),
      ...(input.data.from ? { from: input.data.from } : {}),
      limit: input.data.limit,
      ...(personId?.success
        ? { personId: personId.data }
        : input.data.personId
        ? { personId: input.data.personId }
        : {}),
      ...(input.data.to ? { to: input.data.to } : {}),
    }).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "audit_unavailable",
        "Audit history unavailable",
        "No historical data was changed. Try again.",
      );
    }
    if (
      result.status === "forbidden" || result.status === "not-found" ||
      result.status === "stale-cursor"
    ) return failure(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  };
}

export function createGovernanceRoutes(
  services: GovernanceHttpServices,
): Hono {
  const routes = new Hono();
  if (services.legal) {
    routes.get("/api/v1/legal-documents/:documentType", async (context) => {
      const parsed = z.enum(["privacy", "terms"]).safeParse(
        context.req.param("documentType"),
      );
      if (!parsed.success) {
        return problem(
          context,
          404,
          "legal_document_not_found",
          "Legal document unavailable",
          "This legal document is not published.",
        );
      }
      const result = await services.legal!.publicDocument(parsed.data);
      if (result.status === "not-found") {
        return problem(
          context,
          404,
          "legal_document_not_found",
          "Legal document unavailable",
          "This legal document is not published.",
        );
      }
      if (result.status === "unavailable") {
        return problem(
          context,
          503,
          "legal_document_unavailable",
          "Legal document unavailable",
          "The published document cannot be loaded right now.",
        );
      }
      context.header("Cache-Control", "public, max-age=300");
      return context.json(result);
    });
    routes.get("/api/v1/legal-requirements", async (context) => {
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
      const result = await services.legal!.requirements(resolved);
      if (result.status === "forbidden") {
        return problem(
          context,
          403,
          "legal_forbidden",
          "Legal review unavailable",
          "Your active workspace membership no longer permits this review.",
        );
      }
      if (result.status === "unavailable") {
        return problem(
          context,
          503,
          "legal_unavailable",
          "Legal review unavailable",
          "Required legal documents cannot be confirmed right now.",
        );
      }
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    });
    routes.post("/api/v1/legal-acceptances", async (context) => {
      const origin = requireOrigin(context, services.browserSecurity);
      if (origin) return origin;
      const body = acceptanceInput.safeParse(
        await context.req.json().catch(() => undefined),
      );
      if (!body.success) {
        return problem(
          context,
          400,
          "legal_acceptance_invalid",
          "Invalid acceptance",
          "Accept one exact legal document version.",
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
      const ipAddress = trustedClientAddress(context);
      const result = await services.legal!.accept(resolved, {
        documentId: body.data.documentId,
        ...(ipAddress ? { ipAddress } : {}),
      });
      if (result.status === "forbidden") {
        return problem(
          context,
          403,
          "legal_forbidden",
          "Acceptance forbidden",
          "Your active workspace membership no longer permits acceptance.",
        );
      }
      if (result.status === "superseded-version") {
        return problem(
          context,
          409,
          "legal_document_superseded",
          "Document version changed",
          "Review the currently required version before continuing.",
        );
      }
      if (result.status === "unavailable") {
        return problem(
          context,
          503,
          "legal_unavailable",
          "Acceptance unavailable",
          "No acceptance was recorded. Try again.",
        );
      }
      context.header("Cache-Control", "private, no-store");
      return context.json(result, result.status === "accepted" ? 201 : 200);
    });
  }
  if (services.auditHistory) {
    routes.get("/api/v1/audit-events", auditRoute(services, false));
    routes.get(
      "/api/v1/people/:personId/audit",
      auditRoute(services, true),
    );
  }
  return routes;
}
