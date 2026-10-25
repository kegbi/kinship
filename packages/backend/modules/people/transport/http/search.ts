/**
 * Workspace search (GAP-048, `SEARCH-001`), served beside the directory it
 * extends.
 *
 * The header palette used to ask the directory for people; it now asks this
 * route for people, notes, activities, journal posts, and tasks at once. The
 * `search` read model decides what each group may show. This file parses the
 * query and the name forms it matches across scripts and keyboard layouts
 * (`contracts/schemas/name_search.ts`), resolves the session, presents each person's avatar the way the
 * directory does, and names the refusals: a people statement that failed or
 * ran past its timeout is `search_unavailable`, while a text statement that
 * did so leaves the people answer standing with the text groups marked
 * `unavailable`.
 */

import { Hono } from "hono";
import {
  searchWorkspace,
  searchWorkspaceQuery,
} from "../../../../../contracts/routes/search.ts";
import {
  NAME_FOLD_STEPS,
  nameSearchForms,
} from "../../../../../contracts/schemas/name_search.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  requireActor,
  sessionActor,
} from "../../../../../http-kit/session.ts";
import { parseQuery } from "../../../../../http-kit/validate.ts";
import { type PeopleHttpServices, withAvatarDescriptor } from "./shared.ts";

export const SEARCH_QUERY_INVALID: ProblemDefinition = {
  code: "search_query_invalid",
  detail: "Search for one to two hundred characters, ten results at most.",
  status: 400,
  title: "Invalid search",
};
export const SEARCH_FORBIDDEN: ProblemDefinition = {
  code: "search_forbidden",
  detail: "Your active workspace membership no longer permits this search.",
  status: 403,
  title: "Search unavailable",
};
export const SEARCH_UNAVAILABLE: ProblemDefinition = {
  code: "search_unavailable",
  detail: "Search is temporarily unavailable.",
  status: 503,
  title: "Search unavailable",
};

export function createSearchRoutes(
  services: Pick<PeopleHttpServices, "protectedSessions" | "search">,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);

  mount(routes, searchWorkspace, session, async (context) => {
    const parsed = parseQuery(context, searchWorkspaceQuery);
    if ("errors" in parsed) {
      return definedProblem(context, SEARCH_QUERY_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.search?.search(actor, {
      limit: parsed.data.limit,
      nameFold: NAME_FOLD_STEPS,
      nameForms: nameSearchForms(parsed.data.q),
      query: parsed.data.q,
      sort: parsed.data.sort,
    }).catch(() => undefined);
    if (!result || result.status === "unavailable") {
      return definedProblem(context, SEARCH_UNAVAILABLE);
    }
    if (result.status === "forbidden") {
      return definedProblem(context, SEARCH_FORBIDDEN);
    }
    const [people, ...entities] = result.groups;
    context.header("Cache-Control", "private, no-store");
    return context.json({
      groups: [
        { ...people, results: people.results.map(withAvatarDescriptor) },
        ...entities,
      ],
      query: result.query,
      status: result.status,
    });
  });

  return routes;
}
