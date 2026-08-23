import { type Context, Hono } from "hono";
import { z } from "zod";
import type { ExportManagement } from "../../packages/backend/modules/import-export/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;
export interface ExportHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly exports: ExportManagement;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
}

const uuid = z.uuid();
const tokenSchema = z.string().min(1).max(200);

function problem(
  context: Context,
  status: 400 | 401 | 403 | 404 | 410 | 413 | 503,
  code: string,
  title: string,
  detail: string,
) {
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
function cookieValue(header: string | undefined, name: string) {
  return header?.split(";").map((value) => value.trim()).find((value) =>
    value.startsWith(`${name}=`)
  )?.slice(name.length + 1);
}
async function actor(
  context: Context,
  services: ExportHttpServices,
  workspaceOverride?: string,
) {
  const sessionToken = cookieValue(
    context.req.header("Cookie"),
    "kinship_session",
  );
  if (!sessionToken) return undefined;
  const requestedWorkspaceId = workspaceOverride ??
    context.req.header("X-Workspace-Id");
  const resolved = await services.protectedSessions.resolve({
    sessionToken,
    ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
  }).catch(() => undefined);
  return resolved
    ? {
      memberId: resolved.memberId,
      role: resolved.role,
      userId: resolved.userId,
      workspaceId: resolved.workspaceId,
    }
    : undefined;
}
function requireOrigin(context: Context, policy: BrowserSecurityPolicy) {
  return context.req.header("Origin") === policy.origin ? undefined : problem(
    context,
    403,
    "origin_invalid",
    "Request forbidden",
    "This request did not come from the configured application origin.",
  );
}
function forbidden(context: Context) {
  return problem(
    context,
    403,
    "export_forbidden",
    "Export unavailable",
    "Workspace export is available to owners and administrators only.",
  );
}
function missing(context: Context) {
  return problem(
    context,
    404,
    "export_not_found",
    "Export unavailable",
    "This export does not exist in the active workspace.",
  );
}
function attachmentFilename(filename: string): string {
  const fallback = filename.replace(/[\r\n"\\]/g, "_").replace(
    /[^\x20-\x7e]/g,
    "_",
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${
    encodeURIComponent(filename)
  }`;
}

export function createExportRoutes(services: ExportHttpServices): Hono {
  const routes = new Hono();
  routes.get("/api/v1/exports", async (context) => {
    const authenticated = await actor(context, services);
    if (!authenticated) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.exports.list(authenticated).catch(() => ({
      status: "unavailable" as const,
    }));
    if (result.status === "forbidden") return forbidden(context);
    if (result.status !== "ready") {
      return problem(
        context,
        503,
        "exports_unavailable",
        "Exports unavailable",
        "Export history could not be loaded.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({ exports: result.exports });
  });
  routes.post("/api/v1/exports", async (context) => {
    const origin = requireOrigin(context, services.browserSecurity);
    if (origin) return origin;
    const authenticated = await actor(context, services);
    if (!authenticated) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.exports.createWorkspace(authenticated).catch(
      () => ({ status: "unavailable" as const }),
    );
    if (result.status === "forbidden") return forbidden(context);
    if (result.status === "too-large") {
      return problem(
        context,
        413,
        "export_too_large",
        "Export too large",
        "This portable profile supports at most 500 people.",
      );
    }
    if (result.status !== "completed") {
      return problem(
        context,
        503,
        "export_failed",
        "Export failed",
        "The export artifact could not be completed.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result, 201);
  });
  routes.post("/api/v1/exports/:exportId/downloads", async (context) => {
    const origin = requireOrigin(context, services.browserSecurity);
    if (origin) return origin;
    const exportId = uuid.safeParse(context.req.param("exportId"));
    if (!exportId.success) return missing(context);
    const authenticated = await actor(context, services);
    if (!authenticated) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.exports.createDownload(
      authenticated,
      exportId.data,
    ).catch(() => ({ status: "unavailable" as const }));
    if (result.status === "forbidden") return forbidden(context);
    if (result.status === "not-found") return missing(context);
    if (result.status !== "ready") {
      return problem(
        context,
        503,
        "exports_unavailable",
        "Exports unavailable",
        "A download reference could not be issued.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result, 201);
  });
  routes.get("/api/v1/exports/:exportId/download", async (context) => {
    const exportId = uuid.safeParse(context.req.param("exportId"));
    const token = tokenSchema.safeParse(context.req.query("token"));
    const workspaceId = z.uuid().optional().safeParse(
      context.req.query("workspaceId"),
    );
    if (!exportId.success || !token.success || !workspaceId.success) {
      return missing(context);
    }
    const authenticated = await actor(context, services, workspaceId.data);
    if (!authenticated) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.exports.download(
      authenticated,
      exportId.data,
      token.data,
    ).catch(() => ({ status: "unavailable" as const }));
    if (result.status === "forbidden") return forbidden(context);
    if (result.status === "not-found") return missing(context);
    if (result.status === "expired") {
      return problem(
        context,
        410,
        "export_download_expired",
        "Download expired",
        "Create a new short-lived download reference from export history.",
      );
    }
    if (result.status !== "ready") {
      return problem(
        context,
        503,
        "export_artifact_unavailable",
        "Export unavailable",
        "The export artifact could not be read.",
      );
    }
    return new Response(result.bytes.slice().buffer, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": attachmentFilename(result.filename),
        "Content-Length": String(result.bytes.byteLength),
        "Content-Type": result.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
  routes.get("/api/v1/people/:personId/vcard", async (context) => {
    const personId = uuid.safeParse(context.req.param("personId"));
    const workspaceId = z.uuid().optional().safeParse(
      context.req.query("workspaceId"),
    );
    if (!personId.success || !workspaceId.success) return missing(context);
    const authenticated = await actor(context, services, workspaceId.data);
    if (!authenticated) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.exports.exportVCard(
      authenticated,
      personId.data,
    ).catch(() => ({ status: "unavailable" as const }));
    if (result.status === "not-found") return missing(context);
    if (result.status !== "ready") {
      return problem(
        context,
        503,
        "vcard_unavailable",
        "vCard unavailable",
        "This person could not be exported right now.",
      );
    }
    return new Response(result.bytes.slice().buffer, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": attachmentFilename(result.filename),
        "Content-Length": String(result.bytes.byteLength),
        "Content-Type": result.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
  return routes;
}
