/**
 * Who belongs to this workspace, and what each of them may do.
 *
 * Two routes an owner or admin reaches. The rule the second one exists for is
 * that a workspace can never lose its last active owner, and the refusal says
 * exactly that rather than reporting a generic validation failure, because
 * the person who tried it needs to know what to do instead.
 */

import { Hono } from "hono";
import {
  listManagedMembers,
  updateManagedMember,
} from "../../../packages/contracts/routes/settings.ts";
import { memberUpdateInput } from "../../../packages/contracts/schemas/settings.ts";
import { uuid } from "../../../packages/contracts/schemas/shared.ts";
import { requireMatchingOrigin } from "../http/origin.ts";
import { definedProblem, type ProblemDefinition } from "../http/problem.ts";
import { mount } from "../http/route.ts";
import { type ActorEnv, requireActor, sessionActor } from "../http/session.ts";
import { parseJsonBody, parseValue } from "../http/validate.ts";
import { privateJson, type SettingsHttpServices } from "./shared.ts";

/** What the workspace's member list is served from. */
export type WorkspaceMembersHttpServices = Pick<
  SettingsHttpServices,
  "browserSecurity" | "protectedSessions" | "settings"
>;

export const MEMBERS_FORBIDDEN: ProblemDefinition = {
  code: "members_forbidden",
  detail: "Only an active workspace owner or admin may manage members.",
  status: 403,
  title: "Members forbidden",
};
export const MEMBERS_NOT_LOADED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "Workspace members could not be loaded.",
  status: 503,
  title: "Members unavailable",
};
export const MEMBER_UPDATE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Choose a valid member role and active state.",
  status: 400,
  title: "Invalid member update",
};
export const MEMBER_FORBIDDEN: ProblemDefinition = {
  code: "member_forbidden",
  detail: "Your role cannot apply that member change.",
  status: 403,
  title: "Member update forbidden",
};
export const LAST_OWNER: ProblemDefinition = {
  code: "last_owner",
  detail: "At least one active workspace owner must remain.",
  status: 409,
  title: "Last owner protected",
};
export const MEMBER_NOT_FOUND: ProblemDefinition = {
  code: "member_not_found",
  detail: "That member does not belong to this workspace.",
  status: 404,
  title: "Member unavailable",
};
export const MEMBER_NOT_UPDATED: ProblemDefinition = {
  code: "settings_unavailable",
  detail: "That member could not be updated.",
  status: 503,
  title: "Member unavailable",
};

export function createMembersRoutes(
  services: WorkspaceMembersHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(routes, listManagedMembers, session, async (context) => {
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

  mount(
    routes,
    updateManagedMember,
    origin,
    session,
    async (context) => {
      const target = parseValue(uuid, context.req.param("memberId"));
      const parsed = await parseJsonBody(context, memberUpdateInput);
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
  return routes;
}
