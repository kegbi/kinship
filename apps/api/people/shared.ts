/**
 * What more than one people concern needs: the bundle, the two presenters a
 * person's identity is written with, and the words a refusal carries.
 *
 * GAP-021 split the people surface into one file per concern, and two things
 * could not follow a single one. The identity presenter is what an edited,
 * archived, previewed, deleted, and newly created person are all answered
 * with, and the refusal table for a person's identity and lifecycle is read by
 * the two concerns that change them.
 *
 * The shapes the six concerns parse with were here too. GAP-022 moved them to
 * `packages/contracts/schemas/people.ts`, where one Zod schema is both what
 * the route validates with and what the published document advertises, so a
 * concern now imports the canonical identifier and the version stamp from
 * there rather than from its neighbour.
 *
 * `PeopleHttpServices` stays whole because `composition.ts` builds one bundle
 * for the mounted surface. Each concern narrows it with `Pick`, so a file can
 * reach only the services its own routes use.
 */

import type {
  ImportantDateManagement,
  PeopleManagement,
  PersonIdentity,
  PersonLifecycle,
  PersonLifecycleRecord,
  ProfileFactManagement,
} from "../../../packages/backend/modules/people/public.ts";
import type { PersonProfile } from "../../../packages/backend/read-models/person-profile/public.ts";
import type { TodayRecentPeople } from "../../../packages/backend/read-models/today/public.ts";
import type {
  PeopleDirectory,
  PeopleTagOptions,
} from "../../../packages/backend/read-models/people-directory/public.ts";
import type {
  createProtectedSessionCoordinator,
  RecentPeopleManagement,
} from "../../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "../security_config.ts";
import type { ApiTokenManagement } from "../../../packages/backend/modules/api-access/public.ts";
import { failureResponder, type FailureTable } from "../http/failures.ts";
import type { ProblemDefinition } from "../http/problem.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface PeopleHttpServices {
  readonly apiTokens?: Pick<ApiTokenManagement, "authenticate">;
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly directory: PeopleDirectory;
  readonly importantDates?: ImportantDateManagement;
  readonly people: PeopleManagement & PersonLifecycle;
  readonly profileFacts?: ProfileFactManagement;
  readonly profile: PersonProfile;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
  readonly recentPeople?: RecentPeopleManagement;
  readonly tagOptions: PeopleTagOptions;
  readonly todayRecentPeople?: TodayRecentPeople;
}

export function identity(person: PersonIdentity) {
  return {
    ...(person.familyName ? { familyName: person.familyName } : {}),
    givenName: person.givenName,
    id: person.id,
    isPartial: person.isPartial,
    ...(person.middleName ? { middleName: person.middleName } : {}),
    ...(person.nickname ? { nickname: person.nickname } : {}),
  };
}

export function lifecycleIdentity(person: PersonLifecycleRecord) {
  return {
    ...identity(person),
    lifecycle: person.lifecycle,
    updatedAt: person.updatedAt,
  };
}

/** What a refused change to a person's identity or lifecycle says. */
export const PERSON_LIFECYCLE_FAILURES: FailureTable = {
  fallback: {
    code: "validation_failed",
    detail: "Review the highlighted identity fields and try again.",
    status: 400,
    title: "Invalid person",
  },
  statuses: {
    "archived-write-rejected": {
      code: "archived_write_rejected",
      detail: "Restore this person before editing their identity.",
      title: "Archived person is read-only",
    },
    "confirmation-required": {
      code: "confirmation_required",
      detail:
        "Enter the exact confirmation shown in the deletion impact preview.",
      status: 400,
      title: "Confirmation required",
    },
    forbidden: {
      code: "people_forbidden",
      detail: "Your active workspace membership no longer permits this change.",
      title: "Person unavailable",
    },
    "not-found": {
      code: "person_not_found",
      detail: "No person with this identifier exists in the current workspace.",
      title: "Person not found",
    },
    stale: {
      code: "person_stale",
      detail: "Refresh this person before trying the lifecycle action again.",
      status: 409,
      title: "Person changed",
    },
  },
};

export const lifecycleFailure = failureResponder(PERSON_LIFECYCLE_FAILURES);

export const PERSON_ID_INVALID: ProblemDefinition = {
  code: "person_id_invalid",
  detail: "Use a valid canonical person identifier.",
  status: 400,
  title: "Invalid person",
};
export const PERSON_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Person unavailable",
};
