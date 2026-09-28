/**
 * People over HTTP: the nine concerns of a person, mounted as one surface.
 *
 * This was the widest file in the API — twenty-one routes over five surfaces
 * in fifteen hundred lines — and GAP-021 split it into one file per concern:
 * the directory a person is found in, the page they are read on, the profile
 * facts and important dates that page holds, the identity they are created
 * and renamed with, and the lifecycle that archives and deletes them. The
 * avatar they are drawn with (GAP-045) joined as the seventh, and the
 * workspace search that grew out of the directory (GAP-048) as the eighth, and
 * duplicate review and merge (GAP-049) as the ninth, mounted before the page
 * so `duplicates` stays a literal, bulk directory actions (GAP-051) as the
 * tenth, and the workspace star (GAP-053) as the eleventh. What
 * more than one concern needs lives in `people/shared.ts`.
 *
 * The mounted order is the registration order, and it is contract: Hono
 * matches in the order routes were added, so `GET /api/v1/people/tag-options`
 * must keep being registered before `GET /api/v1/people/:personId` or the
 * literal is swallowed by the parameter. `directory.ts` is therefore mounted
 * before `profile.ts`, and `people/routes_test.ts` requests both paths to
 * prove it.
 *
 * `PEOPLE_PROBLEMS` is still one list, in one order, because the pinning
 * suite reads it as the whole surface's vocabulary. Each concern names its
 * own refusals; this file only gathers them.
 */

import { Hono } from "hono";
import type { ActorEnv } from "../../../../../http-kit/session.ts";
import type { ProblemDefinition } from "../../../../../http-kit/problem.ts";
import {
  createDirectoryRoutes,
  PEOPLE_CURSOR_STALE,
  PEOPLE_FORBIDDEN,
  PEOPLE_QUERY_INVALID,
  PEOPLE_UNAVAILABLE,
  PERSON_VIEW_INVALID,
  PERSON_VIEW_NOT_FOUND,
  PERSON_VIEW_NOT_RECORDED,
  PERSON_VIEW_UNRESOLVED,
  RECENT_PEOPLE_FORBIDDEN,
  RECENT_PEOPLE_UNAVAILABLE,
  TAG_FACET_FORBIDDEN,
  TAG_FACET_QUERY_INVALID,
  TAG_FACET_UNAVAILABLE,
  TAG_OPTIONS_CURSOR_INVALID,
  TAG_OPTIONS_FORBIDDEN,
  TAG_OPTIONS_QUERY_INVALID,
  TAG_OPTIONS_UNAVAILABLE,
} from "./directory.ts";
import {
  ACTIVE_PERSON_NOT_FOUND,
  createProfileRoutes,
  LIFE_EVENTS_FORBIDDEN,
  LIFE_EVENTS_UNAVAILABLE,
  PERSON_QUERY_INVALID,
  PERSON_UNAVAILABLE,
  TIMELINE_CURSOR_STALE,
  TIMELINE_FORBIDDEN,
  TIMELINE_NOT_FOUND,
  TIMELINE_QUERY_INVALID,
  TIMELINE_SESSION_INVALID,
  TIMELINE_UNAVAILABLE,
} from "./profile.ts";
import {
  createFactsRoutes,
  PROFILE_FACT_BODY_INVALID,
  PROFILE_FACT_CREATE_INVALID,
  PROFILE_FACT_CURSOR_STALE,
  PROFILE_FACT_DELETE_INVALID,
  PROFILE_FACT_NOT_DELETED,
  PROFILE_FACT_NOT_SAVED,
  PROFILE_FACT_UPDATE_INVALID,
  PROFILE_FACT_VERSION_INVALID,
  PROFILE_FACTS_FORBIDDEN,
  PROFILE_FACTS_UNAVAILABLE,
  PROFILE_SECTION_INVALID,
  WORKSPACE_PERSON_NOT_FOUND,
} from "./facts.ts";
import {
  createDatesRoutes,
  CURRENT_PERSON_NOT_FOUND,
  IMPORTANT_DATE_CREATE_INVALID,
  IMPORTANT_DATE_DELETE_INVALID,
  IMPORTANT_DATE_NOT_DELETED,
  IMPORTANT_DATE_NOT_SAVED,
  IMPORTANT_DATE_UPDATE_INVALID,
  IMPORTANT_DATES_FORBIDDEN,
  IMPORTANT_DATES_UNAVAILABLE,
} from "./dates.ts";
import {
  createIdentityRoutes,
  PERSON_CREATE_FORBIDDEN,
  PERSON_CREATE_INVALID,
  PERSON_CREATE_REJECTED,
  PERSON_EDIT_INVALID,
  PERSON_NOT_CREATED,
  PERSON_NOT_UPDATED,
} from "./identity.ts";
import {
  createLifecycleRoutes,
  DELETION_IMPACT_UNAVAILABLE,
  LIFECYCLE_REQUEST_INVALID,
  PERSON_DELETE_INVALID,
  PERSON_NOT_CHANGED,
  PERSON_NOT_DELETED,
} from "./lifecycle.ts";
import { createAvatarRoutes } from "./avatar.ts";
import { createStarRoutes } from "./star.ts";
import {
  createBulkRoutes,
  PEOPLE_BULK_FORBIDDEN,
  PEOPLE_BULK_INVALID,
  PEOPLE_BULK_TAG_INVALID,
  PEOPLE_BULK_UNAVAILABLE,
} from "./bulk.ts";
import {
  createSearchRoutes,
  SEARCH_FORBIDDEN,
  SEARCH_QUERY_INVALID,
  SEARCH_UNAVAILABLE,
} from "./search.ts";
import {
  createMergeRoutes,
  DUPLICATE_DISMISSAL_INVALID,
  DUPLICATES_FORBIDDEN,
  DUPLICATES_UNAVAILABLE,
  MERGE_PREVIEW_INVALID,
  MERGE_PREVIEW_UNAVAILABLE,
  MERGE_REQUEST_INVALID,
  PEOPLE_NOT_MERGED,
} from "./merge.ts";
import {
  type PeopleHttpServices,
  PERSON_FORBIDDEN,
  PERSON_ID_INVALID,
} from "./shared.ts";

export type { PeopleHttpServices } from "./shared.ts";
export { PERSON_LIFECYCLE_FAILURES } from "./shared.ts";
export { AVATAR_FAILURES } from "./avatar.ts";
export { STAR_FAILURES } from "./star.ts";
export { DUPLICATE_DISMISSAL_FAILURES, MERGE_FAILURES } from "./merge.ts";
export { IMPORTANT_DATE_FAILURES } from "./dates.ts";
export { PROFILE_FACT_FAILURES } from "./facts.ts";
export { possibleDuplicate } from "./identity.ts";

/** Every problem the people surface answers on its own, for the pinning suite. */
export const PEOPLE_PROBLEMS: readonly ProblemDefinition[] = [
  ACTIVE_PERSON_NOT_FOUND,
  CURRENT_PERSON_NOT_FOUND,
  DELETION_IMPACT_UNAVAILABLE,
  DUPLICATE_DISMISSAL_INVALID,
  DUPLICATES_FORBIDDEN,
  DUPLICATES_UNAVAILABLE,
  IMPORTANT_DATE_CREATE_INVALID,
  IMPORTANT_DATE_DELETE_INVALID,
  IMPORTANT_DATE_NOT_DELETED,
  IMPORTANT_DATE_NOT_SAVED,
  IMPORTANT_DATE_UPDATE_INVALID,
  IMPORTANT_DATES_FORBIDDEN,
  IMPORTANT_DATES_UNAVAILABLE,
  LIFE_EVENTS_FORBIDDEN,
  LIFE_EVENTS_UNAVAILABLE,
  LIFECYCLE_REQUEST_INVALID,
  MERGE_PREVIEW_INVALID,
  MERGE_PREVIEW_UNAVAILABLE,
  MERGE_REQUEST_INVALID,
  PEOPLE_BULK_FORBIDDEN,
  PEOPLE_BULK_INVALID,
  PEOPLE_BULK_TAG_INVALID,
  PEOPLE_BULK_UNAVAILABLE,
  PEOPLE_CURSOR_STALE,
  PEOPLE_FORBIDDEN,
  PEOPLE_NOT_MERGED,
  PEOPLE_QUERY_INVALID,
  PEOPLE_UNAVAILABLE,
  PERSON_CREATE_FORBIDDEN,
  PERSON_CREATE_INVALID,
  PERSON_CREATE_REJECTED,
  PERSON_DELETE_INVALID,
  PERSON_EDIT_INVALID,
  PERSON_FORBIDDEN,
  PERSON_ID_INVALID,
  PERSON_NOT_CHANGED,
  PERSON_NOT_CREATED,
  PERSON_NOT_DELETED,
  PERSON_NOT_UPDATED,
  PERSON_QUERY_INVALID,
  PERSON_UNAVAILABLE,
  PERSON_VIEW_INVALID,
  PERSON_VIEW_NOT_FOUND,
  PERSON_VIEW_NOT_RECORDED,
  PERSON_VIEW_UNRESOLVED,
  PROFILE_FACT_BODY_INVALID,
  PROFILE_FACT_CREATE_INVALID,
  PROFILE_FACT_CURSOR_STALE,
  PROFILE_FACT_DELETE_INVALID,
  PROFILE_FACT_NOT_DELETED,
  PROFILE_FACT_NOT_SAVED,
  PROFILE_FACT_UPDATE_INVALID,
  PROFILE_FACT_VERSION_INVALID,
  PROFILE_FACTS_FORBIDDEN,
  PROFILE_FACTS_UNAVAILABLE,
  PROFILE_SECTION_INVALID,
  RECENT_PEOPLE_FORBIDDEN,
  RECENT_PEOPLE_UNAVAILABLE,
  SEARCH_FORBIDDEN,
  SEARCH_QUERY_INVALID,
  SEARCH_UNAVAILABLE,
  TAG_FACET_FORBIDDEN,
  TAG_FACET_QUERY_INVALID,
  TAG_FACET_UNAVAILABLE,
  TAG_OPTIONS_CURSOR_INVALID,
  TAG_OPTIONS_FORBIDDEN,
  TAG_OPTIONS_QUERY_INVALID,
  TAG_OPTIONS_UNAVAILABLE,
  TIMELINE_CURSOR_STALE,
  TIMELINE_FORBIDDEN,
  TIMELINE_NOT_FOUND,
  TIMELINE_QUERY_INVALID,
  TIMELINE_SESSION_INVALID,
  TIMELINE_UNAVAILABLE,
  WORKSPACE_PERSON_NOT_FOUND,
];

export function createPeopleRoutes(
  services: PeopleHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  routes.route("/", createDirectoryRoutes(services));
  routes.route("/", createMergeRoutes(services));
  routes.route("/", createBulkRoutes(services));
  routes.route("/", createProfileRoutes(services));
  routes.route("/", createFactsRoutes(services));
  routes.route("/", createDatesRoutes(services));
  routes.route("/", createIdentityRoutes(services));
  routes.route("/", createLifecycleRoutes(services));
  routes.route("/", createAvatarRoutes(services));
  routes.route("/", createStarRoutes(services));
  routes.route("/", createSearchRoutes(services));
  return routes;
}
