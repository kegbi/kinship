/**
 * Acting on several people at once over HTTP (GAP-051, PEOPLE-009).
 *
 * One route: archive, restore, tag, or untag up to a hundred people. The body
 * is parsed with the published schema, so a malformed selection is refused
 * before anybody is read. Partial success is the ordinary answer, a 200 with
 * one outcome per person in request order; only what concerns the whole
 * request is a problem.
 */

import { Hono } from "hono";
import { bulkPeople } from "../../../../../contracts/routes/people.ts";
import { peopleBulkInput } from "../../../../../contracts/schemas/people.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import { requireCookieWriteOrigin } from "../../../../../http-kit/origin.ts";
import { scopedRouteActor } from "../../../../../http-kit/scoped_actor.ts";
import {
  type ActorEnv,
  sessionActor,
} from "../../../../../http-kit/session.ts";
import { parseJsonBody } from "../../../../../http-kit/validate.ts";
import type { PeopleHttpServices } from "./shared.ts";

/** What the bulk action is served from. */
export type BulkHttpServices = Pick<
  PeopleHttpServices,
  "apiTokens" | "browserSecurity" | "bulk" | "protectedSessions"
>;

export const PEOPLE_BULK_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail:
    "Select between 1 and 100 different people, and a tag only when tagging.",
  status: 400,
  title: "Invalid bulk action",
};
export const PEOPLE_BULK_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this change.",
  status: 403,
  title: "People unavailable",
};
export const PEOPLE_BULK_TAG_INVALID: ProblemDefinition = {
  code: "profile_fact_reference_invalid",
  detail: "Select an active option from the current workspace.",
  status: 400,
  title: "Profile option unavailable",
};
export const PEOPLE_BULK_UNAVAILABLE: ProblemDefinition = {
  code: "people_unavailable",
  detail: "The person service is temporarily unavailable.",
  status: 503,
  title: "People could not be changed",
};

export function createBulkRoutes(services: BulkHttpServices): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services);
  const origin = requireCookieWriteOrigin(services.browserSecurity);
  const bulkActor = scopedRouteActor(bulkPeople, {
    browserSecurity: services.browserSecurity,
    tokens: services.apiTokens,
  });

  mount(routes, bulkPeople, origin, session, async (context) => {
    const input = await parseJsonBody(context, peopleBulkInput);
    if ("errors" in input) {
      return definedProblem(context, PEOPLE_BULK_INVALID, input.errors);
    }
    const actor = await bulkActor(context);
    if (actor instanceof Response) return actor;
    if (!services.bulk) {
      return definedProblem(context, PEOPLE_BULK_UNAVAILABLE);
    }
    const { tagId, ...selection } = input.data;
    const result = await services.bulk.run(actor, {
      ...selection,
      ...(tagId ? { tagId } : {}),
    }).catch(() => undefined);
    if (!result) return definedProblem(context, PEOPLE_BULK_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, PEOPLE_BULK_FORBIDDEN);
    }
    if (result.status === "tag-unavailable") {
      return definedProblem(context, PEOPLE_BULK_TAG_INVALID);
    }
    if (result.status === "validation-error") {
      return definedProblem(context, PEOPLE_BULK_INVALID, result.errors);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      action: result.action,
      results: result.results,
      summary: result.summary,
    });
  });

  return routes;
}
