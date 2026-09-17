/**
 * The journal over HTTP.
 *
 * The timeline is a read model and the posts, day ratings, and activity links
 * are the journal module's writes; this file is only the seven routes between
 * them and the browser. The problem responder, the session cookie, the origin
 * check, and the kernel status map came from `http/` (GAP-019).
 */

import { Hono } from "hono";
import { z } from "zod";
import type { JournalManagement } from "../../packages/backend/modules/journal/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { JournalTimeline } from "../../packages/backend/read-models/journal-timeline/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";
import { failureResponder, type FailureTable } from "./http/failures.ts";
import { requireMatchingOrigin } from "./http/origin.ts";
import { type ActorEnv, requireActor, sessionActor } from "./http/session.ts";
import { parseJsonBody, parseValue } from "./http/validate.ts";

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

/** What a refused journal item says. */
export const JOURNAL_FAILURES: FailureTable = {
  fallback: {
    code: "journal_unavailable",
    detail: "The journal is temporarily unavailable.",
    status: 503,
    title: "Journal unavailable",
  },
  statuses: {
    forbidden: {
      code: "journal_forbidden",
      detail: "Your active workspace membership no longer permits this action.",
      title: "Journal unavailable",
    },
    "not-found": {
      code: "journal_item_not_found",
      detail: "This item does not exist in the active workspace.",
      title: "Journal item unavailable",
    },
    "validation-error": {
      code: "journal_invalid",
      detail: "Review the date, rating, title, and content.",
      title: "Invalid journal item",
    },
  },
};

const failure = failureResponder(JOURNAL_FAILURES);

export function createJournalRoutes(
  services: JournalHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  routes.get("/api/v1/journal", session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.timeline.list(actor);
    if (result.status !== "ready") return failure(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.get("/api/v1/journal/items/:itemId", session, async (context) => {
    const itemId = parseValue(uuid, context.req.param("itemId"));
    if ("errors" in itemId) return failure(context, "not-found");
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.timeline.get(actor, itemId.data);
    if (result.status !== "ready") return failure(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.post(
    "/api/v1/journal/posts",
    origin,
    session,
    async (context) => {
      const body = await parseJsonBody(context, postInput);
      if ("errors" in body) return failure(context, "validation-error");
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.journal.createPost(actor, {
        body: body.data.body,
        occurredAt: body.data.occurredAt,
        ...(body.data.title ? { title: body.data.title } : {}),
      });
      if (result.status !== "created") return failure(context, result.status);
      return context.json(result, 201);
    },
  );
  routes.put(
    "/api/v1/journal/posts/:postId",
    origin,
    session,
    async (context) => {
      const postId = parseValue(uuid, context.req.param("postId"));
      const body = await parseJsonBody(context, postInput);
      if ("errors" in postId || "errors" in body) {
        return failure(context, "validation-error");
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.journal.updatePost(actor, postId.data, {
        body: body.data.body,
        occurredAt: body.data.occurredAt,
        ...(body.data.title ? { title: body.data.title } : {}),
      });
      if (result.status !== "updated") return failure(context, result.status);
      return context.json(result);
    },
  );
  routes.put(
    "/api/v1/journal/day-ratings",
    origin,
    session,
    async (context) => {
      const body = await parseJsonBody(context, ratingInput);
      if ("errors" in body) return failure(context, "validation-error");
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.journal.saveDayRating(actor, {
        ...(body.data.comment ? { comment: body.data.comment } : {}),
        ratedOn: body.data.ratedOn,
        rating: body.data.rating,
      });
      if (result.status !== "created" && result.status !== "updated") {
        return failure(context, result.status);
      }
      return context.json(result, result.status === "created" ? 201 : 200);
    },
  );
  routes.post(
    "/api/v1/journal/activities",
    origin,
    session,
    async (context) => {
      const body = await parseJsonBody(context, activityInput);
      if ("errors" in body) return failure(context, "validation-error");
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.journal.linkActivity(
        actor,
        body.data.activityId,
      );
      if (result.status !== "created") return failure(context, result.status);
      return context.json(result, 201);
    },
  );
  routes.delete(
    "/api/v1/journal/items/:itemId",
    origin,
    session,
    async (context) => {
      const itemId = parseValue(uuid, context.req.param("itemId"));
      if ("errors" in itemId) return failure(context, "validation-error");
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.journal.deleteItem(actor, itemId.data);
      if (result.status !== "deleted") return failure(context, result.status);
      return context.json(result);
    },
  );
  return routes;
}
