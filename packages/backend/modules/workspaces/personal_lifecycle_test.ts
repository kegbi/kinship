import {
  createPersonalLifecycle,
  type PersonalLifecycleDependencies,
  type PersonalLifecycleMembership,
  type PersonalLifecycleTransaction,
} from "./application/personal_lifecycle.ts";

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

const actor = {
  memberId: "00000000-0000-4000-8000-000000000011",
  role: "owner" as const,
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000101",
  workspaceName: "Family",
};
const request = { clientAddress: "203.0.113.10" };
const current: PersonalLifecycleMembership = {
  finalOwner: false,
  memberId: actor.memberId,
  role: "owner",
  status: "active",
  workspaceId: actor.workspaceId,
  workspaceName: "Family",
};
const next: PersonalLifecycleMembership = {
  finalOwner: false,
  memberId: "00000000-0000-4000-8000-000000000012",
  role: "member",
  status: "active",
  workspaceId: "00000000-0000-4000-8000-000000000102",
  workspaceName: "Friends",
};

function fixture(options: {
  readonly memberships?: readonly PersonalLifecycleMembership[];
  readonly verified?: boolean;
} = {}) {
  const effects: string[] = [];
  const transaction: PersonalLifecycleTransaction = { opaque: {} };
  const memberships = options.memberships ?? [current, next];
  const dependencies: PersonalLifecycleDependencies = {
    attemptBudget: {
      finalize() {
        return Promise.resolve();
      },
      reserve() {
        return Promise.resolve({
          reservationId: crypto.randomUUID(),
          status: "admitted",
        });
      },
    },
    audit: {
      record(command) {
        effects.push(
          `audit:${command.action}:${command.payload.outcome ?? ""}`,
        );
        return Promise.resolve();
      },
    },
    authenticationAudit: {
      assertFailurePostcondition() {
        return Promise.resolve();
      },
      recordFailure() {
        effects.push("audit:authentication.failed:");
        return Promise.resolve(crypto.randomUUID());
      },
    },
    clock: { now: () => new Date("2026-08-23T12:00:00.000Z") },
    identity: {
      deleteIdentity() {
        effects.push("identity-delete");
        return Promise.resolve();
      },
      inspectIdentity() {
        return Promise.resolve({
          activeSessionCount: 2,
          email: "owner@example.test",
        });
      },
      revokeSessions() {
        effects.push("sessions-revoked");
        return Promise.resolve();
      },
      verifyPassword() {
        effects.push("password-verified");
        return Promise.resolve(options.verified ?? true);
      },
    },
    memberships: {
      inspect(command) {
        effects.push(command.lock ? "memberships-locked" : "memberships-read");
        return Promise.resolve({ memberships });
      },
      leaveAll() {
        effects.push("leave-all");
        return Promise.resolve();
      },
      leaveCurrent() {
        effects.push("leave-current");
        return Promise.resolve();
      },
    },
    transaction: { run: (work) => work(transaction) },
  };
  return { effects, lifecycle: createPersonalLifecycle(dependencies) };
}

Deno.test("personal lifecycle preview reports current impact and exact confirmations", async () => {
  const { effects, lifecycle } = fixture();
  assertEquals(await lifecycle.preview(actor), {
    activeSessionCount: 2,
    blockingWorkspaces: [],
    deleteConfirmation: "DELETE owner@example.test",
    leaveConfirmation: "LEAVE Family",
    memberships: [current, next],
    retainedLegalRecords: true,
    status: "ready",
  }, "preview");
  assertEquals(effects, ["memberships-read"], "preview effects");
});

Deno.test("personal lifecycle protects and audits a final owner before deleting identity", async () => {
  const { effects, lifecycle } = fixture({
    memberships: [{ ...current, finalOwner: true }],
  });
  assertEquals(
    await lifecycle.deleteIdentity(actor, {
      confirmation: "DELETE owner@example.test",
      password: "correct horse battery staple",
    }, request),
    {
      blockingWorkspaces: [{ id: actor.workspaceId, name: "Family" }],
      status: "final-owner",
    },
    "final-owner result",
  );
  assertEquals(effects, [
    "password-verified",
    "memberships-locked",
    "audit:identity.deletion-attempted:blocked-final-owner",
  ], "no destructive effects");
});

Deno.test("personal lifecycle requires reauthentication and exact deletion confirmation", async () => {
  const invalidPassword = fixture({ verified: false });
  assertEquals(
    await invalidPassword.lifecycle.deleteIdentity(actor, {
      confirmation: "DELETE owner@example.test",
      password: "wrong",
    }, request),
    { status: "reauthentication-required" },
    "password result",
  );
  assertEquals(
    invalidPassword.effects,
    ["password-verified", "audit:authentication.failed:"],
    "password effects",
  );

  const invalidConfirmation = fixture();
  assertEquals(
    await invalidConfirmation.lifecycle.deleteIdentity(actor, {
      confirmation: "delete owner@example.test",
      password: "correct",
    }, request),
    { status: "confirmation-invalid" },
    "confirmation result",
  );
  assertEquals(
    invalidConfirmation.effects,
    ["password-verified"],
    "confirmation effects",
  );
});

Deno.test("personal lifecycle deletes all memberships and identity in one ordered transaction", async () => {
  const { effects, lifecycle } = fixture();
  assertEquals(
    await lifecycle.deleteIdentity(actor, {
      confirmation: "DELETE owner@example.test",
      password: "correct",
    }, request),
    { status: "deleted" },
    "deletion result",
  );
  assertEquals(effects, [
    "password-verified",
    "memberships-locked",
    "audit:identity.deletion-attempted:completed",
    "audit:identity.deletion-attempted:completed",
    "leave-all",
    "identity-delete",
  ], "deletion effects");
});

Deno.test("personal lifecycle leaves current workspace and selects the next membership", async () => {
  const { effects, lifecycle } = fixture();
  assertEquals(
    await lifecycle.leaveWorkspace(actor, {
      confirmation: "LEAVE Family",
      password: "correct",
    }, request),
    {
      nextWorkspaceId: next.workspaceId,
      signedOut: false,
      status: "left",
    },
    "leave result",
  );
  assertEquals(effects, [
    "password-verified",
    "memberships-locked",
    "leave-current",
    "audit:workspace.member-left:",
  ], "leave effects");
});

Deno.test("personal lifecycle signs out after leaving the only non-owned workspace", async () => {
  const { effects, lifecycle } = fixture({
    memberships: [{ ...current, role: "member" }],
  });
  assertEquals(
    await lifecycle.leaveWorkspace(actor, {
      confirmation: "LEAVE Family",
      password: "correct",
    }, request),
    {
      signedOut: true,
      status: "left",
    },
    "last membership result",
  );
  assertEquals(effects, [
    "password-verified",
    "memberships-locked",
    "leave-current",
    "audit:workspace.member-left:",
    "sessions-revoked",
  ], "last membership effects");
});

Deno.test("personal lifecycle requires reauthentication for leave", async () => {
  const denied = fixture({ verified: false });
  assertEquals(
    await denied.lifecycle.leaveWorkspace(actor, {
      confirmation: "LEAVE Family",
      password: "wrong",
    }, request),
    { status: "reauthentication-required" },
    "leave reauthentication",
  );
  assertEquals(denied.effects, [
    "password-verified",
    "audit:authentication.failed:",
  ], "no membership effects");
});

Deno.test("personal lifecycle rejects mistyped and final-owner leave requests", async () => {
  const typo = fixture();
  assertEquals(
    await typo.lifecycle.leaveWorkspace(actor, {
      confirmation: "LEAVE Friends",
      password: "correct",
    }, request),
    {
      status: "confirmation-invalid",
    },
    "typed leave",
  );
  const finalOwner = fixture({
    memberships: [{ ...current, finalOwner: true }],
  });
  assertEquals(
    await finalOwner.lifecycle.leaveWorkspace(actor, {
      confirmation: "LEAVE Family",
      password: "correct",
    }, request),
    {
      blockingWorkspaces: [{ id: actor.workspaceId, name: "Family" }],
      status: "final-owner",
    },
    "final owner leave",
  );
  assertEquals(finalOwner.effects, [
    "password-verified",
    "memberships-locked",
    "audit:workspace.member-leave-attempted:blocked-final-owner",
  ], "blocked leave is audited without mutation");
});
