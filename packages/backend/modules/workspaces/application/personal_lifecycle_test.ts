import {
  createPersonalLifecycle,
  type PersonalLifecycleDependencies,
} from "./personal_lifecycle.ts";
import type { PersonalLifecycleMembership } from "../domain/personal_lifecycle_rules.ts";
import type { PersonalLifecycleTransaction } from "../ports/context.ts";
import { assertEquals } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import { fixedClock } from "../../../testing/fakes.ts";

const actor = fixtures.workspaceActor({
  memberId: fixtures.uuid(11),
  role: "owner",
  workspaceId: fixtures.uuid(101),
});
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
    clock: fixedClock("2026-08-23T12:00:00.000Z"),
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

Deno.test("personal lifecycle step-up reports the throttle and releases a reservation it could not use", async () => {
  const effects: string[] = [];
  const build = (options: {
    readonly admitted: boolean;
    readonly inspectThrows?: boolean;
  }) =>
    createPersonalLifecycle({
      attemptBudget: {
        finalize(command) {
          effects.push(`finalize:${command.statusCode}`);
          return Promise.resolve();
        },
        reserve() {
          return Promise.resolve(
            options.admitted
              ? { reservationId: "reservation", status: "admitted" as const }
              : {
                reservationId: "reservation",
                retryAfterSeconds: 45,
                status: "rate-limited" as const,
              },
          );
        },
      },
      audit: {
        record() {
          return Promise.resolve();
        },
      },
      authenticationAudit: {
        assertFailurePostcondition(command) {
          effects.push(
            `assert:${command.auditEventId === undefined ? "none" : "event"}`,
          );
          return Promise.resolve();
        },
        // Governance may decline to record an event it cannot attribute, and
        // the step-up has to carry on without one.
        recordFailure() {
          return Promise.resolve(undefined);
        },
      },
      clock: fixedClock("2026-08-23T12:00:00.000Z"),
      identity: {
        deleteIdentity: () => Promise.resolve(),
        inspectIdentity: () =>
          Promise.resolve({
            activeSessionCount: 1,
            email: "owner@example.test",
          }),
        revokeSessions: () => Promise.resolve(),
        verifyPassword: () => Promise.resolve(true),
      },
      memberships: {
        inspect() {
          if (options.inspectThrows) {
            throw new Error("the memberships table is unavailable");
          }
          return Promise.resolve({ memberships: [current, next] });
        },
        leaveAll: () => Promise.resolve(),
        leaveCurrent: () => Promise.resolve(),
      },
      transaction: { run: (work) => work({ opaque: {} }) },
    });

  assertEquals(
    await build({ admitted: false }).leaveWorkspace(
      actor,
      { confirmation: "LEAVE Family", password: "correct horse" },
      request,
    ),
    { retryAfterSeconds: 45, status: "rate-limited" },
  );
  assertEquals(
    effects,
    ["assert:none", "finalize:429"],
    "a throttled attempt is recorded without an event and finalized as 429",
  );

  effects.length = 0;
  let thrown: unknown;
  try {
    await build({ admitted: true, inspectThrows: true }).deleteIdentity(
      actor,
      { confirmation: "DELETE owner@example.test", password: "correct horse" },
      request,
    );
  } catch (error) {
    thrown = error;
  }
  assertEquals(
    thrown instanceof Error ? thrown.message : String(thrown),
    "the memberships table is unavailable",
    "the primary failure is not swallowed",
  );
  assertEquals(
    effects,
    ["finalize:200", "finalize:503"],
    "and the reservation it could not use is released",
  );
});
