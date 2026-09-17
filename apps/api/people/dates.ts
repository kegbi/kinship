/**
 * The dates a person is remembered by, and how much of each is known.
 *
 * A birthday may be a year, a month and a day, or nothing but an age, and the
 * transport's whole job is to carry exactly the components the stated
 * precision declares and invent none of the others. Both directions go
 * through one presenter and one input builder so a missing month stays
 * missing.
 *
 * A refused important date is its own vocabulary — a second birthday, a stale
 * version, an archived person — and says so rather than borrowing the
 * person's words.
 */

import { Hono } from "hono";
import { z } from "zod";
import type { ImportantDateRecord } from "../../../packages/backend/modules/people/public.ts";
import { failureResponder, type FailureTable } from "../http/failures.ts";
import { requireMatchingOrigin } from "../http/origin.ts";
import { definedProblem, type ProblemDefinition } from "../http/problem.ts";
import { type ActorEnv, requireActor, sessionActor } from "../http/session.ts";
import { parseJsonBody, parseValue } from "../http/validate.ts";
import {
  expectedUpdatedAtSchema,
  type PeopleHttpServices,
  PERSON_ID_INVALID,
  personIdSchema,
  transitionSchema,
} from "./shared.ts";

/** What the important dates of a person's page are served from. */
export type ImportantDateHttpServices = Pick<
  PeopleHttpServices,
  "browserSecurity" | "importantDates" | "protectedSessions"
>;

const importantDateValueSchema = z.object({
  day: z.number().int().min(1).max(31).optional(),
  isAgeBased: z.boolean(),
  isYearApproximate: z.boolean(),
  kind: z.enum(["birthday", "custom", "deceased", "first_met"]),
  label: z.string().trim().max(200).optional(),
  month: z.number().int().min(1).max(12).optional(),
  notes: z.string().trim().max(2_000).optional(),
  precision: z.enum([
    "day",
    "full",
    "month",
    "month_day",
    "unknown",
    "year",
    "year_month",
  ]),
  year: z.number().int().min(1).max(9999).optional(),
}).strict();
const importantDateUpdateSchema = importantDateValueSchema.extend({
  expectedUpdatedAt: expectedUpdatedAtSchema,
});
const importantDateDeleteSchema = transitionSchema;

function importantDateInput(input: z.infer<typeof importantDateValueSchema>) {
  return {
    ...(input.day === undefined ? {} : { day: input.day }),
    isAgeBased: input.isAgeBased,
    isYearApproximate: input.isYearApproximate,
    kind: input.kind,
    ...(input.label ? { label: input.label } : {}),
    ...(input.month === undefined ? {} : { month: input.month }),
    ...(input.notes ? { notes: input.notes } : {}),
    precision: input.precision,
    ...(input.year === undefined ? {} : { year: input.year }),
  };
}

function importantDate(date: ImportantDateRecord) {
  return {
    ...(date.day === undefined ? {} : { day: date.day }),
    createdAt: date.createdAt,
    id: date.id,
    isAgeBased: date.isAgeBased,
    isYearApproximate: date.isYearApproximate,
    kind: date.kind,
    ...(date.label ? { label: date.label } : {}),
    ...(date.month === undefined ? {} : { month: date.month }),
    ...(date.notes ? { notes: date.notes } : {}),
    personId: date.personId,
    precision: date.precision,
    scheduling: date.scheduling,
    updatedAt: date.updatedAt,
    ...(date.year === undefined ? {} : { year: date.year }),
  };
}

/** What a refused important-date write says. */
export const IMPORTANT_DATE_FAILURES: FailureTable = {
  fallback: {
    code: "validation_failed",
    detail: "Use only the components declared by the selected precision.",
    status: 400,
    title: "Invalid important date",
  },
  statuses: {
    "archived-write-rejected": {
      code: "archived_write_rejected",
      detail: "Restore this person before changing important dates.",
      title: "Archived person is read-only",
    },
    conflict: {
      code: "person_date_conflict",
      detail:
        "Birthday, first meeting, and date of death can each be recorded once.",
      title: "Important date already exists",
    },
    forbidden: {
      code: "people_forbidden",
      detail: "Your active workspace membership no longer permits this change.",
      title: "Important dates unavailable",
    },
    "not-found": {
      code: "person_date_not_found",
      detail:
        "The person or important date does not exist in the active workspace.",
      title: "Important date not found",
    },
    stale: {
      code: "person_date_stale",
      detail: "Refresh the important dates before trying again.",
      status: 409,
      title: "Important date changed",
    },
  },
};

export const dateFailure = failureResponder(IMPORTANT_DATE_FAILURES);

export const IMPORTANT_DATES_UNAVAILABLE: ProblemDefinition = {
  code: "important_dates_unavailable",
  detail: "Important dates are temporarily unavailable.",
  status: 503,
  title: "Important dates unavailable",
};
export const IMPORTANT_DATES_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Important dates unavailable",
};
export const CURRENT_PERSON_NOT_FOUND: ProblemDefinition = {
  code: "person_not_found",
  detail: "No person with this identifier exists in the current workspace.",
  status: 404,
  title: "Person not found",
};
export const IMPORTANT_DATE_CREATE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the precision and known components.",
  status: 400,
  title: "Invalid important date",
};
export const IMPORTANT_DATE_NOT_SAVED: ProblemDefinition = {
  code: "important_dates_unavailable",
  detail: "The important-date service is temporarily unavailable.",
  status: 503,
  title: "Important date could not be saved",
};
export const IMPORTANT_DATE_UPDATE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the precision, known components, and current version.",
  status: 400,
  title: "Invalid important date",
};
export const IMPORTANT_DATE_DELETE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Refresh this important date before deleting it.",
  status: 400,
  title: "Invalid important date deletion",
};
export const IMPORTANT_DATE_NOT_DELETED: ProblemDefinition = {
  code: "important_dates_unavailable",
  detail: "The important-date service is temporarily unavailable.",
  status: 503,
  title: "Important date could not be deleted",
};

export function createDatesRoutes(
  services: ImportantDateHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  routes.get("/api/v1/people/:personId/dates", session, async (context) => {
    const personId = parseValue(personIdSchema, context.req.param("personId"));
    if ("errors" in personId) {
      return definedProblem(context, PERSON_ID_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.importantDates?.list(actor, personId.data)
      .catch(() => undefined);
    if (!result) return definedProblem(context, IMPORTANT_DATES_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, IMPORTANT_DATES_FORBIDDEN);
    }
    if (result.status === "not-found") {
      return definedProblem(context, CURRENT_PERSON_NOT_FOUND);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      dates: result.dates.map(importantDate),
      status: result.status,
    });
  });

  routes.post(
    "/api/v1/people/:personId/dates",
    origin,
    session,
    async (context) => {
      const personId = parseValue(
        personIdSchema,
        context.req.param("personId"),
      );
      const input = await parseJsonBody(context, importantDateValueSchema);
      if ("errors" in personId || "errors" in input) {
        return definedProblem(context, IMPORTANT_DATE_CREATE_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.importantDates?.create(
        actor,
        personId.data,
        importantDateInput(input.data),
      ).catch(() => undefined);
      if (!result) return definedProblem(context, IMPORTANT_DATE_NOT_SAVED);
      if (result.status !== "created") return dateFailure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json(
        { date: importantDate(result.date), status: "created" },
        201,
      );
    },
  );

  routes.patch(
    "/api/v1/people/:personId/dates/:dateId",
    origin,
    session,
    async (context) => {
      const personId = parseValue(
        personIdSchema,
        context.req.param("personId"),
      );
      const dateId = parseValue(personIdSchema, context.req.param("dateId"));
      const input = await parseJsonBody(context, importantDateUpdateSchema);
      if ("errors" in personId || "errors" in dateId || "errors" in input) {
        return definedProblem(context, IMPORTANT_DATE_UPDATE_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const { expectedUpdatedAt, ...value } = input.data;
      const result = await services.importantDates?.update(
        actor,
        personId.data,
        dateId.data,
        { ...importantDateInput(value), expectedUpdatedAt },
      ).catch(() => undefined);
      if (!result) return definedProblem(context, IMPORTANT_DATE_NOT_SAVED);
      if (result.status !== "updated") return dateFailure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json({
        date: importantDate(result.date),
        status: "updated",
      });
    },
  );

  routes.delete(
    "/api/v1/people/:personId/dates/:dateId",
    origin,
    session,
    async (context) => {
      const personId = parseValue(
        personIdSchema,
        context.req.param("personId"),
      );
      const dateId = parseValue(personIdSchema, context.req.param("dateId"));
      const input = await parseJsonBody(context, importantDateDeleteSchema);
      if ("errors" in personId || "errors" in dateId || "errors" in input) {
        return definedProblem(context, IMPORTANT_DATE_DELETE_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.importantDates?.delete(
        actor,
        personId.data,
        dateId.data,
        input.data,
      ).catch(() => undefined);
      if (!result) return definedProblem(context, IMPORTANT_DATE_NOT_DELETED);
      if (result.status !== "deleted") return dateFailure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json({ dateId: result.dateId, status: "deleted" });
    },
  );

  return routes;
}
