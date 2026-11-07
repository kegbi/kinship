import { assert, assertEquals, assertThrows } from "../../../testing/assert.ts";
import {
  FALLBACK_TIMEZONE,
  isSchedulableTimezone,
  managedMembers,
  memberDeliveryChanged,
  memberTimezoneChanged,
  type ResolvedMemberPreferences,
  type WorkspaceConfiguration,
  type WorkspaceMemberRecord,
  workspaceScheduleChanged,
} from "./settings_rules.ts";

const MEMBERS: readonly WorkspaceMemberRecord[] = [
  { id: "m3", role: "member", status: "active", userId: "u3" },
  { id: "m2", role: "admin", status: "suspended", userId: "u2" },
  { id: "m1", role: "owner", status: "active", userId: "u1" },
];

const IDENTITIES = [
  { email: "zoe@example.com", name: "Zoe", userId: "u1" },
  { email: "ada@example.com", name: "Ada", userId: "u2" },
  { email: "grace@example.com", name: "Grace", userId: "u3" },
];

Deno.test("[GAP-018] the administration page orders owners, then admins, then members", () => {
  assertEquals(
    managedMembers(MEMBERS, IDENTITIES).map((member) => [
      member.role,
      member.email,
      member.status,
    ]),
    [
      ["owner", "zoe@example.com", "active"],
      ["admin", "ada@example.com", "suspended"],
      ["member", "grace@example.com", "active"],
    ],
  );
});

Deno.test("[GAP-018] members of one role order by address and then identifier", () => {
  assertEquals(
    managedMembers([
      { id: "m2", role: "member", status: "active", userId: "u2" },
      { id: "m1", role: "member", status: "active", userId: "u1" },
      { id: "m3", role: "member", status: "active", userId: "u3" },
    ], [
      { email: "shared@example.com", name: "One", userId: "u1" },
      { email: "shared@example.com", name: "Two", userId: "u2" },
      { email: "Ada@example.com", name: "Ada", userId: "u3" },
    ]).map((member) => member.id),
    ["m3", "m1", "m2"],
  );
});

Deno.test("[GAP-018] a membership with no identity behind it is a broken read, not a blank row", () => {
  const thrown = assertThrows(
    () => managedMembers(MEMBERS, IDENTITIES.slice(1)),
    "a missing identity must be raised",
  );
  assertEquals(
    thrown instanceof Error ? thrown.message : String(thrown),
    "Identity display summary is unavailable.",
  );
  assert(
    managedMembers([], []).length === 0,
    "an empty workspace is not a broken read",
  );
});

const PREFERENCES: ResolvedMemberPreferences = {
  contactNameOrder: "given-family",
  contactSortOrder: "family",
  effectiveTimezone: "Europe/Berlin",
  fluidLayout: false,
  locale: "en",
  measurementSystem: "metric",
  reminderDelivery: "in_app",
  temperatureScale: "celsius",
  timezone: "Europe/Berlin",
};

Deno.test("[GAP-018] planning is told only when a member's timezone actually moves", () => {
  assertEquals(memberTimezoneChanged(PREFERENCES, PREFERENCES), false);
  assertEquals(
    memberTimezoneChanged(PREFERENCES, {
      ...PREFERENCES,
      timezone: "Europe/Paris",
    }),
    true,
  );
  assertEquals(
    memberTimezoneChanged(undefined, PREFERENCES),
    true,
    "a member who had chosen nothing has chosen something",
  );
  assertEquals(
    memberTimezoneChanged(PREFERENCES, {
      ...PREFERENCES,
      locale: "de",
    }),
    false,
    "changing anything else reschedules nobody",
  );
});

const CONFIGURATION: WorkspaceConfiguration = {
  defaultLocale: "en",
  defaultReminderTime: "09:00:00",
  defaultTimezone: "Europe/Berlin",
  name: "Home",
};

Deno.test("[AUD-W1] planning is told only when a member's reminder delivery changes", () => {
  assertEquals(memberDeliveryChanged(PREFERENCES, PREFERENCES), false);
  assertEquals(
    memberDeliveryChanged(PREFERENCES, {
      ...PREFERENCES,
      reminderDelivery: PREFERENCES.reminderDelivery === "email"
        ? "in_app"
        : "email",
    }),
    true,
  );
  assertEquals(memberDeliveryChanged(undefined, PREFERENCES), true);
});

Deno.test("[GAP-018] planning is told when the workspace moves when reminders are due", () => {
  assertEquals(workspaceScheduleChanged(CONFIGURATION, CONFIGURATION), false);
  assertEquals(
    workspaceScheduleChanged(CONFIGURATION, {
      ...CONFIGURATION,
      defaultTimezone: "Europe/Paris",
    }),
    true,
  );
  assertEquals(
    workspaceScheduleChanged(CONFIGURATION, {
      ...CONFIGURATION,
      defaultReminderTime: "18:00:00",
    }),
    true,
  );
  assertEquals(
    workspaceScheduleChanged(CONFIGURATION, { ...CONFIGURATION, name: "Away" }),
    false,
    "renaming the workspace reschedules nobody",
  );
  assertEquals(workspaceScheduleChanged(undefined, CONFIGURATION), true);
  assertEquals(FALLBACK_TIMEZONE, "UTC");
});

Deno.test("[GAP-020] only a time zone the calendar can resolve may be stored", () => {
  for (
    const zone of ["UTC", "Europe/Belgrade", "America/Sao_Paulo", "Etc/GMT+5"]
  ) {
    assert(
      isSchedulableTimezone(zone),
      `${zone} is a zone the calendar can schedule in`,
    );
  }
  for (const zone of ["Not/AZone", "", "Europe/Atlantis", "europe/belgrade "]) {
    assertEquals(
      isSchedulableTimezone(zone),
      false,
      `${zone} is not a zone anything can be scheduled in`,
    );
  }
});
