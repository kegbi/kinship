/**
 * The service bundle and the signed-in request every settings suite starts
 * from.
 *
 * GAP-021 split `settings_test.ts` into one suite per concern. Each begins
 * with the same owner, the same settings and UI-state fakes — every one of
 * which answers plausibly so a test overrides only what it is about — and the
 * same headers.
 */

import type {
  MemberUiStateManagement,
  SettingsManagement,
} from "../../../public.ts";
import type { SettingsHttpServices } from "../settings.ts";
import * as fixtures from "../../../../../testing/fixtures.ts";

export const actor = fixtures.sessionActor({
  role: "owner",
  workspaceName: "Circle",
});

export function settings(
  overrides: Partial<SettingsManagement> = {},
): SettingsManagement {
  const base: SettingsManagement = {
    getProfile: () =>
      Promise.resolve({
        email: "owner@example.test",
        firstName: "Owner",
        lastName: "Person",
      }),
    updateProfile: (_actor, input) =>
      Promise.resolve({
        profile: { email: "owner@example.test", ...input },
        status: "ready",
      }),
    getPreferences: () =>
      Promise.resolve({
        effectiveTimezone: "Europe/Belgrade",
        contactNameOrder: "given_family_nickname",
        contactSortOrder: "given_name_asc",
        fluidLayout: false,
        locale: "en",
        measurementSystem: "metric",
        temperatureScale: "celsius",
      }),
    updatePreferences: (_actor, input) =>
      Promise.resolve({
        preferences: {
          ...input,
          effectiveTimezone: input.timezone ?? "Europe/Belgrade",
        },
        status: "ready",
      }),
    listSessions: () =>
      Promise.resolve([{
        createdAt: "2026-08-15T08:00:00.000Z",
        current: true,
        expiresAt: "2026-08-15T20:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000010",
        lastSeenAt: "2026-08-15T10:00:00.000Z",
      }]),
    revokeSession: () => Promise.resolve({ current: true, status: "revoked" }),
    getWorkspace: () =>
      Promise.resolve({
        defaultLocale: "en",
        defaultReminderTime: "12:00",
        name: "Circle",
      }),
    updateWorkspace: (_actor, input) => Promise.resolve(input),
    listMembers: () => Promise.resolve([]),
    updateMember: () => Promise.resolve("not-found"),
  };
  return { ...base, ...overrides };
}

export function memberUiState(
  overrides: Partial<MemberUiStateManagement> = {},
): MemberUiStateManagement {
  return {
    read: () => Promise.resolve({ status: "ready", uiState: {} }),
    save: (_actor, input) =>
      Promise.resolve({ status: "ready", uiState: input }),
    ...overrides,
  };
}

export function services(
  settingsService: SettingsManagement = settings(),
  memberUiStateService: MemberUiStateManagement = memberUiState(),
): SettingsHttpServices {
  return {
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    memberUiState: memberUiStateService,
    personalization: {
      isSection: (value): value is "tags" => value === "tags",
      list: () =>
        Promise.resolve({
          capabilities: { create: true, editValue: false },
          entries: [],
          readOnly: false,
          status: "ready",
        }),
      mutate: () => Promise.resolve({ status: "not-found" }),
    },
    protectedSessions: {
      completeMfa: () => Promise.resolve({ status: "challenge-expired" }),
      establishVerifiedEntry: () =>
        Promise.resolve({ status: "membership-inactive" }),
      resolve: () => Promise.resolve(actor),
      signIn: () => Promise.resolve({ status: "invalid-credentials" }),
      signOut: () => Promise.resolve(),
    },
    settings: settingsService,
  };
}

export const headers = {
  cookie: "kinship_session=current-token",
  "content-type": "application/json",
  origin: "http://localhost",
};
