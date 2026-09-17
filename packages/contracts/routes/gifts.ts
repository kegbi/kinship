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
  debtSaved,
  debtStatusInput,
  giftCreated,
  giftCreateInput,
  giftDebtList,
  giftSaved,
  giftStatusInput,
} from "../schemas/gifts.ts";
import { uuid } from "../schemas/shared.ts";

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

export const listPersonGiftsAndDebts = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/gifts",
  operationId: "listPersonGiftsAndDebts",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Person gift and debt sections",
      content: {
        "application/json": giftDebtList,
      },
    },
    ...problemResponses(401, 403, 404, 503),
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

/** Every gifts route, in the order the surface mounts them. */
export const GIFTS_ROUTES: readonly RouteDescriptor[] = [
  createDebt,
  changeDebtStatus,
  listPersonGiftsAndDebts,
  createGift,
  changeGiftStatus,
];
