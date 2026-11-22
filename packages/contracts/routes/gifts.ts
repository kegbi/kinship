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
  problemResponses,
  tokenOrSessionWriteHeaders,
  workspaceHeaders,
} from "./common.ts";
import {
  debtCreated,
  debtCreateInput,
  debtDeleted,
  debtSaved,
  debtSettlementList,
  debtStatusInput,
  debtUpdateInput,
  giftCreated,
  giftCreateInput,
  giftDebtList,
  giftDeleted,
  giftDeleteInput,
  giftSaved,
  giftStatusInput,
  giftUpdateInput,
  recurringDebtCreated,
  recurringDebtCreateInput,
  recurringDebtDeleted,
  recurringDebtSaved,
  recurringDebtUpdateInput,
} from "../schemas/gifts.ts";
import { pageCursor, pageLimit, uuid } from "../schemas/shared.ts";

export const listDebtSettlementsQuery = z.strictObject({
  cursor: pageCursor.optional(),
  limit: pageLimit,
});
export const listDebtSettlements = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/debts/{debtId}/settlements",
  operationId: "listDebtSettlements",
  description:
    "Requires a browser session or a personal token with gifts:read, which covers both gifts and debts — financial information. Returns one debt's permanent settlement history, newest first: when it was settled, the optional reason, and the optional settlement photo's file id and filename, with whether that photo is still available. Page with the opaque cursor. Grants no write access.",
  tokenScope: "gifts:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({ personId: uuid, debtId: uuid }),
    query: listDebtSettlementsQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Permanent settlement history, newest first",
      content: { "application/json": debtSettlementList },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

export const createDebt = defineRoute({
  method: "post",
  path: "/api/v1/people/{personId}/debts",
  operationId: "createDebt",
  description:
    "Requires a browser session or a personal token with gifts:write. Records a debt the person owes or is owed: `amount` is a decimal string and `currencyCode` a three-letter code the workspace supports. A debt created settled may carry a settlement reason and the file id of a settlement photo, which must be an available JPEG, PNG, or WebP photo of this same person in this workspace; a token needs no files scope to reference it. An optional `requestId` (a UUID the client generates once per intended record) makes a retry safe: repeating the request with the same `requestId` and the same payload returns the record the first attempt wrote, answering 201 again without writing anything; the same `requestId` with a different payload, or for a different person, answers 409 `gift_request_conflict`; and once that record was deleted, the same `requestId` answers 409 `gift_request_deleted` rather than recording it again. The key is the workspace's, shared by every member and token. Without `requestId`, repeating the request records a second debt. An archived person's gifts and debts can be read but refuse this write.",
  tokenScope: "gifts:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
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
  description:
    "Requires a browser session or a personal token with gifts:write. Moves a debt between `open`, `settled`, and `cancelled`: an open debt may be settled or cancelled, a settled debt may reopen, and `cancelled` is terminal. Settling appends to the debt's permanent settlement history and may carry a reason and the file id of a settlement photo, which must be an available JPEG, PNG, or WebP photo of this same person in this workspace; a token needs no files scope to reference it. Asking for the status the debt already has answers `unchanged`. An optional `expectedUpdatedAt`, the debt's `updatedAt` from listPersonGiftsAndDebts or the last write, makes the change conditional: when the debt has changed since, it answers 409 `gift_stale` and changes nothing, so no settlement is recorded; without it the change applies to whatever the debt is now. An archived person's gifts and debts can be read but refuse this write.",
  tokenScope: "gifts:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
      debtId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
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
    "Requires a browser session or a personal token with gifts:write. Permanently removes one debt and its whole settlement history; nothing can restore it. For a recurring charge, its rule, next occurrence, and other charges stay. Ordinary pause/resume does not recreate the removed charge; later explicit schedule changes may charge deleted periods again. An archived person's gifts and debts can be read but refuse this write.",
  tokenScope: "gifts:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({ personId: uuid, debtId: uuid }),
    headers: tokenOrSessionWriteHeaders,
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
  description:
    "Requires a browser session or a personal token with gifts:read, which covers both gifts and debts — financial information. Returns one person's gifts, debts, and recurring debts: amounts are decimal strings with a three-letter currency code, and the answer names the default and supported currencies. Gifts and debts page independently with their own opaque cursors. An archived person's records stay readable. Grants no write access.",
  tokenScope: "gifts:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
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
  description:
    "Requires a browser session or a personal token with gifts:write. Records a gift idea, plan, or exchange: an optional `amount` is a decimal string with a three-letter `currencyCode` the workspace supports. A recipient person id must name a live person of this workspace. An attachment file id must name an available file of this workspace that is not a person's avatar; a token needs no files scope to reference it. An optional `requestId` (a UUID the client generates once per intended record) makes a retry safe: repeating the request with the same `requestId` and the same payload returns the record the first attempt wrote, answering 201 again without writing anything; the same `requestId` with a different payload, or for a different person, answers 409 `gift_request_conflict`; and once that record was deleted, the same `requestId` answers 409 `gift_request_deleted` rather than recording it again. The key is the workspace's, shared by every member and token. Without `requestId`, repeating the request records a second gift. An archived person's gifts and debts can be read but refuse this write.",
  tokenScope: "gifts:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
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
  description:
    "Requires a browser session or a personal token with gifts:write. Moves a gift along its transition graph: an idea may become planned, given, or received; a planned gift may be given or received; any gift may be archived; and `archived` is terminal. A move the graph does not allow answers 409, and asking for the status the gift already has answers `unchanged`. An optional `expectedUpdatedAt`, the gift's `updatedAt` from listPersonGiftsAndDebts or the last write, makes the change conditional: when the gift has changed since, it answers 409 `gift_stale` and changes nothing; without it the change applies to whatever the gift is now. Edit the gift's other values with updateGift. An archived person's gifts and debts can be read but refuse this write.",
  tokenScope: "gifts:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
      giftId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
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
    "Requires a browser session or a personal token with gifts:write. Creates a rule that charges the person the same debt every period. Every period already due in the workspace's calendar is charged at once, one open debt per period. `amount` is a decimal string and `currencyCode` a three-letter code the workspace supports. An optional `requestId` (a UUID the client generates once per intended rule) makes a retry safe: the same `requestId` and payload returns the rule the first attempt created, answering 201 with `charged: 0` because the periods that attempt charged are never charged again; a different payload or person answers 409 `gift_request_conflict`; and once the rule was deleted it answers 409 `gift_request_deleted` and charges nothing. Without `requestId`, repeating the request creates a second rule and charges its due periods again. An archived person's gifts and debts can be read but refuse this write.",
  tokenScope: "gifts:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
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
    "Requires a browser session or a personal token with gifts:write. Changes, pauses, or resumes a recurring debt. A period already charged is never charged again; resuming skips the periods that passed while it was paused. A change that leaves due periods uncharged charges them at once. An optional `expectedUpdatedAt`, the rule's `updatedAt` from listPersonGiftsAndDebts or the last write, makes the change conditional: when the rule has changed since, it answers 409 `gift_stale`, changes nothing, and charges nothing; it does not count as the one changed field the body must name. An archived person's gifts and debts can be read but refuse this write.",
  tokenScope: "gifts:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
      recurringDebtId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
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
    "Requires a browser session or a personal token with gifts:write. Deletes a recurring debt. The debts it already charged stay, each settled or cancelled on its own. An archived person's gifts and debts can be read but refuse this write.",
  tokenScope: "gifts:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
      recurringDebtId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
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

export const updateGift = defineRoute({
  method: "patch",
  path: "/api/v1/people/{personId}/gifts/{giftId}",
  operationId: "updateGift",
  description:
    "Requires a browser session or a personal token with gifts:write. Edits a gift's values: `name`, `amount` with `currencyCode`, `eventAt`, `comment`, `url`, `recipientPersonId`, and `attachmentFileId` — what createGift accepts except `status`, which changeGiftStatus moves. A field left out keeps its value and `null` clears an optional one; `name` cannot be cleared, and at least one field must be named. `amount` and `currencyCode` are sent together or not at all, and an amount needs a currency the workspace supports. `expectedUpdatedAt` is required: the gift's `updatedAt` from listPersonGiftsAndDebts or the last write; when the gift has changed since, it answers 409 `gift_stale` and changes nothing. A recipient must be a live person of this workspace. An attachment must be an available file of this workspace that is not a person's avatar; it replaces the gift's attachment, `null` removes it, and either way the previous file stays in the person's files. A request that changes nothing answers `unchanged`. A gift under another person's path answers 404. Gifts are workspace-wide: any member may edit any gift. An archived person's gifts and debts can be read but refuse this write.",
  tokenScope: "gifts:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({ personId: uuid, giftId: uuid }),
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: { "application/json": giftUpdateInput },
    },
  },
  responses: {
    200: {
      description: "Gift saved, or unchanged",
      content: { "application/json": giftSaved },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const deleteGift = defineRoute({
  method: "delete",
  path: "/api/v1/people/{personId}/gifts/{giftId}",
  operationId: "deleteGift",
  description:
    "Requires a browser session or a personal token with gifts:write. Permanently removes one gift; nothing can restore it, and a createGift retried later with the `requestId` that created it answers 409 `gift_request_deleted` instead of recording it again. The body carries the required `expectedUpdatedAt`, the gift's `updatedAt` from listPersonGiftsAndDebts or the last write; when the gift has changed since, it answers 409 `gift_stale` and deletes nothing. An attached file is not deleted: only its link to the gift goes, and the file stays in the person's files. To keep a gift out of the way without losing it, archive it with changeGiftStatus instead. A gift under another person's path answers 404. An archived person's gifts and debts can be read but refuse this write.",
  tokenScope: "gifts:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({ personId: uuid, giftId: uuid }),
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: { "application/json": giftDeleteInput },
    },
  },
  responses: {
    200: {
      description: "Gift permanently deleted",
      content: { "application/json": giftDeleted },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const updateDebt = defineRoute({
  method: "patch",
  path: "/api/v1/people/{personId}/debts/{debtId}",
  operationId: "updateDebt",
  description:
    "Requires a browser session or a personal token with gifts:write. Edits a debt's `amount`, `currencyCode`, `direction`, or `reason`; status moves with changeDebtStatus. A field left out keeps its value, `reason: null` clears the reason, and at least one field must be named. `expectedUpdatedAt` is required: the debt's `updatedAt` from listPersonGiftsAndDebts or the last write; when the debt has changed since, it answers 409 `gift_stale` and changes nothing. The amount, currency, and direction can change only while the debt is open and has never been settled, because its settlement history records what was paid; once it has been settled, even if reopened since, they answer 409 `debt_values_locked`, and its reason stays editable. A cancelled debt is finished and refuses every edit with 409 `debt_values_locked`. A debt a recurring rule charged is an ordinary debt once charged: editing it changes neither the rule nor its other charges, and the rule never charges that period again. A request that changes nothing answers `unchanged`. A debt under another person's path answers 404. An archived person's gifts and debts can be read but refuse this write.",
  tokenScope: "gifts:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({ personId: uuid, debtId: uuid }),
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: { "application/json": debtUpdateInput },
    },
  },
  responses: {
    200: {
      description: "Debt saved, or unchanged",
      content: { "application/json": debtSaved },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

/** Every gifts route, in the order the surface mounts them. */
export const GIFTS_ROUTES: readonly RouteDescriptor[] = [
  listDebtSettlements,
  createDebt,
  changeDebtStatus,
  deleteDebt,
  listPersonGiftsAndDebts,
  createGift,
  changeGiftStatus,
  createRecurringDebt,
  updateRecurringDebt,
  deleteRecurringDebt,
  updateGift,
  deleteGift,
  updateDebt,
];
