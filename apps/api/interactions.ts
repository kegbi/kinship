/**
 * Interactions, communication, and the Today regions built on them, over HTTP.
 *
 * One write and six reads. The problem responder, the session cookie, the
 * origin check, and the kernel status map came from `http/` (GAP-019,
 * GAP-020).
 *
 * `hidden` and `forbidden` answer the same refusal on purpose: a section an
 * administrator turned off and a membership that no longer permits the action
 * are the same thing to the person looking at the page, and telling them apart
 * would say which sections a workspace has configured.
 */

import { Hono } from "hono";
import type {
  CommunicationManagement,
  InteractionManagement,
  RecordCommunicationInput,
  RecordInteractionInput,
} from "../../packages/backend/modules/interactions/public.ts";
import type { ActivityReport } from "../../packages/backend/read-models/activity-report/public.ts";
import type { TodayInteractions } from "../../packages/backend/read-models/today/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import {
  getActivityReport,
  getActivityReportQuery,
  getTodayFavoriteNotes,
  getTodayRecentActivity,
  listCommunicationOptions,
  listInteractionOptions,
  listInteractionOptionsQuery,
  listPersonCommunications,
  recordInteraction,
} from "../../packages/contracts/routes/interactions.ts";
import { interactionInput } from "../../packages/contracts/schemas/interactions.ts";
import { uuid } from "../../packages/contracts/schemas/shared.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";
import { failureResponder, type FailureTable } from "./http/failures.ts";
import { requireMatchingOrigin } from "./http/origin.ts";
import { definedProblem, type ProblemDefinition } from "./http/problem.ts";
import { mount } from "./http/route.ts";
import { type ActorEnv, requireActor, sessionActor } from "./http/session.ts";
import { parseJsonBody, parseQuery, parseValue } from "./http/validate.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface InteractionHttpServices {
  readonly activityReport: ActivityReport;
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly interactions: InteractionManagement & CommunicationManagement;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
  readonly today: TodayInteractions;
}

/** What a refused interaction or communication says. */
export const INTERACTION_FAILURES: FailureTable = {
  fallback: {
    code: "validation_failed",
    detail: "Review the participants, occurrence time, and content.",
    status: 400,
    title: "Invalid interaction",
  },
  statuses: {
    "archived-write-rejected": {
      code: "archived_write_rejected",
      detail: "Restore every selected person before recording an interaction.",
      title: "Archived person is read-only",
    },
    forbidden: {
      code: "interactions_forbidden",
      detail:
        "Your active workspace membership or profile configuration no longer permits this action.",
      title: "Interaction unavailable",
    },
    hidden: {
      code: "interactions_forbidden",
      detail:
        "Your active workspace membership or profile configuration no longer permits this action.",
      status: 403,
      title: "Interaction unavailable",
    },
    "idempotency-conflict": {
      code: "interaction_request_conflict",
      detail:
        "Use a new request identifier when the interaction payload changes.",
      status: 409,
      title: "Request identifier already used",
    },
    "not-found": {
      code: "interaction_context_not_found",
      detail:
        "A selected person, activity type, or emotion does not exist in the active workspace.",
      title: "Interaction unavailable",
    },
    "stale-cursor": {
      code: "interaction_cursor_stale",
      detail: "Restart this bounded option or report search.",
      status: 409,
      title: "Interaction page changed",
    },
  },
};

const failure = failureResponder(INTERACTION_FAILURES);

const INTERACTION_REQUEST_INVALID: ProblemDefinition = {
  code: "interaction_request_invalid",
  detail: "Use supported interaction fields and canonical identifiers.",
  status: 400,
  title: "Invalid interaction",
};
const INTERACTION_NOT_SAVED: ProblemDefinition = {
  code: "interactions_unavailable",
  detail: "Nothing was saved. Try again when the service is available.",
  status: 503,
  title: "Interaction unavailable",
};
const COMMUNICATION_OPTIONS_UNAVAILABLE: ProblemDefinition = {
  code: "communication_options_unavailable",
  detail: "Try again before recording communication.",
  status: 503,
  title: "Communication options unavailable",
};
const COMMUNICATION_QUERY_INVALID: ProblemDefinition = {
  code: "communication_query_invalid",
  detail: "Use a canonical person identifier.",
  status: 400,
  title: "Invalid communication query",
};
const COMMUNICATIONS_UNAVAILABLE: ProblemDefinition = {
  code: "communications_unavailable",
  detail: "Saved communication was not changed.",
  status: 503,
  title: "Communication unavailable",
};
const OPTIONS_QUERY_INVALID: ProblemDefinition = {
  code: "interaction_options_query_invalid",
  detail: "Use bounded searches and opaque cursors.",
  status: 400,
  title: "Invalid options search",
};
const OPTIONS_UNAVAILABLE: ProblemDefinition = {
  code: "interaction_options_unavailable",
  detail: "Try again before recording an interaction.",
  status: 503,
  title: "Options unavailable",
};
const ACTIVITY_REPORT_QUERY_INVALID: ProblemDefinition = {
  code: "activity_report_query_invalid",
  detail: "Use a canonical person, year, and bounded page size.",
  status: 400,
  title: "Invalid activity report",
};
const ACTIVITY_REPORT_UNAVAILABLE: ProblemDefinition = {
  code: "activity_report_unavailable",
  detail: "Saved interactions were not changed.",
  status: 503,
  title: "Activity report unavailable",
};
const FAVORITE_NOTES_UNAVAILABLE: ProblemDefinition = {
  code: "today_favorite_notes_unavailable",
  detail: "Other Today regions remain available.",
  status: 503,
  title: "Favorite notes unavailable",
};
const RECENT_ACTIVITY_UNAVAILABLE: ProblemDefinition = {
  code: "today_recent_activity_unavailable",
  detail: "Other Today regions remain available.",
  status: 503,
  title: "Recent activity unavailable",
};

/** Every problem this file answers on its own, for the pinning suite. */
export const INTERACTION_PROBLEMS: readonly ProblemDefinition[] = [
  ACTIVITY_REPORT_QUERY_INVALID,
  ACTIVITY_REPORT_UNAVAILABLE,
  COMMUNICATION_OPTIONS_UNAVAILABLE,
  COMMUNICATION_QUERY_INVALID,
  COMMUNICATIONS_UNAVAILABLE,
  FAVORITE_NOTES_UNAVAILABLE,
  INTERACTION_NOT_SAVED,
  INTERACTION_REQUEST_INVALID,
  OPTIONS_QUERY_INVALID,
  OPTIONS_UNAVAILABLE,
  RECENT_ACTIVITY_UNAVAILABLE,
];

export function createInteractionRoutes(
  services: InteractionHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(routes, recordInteraction, origin, session, async (context) => {
    const input = await parseJsonBody(context, interactionInput);
    if ("errors" in input) {
      return definedProblem(context, INTERACTION_REQUEST_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const normalized = input.data.kind === "activity"
      ? {
        ...(input.data.activityTypeId
          ? { activityTypeId: input.data.activityTypeId }
          : {}),
        ...(input.data.description
          ? { description: input.data.description }
          : {}),
        ...(input.data.emotionIds ? { emotionIds: input.data.emotionIds } : {}),
        happenedAt: input.data.happenedAt,
        kind: "activity" as const,
        participantIds: input.data.participantIds,
        requestId: input.data.requestId,
        summary: input.data.summary,
      }
      : input.data.kind === "note"
      ? {
        body: input.data.body,
        ...(input.data.isFavorited === undefined
          ? {}
          : { isFavorited: input.data.isFavorited }),
        kind: "note" as const,
        personId: input.data.personId,
        requestId: input.data.requestId,
      }
      : input.data.kind === "call"
      ? {
        calledAt: input.data.calledAt,
        contactWasCaller: input.data.contactWasCaller,
        ...(input.data.content ? { content: input.data.content } : {}),
        ...(input.data.emotionIds ? { emotionIds: input.data.emotionIds } : {}),
        kind: "call" as const,
        personId: input.data.personId,
        requestId: input.data.requestId,
      }
      : {
        channelTypeId: input.data.channelTypeId,
        ...(input.data.contactMethodId
          ? { contactMethodId: input.data.contactMethodId }
          : {}),
        happenedAt: input.data.happenedAt,
        kind: "conversation" as const,
        ...(input.data.messages ? { messages: input.data.messages } : {}),
        personId: input.data.personId,
        requestId: input.data.requestId,
        ...(input.data.title ? { title: input.data.title } : {}),
      };
    const result =
      await (input.data.kind === "activity" || input.data.kind === "note"
        ? services.interactions.record(
          actor,
          normalized as RecordInteractionInput,
        )
        : services.interactions.recordCommunication(
          actor,
          normalized as RecordCommunicationInput,
        ))
        .catch(() => undefined);
    if (!result) return definedProblem(context, INTERACTION_NOT_SAVED);
    if (result.status !== "created") return failure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result, 201);
  });

  mount(routes, listCommunicationOptions, session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.interactions.communicationOptions(actor)
      .catch(() => undefined);
    if (!result) {
      return definedProblem(context, COMMUNICATION_OPTIONS_UNAVAILABLE);
    }
    if (result.status !== "ready") return failure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  mount(
    routes,
    listPersonCommunications,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      if ("errors" in personId) {
        return definedProblem(context, COMMUNICATION_QUERY_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.interactions.listCommunications(
        actor,
        personId.data,
      ).catch(() => undefined);
      if (!result) {
        return definedProblem(context, COMMUNICATIONS_UNAVAILABLE);
      }
      if (result.status !== "ready") return failure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  mount(routes, listInteractionOptions, session, async (context) => {
    const input = parseQuery(context, listInteractionOptionsQuery);
    if ("errors" in input) {
      return definedProblem(context, OPTIONS_QUERY_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.interactions.options(actor, {
      ...(input.data.activityTypeCursor
        ? { activityTypeCursor: input.data.activityTypeCursor }
        : {}),
      ...(input.data.activityTypeSearch
        ? { activityTypeSearch: input.data.activityTypeSearch }
        : {}),
      ...(input.data.emotionCursor
        ? { emotionCursor: input.data.emotionCursor }
        : {}),
      ...(input.data.emotionSearch
        ? { emotionSearch: input.data.emotionSearch }
        : {}),
      limit: input.data.limit,
    }).catch(() => undefined);
    if (!result) return definedProblem(context, OPTIONS_UNAVAILABLE);
    if (result.status !== "ready") return failure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  mount(
    routes,
    getActivityReport,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const input = parseQuery(context, getActivityReportQuery);
      if ("errors" in personId || "errors" in input) {
        return definedProblem(context, ACTIVITY_REPORT_QUERY_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.activityReport.list(
        actor,
        personId.data,
        {
          ...(input.data.cursor ? { cursor: input.data.cursor } : {}),
          ...(input.data.kind ? { kind: input.data.kind } : {}),
          limit: input.data.limit,
          ...(input.data.year ? { year: input.data.year } : {}),
        },
      ).catch(() => undefined);
      if (!result) {
        return definedProblem(context, ACTIVITY_REPORT_UNAVAILABLE);
      }
      if (
        result.status === "forbidden" || result.status === "not-found" ||
        result.status === "stale-cursor"
      ) return failure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  mount(routes, getTodayFavoriteNotes, session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.today.getFavoriteNotes(actor).catch(() =>
      undefined
    );
    if (!result) return definedProblem(context, FAVORITE_NOTES_UNAVAILABLE);
    if (result.status === "forbidden") return failure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  mount(routes, getTodayRecentActivity, session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.today.getRecentActivity(actor).catch(() =>
      undefined
    );
    if (!result) return definedProblem(context, RECENT_ACTIVITY_UNAVAILABLE);
    if (result.status === "forbidden") return failure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  return routes;
}
