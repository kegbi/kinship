/**
 * People over HTTP: the directory, the page, and everything on it, once.
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
  tokenOrSessionWriteHeaders,
  workspaceHeaders,
} from "./common.ts";
import {
  importantDateChanged,
  importantDateDeleted,
  importantDateInput,
  importantDateList,
  importantDateUpdateInput,
  peopleBulkInput,
  peopleBulkResult,
  peopleDirectoryPage,
  peopleDuplicateDismissalInput,
  peopleDuplicateDismissed,
  peopleDuplicates,
  peopleTagFacet,
  peopleTagOptionsPage,
  personAvatarChanged,
  personCreated,
  personDeleted,
  personDeleteInput,
  personDeletionImpact,
  personEditInput,
  personIdentityReady,
  personInput,
  personLifecycleChanged,
  personLifeEventChanged,
  personLifeEventDeleted,
  personLifeEventInput,
  personLifeEventsReady,
  personLifeEventUpdateInput,
  personMerged,
  personMergeInput,
  personMergePreview,
  personStarChanged,
  personTimelinePage,
  personTransitionInput,
  personViewRecorded,
  profileFactChanged,
  profileFactCreateInput,
  profileFactDeleted,
  profileFactDeleteInput,
  profileFactSection,
  profileFactSectionId,
  profileFactUpdateInput,
  todayRecentPeople,
} from "../schemas/people.ts";
import { personReady } from "../schemas/person_rail.ts";
import { uuid } from "../schemas/shared.ts";

/**
 * What `listPeople` accepts in the query string.
 *
 * A query string is text, so the bounded page size is coerced and the search
 * is trimmed before either is measured; anything the directory does not name
 * is refused rather than ignored.
 */
export const listPeopleQuery = z.strictObject({
  cursor: z.string().max(2000).optional(),
  excludePersonId: z.uuid().optional(),
  search: z.string().trim().max(200).optional(),
  selectedPersonId: z.uuid().optional(),
  tag: z.uuid().optional(),
  lifecycle: z.enum(["active", "archived"]).default("active"),
  sort: z.enum([
    "given-name",
    "family-name",
    "recently-added",
    "last-contacted",
    "recently-updated",
  ]).default("given-name"),
  starred: z.enum(["true", "false"]).optional().meta({
    description: "Only starred people (GAP-053).",
  }),
  starredFirst: z.enum(["true", "false"]).optional().meta({
    description:
      "Starred people before everybody else, each group in the sort order.",
  }),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const listPeople = defineRoute({
  method: "get",
  path: "/api/v1/people",
  operationId: "listPeople",
  description:
    "Directory only. Personal tokens require the people:read grant; it does not permit person identity, profile facts, dates, relationships, or profile aggregates.",
  tokenScope: "people:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    query: listPeopleQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Tenant-scoped people directory page",
      content: {
        "application/json": peopleDirectoryPage,
      },
    },
    ...problemResponses(400, 401, 403, 409, 503),
  },
});

export const createPerson = defineRoute({
  method: "post",
  path: "/api/v1/people",
  operationId: "createPerson",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": personInput,
      },
    },
  },
  responses: {
    201: {
      description: "Workspace-owned person created",
      content: {
        "application/json": personCreated,
      },
    },
    ...problemResponses(400, 401, 403, 409, 503),
  },
});

export const getPersonIdentity = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/identity",
  operationId: "getPersonIdentity",
  description:
    "Minimal person name and identifier, including archived people. Personal tokens require people:profile:read. Returns no profile aggregate, notes, timeline, tasks, or file data.",
  tokenScope: "people:profile:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: { params: z.object({ personId: uuid }), headers: workspaceHeaders },
  responses: {
    200: {
      description: "Workspace-scoped minimal person identity",
      content: { "application/json": personIdentityReady },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

/** What `listPeopleTagOptions` accepts in the query string. */
export const listPeopleTagOptionsQuery = z.strictObject({
  search: z.string().trim().max(200).optional(),
  cursor: z.string().max(2000).optional(),
  selected: z.uuid().optional(),
});

export const listPeopleTagOptions = defineRoute({
  method: "get",
  path: "/api/v1/people/tag-options",
  operationId: "listPeopleTagOptions",
  security: [{ kinship_session: [] }],
  request: {
    query: listPeopleTagOptionsQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Bounded tenant-scoped people tag options",
      content: {
        "application/json": peopleTagOptionsPage,
      },
    },
    ...problemResponses(400, 401, 403, 409, 503),
  },
});

/** What `listPeopleTagFacet` accepts in the query string. */
export const listPeopleTagFacetQuery = z.strictObject({
  lifecycle: z.enum(["active", "archived"]).default("active"),
});

export const listPeopleTagFacet = defineRoute({
  method: "get",
  path: "/api/v1/people/tag-facet",
  operationId: "listPeopleTagFacet",
  description:
    "The workspace's tags with how many people of the active or archived view carry each, most carried first, at most thirty; `truncated` says more tags are in use.",
  security: [{ kinship_session: [] }],
  request: {
    query: listPeopleTagFacetQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Bounded tenant-scoped tag counts for the directory view",
      content: {
        "application/json": peopleTagFacet,
      },
    },
    ...problemResponses(400, 401, 403, 503),
  },
});

export const deletePerson = defineRoute({
  method: "delete",
  path: "/api/v1/people/{personId}",
  operationId: "deletePerson",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": personDeleteInput,
      },
    },
  },
  responses: {
    200: {
      description: "Atomic current-workspace person lifecycle change",
      content: {
        "application/json": personDeleted,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

/** What `getPerson` accepts in the query string. */
export const getPersonQuery = z.strictObject({
  include: z.enum(["summary", "rail"]).optional().meta({
    description:
      "summary adds the bounded person summary; rail adds the summary and the first page of every rail section, each with its own status. Neither changes the default response.",
  }),
});

export const getPerson = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}",
  operationId: "getPerson",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    query: getPersonQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description:
        "Current-workspace person identity, lifecycle, due-information shell, optional bounded summary, and optional composed rail",
      content: {
        "application/json": personReady,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const editPerson = defineRoute({
  method: "patch",
  path: "/api/v1/people/{personId}",
  operationId: "editPerson",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": personEditInput,
      },
    },
  },
  responses: {
    200: {
      description: "Atomic current-workspace person lifecycle change",
      content: {
        "application/json": personLifecycleChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const archivePerson = defineRoute({
  method: "post",
  path: "/api/v1/people/{personId}/archive",
  operationId: "archivePerson",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
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
      description: "Atomic current-workspace person lifecycle change",
      content: {
        "application/json": personLifecycleChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

/** The images an avatar may be, each bounded by the avatar's own limit. */
const AVATAR_MAX_BYTES = 1048576;
const avatarImage = z.string().max(AVATAR_MAX_BYTES).meta({ format: "binary" });

export const listPeopleDuplicates = defineRoute({
  method: "get",
  path: "/api/v1/people/duplicates",
  operationId: "listPeopleDuplicates",
  security: [{ kinship_session: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description:
        "Bounded pairs of active people in the workspace who share a full name, an email address, or a phone number",
      content: {
        "application/json": peopleDuplicates,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const dismissPeopleDuplicate = defineRoute({
  method: "post",
  path: "/api/v1/people/duplicates/dismissals",
  operationId: "dismissPeopleDuplicate",
  description:
    "Marks two people from the duplicate review as not duplicates for the whole workspace. Dismissing a dismissed pair changes nothing.",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": peopleDuplicateDismissalInput,
      },
    },
  },
  responses: {
    200: {
      description:
        "The duplicate review no longer offers the pair to any member of the workspace",
      content: {
        "application/json": peopleDuplicateDismissed,
      },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

/** What `previewPeopleMerge` accepts in the query string. */
export const previewPeopleMergeQuery = z.strictObject({
  duplicateId: z.uuid(),
});

export const previewPeopleMerge = defineRoute({
  method: "get",
  path: "/api/v1/people/{primaryId}/merge-preview",
  operationId: "previewPeopleMerge",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      primaryId: uuid,
    }),
    query: previewPeopleMergeQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description:
        "What merging the duplicate into the primary would keep, discard, and move, from the same decision the merge takes",
      content: {
        "application/json": personMergePreview,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const mergePeople = defineRoute({
  method: "post",
  path: "/api/v1/people/{primaryId}/merge",
  operationId: "mergePeople",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      primaryId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": personMergeInput,
      },
    },
  },
  responses: {
    200: {
      description:
        "Every record of the duplicate now belongs to the primary and the duplicate is deleted; a merge cannot be undone",
      content: {
        "application/json": personMerged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const replacePersonAvatar = defineRoute({
  method: "put",
  path: "/api/v1/people/{personId}/avatar",
  operationId: "replacePersonAvatar",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: z.object({
      Origin: z.url().meta({
        description: "Must exactly match the configured public web origin.",
      }),
      "X-Workspace-Id": z.uuid().optional().meta({
        description:
          "Optional requested workspace; validated against active membership.",
      }),
      "X-File-Name": z.string().max(500),
    }),
    body: {
      required: true,
      content: {
        "image/jpeg": avatarImage,
        "image/png": avatarImage,
        "image/webp": avatarImage,
      },
    },
  },
  responses: {
    200: {
      description:
        "The image is stored, scanned, and now the person's avatar; the one it replaced is removed",
      content: {
        "application/json": personAvatarChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 413, 415, 423, 503),
  },
});

export const removePersonAvatar = defineRoute({
  method: "delete",
  path: "/api/v1/people/{personId}/avatar",
  operationId: "removePersonAvatar",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
  },
  responses: {
    200: {
      description: "The person is drawn with their initials again",
      content: {
        "application/json": personAvatarChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

const starRequest = {
  params: z.object({
    personId: uuid,
  }),
  headers: originAndWorkspaceHeaders,
};

export const starPerson = defineRoute({
  method: "put",
  path: "/api/v1/people/{personId}/star",
  operationId: "starPerson",
  description:
    "Stars the person for the whole workspace. Starring a starred person changes nothing, and an archived person's star is read-only.",
  security: [{ kinship_session: [] }],
  request: starRequest,
  responses: {
    200: {
      description: "The person is starred",
      content: {
        "application/json": personStarChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const unstarPerson = defineRoute({
  method: "delete",
  path: "/api/v1/people/{personId}/star",
  operationId: "unstarPerson",
  description:
    "Removes the person's workspace star. An unstarred person is unchanged, and an archived person's star is read-only.",
  security: [{ kinship_session: [] }],
  request: starRequest,
  responses: {
    200: {
      description: "The person is no longer starred",
      content: {
        "application/json": personStarChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const listImportantDates = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/dates",
  operationId: "listImportantDates",
  description:
    "Personal tokens require people:profile:read. Reads important dates, including archived people, preserving stored date precision.",
  tokenScope: "people:profile:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Exact important-date list for one workspace person",
      content: {
        "application/json": importantDateList,
      },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

export const createImportantDate = defineRoute({
  method: "post",
  path: "/api/v1/people/{personId}/dates",
  operationId: "createImportantDate",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": importantDateInput,
      },
    },
  },
  responses: {
    201: {
      description: "Important date created",
      content: {
        "application/json": importantDateChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const deleteImportantDate = defineRoute({
  method: "delete",
  path: "/api/v1/people/{personId}/dates/{dateId}",
  operationId: "deleteImportantDate",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
      dateId: uuid,
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
      description: "Important date deleted",
      content: {
        "application/json": importantDateDeleted,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const updateImportantDate = defineRoute({
  method: "patch",
  path: "/api/v1/people/{personId}/dates/{dateId}",
  operationId: "updateImportantDate",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
      dateId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": importantDateUpdateInput,
      },
    },
  },
  responses: {
    200: {
      description: "Important date updated",
      content: {
        "application/json": importantDateChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const getPersonDeletionImpact = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/deletion-impact",
  operationId: "getPersonDeletionImpact",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Canonical soft-delete impact and confirmation",
      content: {
        "application/json": personDeletionImpact,
      },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

/**
 * What `listProfileFacts` accepts in the query string.
 *
 * The option continuation is only meaningful while the options are being
 * asked for, so an `optionCursor` without `includeOptions` is refused here
 * rather than carried into the read as a cursor for a page nobody requested.
 */
export const listProfileFactsQuery = z.strictObject({
  cursor: z.string().max(2000).optional(),
  includeOptions: z.literal("true").optional(),
  optionCursor: z.string().max(2000).optional().meta({
    description: "Requires includeOptions=true.",
  }),
  optionSearch: z.string().trim().max(200).optional(),
}).superRefine((query, context) => {
  if (query.optionCursor && query.includeOptions !== "true") {
    context.addIssue({
      code: "custom",
      message: "Option continuation requires includeOptions=true.",
      path: ["optionCursor"],
    });
  }
});

export const listProfileFacts = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/facts/{section}",
  operationId: "listProfileFacts",
  description:
    "Personal tokens require people:profile:read. Reads one profile-fact section and its lookup options when requested. Hidden sections return no saved records or options; archived people remain readable. Existing person, section, revision, and option-search cursor checks apply.",
  tokenScope: "people:profile:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
      section: profileFactSectionId,
    }),
    query: listProfileFactsQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "One enabled person profile-fact section",
      content: {
        "application/json": profileFactSection,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const createProfileFact = defineRoute({
  method: "post",
  path: "/api/v1/people/{personId}/facts/{section}",
  operationId: "createProfileFact",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
      section: profileFactSectionId,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": profileFactCreateInput,
      },
    },
  },
  responses: {
    200: {
      description: "Profile fact saved",
      content: {
        "application/json": profileFactChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const deleteProfileFact = defineRoute({
  method: "delete",
  path: "/api/v1/people/{personId}/facts/{section}/{factId}",
  operationId: "deleteProfileFact",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
      section: profileFactSectionId,
      factId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": profileFactDeleteInput,
      },
    },
  },
  responses: {
    200: {
      description: "Profile fact deleted",
      content: {
        "application/json": profileFactDeleted,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const updateProfileFact = defineRoute({
  method: "put",
  path: "/api/v1/people/{personId}/facts/{section}/{factId}",
  operationId: "updateProfileFact",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
      section: profileFactSectionId,
      factId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": profileFactUpdateInput,
      },
    },
  },
  responses: {
    200: {
      description: "Profile fact updated",
      content: {
        "application/json": profileFactChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const listPersonLifeEvents = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/life-events",
  operationId: "listPersonLifeEvents",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description:
        "Bounded precision-aware life-event history from the person profile read model",
      content: {
        "application/json": personLifeEventsReady,
      },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

/**
 * Recording, editing, and removing a life event (JOURNAL-002). The journal
 * module owns `life_events` and serves these three; they sit beside the read
 * above because they are one section of the person's page.
 */
export const createPersonLifeEvent = defineRoute({
  method: "post",
  path: "/api/v1/people/{personId}/life-events",
  operationId: "createPersonLifeEvent",
  description:
    "Personal tokens require people:write. Records a life event on a person of the token's workspace; a retry records a second one. Does not grant reading life events. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "people:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: {
        "application/json": personLifeEventInput,
      },
    },
  },
  responses: {
    201: {
      description: "Life event recorded on a current-workspace person",
      content: {
        "application/json": personLifeEventChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const updatePersonLifeEvent = defineRoute({
  method: "patch",
  path: "/api/v1/people/{personId}/life-events/{lifeEventId}",
  operationId: "updatePersonLifeEvent",
  description:
    "Personal tokens require people:write. Replaces the life event when expectedUpdatedAt still matches its revision; a stale revision is refused with 409. Does not grant reading life events. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "people:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
      lifeEventId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: {
        "application/json": personLifeEventUpdateInput,
      },
    },
  },
  responses: {
    200: {
      description: "Life event replaced at the expected revision",
      content: {
        "application/json": personLifeEventChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const deletePersonLifeEvent = defineRoute({
  method: "delete",
  path: "/api/v1/people/{personId}/life-events/{lifeEventId}",
  operationId: "deletePersonLifeEvent",
  description:
    "Personal tokens require people:write. Removes the life event when expectedUpdatedAt still matches its revision; a stale revision is refused with 409. Does not grant reading life events. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "people:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
      lifeEventId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: {
        "application/json": personTransitionInput,
      },
    },
  },
  responses: {
    200: {
      description: "Life event removed at the expected revision",
      content: {
        "application/json": personLifeEventDeleted,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const restorePerson = defineRoute({
  method: "post",
  path: "/api/v1/people/{personId}/restore",
  operationId: "restorePerson",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
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
      description: "Atomic current-workspace person lifecycle change",
      content: {
        "application/json": personLifecycleChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

/** What `listPersonTimeline` accepts in the query string. */
export const listPersonTimelineQuery = z.strictObject({
  cursor: z.string().max(2000).optional(),
  kind: z.enum(["activity", "call", "conversation", "life-event", "note"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const listPersonTimeline = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/timeline",
  operationId: "listPersonTimeline",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    query: listPersonTimelineQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Reverse-chronological tenant-scoped person timeline page",
      content: {
        "application/json": personTimelinePage,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const recordPersonView = defineRoute({
  method: "post",
  path: "/api/v1/people/{personId}/view",
  operationId: "recordPersonView",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
  },
  responses: {
    200: {
      description: "Member-scoped recent-person view recorded",
      content: {
        "application/json": personViewRecorded,
      },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

export const getTodayRecentPeople = defineRoute({
  method: "get",
  path: "/api/v1/today/recent-people",
  operationId: "getTodayRecentPeople",
  security: [{ kinship_session: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Bounded actual member-scoped recently viewed people",
      content: {
        "application/json": todayRecentPeople,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const bulkPeople = defineRoute({
  method: "post",
  path: "/api/v1/people/bulk",
  operationId: "bulkPeople",
  description:
    "Archives, restores, tags, or untags up to 100 people. Each person runs through the single-person use case in its own transaction and is answered per person, in request order; only a malformed request, lost access, or a tag outside the workspace refuses the whole request.",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": peopleBulkInput,
      },
    },
  },
  responses: {
    200: {
      description: "Each person's outcome; partial success is expected",
      content: {
        "application/json": peopleBulkResult,
      },
    },
    ...problemResponses(400, 401, 403, 503),
  },
});

/** Every people route, in the order the surface mounts them. */
export const PEOPLE_ROUTES: readonly RouteDescriptor[] = [
  listPeople,
  createPerson,
  listPeopleTagOptions,
  listPeopleTagFacet,
  listPeopleDuplicates,
  dismissPeopleDuplicate,
  bulkPeople,
  deletePerson,
  getPerson,
  getPersonIdentity,
  editPerson,
  archivePerson,
  replacePersonAvatar,
  removePersonAvatar,
  starPerson,
  unstarPerson,
  listImportantDates,
  createImportantDate,
  deleteImportantDate,
  updateImportantDate,
  getPersonDeletionImpact,
  listProfileFacts,
  createProfileFact,
  deleteProfileFact,
  updateProfileFact,
  listPersonLifeEvents,
  createPersonLifeEvent,
  updatePersonLifeEvent,
  deletePersonLifeEvent,
  restorePerson,
  previewPeopleMerge,
  mergePeople,
  listPersonTimeline,
  recordPersonView,
  getTodayRecentPeople,
];
