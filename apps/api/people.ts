import { type Context, Hono } from "hono";
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
  ProfileFactMutationResult,
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

function problem(
  context: Context,
  status: 400 | 401 | 403 | 404 | 409 | 503,
  code: string,
  title: string,
  detail: string,
  errors?: Readonly<Record<string, string>>,
): Response {
  return context.body(
    JSON.stringify({
      type: `https://kinship.test/problems/${code}`,
      title,
      status,
      detail,
      code,
      ...(errors ? { errors } : {}),
    }),
    status,
    {
      "Cache-Control": "no-store",
      "Content-Type": "application/problem+json",
    },
  );
}

function cookieValue(header: string | undefined, name: string) {
  return header?.split(";").map((value) => value.trim()).find((value) =>
    value.startsWith(`${name}=`)
  )?.slice(name.length + 1);
}

function requireOrigin(
  context: Context,
  policy: BrowserSecurityPolicy,
): Response | undefined {
  return context.req.header("Origin") === policy.origin ? undefined : problem(
    context,
    403,
    "origin_invalid",
    "Request forbidden",
    "This request did not come from the configured application origin.",
  );
}

async function actor(context: Context, services: PeopleHttpServices) {
  const sessionToken = cookieValue(
    context.req.header("Cookie"),
    "kinship_session",
  );
  if (!sessionToken) return undefined;
  const requestedWorkspaceId = context.req.header("X-Workspace-Id");
  const resolved = await services.protectedSessions.resolve({
    sessionToken,
    ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
  }).catch(() => undefined);
  return resolved
    ? {
      memberId: resolved.memberId,
      role: resolved.role,
      userId: resolved.userId,
      workspaceId: resolved.workspaceId,
    }
    : undefined;
}

async function directoryActor(context: Context, services: PeopleHttpServices) {
  const authorization = context.req.header("Authorization");
  if (authorization) {
    const matched = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!matched?.[1] || !services.apiTokens) return undefined;
    const authenticated = await services.apiTokens.authenticate(
      matched[1],
      "people:read",
      context.req.header("X-Workspace-Id"),
    ).catch(() => undefined);
    return authenticated?.status === "authenticated"
      ? authenticated.actor
      : undefined;
  }
  return await actor(context, services);
}

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

function importantDateFailure(
  context: Context,
  result: Exclude<
    Awaited<ReturnType<ImportantDateManagement["create"]>>,
    { status: "created" | "deleted" | "updated" }
  >,
): Response {
  if (result.status === "forbidden") {
    return problem(
      context,
      403,
      "people_forbidden",
      "Important dates unavailable",
      "Your active workspace membership no longer permits this change.",
    );
  }
  if (result.status === "not-found") {
    return problem(
      context,
      404,
      "person_date_not_found",
      "Important date not found",
      "The person or important date does not exist in the active workspace.",
    );
  }
  if (result.status === "stale") {
    return problem(
      context,
      409,
      "person_date_stale",
      "Important date changed",
      "Refresh the important dates before trying again.",
    );
  }
  if (result.status === "conflict") {
    return problem(
      context,
      409,
      "person_date_conflict",
      "Important date already exists",
      "Birthday, first meeting, and date of death can each be recorded once.",
    );
  }
  if (result.status === "archived-write-rejected") {
    return problem(
      context,
      409,
      "archived_write_rejected",
      "Archived person is read-only",
      "Restore this person before changing important dates.",
    );
  }
  return problem(
    context,
    400,
    "validation_failed",
    "Invalid important date",
    "Use only the components declared by the selected precision.",
    result.errors,
  );
}

function profileFactFailure(
  context: Context,
  result: Exclude<ProfileFactMutationResult, { status: "deleted" | "saved" }>,
): Response {
  if (result.status === "forbidden") {
    return problem(
      context,
      403,
      "people_forbidden",
      "Profile facts unavailable",
      "Your active workspace membership no longer permits this change.",
    );
  }
  if (result.status === "not-found") {
    return problem(
      context,
      404,
      "person_fact_not_found",
      "Profile fact not found",
      "The person or profile fact does not exist in the active workspace.",
    );
  }
  if (result.status === "hidden") {
    return problem(
      context,
      409,
      "profile_section_hidden",
      "Profile section hidden",
      "An administrator disabled this section. Saved data was retained.",
    );
  }
  if (result.status === "invalid-reference") {
    return problem(
      context,
      400,
      "profile_fact_reference_invalid",
      "Profile option unavailable",
      "Select an active option from the current workspace.",
    );
  }
  if (result.status === "archived-write-rejected") {
    return problem(
      context,
      409,
      "archived_write_rejected",
      "Archived person is read-only",
      "Restore this person before changing profile facts.",
    );
  }
  if (result.status === "stale") {
    return problem(
      context,
      409,
      "profile_fact_stale",
      "Profile fact changed",
      "Refresh this section before trying again.",
    );
  }
  return problem(
    context,
    400,
    "validation_failed",
    "Invalid profile fact",
    "Review the highlighted profile fields.",
    result.status === "validation-error" ? result.errors : undefined,
  );
}

function lifecycleFailure(
  context: Context,
  status:
    | "archived-write-rejected"
    | "confirmation-required"
    | "forbidden"
    | "not-found"
    | "stale"
    | "validation-error",
  errors?: Readonly<Record<string, string>>,
): Response {
  if (status === "forbidden") {
    return problem(
      context,
      403,
      "people_forbidden",
      "Person unavailable",
      "Your active workspace membership no longer permits this change.",
    );
  }
  if (status === "not-found") {
    return problem(
      context,
      404,
      "person_not_found",
      "Person not found",
      "No person with this identifier exists in the current workspace.",
    );
  }
  if (status === "stale") {
    return problem(
      context,
      409,
      "person_stale",
      "Person changed",
      "Refresh this person before trying the lifecycle action again.",
    );
  }
  if (status === "archived-write-rejected") {
    return problem(
      context,
      409,
      "archived_write_rejected",
      "Archived person is read-only",
      "Restore this person before editing their identity.",
    );
  }
  return problem(
    context,
    400,
    status === "confirmation-required"
      ? "confirmation_required"
      : "validation_failed",
    status === "confirmation-required"
      ? "Confirmation required"
      : "Invalid person",
    status === "confirmation-required"
      ? "Enter the exact confirmation shown in the deletion impact preview."
      : "Review the highlighted identity fields and try again.",
    errors,
  );
}

export function createPeopleRoutes(services: PeopleHttpServices): Hono {
  const routes = new Hono();
  routes.get("/api/v1/people", async (context) => {
    const parsed = directoryQuerySchema.safeParse(context.req.query());
    if (!parsed.success) {
      return problem(
        context,
        400,
        "people_query_invalid",
        "Invalid people query",
        "Review the search, tag, sort, lifecycle, and pagination criteria.",
      );
    }
    const resolved = await directoryActor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.directory.list(resolved, {
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
    if (!result) {
      return problem(
        context,
        503,
        "people_unavailable",
        "People unavailable",
        "The people directory is temporarily unavailable.",
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "people_forbidden",
        "People unavailable",
        "Your active workspace membership no longer permits this view.",
      );
    }
    if (result.status === "stale-cursor") {
      return problem(
        context,
        409,
        "stale_cursor",
        "People list changed",
        "Refresh the directory before continuing from this page.",
      );
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
  routes.get("/api/v1/people/tag-options", async (context) => {
    const parsed = tagOptionsQuerySchema.safeParse(context.req.query());
    if (!parsed.success) {
      return problem(
        context,
        400,
        "tag_options_query_invalid",
        "Invalid tag options query",
        "Review the tag search and pagination criteria.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.tagOptions.list(resolved, {
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
      ...(parsed.data.search ? { search: parsed.data.search } : {}),
      ...(parsed.data.selected ? { selectedTagId: parsed.data.selected } : {}),
    }).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "tag_options_unavailable",
        "Tag options unavailable",
        "Tag options are temporarily unavailable.",
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "people_forbidden",
        "Tag options unavailable",
        "Your active workspace membership no longer permits this view.",
      );
    }
    if (result.status === "invalid-input") {
      return problem(
        context,
        400,
        "tag_options_cursor_invalid",
        "Invalid tag options cursor",
        "Start a new tag search before continuing.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      options: result.options,
      ...(result.selected ? { selected: result.selected } : {}),
      status: "ready",
    });
  });
  routes.get("/api/v1/people/:personId/life-events", async (context) => {
    const parsed = personIdSchema.safeParse(context.req.param("personId"));
    if (!parsed.success) {
      return problem(
        context,
        400,
        "person_id_invalid",
        "Invalid person",
        "Use a valid canonical person identifier.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.profile.listLifeEvents(resolved, parsed.data)
      .catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "person_life_events_unavailable",
        "Life events unavailable",
        "Other person sections remain available.",
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "people_forbidden",
        "Life events unavailable",
        "Your active workspace membership no longer permits this view.",
      );
    }
    if (result.status === "not-found") {
      return problem(
        context,
        404,
        "person_not_found",
        "Person not found",
        "No active person with this identifier exists in the current workspace.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.get("/api/v1/people/:personId", async (context) => {
    const parsed = personIdSchema.safeParse(context.req.param("personId"));
    if (!parsed.success) {
      return problem(
        context,
        400,
        "person_id_invalid",
        "Invalid person",
        "Use a valid canonical person identifier.",
      );
    }
    const query = personReadQuerySchema.safeParse(context.req.query());
    if (!query.success) {
      return problem(
        context,
        400,
        "person_query_invalid",
        "Invalid person query",
        "Use include=summary to request the person summary.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const includeSummary = query.data.include === "summary";
    const result = await (includeSummary
      ? services.profile.get(resolved, parsed.data, { includeSummary: true })
      : services.profile.get(resolved, parsed.data)).catch(() =>
        undefined
      );
    if (!result) {
      return problem(
        context,
        503,
        "people_unavailable",
        "Person unavailable",
        "The person service is temporarily unavailable.",
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "people_forbidden",
        "Person unavailable",
        "Your active workspace membership no longer permits this view.",
      );
    }
    if (result.status === "not-found") {
      return problem(
        context,
        404,
        "person_not_found",
        "Person not found",
        "No active person with this identifier exists in the current workspace.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      dueInformation: result.dueInformation,
      person: result.person,
      status: result.status,
      ...(includeSummary && result.summary ? { summary: result.summary } : {}),
    });
  });
  routes.post("/api/v1/people/:personId/view", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsed = personIdSchema.safeParse(context.req.param("personId"));
    const body = await context.req.text().catch(() => undefined);
    if (!parsed.success || body !== "") {
      return problem(
        context,
        400,
        "person_view_invalid",
        "Invalid person view",
        "Use a canonical person identifier and an empty request body.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const profile = await services.profile.get(resolved, parsed.data).catch(
      () => undefined,
    );
    if (!profile) {
      return problem(
        context,
        503,
        "person_view_unavailable",
        "Person view unavailable",
        "The person could not be resolved before updating recent history.",
      );
    }
    if (profile.status === "forbidden") {
      return problem(
        context,
        403,
        "people_forbidden",
        "Person unavailable",
        "Your active workspace membership no longer permits this view.",
      );
    }
    if (profile.status === "not-found") {
      return problem(
        context,
        404,
        "person_not_found",
        "Person not found",
        "No viewable person with this identifier exists in the current workspace.",
      );
    }
    const result = await services.recentPeople?.record(
      resolved,
      parsed.data,
    ).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "person_view_unavailable",
        "Person view unavailable",
        "Recent-person history could not be updated.",
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "people_forbidden",
        "Person unavailable",
        "Your active workspace membership no longer permits this view.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({ status: "recorded" });
  });
  routes.get("/api/v1/today/recent-people", async (context) => {
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.todayRecentPeople?.get(resolved).catch(() =>
      undefined
    );
    if (!result) {
      return problem(
        context,
        503,
        "today_recent_people_unavailable",
        "Recent people unavailable",
        "Recently viewed people are temporarily unavailable.",
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "people_forbidden",
        "Recent people unavailable",
        "Your active workspace membership no longer permits this view.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({ people: result.people, status: "ready" });
  });
  routes.get("/api/v1/people/:personId/facts/:section", async (context) => {
    const personId = personIdSchema.safeParse(context.req.param("personId"));
    const section = profileFactSectionSchema.safeParse(
      context.req.param("section"),
    );
    const query = profileFactListQuerySchema.safeParse(context.req.query());
    if (!personId.success || !section.success || !query.success) {
      return problem(
        context,
        400,
        "profile_fact_request_invalid",
        "Invalid profile section",
        "Use a supported section and canonical person identifier.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.profileFacts?.list(
      resolved,
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
    if (!result) {
      return problem(
        context,
        503,
        "profile_facts_unavailable",
        "Profile facts unavailable",
        "This profile section is temporarily unavailable.",
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "people_forbidden",
        "Profile facts unavailable",
        "Your active workspace membership no longer permits this view.",
      );
    }
    if (result.status === "not-found") {
      return problem(
        context,
        404,
        "person_not_found",
        "Person not found",
        "No person with this identifier exists in the active workspace.",
      );
    }
    if (result.status === "stale-cursor") {
      return problem(
        context,
        409,
        "profile_fact_cursor_stale",
        "Profile section changed",
        "Restart this profile section before loading more facts.",
      );
    }
    if (!("records" in result)) {
      return problem(
        context,
        409,
        "profile_fact_cursor_stale",
        "Profile section changed",
        "Restart this profile section before loading more facts.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      ...result,
      records: result.records.map(publicProfileFact),
    });
  });
  routes.post("/api/v1/people/:personId/facts/:section", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const personId = personIdSchema.safeParse(context.req.param("personId"));
    const section = profileFactSectionSchema.safeParse(
      context.req.param("section"),
    );
    if (!personId.success || !section.success) {
      return problem(
        context,
        400,
        "profile_fact_request_invalid",
        "Invalid profile fact",
        "Use a supported section and canonical person identifier.",
      );
    }
    const input = profileFactCreateSchemas[section.data].safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!input.success || input.data.section !== section.data) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid profile fact",
        "Review the fields for this profile section.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const { section: _inputSection, ...factInput } = input.data;
    const result = await services.profileFacts?.create(
      resolved,
      personId.data,
      section.data,
      factInput as unknown as ProfileFactCreateInput,
    ).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "profile_facts_unavailable",
        "Profile fact could not be saved",
        "This profile section is temporarily unavailable.",
      );
    }
    if (result.status !== "saved") return profileFactFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json({
      ...result,
      record: publicProfileFact(result.record),
    });
  });
  routes.put(
    "/api/v1/people/:personId/facts/:section/:factId",
    async (context) => {
      const forbidden = requireOrigin(context, services.browserSecurity);
      if (forbidden) return forbidden;
      const personId = personIdSchema.safeParse(context.req.param("personId"));
      const factId = personIdSchema.safeParse(context.req.param("factId"));
      const section = profileFactSectionSchema.safeParse(
        context.req.param("section"),
      );
      if (!personId.success || !factId.success || !section.success) {
        return problem(
          context,
          400,
          "profile_fact_request_invalid",
          "Invalid profile fact",
          "Use supported canonical profile identifiers.",
        );
      }
      const input = profileFactUpdateSchemas[section.data].safeParse(
        await context.req.json().catch(() => undefined),
      );
      if (
        !input.success || input.data.section !== section.data ||
        input.data.id !== factId.data
      ) {
        return problem(
          context,
          400,
          "validation_failed",
          "Invalid profile fact",
          "Review the identifiers and current version for this profile fact.",
        );
      }
      const resolved = await actor(context, services);
      if (!resolved) {
        return problem(
          context,
          401,
          "session_invalid",
          "Authentication required",
          "Sign in with an active workspace membership.",
        );
      }
      const { section: _inputSection, ...factInput } = input.data;
      const result = await services.profileFacts?.update(
        resolved,
        personId.data,
        section.data,
        factInput as unknown as ProfileFactUpdateInput,
      ).catch(() => undefined);
      if (!result) {
        return problem(
          context,
          503,
          "profile_facts_unavailable",
          "Profile fact could not be saved",
          "This profile section is temporarily unavailable.",
        );
      }
      if (result.status !== "saved") return profileFactFailure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json({
        ...result,
        record: publicProfileFact(result.record),
      });
    },
  );
  routes.delete(
    "/api/v1/people/:personId/facts/:section/:factId",
    async (context) => {
      const forbidden = requireOrigin(context, services.browserSecurity);
      if (forbidden) return forbidden;
      const personId = personIdSchema.safeParse(context.req.param("personId"));
      const factId = personIdSchema.safeParse(context.req.param("factId"));
      const section = profileFactSectionSchema.safeParse(
        context.req.param("section"),
      );
      const input = profileFactDeleteSchema.safeParse(
        await context.req.json().catch(() => undefined),
      );
      if (
        !personId.success || !factId.success || !section.success ||
        !input.success ||
        (input.success && section.success &&
          input.data.section !== section.data)
      ) {
        return problem(
          context,
          400,
          "profile_fact_request_invalid",
          "Invalid profile fact",
          "Use current canonical profile identifiers.",
        );
      }
      const resolved = await actor(context, services);
      if (!resolved) {
        return problem(
          context,
          401,
          "session_invalid",
          "Authentication required",
          "Sign in with an active workspace membership.",
        );
      }
      const result = await services.profileFacts?.delete(
        resolved,
        personId.data,
        section.data,
        factId.data,
        input.data.expectedUpdatedAt,
        input.data.expectedPersonUpdatedAt,
      ).catch(() => undefined);
      if (!result) {
        return problem(
          context,
          503,
          "profile_facts_unavailable",
          "Profile fact could not be deleted",
          "This profile section is temporarily unavailable.",
        );
      }
      if (result.status !== "deleted") {
        return profileFactFailure(
          context,
          result,
        );
      }
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );
  routes.get("/api/v1/people/:personId/dates", async (context) => {
    const personId = personIdSchema.safeParse(context.req.param("personId"));
    if (!personId.success) {
      return problem(
        context,
        400,
        "person_id_invalid",
        "Invalid person",
        "Use a valid canonical person identifier.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.importantDates?.list(resolved, personId.data)
      .catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "important_dates_unavailable",
        "Important dates unavailable",
        "Important dates are temporarily unavailable.",
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "people_forbidden",
        "Important dates unavailable",
        "Your active workspace membership no longer permits this view.",
      );
    }
    if (result.status === "not-found") {
      return problem(
        context,
        404,
        "person_not_found",
        "Person not found",
        "No person with this identifier exists in the current workspace.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      dates: result.dates.map(importantDate),
      status: result.status,
    });
  });
  routes.post("/api/v1/people/:personId/dates", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const personId = personIdSchema.safeParse(context.req.param("personId"));
    const input = importantDateValueSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!personId.success || !input.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid important date",
        "Review the precision and known components.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.importantDates?.create(
      resolved,
      personId.data,
      importantDateInput(input.data),
    ).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "important_dates_unavailable",
        "Important date could not be saved",
        "The important-date service is temporarily unavailable.",
      );
    }
    if (result.status !== "created") {
      return importantDateFailure(context, result);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(
      { date: importantDate(result.date), status: "created" },
      201,
    );
  });
  routes.patch("/api/v1/people/:personId/dates/:dateId", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const personId = personIdSchema.safeParse(context.req.param("personId"));
    const dateId = personIdSchema.safeParse(context.req.param("dateId"));
    const input = importantDateUpdateSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!personId.success || !dateId.success || !input.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid important date",
        "Review the precision, known components, and current version.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const { expectedUpdatedAt, ...value } = input.data;
    const result = await services.importantDates?.update(
      resolved,
      personId.data,
      dateId.data,
      { ...importantDateInput(value), expectedUpdatedAt },
    ).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "important_dates_unavailable",
        "Important date could not be saved",
        "The important-date service is temporarily unavailable.",
      );
    }
    if (result.status !== "updated") {
      return importantDateFailure(context, result);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      date: importantDate(result.date),
      status: "updated",
    });
  });
  routes.delete("/api/v1/people/:personId/dates/:dateId", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const personId = personIdSchema.safeParse(context.req.param("personId"));
    const dateId = personIdSchema.safeParse(context.req.param("dateId"));
    const input = importantDateDeleteSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!personId.success || !dateId.success || !input.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid important date deletion",
        "Refresh this important date before deleting it.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.importantDates?.delete(
      resolved,
      personId.data,
      dateId.data,
      input.data,
    ).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "important_dates_unavailable",
        "Important date could not be deleted",
        "The important-date service is temporarily unavailable.",
      );
    }
    if (result.status !== "deleted") {
      return importantDateFailure(context, result);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({ dateId: result.dateId, status: "deleted" });
  });
  routes.patch("/api/v1/people/:personId", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const personId = personIdSchema.safeParse(context.req.param("personId"));
    const input = editPersonSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!personId.success || !input.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid person",
        "Review the identity fields and current version before saving.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.people.edit(resolved, personId.data, {
      expectedUpdatedAt: input.data.expectedUpdatedAt,
      ...(input.data.familyName ? { familyName: input.data.familyName } : {}),
      givenName: input.data.givenName,
      isPartial: input.data.isPartial,
      ...(input.data.middleName ? { middleName: input.data.middleName } : {}),
      ...(input.data.nickname ? { nickname: input.data.nickname } : {}),
    }).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "people_unavailable",
        "Person could not be updated",
        "The person service is temporarily unavailable.",
      );
    }
    if (result.status !== "updated") {
      return lifecycleFailure(
        context,
        result.status,
        result.status === "validation-error" ? result.errors : undefined,
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      person: lifecycleIdentity(result.person),
      status: "updated",
    });
  });
  for (const action of ["archive", "restore"] as const) {
    routes.post(`/api/v1/people/:personId/${action}`, async (context) => {
      const forbidden = requireOrigin(context, services.browserSecurity);
      if (forbidden) return forbidden;
      const personId = personIdSchema.safeParse(context.req.param("personId"));
      const input = transitionSchema.safeParse(
        await context.req.json().catch(() => undefined),
      );
      if (!personId.success || !input.success) {
        return problem(
          context,
          400,
          "validation_failed",
          "Invalid lifecycle request",
          "Refresh this person before trying again.",
        );
      }
      const resolved = await actor(context, services);
      if (!resolved) {
        return problem(
          context,
          401,
          "session_invalid",
          "Authentication required",
          "Sign in with an active workspace membership.",
        );
      }
      const result = await services.people[action](
        resolved,
        personId.data,
        input.data,
      ).catch(() => undefined);
      if (!result) {
        return problem(
          context,
          503,
          "people_unavailable",
          "Person could not be changed",
          "The person service is temporarily unavailable.",
        );
      }
      if (result.status !== "archived" && result.status !== "restored") {
        return lifecycleFailure(context, result.status);
      }
      context.header("Cache-Control", "private, no-store");
      return context.json({
        person: lifecycleIdentity(result.person),
        status: result.status,
      });
    });
  }
  routes.get("/api/v1/people/:personId/deletion-impact", async (context) => {
    const personId = personIdSchema.safeParse(context.req.param("personId"));
    if (!personId.success) {
      return problem(
        context,
        400,
        "person_id_invalid",
        "Invalid person",
        "Use a valid canonical person identifier.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.people.previewDeletion(
      resolved,
      personId.data,
    ).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "people_unavailable",
        "Deletion impact unavailable",
        "The person service is temporarily unavailable.",
      );
    }
    if (result.status !== "ready") {
      return lifecycleFailure(context, result.status);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      impact: {
        confirmation: result.impact.confirmation,
        dependentRecordPolicy: result.impact.dependentRecordPolicy,
        person: lifecycleIdentity(result.impact.person),
      },
      status: "ready",
    });
  });
  routes.delete("/api/v1/people/:personId", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const personId = personIdSchema.safeParse(context.req.param("personId"));
    const input = deletePersonSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!personId.success || !input.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid deletion request",
        "Use the current deletion impact preview and exact confirmation.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.people.delete(
      resolved,
      personId.data,
      input.data,
    ).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "people_unavailable",
        "Person could not be deleted",
        "The person service is temporarily unavailable.",
      );
    }
    if (result.status !== "deleted") {
      return lifecycleFailure(context, result.status);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      next: "/app/people",
      personId: result.personId,
      status: "deleted",
    });
  });
  routes.post("/api/v1/people", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsed = personSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid person",
        "Review the identity fields and try again.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.people.create(resolved, {
      ...(parsed.data.duplicateOverride === true
        ? { duplicateOverride: true }
        : {}),
      ...(parsed.data.familyName ? { familyName: parsed.data.familyName } : {}),
      givenName: parsed.data.givenName,
      isPartial: parsed.data.isPartial,
      ...(parsed.data.middleName ? { middleName: parsed.data.middleName } : {}),
      ...(parsed.data.nickname ? { nickname: parsed.data.nickname } : {}),
    }).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "people_unavailable",
        "Person could not be created",
        "The person service is temporarily unavailable.",
      );
    }
    if (result.status === "validation-error") {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid person",
        "Review the highlighted identity fields and try again.",
        result.errors,
      );
    }
    if (result.status === "possible-duplicate") {
      return problem(
        context,
        409,
        "possible_duplicate",
        "Possible duplicate",
        `A person named ${
          result.duplicates[0]?.displayName ?? "this"
        } already exists in this workspace. Review the match or create anyway.`,
        { duplicate: "Confirm Create anyway to keep both people." },
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "people_forbidden",
        "Person could not be created",
        "Your active workspace membership no longer permits this change.",
      );
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
