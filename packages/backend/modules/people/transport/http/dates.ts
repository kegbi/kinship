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
import type { z } from "zod";
import type { ImportantDateRecord } from "../../public.ts";
import {
  createImportantDate,
  deleteImportantDate,
  listImportantDates,
  updateImportantDate,
} from "../../../../../contracts/routes/people.ts";
import {
  // The presenter below already owns the name `importantDateInput` for the
  // command it builds; this is the body that command is built from.
  importantDateInput as importantDateValueSchema,
  importantDateUpdateInput,
  personTransitionInput,
} from "../../../../../contracts/schemas/people.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import { requireCookieWriteOrigin } from "../../../../../http-kit/origin.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import { scopedRouteActor } from "../../../../../http-kit/scoped_actor.ts";
import {
  type ActorEnv,
  sessionActor,
} from "../../../../../http-kit/session.ts";
import { parseJsonBody, parseValue } from "../../../../../http-kit/validate.ts";
import { type PeopleHttpServices, PERSON_ID_INVALID } from "./shared.ts";

/** What the important dates of a person's page are served from. */
export type ImportantDateHttpServices = Pick<
  PeopleHttpServices,
  "apiTokens" | "browserSecurity" | "importantDates" | "protectedSessions"
>;

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

/** One important date as every answer that carries it presents it. */
export function importantDate(date: ImportantDateRecord) {
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
  const session = sessionActor(services);
  const tokens = {
    browserSecurity: services.browserSecurity,
    tokens: services.apiTokens,
  };
  const datesActor = scopedRouteActor(listImportantDates, tokens);
  const createActor = scopedRouteActor(createImportantDate, tokens);
  const updateActor = scopedRouteActor(updateImportantDate, tokens);
  const deleteActor = scopedRouteActor(deleteImportantDate, tokens);
  const origin = requireCookieWriteOrigin(services.browserSecurity);

  mount(routes, listImportantDates, session, async (context) => {
    const personId = parseValue(uuid, context.req.param("personId"));
    if ("errors" in personId) {
      return definedProblem(context, PERSON_ID_INVALID);
    }
    const actor = await datesActor(context);
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

  mount(
    routes,
    createImportantDate,
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const input = await parseJsonBody(context, importantDateValueSchema);
      if ("errors" in personId || "errors" in input) {
        return definedProblem(context, IMPORTANT_DATE_CREATE_INVALID);
      }
      const actor = await createActor(context);
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

  mount(
    routes,
    updateImportantDate,
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const dateId = parseValue(uuid, context.req.param("dateId"));
      const input = await parseJsonBody(context, importantDateUpdateInput);
      if ("errors" in personId || "errors" in dateId || "errors" in input) {
        return definedProblem(context, IMPORTANT_DATE_UPDATE_INVALID);
      }
      const actor = await updateActor(context);
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

  mount(
    routes,
    deleteImportantDate,
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const dateId = parseValue(uuid, context.req.param("dateId"));
      const input = await parseJsonBody(context, personTransitionInput);
      if ("errors" in personId || "errors" in dateId || "errors" in input) {
        return definedProblem(context, IMPORTANT_DATE_DELETE_INVALID);
      }
      const actor = await deleteActor(context);
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
