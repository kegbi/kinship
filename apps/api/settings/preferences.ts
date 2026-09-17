/**
 * How a member wants the application to read: names, units, locale, zone.
 *
 * The route parses shape and nothing else. Whether the calendar can actually
 * schedule in a time zone, and whether a currency is one this deployment
 * supports, are the settings use case's questions (GAP-020); this file only
 * turns its two refusals back into the field the form marks.
 */

import { Hono } from "hono";
import {
  getMemberPreferences,
  updateMemberPreferences,
} from "../../../packages/contracts/routes/settings.ts";
import { preferencesInput } from "../../../packages/contracts/schemas/settings.ts";
import { requireMatchingOrigin } from "../http/origin.ts";
import {
  definedProblem,
  type ProblemDefinition,
  type ProblemErrors,
} from "../http/problem.ts";
import { mount } from "../http/route.ts";
import { type ActorEnv, requireActor, sessionActor } from "../http/session.ts";
import { parseJsonBody } from "../http/validate.ts";
import {
  INVALID_CURRENCY_MESSAGE,
  INVALID_TIMEZONE_MESSAGE,
  privateJson,
  type SettingsHttpServices,
} from "./shared.ts";

/** What a member's own preferences are served from. */
export type MemberPreferencesHttpServices = Pick<
  SettingsHttpServices,
  "browserSecurity" | "protectedSessions" | "settings"
>;

export const PREFERENCES_NOT_LOADED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "Your preferences could not be loaded.",
  status: 503,
  title: "Preferences unavailable",
};
export const PREFERENCES_NOT_SAVED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "Your preferences could not be saved.",
  status: 503,
  title: "Preferences unavailable",
};
export const PREFERENCES_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Review the locale, time zone, regional, and display values.",
  status: 400,
  title: "Invalid preferences",
};

export function createPreferencesRoutes(
  services: MemberPreferencesHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(routes, getMemberPreferences, session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const value = await services.settings.getPreferences(actor).catch(
      () => undefined,
    );
    return value
      ? privateJson(context, { preferences: value, status: "ready" })
      : definedProblem(context, PREFERENCES_NOT_LOADED);
  });

  mount(
    routes,
    updateMemberPreferences,
    origin,
    session,
    async (context) => {
      const parsed = await parseJsonBody(context, preferencesInput);
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
