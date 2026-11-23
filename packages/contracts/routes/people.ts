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
  description:
    "Creates a person in the workspace and answers their id and updatedAt, the revision editPerson, archivePerson, restorePerson, and deletePerson accept as expectedUpdatedAt. Personal tokens require the people:write grant. Send a client-generated requestId and reuse it when retrying: the same requestId and names return the person it created at their current revision (201), and the same requestId with different names, or after that person was deleted, is refused (409). duplicateOverride is not compared, so a create warned as a possible duplicate may be retried with duplicateOverride and the same requestId. Without a requestId every call creates a new person. A name that already exists in the workspace answers a possible duplicate (409) unless the request sets duplicateOverride.",
  tokenScope: "people:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: {
        "application/json": personInput,
      },
    },
  },
  responses: {
    201: {
      description:
        "Workspace-owned person created, or the person an earlier call with the same requestId created",
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
    "Minimal person name, identifier, and revision (updatedAt, the expectedUpdatedAt editPerson, archivePerson, restorePerson, and deletePerson accept), including archived people. Personal tokens require people:profile:read. Returns no profile aggregate, notes, timeline, tasks, or file data.",
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
  description:
    "Bounded tag options for the directory's tag filter. Personal tokens require the people:read grant.",
  tokenScope: "people:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
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
    "The workspace's tags with how many people of the active or archived view carry each, most carried first, at most thirty; `truncated` says more tags are in use. Personal tokens require the people:read grant.",
  tokenScope: "people:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
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
  description:
    "Deletes a person. The body repeats the exact confirmation phrase of the deletion impact and the person's expectedUpdatedAt; either missing or no longer current is refused. Personal tokens require the people:delete grant, which no other grant implies.",
  tokenScope: "people:delete",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
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
  description:
    "Edits a person's identity against the expectedUpdatedAt it was decided from. Personal tokens require the people:write grant. A stale revision is refused (409) and an archived person is read-only.",
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
  description:
    "Archives a person against the expectedUpdatedAt it was decided from. Personal tokens require the people:write grant.",
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
  description:
    "Bounded pairs of active people who look like the same person. Personal tokens require the people:merge grant.",
  tokenScope: "people:merge",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
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
    "Marks two people from the duplicate review as not duplicates for the whole workspace. Dismissing a dismissed pair changes nothing. Personal tokens require the people:merge grant.",
  tokenScope: "people:merge",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    headers: tokenOrSessionWriteHeaders,
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
  description:
    "What merging the duplicate into the primary would keep, discard, and move, with both people's revisions and the conflictsDigest the merge must quote. Personal tokens require the people:merge grant.",
  tokenScope: "people:merge",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
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
  description:
    "Merges the duplicate into the primary; a merge cannot be undone. The body quotes the preview's conflictsDigest, both people's revisions, and confirmed: true; any of them no longer current is refused. Personal tokens require the people:merge grant, which no other grant implies.",
  tokenScope: "people:merge",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      primaryId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
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
  headers: tokenOrSessionWriteHeaders,
};

export const starPerson = defineRoute({
  method: "put",
  path: "/api/v1/people/{personId}/star",
  operationId: "starPerson",
  description:
    "Stars the person for the whole workspace. Starring a starred person changes nothing, and an archived person's star is read-only. Personal tokens require the people:write grant.",
  tokenScope: "people:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
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
    "Removes the person's workspace star. An unstarred person is unchanged, and an archived person's star is read-only. Personal tokens require the people:write grant.",
  tokenScope: "people:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
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
  description:
    "Personal tokens require people:write. Adds an important date carrying exactly the components its precision declares; a person has at most one birthday, deceased, and first-met date. Archived people are read-only. Does not grant reads. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
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
  description:
    "Personal tokens require people:write. Removes an important date at expectedUpdatedAt, the date's updatedAt from listImportantDates. Archived people are read-only. Does not grant reads. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "people:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
      dateId: uuid,
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
  description:
    "Personal tokens require people:write. Replaces an important date at expectedUpdatedAt, the date's updatedAt from listImportantDates. Archived people are read-only. Does not grant reads. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "people:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
      dateId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
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
  description:
    "What deleting the person removes, and the exact confirmation phrase the deletion must repeat. Personal tokens require the people:delete grant.",
  tokenScope: "people:delete",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
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
  description:
    "Personal tokens require people:write. Adds a fact to one profile section. first-meeting, food-preferences, and tags hold at most one fact, whose id is the person's id; creating one that exists answers stale, and tags always exists, so it is changed with updateProfileFact. expectedPersonUpdatedAt is the personUpdatedAt that listProfileFacts or the last fact write returned. Hidden sections, archived people, and options that are inactive or outside the workspace are refused. Does not grant reads. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "people:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
      section: profileFactSectionId,
    }),
    headers: tokenOrSessionWriteHeaders,
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
  description:
    "Personal tokens require people:write. Removes one fact, or clears first-meeting or food-preferences, at expectedUpdatedAt, the record's updatedAt; tags are cleared with updateProfileFact and an empty tagIds. expectedPersonUpdatedAt is the personUpdatedAt that listProfileFacts or the last fact write returned. Hidden sections and archived people are refused. Does not grant reads. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "people:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
      section: profileFactSectionId,
      factId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
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
  description:
    "Personal tokens require people:write. Replaces one fact at expectedUpdatedAt, the record's updatedAt; the body's id must be the path's factId. expectedPersonUpdatedAt is the personUpdatedAt that listProfileFacts or the last fact write returned. Hidden sections, archived people, and options that are inactive or outside the workspace are refused. Does not grant reads. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "people:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
      section: profileFactSectionId,
      factId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
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
  description:
    "Personal tokens require people:profile:read. Reads at most 100 precision-aware life events of a person in the active workspace, archived people included, with the workspace's life-event types. A hidden section returns no saved events.",
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
  description:
    "Restores an archived person against the expectedUpdatedAt it was decided from. Personal tokens require the people:write grant.",
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
  description:
    "The people the member recently viewed, newest first. Personal tokens require the today:read grant and answer the token's own member's views.",
  tokenScope: "today:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
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
    "Archives, restores, tags, or untags up to 100 people. Each person runs through the single-person use case in its own transaction and is answered per person, in request order; only a malformed request, lost access, or a tag outside the workspace refuses the whole request. Personal tokens require the people:write grant.",
  tokenScope: "people:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    headers: tokenOrSessionWriteHeaders,
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
