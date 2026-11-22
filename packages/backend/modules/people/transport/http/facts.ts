/**
 * The seven profile sections of a person's page, read and written.
 *
 * One list, one create, one update, and one delete, each parameterised by the
 * section, so a new section is a schema rather than four more routes. Every
 * write carries the person's version as well as the fact's, because a fact
 * belongs to a person whose page may have moved on.
 *
 * A refused profile-fact write is its own vocabulary — a hidden section, a
 * reference to an option that is no longer active, a stale fact — and says so
 * rather than borrowing the person's words.
 */

import { Hono } from "hono";
import type {
  ProfileFactCreateInput,
  ProfileFactUpdateInput,
} from "../../public.ts";
import {
  createProfileFact,
  deleteProfileFact,
  listProfileFacts,
  listProfileFactsQuery,
  updateProfileFact,
} from "../../../../../contracts/routes/people.ts";
import {
  profileFactDeleteInput,
  profileFactSectionId,
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
import {
  parseJsonBody,
  parseQuery,
  parseValue,
} from "../../../../../http-kit/validate.ts";
import {
  profileFactCreateSchemas,
  profileFactUpdateSchemas,
  publicProfileFact,
} from "./fact_schemas.ts";
import type { PeopleHttpServices } from "./shared.ts";

/** What the profile sections of a person's page are served from. */
export type ProfileFactHttpServices = Pick<
  PeopleHttpServices,
  "apiTokens" | "browserSecurity" | "profileFacts" | "protectedSessions"
>;

/** What a refused profile-fact write says. */
export const PROFILE_FACT_FAILURES: FailureTable = {
  fallback: {
    code: "validation_failed",
    detail: "Review the highlighted profile fields.",
    status: 400,
    title: "Invalid profile fact",
  },
  statuses: {
    "archived-write-rejected": {
      code: "archived_write_rejected",
      detail: "Restore this person before changing profile facts.",
      title: "Archived person is read-only",
    },
    forbidden: {
      code: "people_forbidden",
      detail: "Your active workspace membership no longer permits this change.",
      title: "Profile facts unavailable",
    },
    hidden: {
      code: "profile_section_hidden",
      detail:
        "An administrator disabled this section. Saved data was retained.",
      status: 409,
      title: "Profile section hidden",
    },
    "invalid-reference": {
      code: "profile_fact_reference_invalid",
      detail: "Select an active option from the current workspace.",
      status: 400,
      title: "Profile option unavailable",
    },
    "not-found": {
      code: "person_fact_not_found",
      detail:
        "The person or profile fact does not exist in the active workspace.",
      title: "Profile fact not found",
    },
    stale: {
      code: "profile_fact_stale",
      detail: "Refresh this section before trying again.",
      status: 409,
      title: "Profile fact changed",
    },
  },
};

export const factFailure = failureResponder(PROFILE_FACT_FAILURES);

export const PROFILE_SECTION_INVALID: ProblemDefinition = {
  code: "profile_fact_request_invalid",
  detail: "Use a supported section and canonical person identifier.",
  status: 400,
  title: "Invalid profile section",
};
export const PROFILE_FACTS_UNAVAILABLE: ProblemDefinition = {
  code: "profile_facts_unavailable",
  detail: "This profile section is temporarily unavailable.",
  status: 503,
  title: "Profile facts unavailable",
};
export const PROFILE_FACTS_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Profile facts unavailable",
};
export const WORKSPACE_PERSON_NOT_FOUND: ProblemDefinition = {
  code: "person_not_found",
  detail: "No person with this identifier exists in the active workspace.",
  status: 404,
  title: "Person not found",
};
export const PROFILE_FACT_CURSOR_STALE: ProblemDefinition = {
  code: "profile_fact_cursor_stale",
  detail: "Restart this profile section before loading more facts.",
  status: 409,
  title: "Profile section changed",
};
export const PROFILE_FACT_CREATE_INVALID: ProblemDefinition = {
  code: "profile_fact_request_invalid",
  detail: "Use a supported section and canonical person identifier.",
  status: 400,
  title: "Invalid profile fact",
};
export const PROFILE_FACT_BODY_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the fields for this profile section.",
  status: 400,
  title: "Invalid profile fact",
};
export const PROFILE_FACT_NOT_SAVED: ProblemDefinition = {
  code: "profile_facts_unavailable",
  detail: "This profile section is temporarily unavailable.",
  status: 503,
  title: "Profile fact could not be saved",
};
export const PROFILE_FACT_UPDATE_INVALID: ProblemDefinition = {
  code: "profile_fact_request_invalid",
  detail: "Use supported canonical profile identifiers.",
  status: 400,
  title: "Invalid profile fact",
};
export const PROFILE_FACT_VERSION_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the identifiers and current version for this profile fact.",
  status: 400,
  title: "Invalid profile fact",
};
export const PROFILE_FACT_DELETE_INVALID: ProblemDefinition = {
  code: "profile_fact_request_invalid",
  detail: "Use current canonical profile identifiers.",
  status: 400,
  title: "Invalid profile fact",
};
export const PROFILE_FACT_NOT_DELETED: ProblemDefinition = {
  code: "profile_facts_unavailable",
  detail: "This profile section is temporarily unavailable.",
  status: 503,
  title: "Profile fact could not be deleted",
};

export function createFactsRoutes(
  services: ProfileFactHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services);
  const tokens = {
    browserSecurity: services.browserSecurity,
    tokens: services.apiTokens,
  };
  const factsActor = scopedRouteActor(listProfileFacts, tokens);
  const createActor = scopedRouteActor(createProfileFact, tokens);
  const updateActor = scopedRouteActor(updateProfileFact, tokens);
  const deleteActor = scopedRouteActor(deleteProfileFact, tokens);
  const origin = requireCookieWriteOrigin(services.browserSecurity);

  mount(
    routes,
    listProfileFacts,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const section = parseValue(
        profileFactSectionId,
        context.req.param("section"),
      );
      const query = parseQuery(context, listProfileFactsQuery);
      if (
        "errors" in personId || "errors" in section || "errors" in query
      ) return definedProblem(context, PROFILE_SECTION_INVALID);
      const actor = await factsActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.profileFacts?.list(
        actor,
        personId.data,
        section.data,
        {
          ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
          ...(query.data.includeOptions ? { includeOptions: true } : {}),
          ...(query.data.optionCursor
            ? { optionCursor: query.data.optionCursor }
            : {}),
          ...(query.data.optionSearch
            ? { optionSearch: query.data.optionSearch }
            : {}),
        },
      ).catch(() => undefined);
      if (!result) return definedProblem(context, PROFILE_FACTS_UNAVAILABLE);
      if (result.status === "forbidden") {
        return definedProblem(context, PROFILE_FACTS_FORBIDDEN);
      }
      if (result.status === "not-found") {
        return definedProblem(context, WORKSPACE_PERSON_NOT_FOUND);
      }
      if (result.status === "stale-cursor" || !("records" in result)) {
        return definedProblem(context, PROFILE_FACT_CURSOR_STALE);
      }
      context.header("Cache-Control", "private, no-store");
      return context.json({
        ...result,
        records: result.records.map(publicProfileFact),
      });
    },
  );

  mount(
    routes,
    createProfileFact,
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const section = parseValue(
        profileFactSectionId,
        context.req.param("section"),
      );
      if ("errors" in personId || "errors" in section) {
        return definedProblem(context, PROFILE_FACT_CREATE_INVALID);
      }
      const input = await parseJsonBody(
        context,
        profileFactCreateSchemas[section.data],
      );
      if ("errors" in input || input.data.section !== section.data) {
        return definedProblem(context, PROFILE_FACT_BODY_INVALID);
      }
      const actor = await createActor(context);
      if (actor instanceof Response) return actor;
      const { section: _inputSection, ...factInput } = input.data;
      const result = await services.profileFacts?.create(
        actor,
        personId.data,
        section.data,
        factInput as unknown as ProfileFactCreateInput,
      ).catch(() => undefined);
      if (!result) return definedProblem(context, PROFILE_FACT_NOT_SAVED);
      if (result.status !== "saved") return factFailure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json({
        ...result,
        record: publicProfileFact(result.record),
      });
    },
  );

  mount(
    routes,
    updateProfileFact,
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const factId = parseValue(uuid, context.req.param("factId"));
      const section = parseValue(
        profileFactSectionId,
        context.req.param("section"),
      );
      if (
        "errors" in personId || "errors" in factId || "errors" in section
      ) return definedProblem(context, PROFILE_FACT_UPDATE_INVALID);
      const input = await parseJsonBody(
        context,
        profileFactUpdateSchemas[section.data],
      );
      if (
        "errors" in input || input.data.section !== section.data ||
        input.data.id !== factId.data
      ) return definedProblem(context, PROFILE_FACT_VERSION_INVALID);
      const actor = await updateActor(context);
      if (actor instanceof Response) return actor;
      const { section: _inputSection, ...factInput } = input.data;
      const result = await services.profileFacts?.update(
        actor,
        personId.data,
        section.data,
        factInput as unknown as ProfileFactUpdateInput,
      ).catch(() => undefined);
      if (!result) return definedProblem(context, PROFILE_FACT_NOT_SAVED);
      if (result.status !== "saved") return factFailure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json({
        ...result,
        record: publicProfileFact(result.record),
      });
    },
  );

  mount(
    routes,
    deleteProfileFact,
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const factId = parseValue(uuid, context.req.param("factId"));
      const section = parseValue(
        profileFactSectionId,
        context.req.param("section"),
      );
      const input = await parseJsonBody(context, profileFactDeleteInput);
      if (
        "errors" in personId || "errors" in factId || "errors" in section ||
        "errors" in input || input.data.section !== section.data
      ) return definedProblem(context, PROFILE_FACT_DELETE_INVALID);
      const actor = await deleteActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.profileFacts?.delete(
        actor,
        personId.data,
        section.data,
        factId.data,
        input.data.expectedUpdatedAt,
        input.data.expectedPersonUpdatedAt,
      ).catch(() => undefined);
      if (!result) return definedProblem(context, PROFILE_FACT_NOT_DELETED);
      if (result.status !== "deleted") return factFailure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  return routes;
}
