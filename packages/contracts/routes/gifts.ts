/**
 * Gifts and debts: every route of this surface, once.
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
  debtCreated,
  debtCreateInput,
  debtDeleted,
  debtSaved,
  debtStatusInput,
  giftCreated,
  giftCreateInput,
  giftDebtList,
  giftSaved,
  giftStatusInput,
  recurringDebtCreated,
  recurringDebtCreateInput,
  recurringDebtDeleted,
  recurringDebtSaved,
  recurringDebtUpdateInput,
} from "../schemas/gifts.ts";
import { pageCursor, pageLimit, uuid } from "../schemas/shared.ts";

export const createDebt = defineRoute({
  method: "post",
  path: "/api/v1/people/{personId}/debts",
  operationId: "createDebt",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": debtCreateInput,
      },
    },
  },
  responses: {
    201: {
      description: "Debt created",
      content: {
        "application/json": debtCreated,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const changeDebtStatus = defineRoute({
  method: "patch",
  path: "/api/v1/people/{personId}/debts/{debtId}/status",
  operationId: "changeDebtStatus",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
      debtId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": debtStatusInput,
      },
    },
  },
  responses: {
    200: {
      description: "Debt status changed",
      content: {
        "application/json": debtSaved,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const deleteDebt = defineRoute({
  method: "delete",
  path: "/api/v1/people/{personId}/debts/{debtId}",
  operationId: "deleteDebt",
  description:
    "Permanently removes one debt. For a recurring charge, its rule, next occurrence, and other charges stay. Ordinary pause/resume does not recreate the removed charge; later explicit schedule changes may charge deleted periods again.",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({ personId: uuid, debtId: uuid }),
    headers: originAndWorkspaceHeaders,
  },
  responses: {
    200: {
      description: "Debt permanently deleted",
      content: { "application/json": debtDeleted },
    },
    ...problemResponses(401, 403, 404, 409, 503),
  },
});

/**
 * What `listPersonGiftsAndDebts` accepts in the query string.
 *
 * One answer carries two collections, so it takes one continuation for each
 * and the single shared `limit` the convention publishes. Continuing gifts
 * leaves the debt cursor absent, and the answer still carries the first page
 * of debts, which is what keeps the two profile cards independent.
 */
export const listPersonGiftsAndDebtsQuery = z.strictObject({
  debtCursor: pageCursor.optional(),
  giftCursor: pageCursor.optional(),
  limit: pageLimit,
});

export const listPersonGiftsAndDebts = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/gifts",
  operationId: "listPersonGiftsAndDebts",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    query: listPersonGiftsAndDebtsQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Person gift and debt sections",
      content: {
        "application/json": giftDebtList,
      },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

export const createGift = defineRoute({
  method: "post",
  path: "/api/v1/people/{personId}/gifts",
  operationId: "createGift",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": giftCreateInput,
      },
    },
  },
  responses: {
    201: {
      description: "Gift created",
      content: {
        "application/json": giftCreated,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const changeGiftStatus = defineRoute({
  method: "patch",
  path: "/api/v1/people/{personId}/gifts/{giftId}/status",
  operationId: "changeGiftStatus",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
      giftId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": giftStatusInput,
      },
    },
  },
  responses: {
    200: {
      description: "Gift status changed",
      content: {
        "application/json": giftSaved,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const createRecurringDebt = defineRoute({
  method: "post",
  path: "/api/v1/people/{personId}/recurring-debts",
  operationId: "createRecurringDebt",
  description:
    "Creates a rule that charges the person the same debt every period. Every period already due in the workspace's calendar is charged at once, one open debt per period.",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": recurringDebtCreateInput,
      },
    },
  },
  responses: {
    201: {
      description: "Recurring debt created",
      content: {
        "application/json": recurringDebtCreated,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const updateRecurringDebt = defineRoute({
  method: "patch",
  path: "/api/v1/people/{personId}/recurring-debts/{recurringDebtId}",
  operationId: "updateRecurringDebt",
  description:
    "Changes, pauses, or resumes a recurring debt. A period already charged is never charged again; resuming skips the periods that passed while it was paused.",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
      recurringDebtId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
    body: {
      required: true,
      content: {
        "application/json": recurringDebtUpdateInput,
      },
    },
  },
  responses: {
    200: {
      description: "Recurring debt changed",
      content: {
        "application/json": recurringDebtSaved,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const deleteRecurringDebt = defineRoute({
  method: "delete",
  path: "/api/v1/people/{personId}/recurring-debts/{recurringDebtId}",
  operationId: "deleteRecurringDebt",
  description:
    "Deletes a recurring debt. The debts it already charged stay, each settled or cancelled on its own.",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
      recurringDebtId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
  },
  responses: {
    200: {
      description: "Recurring debt deleted",
      content: {
        "application/json": recurringDebtDeleted,
      },
    },
    ...problemResponses(401, 403, 404, 409, 503),
  },
});

/** Every gifts route, in the order the surface mounts them. */
export const GIFTS_ROUTES: readonly RouteDescriptor[] = [
  createDebt,
  changeDebtStatus,
  deleteDebt,
  listPersonGiftsAndDebts,
  createGift,
  changeGiftStatus,
  createRecurringDebt,
  updateRecurringDebt,
  deleteRecurringDebt,
];
