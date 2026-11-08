/**
 * The workspace's identity and the defaults every member inherits.
 *
 * Only an active owner or admin may read this, which is why the refusal is a
 * role problem rather than an empty form: a member who opens the page is told
 * the page is not theirs rather than shown a workspace with nothing in it.
 *
 * The slug is the one field that can collide with another workspace, and it
 * says so on its own.
 */

import { Hono } from "hono";
import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from "../../../../../../contracts/routes/settings.ts";
import { workspaceSettingsInput } from "../../../../../../contracts/schemas/settings.ts";
import { requireMatchingOrigin } from "../../../../../../http-kit/origin.ts";
import {
  definedProblem,
  type ProblemDefinition,
  type ProblemErrors,
} from "../../../../../../http-kit/problem.ts";
import { mount } from "../../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  requireActor,
  sessionActor,
} from "../../../../../../http-kit/session.ts";
import { parseJsonBody } from "../../../../../../http-kit/validate.ts";
import {
  INVALID_CURRENCY_MESSAGE,
  INVALID_TIMEZONE_MESSAGE,
  privateJson,
  type SettingsHttpServices,
} from "./shared.ts";

/** What the workspace's own settings are served from. */
export type WorkspaceSettingsHttpServices = Pick<
  SettingsHttpServices,
  "browserSecurity" | "protectedSessions" | "settings"
>;

export const WORKSPACE_FORBIDDEN: ProblemDefinition = {
  code: "workspace_forbidden",
  detail:
    "Only an active workspace owner or admin may manage workspace settings.",
  status: 403,
  title: "Workspace settings forbidden",
};
export const WORKSPACE_NOT_LOADED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "Workspace settings could not be loaded.",
  status: 503,
  title: "Workspace unavailable",
};
export const WORKSPACE_NOT_SAVED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "Workspace settings could not be saved.",
  status: 503,
  title: "Workspace unavailable",
};
export const WORKSPACE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the workspace identity and default values.",
  status: 400,
  title: "Invalid workspace settings",
};
export const WORKSPACE_SLUG_CONFLICT: ProblemDefinition = {
  code: "workspace_slug_conflict",
  detail: "Choose another workspace slug.",
  status: 409,
  title: "Workspace slug unavailable",
};

export function createWorkspaceRoutes(
  services: WorkspaceSettingsHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services);
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(routes, getWorkspaceSettings, session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    // Both reads run at once, but the refusal answers on its own: a failed
    // currency read must not turn a refused member into an outage (AUD-K5).
    const [workspace, currencies] = await Promise.allSettled([
      services.settings.getWorkspace(actor),
      services.settings.listCurrencies(actor),
    ]);
    const result = workspace.status === "fulfilled"
      ? workspace.value
      : undefined;
    const supportedCurrencyCodes = currencies.status === "fulfilled"
      ? currencies.value
      : undefined;
    if (result === "forbidden") {
      return definedProblem(context, WORKSPACE_FORBIDDEN);
    }
    return result && supportedCurrencyCodes
      ? privateJson(context, {
        status: "ready",
        supportedCurrencyCodes,
        workspace: result,
      })
      : definedProblem(context, WORKSPACE_NOT_LOADED);
  });

  mount(routes, updateWorkspaceSettings, origin, session, async (context) => {
    const parsed = await parseJsonBody(context, workspaceSettingsInput);
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
  return routes;
}

/** The field a refused workspace save names, if it named one. */
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
