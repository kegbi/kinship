import { type Context, Hono } from "hono";
import { z } from "zod";
import type { GiftManagement } from "../../packages/backend/modules/gifts/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

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

function problem(
  context: Context,
  status: 400 | 401 | 403 | 404 | 409 | 503,
  code: string,
  title: string,
  detail: string,
) {
  return context.body(
    JSON.stringify({
      type: `https://kinship.test/problems/${code}`,
      title,
      status,
      detail,
      code,
    }),
    status,
    {
      "Cache-Control": "no-store",
      "Content-Type": "application/problem+json",
    },
  );
}

function cookieValue(header: string | undefined, name: string) {
  return header?.split(";").map((value) => value.trim()).find((value) =>
    value.startsWith(`${name}=`)
  )?.slice(name.length + 1);
}

async function actor(context: Context, services: GiftHttpServices) {
  const sessionToken = cookieValue(
    context.req.header("Cookie"),
    "kinship_session",
  );
  if (!sessionToken) return undefined;
  const requestedWorkspaceId = context.req.header("X-Workspace-Id");
  const resolved = await services.protectedSessions.resolve({
    sessionToken,
    ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
  }).catch(() => undefined);
  return resolved
    ? {
      memberId: resolved.memberId,
      role: resolved.role,
      userId: resolved.userId,
      workspaceId: resolved.workspaceId,
    }
    : undefined;
}

function requireOrigin(context: Context, policy: BrowserSecurityPolicy) {
  return context.req.header("Origin") === policy.origin ? undefined : problem(
    context,
    403,
    "origin_invalid",
    "Request forbidden",
    "This request did not come from the configured application origin.",
  );
}

function failure(context: Context, status: string) {
  if (status === "forbidden") {
    return problem(
      context,
      403,
      "gifts_forbidden",
      "Gifts unavailable",
      "Your active workspace membership no longer permits this action.",
    );
  }
  if (status === "not-found") {
    return problem(
      context,
      404,
      "gift_not_found",
      "Record unavailable",
      "The person, recipient, attachment, gift, or debt does not exist in the active workspace.",
    );
  }
  if (status === "archived-write-rejected") {
    return problem(
      context,
      409,
      "archived_write_rejected",
      "Archived person is read-only",
      "Restore the person before changing gifts or debts.",
    );
  }
  if (status === "invalid-transition") {
    return problem(
      context,
      409,
      "gift_transition_invalid",
      "Status cannot be changed",
      "Refresh the record and choose a valid next status.",
    );
  }
  if (status === "validation-error") {
    return problem(
      context,
      400,
      "gift_invalid",
      "Invalid gift or debt",
      "Review the amount, currency, recipient, attachment, and other fields.",
    );
  }
  return problem(
    context,
    503,
    "gifts_unavailable",
    "Gifts unavailable",
    "Gifts and debts are temporarily unavailable.",
  );
}

async function authentication(context: Context, services: GiftHttpServices) {
  const resolved = await actor(context, services);
  if (!resolved) {
    return {
      response: problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      ),
    };
  }
  return { actor: resolved };
}

export function createGiftRoutes(services: GiftHttpServices): Hono {
  const routes = new Hono();
  routes.get("/api/v1/people/:personId/gifts", async (context) => {
    const personId = uuid.safeParse(context.req.param("personId"));
    if (!personId.success) return failure(context, "not-found");
    const auth = await authentication(context, services);
    if (!auth.actor) return auth.response;
    const result = await services.gifts.list(auth.actor, personId.data);
    if (result.status !== "ready") return failure(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  routes.post("/api/v1/people/:personId/gifts", async (context) => {
    const origin = requireOrigin(context, services.browserSecurity);
    if (origin) return origin;
    const personId = uuid.safeParse(context.req.param("personId"));
    const body = giftCreate.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!personId.success || !body.success) {
      return failure(context, "validation-error");
    }
    const auth = await authentication(context, services);
    if (!auth.actor) return auth.response;
    const result = await services.gifts.createGift(
      auth.actor,
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
  });

  routes.patch(
    "/api/v1/people/:personId/gifts/:giftId/status",
    async (context) => {
      const origin = requireOrigin(context, services.browserSecurity);
      if (origin) return origin;
      const personId = uuid.safeParse(context.req.param("personId"));
      const giftId = uuid.safeParse(context.req.param("giftId"));
      const body = giftStatus.safeParse(
        await context.req.json().catch(() => undefined),
      );
      if (
        !personId.success || !giftId.success || !body.success
      ) return failure(context, "validation-error");
      const auth = await authentication(context, services);
      if (!auth.actor) return auth.response;
      const result = await services.gifts.changeGiftStatus(
        auth.actor,
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

  routes.post("/api/v1/people/:personId/debts", async (context) => {
    const origin = requireOrigin(context, services.browserSecurity);
    if (origin) return origin;
    const personId = uuid.safeParse(context.req.param("personId"));
    const body = debtCreate.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!personId.success || !body.success) {
      return failure(context, "validation-error");
    }
    const auth = await authentication(context, services);
    if (!auth.actor) return auth.response;
    const result = await services.gifts.createDebt(
      auth.actor,
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
  });

  routes.patch(
    "/api/v1/people/:personId/debts/:debtId/status",
    async (context) => {
      const origin = requireOrigin(context, services.browserSecurity);
      if (origin) return origin;
      const personId = uuid.safeParse(context.req.param("personId"));
      const debtId = uuid.safeParse(context.req.param("debtId"));
      const body = debtStatus.safeParse(
        await context.req.json().catch(() => undefined),
      );
      if (
        !personId.success || !debtId.success || !body.success
      ) return failure(context, "validation-error");
      const auth = await authentication(context, services);
      if (!auth.actor) return auth.response;
      const result = await services.gifts.changeDebtStatus(
        auth.actor,
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
