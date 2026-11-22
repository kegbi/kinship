/**
 * One person's page: the identity header, their life events, their timeline.
 *
 * Three reads that degrade independently, because a person's page shows them
 * side by side and one unavailable section must not blank the others. Each
 * names what is unavailable rather than saying the person is.
 *
 * The timeline answers its own authentication problem instead of the shared
 * one: it is fetched by a script after the page has rendered, and the code it
 * reads decides whether to prompt for a sign-in or stay quiet.
 */

import { Hono } from "hono";
import {
  getPerson,
  getPersonQuery,
  listPersonLifeEvents,
  listPersonTimeline,
  listPersonTimelineQuery,
} from "../../../../../contracts/routes/people.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import { scopedRouteActor } from "../../../../../http-kit/scoped_actor.ts";
import {
  type ActorEnv,
  requireActor,
  sessionActor,
} from "../../../../../http-kit/session.ts";
import { parseQuery, parseValue } from "../../../../../http-kit/validate.ts";
import {
  type PeopleHttpServices,
  PERSON_FORBIDDEN,
  PERSON_ID_INVALID,
  withStoredAvatarDescriptor,
} from "./shared.ts";
import { importantDate } from "./dates.ts";
import { publicProfileFact } from "./fact_schemas.ts";

/** What one person's read-only page is served from. */
export type PersonProfileHttpServices = Pick<
  PeopleHttpServices,
  "apiTokens" | "browserSecurity" | "profile" | "protectedSessions"
>;

export const LIFE_EVENTS_UNAVAILABLE: ProblemDefinition = {
  code: "person_life_events_unavailable",
  detail: "Other person sections remain available.",
  status: 503,
  title: "Life events unavailable",
};
export const LIFE_EVENTS_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Life events unavailable",
};
export const ACTIVE_PERSON_NOT_FOUND: ProblemDefinition = {
  code: "person_not_found",
  detail:
    "No active person with this identifier exists in the current workspace.",
  status: 404,
  title: "Person not found",
};
export const TIMELINE_QUERY_INVALID: ProblemDefinition = {
  code: "person_timeline_query_invalid",
  detail: "Use a canonical person, supported kind, and bounded page size.",
  status: 400,
  title: "Invalid person timeline",
};
export const TIMELINE_SESSION_INVALID: ProblemDefinition = {
  code: "person_timeline_authentication_required",
  detail: "Sign in with an active workspace membership.",
  status: 401,
  title: "Authentication required",
};
export const TIMELINE_UNAVAILABLE: ProblemDefinition = {
  code: "person_timeline_unavailable",
  detail: "Other person sections remain available.",
  status: 503,
  title: "Person timeline unavailable",
};
export const TIMELINE_FORBIDDEN: ProblemDefinition = {
  code: "person_timeline_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Person timeline unavailable",
};
export const TIMELINE_NOT_FOUND: ProblemDefinition = {
  code: "person_timeline_not_found",
  detail:
    "No active person with this identifier exists in the current workspace.",
  status: 404,
  title: "Person not found",
};
export const TIMELINE_CURSOR_STALE: ProblemDefinition = {
  code: "person_timeline_stale_cursor",
  detail: "Refresh the timeline before continuing from this page.",
  status: 409,
  title: "Person timeline changed",
};
export const PERSON_QUERY_INVALID: ProblemDefinition = {
  code: "person_query_invalid",
  detail:
    "Use include=summary for the person summary, or include=rail for the summary and the rail.",
  status: 400,
  title: "Invalid person query",
};
export const PERSON_UNAVAILABLE: ProblemDefinition = {
  code: "people_unavailable",
  detail: "The person service is temporarily unavailable.",
  status: 503,
  title: "Person unavailable",
};

type PersonRail = NonNullable<
  Extract<
    Awaited<ReturnType<PersonProfileHttpServices["profile"]["get"]>>,
    { readonly person: unknown }
  >["rail"]
>;

/**
 * The composed rail as each section's own endpoint presents it (AUD-Q3): a
 * fact's value carries its section, and an important date its public shape.
 */
function presentedRail(rail: PersonRail) {
  const facts = (entry: PersonRail["contact-methods"]) =>
    entry.status === "ready"
      ? {
        status: entry.status,
        value: {
          ...entry.value,
          records: entry.value.records.map(publicProfileFact),
        },
      }
      : entry;
  const dates = rail["important-dates"];
  return {
    addresses: facts(rail.addresses),
    "contact-methods": facts(rail["contact-methods"]),
    "first-meeting": facts(rail["first-meeting"]),
    "food-preferences": facts(rail["food-preferences"]),
    "important-dates": dates.status === "ready"
      ? {
        status: dates.status,
        value: {
          dates: dates.value.dates.map(importantDate),
          status: dates.value.status,
        },
      }
      : dates,
    pets: facts(rail.pets),
    relationships: rail.relationships,
    reminders: rail.reminders,
    tags: facts(rail.tags),
    work: facts(rail.work),
  };
}

export function createProfileRoutes(
  services: PersonProfileHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services);
  const lifeEventsActor = scopedRouteActor(listPersonLifeEvents, {
    browserSecurity: services.browserSecurity,
    tokens: services.apiTokens,
  });

  mount(
    routes,
    listPersonLifeEvents,
    session,
    async (context) => {
      const parsed = parseValue(uuid, context.req.param("personId"));
      if ("errors" in parsed) {
        return definedProblem(context, PERSON_ID_INVALID);
      }
      const actor = await lifeEventsActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.profile.listLifeEvents(actor, parsed.data)
        .catch(() => undefined);
      if (!result) return definedProblem(context, LIFE_EVENTS_UNAVAILABLE);
      if (result.status === "forbidden") {
        return definedProblem(context, LIFE_EVENTS_FORBIDDEN);
      }
      if (result.status === "not-found") {
        return definedProblem(context, ACTIVE_PERSON_NOT_FOUND);
      }
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  mount(routes, listPersonTimeline, session, async (context) => {
    const personId = parseValue(uuid, context.req.param("personId"));
    const input = parseQuery(context, listPersonTimelineQuery);
    if ("errors" in personId || "errors" in input) {
      return definedProblem(context, TIMELINE_QUERY_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) {
      return definedProblem(context, TIMELINE_SESSION_INVALID);
    }
    const result = await services.profile.listTimeline(
      actor,
      personId.data,
      {
        ...(input.data.cursor ? { cursor: input.data.cursor } : {}),
        ...(input.data.kind ? { kind: input.data.kind } : {}),
        limit: input.data.limit,
      },
    ).catch(() => undefined);
    if (!result) return definedProblem(context, TIMELINE_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, TIMELINE_FORBIDDEN);
    }
    if (result.status === "not-found") {
      return definedProblem(context, TIMELINE_NOT_FOUND);
    }
    if (result.status === "stale-cursor") {
      return definedProblem(context, TIMELINE_CURSOR_STALE);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  mount(routes, getPerson, session, async (context) => {
    const parsed = parseValue(uuid, context.req.param("personId"));
    if ("errors" in parsed) {
      return definedProblem(context, PERSON_ID_INVALID);
    }
    const query = parseQuery(context, getPersonQuery);
    if ("errors" in query) {
      return definedProblem(context, PERSON_QUERY_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const include = query.data.include;
    const result = await (include === "rail"
      ? services.profile.get(actor, parsed.data, { includeRail: true })
      : include === "summary"
      ? services.profile.get(actor, parsed.data, { includeSummary: true })
      : services.profile.get(actor, parsed.data)).catch(() =>
        undefined
      );
    if (!result) return definedProblem(context, PERSON_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, PERSON_FORBIDDEN);
    }
    if (result.status === "not-found") {
      return definedProblem(context, ACTIVE_PERSON_NOT_FOUND);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      dueInformation: result.dueInformation,
      ...(result.genderOptions ? { genderOptions: result.genderOptions } : {}),
      person: withStoredAvatarDescriptor(result.person),
      ...(include === "rail" && result.rail
        ? { rail: presentedRail(result.rail) }
        : {}),
      status: result.status,
      ...(include && result.summary ? { summary: result.summary } : {}),
    });
  });

  return routes;
}
