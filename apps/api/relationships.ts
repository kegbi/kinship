import { type Context, Hono } from "hono";
import { z } from "zod";
import type { RelationshipManagement } from "../../packages/backend/modules/relationships/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface RelationshipHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
  readonly relationships: RelationshipManagement;
}

const id = z.uuid();
const createSchema = z.object({
  relationshipTypeId: id,
  targetPersonId: id,
}).strict();
const relatedPersonSchema = z.object({
  person: z.object({
    duplicateOverride: z.boolean().optional(),
    familyName: z.string().trim().max(200).optional(),
    givenName: z.string().trim().max(200),
    isPartial: z.boolean(),
    middleName: z.string().trim().max(200).optional(),
    nickname: z.string().trim().max(200).optional(),
  }).strict(),
  relationshipTypeId: id,
}).strict();
const updateSchema = z.object({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  relationshipTypeId: id,
}).strict();
const deleteSchema = z.object({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
}).strict();
const typesQuery = z.object({
  cursor: z.string().max(2_000).optional(),
  search: z.string().trim().max(200).optional(),
  selected: z.string().max(2_000).transform((value) => value.split(","))
    .pipe(z.array(id).max(20)).optional(),
}).strict();
const listQuery = z.object({
  cursor: z.string().max(2_000).optional(),
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

async function actor(context: Context, services: RelationshipHttpServices) {
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

function origin(context: Context, services: RelationshipHttpServices) {
  return context.req.header("Origin") === services.browserSecurity.origin;
}

function failure(
  context: Context,
  result: {
    readonly errors?: Readonly<Record<string, string>>;
    readonly status: string;
  },
) {
  if (result.status === "forbidden") {
    return problem(
      context,
      403,
      "relationships_forbidden",
      "Relationships unavailable",
      "Your active workspace membership no longer permits this action.",
    );
  }
  if (result.status === "not-found") {
    return problem(
      context,
      404,
      "relationship_not_found",
      "Relationship unavailable",
      "The relationship, person, or type does not exist in the active workspace.",
    );
  }
  if (result.status === "archived-write-rejected") {
    return problem(
      context,
      409,
      "archived_write_rejected",
      "Archived person is read-only",
      "Restore both people before changing their relationship.",
    );
  }
  if (result.status === "stale") {
    return problem(
      context,
      409,
      "relationship_stale",
      "Relationship changed",
      "Refresh relationships before trying again.",
    );
  }
  if (result.status === "possible-duplicate") {
    return problem(
      context,
      409,
      "related_person_possible_duplicate",
      "Possible duplicate person",
      "Choose the existing person or explicitly confirm creating another.",
    );
  }
  return problem(
    context,
    400,
    "validation_failed",
    "Invalid relationship",
    "Review the selected person, type, and current version.",
    result.errors,
  );
}

export function createRelationshipRoutes(
  services: RelationshipHttpServices,
): Hono {
  const routes = new Hono();
  routes.get("/api/v1/relationship-types", async (context) => {
    const parsed = typesQuery.safeParse(context.req.query());
    if (!parsed.success) {
      return problem(
        context,
        400,
        "relationship_types_query_invalid",
        "Invalid relationship type query",
        "Review the search and selected type.",
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
    const result = await services.relationships.listTypes(resolved, {
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
      ...(parsed.data.search ? { search: parsed.data.search } : {}),
      ...(parsed.data.selected
        ? { selectedTypeIds: parsed.data.selected }
        : {}),
    }).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "relationship_types_unavailable",
        "Relationship types unavailable",
        "Relationship types are temporarily unavailable.",
      );
    }
    if (result.status === "stale-cursor") {
      return problem(
        context,
        409,
        "relationship_types_cursor_stale",
        "Relationship types changed",
        "Restart relationship type search from the first page.",
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "relationship_types_forbidden",
        "Relationship types unavailable",
        "Your active workspace no longer permits this action.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.get("/api/v1/people/:personId/relationships", async (context) => {
    const personId = id.safeParse(context.req.param("personId"));
    const query = listQuery.safeParse(context.req.query());
    if (!personId.success || !query.success) {
      return problem(
        context,
        400,
        "relationship_request_invalid",
        "Invalid relationship request",
        "Use a canonical person identifier.",
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
    const result = await services.relationships.list(resolved, personId.data, {
      ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
      limit: query.data.limit,
    })
      .catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "relationships_unavailable",
        "Relationships unavailable",
        "This relationship section is temporarily unavailable.",
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "relationships_forbidden",
        "Relationships unavailable",
        "Your active workspace membership no longer permits this view.",
      );
    }
    if (result.status === "not-found") {
      return problem(
        context,
        404,
        "relationship_not_found",
        "Relationships unavailable",
        "The person does not exist in the active workspace.",
      );
    }
    if (result.status === "stale-cursor") {
      return problem(
        context,
        409,
        "relationships_cursor_stale",
        "Relationships changed",
        "Refresh the relationship section before loading another page.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.post("/api/v1/people/:personId/relationships", async (context) => {
    if (!origin(context, services)) {
      return problem(
        context,
        403,
        "origin_invalid",
        "Request forbidden",
        "This request did not come from the configured application origin.",
      );
    }
    const personId = id.safeParse(context.req.param("personId"));
    const input = createSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!personId.success || !input.success) {
      return problem(
        context,
        400,
        "relationship_request_invalid",
        "Invalid relationship",
        "Select another person and an active relationship type.",
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
    const result = await services.relationships.create(
      resolved,
      personId.data,
      input.data,
    ).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "relationships_unavailable",
        "Relationships unavailable",
        "The relationship could not be saved.",
      );
    }
    if (result.status !== "created" && result.status !== "existing") {
      return failure(context, result);
    }
    return context.json(result, result.status === "created" ? 201 : 200);
  });
  routes.post(
    "/api/v1/people/:personId/relationships/related-person",
    async (context) => {
      if (!origin(context, services)) {
        return problem(
          context,
          403,
          "origin_invalid",
          "Request forbidden",
          "This request did not come from the configured application origin.",
        );
      }
      const personId = id.safeParse(context.req.param("personId"));
      const input = relatedPersonSchema.safeParse(
        await context.req.json().catch(() => undefined),
      );
      if (!personId.success || !input.success) {
        return problem(
          context,
          400,
          "relationship_request_invalid",
          "Invalid related person",
          "Provide a valid person identity and active relationship type.",
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
      const result = await services.relationships.createRelatedPerson(
        resolved,
        personId.data,
        {
          person: {
            ...(input.data.person.duplicateOverride === true
              ? { duplicateOverride: true }
              : {}),
            ...(input.data.person.familyName
              ? { familyName: input.data.person.familyName }
              : {}),
            givenName: input.data.person.givenName,
            isPartial: input.data.person.isPartial,
            ...(input.data.person.middleName
              ? { middleName: input.data.person.middleName }
              : {}),
            ...(input.data.person.nickname
              ? { nickname: input.data.person.nickname }
              : {}),
          },
          relationshipTypeId: input.data.relationshipTypeId,
        },
      ).catch(() => undefined);
      if (!result) {
        return problem(
          context,
          503,
          "relationships_unavailable",
          "Related person unavailable",
          "Neither the person nor relationship was saved.",
        );
      }
      return result.status === "created"
        ? context.json(result, 201)
        : failure(context, result);
    },
  );
  routes.patch(
    "/api/v1/people/:personId/relationships/:relationshipId",
    async (context) => {
      if (!origin(context, services)) {
        return problem(
          context,
          403,
          "origin_invalid",
          "Request forbidden",
          "This request did not come from the configured application origin.",
        );
      }
      const personId = id.safeParse(context.req.param("personId"));
      const relationshipId = id.safeParse(context.req.param("relationshipId"));
      const input = updateSchema.safeParse(
        await context.req.json().catch(() => undefined),
      );
      if (!personId.success || !relationshipId.success || !input.success) {
        return problem(
          context,
          400,
          "relationship_request_invalid",
          "Invalid relationship",
          "Use current canonical identifiers and version.",
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
      const result = await services.relationships.update(
        resolved,
        personId.data,
        relationshipId.data,
        input.data,
      ).catch(() => undefined);
      if (!result) {
        return problem(
          context,
          503,
          "relationships_unavailable",
          "Relationships unavailable",
          "The relationship could not be changed.",
        );
      }
      return result.status === "updated"
        ? context.json(result)
        : failure(context, result);
    },
  );
  routes.delete(
    "/api/v1/people/:personId/relationships/:relationshipId",
    async (context) => {
      if (!origin(context, services)) {
        return problem(
          context,
          403,
          "origin_invalid",
          "Request forbidden",
          "This request did not come from the configured application origin.",
        );
      }
      const personId = id.safeParse(context.req.param("personId"));
      const relationshipId = id.safeParse(context.req.param("relationshipId"));
      const input = deleteSchema.safeParse(
        await context.req.json().catch(() => undefined),
      );
      if (!personId.success || !relationshipId.success || !input.success) {
        return problem(
          context,
          400,
          "relationship_request_invalid",
          "Invalid relationship",
          "Use current canonical identifiers and version.",
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
      const result = await services.relationships.delete(
        resolved,
        personId.data,
        relationshipId.data,
        input.data,
      ).catch(() => undefined);
      if (!result) {
        return problem(
          context,
          503,
          "relationships_unavailable",
          "Relationships unavailable",
          "The relationship could not be unlinked.",
        );
      }
      return result.status === "deleted"
        ? context.json(result)
        : failure(context, result);
    },
  );
  return routes;
}
