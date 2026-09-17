/**
 * Member and workspace settings over HTTP.
 *
 * Six surfaces on one page — the member's profile, their preferences, their
 * sessions, the workspace's configuration, its members, and its
 * personalization — and eighteen routes over them. The problem responder, the
 * session cookie, the origin check, and the kernel status map came from
 * `http/` (GAP-019, GAP-020), and the rule about which time zones the calendar
 * can actually schedule in moved into the settings use case, so this file
 * parses shape and nothing else (GAP-020).
 *
 * The member UI state routes keep their own `member_ui_state_*` codes for
 * every refusal, including the session and the origin. They are read by a
 * script that runs on every page rather than by a form, and the codes are what
 * let it stay quiet about a refusal that every other surface would show.
 */

import { type Context, Hono } from "hono";
import { z } from "zod";
import type {
  createProtectedSessionCoordinator,
  MemberUiState,
  MemberUiStateManagement,
  PersonalizationManagement,
  PersonalizationSection,
  SettingsManagement,
} from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";
import { cookieValue, SESSION_COOKIE, setCookie } from "./http/cookies.ts";
import { failureResponder, type FailureTable } from "./http/failures.ts";
import { matchingOrigin, requireMatchingOrigin } from "./http/origin.ts";
import {
  definedProblem,
  type ProblemDefinition,
  type ProblemErrors,
} from "./http/problem.ts";
import {
  type ActorEnv,
  actorOf,
  requireActor,
  sessionActor,
} from "./http/session.ts";
import { parseJsonBody, parseValue } from "./http/validate.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface SettingsHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly memberUiState: MemberUiStateManagement;
  readonly personalization: PersonalizationManagement;
  readonly protectedSessions: ProtectedSessions;
  readonly settings: SettingsManagement;
}

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100),
}).strict();
const memberUiStateSchema = z.object({
  personWorkspaceView: z.enum([
    "all",
    "timeline",
    "planning",
    "things",
    "admin",
  ]).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
}).strict().refine(
  (value) =>
    value.personWorkspaceView !== undefined || value.theme !== undefined,
);

/**
 * The shape of a time zone, not its meaning.
 *
 * Whether the calendar can actually schedule in it is the settings use case's
 * question, because a stored zone decides when every reminder a member or
 * workspace owns comes due.
 */
const timezone = z.string().trim().min(1).max(100);
const locale = z.string().trim().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
  .max(35);
const preferencesSchema = z.object({
  contactNameOrder: z.enum([
    "given_family_nickname",
    "family_given_nickname",
  ]),
  contactSortOrder: z.enum(["given_name_asc", "family_name_asc"]),
  currencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  fluidLayout: z.boolean(),
  locale,
  measurementSystem: z.enum(["metric", "imperial"]),
  temperatureScale: z.enum(["celsius", "fahrenheit"]),
  timezone: timezone.optional(),
}).strict();
const workspaceSchema = z.object({
  defaultCurrencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/)
    .optional(),
  defaultLocale: locale,
  defaultReminderTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  defaultTimezone: timezone.optional(),
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100).optional(),
}).strict();
const memberSchema = z.object({
  role: z.enum(["owner", "admin", "member"]),
  status: z.enum(["active", "suspended"]),
}).strict();
const personalizationName = z.string().trim().min(1).max(200);
const personalizationOrder = z.number().int().min(0).max(10_000);
const personalizationDays = z.number().int().min(0).max(3650);
const expectedUpdatedAt = z.string().datetime({ offset: true });
const namedCreate = z.object({
  name: personalizationName,
  sortOrder: personalizationOrder.optional(),
}).strict();
const nameOnlyCreate = z.object({ name: personalizationName }).strict();
const relationshipCreate = z.object({
  forwardLabel: personalizationName,
  reverseLabel: personalizationName,
  sortOrder: personalizationOrder.optional(),
}).strict();
const reminderCreate = z.object({ daysBefore: personalizationDays }).strict();
const atLeastOneUpdate = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ expectedUpdatedAt, ...shape }).strict().refine(
    (value) => Object.keys(value).length > 1,
  );
const namedUpdate = atLeastOneUpdate({
  isActive: z.boolean().optional(),
  name: personalizationName.optional(),
  sortOrder: personalizationOrder.optional(),
});
const genderUpdate = atLeastOneUpdate({
  isActive: z.boolean().optional(),
  isDefault: z.literal(true).optional(),
  name: personalizationName.optional(),
  sortOrder: personalizationOrder.optional(),
});
const nameOnlyUpdate = atLeastOneUpdate({
  name: personalizationName.optional(),
});
const relationshipUpdate = atLeastOneUpdate({
  forwardLabel: personalizationName.optional(),
  isActive: z.boolean().optional(),
  reverseLabel: personalizationName.optional(),
  sortOrder: personalizationOrder.optional(),
}).refine(
  (value) =>
    (value.forwardLabel === undefined) === (value.reverseLabel === undefined),
);
const reminderUpdate = atLeastOneUpdate({
  daysBefore: personalizationDays.optional(),
  isActive: z.boolean().optional(),
});
const personalizationCreateSchema = (section: PersonalizationSection) => {
  if (section === "relationship-types") return relationshipCreate;
  if (section === "reminder-rules") return reminderCreate;
  if (section === "contact-labels" || section === "tags") {
    return nameOnlyCreate;
  }
  if (section === "emotion-options" || section === "pet-categories") {
    return z.never();
  }
  return namedCreate;
};
const personalizationUpdateSchema = (section: PersonalizationSection) => {
  if (section === "gender-options") return genderUpdate;
  if (section === "contact-labels" || section === "tags") {
    return nameOnlyUpdate;
  }
  if (section === "relationship-types") return relationshipUpdate;
  if (section === "reminder-rules") return reminderUpdate;
  if (section === "emotion-options" || section === "pet-categories") {
    return z.never();
  }
  return namedUpdate;
};
const personalizationDeleteSchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  replacementId: z.string().uuid().optional(),
}).strict();

const sessionId = z.string().uuid();
const memberId = z.string().uuid();
const personalizationId = z.string().uuid();

/** The message a time zone the calendar cannot resolve is refused with. */
const INVALID_TIMEZONE_MESSAGE = "Enter a valid IANA time zone.";
/** The message an unsupported currency is refused with. */
const INVALID_CURRENCY_MESSAGE = "Choose a supported currency.";

/** What a refused personalization change says. */
export const PERSONALIZATION_FAILURES: FailureTable = {
  fallback: {
    code: "personalization_unavailable",
    detail: "Personalization could not be updated.",
    status: 503,
    title: "Personalization unavailable",
  },
  statuses: {
    conflict: {
      code: "personalization_duplicate",
      detail: "Choose a unique name in this workspace.",
      title: "Name already used",
    },
    forbidden: {
      code: "personalization_forbidden",
      detail:
        "Only an active workspace owner or admin may manage personalization.",
      title: "Personalization forbidden",
    },
    invalid: {
      code: "validation_failed",
      detail: "That change is not supported by this section.",
      status: 400,
      title: "Invalid personalization change",
    },
    "not-found": {
      code: "personalization_not_found",
      detail: "That option does not belong to this active workspace.",
      title: "Option unavailable",
    },
    "replacement-conflict": {
      code: "personalization_replacement_conflict",
      detail:
        "Some records already use both the source and replacement options. Resolve the duplicate primary or relationship history before replacing this option.",
      status: 409,
      title: "Replacement conflicts with existing history",
    },
    "required-default": {
      code: "personalization_required_default",
      detail:
        "This required or seeded option can be disabled where supported, but cannot be deleted.",
      status: 409,
      title: "Required option",
    },
    stale: {
      code: "personalization_stale",
      detail: "Reload this section before applying another change.",
      status: 409,
      title: "Option changed",
    },
  },
};

const personalizationFailure = failureResponder(PERSONALIZATION_FAILURES);

/** The conflict that names how many records still point at an option. */
export function replacementRequired(
  referenceCount: number,
): ProblemDefinition {
  return {
    code: "personalization_replacement_required",
    detail:
      `${referenceCount} references must be moved before this option can be deleted.`,
    status: 409,
    title: "Replacement required",
  };
}

const UI_STATE_SESSION_INVALID: ProblemDefinition = {
  code: "member_ui_state_session_invalid",
  detail: "Sign in with an active workspace membership.",
  status: 401,
  title: "Authentication required",
};
const UI_STATE_ORIGIN_INVALID: ProblemDefinition = {
  code: "member_ui_state_origin_invalid",
  detail: "This request did not come from the configured application origin.",
  status: 403,
  title: "Request forbidden",
};
const UI_STATE_INVALID: ProblemDefinition = {
  code: "member_ui_state_validation_failed",
  detail: "Choose at least one recognised UI setting.",
  status: 400,
  title: "Invalid UI state",
};
const UI_STATE_FORBIDDEN: ProblemDefinition = {
  code: "member_ui_state_forbidden",
  detail: "The requested member UI state is not available in this workspace.",
  status: 403,
  title: "UI state unavailable",
};
const UI_STATE_NOT_LOADED: ProblemDefinition = {
  code: "member_ui_state_unavailable",
  detail: "Your member UI state could not be loaded.",
  status: 503,
  title: "UI state unavailable",
};
const UI_STATE_NOT_SAVED: ProblemDefinition = {
  code: "member_ui_state_unavailable",
  detail: "Your member UI state could not be saved.",
  status: 503,
  title: "UI state unavailable",
};
const PROFILE_NOT_LOADED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "Your profile could not be loaded.",
  status: 503,
  title: "Profile unavailable",
};
const PROFILE_NOT_SAVED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "Your profile could not be saved.",
  status: 503,
  title: "Profile unavailable",
};
const PROFILE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Provide a first name and valid profile values.",
  status: 400,
  title: "Invalid profile",
};
const PREFERENCES_NOT_LOADED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "Your preferences could not be loaded.",
  status: 503,
  title: "Preferences unavailable",
};
const PREFERENCES_NOT_SAVED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "Your preferences could not be saved.",
  status: 503,
  title: "Preferences unavailable",
};
const PREFERENCES_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the locale, time zone, regional, and display values.",
  status: 400,
  title: "Invalid preferences",
};
const SESSIONS_NOT_LOADED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "Your sessions could not be loaded.",
  status: 503,
  title: "Sessions unavailable",
};
const SESSION_STALE: ProblemDefinition = {
  code: "session_stale",
  detail: "That session is no longer active.",
  status: 404,
  title: "Session unavailable",
};
const SESSION_FORBIDDEN: ProblemDefinition = {
  code: "session_forbidden",
  detail: "You can revoke only your own sessions.",
  status: 403,
  title: "Session forbidden",
};
const SESSION_NOT_REVOKED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "That session could not be revoked.",
  status: 503,
  title: "Session unavailable",
};
const WORKSPACE_FORBIDDEN: ProblemDefinition = {
  code: "workspace_forbidden",
  detail:
    "Only an active workspace owner or admin may manage workspace settings.",
  status: 403,
  title: "Workspace settings forbidden",
};
const WORKSPACE_NOT_LOADED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "Workspace settings could not be loaded.",
  status: 503,
  title: "Workspace unavailable",
};
const WORKSPACE_NOT_SAVED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "Workspace settings could not be saved.",
  status: 503,
  title: "Workspace unavailable",
};
const WORKSPACE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the workspace identity and default values.",
  status: 400,
  title: "Invalid workspace settings",
};
const WORKSPACE_SLUG_CONFLICT: ProblemDefinition = {
  code: "workspace_slug_conflict",
  detail: "Choose another workspace slug.",
  status: 409,
  title: "Workspace slug unavailable",
};
const MEMBERS_FORBIDDEN: ProblemDefinition = {
  code: "members_forbidden",
  detail: "Only an active workspace owner or admin may manage members.",
  status: 403,
  title: "Members forbidden",
};
const MEMBERS_NOT_LOADED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "Workspace members could not be loaded.",
  status: 503,
  title: "Members unavailable",
};
const MEMBER_UPDATE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Choose a valid member role and active state.",
  status: 400,
  title: "Invalid member update",
};
const MEMBER_FORBIDDEN: ProblemDefinition = {
  code: "member_forbidden",
  detail: "Your role cannot apply that member change.",
  status: 403,
  title: "Member update forbidden",
};
const LAST_OWNER: ProblemDefinition = {
  code: "last_owner",
  detail: "At least one active workspace owner must remain.",
  status: 409,
  title: "Last owner protected",
};
const MEMBER_NOT_FOUND: ProblemDefinition = {
  code: "member_not_found",
  detail: "That member does not belong to this workspace.",
  status: 404,
  title: "Member unavailable",
};
const MEMBER_NOT_UPDATED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "That member could not be updated.",
  status: 503,
  title: "Member unavailable",
};
const SECTION_NOT_FOUND: ProblemDefinition = {
  code: "personalization_section_not_found",
  detail: "Use an accepted personalization section link.",
  status: 404,
  title: "Section unavailable",
};
const PERSONALIZATION_CREATE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Provide an accepted section, unique name, and valid order.",
  status: 400,
  title: "Invalid personalization option",
};
const PERSONALIZATION_UPDATE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Reload the option and provide valid values.",
  status: 400,
  title: "Invalid personalization option",
};
const PERSONALIZATION_DELETE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Reload the option and choose a valid replacement when required.",
  status: 400,
  title: "Invalid personalization deletion",
};

/** Every problem this file answers on its own, for the pinning suite. */
export const SETTINGS_PROBLEMS: readonly ProblemDefinition[] = [
  LAST_OWNER,
  MEMBER_FORBIDDEN,
  MEMBER_NOT_FOUND,
  MEMBER_NOT_UPDATED,
  MEMBER_UPDATE_INVALID,
  MEMBERS_FORBIDDEN,
  MEMBERS_NOT_LOADED,
  PERSONALIZATION_CREATE_INVALID,
  PERSONALIZATION_DELETE_INVALID,
  PERSONALIZATION_UPDATE_INVALID,
  PREFERENCES_INVALID,
  PREFERENCES_NOT_LOADED,
  PREFERENCES_NOT_SAVED,
  PROFILE_INVALID,
  PROFILE_NOT_LOADED,
  PROFILE_NOT_SAVED,
  SECTION_NOT_FOUND,
  SESSION_FORBIDDEN,
  SESSION_NOT_REVOKED,
  SESSION_STALE,
  SESSIONS_NOT_LOADED,
  UI_STATE_FORBIDDEN,
  UI_STATE_INVALID,
  UI_STATE_NOT_LOADED,
  UI_STATE_NOT_SAVED,
  UI_STATE_ORIGIN_INVALID,
  UI_STATE_SESSION_INVALID,
  WORKSPACE_FORBIDDEN,
  WORKSPACE_INVALID,
  WORKSPACE_NOT_LOADED,
  WORKSPACE_NOT_SAVED,
  WORKSPACE_SLUG_CONFLICT,
];

/**
 * The session token this request carries.
 *
 * Only the two session routes need it, and both have already required an
 * actor, which is only resolved from a cookie that is present.
 */
function currentSessionToken(context: Context): string {
  return cookieValue(context.req.header("Cookie"), SESSION_COOKIE) ?? "";
}

/** A private read, which is never cached anywhere. */
function privateJson(context: Context, value: unknown): Response {
  context.header("Cache-Control", "private, no-store");
  return context.json(value);
}

export function createSettingsRoutes(
  services: SettingsHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  routes.get("/api/v1/member/ui-state", session, async (context) => {
    const actor = await actorOf(context);
    if (!actor) return definedProblem(context, UI_STATE_SESSION_INVALID);
    const result = await services.memberUiState.read(actor).catch(
      () => undefined,
    );
    if (result?.status === "ready") return privateJson(context, result);
    return definedProblem(
      context,
      result?.status === "forbidden" ? UI_STATE_FORBIDDEN : UI_STATE_NOT_LOADED,
    );
  });

  routes.patch("/api/v1/member/ui-state", session, async (context) => {
    if (!matchingOrigin(context, services.browserSecurity)) {
      return definedProblem(context, UI_STATE_ORIGIN_INVALID);
    }
    const parsed = await parseJsonBody(context, memberUiStateSchema);
    if ("errors" in parsed) {
      return definedProblem(context, UI_STATE_INVALID);
    }
    const actor = await actorOf(context);
    if (!actor) return definedProblem(context, UI_STATE_SESSION_INVALID);
    const input: MemberUiState = {
      ...(parsed.data.personWorkspaceView === undefined
        ? {}
        : { personWorkspaceView: parsed.data.personWorkspaceView }),
      ...(parsed.data.theme === undefined ? {} : { theme: parsed.data.theme }),
    };
    const result = await services.memberUiState.save(actor, input)
      .catch(() => undefined);
    if (result?.status === "ready") return privateJson(context, result);
    return definedProblem(
      context,
      result?.status === "forbidden" ? UI_STATE_FORBIDDEN : UI_STATE_NOT_SAVED,
    );
  });

  routes.get("/api/v1/settings/profile", session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const profile = await services.settings.getProfile(actor).catch(
      () => undefined,
    );
    return profile
      ? privateJson(context, { profile, status: "ready" })
      : definedProblem(context, PROFILE_NOT_LOADED);
  });

  routes.put("/api/v1/settings/profile", origin, session, async (context) => {
    const parsed = await parseJsonBody(context, profileSchema);
    if ("errors" in parsed) {
      return definedProblem(context, PROFILE_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.settings.updateProfile(actor, parsed.data)
      .catch(() => undefined);
    return result?.status === "ready"
      ? privateJson(context, result)
      : definedProblem(context, PROFILE_NOT_SAVED);
  });

  routes.get("/api/v1/settings/preferences", session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const value = await services.settings.getPreferences(actor).catch(
      () => undefined,
    );
    return value
      ? privateJson(context, { preferences: value, status: "ready" })
      : definedProblem(context, PREFERENCES_NOT_LOADED);
  });

  routes.put(
    "/api/v1/settings/preferences",
    origin,
    session,
    async (context) => {
      const parsed = await parseJsonBody(context, preferencesSchema);
      if ("errors" in parsed) {
        return definedProblem(context, PREFERENCES_INVALID, parsed.errors);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.settings.updatePreferences(actor, {
        contactNameOrder: parsed.data.contactNameOrder,
        contactSortOrder: parsed.data.contactSortOrder,
        ...(parsed.data.currencyCode
          ? { currencyCode: parsed.data.currencyCode }
          : {}),
        fluidLayout: parsed.data.fluidLayout,
        locale: parsed.data.locale,
        measurementSystem: parsed.data.measurementSystem,
        temperatureScale: parsed.data.temperatureScale,
        ...(parsed.data.timezone ? { timezone: parsed.data.timezone } : {}),
      }).catch(() => undefined);
      const rejected = rejectedPreference(result?.status);
      if (rejected) {
        return definedProblem(context, PREFERENCES_INVALID, rejected);
      }
      return result?.status === "ready"
        ? privateJson(context, result)
        : definedProblem(context, PREFERENCES_NOT_SAVED);
    },
  );

  routes.get("/api/v1/settings/sessions", session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const sessions = await services.settings.listSessions(
      actor,
      currentSessionToken(context),
    ).catch(() => undefined);
    return sessions
      ? privateJson(context, {
        sessions: sessions.map((item) => ({
          ...item,
          createdAt: item.createdAt.toISOString(),
          expiresAt: item.expiresAt.toISOString(),
          lastSeenAt: item.lastSeenAt.toISOString(),
        })),
        status: "ready",
      })
      : definedProblem(context, SESSIONS_NOT_LOADED);
  });

  routes.delete(
    "/api/v1/settings/sessions/:sessionId",
    origin,
    session,
    async (context) => {
      const parsedId = parseValue(sessionId, context.req.param("sessionId"));
      if ("errors" in parsedId) {
        return definedProblem(context, SESSION_STALE);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.settings.revokeSession(
        actor,
        currentSessionToken(context),
        parsedId.data,
      ).catch(() => undefined);
      if (!result) return definedProblem(context, SESSION_NOT_REVOKED);
      if (result.status !== "revoked") {
        return definedProblem(
          context,
          result.status === "forbidden" ? SESSION_FORBIDDEN : SESSION_STALE,
        );
      }
      if (result.current) {
        context.header(
          "Set-Cookie",
          setCookie(services.browserSecurity, {
            maxAgeSeconds: 0,
            name: SESSION_COOKIE,
            path: "/",
            value: "",
          }),
        );
      }
      return privateJson(context, {
        current: result.current,
        status: "revoked",
      });
    },
  );

  routes.get("/api/v1/settings/workspace", session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.settings.getWorkspace(actor).catch(
      () => undefined,
    );
    if (result === "forbidden") {
      return definedProblem(context, WORKSPACE_FORBIDDEN);
    }
    return result
      ? privateJson(context, { status: "ready", workspace: result })
      : definedProblem(context, WORKSPACE_NOT_LOADED);
  });

  routes.put("/api/v1/settings/workspace", origin, session, async (context) => {
    const parsed = await parseJsonBody(context, workspaceSchema);
    if ("errors" in parsed) {
      return definedProblem(context, WORKSPACE_INVALID, parsed.errors);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.settings.updateWorkspace(actor, {
      ...(parsed.data.defaultCurrencyCode
        ? { defaultCurrencyCode: parsed.data.defaultCurrencyCode }
        : {}),
      defaultLocale: parsed.data.defaultLocale,
      defaultReminderTime: parsed.data.defaultReminderTime,
      ...(parsed.data.defaultTimezone
        ? { defaultTimezone: parsed.data.defaultTimezone }
        : {}),
      name: parsed.data.name,
      ...(parsed.data.slug ? { slug: parsed.data.slug } : {}),
    }).catch(() => undefined);
    if (result === "forbidden") {
      return definedProblem(context, WORKSPACE_FORBIDDEN);
    }
    if (result === "conflict") {
      return definedProblem(context, WORKSPACE_SLUG_CONFLICT);
    }
    const rejected = rejectedWorkspaceDefault(result);
    if (rejected) {
      return definedProblem(context, WORKSPACE_INVALID, rejected);
    }
    return result
      ? privateJson(context, { status: "ready", workspace: result })
      : definedProblem(context, WORKSPACE_NOT_SAVED);
  });

  routes.get("/api/v1/settings/members", session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.settings.listMembers(actor).catch(
      () => undefined,
    );
    if (result === "forbidden") {
      return definedProblem(context, MEMBERS_FORBIDDEN);
    }
    return result
      ? privateJson(context, { members: result, status: "ready" })
      : definedProblem(context, MEMBERS_NOT_LOADED);
  });

  routes.patch(
    "/api/v1/settings/members/:memberId",
    origin,
    session,
    async (context) => {
      const target = parseValue(memberId, context.req.param("memberId"));
      const parsed = await parseJsonBody(context, memberSchema);
      if ("errors" in target || "errors" in parsed) {
        return definedProblem(context, MEMBER_UPDATE_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.settings.updateMember(
        actor,
        target.data,
        parsed.data,
      ).catch(() => undefined);
      if (result === "forbidden") {
        return definedProblem(context, MEMBER_FORBIDDEN);
      }
      if (result === "last-owner") return definedProblem(context, LAST_OWNER);
      if (result === "not-found") {
        return definedProblem(context, MEMBER_NOT_FOUND);
      }
      return result
        ? privateJson(context, { member: result, status: "ready" })
        : definedProblem(context, MEMBER_NOT_UPDATED);
    },
  );

  const section = (context: Context): PersonalizationSection | undefined => {
    const value = context.req.param("section");
    return value && services.personalization.isSection(value)
      ? value
      : undefined;
  };
  const refusedPersonalization = (
    context: Context,
    result: { readonly referenceCount?: number; readonly status: string },
  ): Response =>
    result.status === "replacement-required"
      ? definedProblem(
        context,
        replacementRequired(result.referenceCount ?? 0),
      )
      : personalizationFailure(context, result);

  routes.get(
    "/api/v1/settings/personalization/:section",
    session,
    async (context) => {
      const selected = section(context);
      if (!selected) return definedProblem(context, SECTION_NOT_FOUND);
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.personalization.list(actor, selected)
        .catch(() => undefined);
      return result?.status === "ready"
        ? privateJson(context, {
          capabilities: result.capabilities,
          entries: result.entries,
          readOnly: result.readOnly,
          section: selected,
          status: "ready",
        })
        : refusedPersonalization(context, result ?? { status: "unavailable" });
    },
  );

  routes.post(
    "/api/v1/settings/personalization/:section",
    origin,
    session,
    async (context) => {
      const selected = section(context);
      const parsed = selected
        ? await parseJsonBody(context, personalizationCreateSchema(selected))
        : undefined;
      if (!selected || !parsed || "errors" in parsed) {
        return definedProblem(context, PERSONALIZATION_CREATE_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const data = parsed.data as {
        readonly daysBefore?: number;
        readonly forwardLabel?: string;
        readonly name?: string;
        readonly reverseLabel?: string;
        readonly sortOrder?: number;
      };
      const result = await services.personalization.mutate(actor, selected, {
        action: "create",
        ...(data.daysBefore === undefined
          ? {}
          : { daysBefore: data.daysBefore }),
        ...(data.forwardLabel === undefined
          ? {}
          : { forwardLabel: data.forwardLabel }),
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.reverseLabel === undefined
          ? {}
          : { reverseLabel: data.reverseLabel }),
        sortOrder: data.sortOrder ?? 0,
      }).catch(() => undefined);
      return result?.status === "saved"
        ? privateJson(context, result)
        : refusedPersonalization(context, result ?? { status: "unavailable" });
    },
  );

  routes.patch(
    "/api/v1/settings/personalization/:section/:id",
    origin,
    session,
    async (context) => {
      const selected = section(context);
      const id = parseValue(personalizationId, context.req.param("id"));
      const parsed = selected
        ? await parseJsonBody(context, personalizationUpdateSchema(selected))
        : undefined;
      if (!selected || "errors" in id || !parsed || "errors" in parsed) {
        return definedProblem(context, PERSONALIZATION_UPDATE_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const data = parsed.data as {
        readonly daysBefore?: number;
        readonly expectedUpdatedAt: string;
        readonly forwardLabel?: string;
        readonly isActive?: boolean;
        readonly isDefault?: true;
        readonly name?: string;
        readonly reverseLabel?: string;
        readonly sortOrder?: number;
      };
      const result = await services.personalization.mutate(actor, selected, {
        action: "update",
        expectedUpdatedAt: data.expectedUpdatedAt,
        id: id.data,
        ...(data.isActive === undefined ? {} : { isActive: data.isActive }),
        ...(data.isDefault === undefined ? {} : { isDefault: data.isDefault }),
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.daysBefore === undefined
          ? {}
          : { daysBefore: data.daysBefore }),
        ...(data.forwardLabel === undefined
          ? {}
          : { forwardLabel: data.forwardLabel }),
        ...(data.reverseLabel === undefined
          ? {}
          : { reverseLabel: data.reverseLabel }),
        ...(data.sortOrder === undefined ? {} : { sortOrder: data.sortOrder }),
      }).catch(() => undefined);
      return result?.status === "saved"
        ? privateJson(context, result)
        : refusedPersonalization(context, result ?? { status: "unavailable" });
    },
  );

  routes.delete(
    "/api/v1/settings/personalization/:section/:id",
    origin,
    session,
    async (context) => {
      const selected = section(context);
      const id = parseValue(personalizationId, context.req.param("id"));
      const parsed = parseValue(personalizationDeleteSchema, {
        expectedUpdatedAt: context.req.query("expectedUpdatedAt"),
        replacementId: context.req.query("replacementId"),
      });
      if (!selected || "errors" in id || "errors" in parsed) {
        return definedProblem(context, PERSONALIZATION_DELETE_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.personalization.mutate(actor, selected, {
        action: "delete",
        expectedUpdatedAt: parsed.data.expectedUpdatedAt,
        id: id.data,
        ...(parsed.data.replacementId
          ? { replacementId: parsed.data.replacementId }
          : {}),
      }).catch(() => undefined);
      return result?.status === "deleted"
        ? privateJson(context, result)
        : refusedPersonalization(context, result ?? { status: "unavailable" });
    },
  );
  return routes;
}

/** The field a refused preferences save names, if it named one. */
function rejectedPreference(
  status: string | undefined,
): ProblemErrors | undefined {
  if (status === "invalid-currency") {
    return { currencyCode: INVALID_CURRENCY_MESSAGE };
  }
  return status === "invalid-timezone"
    ? { timezone: INVALID_TIMEZONE_MESSAGE }
    : undefined;
}

/** The same, for the workspace defaults. */
function rejectedWorkspaceDefault(
  result: unknown,
): ProblemErrors | undefined {
  if (result === "invalid-currency") {
    return { defaultCurrencyCode: INVALID_CURRENCY_MESSAGE };
  }
  return result === "invalid-timezone"
    ? { defaultTimezone: INVALID_TIMEZONE_MESSAGE }
    : undefined;
}
