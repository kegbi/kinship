/**
 * Legal acceptance and the audit history: every route of this surface, once.
 *
 * Each descriptor is what `apps/api` mounts and what
 * `tools/contracts/build.ts` documents. A route the document does not describe
 * fails `deno task contracts:check`, and one that is mounted and not here, or
 * here and never mounted, fails `apps/api/routes_test.ts`.
 */

import { z } from "zod";
import { defineRoute, type RouteDescriptor } from "../registry.ts";
import {
  originAndWorkspaceHeaders,
  problemResponses,
  workspaceHeaders,
} from "./common.ts";
import {
  auditHistory,
  legalAcceptanceInput,
  legalAccepted,
  legalDocumentReady,
  legalDocumentType,
  legalRequirements,
} from "../schemas/governance.ts";
import { uuid } from "../schemas/shared.ts";

/**
 * A bounded audit search that reads its own start and end.
 *
 * Both audit routes refuse a range that ends before it starts, and
 * `apps/api/governance` refused it here rather than in the read model, so the
 * rule travels with the query string it is about.
 */
function orderedRange(
  value: {
    readonly from?: string | undefined;
    readonly to?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  if (
    value.from && value.to && Date.parse(value.from) >= Date.parse(value.to)
  ) {
    context.addIssue({
      code: "custom",
      message: "The audit start must precede its end.",
      path: ["from"],
    });
  }
}

/**
 * The cursor's lower bound, as a refinement rather than a `minLength`.
 *
 * The route has always refused an empty cursor, and the document has always
 * published the parameter without a minimum; keeping the check runtime-only
 * preserves both.
 */
const auditCursor = z.string().max(2000).refine((value) => value.length >= 1);

/** What `listWorkspaceAudit` accepts in the query string. */
export const listWorkspaceAuditQuery = z.object({
  personId: z.uuid().optional(),
  actorMemberId: z.uuid().optional(),
  action: z.string().trim().min(1).max(200).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  cursor: auditCursor.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict().superRefine(orderedRange);

export const listWorkspaceAudit = defineRoute({
  method: "get",
  path: "/api/v1/audit-events",
  operationId: "listWorkspaceAudit",
  security: [{ kinship_session: [] }],
  request: {
    query: listWorkspaceAuditQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Authorized redacted workspace audit history",
      content: {
        "application/json": auditHistory,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const acceptLegalDocument = defineRoute({
  method: "post",
  path: "/api/v1/legal-acceptances",
  operationId: "acceptLegalDocument",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": legalAcceptanceInput,
      },
    },
  },
  responses: {
    200: {
      description: "Previously recorded immutable acceptance",
      content: {
        "application/json": legalAccepted,
      },
    },
    201: {
      description: "Immutable acceptance recorded",
      content: {
        "application/json": legalAccepted,
      },
    },
    ...problemResponses(400, 401, 403, 409, 503),
  },
});

export const getPublicLegalDocument = defineRoute({
  method: "get",
  path: "/api/v1/legal-documents/{documentType}",
  operationId: "getPublicLegalDocument",
  request: {
    params: z.object({
      documentType: legalDocumentType,
    }),
  },
  responses: {
    200: {
      description: "Exact active public legal-document version",
      content: {
        "application/json": legalDocumentReady,
      },
    },
    ...problemResponses(404, 503),
  },
});

export const getLegalRequirements = defineRoute({
  method: "get",
  path: "/api/v1/legal-requirements",
  operationId: "getLegalRequirements",
  security: [{ kinship_session: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description:
        "Unaccepted active versions for the current identity and workspace",
      content: {
        "application/json": legalRequirements,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

/** What `listPersonAudit` accepts in the query string. */
export const listPersonAuditQuery = z.object({
  actorMemberId: z.uuid().optional(),
  action: z.string().trim().min(1).max(200).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  cursor: auditCursor.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict().superRefine(orderedRange);

export const listPersonAudit = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/audit",
  operationId: "listPersonAudit",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    query: listPersonAuditQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Authorized redacted person audit history",
      content: {
        "application/json": auditHistory,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

/** Every governance route, in the order the surface mounts them. */
export const GOVERNANCE_ROUTES: readonly RouteDescriptor[] = [
  listWorkspaceAudit,
  acceptLegalDocument,
  getPublicLegalDocument,
  getLegalRequirements,
  listPersonAudit,
];
