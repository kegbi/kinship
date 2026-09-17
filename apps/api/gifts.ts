/**
 * Gifts and debts over HTTP.
 *
 * What is left in this file is the part that is about gifts: the five routes,
 * the shapes they accept, and the prose each refusal carries. The problem
 * responder, the session cookie, the origin check, and the kernel status map
 * came from `http/`, where every route file's copy of them was collapsed into
 * one (GAP-019).
 */

import { Hono } from "hono";
import { z } from "zod";
import type { GiftManagement } from "../../packages/backend/modules/gifts/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";
import { failureResponder, type FailureTable } from "./http/failures.ts";
import { requireMatchingOrigin } from "./http/origin.ts";
import { type ActorEnv, requireActor, sessionActor } from "./http/session.ts";
import { parseJsonBody, parseValue } from "./http/validate.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface GiftHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly gifts: GiftManagement;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
}

const uuid = z.uuid();
const giftCreate = z.object({
  amount: z.string().regex(/^\d{1,15}(?:\.\d{1,4})?$/).optional(),
  attachmentFileId: uuid.optional(),
  comment: z.string().trim().min(1).max(10_000).optional(),
  currencyCode: z.string().regex(/^[A-Za-z]{3}$/).optional(),
  eventAt: z.iso.datetime({ offset: true }).optional(),
  name: z.string().trim().min(1).max(500),
  recipientPersonId: uuid.optional(),
  status: z.enum(["archived", "given", "idea", "planned", "received"]),
  url: z.url().max(2_000).optional(),
}).strict();
const debtCreate = z.object({
  amount: z.string().regex(/^\d{1,15}(?:\.\d{1,4})?$/),
  currencyCode: z.string().regex(/^[A-Za-z]{3}$/),
  direction: z.enum(["i_owe", "they_owe"]),
  reason: z.string().trim().min(1).max(10_000).optional(),
  status: z.enum(["cancelled", "open", "settled"]),
}).strict();
const giftStatus = z.object({
  status: z.enum(["archived", "given", "idea", "planned", "received"]),
}).strict();
const debtStatus = z.object({
  status: z.enum(["cancelled", "open", "settled"]),
}).strict();

/**
 * What a refused gift or debt says.
 *
 * `not-found` covers the person, the recipient, the attachment, the gift, and
 * the debt in one answer on purpose: a workspace learns nothing about which of
 * them exists.
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
    "not-found": {
      code: "gift_not_found",
      detail:
        "The person, recipient, attachment, gift, or debt does not exist in the active workspace.",
      title: "Record unavailable",
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
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  routes.get("/api/v1/people/:personId/gifts", session, async (context) => {
    const personId = parseValue(uuid, context.req.param("personId"));
    if ("errors" in personId) return failure(context, "not-found");
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.gifts.list(actor, personId.data);
    if (result.status !== "ready") return failure(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  routes.post(
    "/api/v1/people/:personId/gifts",
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const body = await parseJsonBody(context, giftCreate);
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

  routes.patch(
    "/api/v1/people/:personId/gifts/:giftId/status",
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const giftId = parseValue(uuid, context.req.param("giftId"));
      const body = await parseJsonBody(context, giftStatus);
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

  routes.post(
    "/api/v1/people/:personId/debts",
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const body = await parseJsonBody(context, debtCreate);
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
          ...(body.data.reason ? { reason: body.data.reason } : {}),
          status: body.data.status,
        },
      );
      if (result.status !== "created") return failure(context, result.status);
      context.header("Cache-Control", "private, no-store");
      return context.json(result, 201);
    },
  );

  routes.patch(
    "/api/v1/people/:personId/debts/:debtId/status",
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const debtId = parseValue(uuid, context.req.param("debtId"));
      const body = await parseJsonBody(context, debtStatus);
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
      );
      if (
        result.status !== "saved" && result.status !== "unchanged"
      ) return failure(context, result.status);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );
  return routes;
}
