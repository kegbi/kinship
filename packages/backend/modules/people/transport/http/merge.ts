/**
 * The duplicate review and the merge over HTTP (GAP-049, PEOPLE-008).
 *
 * `GET /api/v1/people/duplicates` is the directory's bounded list of people
 * who look like one another; this file is mounted before `profile.ts`, so the
 * literal keeps winning over `:personId`. `POST /api/v1/people/{primaryId}/merge`
 * folds the duplicate named in the body into the person in the path, against
 * the revisions the member reviewed, only once they confirmed, and answers
 * the person who is left. `GET .../merge-preview` answers what that merge
 * would keep, discard, and move, from the same decision the merge takes. A
 * merge cannot be undone, and nothing here offers to.
 */

import { Hono } from "hono";
import {
  listPeopleDuplicates,
  mergePeople,
  previewPeopleMerge,
  previewPeopleMergeQuery,
} from "../../../../../contracts/routes/people.ts";
import { personMergeInput } from "../../../../../contracts/schemas/people.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import { requireMatchingOrigin } from "../../../../../http-kit/origin.ts";
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
import {
  parseJsonBody,
  parseQuery,
  parseValue,
} from "../../../../../http-kit/validate.ts";
import {
  lifecycleIdentity,
  type PeopleHttpServices,
  withAvatarDescriptor,
} from "./shared.ts";

/** What the duplicate review and the merge are served from. */
export type PersonMergeHttpServices = Pick<
  PeopleHttpServices,
  "browserSecurity" | "duplicates" | "merge" | "protectedSessions"
>;

export const MERGE_REQUEST_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Choose the duplicate to merge by its canonical identifier.",
  status: 400,
  title: "Invalid merge request",
};
export const MERGE_PREVIEW_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Name both people to merge by their canonical identifiers.",
  status: 400,
  title: "Invalid merge preview",
};
export const MERGE_PREVIEW_UNAVAILABLE: ProblemDefinition = {
  code: "people_unavailable",
  detail: "What a merge would change is temporarily unavailable.",
  status: 503,
  title: "Merge preview unavailable",
};
export const PEOPLE_NOT_MERGED: ProblemDefinition = {
  code: "people_unavailable",
  detail: "Nothing was merged. The person service is temporarily unavailable.",
  status: 503,
  title: "People could not be merged",
};
export const DUPLICATES_UNAVAILABLE: ProblemDefinition = {
  code: "people_unavailable",
  detail: "Possible duplicates are temporarily unavailable.",
  status: 503,
  title: "Duplicates unavailable",
};
export const DUPLICATES_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Duplicates unavailable",
};

/** What a refused merge says. */
export const MERGE_FAILURES: FailureTable = {
  fallback: PEOPLE_NOT_MERGED,
  statuses: {
    "archived-write-rejected": {
      code: "archived_write_rejected",
      detail: "Restore both people before merging them.",
      title: "Archived person is read-only",
    },
    "both-members": {
      code: "merge_both_members",
      detail:
        "Both people are workspace members' own records. Merging them would leave one member without theirs, so they cannot be merged.",
      status: 409,
      title: "Both people represent members",
    },
    forbidden: {
      code: "people_forbidden",
      detail: "Your active workspace membership no longer permits this change.",
      title: "People unavailable",
    },
    "conflicts-changed": {
      code: "merge_conflicts_changed",
      detail:
        "What this merge would discard changed since it was reviewed. Review it again before merging.",
      status: 409,
      title: "Merge changed",
    },
    "not-found": {
      code: "person_not_found",
      detail: "Both people must exist in the current workspace to be merged.",
      title: "Person not found",
    },
    "self-merge": {
      code: "merge_self",
      detail: "Choose two different people to merge.",
      status: 400,
      title: "A person cannot be merged into themselves",
    },
    stale: {
      code: "person_stale",
      detail: "One of these people changed. Review them again before merging.",
      status: 409,
      title: "Person changed",
    },
  },
};

const mergeFailure = failureResponder(MERGE_FAILURES);

export function createMergeRoutes(
  services: PersonMergeHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(routes, listPeopleDuplicates, session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.duplicates?.list(actor).catch(() =>
      undefined
    );
    if (!result) return definedProblem(context, DUPLICATES_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, DUPLICATES_FORBIDDEN);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      pairs: result.pairs.map((pair) => ({
        people: pair.people.map(withAvatarDescriptor),
        reasons: pair.reasons,
      })),
      status: "ready",
      truncated: result.truncated,
    });
  });

  mount(routes, previewPeopleMerge, session, async (context) => {
    const primaryId = parseValue(uuid, context.req.param("primaryId"));
    const query = parseQuery(context, previewPeopleMergeQuery);
    if ("errors" in primaryId || "errors" in query) {
      return definedProblem(context, MERGE_PREVIEW_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.merge?.preview(
      actor,
      primaryId.data,
      query.data.duplicateId,
    ).catch(() => undefined);
    if (!result) return definedProblem(context, MERGE_PREVIEW_UNAVAILABLE);
    if (result.status !== "ready") return mergeFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json({
      conflicts: result.conflicts.map(({ discarded, fact, kept }) => ({
        discarded,
        fact,
        kept,
      })),
      conflictsDigest: result.conflictsDigest,
      duplicate: lifecycleIdentity(result.duplicate),
      moves: result.moves,
      primary: lifecycleIdentity(result.primary),
      status: "ready",
    });
  });

  mount(routes, mergePeople, origin, session, async (context) => {
    const primaryId = parseValue(uuid, context.req.param("primaryId"));
    const input = await parseJsonBody(context, personMergeInput);
    if ("errors" in primaryId || "errors" in input) {
      return definedProblem(context, MERGE_REQUEST_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.merge?.merge(actor, primaryId.data, {
      conflictsDigest: input.data.conflictsDigest,
      duplicateId: input.data.duplicateId,
      duplicateRevision: input.data.duplicateRevision,
      primaryRevision: input.data.primaryRevision,
    }).catch(() => undefined);
    if (!result) return definedProblem(context, PEOPLE_NOT_MERGED);
    if (result.status !== "merged") return mergeFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json({
      duplicateId: result.duplicateId,
      moved: result.moved,
      next: `/app/people/${result.person.id}`,
      person: lifecycleIdentity(result.person),
      status: "merged",
    });
  });

  return routes;
}
