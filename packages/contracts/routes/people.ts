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
  workspaceHeaders,
} from "./common.ts";
import {
  importantDateChanged,
  importantDateDeleted,
  importantDateInput,
  importantDateList,
  importantDateUpdateInput,
  peopleDirectoryPage,
  peopleTagOptionsPage,
  personCreated,
  personDeleted,
  personDeleteInput,
  personDeletionImpact,
  personEditInput,
  personInput,
  personLifecycleChanged,
  personLifeEventsReady,
  personReady,
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
  sort: z.enum(["given-name", "family-name", "recently-added"]).default(
    "given-name",
  ),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const listPeople = defineRoute({
  method: "get",
  path: "/api/v1/people",
  operationId: "listPeople",
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
  include: z.enum(["summary"]).optional().meta({
    description:
      "Adds the bounded person summary without changing the default response.",
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
        "Current-workspace person identity, lifecycle, due-information shell, and optional bounded summary",
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

export const listImportantDates = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/dates",
  operationId: "listImportantDates",
  security: [{ kinship_session: [] }],
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
  security: [{ kinship_session: [] }],
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

/** Every people route, in the order the surface mounts them. */
export const PEOPLE_ROUTES: readonly RouteDescriptor[] = [
  listPeople,
  createPerson,
  listPeopleTagOptions,
  deletePerson,
  getPerson,
  editPerson,
  archivePerson,
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
  restorePerson,
  listPersonTimeline,
  recordPersonView,
  getTodayRecentPeople,
];
