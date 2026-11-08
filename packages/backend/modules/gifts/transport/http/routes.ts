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
  deleteRecurringDebt,
  listDebtSettlements,
  listDebtSettlementsQuery,
  listPersonGiftsAndDebts,
  listPersonGiftsAndDebtsQuery,
  updateRecurringDebt,
} from "../../../../../contracts/routes/gifts.ts";
import {
  debtCreateInput,
  debtStatusInput,
  giftCreateInput,
  giftStatusInput,
  recurringDebtCreateInput,
  recurringDebtUpdateInput,
} from "../../../../../contracts/schemas/gifts.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import type { BrowserSecurityPolicy } from "../../../../../http-kit/security_policy.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import { requireMatchingOrigin } from "../../../../../http-kit/origin.ts";
import { mount } from "../../../../../http-kit/route.ts";
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

export interface GiftHttpServices {
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
  },
};

const failure = failureResponder(GIFT_FAILURES);

export function createGiftRoutes(services: GiftHttpServices): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services);
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(routes, listDebtSettlements, session, async (context) => {
    const person = parseValue(uuid, context.req.param("personId"));
    const debt = parseValue(uuid, context.req.param("debtId"));
    if ("errors" in person || "errors" in debt) {
      return failure(context, "not-found");
    }
    const query = parseQuery(context, listDebtSettlementsQuery);
    if ("errors" in query) return failure(context, "query-invalid");
    const actor = await requireActor(context);
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
  });

  mount(routes, listPersonGiftsAndDebts, session, async (context) => {
    const personId = parseValue(uuid, context.req.param("personId"));
    if ("errors" in personId) return failure(context, "not-found");
    const query = parseQuery(context, listPersonGiftsAndDebtsQuery);
    if ("errors" in query) return failure(context, "query-invalid");
    const actor = await requireActor(context);
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
  });

  mount(
    routes,
    createGift,
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const body = await parseJsonBody(context, giftCreateInput);
      if ("errors" in personId || "errors" in body) {
        return failure(context, "validation-error");
      }
      const actor = await requireActor(context);
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
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const giftId = parseValue(uuid, context.req.param("giftId"));
      const body = await parseJsonBody(context, giftStatusInput);
      if ("errors" in personId || "errors" in giftId || "errors" in body) {
        return failure(context, "validation-error");
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.gifts.changeGiftStatus(
        actor,
        personId.data,
        giftId.data,
        body.data.status,
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
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const body = await parseJsonBody(context, debtCreateInput);
      if ("errors" in personId || "errors" in body) {
        return failure(context, "validation-error");
      }
      const actor = await requireActor(context);
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
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const debtId = parseValue(uuid, context.req.param("debtId"));
      const body = await parseJsonBody(context, debtStatusInput);
      if ("errors" in personId || "errors" in debtId || "errors" in body) {
        return failure(context, "validation-error");
      }
      const actor = await requireActor(context);
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
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const body = await parseJsonBody(context, recurringDebtCreateInput);
      if ("errors" in personId || "errors" in body) {
        return failure(context, "validation-error");
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const { endsOn, reason, ...required } = body.data;
      const result = await services.gifts.createRecurringDebt(
        actor,
        personId.data,
        {
          ...required,
          ...(endsOn ? { endsOn } : {}),
          ...(reason ? { reason } : {}),
        },
      );
      if (result.status !== "created") return failure(context, result.status);
      context.header("Cache-Control", "private, no-store");
      return context.json(result, 201);
    },
  );

  mount(routes, deleteDebt, origin, session, async (context) => {
    const personId = parseValue(uuid, context.req.param("personId"));
    const debtId = parseValue(uuid, context.req.param("debtId"));
    if ("errors" in personId || "errors" in debtId) {
      return failure(context, "not-found");
    }
    const actor = await requireActor(context);
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
    origin,
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
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const change = Object.fromEntries(
        Object.entries(body.data).filter(([, value]) => value !== undefined),
      );
      const result = await services.gifts.changeRecurringDebt(
        actor,
        personId.data,
        recurringDebtId.data,
        change,
      );
      if (result.status !== "saved") return failure(context, result.status);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  mount(
    routes,
    deleteRecurringDebt,
    origin,
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
      const actor = await requireActor(context);
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
  return routes;
}
