/**
 * The service bundle and the signed-in request every people suite starts from.
 *
 * GAP-021 split `people_test.ts` into one suite per concern, and all of them
 * begin the same way: one resolved actor, one bundle of fakes that refuses
 * anything the test did not ask for, and one set of headers carrying the
 * session cookie, the JSON content type, and the workspace the actor is in.
 * Written once here rather than eleven times.
 *
 * `.test-helper.ts` is the repository name for scaffolding that is neither
 * production nor a suite: the task manifest keeps it out of the production
 * file list, the architecture checker skips it, and the api coverage set
 * excludes it for the same reason.
 */

import { createPeopleRoutes, type PeopleHttpServices } from "./routes.ts";
import type {
  ImportantDateManagement,
  PeopleManagement,
  PersonLifecycle,
  ProfileFactManagement,
} from "../../public.ts";
import type { RecentPeopleManagement } from "../../../workspaces/public.ts";
import type { TodayRecentPeople } from "../../../../read-models/today/public.ts";
import * as fixtures from "../../../../testing/fixtures.ts";

export const actor = fixtures.sessionActor({ workspaceName: "Circle" });

export function services(
  people:
    & Pick<PeopleManagement, "create">
    & Partial<PeopleManagement>
    & Partial<PersonLifecycle>,
  directory: PeopleHttpServices["directory"] = {
    list: () =>
      Promise.resolve({
        people: [],
        status: "ready",
      }),
  },
  tagOptions: PeopleHttpServices["tagOptions"] = {
    list: () => Promise.resolve({ options: [], status: "ready" }),
  },
  profile: Partial<PeopleHttpServices["profile"]> = {},
  importantDates?: ImportantDateManagement,
  profileFacts?: ProfileFactManagement,
  recentPeople?: RecentPeopleManagement,
  todayRecentPeople?: TodayRecentPeople,
): PeopleHttpServices {
  return {
    browserSecurity: {
      origin: "http://localhost",
      secureCookie: false,
    },
    directory,
    ...(importantDates ? { importantDates } : {}),
    ...(profileFacts ? { profileFacts } : {}),
    ...(recentPeople ? { recentPeople } : {}),
    people: {
      archive: () => Promise.reject(new Error("must not archive")),
      delete: () => Promise.reject(new Error("must not delete")),
      edit: () => Promise.reject(new Error("must not edit")),
      get: () => Promise.resolve({ status: "not-found" }),
      previewDeletion: () => Promise.reject(new Error("must not preview")),
      restore: () => Promise.reject(new Error("must not restore")),
      ...people,
    },
    profile: {
      get: () => Promise.resolve({ status: "not-found" }),
      listLifeEvents: () => Promise.resolve({ status: "not-found" }),
      listTimeline: () => Promise.resolve({ status: "not-found" }),
      ...profile,
    },
    protectedSessions: { resolve: () => Promise.resolve(actor) },
    tagOptions,
    ...(todayRecentPeople ? { todayRecentPeople } : {}),
  };
}

export function todayRoutes(overrides: Partial<PeopleHttpServices>) {
  const base = services({ create: () => Promise.reject(new Error("unused")) });
  return createPeopleRoutes({ ...base, ...overrides });
}

export const headers = {
  cookie: "kinship_session=current-token",
  "content-type": "application/json",
  origin: "http://localhost",
  "X-Workspace-Id": actor.workspaceId,
};
