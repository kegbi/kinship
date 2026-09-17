/**
 * People over HTTP: the directory, one person, their dates, and their facts.
 *
 * The widest file in the API — twenty-one routes over five surfaces — and the
 * one with the most to say when something is unavailable, because a person's
 * page degrades section by section. The problem responder, the session cookie,
 * the origin check, and the kernel status map came from `http/` (GAP-019,
 * GAP-020).
 *
 * The directory is the one route that accepts an API token as well as a
 * session cookie, which is what `tokenOrSessionActor` is for: an
 * `Authorization` header commits the request to the token path with the
 * `people:read` scope, so a token that lacks it is nobody rather than a silent
 * fall back onto whatever cookie the same request happened to carry.
 *
 * Three failure tables rather than one. A refused important date, a refused
 * profile fact, and a refused lifecycle action are three different things to a
 * person looking at the page, and each names what it is about.
 */

import { Hono } from "hono";
import { z } from "zod";
import type {
  ImportantDateManagement,
  ImportantDateRecord,
  PeopleManagement,
  PersonIdentity,
  PersonLifecycle,
  PersonLifecycleRecord,
  ProfileFactCreateInput,
  ProfileFactManagement,
  ProfileFactRecord,
  ProfileFactUpdateInput,
} from "../../packages/backend/modules/people/public.ts";
import type { PersonProfile } from "../../packages/backend/read-models/person-profile/public.ts";
import type { TodayRecentPeople } from "../../packages/backend/read-models/today/public.ts";
import type {
  PeopleDirectory,
  PeopleTagOptions,
} from "../../packages/backend/read-models/people-directory/public.ts";
import type {
  createProtectedSessionCoordinator,
  RecentPeopleManagement,
} from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";
import type { ApiTokenManagement } from "../../packages/backend/modules/api-access/public.ts";
import { failureResponder, type FailureTable } from "./http/failures.ts";
import { requireMatchingOrigin } from "./http/origin.ts";
import { definedProblem, type ProblemDefinition } from "./http/problem.ts";
import {
  type ActorEnv,
  requireActor,
  SESSION_INVALID,
  sessionActor,
  tokenOrSessionActor,
} from "./http/session.ts";
import { parseJsonBody, parseQuery, parseValue } from "./http/validate.ts";

/** The scope an API token needs to read the people directory. */
const DIRECTORY_SCOPE = "people:read";

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

const personSchema = z.object({
  duplicateOverride: z.boolean().optional(),
  familyName: z.string().trim().max(200).optional(),
  givenName: z.string().trim().max(200),
  isPartial: z.boolean(),
  middleName: z.string().trim().max(200).optional(),
  nickname: z.string().trim().max(200).optional(),
}).strict();
const personIdSchema = z.uuid();
const personReadQuerySchema = z.object({
  include: z.literal("summary").optional(),
}).strict();
const personTimelineQuerySchema = z.object({
  cursor: z.string().max(2_000).optional(),
  kind: z.enum([
    "activity",
    "call",
    "conversation",
    "life-event",
    "note",
  ]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
const expectedUpdatedAtSchema = z.iso.datetime({ offset: true });
const editPersonSchema = personSchema.omit({ duplicateOverride: true }).extend({
  expectedUpdatedAt: expectedUpdatedAtSchema,
});
const transitionSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
}).strict();
const deletePersonSchema = transitionSchema.extend({
  confirmation: z.string().min(1).max(500),
});
const importantDateValueSchema = z.object({
  day: z.number().int().min(1).max(31).optional(),
  isAgeBased: z.boolean(),
  isYearApproximate: z.boolean(),
  kind: z.enum(["birthday", "custom", "deceased", "first_met"]),
  label: z.string().trim().max(200).optional(),
  month: z.number().int().min(1).max(12).optional(),
  notes: z.string().trim().max(2_000).optional(),
  precision: z.enum([
    "day",
    "full",
    "month",
    "month_day",
    "unknown",
    "year",
    "year_month",
  ]),
  year: z.number().int().min(1).max(9999).optional(),
}).strict();
const importantDateUpdateSchema = importantDateValueSchema.extend({
  expectedUpdatedAt: expectedUpdatedAtSchema,
});
const importantDateDeleteSchema = transitionSchema;
const profileFactSectionSchema = z.enum([
  "addresses",
  "contact-methods",
  "first-meeting",
  "food-preferences",
  "pets",
  "tags",
  "work",
]);
const profileFactListQuerySchema = z.object({
  cursor: z.string().max(2_000).optional(),
  includeOptions: z.enum(["true"]).optional(),
  optionCursor: z.string().max(2_000).optional(),
  optionSearch: z.string().trim().max(200).optional(),
}).strict().superRefine((query, context) => {
  if (query.optionCursor && query.includeOptions !== "true") {
    context.addIssue({
      code: "custom",
      message: "Option continuation requires includeOptions=true.",
      path: ["optionCursor"],
    });
  }
});
const optionalText = z.string().trim().max(2_000).optional();
const profileFactCreateBaseSchema = z.object({
  expectedPersonUpdatedAt: expectedUpdatedAtSchema,
});
const profileFactUpdateBaseSchema = profileFactCreateBaseSchema.extend({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  id: z.uuid(),
});
const profileFactSchemas = (profileFactBaseSchema: z.ZodObject) => ({
  addresses: profileFactBaseSchema.extend({
    city: z.string().trim().max(200).optional(),
    country: z.string().trim().max(200).optional(),
    displayName: z.string().trim().max(200).optional(),
    isPrimary: z.boolean(),
    labelIds: z.array(z.uuid()).max(20),
    postalCode: z.string().trim().max(50).optional(),
    region: z.string().trim().max(200).optional(),
    section: z.literal("addresses"),
    street: z.string().trim().max(500).optional(),
  }).strict().refine((value) =>
    Boolean(
      value.city || value.country || value.displayName || value.postalCode ||
        value.region || value.street,
    ), { message: "Enter an address detail." }),
  "contact-methods": profileFactBaseSchema.extend({
    isPrimary: z.boolean(),
    labelIds: z.array(z.uuid()).max(20),
    notes: optionalText,
    section: z.literal("contact-methods"),
    typeId: z.uuid(),
    value: z.string().trim().min(1).max(2_000),
  }).strict(),
  "first-meeting": profileFactBaseSchema.extend({
    introducedByPersonId: z.uuid().optional(),
    notes: optionalText,
    placeText: z.string().trim().max(500).optional(),
    section: z.literal("first-meeting"),
  }).strict().refine(
    (value) =>
      Boolean(value.introducedByPersonId || value.notes || value.placeText),
    { message: "Enter first-meeting context." },
  ),
  "food-preferences": profileFactBaseSchema.extend({
    foodPreferences: z.string().trim().min(1).max(2_000),
    section: z.literal("food-preferences"),
  }).strict(),
  pets: profileFactBaseSchema.extend({
    categoryId: z.uuid().optional(),
    name: z.string().trim().max(200).optional(),
    notes: optionalText,
    section: z.literal("pets"),
  }).strict().refine(
    (value) => Boolean(value.categoryId || value.name),
    {
      message: "Enter a pet detail.",
    },
  ),
  tags: profileFactBaseSchema.extend({
    section: z.literal("tags"),
    tagIds: z.array(z.uuid()).max(500),
  }).strict(),
  work: profileFactBaseSchema.extend({
    description: optionalText,
    endOn: z.iso.date().optional(),
    isCurrent: z.boolean(),
    organizationId: z.uuid().optional(),
    organizationName: z.string().trim().max(200).optional(),
    section: z.literal("work"),
    startOn: z.iso.date().optional(),
    title: z.string().trim().min(1).max(200),
  }).strict(),
} as const);
const profileFactCreateSchemas = profileFactSchemas(
  profileFactCreateBaseSchema,
);
const profileFactUpdateSchemas = profileFactSchemas(
  profileFactUpdateBaseSchema,
);
const profileFactDeleteSchema = z.object({
  expectedPersonUpdatedAt: expectedUpdatedAtSchema,
  expectedUpdatedAt: expectedUpdatedAtSchema,
  section: profileFactSectionSchema,
}).strict();

function publicProfileFact(record: ProfileFactRecord) {
  return { ...record, value: { section: record.section, ...record.value } };
}

function importantDateInput(input: z.infer<typeof importantDateValueSchema>) {
  return {
    ...(input.day === undefined ? {} : { day: input.day }),
    isAgeBased: input.isAgeBased,
    isYearApproximate: input.isYearApproximate,
    kind: input.kind,
    ...(input.label ? { label: input.label } : {}),
    ...(input.month === undefined ? {} : { month: input.month }),
    ...(input.notes ? { notes: input.notes } : {}),
    precision: input.precision,
    ...(input.year === undefined ? {} : { year: input.year }),
  };
}
const directoryQuerySchema = z.object({
  cursor: z.string().max(2_000).optional(),
  excludePersonId: z.uuid().optional(),
  lifecycle: z.enum(["active", "archived"]).default("active"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(200).optional(),
  selectedPersonId: z.uuid().optional(),
  sort: z.enum(["given-name", "family-name", "recently-added"]).default(
    "given-name",
  ),
  tag: z.uuid().optional(),
}).strict();
const tagOptionsQuerySchema = z.object({
  cursor: z.string().max(2_000).optional(),
  search: z.string().trim().max(200).optional(),
  selected: z.uuid().optional(),
}).strict();

function identity(person: PersonIdentity) {
  return {
    ...(person.familyName ? { familyName: person.familyName } : {}),
    givenName: person.givenName,
    id: person.id,
    isPartial: person.isPartial,
    ...(person.middleName ? { middleName: person.middleName } : {}),
    ...(person.nickname ? { nickname: person.nickname } : {}),
  };
}

function lifecycleIdentity(person: PersonLifecycleRecord) {
  return {
    ...identity(person),
    lifecycle: person.lifecycle,
    updatedAt: person.updatedAt,
  };
}

function importantDate(date: ImportantDateRecord) {
  return {
    ...(date.day === undefined ? {} : { day: date.day }),
    createdAt: date.createdAt,
    id: date.id,
    isAgeBased: date.isAgeBased,
    isYearApproximate: date.isYearApproximate,
    kind: date.kind,
    ...(date.label ? { label: date.label } : {}),
    ...(date.month === undefined ? {} : { month: date.month }),
    ...(date.notes ? { notes: date.notes } : {}),
    personId: date.personId,
    precision: date.precision,
    scheduling: date.scheduling,
    updatedAt: date.updatedAt,
    ...(date.year === undefined ? {} : { year: date.year }),
  };
}

/** What a refused important-date write says. */
export const IMPORTANT_DATE_FAILURES: FailureTable = {
  fallback: {
    code: "validation_failed",
    detail: "Use only the components declared by the selected precision.",
    status: 400,
    title: "Invalid important date",
  },
  statuses: {
    "archived-write-rejected": {
      code: "archived_write_rejected",
      detail: "Restore this person before changing important dates.",
      title: "Archived person is read-only",
    },
    conflict: {
      code: "person_date_conflict",
      detail:
        "Birthday, first meeting, and date of death can each be recorded once.",
      title: "Important date already exists",
    },
    forbidden: {
      code: "people_forbidden",
      detail: "Your active workspace membership no longer permits this change.",
      title: "Important dates unavailable",
    },
    "not-found": {
      code: "person_date_not_found",
      detail:
        "The person or important date does not exist in the active workspace.",
      title: "Important date not found",
    },
    stale: {
      code: "person_date_stale",
      detail: "Refresh the important dates before trying again.",
      status: 409,
      title: "Important date changed",
    },
  },
};

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

const dateFailure = failureResponder(IMPORTANT_DATE_FAILURES);
const factFailure = failureResponder(PROFILE_FACT_FAILURES);
const lifecycleFailure = failureResponder(PERSON_LIFECYCLE_FAILURES);

const PEOPLE_QUERY_INVALID: ProblemDefinition = {
  code: "people_query_invalid",
  detail: "Review the search, tag, sort, lifecycle, and pagination criteria.",
  status: 400,
  title: "Invalid people query",
};
const PEOPLE_UNAVAILABLE: ProblemDefinition = {
  code: "people_unavailable",
  detail: "The people directory is temporarily unavailable.",
  status: 503,
  title: "People unavailable",
};
const PEOPLE_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "People unavailable",
};
const PEOPLE_CURSOR_STALE: ProblemDefinition = {
  code: "stale_cursor",
  detail: "Refresh the directory before continuing from this page.",
  status: 409,
  title: "People list changed",
};
const TAG_OPTIONS_QUERY_INVALID: ProblemDefinition = {
  code: "tag_options_query_invalid",
  detail: "Review the tag search and pagination criteria.",
  status: 400,
  title: "Invalid tag options query",
};
const TAG_OPTIONS_UNAVAILABLE: ProblemDefinition = {
  code: "tag_options_unavailable",
  detail: "Tag options are temporarily unavailable.",
  status: 503,
  title: "Tag options unavailable",
};
const TAG_OPTIONS_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Tag options unavailable",
};
const TAG_OPTIONS_CURSOR_INVALID: ProblemDefinition = {
  code: "tag_options_cursor_invalid",
  detail: "Start a new tag search before continuing.",
  status: 400,
  title: "Invalid tag options cursor",
};
const PERSON_ID_INVALID: ProblemDefinition = {
  code: "person_id_invalid",
  detail: "Use a valid canonical person identifier.",
  status: 400,
  title: "Invalid person",
};
const LIFE_EVENTS_UNAVAILABLE: ProblemDefinition = {
  code: "person_life_events_unavailable",
  detail: "Other person sections remain available.",
  status: 503,
  title: "Life events unavailable",
};
const LIFE_EVENTS_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Life events unavailable",
};
const ACTIVE_PERSON_NOT_FOUND: ProblemDefinition = {
  code: "person_not_found",
  detail:
    "No active person with this identifier exists in the current workspace.",
  status: 404,
  title: "Person not found",
};
const TIMELINE_QUERY_INVALID: ProblemDefinition = {
  code: "person_timeline_query_invalid",
  detail: "Use a canonical person, supported kind, and bounded page size.",
  status: 400,
  title: "Invalid person timeline",
};
const TIMELINE_SESSION_INVALID: ProblemDefinition = {
  code: "person_timeline_authentication_required",
  detail: "Sign in with an active workspace membership.",
  status: 401,
  title: "Authentication required",
};
const TIMELINE_UNAVAILABLE: ProblemDefinition = {
  code: "person_timeline_unavailable",
  detail: "Other person sections remain available.",
  status: 503,
  title: "Person timeline unavailable",
};
const TIMELINE_FORBIDDEN: ProblemDefinition = {
  code: "person_timeline_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Person timeline unavailable",
};
const TIMELINE_NOT_FOUND: ProblemDefinition = {
  code: "person_timeline_not_found",
  detail:
    "No active person with this identifier exists in the current workspace.",
  status: 404,
  title: "Person not found",
};
const TIMELINE_CURSOR_STALE: ProblemDefinition = {
  code: "person_timeline_stale_cursor",
  detail: "Refresh the timeline before continuing from this page.",
  status: 409,
  title: "Person timeline changed",
};
const PERSON_QUERY_INVALID: ProblemDefinition = {
  code: "person_query_invalid",
  detail: "Use include=summary to request the person summary.",
  status: 400,
  title: "Invalid person query",
};
const PERSON_UNAVAILABLE: ProblemDefinition = {
  code: "people_unavailable",
  detail: "The person service is temporarily unavailable.",
  status: 503,
  title: "Person unavailable",
};
const PERSON_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Person unavailable",
};
const PERSON_VIEW_INVALID: ProblemDefinition = {
  code: "person_view_invalid",
  detail: "Use a canonical person identifier and an empty request body.",
  status: 400,
  title: "Invalid person view",
};
const PERSON_VIEW_UNRESOLVED: ProblemDefinition = {
  code: "person_view_unavailable",
  detail: "The person could not be resolved before updating recent history.",
  status: 503,
  title: "Person view unavailable",
};
const PERSON_VIEW_NOT_FOUND: ProblemDefinition = {
  code: "person_not_found",
  detail:
    "No viewable person with this identifier exists in the current workspace.",
  status: 404,
  title: "Person not found",
};
const PERSON_VIEW_NOT_RECORDED: ProblemDefinition = {
  code: "person_view_unavailable",
  detail: "Recent-person history could not be updated.",
  status: 503,
  title: "Person view unavailable",
};
const RECENT_PEOPLE_UNAVAILABLE: ProblemDefinition = {
  code: "today_recent_people_unavailable",
  detail: "Recently viewed people are temporarily unavailable.",
  status: 503,
  title: "Recent people unavailable",
};
const RECENT_PEOPLE_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Recent people unavailable",
};
const PROFILE_SECTION_INVALID: ProblemDefinition = {
  code: "profile_fact_request_invalid",
  detail: "Use a supported section and canonical person identifier.",
  status: 400,
  title: "Invalid profile section",
};
const PROFILE_FACTS_UNAVAILABLE: ProblemDefinition = {
  code: "profile_facts_unavailable",
  detail: "This profile section is temporarily unavailable.",
  status: 503,
  title: "Profile facts unavailable",
};
const PROFILE_FACTS_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Profile facts unavailable",
};
const WORKSPACE_PERSON_NOT_FOUND: ProblemDefinition = {
  code: "person_not_found",
  detail: "No person with this identifier exists in the active workspace.",
  status: 404,
  title: "Person not found",
};
const PROFILE_FACT_CURSOR_STALE: ProblemDefinition = {
  code: "profile_fact_cursor_stale",
  detail: "Restart this profile section before loading more facts.",
  status: 409,
  title: "Profile section changed",
};
const PROFILE_FACT_CREATE_INVALID: ProblemDefinition = {
  code: "profile_fact_request_invalid",
  detail: "Use a supported section and canonical person identifier.",
  status: 400,
  title: "Invalid profile fact",
};
const PROFILE_FACT_BODY_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the fields for this profile section.",
  status: 400,
  title: "Invalid profile fact",
};
const PROFILE_FACT_NOT_SAVED: ProblemDefinition = {
  code: "profile_facts_unavailable",
  detail: "This profile section is temporarily unavailable.",
  status: 503,
  title: "Profile fact could not be saved",
};
const PROFILE_FACT_UPDATE_INVALID: ProblemDefinition = {
  code: "profile_fact_request_invalid",
  detail: "Use supported canonical profile identifiers.",
  status: 400,
  title: "Invalid profile fact",
};
const PROFILE_FACT_VERSION_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the identifiers and current version for this profile fact.",
  status: 400,
  title: "Invalid profile fact",
};
const PROFILE_FACT_DELETE_INVALID: ProblemDefinition = {
  code: "profile_fact_request_invalid",
  detail: "Use current canonical profile identifiers.",
  status: 400,
  title: "Invalid profile fact",
};
const PROFILE_FACT_NOT_DELETED: ProblemDefinition = {
  code: "profile_facts_unavailable",
  detail: "This profile section is temporarily unavailable.",
  status: 503,
  title: "Profile fact could not be deleted",
};
const IMPORTANT_DATES_UNAVAILABLE: ProblemDefinition = {
  code: "important_dates_unavailable",
  detail: "Important dates are temporarily unavailable.",
  status: 503,
  title: "Important dates unavailable",
};
const IMPORTANT_DATES_FORBIDDEN: ProblemDefinition = {
  code: "people_forbidden",
  detail: "Your active workspace membership no longer permits this view.",
  status: 403,
  title: "Important dates unavailable",
};
const CURRENT_PERSON_NOT_FOUND: ProblemDefinition = {
  code: "person_not_found",
  detail: "No person with this identifier exists in the current workspace.",
  status: 404,
  title: "Person not found",
};
const IMPORTANT_DATE_CREATE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the precision and known components.",
  status: 400,
  title: "Invalid important date",
};
const IMPORTANT_DATE_NOT_SAVED: ProblemDefinition = {
  code: "important_dates_unavailable",
  detail: "The important-date service is temporarily unavailable.",
  status: 503,
  title: "Important date could not be saved",
};
const IMPORTANT_DATE_UPDATE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the precision, known components, and current version.",
  status: 400,
  title: "Invalid important date",
};
const IMPORTANT_DATE_DELETE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Refresh this important date before deleting it.",
  status: 400,
  title: "Invalid important date deletion",
};
const IMPORTANT_DATE_NOT_DELETED: ProblemDefinition = {
  code: "important_dates_unavailable",
  detail: "The important-date service is temporarily unavailable.",
  status: 503,
  title: "Important date could not be deleted",
};
const PERSON_EDIT_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the identity fields and current version before saving.",
  status: 400,
  title: "Invalid person",
};
const PERSON_NOT_UPDATED: ProblemDefinition = {
  code: "people_unavailable",
  detail: "The person service is temporarily unavailable.",
  status: 503,
  title: "Person could not be updated",
};
const LIFECYCLE_REQUEST_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Refresh this person before trying again.",
  status: 400,
  title: "Invalid lifecycle request",
};
const PERSON_NOT_CHANGED: ProblemDefinition = {
  code: "people_unavailable",
  detail: "The person service is temporarily unavailable.",
  status: 503,
  title: "Person could not be changed",
};
const DELETION_IMPACT_UNAVAILABLE: ProblemDefinition = {
  code: "people_unavailable",
  detail: "The person service is temporarily unavailable.",
  status: 503,
  title: "Deletion impact unavailable",
};
const PERSON_DELETE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Use the current deletion impact preview and exact confirmation.",
  status: 400,
  title: "Invalid deletion request",
};
const PERSON_NOT_DELETED: ProblemDefinition = {
  code: "people_unavailable",
  detail: "The person service is temporarily unavailable.",
  status: 503,
  title: "Person could not be deleted",
};
const PERSON_CREATE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the identity fields and try again.",
  status: 400,
  title: "Invalid person",
};
const PERSON_NOT_CREATED: ProblemDefinition = {
  code: "people_unavailable",
  detail: "The person service is temporarily unavailable.",
  status: 503,
  title: "Person could not be created",
};
const PERSON_CREATE_REJECTED: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the highlighted identity fields and try again.",
  status: 400,
  title: "Invalid person",
};
const PERSON_CREATE_FORBIDDEN: ProblemDefinition = {
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

/** Every problem this file answers on its own, for the pinning suite. */
export const PEOPLE_PROBLEMS: readonly ProblemDefinition[] = [
  ACTIVE_PERSON_NOT_FOUND,
  CURRENT_PERSON_NOT_FOUND,
  DELETION_IMPACT_UNAVAILABLE,
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
  PEOPLE_CURSOR_STALE,
  PEOPLE_FORBIDDEN,
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
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  routes.get("/api/v1/people", session, async (context) => {
    const parsed = parseQuery(context, directoryQuerySchema);
    if ("errors" in parsed) {
      return definedProblem(context, PEOPLE_QUERY_INVALID);
    }
    const actor = await tokenOrSessionActor(context, {
      scope: DIRECTORY_SCOPE,
      ...(services.apiTokens ? { tokens: services.apiTokens } : {}),
    });
    if (!actor) return definedProblem(context, SESSION_INVALID);
    const result = await services.directory.list(actor, {
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
      ...(parsed.data.excludePersonId
        ? { excludePersonId: parsed.data.excludePersonId }
        : {}),
      lifecycle: parsed.data.lifecycle,
      limit: parsed.data.limit,
      ...(parsed.data.search ? { search: parsed.data.search } : {}),
      ...(parsed.data.selectedPersonId
        ? { selectedPersonId: parsed.data.selectedPersonId }
        : {}),
      sort: parsed.data.sort,
      ...(parsed.data.tag ? { tagId: parsed.data.tag } : {}),
    }).catch(() => undefined);
    if (!result) return definedProblem(context, PEOPLE_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, PEOPLE_FORBIDDEN);
    }
    if (result.status === "stale-cursor") {
      return definedProblem(context, PEOPLE_CURSOR_STALE);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      lifecycle: parsed.data.lifecycle,
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      people: result.people,
      ...(result.selected ? { selected: result.selected } : {}),
      status: "ready",
    });
  });

  routes.get("/api/v1/people/tag-options", session, async (context) => {
    const parsed = parseQuery(context, tagOptionsQuerySchema);
    if ("errors" in parsed) {
      return definedProblem(context, TAG_OPTIONS_QUERY_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.tagOptions.list(actor, {
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
      ...(parsed.data.search ? { search: parsed.data.search } : {}),
      ...(parsed.data.selected ? { selectedTagId: parsed.data.selected } : {}),
    }).catch(() => undefined);
    if (!result) return definedProblem(context, TAG_OPTIONS_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, TAG_OPTIONS_FORBIDDEN);
    }
    if (result.status === "invalid-input") {
      return definedProblem(context, TAG_OPTIONS_CURSOR_INVALID);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      options: result.options,
      ...(result.selected ? { selected: result.selected } : {}),
      status: "ready",
    });
  });

  routes.get(
    "/api/v1/people/:personId/life-events",
    session,
    async (context) => {
      const parsed = parseValue(personIdSchema, context.req.param("personId"));
      if ("errors" in parsed) {
        return definedProblem(context, PERSON_ID_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.profile.listLifeEvents(actor, parsed.data)
        .catch(() => undefined);
      if (!result) return definedProblem(context, LIFE_EVENTS_UNAVAILABLE);
      if (result.status === "forbidden") {
        return definedProblem(context, LIFE_EVENTS_FORBIDDEN);
      }
      if (result.status === "not-found") {
        return definedProblem(context, ACTIVE_PERSON_NOT_FOUND);
      }
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  routes.get("/api/v1/people/:personId/timeline", session, async (context) => {
    const personId = parseValue(personIdSchema, context.req.param("personId"));
    const input = parseQuery(context, personTimelineQuerySchema);
    if ("errors" in personId || "errors" in input) {
      return definedProblem(context, TIMELINE_QUERY_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) {
      return definedProblem(context, TIMELINE_SESSION_INVALID);
    }
    const result = await services.profile.listTimeline(
      actor,
      personId.data,
      {
        ...(input.data.cursor ? { cursor: input.data.cursor } : {}),
        ...(input.data.kind ? { kind: input.data.kind } : {}),
        limit: input.data.limit,
      },
    ).catch(() => undefined);
    if (!result) return definedProblem(context, TIMELINE_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, TIMELINE_FORBIDDEN);
    }
    if (result.status === "not-found") {
      return definedProblem(context, TIMELINE_NOT_FOUND);
    }
    if (result.status === "stale-cursor") {
      return definedProblem(context, TIMELINE_CURSOR_STALE);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  routes.get("/api/v1/people/:personId", session, async (context) => {
    const parsed = parseValue(personIdSchema, context.req.param("personId"));
    if ("errors" in parsed) {
      return definedProblem(context, PERSON_ID_INVALID);
    }
    const query = parseQuery(context, personReadQuerySchema);
    if ("errors" in query) {
      return definedProblem(context, PERSON_QUERY_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const includeSummary = query.data.include === "summary";
    const result = await (includeSummary
      ? services.profile.get(actor, parsed.data, { includeSummary: true })
      : services.profile.get(actor, parsed.data)).catch(() =>
        undefined
      );
    if (!result) return definedProblem(context, PERSON_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, PERSON_FORBIDDEN);
    }
    if (result.status === "not-found") {
      return definedProblem(context, ACTIVE_PERSON_NOT_FOUND);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      dueInformation: result.dueInformation,
      person: result.person,
      status: result.status,
      ...(includeSummary && result.summary ? { summary: result.summary } : {}),
    });
  });

  routes.post(
    "/api/v1/people/:personId/view",
    origin,
    session,
    async (context) => {
      const parsed = parseValue(personIdSchema, context.req.param("personId"));
      const body = await context.req.text().catch(() => undefined);
      if ("errors" in parsed || body !== "") {
        return definedProblem(context, PERSON_VIEW_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const profile = await services.profile.get(actor, parsed.data).catch(
        () => undefined,
      );
      if (!profile) return definedProblem(context, PERSON_VIEW_UNRESOLVED);
      if (profile.status === "forbidden") {
        return definedProblem(context, PERSON_FORBIDDEN);
      }
      if (profile.status === "not-found") {
        return definedProblem(context, PERSON_VIEW_NOT_FOUND);
      }
      const result = await services.recentPeople?.record(actor, parsed.data)
        .catch(() => undefined);
      if (!result) return definedProblem(context, PERSON_VIEW_NOT_RECORDED);
      if (result.status === "forbidden") {
        return definedProblem(context, PERSON_FORBIDDEN);
      }
      context.header("Cache-Control", "private, no-store");
      return context.json({ status: "recorded" });
    },
  );

  routes.get("/api/v1/today/recent-people", session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.todayRecentPeople?.get(actor).catch(() =>
      undefined
    );
    if (!result) return definedProblem(context, RECENT_PEOPLE_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, RECENT_PEOPLE_FORBIDDEN);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({ people: result.people, status: "ready" });
  });

  routes.get(
    "/api/v1/people/:personId/facts/:section",
    session,
    async (context) => {
      const personId = parseValue(
        personIdSchema,
        context.req.param("personId"),
      );
      const section = parseValue(
        profileFactSectionSchema,
        context.req.param("section"),
      );
      const query = parseQuery(context, profileFactListQuerySchema);
      if (
        "errors" in personId || "errors" in section || "errors" in query
      ) return definedProblem(context, PROFILE_SECTION_INVALID);
      const actor = await requireActor(context);
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

  routes.post(
    "/api/v1/people/:personId/facts/:section",
    origin,
    session,
    async (context) => {
      const personId = parseValue(
        personIdSchema,
        context.req.param("personId"),
      );
      const section = parseValue(
        profileFactSectionSchema,
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
      const actor = await requireActor(context);
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

  routes.put(
    "/api/v1/people/:personId/facts/:section/:factId",
    origin,
    session,
    async (context) => {
      const personId = parseValue(
        personIdSchema,
        context.req.param("personId"),
      );
      const factId = parseValue(personIdSchema, context.req.param("factId"));
      const section = parseValue(
        profileFactSectionSchema,
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
      const actor = await requireActor(context);
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

  routes.delete(
    "/api/v1/people/:personId/facts/:section/:factId",
    origin,
    session,
    async (context) => {
      const personId = parseValue(
        personIdSchema,
        context.req.param("personId"),
      );
      const factId = parseValue(personIdSchema, context.req.param("factId"));
      const section = parseValue(
        profileFactSectionSchema,
        context.req.param("section"),
      );
      const input = await parseJsonBody(context, profileFactDeleteSchema);
      if (
        "errors" in personId || "errors" in factId || "errors" in section ||
        "errors" in input || input.data.section !== section.data
      ) return definedProblem(context, PROFILE_FACT_DELETE_INVALID);
      const actor = await requireActor(context);
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

  routes.get("/api/v1/people/:personId/dates", session, async (context) => {
    const personId = parseValue(personIdSchema, context.req.param("personId"));
    if ("errors" in personId) {
      return definedProblem(context, PERSON_ID_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.importantDates?.list(actor, personId.data)
      .catch(() => undefined);
    if (!result) return definedProblem(context, IMPORTANT_DATES_UNAVAILABLE);
    if (result.status === "forbidden") {
      return definedProblem(context, IMPORTANT_DATES_FORBIDDEN);
    }
    if (result.status === "not-found") {
      return definedProblem(context, CURRENT_PERSON_NOT_FOUND);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      dates: result.dates.map(importantDate),
      status: result.status,
    });
  });

  routes.post(
    "/api/v1/people/:personId/dates",
    origin,
    session,
    async (context) => {
      const personId = parseValue(
        personIdSchema,
        context.req.param("personId"),
      );
      const input = await parseJsonBody(context, importantDateValueSchema);
      if ("errors" in personId || "errors" in input) {
        return definedProblem(context, IMPORTANT_DATE_CREATE_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.importantDates?.create(
        actor,
        personId.data,
        importantDateInput(input.data),
      ).catch(() => undefined);
      if (!result) return definedProblem(context, IMPORTANT_DATE_NOT_SAVED);
      if (result.status !== "created") return dateFailure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json(
        { date: importantDate(result.date), status: "created" },
        201,
      );
    },
  );

  routes.patch(
    "/api/v1/people/:personId/dates/:dateId",
    origin,
    session,
    async (context) => {
      const personId = parseValue(
        personIdSchema,
        context.req.param("personId"),
      );
      const dateId = parseValue(personIdSchema, context.req.param("dateId"));
      const input = await parseJsonBody(context, importantDateUpdateSchema);
      if ("errors" in personId || "errors" in dateId || "errors" in input) {
        return definedProblem(context, IMPORTANT_DATE_UPDATE_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const { expectedUpdatedAt, ...value } = input.data;
      const result = await services.importantDates?.update(
        actor,
        personId.data,
        dateId.data,
        { ...importantDateInput(value), expectedUpdatedAt },
      ).catch(() => undefined);
      if (!result) return definedProblem(context, IMPORTANT_DATE_NOT_SAVED);
      if (result.status !== "updated") return dateFailure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json({
        date: importantDate(result.date),
        status: "updated",
      });
    },
  );

  routes.delete(
    "/api/v1/people/:personId/dates/:dateId",
    origin,
    session,
    async (context) => {
      const personId = parseValue(
        personIdSchema,
        context.req.param("personId"),
      );
      const dateId = parseValue(personIdSchema, context.req.param("dateId"));
      const input = await parseJsonBody(context, importantDateDeleteSchema);
      if ("errors" in personId || "errors" in dateId || "errors" in input) {
        return definedProblem(context, IMPORTANT_DATE_DELETE_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.importantDates?.delete(
        actor,
        personId.data,
        dateId.data,
        input.data,
      ).catch(() => undefined);
      if (!result) return definedProblem(context, IMPORTANT_DATE_NOT_DELETED);
      if (result.status !== "deleted") return dateFailure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json({ dateId: result.dateId, status: "deleted" });
    },
  );

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

  for (const action of ["archive", "restore"] as const) {
    routes.post(
      `/api/v1/people/:personId/${action}`,
      origin,
      session,
      async (context) => {
        const personId = parseValue(
          personIdSchema,
          context.req.param("personId"),
        );
        const input = await parseJsonBody(context, transitionSchema);
        if ("errors" in personId || "errors" in input) {
          return definedProblem(context, LIFECYCLE_REQUEST_INVALID);
        }
        const actor = await requireActor(context);
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

  routes.get(
    "/api/v1/people/:personId/deletion-impact",
    session,
    async (context) => {
      const personId = parseValue(
        personIdSchema,
        context.req.param("personId"),
      );
      if ("errors" in personId) {
        return definedProblem(context, PERSON_ID_INVALID);
      }
      const actor = await requireActor(context);
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

  routes.delete(
    "/api/v1/people/:personId",
    origin,
    session,
    async (context) => {
      const personId = parseValue(
        personIdSchema,
        context.req.param("personId"),
      );
      const input = await parseJsonBody(context, deletePersonSchema);
      if ("errors" in personId || "errors" in input) {
        return definedProblem(context, PERSON_DELETE_INVALID);
      }
      const actor = await requireActor(context);
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
