/**
 * Relationships between people over HTTP.
 *
 * Two reads and four writes. The problem responder, the session cookie, the
 * origin check, and the kernel status map came from `http/` (GAP-019,
 * GAP-020).
 *
 * The type list keeps its own refusals rather than sharing the relationship
 * ones: a workspace that cannot offer relationship types is a different
 * outage, on a different part of the form, from one that cannot save a link
 * between two people, and the page shows them in different places.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { RelationshipManagement } from "../../packages/backend/modules/relationships/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";
import { failureResponder, type FailureTable } from "./http/failures.ts";
import { requireMatchingOrigin } from "./http/origin.ts";
import { definedProblem, type ProblemDefinition } from "./http/problem.ts";
import { type ActorEnv, requireActor, sessionActor } from "./http/session.ts";
import { parseJsonBody, parseQuery, parseValue } from "./http/validate.ts";

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

/** What a refused relationship write says. */
export const RELATIONSHIP_FAILURES: FailureTable = {
  fallback: {
    code: "validation_failed",
    detail: "Review the selected person, type, and current version.",
    status: 400,
    title: "Invalid relationship",
  },
  statuses: {
    "archived-write-rejected": {
      code: "archived_write_rejected",
      detail: "Restore both people before changing their relationship.",
      title: "Archived person is read-only",
    },
    forbidden: {
      code: "relationships_forbidden",
      detail: "Your active workspace membership no longer permits this action.",
      title: "Relationships unavailable",
    },
    "not-found": {
      code: "relationship_not_found",
      detail:
        "The relationship, person, or type does not exist in the active workspace.",
      title: "Relationship unavailable",
    },
    "possible-duplicate": {
      code: "related_person_possible_duplicate",
      detail:
        "Choose the existing person or explicitly confirm creating another.",
      status: 409,
      title: "Possible duplicate person",
    },
    stale: {
      code: "relationship_stale",
      detail: "Refresh relationships before trying again.",
      status: 409,
      title: "Relationship changed",
    },
  },
};

/** What a refused read of one person's relationships says. */
export const RELATIONSHIP_SECTION_FAILURES: FailureTable = {
  fallback: {
    code: "relationships_unavailable",
    detail: "This relationship section is temporarily unavailable.",
    status: 503,
    title: "Relationships unavailable",
  },
  statuses: {
    forbidden: {
      code: "relationships_forbidden",
      detail: "Your active workspace membership no longer permits this view.",
      title: "Relationships unavailable",
    },
    "not-found": {
      code: "relationship_not_found",
      detail: "The person does not exist in the active workspace.",
      title: "Relationships unavailable",
    },
    "stale-cursor": {
      code: "relationships_cursor_stale",
      detail: "Refresh the relationship section before loading another page.",
      status: 409,
      title: "Relationships changed",
    },
  },
};

/** What a refused read of the relationship types says. */
export const RELATIONSHIP_TYPE_FAILURES: FailureTable = {
  fallback: {
    code: "relationship_types_unavailable",
    detail: "Relationship types are temporarily unavailable.",
    status: 503,
    title: "Relationship types unavailable",
  },
  statuses: {
    forbidden: {
      code: "relationship_types_forbidden",
      detail: "Your active workspace no longer permits this action.",
      title: "Relationship types unavailable",
    },
    "stale-cursor": {
      code: "relationship_types_cursor_stale",
      detail: "Restart relationship type search from the first page.",
      status: 409,
      title: "Relationship types changed",
    },
  },
};

const failure = failureResponder(RELATIONSHIP_FAILURES);
const sectionFailure = failureResponder(RELATIONSHIP_SECTION_FAILURES);
const typeFailure = failureResponder(RELATIONSHIP_TYPE_FAILURES);

const TYPES_QUERY_INVALID: ProblemDefinition = {
  code: "relationship_types_query_invalid",
  detail: "Review the search and selected type.",
  status: 400,
  title: "Invalid relationship type query",
};
const SECTION_REQUEST_INVALID: ProblemDefinition = {
  code: "relationship_request_invalid",
  detail: "Use a canonical person identifier.",
  status: 400,
  title: "Invalid relationship request",
};
const CREATE_REQUEST_INVALID: ProblemDefinition = {
  code: "relationship_request_invalid",
  detail: "Select another person and an active relationship type.",
  status: 400,
  title: "Invalid relationship",
};
const RELATED_PERSON_INVALID: ProblemDefinition = {
  code: "relationship_request_invalid",
  detail: "Provide a valid person identity and active relationship type.",
  status: 400,
  title: "Invalid related person",
};
const VERSIONED_REQUEST_INVALID: ProblemDefinition = {
  code: "relationship_request_invalid",
  detail: "Use current canonical identifiers and version.",
  status: 400,
  title: "Invalid relationship",
};
const RELATIONSHIP_NOT_SAVED: ProblemDefinition = {
  code: "relationships_unavailable",
  detail: "The relationship could not be saved.",
  status: 503,
  title: "Relationships unavailable",
};
const RELATED_PERSON_NOT_SAVED: ProblemDefinition = {
  code: "relationships_unavailable",
  detail: "Neither the person nor relationship was saved.",
  status: 503,
  title: "Related person unavailable",
};
const RELATIONSHIP_NOT_CHANGED: ProblemDefinition = {
  code: "relationships_unavailable",
  detail: "The relationship could not be changed.",
  status: 503,
  title: "Relationships unavailable",
};
const RELATIONSHIP_NOT_UNLINKED: ProblemDefinition = {
  code: "relationships_unavailable",
  detail: "The relationship could not be unlinked.",
  status: 503,
  title: "Relationships unavailable",
};

/** Every problem this file answers on its own, for the pinning suite. */
export const RELATIONSHIP_PROBLEMS: readonly ProblemDefinition[] = [
  CREATE_REQUEST_INVALID,
  RELATED_PERSON_INVALID,
  RELATED_PERSON_NOT_SAVED,
  RELATIONSHIP_NOT_CHANGED,
  RELATIONSHIP_NOT_SAVED,
  RELATIONSHIP_NOT_UNLINKED,
  SECTION_REQUEST_INVALID,
  TYPES_QUERY_INVALID,
  VERSIONED_REQUEST_INVALID,
];

export function createRelationshipRoutes(
  services: RelationshipHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  routes.get("/api/v1/relationship-types", session, async (context) => {
    const parsed = parseQuery(context, typesQuery);
    if ("errors" in parsed) {
      return definedProblem(context, TYPES_QUERY_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.relationships.listTypes(actor, {
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
      ...(parsed.data.search ? { search: parsed.data.search } : {}),
      ...(parsed.data.selected
        ? { selectedTypeIds: parsed.data.selected }
        : {}),
    }).catch(() => undefined);
    if (!result) return typeFailure(context, "unavailable");
    if (result.status === "forbidden" || result.status === "stale-cursor") {
      return typeFailure(context, result);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  routes.get(
    "/api/v1/people/:personId/relationships",
    session,
    async (context) => {
      const personId = parseValue(id, context.req.param("personId"));
      const query = parseQuery(context, listQuery);
      if ("errors" in personId || "errors" in query) {
        return definedProblem(context, SECTION_REQUEST_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.relationships.list(actor, personId.data, {
        ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
        limit: query.data.limit,
      }).catch(() => undefined);
      if (!result) return sectionFailure(context, "unavailable");
      if (
        result.status === "forbidden" || result.status === "not-found" ||
        result.status === "stale-cursor"
      ) return sectionFailure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  routes.post(
    "/api/v1/people/:personId/relationships",
    origin,
    session,
    async (context) => {
      const personId = parseValue(id, context.req.param("personId"));
      const input = await parseJsonBody(context, createSchema);
      if ("errors" in personId || "errors" in input) {
        return definedProblem(context, CREATE_REQUEST_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.relationships.create(
        actor,
        personId.data,
        input.data,
      ).catch(() => undefined);
      if (!result) return definedProblem(context, RELATIONSHIP_NOT_SAVED);
      if (result.status !== "created" && result.status !== "existing") {
        return failure(context, result);
      }
      return context.json(result, result.status === "created" ? 201 : 200);
    },
  );

  routes.post(
    "/api/v1/people/:personId/relationships/related-person",
    origin,
    session,
    async (context) => {
      const personId = parseValue(id, context.req.param("personId"));
      const input = await parseJsonBody(context, relatedPersonSchema);
      if ("errors" in personId || "errors" in input) {
        return definedProblem(context, RELATED_PERSON_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.relationships.createRelatedPerson(
        actor,
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
      if (!result) return definedProblem(context, RELATED_PERSON_NOT_SAVED);
      return result.status === "created"
        ? context.json(result, 201)
        : failure(context, result);
    },
  );

  routes.patch(
    "/api/v1/people/:personId/relationships/:relationshipId",
    origin,
    session,
    async (context) => {
      const personId = parseValue(id, context.req.param("personId"));
      const relationshipId = parseValue(
        id,
        context.req.param("relationshipId"),
      );
      const input = await parseJsonBody(context, updateSchema);
      if (
        "errors" in personId || "errors" in relationshipId || "errors" in input
      ) return definedProblem(context, VERSIONED_REQUEST_INVALID);
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.relationships.update(
        actor,
        personId.data,
        relationshipId.data,
        input.data,
      ).catch(() => undefined);
      if (!result) return definedProblem(context, RELATIONSHIP_NOT_CHANGED);
      return result.status === "updated"
        ? context.json(result)
        : failure(context, result);
    },
  );

  routes.delete(
    "/api/v1/people/:personId/relationships/:relationshipId",
    origin,
    session,
    async (context) => {
      const personId = parseValue(id, context.req.param("personId"));
      const relationshipId = parseValue(
        id,
        context.req.param("relationshipId"),
      );
      const input = await parseJsonBody(context, deleteSchema);
      if (
        "errors" in personId || "errors" in relationshipId || "errors" in input
      ) return definedProblem(context, VERSIONED_REQUEST_INVALID);
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.relationships.delete(
        actor,
        personId.data,
        relationshipId.data,
        input.data,
      ).catch(() => undefined);
      if (!result) return definedProblem(context, RELATIONSHIP_NOT_UNLINKED);
      return result.status === "deleted"
        ? context.json(result)
        : failure(context, result);
    },
  );
  return routes;
}
