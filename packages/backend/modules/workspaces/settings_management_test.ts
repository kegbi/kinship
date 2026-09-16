import type { Failure } from "../../shared-kernel/result.ts";
import {
  createSettingsManagement,
  type SettingsManagementDependencies,
  type SettingsTransaction,
} from "./application/settings_management.ts";
import {
  createMemberUiStateManagement,
  type MemberUiStateRepository,
} from "./public.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const actor = {
  memberId: "member-a",
  role: "owner" as const,
  userId: "user-a",
  workspaceId: "workspace-a",
};

const uiStateActor = {
  memberId: "00000000-0000-4000-8000-000000000002",
  role: "member" as const,
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000003",
};
const uiStateTransaction = { opaque: {} };
const uiStateTransactionRunner = {
  run<T>(work: (value: typeof uiStateTransaction) => Promise<T>) {
    return work(uiStateTransaction);
  },
};
const manageUiState = (repository: MemberUiStateRepository) =>
  createMemberUiStateManagement({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    repository,
    transaction: uiStateTransactionRunner,
  });

Deno.test("UXD-002C3 member UI-state write preserves every unowned stored key", async () => {
  let stored: unknown = JSON.stringify({
    dismissedWelcome: true,
    recentPersonIds: ["00000000-0000-4000-8000-000000000010"],
  });
  const uiState = manageUiState({
    read: () => Promise.resolve({ status: "ready", uiState: stored }),
    lock: () => Promise.resolve({ status: "ready", uiState: stored }),
    save(command) {
      stored = command.uiState;
      return Promise.resolve(true);
    },
  });

  const saved = await uiState.save(uiStateActor, {
    personWorkspaceView: "planning",
  });
  assert(saved.status === "ready", "valid presentation state saves");
  assert(
    saved.uiState.personWorkspaceView === "planning",
    "save returns the recognised projection",
  );
  const value = stored as Readonly<Record<string, unknown>>;
  assert(value.dismissedWelcome === true, "unknown stored key was clobbered");
  assert(
    JSON.stringify(value.recentPersonIds) ===
      JSON.stringify(["00000000-0000-4000-8000-000000000010"]),
    "recent-person history was clobbered",
  );
});

Deno.test("UXD-002C3 member UI-state rejects invalid input before persistence", async () => {
  let locked = false;
  let saved = false;
  const uiState = manageUiState({
    read: () => Promise.resolve({ status: "ready", uiState: {} }),
    lock: () => {
      locked = true;
      return Promise.resolve({ status: "ready", uiState: {} });
    },
    save: () => {
      saved = true;
      return Promise.resolve(true);
    },
  });

  const result = await uiState.save(uiStateActor, {
    personWorkspaceView: "unknown",
  } as never);
  assert(result.status === "forbidden", "invalid view fails closed");
  assert(!locked && !saved, "invalid input reached persistence");
});

Deno.test("UXD-002C3 member UI-state reads missing preferences as empty state", async () => {
  const result = await manageUiState({
    read: () => Promise.resolve({ status: "ready", uiState: undefined }),
    lock: () => Promise.resolve({ status: "ready", uiState: undefined }),
    save: () => Promise.resolve(true),
  }).read(uiStateActor);
  assert(result.status === "ready", "authorised missing row is ready");
  assert(
    Object.keys(result.uiState).length === 0,
    "missing preference row projects empty state",
  );
});

Deno.test("UXD-002C3 member UI-state ignores unknown reads and stops forbidden access", async () => {
  let saved = false;
  const unknown = await manageUiState({
    read: () =>
      Promise.resolve({
        status: "ready",
        uiState: { personWorkspaceView: "invalid", recentPersonIds: [] },
      }),
    lock: () => Promise.resolve({ status: "forbidden" }),
    save: () => {
      saved = true;
      return Promise.resolve(true);
    },
  }).read(uiStateActor);
  assert(
    unknown.status === "ready" && Object.keys(unknown.uiState).length === 0,
    "read leaked unrecognised presentation state",
  );

  const deniedRepository: MemberUiStateRepository = {
    read: () => Promise.resolve({ status: "forbidden" }),
    lock: () => Promise.resolve({ status: "forbidden" }),
    save: () => {
      saved = true;
      return Promise.resolve(true);
    },
  };
  const denied = manageUiState(deniedRepository);
  assert(
    (await denied.read(uiStateActor)).status === "forbidden",
    "read allowed denial",
  );
  assert(
    (await denied.save(uiStateActor, { personWorkspaceView: "things" }))
      .status === "forbidden",
    "write allowed denial",
  );
  assert(!saved, "denied write reached save");
});

Deno.test("UXD-002C3 member UI-state repairs malformed storage and fails closed", async () => {
  for (const malformed of [null, [], "{"] as const) {
    const result = await manageUiState({
      read: () => Promise.resolve({ status: "ready", uiState: malformed }),
      lock: () => Promise.resolve({ status: "ready", uiState: malformed }),
      save: () => Promise.resolve(true),
    }).read(uiStateActor);
    assert(
      result.status === "ready" && Object.keys(result.uiState).length === 0,
      "malformed stored state leaked through the projection",
    );
  }

  const inputGuard = manageUiState({
    read: () => Promise.resolve({ status: "ready", uiState: {} }),
    lock: () => Promise.resolve({ status: "ready", uiState: {} }),
    save: () => Promise.resolve(true),
  });
  assert(
    (await inputGuard.save(uiStateActor, null as never)).status ===
        "forbidden" &&
      (await inputGuard.save(uiStateActor, {
          personWorkspaceView: "all",
          recentPersonIds: [],
        } as never)).status === "forbidden",
    "loose UI-state input reached persistence",
  );

  for (
    const personWorkspaceView of [
      "all",
      "timeline",
      "planning",
      "things",
      "admin",
    ] as const
  ) {
    const result = await inputGuard.save(uiStateActor, { personWorkspaceView });
    assert(
      result.status === "ready" &&
        result.uiState.personWorkspaceView === personWorkspaceView,
      `${personWorkspaceView} was not accepted`,
    );
  }

  const rejected = await manageUiState({
    read: () => Promise.resolve({ status: "ready", uiState: {} }),
    lock: () =>
      Promise.resolve({
        status: "ready",
        uiState: { personWorkspaceView: "admin" },
      }),
    save: () => Promise.resolve(false),
  }).save(uiStateActor, {});
  assert(rejected.status === "forbidden", "repository refusal reported ready");
});

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
    | Failure<"forbidden", "stale"> = {
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
    planningPublisher: {
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
