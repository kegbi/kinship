/**
 * The people directory, its tag filter, and the recently viewed list.
 *
 * The routes a person meets before they open anybody: the bounded list, the
 * tag options that filter it, the tag facet that counts people per tag
 * (GAP-053), the view that records who was opened, and the recent-people
 * strip that reads those views back.
 *
 * The directory accepts an API token as well as a session cookie, which is
 * what `scopedRouteActor` is for: an `Authorization` header commits the
 * request to the token path with the scope `listPeople` names, so a
 * token that lacks it is refused rather than a silent fall back onto
 * whatever cookie the same request happened to carry.
 *
 * `GET /api/v1/people/tag-options` is registered before any route that reads
 * one person, and this file is mounted before `profile.ts`, so the literal
 * keeps winning over `:personId`.
 */

import { Hono } from "hono";
import {
  getTodayRecentPeople,
  listPeople,
  listPeopleQuery,
  listPeopleTagFacet,
  listPeopleTagFacetQuery,
  listPeopleTagOptions,
  listPeopleTagOptionsQuery,
  recordPersonView,
} from "../../../../../contracts/routes/people.ts";
import {
  NAME_FOLD_STEPS,
  nameSearchForms,
} from "../../../../../contracts/schemas/name_search.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import { requireMatchingOrigin } from "../../../../../http-kit/origin.ts";
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
  withAvatarDescriptor,
} from "./shared.ts";

/** What the directory, its tag options, and the recent list are served from. */
export type PeopleDirectoryHttpServices = Pick<
  PeopleHttpServices,
  | "apiTokens"
  | "browserSecurity"
  | "directory"
  | "profile"
  | "protectedSessions"
  | "recentPeople"
  | "tagFacet"
  | "tagOptions"
  | "todayRecentPeople"
>;

export const PEOPLE_QUERY_INVALID: ProblemDefinition = {
  code: "people_query_invalid",
  detail: "Review the search, tag, sort, lifecycle, and pagination criteria.",
  status: 400,
  title: "Invalid people query",
};
export const PEOPLE_UNAVAILABLE: ProblemDefinition = {
  code: "people_unavailable",
  detail: "The people directory is temporarily unavailable.",
  status: 503,
  title: "People unavailable",
};
export const PEOPLE_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "People unavailable",
};
export const PEOPLE_CURSOR_STALE: ProblemDefinition = {
  code: "stale_cursor",
  detail: "Refresh the directory before continuing from this page.",
  status: 409,
  title: "People list changed",
};
export const TAG_OPTIONS_QUERY_INVALID: ProblemDefinition = {
  code: "tag_options_query_invalid",
  detail: "Review the tag search and pagination criteria.",
  status: 400,
  title: "Invalid tag options query",
};
export const TAG_OPTIONS_UNAVAILABLE: ProblemDefinition = {
  code: "tag_options_unavailable",
  detail: "Tag options are temporarily unavailable.",
  status: 503,
  title: "Tag options unavailable",
};
export const TAG_OPTIONS_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Tag options unavailable",
};
export const TAG_OPTIONS_CURSOR_INVALID: ProblemDefinition = {
  code: "tag_options_cursor_invalid",
  detail: "Start a new tag search before continuing.",
  status: 400,
  title: "Invalid tag options cursor",
};
export const TAG_FACET_QUERY_INVALID: ProblemDefinition = {
  code: "tag_facet_query_invalid",
  detail: "Ask for the active or the archived people's tags.",
  status: 400,
  title: "Invalid tag facet query",
};
export const TAG_FACET_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Tag counts unavailable",
};
export const TAG_FACET_UNAVAILABLE: ProblemDefinition = {
  code: "tag_facet_unavailable",
  detail: "Tag counts are temporarily unavailable.",
  status: 503,
  title: "Tag counts unavailable",
};
export const PERSON_VIEW_INVALID: ProblemDefinition = {
  code: "person_view_invalid",
  detail: "Use a canonical person identifier and an empty request body.",
  status: 400,
  title: "Invalid person view",
};
export const PERSON_VIEW_UNRESOLVED: ProblemDefinition = {
  code: "person_view_unavailable",
  detail: "The person could not be resolved before updating recent history.",
  status: 503,
  title: "Person view unavailable",
};
export const PERSON_VIEW_NOT_FOUND: ProblemDefinition = {
  code: "person_not_found",
  detail:
    "No viewable person with this identifier exists in the current workspace.",
  status: 404,
  title: "Person not found",
};
export const PERSON_VIEW_NOT_RECORDED: ProblemDefinition = {
  code: "person_view_unavailable",
  detail: "Recent-person history could not be updated.",
  status: 503,
  title: "Person view unavailable",
};
export const RECENT_PEOPLE_UNAVAILABLE: ProblemDefinition = {
  code: "today_recent_people_unavailable",
  detail: "Recently viewed people are temporarily unavailable.",
  status: 503,
  title: "Recent people unavailable",
};
export const RECENT_PEOPLE_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Recent people unavailable",
};

export function createDirectoryRoutes(
  services: PeopleDirectoryHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services);
  const tokens = {
    browserSecurity: services.browserSecurity,
    tokens: services.apiTokens,
  };
  const directoryActor = scopedRouteActor(listPeople, tokens);
  const tagOptionsActor = scopedRouteActor(listPeopleTagOptions, tokens);
  const tagFacetActor = scopedRouteActor(listPeopleTagFacet, tokens);
  const recentPeopleActor = scopedRouteActor(getTodayRecentPeople, tokens);
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(routes, listPeople, session, async (context) => {
    const parsed = parseQuery(context, listPeopleQuery);
    if ("errors" in parsed) {
      return definedProblem(context, PEOPLE_QUERY_INVALID);
    }
    const actor = await directoryActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.directory.list(actor, {
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
      ...(parsed.data.excludePersonId
        ? { excludePersonId: parsed.data.excludePersonId }
        : {}),
      lifecycle: parsed.data.lifecycle,
      limit: parsed.data.limit,
      ...(parsed.data.search
        ? {
          // Names match across scripts and keyboard layouts (`SEARCH-001`).
          nameFold: NAME_FOLD_STEPS,
          nameForms: nameSearchForms(parsed.data.search),
          search: parsed.data.search,
        }
        : {}),
      ...(parsed.data.selectedPersonId
        ? { selectedPersonId: parsed.data.selectedPersonId }
        : {}),
      sort: parsed.data.sort,
      starred: parsed.data.starred === "true",
      starredFirst: parsed.data.starredFirst === "true",
      ...(parsed.data.tag ? { tagId: parsed.data.tag } : {}),
    }).catch(() => undefined);
    if (!result) return definedProblem(context, PEOPLE_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, PEOPLE_FORBIDDEN);
    }
    if (result.status === "stale-cursor") {
      return definedProblem(context, PEOPLE_CURSOR_STALE);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      lifecycle: parsed.data.lifecycle,
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      people: result.people.map(withAvatarDescriptor),
      ...(result.selected
        ? { selected: withAvatarDescriptor(result.selected) }
        : {}),
      status: "ready",
    });
  });

  mount(routes, listPeopleTagOptions, session, async (context) => {
    const parsed = parseQuery(context, listPeopleTagOptionsQuery);
    if ("errors" in parsed) {
      return definedProblem(context, TAG_OPTIONS_QUERY_INVALID);
    }
    const actor = await tagOptionsActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.tagOptions.list(actor, {
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
      ...(parsed.data.search ? { search: parsed.data.search } : {}),
      ...(parsed.data.selected ? { selectedTagId: parsed.data.selected } : {}),
    }).catch(() => undefined);
    if (!result) return definedProblem(context, TAG_OPTIONS_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, TAG_OPTIONS_FORBIDDEN);
    }
    if (result.status === "invalid-input") {
      return definedProblem(context, TAG_OPTIONS_CURSOR_INVALID);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      options: result.options,
      ...(result.selected ? { selected: result.selected } : {}),
      status: "ready",
    });
  });

  // The tag facet (GAP-053): a literal path, so it is registered, like the
  // tag options, before any route that reads one person.
  mount(routes, listPeopleTagFacet, session, async (context) => {
    const parsed = parseQuery(context, listPeopleTagFacetQuery);
    if ("errors" in parsed) {
      return definedProblem(context, TAG_FACET_QUERY_INVALID);
    }
    const actor = await tagFacetActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.tagFacet?.list(actor, {
      lifecycle: parsed.data.lifecycle,
    }).catch(() => undefined);
    if (!result) return definedProblem(context, TAG_FACET_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, TAG_FACET_FORBIDDEN);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  mount(
    routes,
    recordPersonView,
    origin,
    session,
    async (context) => {
      const parsed = parseValue(uuid, context.req.param("personId"));
      const body = await context.req.text().catch(() => undefined);
      if ("errors" in parsed || body !== "") {
        return definedProblem(context, PERSON_VIEW_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const profile = await services.profile.get(actor, parsed.data).catch(
        () => undefined,
      );
      if (!profile) return definedProblem(context, PERSON_VIEW_UNRESOLVED);
      if (profile.status === "forbidden") {
        return definedProblem(context, PERSON_FORBIDDEN);
      }
      if (profile.status === "not-found") {
        return definedProblem(context, PERSON_VIEW_NOT_FOUND);
      }
      const result = await services.recentPeople?.record(actor, parsed.data)
        .catch(() => undefined);
      if (!result) return definedProblem(context, PERSON_VIEW_NOT_RECORDED);
      if (result.status === "forbidden") {
        return definedProblem(context, PERSON_FORBIDDEN);
      }
      context.header("Cache-Control", "private, no-store");
      return context.json({ status: "recorded" });
    },
  );

  mount(routes, getTodayRecentPeople, session, async (context) => {
    const actor = await recentPeopleActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.todayRecentPeople?.get(actor).catch(() =>
      undefined
    );
    if (!result) return definedProblem(context, RECENT_PEOPLE_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, RECENT_PEOPLE_FORBIDDEN);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({ people: result.people, status: "ready" });
  });

  return routes;
}
