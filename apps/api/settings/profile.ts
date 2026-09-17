/**
 * The member's own name, read and saved.
 *
 * The smallest surface on the settings page: two routes over the two fields a
 * member is addressed by. The email address is read here but changed through
 * the identity flow, which owns the verification that has to go with it.
 */

import { Hono } from "hono";
import { z } from "zod";
import { requireMatchingOrigin } from "../http/origin.ts";
import { definedProblem, type ProblemDefinition } from "../http/problem.ts";
import { type ActorEnv, requireActor, sessionActor } from "../http/session.ts";
import { parseJsonBody } from "../http/validate.ts";
import { privateJson, type SettingsHttpServices } from "./shared.ts";

/** What a member's own profile is served from. */
export type MemberProfileHttpServices = Pick<
  SettingsHttpServices,
  "browserSecurity" | "protectedSessions" | "settings"
>;

const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100),
}).strict();

export const PROFILE_NOT_LOADED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "Your profile could not be loaded.",
  status: 503,
  title: "Profile unavailable",
};
export const PROFILE_NOT_SAVED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "Your profile could not be saved.",
  status: 503,
  title: "Profile unavailable",
};
export const PROFILE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Provide a first name and valid profile values.",
  status: 400,
  title: "Invalid profile",
};

export function createProfileRoutes(
  services: MemberProfileHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

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
  return routes;
}
