import { type Context, Hono } from "hono";
import { z } from "zod";
import type { AuditHistory } from "../../packages/backend/read-models/audit-history/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface GovernanceHttpServices {
  readonly auditHistory: AuditHistory;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
}

const id = z.uuid();
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

function cookieValue(header: string | undefined, name: string) {
  return header?.split(";").map((value) => value.trim()).find((value) =>
    value.startsWith(`${name}=`)
  )?.slice(name.length + 1);
}

async function actor(context: Context, services: GovernanceHttpServices) {
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
  return resolved && {
    memberId: resolved.memberId,
    role: resolved.role,
    userId: resolved.userId,
    workspaceId: resolved.workspaceId,
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
    const result = await services.auditHistory.list(resolved, {
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
  routes.get("/api/v1/audit-events", auditRoute(services, false));
  routes.get(
    "/api/v1/people/:personId/audit",
    auditRoute(services, true),
  );
  return routes;
}
