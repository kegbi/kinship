/**
 * The two settings a member's browser remembers for them.
 *
 * The theme and the person-page view are read on every page load by a script
 * rather than by a form, which is why these two routes keep their own
 * `member_ui_state_*` code for every refusal, the session and the origin
 * included: the codes are what let that script stay quiet about a refusal
 * every other surface would show.
 *
 * The origin is checked in the handler rather than by middleware for the same
 * reason — the middleware's refusal would not carry the code.
 */

import { Hono } from "hono";
import type { MemberUiState } from "../../../public.ts";
import {
  getMemberUiState,
  saveMemberUiState,
} from "../../../../../../contracts/routes/settings.ts";
import { memberUiStateInput } from "../../../../../../contracts/schemas/settings.ts";
import { matchingOrigin } from "../../../../../../http-kit/origin.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../../http-kit/problem.ts";
import { mount } from "../../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  actorOf,
  sessionActor,
} from "../../../../../../http-kit/session.ts";
import { parseJsonBody } from "../../../../../../http-kit/validate.ts";
import { privateJson, type SettingsHttpServices } from "./shared.ts";

/** What a member's remembered UI state is served from. */
export type MemberUiStateHttpServices = Pick<
  SettingsHttpServices,
  "browserSecurity" | "memberUiState" | "protectedSessions"
>;

export const UI_STATE_SESSION_INVALID: ProblemDefinition = {
  code: "member_ui_state_session_invalid",
  detail: "Sign in with an active workspace membership.",
  status: 401,
  title: "Authentication required",
};
export const UI_STATE_ORIGIN_INVALID: ProblemDefinition = {
  code: "member_ui_state_origin_invalid",
  detail: "This request did not come from the configured application origin.",
  status: 403,
  title: "Request forbidden",
};
export const UI_STATE_INVALID: ProblemDefinition = {
  code: "member_ui_state_validation_failed",
  detail: "Choose at least one recognised UI setting.",
  status: 400,
  title: "Invalid UI state",
};
export const UI_STATE_FORBIDDEN: ProblemDefinition = {
  code: "member_ui_state_forbidden",
  detail: "The requested member UI state is not available in this workspace.",
  status: 403,
  title: "UI state unavailable",
};
export const UI_STATE_NOT_LOADED: ProblemDefinition = {
  code: "member_ui_state_unavailable",
  detail: "Your member UI state could not be loaded.",
  status: 503,
  title: "UI state unavailable",
};
export const UI_STATE_NOT_SAVED: ProblemDefinition = {
  code: "member_ui_state_unavailable",
  detail: "Your member UI state could not be saved.",
  status: 503,
  title: "UI state unavailable",
};

export function createUiStateRoutes(
  services: MemberUiStateHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);

  mount(routes, getMemberUiState, session, async (context) => {
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

  mount(routes, saveMemberUiState, session, async (context) => {
    if (!matchingOrigin(context, services.browserSecurity)) {
      return definedProblem(context, UI_STATE_ORIGIN_INVALID);
    }
    const parsed = await parseJsonBody(context, memberUiStateInput);
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
  return routes;
}
