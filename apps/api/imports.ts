import { type Context, Hono } from "hono";
import { z } from "zod";
import type { ImportManagement } from "../../packages/backend/modules/import-export/public.ts";
import {
  IMPORT_HTTP_ENVELOPE_MAX_BYTES,
  IMPORT_SOURCE_MAX_BYTES,
} from "../../packages/contracts/imports.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;
export interface ImportHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly imports: ImportManagement;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
}

const uuid = z.uuid();

function problem(
  context: Context,
  status: 400 | 401 | 403 | 404 | 413 | 503,
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
async function actor(context: Context, services: ImportHttpServices) {
  const sessionToken = cookieValue(
    context.req.header("Cookie"),
    "kinship_session",
  );
  if (!sessionToken) return undefined;
  const requestedWorkspaceId = context.req.header("X-Workspace-Id");
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
async function authenticate(context: Context, services: ImportHttpServices) {
  const resolved = await actor(context, services);
  return resolved ?? problem(
    context,
    401,
    "session_invalid",
    "Authentication required",
    "Sign in with an active workspace membership.",
  );
}
function forbidden(context: Context) {
  return problem(
    context,
    403,
    "import_forbidden",
    "Import unavailable",
    "Workspace import is available to owners and administrators only.",
  );
}

export function createImportRoutes(services: ImportHttpServices): Hono {
  const routes = new Hono();
  routes.get("/api/v1/imports", async (context) => {
    const authenticated = await authenticate(context, services);
    if (authenticated instanceof Response) return authenticated;
    if (authenticated.role === "member") return forbidden(context);
    context.header("Cache-Control", "private, no-store");
    return context.json({
      imports: await services.imports.list(authenticated),
    });
  });
  routes.get("/api/v1/imports/:importId", async (context) => {
    const importId = uuid.safeParse(context.req.param("importId"));
    if (!importId.success) {
      return problem(
        context,
        404,
        "import_not_found",
        "Import unavailable",
        "This import does not exist in the active workspace.",
      );
    }
    const authenticated = await authenticate(context, services);
    if (authenticated instanceof Response) return authenticated;
    if (authenticated.role === "member") return forbidden(context);
    const result = await services.imports.get(authenticated, importId.data);
    if (!result) {
      return problem(
        context,
        404,
        "import_not_found",
        "Import unavailable",
        "This import does not exist in the active workspace.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.post("/api/v1/imports/dry-runs", async (context) => {
    const origin = requireOrigin(context, services.browserSecurity);
    if (origin) return origin;
    const declared = Number(context.req.header("Content-Length") ?? 0);
    if (declared > IMPORT_HTTP_ENVELOPE_MAX_BYTES) {
      return problem(
        context,
        413,
        "import_too_large",
        "Import too large",
        "The Monica JSON source exceeds the 1.5 MB staging limit.",
      );
    }
    const raw = await context.req.text();
    if (
      new TextEncoder().encode(raw).byteLength >
        IMPORT_HTTP_ENVELOPE_MAX_BYTES
    ) {
      return problem(
        context,
        413,
        "import_too_large",
        "Import too large",
        "The Monica JSON source exceeds the 1.5 MB staging limit.",
      );
    }
    const body = (() => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return undefined;
      }
    })();
    const authenticated = await authenticate(context, services);
    if (authenticated instanceof Response) return authenticated;
    const source = body !== null && typeof body === "object" &&
        !Array.isArray(body) && "source" in body
      ? (body as { source: unknown }).source
      : undefined;
    if (
      source !== undefined &&
      new TextEncoder().encode(JSON.stringify(source)).byteLength >
        IMPORT_SOURCE_MAX_BYTES
    ) {
      return problem(
        context,
        413,
        "import_too_large",
        "Import too large",
        "The Monica JSON source exceeds the 1.5 MB staging limit.",
      );
    }
    const result = await services.imports.dryRun(authenticated, source);
    if (result.status === "forbidden") return forbidden(context);
    if (result.status === "invalid-source") {
      return problem(
        context,
        400,
        "import_invalid",
        "Import source invalid",
        result.detail,
      );
    }
    return context.json(result, 201);
  });
  routes.post("/api/v1/imports/:importId/commit", async (context) => {
    const origin = requireOrigin(context, services.browserSecurity);
    if (origin) return origin;
    const importId = uuid.safeParse(context.req.param("importId"));
    const body = await context.req.json().catch(() => undefined) as
      | { readonly confirmed?: unknown }
      | undefined;
    if (!importId.success || body?.confirmed !== true) {
      return problem(
        context,
        400,
        "import_confirmation_required",
        "Confirmation required",
        "Confirm the validated dry-run before committing it.",
      );
    }
    const authenticated = await authenticate(context, services);
    if (authenticated instanceof Response) return authenticated;
    const result = await services.imports.commit(
      authenticated,
      importId.data,
      true,
    );
    if (result.status === "forbidden") return forbidden(context);
    if (result.status === "not-found") {
      return problem(
        context,
        404,
        "import_not_found",
        "Import unavailable",
        "This validated import does not exist in the active workspace.",
      );
    }
    if (result.status === "confirmation-required") {
      return problem(
        context,
        400,
        "import_confirmation_required",
        "Confirmation required",
        "Confirm the validated dry-run before committing it.",
      );
    }
    return context.json(result);
  });
  return routes;
}
