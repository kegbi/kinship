/**
 * Relationships between people over HTTP.
 *
 * Two reads and four writes. The problem responder, the session cookie, the
 * origin check, and the kernel status map came from `packages/http-kit` (GAP-019,
 * GAP-020).
 *
 * Both reads and three of the writes also admit a personal token (MCP-B3). A
 * cookie write still answers its Origin first, its body second, and its session
 * last, as it always has; a bearer write skips the Origin, and its token is
 * admitted where the cookie's session would have been. The related-person
 * write creates a person too, which would need a second grant, so it stays
 * session-only.
 *
 * The type list keeps its own refusals rather than sharing the relationship
 * ones: a workspace that cannot offer relationship types is a different
 * outage, on a different part of the form, from one that cannot save a link
 * between two people, and the page shows them in different places.
 */

import { Hono } from "hono";
import type { RelationshipManagement } from "../../public.ts";
import type { createProtectedSessionCoordinator } from "../../../workspaces/public.ts";
import {
  createRelatedPersonRelationship,
  createRelationship,
  deleteRelationship,
  listRelationships,
  listRelationshipsQuery,
  listRelationshipTypes,
  listRelationshipTypesQuery,
  updateRelationship,
} from "../../../../../contracts/routes/relationships.ts";
import { personTransitionInput } from "../../../../../contracts/schemas/people.ts";
import {
  relatedPersonRelationshipInput,
  relationshipCreateInput,
  relationshipUpdateInput,
} from "../../../../../contracts/schemas/relationships.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import type { BrowserSecurityPolicy } from "../../../../../http-kit/security_policy.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import {
  requireCookieWriteOrigin,
  requireMatchingOrigin,
} from "../../../../../http-kit/origin.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import {
  type PersonalTokenAuthority,
  scopedRouteActor,
} from "../../../../../http-kit/scoped_actor.ts";
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

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface RelationshipHttpServices {
  readonly apiTokens?: PersonalTokenAuthority;
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
  readonly relationships: RelationshipManagement;
}

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
  const session = sessionActor(services);
  const origin = requireMatchingOrigin(services.browserSecurity);
  const tokens = {
    browserSecurity: services.browserSecurity,
    tokens: services.apiTokens,
  };
  const typesActor = scopedRouteActor(listRelationshipTypes, tokens);
  const relationshipsActor = scopedRouteActor(listRelationships, tokens);
  const createActor = scopedRouteActor(createRelationship, tokens);
  const updateActor = scopedRouteActor(updateRelationship, tokens);
  const deleteActor = scopedRouteActor(deleteRelationship, tokens);
  // A cookie write is refused for its Origin before its body is read; a
  // request that carries `Authorization` is the token admission's to judge.
  const cookieOrigin = requireCookieWriteOrigin(services.browserSecurity);

  mount(routes, listRelationshipTypes, session, async (context) => {
    // `selected` travels as one comma-separated value, which is what
    // `style: form, explode: false` means; splitting it here keeps the
    // documented schema an array of identifiers rather than a string.
    const query = context.req.query();
    const parsed = parseValue(listRelationshipTypesQuery, {
      ...query,
      ...(query.selected === undefined
        ? {}
        : { selected: query.selected.split(",") }),
    });
    if ("errors" in parsed) {
      return definedProblem(context, TYPES_QUERY_INVALID);
    }
    const actor = await typesActor(context);
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

  mount(
    routes,
    listRelationships,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const query = parseQuery(context, listRelationshipsQuery);
      if ("errors" in personId || "errors" in query) {
        return definedProblem(context, SECTION_REQUEST_INVALID);
      }
      const actor = await relationshipsActor(context);
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

  mount(
    routes,
    createRelationship,
    cookieOrigin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const input = await parseJsonBody(context, relationshipCreateInput);
      if ("errors" in personId || "errors" in input) {
        return definedProblem(context, CREATE_REQUEST_INVALID);
      }
      const actor = await createActor(context);
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

  mount(
    routes,
    createRelatedPersonRelationship,
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const input = await parseJsonBody(
        context,
        relatedPersonRelationshipInput,
      );
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

  mount(
    routes,
    updateRelationship,
    cookieOrigin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const relationshipId = parseValue(
        uuid,
        context.req.param("relationshipId"),
      );
      const input = await parseJsonBody(context, relationshipUpdateInput);
      if (
        "errors" in personId || "errors" in relationshipId || "errors" in input
      ) return definedProblem(context, VERSIONED_REQUEST_INVALID);
      const actor = await updateActor(context);
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

  mount(
    routes,
    deleteRelationship,
    cookieOrigin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const relationshipId = parseValue(
        uuid,
        context.req.param("relationshipId"),
      );
      const input = await parseJsonBody(context, personTransitionInput);
      if (
        "errors" in personId || "errors" in relationshipId || "errors" in input
      ) return definedProblem(context, VERSIONED_REQUEST_INVALID);
      const actor = await deleteActor(context);
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
