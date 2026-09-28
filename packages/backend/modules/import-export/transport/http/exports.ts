/**
 * Exporting a workspace, and one person's vCard, over HTTP.
 *
 * Five routes: the history, the two steps that turn it into a link, the link
 * itself, and a single person's card. The problem responder, the session
 * cookie, the origin check, the kernel status map, and the download response
 * came from `packages/http-kit` (GAP-019, GAP-020).
 *
 * The two routes that serve bytes are opened from a link, not from the
 * application, so they take the workspace from the query string rather than
 * from the header the rest of the API uses, and they resolve the session
 * themselves for that reason. Every outage names what did not happen — history
 * not loaded, artifact not completed, reference not issued, artifact not read
 * — because each is a different thing to retry.
 */

import { Hono } from "hono";
import type { ExportManagement } from "../../public.ts";
import type { createProtectedSessionCoordinator } from "../../../workspaces/public.ts";
import {
  createExportDownload,
  createWorkspaceExport,
  downloadExport,
  downloadExportQuery,
  exportPersonVCard,
  exportPersonVCardQuery,
  listExports,
} from "../../../../../contracts/routes/exports.ts";
import { exportRequest } from "../../../../../contracts/schemas/exports.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import type { BrowserSecurityPolicy } from "../../../../../http-kit/security_policy.ts";
import { fileDownload } from "../../../../../http-kit/downloads.ts";
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
  requireActor,
  SESSION_INVALID,
  sessionActor,
  workspaceScopedActor,
} from "../../../../../http-kit/session.ts";
import { parseQuery, parseValue } from "../../../../../http-kit/validate.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;
export interface ExportHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly exports: ExportManagement;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
}

const EXPORT_NOT_FOUND: ProblemDefinition = {
  code: "export_not_found",
  detail: "This export does not exist in the active workspace.",
  status: 404,
  title: "Export unavailable",
};

/** What a refused export says. */
export const EXPORT_FAILURES: FailureTable = {
  fallback: EXPORT_NOT_FOUND,
  statuses: {
    expired: {
      code: "export_download_expired",
      detail:
        "Create a new short-lived download reference from export history.",
      status: 410,
      title: "Download expired",
    },
    forbidden: {
      code: "export_forbidden",
      detail:
        "Workspace export is available to owners and administrators only.",
      title: "Export unavailable",
    },
    "not-found": {
      code: EXPORT_NOT_FOUND.code,
      detail: EXPORT_NOT_FOUND.detail,
      title: EXPORT_NOT_FOUND.title,
    },
    "too-large": {
      code: "export_too_large",
      detail: "This portable profile supports at most 500 people.",
      status: 413,
      title: "Export too large",
    },
  },
};

const failure = failureResponder(EXPORT_FAILURES);

const EXPORT_FORMAT_INVALID: ProblemDefinition = {
  code: "export_format_invalid",
  detail: "Choose JSON, CSV, or vCard.",
  status: 400,
  title: "Export format invalid",
};
const EXPORT_HISTORY_UNAVAILABLE: ProblemDefinition = {
  code: "exports_unavailable",
  detail: "Export history could not be loaded.",
  status: 503,
  title: "Exports unavailable",
};
const EXPORT_NOT_COMPLETED: ProblemDefinition = {
  code: "export_failed",
  detail: "The export artifact could not be completed.",
  status: 503,
  title: "Export failed",
};
const DOWNLOAD_NOT_ISSUED: ProblemDefinition = {
  code: "exports_unavailable",
  detail: "A download reference could not be issued.",
  status: 503,
  title: "Exports unavailable",
};
const EXPORT_ARTIFACT_UNAVAILABLE: ProblemDefinition = {
  code: "export_artifact_unavailable",
  detail: "The export artifact could not be read.",
  status: 503,
  title: "Export unavailable",
};
const VCARD_UNAVAILABLE: ProblemDefinition = {
  code: "vcard_unavailable",
  detail: "This person could not be exported right now.",
  status: 503,
  title: "vCard unavailable",
};

/** Every problem this file answers on its own, for the pinning suite. */
export const EXPORT_PROBLEMS: readonly ProblemDefinition[] = [
  DOWNLOAD_NOT_ISSUED,
  EXPORT_ARTIFACT_UNAVAILABLE,
  EXPORT_FORMAT_INVALID,
  EXPORT_HISTORY_UNAVAILABLE,
  EXPORT_NOT_COMPLETED,
  EXPORT_NOT_FOUND,
  VCARD_UNAVAILABLE,
];

/** An outage, whichever shape the use case reported it in. */
const unavailable = () => ({ status: "unavailable" as const });

export function createExportRoutes(
  services: ExportHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(routes, listExports, session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.exports.list(actor).catch(unavailable);
    if (result.status === "forbidden") return failure(context, result);
    if (result.status !== "ready") {
      return definedProblem(context, EXPORT_HISTORY_UNAVAILABLE);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({ exports: result.exports });
  });

  mount(routes, createWorkspaceExport, origin, session, async (context) => {
    // The body is optional: no body, or no format, is the portable JSON.
    const raw = await context.req.text();
    const request = parseValue(
      exportRequest,
      raw.trim() === "" ? {} : (() => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return undefined;
        }
      })(),
    );
    if ("errors" in request) {
      return definedProblem(context, EXPORT_FORMAT_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.exports.createWorkspace(
      actor,
      request.data.format ?? "json",
    ).catch(unavailable);
    if (result.status === "forbidden" || result.status === "too-large") {
      return failure(context, result);
    }
    if (result.status !== "completed") {
      return definedProblem(context, EXPORT_NOT_COMPLETED);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result, 201);
  });

  mount(
    routes,
    createExportDownload,
    origin,
    session,
    async (context) => {
      const exportId = parseValue(uuid, context.req.param("exportId"));
      if ("errors" in exportId) {
        return definedProblem(context, EXPORT_NOT_FOUND);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.exports.createDownload(
        actor,
        exportId.data,
      ).catch(unavailable);
      if (result.status === "forbidden" || result.status === "not-found") {
        return failure(context, result);
      }
      if (result.status !== "ready") {
        return definedProblem(context, DOWNLOAD_NOT_ISSUED);
      }
      context.header("Cache-Control", "private, no-store");
      return context.json(result, 201);
    },
  );

  mount(routes, downloadExport, async (context) => {
    const exportId = parseValue(uuid, context.req.param("exportId"));
    const query = parseQuery(context, downloadExportQuery);
    if (
      "errors" in exportId || "errors" in query
    ) return definedProblem(context, EXPORT_NOT_FOUND);
    const actor = await workspaceScopedActor(
      context,
      services.protectedSessions,
      query.data.workspaceId,
    );
    if (!actor) return definedProblem(context, SESSION_INVALID);
    const result = await services.exports.download(
      actor,
      exportId.data,
      query.data.token,
    ).catch(unavailable);
    if (
      result.status === "forbidden" || result.status === "not-found" ||
      result.status === "expired"
    ) return failure(context, result);
    if (result.status !== "ready") {
      return definedProblem(context, EXPORT_ARTIFACT_UNAVAILABLE);
    }
    return fileDownload(result);
  });

  mount(routes, exportPersonVCard, async (context) => {
    const personId = parseValue(uuid, context.req.param("personId"));
    const query = parseQuery(context, exportPersonVCardQuery);
    if ("errors" in personId || "errors" in query) {
      return definedProblem(context, EXPORT_NOT_FOUND);
    }
    const actor = await workspaceScopedActor(
      context,
      services.protectedSessions,
      query.data.workspaceId,
    );
    if (!actor) return definedProblem(context, SESSION_INVALID);
    const result = await services.exports.exportVCard(actor, personId.data)
      .catch(unavailable);
    if (result.status === "not-found") return failure(context, result);
    if (result.status !== "ready") {
      return definedProblem(context, VCARD_UNAVAILABLE);
    }
    return fileDownload(result);
  });
  return routes;
}
