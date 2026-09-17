/**
 * Member and workspace settings: every route of this surface, once.
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
  managedMemberResult,
  managedMembers,
  memberUiStateInput,
  memberUiStateReady,
  memberUpdateInput,
  personalizationCreate,
  personalizationDeleted,
  personalizationList,
  personalizationSaved,
  personalizationSection,
  personalizationUpdate,
  preferenceSettings,
  preferencesInput,
  profileInput,
  profileSettings,
  sessionRevoked,
  sessionSettings,
  workspaceSettings,
  workspaceSettingsInput,
} from "../schemas/settings.ts";
import { uuid } from "../schemas/shared.ts";

export const getMemberUiState = defineRoute({
  method: "get",
  path: "/api/v1/member/ui-state",
  operationId: "getMemberUiState",
  security: [{ kinship_session: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Current member settings",
      content: {
        "application/json": memberUiStateReady,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const saveMemberUiState = defineRoute({
  method: "patch",
  path: "/api/v1/member/ui-state",
  operationId: "saveMemberUiState",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": memberUiStateInput,
      },
    },
  },
  responses: {
    200: {
      description: "Settings saved",
      content: {
        "application/json": memberUiStateReady,
      },
    },
    ...problemResponses(400, 401, 403, 409, 503),
  },
});

export const listManagedMembers = defineRoute({
  method: "get",
  path: "/api/v1/settings/members",
  operationId: "listManagedMembers",
  security: [{ kinship_session: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Current member settings",
      content: {
        "application/json": managedMembers,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const updateManagedMember = defineRoute({
  method: "patch",
  path: "/api/v1/settings/members/{memberId}",
  operationId: "updateManagedMember",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      memberId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": memberUpdateInput,
      },
    },
  },
  responses: {
    200: {
      description: "Settings saved",
      content: {
        "application/json": managedMemberResult,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const listPersonalizationEntries = defineRoute({
  method: "get",
  path: "/api/v1/settings/personalization/{section}",
  operationId: "listPersonalizationEntries",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      section: personalizationSection,
    }),
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Active-workspace personalization section",
      content: {
        "application/json": personalizationList,
      },
    },
    ...problemResponses(401, 403, 404, 503),
  },
});

export const createPersonalizationEntry = defineRoute({
  method: "post",
  path: "/api/v1/settings/personalization/{section}",
  operationId: "createPersonalizationEntry",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      section: personalizationSection,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": personalizationCreate,
      },
    },
  },
  responses: {
    200: {
      description: "Personalization entry created",
      content: {
        "application/json": personalizationSaved,
      },
    },
    ...problemResponses(400, 401, 403, 409, 503),
  },
});

/**
 * What `deletePersonalizationEntry` accepts in the query string.
 *
 * Strict, as the route has always read it: a deletion carries the version it
 * was decided against and, where the section needs one, the option its
 * references move to. Nothing else is a parameter of deleting an option.
 */
export const deletePersonalizationEntryQuery = z.strictObject({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  replacementId: z.uuid().optional(),
});

export const deletePersonalizationEntry = defineRoute({
  method: "delete",
  path: "/api/v1/settings/personalization/{section}/{id}",
  operationId: "deletePersonalizationEntry",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      section: personalizationSection,
      id: uuid,
    }),
    query: deletePersonalizationEntryQuery,
    headers: originAndWorkspaceHeaders,
  },
  responses: {
    200: {
      description: "Personalization entry deleted",
      content: {
        "application/json": personalizationDeleted,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const updatePersonalizationEntry = defineRoute({
  method: "patch",
  path: "/api/v1/settings/personalization/{section}/{id}",
  operationId: "updatePersonalizationEntry",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      section: personalizationSection,
      id: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": personalizationUpdate,
      },
    },
  },
  responses: {
    200: {
      description: "Personalization entry updated",
      content: {
        "application/json": personalizationSaved,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const getMemberPreferences = defineRoute({
  method: "get",
  path: "/api/v1/settings/preferences",
  operationId: "getMemberPreferences",
  security: [{ kinship_session: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Current member settings",
      content: {
        "application/json": preferenceSettings,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const updateMemberPreferences = defineRoute({
  method: "put",
  path: "/api/v1/settings/preferences",
  operationId: "updateMemberPreferences",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": preferencesInput,
      },
    },
  },
  responses: {
    200: {
      description: "Settings saved",
      content: {
        "application/json": preferenceSettings,
      },
    },
    ...problemResponses(400, 401, 403, 409, 503),
  },
});

export const getSettingsProfile = defineRoute({
  method: "get",
  path: "/api/v1/settings/profile",
  operationId: "getSettingsProfile",
  security: [{ kinship_session: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Current member settings",
      content: {
        "application/json": profileSettings,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const updateSettingsProfile = defineRoute({
  method: "put",
  path: "/api/v1/settings/profile",
  operationId: "updateSettingsProfile",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": profileInput,
      },
    },
  },
  responses: {
    200: {
      description: "Settings saved",
      content: {
        "application/json": profileSettings,
      },
    },
    ...problemResponses(400, 401, 403, 409, 503),
  },
});

export const listMemberSessions = defineRoute({
  method: "get",
  path: "/api/v1/settings/sessions",
  operationId: "listMemberSessions",
  security: [{ kinship_session: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Current member settings",
      content: {
        "application/json": sessionSettings,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const revokeMemberSession = defineRoute({
  method: "delete",
  path: "/api/v1/settings/sessions/{sessionId}",
  operationId: "revokeMemberSession",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      sessionId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
  },
  responses: {
    200: {
      description: "Owned session revoked",
      content: {
        "application/json": sessionRevoked,
      },
    },
    ...problemResponses(401, 403, 404, 503),
  },
});

export const getWorkspaceSettings = defineRoute({
  method: "get",
  path: "/api/v1/settings/workspace",
  operationId: "getWorkspaceSettings",
  security: [{ kinship_session: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Current member settings",
      content: {
        "application/json": workspaceSettings,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const updateWorkspaceSettings = defineRoute({
  method: "put",
  path: "/api/v1/settings/workspace",
  operationId: "updateWorkspaceSettings",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": workspaceSettingsInput,
      },
    },
  },
  responses: {
    200: {
      description: "Settings saved",
      content: {
        "application/json": workspaceSettings,
      },
    },
    ...problemResponses(400, 401, 403, 409, 503),
  },
});

/** Every settings route, in the order the surface mounts them. */
export const SETTINGS_ROUTES: readonly RouteDescriptor[] = [
  getMemberUiState,
  saveMemberUiState,
  listManagedMembers,
  updateManagedMember,
  listPersonalizationEntries,
  createPersonalizationEntry,
  deletePersonalizationEntry,
  updatePersonalizationEntry,
  getMemberPreferences,
  updateMemberPreferences,
  getSettingsProfile,
  updateSettingsProfile,
  listMemberSessions,
  revokeMemberSession,
  getWorkspaceSettings,
  updateWorkspaceSettings,
];
