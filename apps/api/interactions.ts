import { type Context, Hono } from "hono";
import { z } from "zod";
import type {
  CommunicationManagement,
  InteractionManagement,
  RecordCommunicationInput,
  RecordInteractionInput,
} from "../../packages/backend/modules/interactions/public.ts";
import type { ActivityReport } from "../../packages/backend/read-models/activity-report/public.ts";
import type { TodayInteractions } from "../../packages/backend/read-models/today/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface InteractionHttpServices {
  readonly activityReport: ActivityReport;
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly interactions: InteractionManagement & CommunicationManagement;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
  readonly today: TodayInteractions;
}

const id = z.uuid();
const activitySchema = z.object({
  activityTypeId: id.optional(),
  description: z.string().trim().min(1).max(10_000).optional(),
  emotionIds: z.array(id).max(20).optional(),
  happenedAt: z.iso.datetime({ offset: true }),
  kind: z.literal("activity"),
  participantIds: z.array(id).min(1).max(50),
  requestId: id,
  summary: z.string().trim().min(1).max(500),
}).strict();
const noteSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  isFavorited: z.boolean().optional(),
  kind: z.literal("note"),
  personId: id,
  requestId: id,
}).strict();
const callSchema = z.object({
  calledAt: z.iso.datetime({ offset: true }),
  contactWasCaller: z.boolean(),
  content: z.string().trim().min(1).max(10_000).optional(),
  emotionIds: z.array(id).max(20).optional(),
  kind: z.literal("call"),
  personId: id,
  requestId: id,
}).strict();
const messageSchema = z.object({
  content: z.string().trim().min(1).max(10_000),
  direction: z.enum(["inbound", "outbound"]),
  writtenAt: z.iso.datetime({ offset: true }),
}).strict();
const conversationSchema = z.object({
  channelTypeId: id,
  contactMethodId: id.optional(),
  happenedAt: z.iso.datetime({ offset: true }),
  kind: z.literal("conversation"),
  messages: z.array(messageSchema).max(50).optional(),
  personId: id,
  requestId: id,
  title: z.string().trim().min(1).max(500).optional(),
}).strict();
const inputSchema = z.discriminatedUnion("kind", [
  activitySchema,
  noteSchema,
  callSchema,
  conversationSchema,
]);
const reportQuery = z.object({
  cursor: z.string().max(2_000).optional(),
  kind: z.enum(["activity", "note"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  year: z.coerce.number().int().min(1).max(9999).optional(),
}).strict();
const optionsQuery = z.object({
  activityTypeCursor: z.string().max(2_000).optional(),
  activityTypeSearch: z.string().trim().max(100).optional(),
  emotionCursor: z.string().max(2_000).optional(),
  emotionSearch: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(20),
}).strict();

function problem(
  context: Context,
  status: 400 | 401 | 403 | 404 | 409 | 503,
  code: string,
  title: string,
  detail: string,
  errors?: Readonly<Record<string, string>>,
) {
  return context.body(
    JSON.stringify({
      type: `https://kinship.test/problems/${code}`,
      title,
      status,
      detail,
      code,
      ...(errors ? { errors } : {}),
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

async function actor(context: Context, services: InteractionHttpServices) {
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

function mutationFailure(
  context: Context,
  result: {
    readonly errors?: Readonly<Record<string, string>>;
    readonly status: string;
  },
) {
  if (result.status === "forbidden" || result.status === "hidden") {
    return problem(
      context,
      403,
      "interactions_forbidden",
      "Interaction unavailable",
      "Your active workspace membership or profile configuration no longer permits this action.",
    );
  }
  if (result.status === "not-found") {
    return problem(
      context,
      404,
      "interaction_context_not_found",
      "Interaction unavailable",
      "A selected person, activity type, or emotion does not exist in the active workspace.",
    );
  }
  if (result.status === "archived-write-rejected") {
    return problem(
      context,
      409,
      "archived_write_rejected",
      "Archived person is read-only",
      "Restore every selected person before recording an interaction.",
    );
  }
  if (result.status === "idempotency-conflict") {
    return problem(
      context,
      409,
      "interaction_request_conflict",
      "Request identifier already used",
      "Use a new request identifier when the interaction payload changes.",
    );
  }
  if (result.status === "stale-cursor") {
    return problem(
      context,
      409,
      "interaction_cursor_stale",
      "Interaction page changed",
      "Restart this bounded option or report search.",
    );
  }
  return problem(
    context,
    400,
    "validation_failed",
    "Invalid interaction",
    "Review the participants, occurrence time, and content.",
    result.errors,
  );
}

function authenticationRequired(context: Context) {
  return problem(
    context,
    401,
    "session_invalid",
    "Authentication required",
    "Sign in with an active workspace membership.",
  );
}

export function createInteractionRoutes(
  services: InteractionHttpServices,
): Hono {
  const routes = new Hono();
  routes.post("/api/v1/interactions", async (context) => {
    if (context.req.header("Origin") !== services.browserSecurity.origin) {
      return problem(
        context,
        403,
        "origin_invalid",
        "Request forbidden",
        "This request did not come from the configured application origin.",
      );
    }
    const input = inputSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!input.success) {
      return problem(
        context,
        400,
        "interaction_request_invalid",
        "Invalid interaction",
        "Use supported interaction fields and canonical identifiers.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
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
          resolved,
          normalized as RecordInteractionInput,
        )
        : services.interactions.recordCommunication(
          resolved,
          normalized as RecordCommunicationInput,
        ))
        .catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "interactions_unavailable",
        "Interaction unavailable",
        "Nothing was saved. Try again when the service is available.",
      );
    }
    if (result.status !== "created") return mutationFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result, 201);
  });

  routes.get("/api/v1/communication-options", async (context) => {
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.interactions.communicationOptions(resolved)
      .catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "communication_options_unavailable",
        "Communication options unavailable",
        "Try again before recording communication.",
      );
    }
    if (result.status !== "ready") return mutationFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  routes.get("/api/v1/people/:personId/communications", async (context) => {
    const personId = id.safeParse(context.req.param("personId"));
    if (!personId.success) {
      return problem(
        context,
        400,
        "communication_query_invalid",
        "Invalid communication query",
        "Use a canonical person identifier.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.interactions.listCommunications(
      resolved,
      personId.data,
    ).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "communications_unavailable",
        "Communication unavailable",
        "Saved communication was not changed.",
      );
    }
    if (result.status !== "ready") return mutationFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  routes.get("/api/v1/interaction-options", async (context) => {
    const input = optionsQuery.safeParse(context.req.query());
    if (!input.success) {
      return problem(
        context,
        400,
        "interaction_options_query_invalid",
        "Invalid options search",
        "Use bounded searches and opaque cursors.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.interactions.options(resolved, {
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
    if (!result) {
      return problem(
        context,
        503,
        "interaction_options_unavailable",
        "Options unavailable",
        "Try again before recording an interaction.",
      );
    }
    if (result.status !== "ready") return mutationFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  routes.get("/api/v1/people/:personId/activity-report", async (context) => {
    const personId = id.safeParse(context.req.param("personId"));
    const input = reportQuery.safeParse(context.req.query());
    if (!personId.success || !input.success) {
      return problem(
        context,
        400,
        "activity_report_query_invalid",
        "Invalid activity report",
        "Use a canonical person, year, and bounded page size.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.activityReport.list(
      resolved,
      personId.data,
      {
        ...(input.data.cursor ? { cursor: input.data.cursor } : {}),
        ...(input.data.kind ? { kind: input.data.kind } : {}),
        limit: input.data.limit,
        ...(input.data.year ? { year: input.data.year } : {}),
      },
    ).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "activity_report_unavailable",
        "Activity report unavailable",
        "Saved interactions were not changed.",
      );
    }
    if (result.status === "forbidden") return mutationFailure(context, result);
    if (result.status === "not-found") return mutationFailure(context, result);
    if (result.status === "stale-cursor") {
      return mutationFailure(context, result);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  routes.get("/api/v1/today/favorite-notes", async (context) => {
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.today.getFavoriteNotes(resolved).catch(() =>
      undefined
    );
    if (!result) {
      return problem(
        context,
        503,
        "today_favorite_notes_unavailable",
        "Favorite notes unavailable",
        "Other Today regions remain available.",
      );
    }
    if (result.status === "forbidden") return mutationFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.get("/api/v1/today/recent-activity", async (context) => {
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.today.getRecentActivity(resolved).catch(() =>
      undefined
    );
    if (!result) {
      return problem(
        context,
        503,
        "today_recent_activity_unavailable",
        "Recent activity unavailable",
        "Other Today regions remain available.",
      );
    }
    if (result.status === "forbidden") return mutationFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  return routes;
}
