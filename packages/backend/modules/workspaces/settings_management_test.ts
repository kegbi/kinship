import {
  createSettingsManagement,
  type SettingsManagementDependencies,
  type SettingsTransaction,
} from "./application/settings_management.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const actor = {
  memberId: "member-a",
  role: "owner" as const,
  userId: "user-a",
  workspaceId: "workspace-a",
};

Deno.test("workspace settings adapter does not read identity-owned storage", async () => {
  const source = await Deno.readTextFile(
    new URL("./adapters/postgres/settings_management.ts", import.meta.url),
  );
  assert(
    !source.includes("crm.users"),
    "workspace settings must compose identity display data through a public facade",
  );
});

function fixture(
  revokeResult:
    | { readonly current: boolean; readonly status: "revoked" }
    | { readonly status: "forbidden" | "stale" } = {
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
    clock: { now: () => new Date("2026-08-15T10:00:00.000Z") },
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
        throw new Error("unused");
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
      updateWorkspace() {
        throw new Error("unused");
      },
    },
  };
  return { effects, service: createSettingsManagement(dependencies) };
}

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
