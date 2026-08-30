import { type Context, Hono } from "hono";
import { z } from "zod";
import type {
  createProtectedSessionCoordinator,
  MemberUiStateManagement,
  PersonalizationManagement,
  PersonalizationSection,
  SettingsManagement,
} from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

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
  ]),
}).strict();

const timezone = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, { message: "Enter a valid IANA time zone." });
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

function validationErrors(error: z.ZodError): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !(field in errors)) {
      errors[field] = issue.message;
    }
  }
  return errors;
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

async function actor(context: Context, services: SettingsHttpServices) {
  const currentToken = cookieValue(
    context.req.header("Cookie"),
    "kinship_session",
  );
  if (!currentToken) return undefined;
  const requestedWorkspaceId = context.req.header("X-Workspace-Id");
  const resolved = await services.protectedSessions.resolve({
    sessionToken: currentToken,
    ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
  }).catch(() => undefined);
  return resolved
    ? {
      actor: {
        memberId: resolved.memberId,
        role: resolved.role,
        userId: resolved.userId,
        workspaceId: resolved.workspaceId,
      },
      currentToken,
    }
    : undefined;
}

function authenticationRequired(context: Context): Response {
  return problem(
    context,
    401,
    "session_invalid",
    "Authentication required",
    "Sign in with an active workspace membership.",
  );
}

function privateJson(context: Context, value: unknown): Response {
  context.header("Cache-Control", "private, no-store");
  return context.json(value);
}

export function createSettingsRoutes(services: SettingsHttpServices): Hono {
  const routes = new Hono();
  routes.get("/api/v1/member/ui-state", async (context) => {
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "member_ui_state_session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.memberUiState.read(resolved.actor).catch(
      () => undefined,
    );
    if (result?.status === "ready") return privateJson(context, result);
    return result?.status === "forbidden"
      ? problem(
        context,
        403,
        "member_ui_state_forbidden",
        "UI state unavailable",
        "The requested member UI state is not available in this workspace.",
      )
      : problem(
        context,
        503,
        "member_ui_state_unavailable",
        "UI state unavailable",
        "Your member UI state could not be loaded.",
      );
  });
  routes.patch("/api/v1/member/ui-state", async (context) => {
    if (context.req.header("Origin") !== services.browserSecurity.origin) {
      return problem(
        context,
        403,
        "member_ui_state_origin_invalid",
        "Request forbidden",
        "This request did not come from the configured application origin.",
      );
    }
    const parsed = memberUiStateSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "member_ui_state_validation_failed",
        "Invalid UI state",
        "Choose one recognised person-workspace view.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "member_ui_state_session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.memberUiState.save(
      resolved.actor,
      parsed.data,
    ).catch(() => undefined);
    if (result?.status === "ready") return privateJson(context, result);
    return result?.status === "forbidden"
      ? problem(
        context,
        403,
        "member_ui_state_forbidden",
        "UI state unavailable",
        "The requested member UI state is not available in this workspace.",
      )
      : problem(
        context,
        503,
        "member_ui_state_unavailable",
        "UI state unavailable",
        "Your member UI state could not be saved.",
      );
  });
  routes.get("/api/v1/settings/profile", async (context) => {
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const profile = await services.settings.getProfile(resolved.actor).catch(
      () => undefined,
    );
    return profile
      ? privateJson(context, { profile, status: "ready" })
      : problem(
        context,
        503,
        "settings_unavailable",
        "Profile unavailable",
        "Your profile could not be loaded.",
      );
  });
  routes.put("/api/v1/settings/profile", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsed = profileSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid profile",
        "Provide a first name and valid profile values.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.settings.updateProfile(
      resolved.actor,
      parsed.data,
    ).catch(() => undefined);
    return result?.status === "ready" ? privateJson(context, result) : problem(
      context,
      503,
      "settings_unavailable",
      "Profile unavailable",
      "Your profile could not be saved.",
    );
  });
  routes.get("/api/v1/settings/preferences", async (context) => {
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const value = await services.settings.getPreferences(resolved.actor).catch(
      () => undefined,
    );
    return value
      ? privateJson(context, { preferences: value, status: "ready" })
      : problem(
        context,
        503,
        "settings_unavailable",
        "Preferences unavailable",
        "Your preferences could not be loaded.",
      );
  });
  routes.put("/api/v1/settings/preferences", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsed = preferencesSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid preferences",
        "Review the locale, time zone, regional, and display values.",
        validationErrors(parsed.error),
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.settings.updatePreferences(
      resolved.actor,
      {
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
      },
    ).catch(() => undefined);
    if (result?.status === "invalid-currency") {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid preferences",
        "Review the locale, time zone, regional, and display values.",
        { currencyCode: "Choose a supported currency." },
      );
    }
    return result?.status === "ready" ? privateJson(context, result) : problem(
      context,
      503,
      "settings_unavailable",
      "Preferences unavailable",
      "Your preferences could not be saved.",
    );
  });
  routes.get("/api/v1/settings/sessions", async (context) => {
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const sessions = await services.settings.listSessions(
      resolved.actor,
      resolved.currentToken,
    ).catch(() => undefined);
    return sessions
      ? privateJson(context, {
        sessions: sessions.map((session) => ({
          ...session,
          createdAt: session.createdAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          lastSeenAt: session.lastSeenAt.toISOString(),
        })),
        status: "ready",
      })
      : problem(
        context,
        503,
        "settings_unavailable",
        "Sessions unavailable",
        "Your sessions could not be loaded.",
      );
  });
  routes.delete("/api/v1/settings/sessions/:sessionId", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsedId = z.string().uuid().safeParse(
      context.req.param("sessionId"),
    );
    if (!parsedId.success) {
      return problem(
        context,
        404,
        "session_stale",
        "Session unavailable",
        "That session is no longer active.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.settings.revokeSession(
      resolved.actor,
      resolved.currentToken,
      parsedId.data,
    ).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "settings_unavailable",
        "Session unavailable",
        "That session could not be revoked.",
      );
    }
    if (result.status !== "revoked") {
      return result.status === "forbidden"
        ? problem(
          context,
          403,
          "session_forbidden",
          "Session forbidden",
          "You can revoke only your own sessions.",
        )
        : problem(
          context,
          404,
          "session_stale",
          "Session unavailable",
          "That session is no longer active.",
        );
    }
    if (result.current) {
      context.header(
        "Set-Cookie",
        `kinship_session=; HttpOnly; SameSite=Strict; ${
          services.browserSecurity.secureCookie ? "Secure; " : ""
        }Max-Age=0; Path=/`,
      );
    }
    return privateJson(context, {
      current: result.current,
      status: "revoked",
    });
  });
  routes.get("/api/v1/settings/workspace", async (context) => {
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.settings.getWorkspace(resolved.actor).catch(
      () => undefined,
    );
    if (result === "forbidden") {
      return problem(
        context,
        403,
        "workspace_forbidden",
        "Workspace settings forbidden",
        "Only an active workspace owner or admin may manage workspace settings.",
      );
    }
    return result
      ? privateJson(context, { status: "ready", workspace: result })
      : problem(
        context,
        503,
        "settings_unavailable",
        "Workspace unavailable",
        "Workspace settings could not be loaded.",
      );
  });
  routes.put("/api/v1/settings/workspace", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsed = workspaceSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid workspace settings",
        "Review the workspace identity and default values.",
        validationErrors(parsed.error),
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.settings.updateWorkspace(
      resolved.actor,
      {
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
      },
    ).catch(() => undefined);
    if (result === "forbidden") {
      return problem(
        context,
        403,
        "workspace_forbidden",
        "Workspace settings forbidden",
        "Only an active workspace owner or admin may manage workspace settings.",
      );
    }
    if (result === "conflict") {
      return problem(
        context,
        409,
        "workspace_slug_conflict",
        "Workspace slug unavailable",
        "Choose another workspace slug.",
      );
    }
    if (result === "invalid-currency") {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid workspace settings",
        "Review the workspace identity and default values.",
        { defaultCurrencyCode: "Choose a supported currency." },
      );
    }
    return result
      ? privateJson(context, { status: "ready", workspace: result })
      : problem(
        context,
        503,
        "settings_unavailable",
        "Workspace unavailable",
        "Workspace settings could not be saved.",
      );
  });
  routes.get("/api/v1/settings/members", async (context) => {
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.settings.listMembers(resolved.actor).catch(
      () => undefined,
    );
    if (result === "forbidden") {
      return problem(
        context,
        403,
        "members_forbidden",
        "Members forbidden",
        "Only an active workspace owner or admin may manage members.",
      );
    }
    return result
      ? privateJson(context, { members: result, status: "ready" })
      : problem(
        context,
        503,
        "settings_unavailable",
        "Members unavailable",
        "Workspace members could not be loaded.",
      );
  });
  routes.patch("/api/v1/settings/members/:memberId", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const memberId = z.string().uuid().safeParse(context.req.param("memberId"));
    const parsed = memberSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!memberId.success || !parsed.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid member update",
        "Choose a valid member role and active state.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.settings.updateMember(
      resolved.actor,
      memberId.data,
      parsed.data,
    ).catch(() => undefined);
    if (result === "forbidden") {
      return problem(
        context,
        403,
        "member_forbidden",
        "Member update forbidden",
        "Your role cannot apply that member change.",
      );
    }
    if (result === "last-owner") {
      return problem(
        context,
        409,
        "last_owner",
        "Last owner protected",
        "At least one active workspace owner must remain.",
      );
    }
    if (result === "not-found") {
      return problem(
        context,
        404,
        "member_not_found",
        "Member unavailable",
        "That member does not belong to this workspace.",
      );
    }
    return result
      ? privateJson(context, { member: result, status: "ready" })
      : problem(
        context,
        503,
        "settings_unavailable",
        "Member unavailable",
        "That member could not be updated.",
      );
  });
  const section = (context: Context) => {
    const value = context.req.param("section");
    return value && services.personalization.isSection(value)
      ? value
      : undefined;
  };
  const personalizationProblem = (
    context: Context,
    result: { readonly status: string; readonly referenceCount?: number },
  ): Response => {
    switch (result.status) {
      case "forbidden":
        return problem(
          context,
          403,
          "personalization_forbidden",
          "Personalization forbidden",
          "Only an active workspace owner or admin may manage personalization.",
        );
      case "not-found":
        return problem(
          context,
          404,
          "personalization_not_found",
          "Option unavailable",
          "That option does not belong to this active workspace.",
        );
      case "stale":
        return problem(
          context,
          409,
          "personalization_stale",
          "Option changed",
          "Reload this section before applying another change.",
        );
      case "conflict":
        return problem(
          context,
          409,
          "personalization_duplicate",
          "Name already used",
          "Choose a unique name in this workspace.",
        );
      case "replacement-required":
        return problem(
          context,
          409,
          "personalization_replacement_required",
          "Replacement required",
          `${
            result.referenceCount ?? 0
          } references must be moved before this option can be deleted.`,
        );
      case "replacement-conflict":
        return problem(
          context,
          409,
          "personalization_replacement_conflict",
          "Replacement conflicts with existing history",
          "Some records already use both the source and replacement options. Resolve the duplicate primary or relationship history before replacing this option.",
        );
      case "required-default":
        return problem(
          context,
          409,
          "personalization_required_default",
          "Required option",
          "This required or seeded option can be disabled where supported, but cannot be deleted.",
        );
      case "invalid":
        return problem(
          context,
          400,
          "validation_failed",
          "Invalid personalization change",
          "That change is not supported by this section.",
        );
      default:
        return problem(
          context,
          503,
          "personalization_unavailable",
          "Personalization unavailable",
          "Personalization could not be updated.",
        );
    }
  };
  routes.get("/api/v1/settings/personalization/:section", async (context) => {
    const selected = section(context);
    if (!selected) {
      return problem(
        context,
        404,
        "personalization_section_not_found",
        "Section unavailable",
        "Use an accepted personalization section link.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.personalization.list(resolved.actor, selected)
      .catch(() => undefined);
    return result?.status === "ready"
      ? privateJson(context, {
        capabilities: result.capabilities,
        entries: result.entries,
        readOnly: result.readOnly,
        section: selected,
        status: "ready",
      })
      : personalizationProblem(context, result ?? { status: "unavailable" });
  });
  routes.post("/api/v1/settings/personalization/:section", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const selected = section(context);
    const parsed = selected
      ? personalizationCreateSchema(selected).safeParse(
        await context.req.json().catch(() => undefined),
      )
      : undefined;
    if (!selected || !parsed?.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid personalization option",
        "Provide an accepted section, unique name, and valid order.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const data = parsed.data as {
      readonly daysBefore?: number;
      readonly forwardLabel?: string;
      readonly name?: string;
      readonly reverseLabel?: string;
      readonly sortOrder?: number;
    };
    const result = await services.personalization.mutate(
      resolved.actor,
      selected,
      {
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
      },
    ).catch(() => undefined);
    return result?.status === "saved"
      ? privateJson(context, result)
      : personalizationProblem(context, result ?? { status: "unavailable" });
  });
  routes.patch(
    "/api/v1/settings/personalization/:section/:id",
    async (context) => {
      const forbidden = requireOrigin(context, services.browserSecurity);
      if (forbidden) return forbidden;
      const selected = section(context);
      const id = z.string().uuid().safeParse(context.req.param("id"));
      const parsed = selected
        ? personalizationUpdateSchema(selected).safeParse(
          await context.req.json().catch(() => undefined),
        )
        : undefined;
      if (!selected || !id.success || !parsed?.success) {
        return problem(
          context,
          400,
          "validation_failed",
          "Invalid personalization option",
          "Reload the option and provide valid values.",
        );
      }
      const resolved = await actor(context, services);
      if (!resolved) return authenticationRequired(context);
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
      const result = await services.personalization.mutate(
        resolved.actor,
        selected,
        {
          action: "update",
          expectedUpdatedAt: data.expectedUpdatedAt,
          id: id.data,
          ...(data.isActive === undefined ? {} : { isActive: data.isActive }),
          ...(data.isDefault === undefined
            ? {}
            : { isDefault: data.isDefault }),
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
          ...(data.sortOrder === undefined
            ? {}
            : { sortOrder: data.sortOrder }),
        },
      ).catch(() => undefined);
      return result?.status === "saved"
        ? privateJson(context, result)
        : personalizationProblem(context, result ?? { status: "unavailable" });
    },
  );
  routes.delete(
    "/api/v1/settings/personalization/:section/:id",
    async (context) => {
      const forbidden = requireOrigin(context, services.browserSecurity);
      if (forbidden) return forbidden;
      const selected = section(context);
      const id = z.string().uuid().safeParse(context.req.param("id"));
      const parsed = personalizationDeleteSchema.safeParse({
        expectedUpdatedAt: context.req.query("expectedUpdatedAt"),
        replacementId: context.req.query("replacementId"),
      });
      if (!selected || !id.success || !parsed.success) {
        return problem(
          context,
          400,
          "validation_failed",
          "Invalid personalization deletion",
          "Reload the option and choose a valid replacement when required.",
        );
      }
      const resolved = await actor(context, services);
      if (!resolved) return authenticationRequired(context);
      const result = await services.personalization.mutate(
        resolved.actor,
        selected,
        {
          action: "delete",
          expectedUpdatedAt: parsed.data.expectedUpdatedAt,
          id: id.data,
          ...(parsed.data.replacementId
            ? { replacementId: parsed.data.replacementId }
            : {}),
        },
      ).catch(() => undefined);
      return result?.status === "deleted"
        ? privateJson(context, result)
        : personalizationProblem(context, result ?? { status: "unavailable" });
    },
  );
  return routes;
}
