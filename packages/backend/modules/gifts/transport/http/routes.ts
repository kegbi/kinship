/**
 * Gifts and debts over HTTP.
 *
 * What is left in this file is the part that is about gifts: the routes,
 * the shapes they accept, and the prose each refusal carries. The problem
 * responder, the session cookie, the origin check, and the kernel status map
 * came from `packages/http-kit`, where every route file's copy of them was collapsed into
 * one (GAP-019).
 */

import { Hono } from "hono";
import type { GiftManagement } from "../../public.ts";
import type { createProtectedSessionCoordinator } from "../../../workspaces/public.ts";
import {
  changeDebtStatus,
  changeGiftStatus,
  createDebt,
  createGift,
  createRecurringDebt,
  deleteDebt,
  deleteGift,
  deleteRecurringDebt,
  listDebtSettlements,
  listDebtSettlementsQuery,
  listPersonGiftsAndDebts,
  listPersonGiftsAndDebtsQuery,
  updateDebt,
  updateGift,
  updateRecurringDebt,
} from "../../../../../contracts/routes/gifts.ts";
import {
  debtCreateInput,
  debtStatusInput,
  debtUpdateInput,
  giftCreateInput,
  giftDeleteInput,
  giftStatusInput,
  giftUpdateInput,
  recurringDebtCreateInput,
  recurringDebtUpdateInput,
} from "../../../../../contracts/schemas/gifts.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import type { BrowserSecurityPolicy } from "../../../../../http-kit/security_policy.ts";
import type { PersonalTokenAuthority } from "../../../../../http-kit/scoped_actor.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import { mount } from "../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  sessionActor,
} from "../../../../../http-kit/session.ts";
import {
  parseJsonBody,
  parseQuery,
  parseValue,
} from "../../../../../http-kit/validate.ts";
import { routeAdmission } from "../../../../../http-kit/route_admission.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface GiftHttpServices {
  /**
   * The personal-token authority (MCP-A1). Every route here admits a token
   * through `routeAdmission` (MCP-B7): `gifts:read` for the two reads,
   * `gifts:write` for every write, including the edits and the gift
   * deletion MCP-D3 added.
   */
  readonly apiTokens?: PersonalTokenAuthority;
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly gifts: GiftManagement;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
}

/**
 * What a refused gift or debt says.
 *
 * `not-found` covers the person, the recipient, the attachment, the gift, the
 * debt, and the recurring debt in one answer on purpose: a workspace learns
 * nothing about which of them exists.
 */
export const GIFT_FAILURES: FailureTable = {
  fallback: {
    code: "gifts_unavailable",
    detail: "Gifts and debts are temporarily unavailable.",
    status: 503,
    title: "Gifts unavailable",
  },
  statuses: {
    "archived-write-rejected": {
      code: "archived_write_rejected",
      detail: "Restore the person before changing gifts or debts.",
      title: "Archived person is read-only",
    },
    forbidden: {
      code: "gifts_forbidden",
      detail: "Your active workspace membership no longer permits this action.",
      title: "Gifts unavailable",
    },
    "invalid-transition": {
      code: "gift_transition_invalid",
      detail: "Refresh the record and choose a valid next status.",
      status: 409,
      title: "Status cannot be changed",
    },
    "limit-reached": {
      code: "recurring_debt_limit_reached",
      detail:
        "This person already has 50 recurring debts. Delete one before adding another.",
      status: 409,
      title: "Too many recurring debts",
    },
    "not-found": {
      code: "gift_not_found",
      detail:
        "The person, recipient, attachment, gift, debt, or recurring debt does not exist in the active workspace.",
      title: "Record unavailable",
    },
    "query-invalid": {
      code: "gift_query_invalid",
      detail: "Reload the first page of gifts and debts before continuing.",
      status: 400,
      title: "Invalid gift query",
    },
    "validation-error": {
      code: "gift_invalid",
      detail:
        "Review the amount, currency, recipient, attachment, and other fields.",
      title: "Invalid gift or debt",
    },
    "debt-values-locked": {
      code: "debt_values_locked",
      detail:
        "A debt's amount, currency, and direction change only while it is open and was never settled, and a cancelled debt changes no value.",
      status: 409,
      title: "Debt values cannot be changed",
    },
    "idempotency-conflict": {
      code: "gift_request_conflict",
      detail:
        "This request identifier already recorded something else. Use a new request identifier for a different record.",
      status: 409,
      title: "Request identifier already used",
    },
    "request-deleted": {
      code: "gift_request_deleted",
      detail:
        "The record this request identifier created was deleted. Use a new request identifier to record it again.",
      status: 409,
      title: "Request identifier already used",
    },
    stale: {
      code: "gift_stale",
      detail:
        "The record changed since it was read. Reload it and apply the change to its current updatedAt.",
      status: 409,
      title: "Record changed",
    },
  },
};

const failure = failureResponder(GIFT_FAILURES);

/** The revision a body names, as the use cases take it. */
function revisionOf(
  body: { readonly expectedUpdatedAt?: string | undefined },
): { readonly expectedUpdatedAt?: string } {
  return body.expectedUpdatedAt
    ? { expectedUpdatedAt: body.expectedUpdatedAt }
    : {};
}

export function createGiftRoutes(services: GiftHttpServices): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services);
  const tokens = {
    browserSecurity: services.browserSecurity,
    tokens: services.apiTokens,
  };
  const settlements = routeAdmission(listDebtSettlements, tokens);
  const list = routeAdmission(listPersonGiftsAndDebts, tokens);
  const giftCreate = routeAdmission(createGift, tokens);
  const giftStatus = routeAdmission(changeGiftStatus, tokens);
  const debtCreate = routeAdmission(createDebt, tokens);
  const debtStatus = routeAdmission(changeDebtStatus, tokens);
  const debtDelete = routeAdmission(deleteDebt, tokens);
  const recurringCreate = routeAdmission(createRecurringDebt, tokens);
  const recurringUpdate = routeAdmission(updateRecurringDebt, tokens);
  const recurringDelete = routeAdmission(deleteRecurringDebt, tokens);
  const giftUpdate = routeAdmission(updateGift, tokens);
  const giftDelete = routeAdmission(deleteGift, tokens);
  const debtUpdate = routeAdmission(updateDebt, tokens);

  mount(
    routes,
    listDebtSettlements,
    settlements.gate,
    session,
    async (context) => {
      const person = parseValue(uuid, context.req.param("personId"));
      const debt = parseValue(uuid, context.req.param("debtId"));
      if ("errors" in person || "errors" in debt) {
        return failure(context, "not-found");
      }
      const query = parseQuery(context, listDebtSettlementsQuery);
      if ("errors" in query) return failure(context, "query-invalid");
      const actor = await settlements.actor(context);
      if (actor instanceof Response) return actor;
      const result = await services.gifts.listDebtSettlements(
        actor,
        person.data,
        debt.data,
        {
          ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
          limit: query.data.limit,
        },
      );
      if (result.status === "validation-error") {
        return failure(context, "query-invalid");
      }
      if (result.status !== "ready") return failure(context, result.status);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  mount(
    routes,
    listPersonGiftsAndDebts,
    list.gate,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      if ("errors" in personId) return failure(context, "not-found");
      const query = parseQuery(context, listPersonGiftsAndDebtsQuery);
      if ("errors" in query) return failure(context, "query-invalid");
      const actor = await list.actor(context);
      if (actor instanceof Response) return actor;
      const result = await services.gifts.list(actor, personId.data, {
        ...(query.data.debtCursor ? { debtCursor: query.data.debtCursor } : {}),
        ...(query.data.giftCursor ? { giftCursor: query.data.giftCursor } : {}),
        limit: query.data.limit,
      });
      if (result.status === "validation-error") {
        return failure(context, "query-invalid");
      }
      if (result.status !== "ready") return failure(context, result.status);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  mount(
    routes,
    createGift,
    giftCreate.gate,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const body = await parseJsonBody(context, giftCreateInput);
      if ("errors" in personId || "errors" in body) {
        return failure(context, "validation-error");
      }
      const actor = await giftCreate.actor(context);
      if (actor instanceof Response) return actor;
      const result = await services.gifts.createGift(
        actor,
        personId.data,
        {
          ...(body.data.amount ? { amount: body.data.amount } : {}),
          ...(body.data.attachmentFileId
            ? { attachmentFileId: body.data.attachmentFileId }
            : {}),
          ...(body.data.comment ? { comment: body.data.comment } : {}),
          ...(body.data.currencyCode
            ? { currencyCode: body.data.currencyCode }
            : {}),
          ...(body.data.eventAt ? { eventAt: body.data.eventAt } : {}),
          name: body.data.name,
          ...(body.data.recipientPersonId
            ? { recipientPersonId: body.data.recipientPersonId }
            : {}),
          ...(body.data.requestId ? { requestId: body.data.requestId } : {}),
          status: body.data.status,
          ...(body.data.url ? { url: body.data.url } : {}),
        },
      );
      if (result.status !== "created") return failure(context, result.status);
      context.header("Cache-Control", "private, no-store");
      return context.json(result, 201);
    },
  );

  mount(
    routes,
    changeGiftStatus,
    giftStatus.gate,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const giftId = parseValue(uuid, context.req.param("giftId"));
      const body = await parseJsonBody(context, giftStatusInput);
      if ("errors" in personId || "errors" in giftId || "errors" in body) {
        return failure(context, "validation-error");
      }
      const actor = await giftStatus.actor(context);
      if (actor instanceof Response) return actor;
      const result = await services.gifts.changeGiftStatus(
        actor,
        personId.data,
        giftId.data,
        body.data.status,
        revisionOf(body.data),
      );
      if (
        result.status !== "saved" && result.status !== "unchanged"
      ) return failure(context, result.status);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  mount(
    routes,
    createDebt,
    debtCreate.gate,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const body = await parseJsonBody(context, debtCreateInput);
      if ("errors" in personId || "errors" in body) {
        return failure(context, "validation-error");
      }
      const actor = await debtCreate.actor(context);
      if (actor instanceof Response) return actor;
      const result = await services.gifts.createDebt(
        actor,
        personId.data,
        {
          amount: body.data.amount,
          currencyCode: body.data.currencyCode,
          direction: body.data.direction,
          ...(body.data.settlementReason
            ? { settlementReason: body.data.settlementReason }
            : {}),
          ...(body.data.settlementPhotoFileId
            ? { settlementPhotoFileId: body.data.settlementPhotoFileId }
            : {}),
          ...(body.data.reason ? { reason: body.data.reason } : {}),
          ...(body.data.requestId ? { requestId: body.data.requestId } : {}),
          status: body.data.status,
        },
      );
      if (result.status !== "created") return failure(context, result.status);
      context.header("Cache-Control", "private, no-store");
      return context.json(result, 201);
    },
  );

  mount(
    routes,
    changeDebtStatus,
    debtStatus.gate,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const debtId = parseValue(uuid, context.req.param("debtId"));
      const body = await parseJsonBody(context, debtStatusInput);
      if ("errors" in personId || "errors" in debtId || "errors" in body) {
        return failure(context, "validation-error");
      }
      const actor = await debtStatus.actor(context);
      if (actor instanceof Response) return actor;
      const result = await services.gifts.changeDebtStatus(
        actor,
        personId.data,
        debtId.data,
        body.data.status,
        {
          ...(body.data.settlementReason
            ? { settlementReason: body.data.settlementReason }
            : {}),
          ...(body.data.settlementPhotoFileId
            ? { settlementPhotoFileId: body.data.settlementPhotoFileId }
            : {}),
        },
        revisionOf(body.data),
      );
      if (
        result.status !== "saved" && result.status !== "unchanged"
      ) return failure(context, result.status);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  mount(
    routes,
    createRecurringDebt,
    recurringCreate.gate,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const body = await parseJsonBody(context, recurringDebtCreateInput);
      if ("errors" in personId || "errors" in body) {
        return failure(context, "validation-error");
      }
      const actor = await recurringCreate.actor(context);
      if (actor instanceof Response) return actor;
      const { endsOn, reason, requestId, ...required } = body.data;
      const result = await services.gifts.createRecurringDebt(
        actor,
        personId.data,
        {
          ...required,
          ...(endsOn ? { endsOn } : {}),
          ...(reason ? { reason } : {}),
          ...(requestId ? { requestId } : {}),
        },
      );
      if (result.status !== "created") return failure(context, result.status);
      context.header("Cache-Control", "private, no-store");
      return context.json(result, 201);
    },
  );

  mount(routes, deleteDebt, debtDelete.gate, session, async (context) => {
    const personId = parseValue(uuid, context.req.param("personId"));
    const debtId = parseValue(uuid, context.req.param("debtId"));
    if ("errors" in personId || "errors" in debtId) {
      return failure(context, "not-found");
    }
    const actor = await debtDelete.actor(context);
    if (actor instanceof Response) return actor;
    const result = await services.gifts.deleteDebt(
      actor,
      personId.data,
      debtId.data,
    );
    if (result.status !== "deleted") return failure(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  mount(
    routes,
    updateRecurringDebt,
    recurringUpdate.gate,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const recurringDebtId = parseValue(
        uuid,
        context.req.param("recurringDebtId"),
      );
      const body = await parseJsonBody(context, recurringDebtUpdateInput);
      if (
        "errors" in personId || "errors" in recurringDebtId || "errors" in body
      ) return failure(context, "validation-error");
      const actor = await recurringUpdate.actor(context);
      if (actor instanceof Response) return actor;
      const { expectedUpdatedAt, ...fields } = body.data;
      const change = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
      );
      const result = await services.gifts.changeRecurringDebt(
        actor,
        personId.data,
        recurringDebtId.data,
        change,
        revisionOf({ expectedUpdatedAt }),
      );
      if (result.status !== "saved") return failure(context, result.status);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  mount(
    routes,
    deleteRecurringDebt,
    recurringDelete.gate,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const recurringDebtId = parseValue(
        uuid,
        context.req.param("recurringDebtId"),
      );
      if ("errors" in personId || "errors" in recurringDebtId) {
        return failure(context, "not-found");
      }
      const actor = await recurringDelete.actor(context);
      if (actor instanceof Response) return actor;
      const result = await services.gifts.deleteRecurringDebt(
        actor,
        personId.data,
        recurringDebtId.data,
      );
      if (result.status !== "deleted") return failure(context, result.status);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  mount(routes, updateGift, giftUpdate.gate, session, async (context) => {
    const personId = parseValue(uuid, context.req.param("personId"));
    const giftId = parseValue(uuid, context.req.param("giftId"));
    const body = await parseJsonBody(context, giftUpdateInput);
    if ("errors" in personId || "errors" in giftId || "errors" in body) {
      return failure(context, "validation-error");
    }
    const actor = await giftUpdate.actor(context);
    if (actor instanceof Response) return actor;
    const result = await services.gifts.changeGift(
      actor,
      personId.data,
      giftId.data,
      body.data,
    );
    if (result.status !== "saved" && result.status !== "unchanged") {
      return failure(context, result.status);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  mount(routes, deleteGift, giftDelete.gate, session, async (context) => {
    const personId = parseValue(uuid, context.req.param("personId"));
    const giftId = parseValue(uuid, context.req.param("giftId"));
    const body = await parseJsonBody(context, giftDeleteInput);
    if ("errors" in personId || "errors" in giftId) {
      return failure(context, "not-found");
    }
    if ("errors" in body) return failure(context, "validation-error");
    const actor = await giftDelete.actor(context);
    if (actor instanceof Response) return actor;
    const result = await services.gifts.deleteGift(
      actor,
      personId.data,
      giftId.data,
      body.data,
    );
    if (result.status !== "deleted") return failure(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  mount(routes, updateDebt, debtUpdate.gate, session, async (context) => {
    const personId = parseValue(uuid, context.req.param("personId"));
    const debtId = parseValue(uuid, context.req.param("debtId"));
    const body = await parseJsonBody(context, debtUpdateInput);
    if ("errors" in personId || "errors" in debtId || "errors" in body) {
      return failure(context, "validation-error");
    }
    const actor = await debtUpdate.actor(context);
    if (actor instanceof Response) return actor;
    const result = await services.gifts.changeDebt(
      actor,
      personId.data,
      debtId.data,
      body.data,
    );
    if (result.status !== "saved" && result.status !== "unchanged") {
      return failure(context, result.status);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  return routes;
}
