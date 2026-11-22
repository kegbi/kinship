/**
 * Relationships between people: every route of this surface, once.
 *
 * Each descriptor is what `apps/api` mounts and what
 * `tools/contracts/build.ts` documents. A route the document does not describe
 * fails `deno task contracts:check`, and one that is mounted and not here, or
 * here and never mounted, fails `apps/api/routes_test.ts`.
 */

import { z } from "zod";
import { defineRoute, type RouteDescriptor } from "../registry.ts";
import {
  originAndWorkspaceHeaders,
  problemResponses,
  workspaceHeaders,
} from "./common.ts";
import { personTransitionInput } from "../schemas/people.ts";
import {
  relatedPersonRelationshipChanged,
  relatedPersonRelationshipInput,
  relationshipChanged,
  relationshipCreateInput,
  relationshipDeleted,
  relationshipList,
  relationshipTypeList,
  relationshipUpdateInput,
} from "../schemas/relationships.ts";
import { pageQuery, uuid } from "../schemas/shared.ts";

/**
 * What `listRelationships` accepts in the query string.
 *
 * GAP-023 raised its ceiling to the shared fifty; the page it serves without
 * one is still twenty.
 */
export const listRelationshipsQuery = pageQuery;

export const listRelationships = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/relationships",
  operationId: "listRelationships",
  description:
    "Personal tokens require relationships:read. Returns one person's directional relationships and authorized endpoint names in the bound workspace, including archived people. Hidden sections return no relationships; existing cursor checks apply.",
  tokenScope: "relationships:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    query: listRelationshipsQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Directional relationships for one person profile section",
      content: {
        "application/json": relationshipList,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const createRelationship = defineRoute({
  method: "post",
  path: "/api/v1/people/{personId}/relationships",
  operationId: "createRelationship",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": relationshipCreateInput,
      },
    },
  },
  responses: {
    200: {
      description: "Idempotent existing relationship",
      content: {
        "application/json": relationshipChanged,
      },
    },
    201: {
      description: "Relationship created",
      content: {
        "application/json": relationshipChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const createRelatedPersonRelationship = defineRoute({
  method: "post",
  path: "/api/v1/people/{personId}/relationships/related-person",
  operationId: "createRelatedPersonRelationship",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": relatedPersonRelationshipInput,
      },
    },
  },
  responses: {
    201: {
      description: "Person and relationship created atomically",
      content: {
        "application/json": relatedPersonRelationshipChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const deleteRelationship = defineRoute({
  method: "delete",
  path: "/api/v1/people/{personId}/relationships/{relationshipId}",
  operationId: "deleteRelationship",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
      relationshipId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": personTransitionInput,
      },
    },
  },
  responses: {
    200: {
      description: "Relationship unlinked without deleting either person",
      content: {
        "application/json": relationshipDeleted,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const updateRelationship = defineRoute({
  method: "patch",
  path: "/api/v1/people/{personId}/relationships/{relationshipId}",
  operationId: "updateRelationship",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
      relationshipId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": relationshipUpdateInput,
      },
    },
  },
  responses: {
    200: {
      description: "Relationship updated",
      content: {
        "application/json": relationshipChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

/**
 * What `listRelationshipTypes` accepts in the query string.
 *
 * `selected` is a comma-separated list on the wire, which is what `style: form`
 * and `explode: false` say, so it arrives as one string and is split before the
 * identifiers are parsed.
 */
export const listRelationshipTypesQuery = z.strictObject({
  cursor: z.string().max(2000).optional(),
  search: z.string().trim().max(200).optional(),
  selected: z.array(uuid).max(20).optional().meta({
    param: { style: "form", explode: false },
  }),
});

export const listRelationshipTypes = defineRoute({
  method: "get",
  path: "/api/v1/relationship-types",
  operationId: "listRelationshipTypes",
  description:
    "Personal tokens require relationships:read. Reads the bound workspace's relationship types and resolves selected same-workspace types. Hidden relationship sections return no options; existing cursor and search bounds apply.",
  tokenScope: "relationships:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    query: listRelationshipTypesQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Bounded active workspace relationship types",
      content: {
        "application/json": relationshipTypeList,
      },
    },
    ...problemResponses(400, 401, 403, 409, 503),
  },
});

/** Every relationships route, in the order the surface mounts them. */
export const RELATIONSHIPS_ROUTES: readonly RouteDescriptor[] = [
  listRelationships,
  createRelationship,
  createRelatedPersonRelationship,
  deleteRelationship,
  updateRelationship,
  listRelationshipTypes,
];
