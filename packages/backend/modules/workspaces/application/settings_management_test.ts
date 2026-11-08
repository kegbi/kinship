import type { Failure } from "../../../shared-kernel/result.ts";
import {
  createSettingsManagement,
  type SettingsManagementDependencies,
} from "./settings_management.ts";
import type { SettingsTransaction } from "../ports/context.ts";
import { assert } from "../../../testing/assert.ts";
import { fixedClock } from "../../../testing/fakes.ts";

const actor = {
  memberId: "member-a",
  role: "owner" as const,
  userId: "user-a",
  workspaceId: "workspace-a",
};

Deno.test("workspace settings adapter does not read identity-owned storage", async () => {
  const source = await Deno.readTextFile(
    new URL("../adapters/postgres/settings_management.ts", import.meta.url),
  );
  assert(
    !source.includes("crm.users"),
    "workspace settings must compose identity display data through a public facade",
  );
});

function fixture(
  revokeResult:
    | { readonly current: boolean; readonly status: "revoked" }
    | Failure<never, "stale"> = {
      current: false,
      status: "revoked",
    },
) {
  const effects: string[] = [];
  const transaction: SettingsTransaction = { opaque: {} };
  const dependencies: SettingsManagementDependencies = {
    audit: {
      record(command) {
        effects.push(`audit:${command.action}`);
        return Promise.resolve();
      },
    },
    clock: fixedClock("2026-08-15T10:00:00.000Z"),
    currencies: {
      listSupported: () => Promise.resolve(["EUR", "USD"]),
    },
    identity: {
      getProfile() {
        return Promise.resolve({
          email: "owner@example.test",
          firstName: "Old",
          lastName: "Name",
        });
      },
      listSessions() {
        return Promise.resolve([]);
      },
      revokeOwnedSession() {
        effects.push("identity:revoke");
        return Promise.resolve(revokeResult);
      },
      updateProfile() {
        effects.push("identity:profile");
        return Promise.resolve({
          email: "owner@example.test",
          firstName: "Ada",
          lastName: "Lovelace",
        });
      },
    },
    identityDisplay: {
      listIdentityDisplaySummaries(command) {
        assert(
          command.transaction === transaction,
          "display read shares transaction",
        );
        effects.push(`identity:display:${command.userIds.join("|")}`);
        return Promise.resolve(
          command.userIds.map((userId) => ({
            email: userId === "user-b"
              ? "member@example.test"
              : "owner@example.test",
            name: userId === "user-b" ? "Member Example" : "Owner Example",
            userId,
          })).reverse(),
        );
      },
    },
    memberCredentials: {
      revokeMemberCredentials(command) {
        assert(
          command.transaction === transaction,
          "credential revocation shares the member update's transaction",
        );
        effects.push(
          `credentials:revoke:${command.subjectUserId}:by:${command.actor.memberId}`,
        );
        return Promise.resolve();
      },
    },
    planningPublisher: {
      deliveryChanged() {
        effects.push("planning:member-delivery");
        return Promise.resolve();
      },
      timezoneChanged() {
        effects.push("planning:member-timezone");
        return Promise.resolve();
      },
      workspaceTimezoneChanged(_actor, timezone) {
        effects.push(`planning:workspace-timezone:${timezone}`);
        return Promise.resolve();
      },
    },
    transaction: {
      async run(work) {
        effects.push("tx:begin");
        const result = await work(transaction);
        effects.push("tx:commit");
        return result;
      },
    },
    workspace: {
      getPreferences() {
        throw new Error("unused");
      },
      getWorkspace() {
        return Promise.resolve({
          defaultLocale: "en",
          defaultReminderTime: "09:00",
          defaultTimezone: "UTC",
          name: "Old name",
        });
      },
      listMembers() {
        effects.push("workspace:list");
        return Promise.resolve([
          {
            id: "member-b",
            role: "member" as const,
            status: "active" as const,
            userId: "user-b",
          },
          {
            id: "member-a",
            role: "owner" as const,
            status: "active" as const,
            userId: "user-a",
          },
        ]);
      },
      updateMember(command) {
        effects.push(
          `workspace:update:${command.role}->${command.newRole}:${command.newStatus}`,
        );
        return Promise.resolve({
          id: command.targetMemberId,
          role: command.newRole,
          status: command.newStatus,
          userId: "user-b",
        });
      },
      updatePreferences() {
        throw new Error("unused");
      },
      updateWorkspace(command) {
        return Promise.resolve({
          defaultLocale: command.defaultLocale,
          defaultReminderTime: command.defaultReminderTime,
          ...(command.defaultTimezone
            ? { defaultTimezone: command.defaultTimezone }
            : {}),
          name: command.name,
          ...(command.slug ? { slug: command.slug } : {}),
        });
      },
    },
  };
  return { effects, service: createSettingsManagement(dependencies) };
}

Deno.test("PLANNING-002 workspace default timezone regenerates inherited reminder instants", async () => {
  const { effects, service } = fixture();
  const result = await service.updateWorkspace(actor, {
    defaultLocale: "en",
    defaultReminderTime: "09:00",
    defaultTimezone: "Europe/Belgrade",
    name: "Trusted circle",
  });
  assert(
    typeof result !== "string" && result !== undefined,
    "workspace update succeeds",
  );
  assert(
    effects.join(",") ===
      "tx:begin,audit:workspace.configuration-changed,planning:workspace-timezone:Europe/Belgrade,tx:commit",
    `workspace timezone coordination is atomic: ${effects.join(",")}`,
  );
});

Deno.test("PLANNING-002 workspace default reminder time regenerates inherited instants", async () => {
  const { effects, service } = fixture();
  const result = await service.updateWorkspace(actor, {
    defaultLocale: "en",
    defaultReminderTime: "15:45",
    defaultTimezone: "UTC",
    name: "Trusted circle",
  });
  assert(
    typeof result !== "string" && result !== undefined,
    "workspace default-time update succeeds",
  );
  assert(
    effects.join(",") ===
      "tx:begin,audit:workspace.configuration-changed,planning:workspace-timezone:UTC,tx:commit",
    `workspace default-time coordination is atomic: ${effects.join(",")}`,
  );
});

Deno.test("[GAP-020] a time zone the calendar cannot resolve is refused before any write", async () => {
  const { effects, service } = fixture();

  const preferences = await service.updatePreferences(actor, {
    contactNameOrder: "given_family_nickname",
    contactSortOrder: "given_name_asc",
    fluidLayout: false,
    locale: "en",
    measurementSystem: "metric",
    temperatureScale: "celsius",
    timezone: "Not/AZone",
  });
  const workspace = await service.updateWorkspace(actor, {
    defaultLocale: "en",
    defaultReminderTime: "09:00",
    defaultTimezone: "Not/AZone",
    name: "Trusted circle",
  });

  assert(
    preferences.status === "invalid-timezone",
    "a member's own unschedulable zone is refused",
  );
  assert(
    workspace === "invalid-timezone",
    "an unschedulable workspace default is refused",
  );
  assert(
    effects.length === 0,
    `neither refusal opened a transaction: ${effects.join(",")}`,
  );
});

Deno.test("AUTH-004 changes the current identity and records governance atomically", async () => {
  const { effects, service } = fixture();
  const result = await service.updateProfile(actor, {
    firstName: "Ada",
    lastName: "Lovelace",
  });
  assert(result.status === "ready", "profile update succeeds");
  assert(
    effects.join(",") ===
      "tx:begin,identity:profile,audit:member.profile-updated,tx:commit",
    "profile mutation and audit share one transaction",
  );
});

Deno.test("AUTH-004 distinguishes forbidden and stale session identifiers", async () => {
  const { service } = fixture();
  const forbidden = await service.revokeSession(
    actor,
    "current-token",
    "another-session",
  );
  assert(forbidden.status === "revoked", "fixture returns revocation result");

  const staleFixture = fixture({ status: "stale" });
  const stale = await staleFixture.service.revokeSession(
    actor,
    "current-token",
    "stale-session",
  );
  assert(stale.status === "stale", "stale sessions remain distinguishable");
});

Deno.test("WORKSPACE-001 preserves the actor role when applying a target role", async () => {
  const { effects, service } = fixture();
  const result = await service.updateMember(actor, "member-b", {
    role: "admin",
    status: "active",
  });
  assert(typeof result !== "string", "member update succeeds");
  assert(result.role === "admin", "target receives the requested role");
  assert(
    effects.includes("workspace:update:owner->admin:active"),
    "repository receives distinct actor and target roles",
  );
  assert(
    result.email === "member@example.test" && result.name === "Member Example",
    "identity display data is composed after the membership mutation",
  );
});

Deno.test("[AUD-M4] suspending a member revokes their credentials in the same transaction; a role change does not", async () => {
  const demoted = fixture();
  await demoted.service.updateMember(actor, "member-b", {
    role: "member",
    status: "active",
  });
  assert(
    !demoted.effects.some((effect) => effect.startsWith("credentials:")),
    `a demotion leaves tokens to use-time role checks: ${demoted.effects}`,
  );
  const suspended = fixture();
  const result = await suspended.service.updateMember(actor, "member-b", {
    role: "admin",
    status: "suspended",
  });
  assert(typeof result !== "string", "member suspension succeeds");
  assert(
    suspended.effects.join(",") ===
      "tx:begin,workspace:update:owner->admin:suspended,credentials:revoke:user-b:by:member-a,identity:display:user-b,audit:workspace.member-updated,tx:commit",
    `suspension revokes the member's credentials atomically: ${suspended.effects}`,
  );
});

Deno.test("WORKSPACE-001 composes and orders member display summaries in one transaction", async () => {
  const { effects, service } = fixture();
  const result = await service.listMembers(actor);
  assert(typeof result !== "string", "owner can list members");
  assert(
    result.map((member) => `${member.role}:${member.email}`).join(",") ===
      "owner:owner@example.test,member:member@example.test",
    "application composition preserves role-safe presentation order",
  );
  assert(
    effects.join(",") ===
      "tx:begin,workspace:list,identity:display:user-b|user-a,tx:commit",
    "membership and identity reads share the application transaction",
  );
});

Deno.test("[AUD-K5] a member is refused the administrative settings before any read", async () => {
  const { effects, service } = fixture();
  const member = { ...actor, role: "member" as const };
  const answers = [
    await service.getWorkspace(member),
    await service.updateWorkspace(member, {
      defaultLocale: "en",
      defaultReminderTime: "09:00",
      // Not a zone the calendar resolves: the role is decided first.
      defaultTimezone: "Mars/Olympus",
      name: "Trusted circle",
    }),
    await service.listMembers(member),
    await service.updateMember(member, "member-b", {
      role: "admin",
      status: "active",
    }),
  ];
  assert(
    answers.every((answer) => answer === "forbidden"),
    `every administrative call is refused: ${JSON.stringify(answers)}`,
  );
  assert(
    effects.length === 0,
    `a refusal opens no transaction: ${effects.join(",")}`,
  );

  const admin = { ...actor, role: "admin" as const };
  assert(
    typeof await service.getWorkspace(admin) === "object",
    "an admin still reads the workspace settings",
  );
});
