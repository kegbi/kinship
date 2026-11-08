/**
 * A person's workspace star over HTTP (GAP-053, PEOPLE-010).
 *
 * `PUT /people/{personId}/star` stars the person and `DELETE` removes the
 * star. A sub-resource rather than an identity field, because the identity
 * PATCH is an optimistic edit of the person's own facts that needs the
 * current revision, while a star is an idempotent flag any row or hero can set
 * without one, and setting it does not move that revision. Both go through
 * the people use case, which revalidates the member, refuses an archived
 * person, and audits the change.
 */

import { Hono } from "hono";
import {
  starPerson,
  unstarPerson,
} from "../../../../../contracts/routes/people.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import { requireMatchingOrigin } from "../../../../../http-kit/origin.ts";
import { definedProblem } from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  requireActor,
  sessionActor,
} from "../../../../../http-kit/session.ts";
import type { Context } from "hono";
import { parseValue } from "../../../../../http-kit/validate.ts";
import { type PeopleHttpServices, PERSON_ID_INVALID } from "./shared.ts";

/** What a person's star is served from. */
export type PersonStarHttpServices = Pick<
  PeopleHttpServices,
  "browserSecurity" | "protectedSessions" | "stars"
>;

/** What a refused star says. */
export const STAR_FAILURES: FailureTable = {
  fallback: {
    code: "person_star_unavailable",
    detail: "The star could not be changed right now.",
    status: 503,
    title: "Star unavailable",
  },
  statuses: {
    "archived-write-rejected": {
      code: "archived_write_rejected",
      detail: "Restore this person before starring or unstarring them.",
      title: "Archived person is read-only",
    },
    forbidden: {
      code: "people_forbidden",
      detail: "Your active workspace membership no longer permits this change.",
      title: "Star unavailable",
    },
    "not-found": {
      code: "person_not_found",
      detail: "No person with this identifier exists in the current workspace.",
      title: "Person not found",
    },
  },
};

const failure = failureResponder(STAR_FAILURES);

export function createStarRoutes(
  services: PersonStarHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services);
  const origin = requireMatchingOrigin(services.browserSecurity);

  const setStar = (starred: boolean) => async (context: Context<ActorEnv>) => {
    const personId = parseValue(uuid, context.req.param("personId"));
    if ("errors" in personId) return definedProblem(context, PERSON_ID_INVALID);
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.stars?.set(actor, personId.data, starred)
      .catch(() => undefined);
    if (!result) return failure(context, "unavailable");
    if (result.status !== "ready") return failure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json({ isStarred: result.isStarred, status: "ready" });
  };

  mount(routes, starPerson, origin, session, setStar(true));
  mount(routes, unstarPerson, origin, session, setStar(false));
  return routes;
}
