/**
 * Creating a person and editing the name they are known by.
 *
 * The two routes that write a person's identity and nothing else. Creation is
 * the only one that can warn rather than refuse: a name that already exists
 * in the workspace comes back as a possible duplicate the person may override
 * with `duplicateOverride`, because two people really can share a name.
 *
 * An edit carries the version it was decided against, and a refused edit
 * answers from the identity-and-lifecycle table in `shared.ts`, which the
 * lifecycle transitions answer from too.
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireMatchingOrigin } from "../http/origin.ts";
import { definedProblem, type ProblemDefinition } from "../http/problem.ts";
import { type ActorEnv, requireActor, sessionActor } from "../http/session.ts";
import { parseJsonBody, parseValue } from "../http/validate.ts";
import {
  expectedUpdatedAtSchema,
  identity,
  lifecycleFailure,
  lifecycleIdentity,
  type PeopleHttpServices,
  personIdSchema,
} from "./shared.ts";

/** What creating and renaming a person is served from. */
export type PersonIdentityHttpServices = Pick<
  PeopleHttpServices,
  "browserSecurity" | "people" | "protectedSessions"
>;

const personSchema = z.object({
  duplicateOverride: z.boolean().optional(),
  familyName: z.string().trim().max(200).optional(),
  givenName: z.string().trim().max(200),
  isPartial: z.boolean(),
  middleName: z.string().trim().max(200).optional(),
  nickname: z.string().trim().max(200).optional(),
}).strict();
const editPersonSchema = personSchema.omit({ duplicateOverride: true }).extend({
  expectedUpdatedAt: expectedUpdatedAtSchema,
});

export const PERSON_EDIT_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the identity fields and current version before saving.",
  status: 400,
  title: "Invalid person",
};
export const PERSON_NOT_UPDATED: ProblemDefinition = {
  code: "people_unavailable",
  detail: "The person service is temporarily unavailable.",
  status: 503,
  title: "Person could not be updated",
};
export const PERSON_CREATE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the identity fields and try again.",
  status: 400,
  title: "Invalid person",
};
export const PERSON_NOT_CREATED: ProblemDefinition = {
  code: "people_unavailable",
  detail: "The person service is temporarily unavailable.",
  status: 503,
  title: "Person could not be created",
};
export const PERSON_CREATE_REJECTED: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the highlighted identity fields and try again.",
  status: 400,
  title: "Invalid person",
};
export const PERSON_CREATE_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this change.",
  status: 403,
  title: "Person could not be created",
};

/** The duplicate warning, named for the person it matched. */
export function possibleDuplicate(displayName: string): ProblemDefinition {
  return {
    code: "possible_duplicate",
    detail:
      `A person named ${displayName} already exists in this workspace. Review the match or create anyway.`,
    status: 409,
    title: "Possible duplicate",
  };
}

/** The field message the duplicate warning always carries. */
const DUPLICATE_ERRORS = {
  duplicate: "Confirm Create anyway to keep both people.",
} as const;

export function createIdentityRoutes(
  services: PersonIdentityHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  routes.patch("/api/v1/people/:personId", origin, session, async (context) => {
    const personId = parseValue(personIdSchema, context.req.param("personId"));
    const input = await parseJsonBody(context, editPersonSchema);
    if ("errors" in personId || "errors" in input) {
      return definedProblem(context, PERSON_EDIT_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.people.edit(actor, personId.data, {
      expectedUpdatedAt: input.data.expectedUpdatedAt,
      ...(input.data.familyName ? { familyName: input.data.familyName } : {}),
      givenName: input.data.givenName,
      isPartial: input.data.isPartial,
      ...(input.data.middleName ? { middleName: input.data.middleName } : {}),
      ...(input.data.nickname ? { nickname: input.data.nickname } : {}),
    }).catch(() => undefined);
    if (!result) return definedProblem(context, PERSON_NOT_UPDATED);
    if (result.status !== "updated") return lifecycleFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json({
      person: lifecycleIdentity(result.person),
      status: "updated",
    });
  });

  routes.post("/api/v1/people", origin, session, async (context) => {
    const parsed = await parseJsonBody(context, personSchema);
    if ("errors" in parsed) {
      return definedProblem(context, PERSON_CREATE_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.people.create(actor, {
      ...(parsed.data.duplicateOverride === true
        ? { duplicateOverride: true }
        : {}),
      ...(parsed.data.familyName ? { familyName: parsed.data.familyName } : {}),
      givenName: parsed.data.givenName,
      isPartial: parsed.data.isPartial,
      ...(parsed.data.middleName ? { middleName: parsed.data.middleName } : {}),
      ...(parsed.data.nickname ? { nickname: parsed.data.nickname } : {}),
    }).catch(() => undefined);
    if (!result) return definedProblem(context, PERSON_NOT_CREATED);
    if (result.status === "validation-error") {
      return definedProblem(context, PERSON_CREATE_REJECTED, result.errors);
    }
    if (result.status === "possible-duplicate") {
      return definedProblem(
        context,
        possibleDuplicate(result.duplicates[0]?.displayName ?? "this"),
        DUPLICATE_ERRORS,
      );
    }
    if (result.status === "forbidden") {
      return definedProblem(context, PERSON_CREATE_FORBIDDEN);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      next: `/app/people/${result.person.id}`,
      person: identity(result.person),
      status: "created",
    }, 201);
  });
  return routes;
}
