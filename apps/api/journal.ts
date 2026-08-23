import { type Context, Hono } from "hono";
import { z } from "zod";
import type { JournalManagement } from "../../packages/backend/modules/journal/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { JournalTimeline } from "../../packages/backend/read-models/journal-timeline/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;
export interface JournalHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly journal: JournalManagement;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
  readonly timeline: JournalTimeline;
}

const uuid = z.uuid();
const postInput = z.object({
  body: z.string().trim().min(1).max(50_000),
  occurredAt: z.iso.datetime({ offset: true }),
  title: z.string().trim().min(1).max(500).optional(),
}).strict();
const ratingInput = z.object({
  comment: z.string().trim().min(1).max(10_000).optional(),
  ratedOn: z.iso.date(),
  rating: z.number().int().min(1).max(5),
}).strict();
const activityInput = z.object({ activityId: uuid }).strict();

function problem(
  context: Context,
  status: 400 | 401 | 403 | 404 | 503,
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
    { "Cache-Control": "no-store", "Content-Type": "application/problem+json" },
  );
}
function cookieValue(header: string | undefined, name: string) {
  return header?.split(";").map((value) => value.trim()).find((value) =>
    value.startsWith(`${name}=`)
  )?.slice(name.length + 1);
}
async function actor(context: Context, services: JournalHttpServices) {
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
function failure(context: Context, status: string) {
  if (status === "forbidden") {
    return problem(
      context,
      403,
      "journal_forbidden",
      "Journal unavailable",
      "Your active workspace membership no longer permits this action.",
    );
  }
  if (status === "not-found") {
    return problem(
      context,
      404,
      "journal_item_not_found",
      "Journal item unavailable",
      "This item does not exist in the active workspace.",
    );
  }
  if (status === "validation-error") {
    return problem(
      context,
      400,
      "journal_invalid",
      "Invalid journal item",
      "Review the date, rating, title, and content.",
    );
  }
  return problem(
    context,
    503,
    "journal_unavailable",
    "Journal unavailable",
    "The journal is temporarily unavailable.",
  );
}
async function authentication(context: Context, services: JournalHttpServices) {
  const resolved = await actor(context, services);
  return resolved ? { actor: resolved } : {
    response: problem(
      context,
      401,
      "session_invalid",
      "Authentication required",
      "Sign in with an active workspace membership.",
    ),
  };
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

export function createJournalRoutes(services: JournalHttpServices): Hono {
  const routes = new Hono();
  routes.get("/api/v1/journal", async (context) => {
    const auth = await authentication(context, services);
    if (!auth.actor) return auth.response;
    const result = await services.timeline.list(auth.actor);
    if (result.status !== "ready") return failure(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.get("/api/v1/journal/items/:itemId", async (context) => {
    const itemId = uuid.safeParse(context.req.param("itemId"));
    if (!itemId.success) return failure(context, "not-found");
    const auth = await authentication(context, services);
    if (!auth.actor) return auth.response;
    const result = await services.timeline.get(auth.actor, itemId.data);
    if (result.status !== "ready") return failure(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.post("/api/v1/journal/posts", async (context) => {
    const origin = requireOrigin(context, services.browserSecurity);
    if (origin) return origin;
    const body = postInput.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!body.success) return failure(context, "validation-error");
    const auth = await authentication(context, services);
    if (!auth.actor) return auth.response;
    const result = await services.journal.createPost(auth.actor, {
      body: body.data.body,
      occurredAt: body.data.occurredAt,
      ...(body.data.title ? { title: body.data.title } : {}),
    });
    if (result.status !== "created") return failure(context, result.status);
    return context.json(result, 201);
  });
  routes.put("/api/v1/journal/posts/:postId", async (context) => {
    const origin = requireOrigin(context, services.browserSecurity);
    if (origin) return origin;
    const postId = uuid.safeParse(context.req.param("postId"));
    const body = postInput.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!postId.success || !body.success) {
      return failure(context, "validation-error");
    }
    const auth = await authentication(context, services);
    if (!auth.actor) return auth.response;
    const result = await services.journal.updatePost(auth.actor, postId.data, {
      body: body.data.body,
      occurredAt: body.data.occurredAt,
      ...(body.data.title ? { title: body.data.title } : {}),
    });
    if (result.status !== "updated") return failure(context, result.status);
    return context.json(result);
  });
  routes.put("/api/v1/journal/day-ratings", async (context) => {
    const origin = requireOrigin(context, services.browserSecurity);
    if (origin) return origin;
    const body = ratingInput.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!body.success) return failure(context, "validation-error");
    const auth = await authentication(context, services);
    if (!auth.actor) return auth.response;
    const result = await services.journal.saveDayRating(auth.actor, {
      ...(body.data.comment ? { comment: body.data.comment } : {}),
      ratedOn: body.data.ratedOn,
      rating: body.data.rating,
    });
    if (result.status !== "created" && result.status !== "updated") {
      return failure(context, result.status);
    }
    return context.json(result, result.status === "created" ? 201 : 200);
  });
  routes.post("/api/v1/journal/activities", async (context) => {
    const origin = requireOrigin(context, services.browserSecurity);
    if (origin) return origin;
    const body = activityInput.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!body.success) return failure(context, "validation-error");
    const auth = await authentication(context, services);
    if (!auth.actor) return auth.response;
    const result = await services.journal.linkActivity(
      auth.actor,
      body.data.activityId,
    );
    if (result.status !== "created") return failure(context, result.status);
    return context.json(result, 201);
  });
  routes.delete("/api/v1/journal/items/:itemId", async (context) => {
    const origin = requireOrigin(context, services.browserSecurity);
    if (origin) return origin;
    const itemId = uuid.safeParse(context.req.param("itemId"));
    if (!itemId.success) {
      return failure(context, "validation-error");
    }
    const auth = await authentication(context, services);
    if (!auth.actor) return auth.response;
    const result = await services.journal.deleteItem(
      auth.actor,
      itemId.data,
    );
    if (result.status !== "deleted") return failure(context, result.status);
    return context.json(result);
  });
  return routes;
}
