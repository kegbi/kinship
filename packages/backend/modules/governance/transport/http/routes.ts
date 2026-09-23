/**
 * Legal documents, acceptance, and the audit history, over HTTP.
 *
 * Two surfaces that share nothing but an actor: the legal documents every
 * member has to accept, and the audit history only an administrator may read.
 * The problem responder, the session cookie, the origin check, the client
 * address, and the kernel status map came from `packages/http-kit` (GAP-019, GAP-020).
 *
 * `createLegalRequirementGuard` is the reason this file resolves a session
 * without the middleware. It runs in front of everything, before any route's
 * own session handling, and it is the one place in the API that must tell
 * "nobody is signed in" from "the session store is down": the first passes an
 * anonymous request through to the route that will refuse it, and the second
 * refuses everything, because a guard that cannot see whether a document is
 * outstanding must not decide that none is.
 */

import { type Context, Hono, type MiddlewareHandler } from "hono";
import type { AuditHistory } from "../../../../read-models/audit-history/public.ts";
import type { LegalAcceptance } from "../../public.ts";
import type { createProtectedSessionCoordinator } from "../../../workspaces/public.ts";
import {
  acceptLegalDocument,
  getLegalRequirements,
  getPublicLegalDocument,
  listPersonAudit,
  listPersonAuditQuery,
  listWorkspaceAudit,
  listWorkspaceAuditQuery,
} from "../../../../../contracts/routes/governance.ts";
import {
  legalAcceptanceInput,
  legalDocumentType,
} from "../../../../../contracts/schemas/governance.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import type { BrowserSecurityPolicy } from "../../../../../http-kit/security_policy.ts";
import { trustedClientAddress } from "../../../../../http-kit/client_address.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import { rejectForeignOrigin } from "../../../../../http-kit/origin.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  readActor,
  requireActor,
  sessionActor,
} from "../../../../../http-kit/session.ts";
import {
  parseJsonBody,
  parseQuery,
  parseValue,
} from "../../../../../http-kit/validate.ts";

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

/** What a refused audit search says. */
export const AUDIT_FAILURES: FailureTable = {
  fallback: {
    code: "audit_unavailable",
    detail: "No historical data was changed. Try again.",
    status: 503,
    title: "Audit history unavailable",
  },
  statuses: {
    forbidden: {
      code: "audit_forbidden",
      detail:
        "Audit history requires an active owner or administrator membership.",
      title: "Audit history unavailable",
    },
    "not-found": {
      code: "audit_scope_not_found",
      detail:
        "The selected audit scope does not exist in the active workspace.",
      title: "Audit history unavailable",
    },
    "stale-cursor": {
      code: "audit_cursor_stale",
      detail: "Restart this bounded audit search.",
      status: 409,
      title: "Audit page changed",
    },
  },
};

const auditFailure = failureResponder(AUDIT_FAILURES);

const AUDIT_QUERY_INVALID: ProblemDefinition = {
  code: "audit_query_invalid",
  detail:
    "Use canonical identifiers, an ordered time range, and a bounded page size.",
  status: 400,
  title: "Invalid audit search",
};
const LEGAL_UNAVAILABLE: ProblemDefinition = {
  code: "legal_unavailable",
  detail: "Required legal documents cannot be confirmed right now.",
  status: 503,
  title: "Legal review unavailable",
};
const LEGAL_SESSION_INVALID: ProblemDefinition = {
  code: "session_invalid",
  detail: "The session or workspace access is no longer active.",
  status: 401,
  title: "Authentication required",
};
const LEGAL_ACCEPTANCE_REQUIRED: ProblemDefinition = {
  code: "legal_acceptance_required",
  detail: "Review and accept the required legal document before continuing.",
  status: 403,
  title: "Legal acceptance required",
};
const LEGAL_DOCUMENT_NOT_FOUND: ProblemDefinition = {
  code: "legal_document_not_found",
  detail: "This legal document is not published.",
  status: 404,
  title: "Legal document unavailable",
};
const LEGAL_DOCUMENT_UNAVAILABLE: ProblemDefinition = {
  code: "legal_document_unavailable",
  detail: "The published document cannot be loaded right now.",
  status: 503,
  title: "Legal document unavailable",
};
const LEGAL_REVIEW_FORBIDDEN: ProblemDefinition = {
  code: "legal_forbidden",
  detail: "Your active workspace membership no longer permits this review.",
  status: 403,
  title: "Legal review unavailable",
};
const LEGAL_ACCEPTANCE_INVALID: ProblemDefinition = {
  code: "legal_acceptance_invalid",
  detail: "Accept one exact legal document version.",
  status: 400,
  title: "Invalid acceptance",
};
const LEGAL_ACCEPTANCE_FORBIDDEN: ProblemDefinition = {
  code: "legal_forbidden",
  detail: "Your active workspace membership no longer permits acceptance.",
  status: 403,
  title: "Acceptance forbidden",
};
const LEGAL_DOCUMENT_SUPERSEDED: ProblemDefinition = {
  code: "legal_document_superseded",
  detail: "Review the currently required version before continuing.",
  status: 409,
  title: "Document version changed",
};
const LEGAL_ACCEPTANCE_UNAVAILABLE: ProblemDefinition = {
  code: "legal_unavailable",
  detail: "No acceptance was recorded. Try again.",
  status: 503,
  title: "Acceptance unavailable",
};

/** Every problem this file answers on its own, for the pinning suite. */
export const GOVERNANCE_PROBLEMS: readonly ProblemDefinition[] = [
  AUDIT_QUERY_INVALID,
  LEGAL_ACCEPTANCE_FORBIDDEN,
  LEGAL_ACCEPTANCE_INVALID,
  LEGAL_ACCEPTANCE_REQUIRED,
  LEGAL_ACCEPTANCE_UNAVAILABLE,
  LEGAL_DOCUMENT_NOT_FOUND,
  LEGAL_DOCUMENT_SUPERSEDED,
  LEGAL_DOCUMENT_UNAVAILABLE,
  LEGAL_REVIEW_FORBIDDEN,
  LEGAL_SESSION_INVALID,
  LEGAL_UNAVAILABLE,
];

/**
 * The routes that may be reached with a legal document outstanding.
 *
 * Everything needed to read the document, accept it, sign in, sign out, or
 * establish the session that will be asked to accept it. A route not named
 * here is refused until the outstanding document is accepted.
 */
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
    const resolved = await readActor(context, services.protectedSessions).catch(
      () => "unavailable" as const,
    );
    if (resolved === "unavailable") {
      return definedProblem(context, LEGAL_UNAVAILABLE);
    }
    if (!resolved) {
      return next();
    }
    const requirements = await services.legal.requirements(resolved);
    if (requirements.status === "unavailable") {
      return definedProblem(context, LEGAL_UNAVAILABLE);
    }
    if (requirements.status === "forbidden") {
      return definedProblem(context, LEGAL_SESSION_INVALID);
    }
    if (requirements.documents.length > 0) {
      return definedProblem(context, LEGAL_ACCEPTANCE_REQUIRED);
    }
    return next();
  };
}

/**
 * The person a workspace-wide search names in its query string.
 *
 * The person route has no such parameter — its subject is the path — so this
 * reads the member the two documented query strings do not share.
 */
function queriedPersonId(query: object): string | undefined {
  return "personId" in query && typeof query.personId === "string"
    ? query.personId
    : undefined;
}

function auditRoute(services: GovernanceHttpServices, routePerson: boolean) {
  return async (context: Context<ActorEnv>) => {
    // The person route takes its subject from the path, so its documented
    // query string has no `personId` at all; the workspace one does.
    const input = routePerson
      ? parseQuery(context, listPersonAuditQuery)
      : parseQuery(context, listWorkspaceAuditQuery);
    const personId = routePerson
      ? parseValue(uuid, context.req.param("personId"))
      : undefined;
    if ("errors" in input) return definedProblem(context, AUDIT_QUERY_INVALID);
    if (personId && "errors" in personId) {
      return definedProblem(context, AUDIT_QUERY_INVALID);
    }
    const queried = queriedPersonId(input.data);
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.auditHistory!.list(actor, {
      ...(input.data.action ? { action: input.data.action } : {}),
      ...(input.data.actorMemberId
        ? { actorMemberId: input.data.actorMemberId }
        : {}),
      ...(input.data.cursor ? { cursor: input.data.cursor } : {}),
      ...(input.data.from ? { from: input.data.from } : {}),
      limit: input.data.limit,
      ...(personId
        ? { personId: personId.data }
        : queried
        ? { personId: queried }
        : {}),
      ...(input.data.to ? { to: input.data.to } : {}),
    }).catch(() => undefined);
    if (
      !result || result.status === "forbidden" ||
      result.status === "not-found" || result.status === "stale-cursor"
    ) return auditFailure(context, result ?? "unavailable");
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  };
}

export function createGovernanceRoutes(
  services: GovernanceHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const policy = services.browserSecurity;
  if (services.legal) {
    const legal = services.legal;
    mount(routes, getPublicLegalDocument, async (context) => {
      const parsed = parseValue(
        legalDocumentType,
        context.req.param("documentType"),
      );
      if ("errors" in parsed) {
        return definedProblem(context, LEGAL_DOCUMENT_NOT_FOUND);
      }
      const result = await legal.publicDocument(parsed.data);
      if (result.status === "not-found") {
        return definedProblem(context, LEGAL_DOCUMENT_NOT_FOUND);
      }
      if (result.status === "unavailable") {
        return definedProblem(context, LEGAL_DOCUMENT_UNAVAILABLE);
      }
      context.header("Cache-Control", "public, max-age=300");
      return context.json(result);
    });
    mount(routes, getLegalRequirements, session, async (context) => {
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await legal.requirements(actor);
      if (result.status === "forbidden") {
        return definedProblem(context, LEGAL_REVIEW_FORBIDDEN);
      }
      if (result.status === "unavailable") {
        return definedProblem(context, LEGAL_UNAVAILABLE);
      }
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    });
    mount(routes, acceptLegalDocument, session, async (context) => {
      const foreign = policy && rejectForeignOrigin(context, policy);
      if (foreign) return foreign;
      const parsed = await parseJsonBody(context, legalAcceptanceInput);
      if ("errors" in parsed) {
        return definedProblem(context, LEGAL_ACCEPTANCE_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const ipAddress = trustedClientAddress(context);
      const result = await legal.accept(actor, {
        documentId: parsed.data.documentId,
        ...(ipAddress ? { ipAddress } : {}),
      });
      if (result.status === "forbidden") {
        return definedProblem(context, LEGAL_ACCEPTANCE_FORBIDDEN);
      }
      if (result.status === "superseded-version") {
        return definedProblem(context, LEGAL_DOCUMENT_SUPERSEDED);
      }
      if (result.status === "unavailable") {
        return definedProblem(context, LEGAL_ACCEPTANCE_UNAVAILABLE);
      }
      context.header("Cache-Control", "private, no-store");
      return context.json(result, result.status === "accepted" ? 201 : 200);
    });
  }
  if (services.auditHistory) {
    mount(routes, listWorkspaceAudit, session, auditRoute(services, false));
    mount(
      routes,
      listPersonAudit,
      session,
      auditRoute(services, true),
    );
  }
  return routes;
}
