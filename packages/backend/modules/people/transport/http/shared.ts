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

import {
  avatarView,
  type BulkPeopleActions,
  type ImportantDateManagement,
  type PeopleManagement,
  type PersonAvatarManagement,
  type PersonAvatarRecord,
  type PersonIdentity,
  type PersonLifecycle,
  type PersonLifecycleRecord,
  type PersonMerge,
  type PersonStarManagement,
  type ProfileFactManagement,
} from "../../public.ts";
import type { PersonProfile } from "../../../../read-models/person-profile/public.ts";
import type { TodayRecentPeople } from "../../../../read-models/today/public.ts";
import type { WorkspaceSearch } from "../../../../read-models/search/public.ts";
import type {
  PeopleDirectory,
  PeopleDuplicates,
  PeopleTagFacet,
  PeopleTagOptions,
} from "../../../../read-models/people-directory/public.ts";
import type {
  createProtectedSessionCoordinator,
  RecentPeopleManagement,
} from "../../../workspaces/public.ts";
import type { BrowserSecurityPolicy } from "../../../../../http-kit/security_policy.ts";
import type { ScopedTokenAuthority } from "../../../../../http-kit/session.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import type { ProblemDefinition } from "../../../../../http-kit/problem.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface PeopleHttpServices {
  /**
   * The API-token authority the directory also accepts. People does not
   * depend on api-access, so the route names the kit's structural port and
   * the composition root hands api-access's facade in.
   */
  readonly apiTokens?: ScopedTokenAuthority<"people:read">;
  /** A person's avatar (GAP-045); without it the avatar routes answer 503. */
  readonly avatars?: PersonAvatarManagement;
  readonly browserSecurity: BrowserSecurityPolicy;
  /** Acting on several people at once (GAP-051); without it, 503. */
  readonly bulk?: Pick<BulkPeopleActions, "run">;
  readonly directory: PeopleDirectory;
  /** The directory's duplicate review (GAP-049); without it, 503. */
  readonly duplicates?: PeopleDuplicates;
  readonly importantDates?: ImportantDateManagement;
  /** Merging two people (GAP-049); without it the merge route answers 503. */
  readonly merge?: Pick<PersonMerge, "merge" | "preview">;
  readonly people: PeopleManagement & PersonLifecycle;
  readonly profileFacts?: ProfileFactManagement;
  readonly profile: PersonProfile;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
  readonly recentPeople?: RecentPeopleManagement;
  /** Workspace search (GAP-048); without it the search route answers 503. */
  readonly search?: WorkspaceSearch;
  /** A person's workspace star (GAP-053); without it the star answers 503. */
  readonly stars?: Pick<PersonStarManagement, "set">;
  /** The directory's tag facet (GAP-053); without it, 503. */
  readonly tagFacet?: PeopleTagFacet;
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

/**
 * The avatar a reader draws a person with (GAP-045): the colour, and the
 * private person-file URL of the image when one backs the avatar.
 */
export function avatarDescriptor(
  personId: string,
  record: PersonAvatarRecord = {},
): { readonly color: string; readonly imageUrl?: string } {
  const view = avatarView(personId, record);
  return {
    color: view.color,
    ...(view.fileId
      ? {
        imageUrl: `/api/v1/people/${personId}/files/${view.fileId}/content`,
      }
      : {}),
  };
}

/**
 * A read model's person with its avatar record presented as the descriptor.
 * A person the read model said nothing about keeps saying nothing.
 */
export function withAvatarDescriptor<
  Person extends {
    readonly avatar?: PersonAvatarRecord;
    readonly id: string;
  },
>(person: Person) {
  const { avatar, ...rest } = person;
  return {
    ...rest,
    ...(avatar ? { avatar: avatarDescriptor(person.id, avatar) } : {}),
  };
}

export function lifecycleIdentity(person: PersonLifecycleRecord) {
  return {
    ...identity(person),
    ...(person.description ? { description: person.description } : {}),
    ...(person.genderOptionId ? { genderOptionId: person.genderOptionId } : {}),
    isDeceased: person.isDeceased,
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
