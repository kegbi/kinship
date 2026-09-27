/**
 * The journal over HTTP.
 *
 * The timeline is a read model and the posts, day ratings, and activity links
 * are the journal module's writes; this file is only the seven routes between
 * them and the browser, plus the three life-event writes `life_events.ts`
 * serves (JOURNAL-002). The problem responder, the session cookie, the origin
 * check, and the kernel status map came from `packages/http-kit` (GAP-019). The routes are
 * mounted from `packages/contracts/routes/journal.ts` (GAP-022), which is why
 * the post update reads `itemId`: the document names that parameter on both
 * `/journal/items/{itemId}` and `/journal/posts/{itemId}`, and this file used
 * to write `:postId` out by hand on one of them.
 */

import { Hono } from "hono";
import type { JournalManagement, LifeEventManagement } from "../../public.ts";
import type { createProtectedSessionCoordinator } from "../../../workspaces/public.ts";
import type { JournalTimeline } from "../../../../read-models/journal-timeline/public.ts";
import {
  createJournalPost,
  deleteJournalItem,
  getJournalItem,
  linkJournalActivity,
  listJournal,
  listJournalQuery,
  saveJournalDayRating,
  updateJournalPost,
} from "../../../../../contracts/routes/journal.ts";
import {
  journalActivityInput,
  journalDayRatingInput,
  journalPostInput,
} from "../../../../../contracts/schemas/journal.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import type { BrowserSecurityPolicy } from "../../../../../http-kit/security_policy.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import { requireMatchingOrigin } from "../../../../../http-kit/origin.ts";
import { mount } from "../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  requireActor,
  sessionActor,
} from "../../../../../http-kit/session.ts";
import {
  parseJsonBody,
  parseQuery,
  parseValue,
} from "../../../../../http-kit/validate.ts";
import { createLifeEventRoutes } from "./life_events.ts";

export { LIFE_EVENT_FAILURES } from "./life_events.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;
export interface JournalHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly journal: JournalManagement;
  /** A person's life events (JOURNAL-002), when the root composed them. */
  readonly lifeEvents?: LifeEventManagement;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
  readonly timeline: JournalTimeline;
}

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
    "query-invalid": {
      code: "journal_query_invalid",
      detail: "Reload the first page of the journal before continuing.",
      status: 400,
      title: "Invalid journal query",
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

  mount(routes, listJournal, session, async (context) => {
    const query = parseQuery(context, listJournalQuery);
    if ("errors" in query) return failure(context, "query-invalid");
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.timeline.list(actor, {
      ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
      limit: query.data.limit,
    });
    if (result.status === "validation-error") {
      return failure(context, "query-invalid");
    }
    if (result.status !== "ready") return failure(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  mount(routes, getJournalItem, session, async (context) => {
    const itemId = parseValue(uuid, context.req.param("itemId"));
    if ("errors" in itemId) return failure(context, "not-found");
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.timeline.get(actor, itemId.data);
    if (result.status !== "ready") return failure(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  mount(
    routes,
    createJournalPost,
    origin,
    session,
    async (context) => {
      const body = await parseJsonBody(context, journalPostInput);
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
  mount(
    routes,
    updateJournalPost,
    origin,
    session,
    async (context) => {
      const postId = parseValue(uuid, context.req.param("itemId"));
      const body = await parseJsonBody(context, journalPostInput);
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
  mount(
    routes,
    saveJournalDayRating,
    origin,
    session,
    async (context) => {
      const body = await parseJsonBody(context, journalDayRatingInput);
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
  mount(
    routes,
    linkJournalActivity,
    origin,
    session,
    async (context) => {
      const body = await parseJsonBody(context, journalActivityInput);
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
  mount(
    routes,
    deleteJournalItem,
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
  if (services.lifeEvents) {
    routes.route(
      "/",
      createLifeEventRoutes({
        browserSecurity: services.browserSecurity,
        lifeEvents: services.lifeEvents,
        protectedSessions: services.protectedSessions,
      }),
    );
  }
  return routes;
}
