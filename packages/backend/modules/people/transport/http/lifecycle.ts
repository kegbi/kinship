/**
 * Archiving, restoring, and deleting a person.
 *
 * Four routes that change what a person is rather than what they are called.
 * Each carries the version it was decided against, and deletion carries two
 * things more: the impact preview it was decided from, and the exact
 * confirmation that preview printed, so a person is never deleted from a
 * stale idea of what goes with them.
 *
 * Archive and restore are one handler registered twice, because the two
 * differ only in the use case they call.
 */

import { Hono } from "hono";
import {
  archivePerson,
  deletePerson,
  getPersonDeletionImpact,
  restorePerson,
} from "../../../../../contracts/routes/people.ts";
import {
  personDeleteInput,
  personTransitionInput,
} from "../../../../../contracts/schemas/people.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import {
  cookieWriteOrigin,
  scopedRouteActor,
} from "../../../../../http-kit/scoped_actor.ts";
import {
  type ActorEnv,
  sessionActor,
} from "../../../../../http-kit/session.ts";
import { parseJsonBody, parseValue } from "../../../../../http-kit/validate.ts";
import {
  lifecycleFailure,
  lifecycleIdentity,
  type PeopleHttpServices,
  PERSON_ID_INVALID,
} from "./shared.ts";

/** What a person's lifecycle transitions are served from. */
export type PersonLifecycleHttpServices = Pick<
  PeopleHttpServices,
  "apiTokens" | "browserSecurity" | "people" | "protectedSessions"
>;

export const LIFECYCLE_REQUEST_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Refresh this person before trying again.",
  status: 400,
  title: "Invalid lifecycle request",
};
export const PERSON_NOT_CHANGED: ProblemDefinition = {
  code: "people_unavailable",
  detail: "The person service is temporarily unavailable.",
  status: 503,
  title: "Person could not be changed",
};
export const DELETION_IMPACT_UNAVAILABLE: ProblemDefinition = {
  code: "people_unavailable",
  detail: "The person service is temporarily unavailable.",
  status: 503,
  title: "Deletion impact unavailable",
};
export const PERSON_DELETE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Use the current deletion impact preview and exact confirmation.",
  status: 400,
  title: "Invalid deletion request",
};
export const PERSON_NOT_DELETED: ProblemDefinition = {
  code: "people_unavailable",
  detail: "The person service is temporarily unavailable.",
  status: 503,
  title: "Person could not be deleted",
};

export function createLifecycleRoutes(
  services: PersonLifecycleHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services);
  const tokens = {
    browserSecurity: services.browserSecurity,
    tokens: services.apiTokens,
  };
  const origin = cookieWriteOrigin(services.browserSecurity);
  const impactActor = scopedRouteActor(getPersonDeletionImpact, tokens);
  const deleteActor = scopedRouteActor(deletePerson, tokens);

  for (
    const [action, route] of [
      ["archive", archivePerson],
      ["restore", restorePerson],
    ] as const
  ) {
    const transitionActor = scopedRouteActor(route, tokens);
    mount(
      routes,
      route,
      origin,
      session,
      async (context) => {
        const personId = parseValue(uuid, context.req.param("personId"));
        const input = await parseJsonBody(context, personTransitionInput);
        if ("errors" in personId || "errors" in input) {
          return definedProblem(context, LIFECYCLE_REQUEST_INVALID);
        }
        const actor = await transitionActor(context);
        if (actor instanceof Response) return actor;
        const result = await services.people[action](
          actor,
          personId.data,
          input.data,
        ).catch(() => undefined);
        if (!result) return definedProblem(context, PERSON_NOT_CHANGED);
        if (result.status !== "archived" && result.status !== "restored") {
          return lifecycleFailure(context, result);
        }
        context.header("Cache-Control", "private, no-store");
        return context.json({
          person: lifecycleIdentity(result.person),
          status: result.status,
        });
      },
    );
  }

  mount(
    routes,
    getPersonDeletionImpact,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      if ("errors" in personId) {
        return definedProblem(context, PERSON_ID_INVALID);
      }
      const actor = await impactActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.people.previewDeletion(
        actor,
        personId.data,
      ).catch(() => undefined);
      if (!result) return definedProblem(context, DELETION_IMPACT_UNAVAILABLE);
      if (result.status !== "ready") return lifecycleFailure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json({
        impact: {
          confirmation: result.impact.confirmation,
          dependentRecordPolicy: result.impact.dependentRecordPolicy,
          person: lifecycleIdentity(result.impact.person),
        },
        status: "ready",
      });
    },
  );

  mount(
    routes,
    deletePerson,
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const input = await parseJsonBody(context, personDeleteInput);
      if ("errors" in personId || "errors" in input) {
        return definedProblem(context, PERSON_DELETE_INVALID);
      }
      const actor = await deleteActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.people.delete(
        actor,
        personId.data,
        input.data,
      ).catch(() => undefined);
      if (!result) return definedProblem(context, PERSON_NOT_DELETED);
      if (result.status !== "deleted") return lifecycleFailure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json({
        next: "/app/people",
        personId: result.personId,
        status: "deleted",
      });
    },
  );

  return routes;
}
