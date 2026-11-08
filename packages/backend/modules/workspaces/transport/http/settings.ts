/**
 * Member and workspace settings over HTTP: seven concerns, one surface.
 *
 * Six surfaces on one page — the member's profile, their preferences, their
 * sessions, the workspace's configuration, its members, and its
 * personalization — plus the UI state a script reads on every page load, and
 * eighteen routes over the seven. GAP-021 gave each concern its own file;
 * what more than one of them needs lives in `settings/shared.ts`.
 *
 * No two settings paths overlap: every route is rooted at a distinct literal
 * under `/api/v1/settings/` or at `/api/v1/member/ui-state`, so the mounted
 * order is free. It is kept as the order the page presents them in anyway,
 * and `settings/routes_test.ts` requests each path through the mounted whole.
 *
 * `SETTINGS_PROBLEMS` is still one list, in one order, because the pinning
 * suite reads it as the whole surface's vocabulary.
 */

import { Hono } from "hono";
import type { ActorEnv } from "../../../../../http-kit/session.ts";
import type { ProblemDefinition } from "../../../../../http-kit/problem.ts";
import {
  createUiStateRoutes,
  UI_STATE_FORBIDDEN,
  UI_STATE_INVALID,
  UI_STATE_NOT_LOADED,
  UI_STATE_NOT_SAVED,
  UI_STATE_ORIGIN_INVALID,
  UI_STATE_SESSION_INVALID,
} from "./settings/ui_state.ts";
import {
  createProfileRoutes,
  PROFILE_INVALID,
  PROFILE_NOT_LOADED,
  PROFILE_NOT_SAVED,
} from "./settings/profile.ts";
import {
  createPreferencesRoutes,
  PREFERENCES_INVALID,
  PREFERENCES_NOT_LOADED,
  PREFERENCES_NOT_SAVED,
} from "./settings/preferences.ts";
import {
  createSessionsRoutes,
  SESSION_NOT_REVOKED,
  SESSION_STALE,
  SESSIONS_NOT_LOADED,
} from "./settings/sessions.ts";
import {
  createWorkspaceRoutes,
  WORKSPACE_FORBIDDEN,
  WORKSPACE_INVALID,
  WORKSPACE_NOT_LOADED,
  WORKSPACE_NOT_SAVED,
  WORKSPACE_SLUG_CONFLICT,
} from "./settings/workspace.ts";
import {
  createMembersRoutes,
  LAST_OWNER,
  MEMBER_FORBIDDEN,
  MEMBER_NOT_FOUND,
  MEMBER_NOT_UPDATED,
  MEMBER_UPDATE_INVALID,
  MEMBERS_FORBIDDEN,
  MEMBERS_NOT_LOADED,
} from "./settings/members.ts";
import {
  createPersonalizationRoutes,
  PERSONALIZATION_CREATE_INVALID,
  PERSONALIZATION_DELETE_INVALID,
  PERSONALIZATION_UPDATE_INVALID,
  SECTION_NOT_FOUND,
} from "./settings/personalization.ts";
import type { SettingsHttpServices } from "./settings/shared.ts";

export type { SettingsHttpServices } from "./settings/shared.ts";
export {
  PERSONALIZATION_FAILURES,
  replacementRequired,
} from "./settings/personalization.ts";

/** Every problem the settings surface answers on its own, for the pinning suite. */
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

export function createSettingsRoutes(
  services: SettingsHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  routes.route("/", createUiStateRoutes(services));
  routes.route("/", createProfileRoutes(services));
  routes.route("/", createPreferencesRoutes(services));
  routes.route("/", createSessionsRoutes(services));
  routes.route("/", createWorkspaceRoutes(services));
  routes.route("/", createMembersRoutes(services));
  routes.route("/", createPersonalizationRoutes(services));
  return routes;
}
