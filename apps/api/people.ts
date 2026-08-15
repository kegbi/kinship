import { type Context, Hono } from "hono";
import { z } from "zod";
import type {
  PeopleManagement,
  PersonIdentity,
  PersonLifecycle,
  PersonLifecycleRecord,
} from "../../packages/backend/modules/people/public.ts";
import type { PersonProfile } from "../../packages/backend/read-models/person-profile/public.ts";
import type {
  PeopleDirectory,
  PeopleTagOptions,
} from "../../packages/backend/read-models/people-directory/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface PeopleHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly directory: PeopleDirectory;
  readonly people: PeopleManagement & PersonLifecycle;
  readonly profile: PersonProfile;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
  readonly tagOptions: PeopleTagOptions;
}

const personSchema = z.object({
  duplicateOverride: z.boolean().optional(),
  familyName: z.string().trim().max(200).optional(),
  givenName: z.string().trim().max(200),
  isPartial: z.boolean(),
  middleName: z.string().trim().max(200).optional(),
  nickname: z.string().trim().max(200).optional(),
}).strict();
const personIdSchema = z.uuid();
const expectedUpdatedAtSchema = z.iso.datetime({ offset: true });
const editPersonSchema = personSchema.omit({ duplicateOverride: true }).extend({
  expectedUpdatedAt: expectedUpdatedAtSchema,
});
const transitionSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
}).strict();
const deletePersonSchema = transitionSchema.extend({
  confirmation: z.string().min(1).max(500),
});
const directoryQuerySchema = z.object({
  cursor: z.string().max(2_000).optional(),
  lifecycle: z.enum(["active", "archived"]).default("active"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(["given-name", "family-name", "recently-added"]).default(
    "given-name",
  ),
  tag: z.uuid().optional(),
}).strict();
const tagOptionsQuerySchema = z.object({
  cursor: z.string().max(2_000).optional(),
  search: z.string().trim().max(200).optional(),
  selected: z.uuid().optional(),
}).strict();

function problem(
  context: Context,
  status: 400 | 401 | 403 | 404 | 409 | 503,
  code: string,
  title: string,
  detail: string,
  errors?: Readonly<Record<string, string>>,
): Response {
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

function requireOrigin(
  context: Context,
  policy: BrowserSecurityPolicy,
): Response | undefined {
  return context.req.header("Origin") === policy.origin ? undefined : problem(
    context,
    403,
    "origin_invalid",
    "Request forbidden",
    "This request did not come from the configured application origin.",
  );
}

async function actor(context: Context, services: PeopleHttpServices) {
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

function identity(person: PersonIdentity) {
  return {
    ...(person.familyName ? { familyName: person.familyName } : {}),
    givenName: person.givenName,
    id: person.id,
    isPartial: person.isPartial,
    ...(person.middleName ? { middleName: person.middleName } : {}),
    ...(person.nickname ? { nickname: person.nickname } : {}),
  };
}

function lifecycleIdentity(person: PersonLifecycleRecord) {
  return {
    ...identity(person),
    lifecycle: person.lifecycle,
    updatedAt: person.updatedAt,
  };
}

function lifecycleFailure(
  context: Context,
  status:
    | "archived-write-rejected"
    | "confirmation-required"
    | "forbidden"
    | "not-found"
    | "stale"
    | "validation-error",
  errors?: Readonly<Record<string, string>>,
): Response {
  if (status === "forbidden") {
    return problem(
      context,
      403,
      "people_forbidden",
      "Person unavailable",
      "Your active workspace membership no longer permits this change.",
    );
  }
  if (status === "not-found") {
    return problem(
      context,
      404,
      "person_not_found",
      "Person not found",
      "No person with this identifier exists in the current workspace.",
    );
  }
  if (status === "stale") {
    return problem(
      context,
      409,
      "person_stale",
      "Person changed",
      "Refresh this person before trying the lifecycle action again.",
    );
  }
  if (status === "archived-write-rejected") {
    return problem(
      context,
      409,
      "archived_write_rejected",
      "Archived person is read-only",
      "Restore this person before editing their identity.",
    );
  }
  return problem(
    context,
    400,
    status === "confirmation-required"
      ? "confirmation_required"
      : "validation_failed",
    status === "confirmation-required"
      ? "Confirmation required"
      : "Invalid person",
    status === "confirmation-required"
      ? "Enter the exact confirmation shown in the deletion impact preview."
      : "Review the highlighted identity fields and try again.",
    errors,
  );
}

export function createPeopleRoutes(services: PeopleHttpServices): Hono {
  const routes = new Hono();
  routes.get("/api/v1/people", async (context) => {
    const parsed = directoryQuerySchema.safeParse(context.req.query());
    if (!parsed.success) {
      return problem(
        context,
        400,
        "people_query_invalid",
        "Invalid people query",
        "Review the search, tag, sort, lifecycle, and pagination criteria.",
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
    const result = await services.directory.list(resolved, {
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
      lifecycle: parsed.data.lifecycle,
      limit: parsed.data.limit,
      ...(parsed.data.search ? { search: parsed.data.search } : {}),
      sort: parsed.data.sort,
      ...(parsed.data.tag ? { tagId: parsed.data.tag } : {}),
    }).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "people_unavailable",
        "People unavailable",
        "The people directory is temporarily unavailable.",
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "people_forbidden",
        "People unavailable",
        "Your active workspace membership no longer permits this view.",
      );
    }
    if (result.status === "stale-cursor") {
      return problem(
        context,
        409,
        "stale_cursor",
        "People list changed",
        "Refresh the directory before continuing from this page.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      lifecycle: parsed.data.lifecycle,
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      people: result.people,
      status: "ready",
    });
  });
  routes.get("/api/v1/people/tag-options", async (context) => {
    const parsed = tagOptionsQuerySchema.safeParse(context.req.query());
    if (!parsed.success) {
      return problem(
        context,
        400,
        "tag_options_query_invalid",
        "Invalid tag options query",
        "Review the tag search and pagination criteria.",
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
    const result = await services.tagOptions.list(resolved, {
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
      ...(parsed.data.search ? { search: parsed.data.search } : {}),
      ...(parsed.data.selected ? { selectedTagId: parsed.data.selected } : {}),
    }).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "tag_options_unavailable",
        "Tag options unavailable",
        "Tag options are temporarily unavailable.",
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "people_forbidden",
        "Tag options unavailable",
        "Your active workspace membership no longer permits this view.",
      );
    }
    if (result.status === "invalid-input") {
      return problem(
        context,
        400,
        "tag_options_cursor_invalid",
        "Invalid tag options cursor",
        "Start a new tag search before continuing.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      options: result.options,
      ...(result.selected ? { selected: result.selected } : {}),
      status: "ready",
    });
  });
  routes.get("/api/v1/people/:personId", async (context) => {
    const parsed = personIdSchema.safeParse(context.req.param("personId"));
    if (!parsed.success) {
      return problem(
        context,
        400,
        "person_id_invalid",
        "Invalid person",
        "Use a valid canonical person identifier.",
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
    const result = await services.profile.get(resolved, parsed.data).catch(() =>
      undefined
    );
    if (!result) {
      return problem(
        context,
        503,
        "people_unavailable",
        "Person unavailable",
        "The person service is temporarily unavailable.",
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "people_forbidden",
        "Person unavailable",
        "Your active workspace membership no longer permits this view.",
      );
    }
    if (result.status === "not-found") {
      return problem(
        context,
        404,
        "person_not_found",
        "Person not found",
        "No active person with this identifier exists in the current workspace.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      dueInformation: result.dueInformation,
      person: result.person,
      status: result.status,
    });
  });
  routes.patch("/api/v1/people/:personId", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const personId = personIdSchema.safeParse(context.req.param("personId"));
    const input = editPersonSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!personId.success || !input.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid person",
        "Review the identity fields and current version before saving.",
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
    const result = await services.people.edit(resolved, personId.data, {
      expectedUpdatedAt: input.data.expectedUpdatedAt,
      ...(input.data.familyName ? { familyName: input.data.familyName } : {}),
      givenName: input.data.givenName,
      isPartial: input.data.isPartial,
      ...(input.data.middleName ? { middleName: input.data.middleName } : {}),
      ...(input.data.nickname ? { nickname: input.data.nickname } : {}),
    }).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "people_unavailable",
        "Person could not be updated",
        "The person service is temporarily unavailable.",
      );
    }
    if (result.status !== "updated") {
      return lifecycleFailure(
        context,
        result.status,
        result.status === "validation-error" ? result.errors : undefined,
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      person: lifecycleIdentity(result.person),
      status: "updated",
    });
  });
  for (const action of ["archive", "restore"] as const) {
    routes.post(`/api/v1/people/:personId/${action}`, async (context) => {
      const forbidden = requireOrigin(context, services.browserSecurity);
      if (forbidden) return forbidden;
      const personId = personIdSchema.safeParse(context.req.param("personId"));
      const input = transitionSchema.safeParse(
        await context.req.json().catch(() => undefined),
      );
      if (!personId.success || !input.success) {
        return problem(
          context,
          400,
          "validation_failed",
          "Invalid lifecycle request",
          "Refresh this person before trying again.",
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
      const result = await services.people[action](
        resolved,
        personId.data,
        input.data,
      ).catch(() => undefined);
      if (!result) {
        return problem(
          context,
          503,
          "people_unavailable",
          "Person could not be changed",
          "The person service is temporarily unavailable.",
        );
      }
      if (result.status !== "archived" && result.status !== "restored") {
        return lifecycleFailure(context, result.status);
      }
      context.header("Cache-Control", "private, no-store");
      return context.json({
        person: lifecycleIdentity(result.person),
        status: result.status,
      });
    });
  }
  routes.get("/api/v1/people/:personId/deletion-impact", async (context) => {
    const personId = personIdSchema.safeParse(context.req.param("personId"));
    if (!personId.success) {
      return problem(
        context,
        400,
        "person_id_invalid",
        "Invalid person",
        "Use a valid canonical person identifier.",
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
    const result = await services.people.previewDeletion(
      resolved,
      personId.data,
    ).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "people_unavailable",
        "Deletion impact unavailable",
        "The person service is temporarily unavailable.",
      );
    }
    if (result.status !== "ready") {
      return lifecycleFailure(context, result.status);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      impact: {
        confirmation: result.impact.confirmation,
        dependentRecordPolicy: result.impact.dependentRecordPolicy,
        person: lifecycleIdentity(result.impact.person),
      },
      status: "ready",
    });
  });
  routes.delete("/api/v1/people/:personId", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const personId = personIdSchema.safeParse(context.req.param("personId"));
    const input = deletePersonSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!personId.success || !input.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid deletion request",
        "Use the current deletion impact preview and exact confirmation.",
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
    const result = await services.people.delete(
      resolved,
      personId.data,
      input.data,
    ).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "people_unavailable",
        "Person could not be deleted",
        "The person service is temporarily unavailable.",
      );
    }
    if (result.status !== "deleted") {
      return lifecycleFailure(context, result.status);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      next: "/app/people",
      personId: result.personId,
      status: "deleted",
    });
  });
  routes.post("/api/v1/people", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsed = personSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid person",
        "Review the identity fields and try again.",
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
    const result = await services.people.create(resolved, {
      ...(parsed.data.duplicateOverride === true
        ? { duplicateOverride: true }
        : {}),
      ...(parsed.data.familyName ? { familyName: parsed.data.familyName } : {}),
      givenName: parsed.data.givenName,
      isPartial: parsed.data.isPartial,
      ...(parsed.data.middleName ? { middleName: parsed.data.middleName } : {}),
      ...(parsed.data.nickname ? { nickname: parsed.data.nickname } : {}),
    }).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "people_unavailable",
        "Person could not be created",
        "The person service is temporarily unavailable.",
      );
    }
    if (result.status === "validation-error") {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid person",
        "Review the highlighted identity fields and try again.",
        result.errors,
      );
    }
    if (result.status === "possible-duplicate") {
      return problem(
        context,
        409,
        "possible_duplicate",
        "Possible duplicate",
        `A person named ${
          result.duplicates[0]?.displayName ?? "this"
        } already exists in this workspace. Review the match or create anyway.`,
        { duplicate: "Confirm Create anyway to keep both people." },
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "people_forbidden",
        "Person could not be created",
        "Your active workspace membership no longer permits this change.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      next: `/app/people/${result.person.id}`,
      person: identity(result.person),
      status: "created",
    }, 201);
  });
  return routes;
}
