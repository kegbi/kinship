import {
  createWorkspaceInvitationCoordinator,
  type InvitationAcceptance,
  type InvitationActor,
  type InvitationInspection,
  type WorkspaceInvitationDependencies,
} from "../public.ts";
import { assert, assertRejects } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import { fixedClock } from "../../../testing/fakes.ts";

Deno.test("workspaces invitation adapter does not read identity-owned storage", async () => {
  const source = await Deno.readTextFile(
    new URL("../adapters/postgres/workspace_invitations.ts", import.meta.url),
  );
  assert(
    !/\bcrm\.users\b/i.test(source),
    "workspace invitation persistence must use the identity public facade",
  );
});

const owner: InvitationActor = fixtures.actor({
  memberId: fixtures.uuid(1),
  role: "owner",
  userId: fixtures.uuid(2),
});

interface InvitationDependenciesUnderTest
  extends WorkspaceInvitationDependencies {
  readonly identity: {
    assertPendingUserPostconditions(command: unknown): Promise<void>;
    assertSessionPostcondition(command: unknown): Promise<void>;
    claimRegistrationAddress(command: {
      readonly email: string;
    }): Promise<
      | { readonly status: "available" }
      | { readonly status: "pending"; readonly userId: string }
      | { readonly status: "registered" }
    >;
    createExistingAccountRecovery(command: unknown): Promise<undefined>;
    discardPendingUser(command: { readonly userId: string }): Promise<void>;
    consumeVerifiedIdentityEntry(command: {
      readonly expectedEmail: string;
      readonly rawToken: string;
    }): Promise<{ readonly firstName: string; readonly userId: string }>;
    createPendingUser(command: {
      readonly email: string;
      readonly userId: string;
    }): Promise<{ readonly userId: string }>;
    createRetryVerificationToken(command: unknown): Promise<{
      readonly created: boolean;
      readonly email: string;
    }>;
    findIdentityIdByEmail(command: {
      readonly email: string;
    }): Promise<string | undefined>;
    isVerifiedInvitationIdentity(command: {
      readonly expectedEmail: string;
      readonly userId: string;
    }): Promise<boolean>;
    issueSession(command: {
      readonly userId: string;
    }): Promise<{ readonly expiresAt: Date; readonly token: string }>;
    listIdentityDisplaySummaries(command: {
      readonly userIds: readonly string[];
    }): Promise<
      readonly {
        readonly email: string;
        readonly name: string;
        readonly userId: string;
      }[]
    >;
  };
}

interface InvitationCoordinatorUnderTest {
  registerInvitee(command: {
    readonly email: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly passwordHash: string;
    readonly registrantVerifier: string;
    readonly token: string;
  }): Promise<string>;
  acceptVerifiedEntry(command: {
    readonly entryToken: string;
    readonly invitationToken: string;
    readonly userAgent?: string;
  }): Promise<
    | { readonly status: "invalid" }
    | { readonly sessionToken: string; readonly status: "accepted" }
  >;
  retryInviteeVerification(token: string): Promise<string>;
}

function dependencies(overrides: {
  readonly accept?: InvitationAcceptance;
  readonly claim?: "available" | "pending" | "registered";
  readonly create?: "already-member" | "created" | "forbidden";
  readonly inspect?: InvitationInspection;
  readonly mailFails?: boolean;
  readonly retryCreated?: boolean;
  readonly revoke?: "forbidden" | "not-found" | "revoked";
  readonly verificationMailFails?: boolean;
  readonly repositoryPostconditionFails?: boolean;
} = {}): {
  readonly deps: InvitationDependenciesUnderTest;
  readonly effects: string[];
} {
  const effects: string[] = [];
  const transaction = { opaque: "transaction" };
  return {
    effects,
    deps: {
      audit: {
        recordMemberJoined(command) {
          effects.push(`audit:${command.memberId}`);
          return Promise.resolve();
        },
        assertMemberJoinedPostcondition() {
          effects.push("audit.postcondition");
          return Promise.resolve();
        },
      },
      clock: fixedClock("2026-08-15T12:00:00.000Z"),
      ids: { create: () => "00000000-0000-4000-8000-000000000004" },
      identity: {
        assertPendingUserPostconditions() {
          effects.push("identity.pending.postcondition");
          return Promise.resolve();
        },
        assertSessionPostcondition() {
          effects.push("identity.session.postcondition");
          return Promise.resolve();
        },
        claimRegistrationAddress(command) {
          effects.push(`identity.claim:${command.email}`);
          const claim = overrides.claim ?? "available";
          return Promise.resolve(
            claim === "pending"
              ? { status: claim, userId: "pending-user" }
              : { status: claim },
          );
        },
        createExistingAccountRecovery() {
          return Promise.reject(new Error("not used by invitations"));
        },
        discardPendingUser(command) {
          effects.push(`identity.discard:${command.userId}`);
          return Promise.resolve();
        },
        consumeVerifiedIdentityEntry(command) {
          effects.push(
            `identity.entry:${command.rawToken}:${command.expectedEmail}`,
          );
          return Promise.resolve({
            firstName: "New",
            userId: "00000000-0000-4000-8000-000000000006",
          });
        },
        createPendingUser(command) {
          effects.push(`identity.pending:${command.email}`);
          return Promise.resolve({ userId: command.userId });
        },
        createRetryVerificationToken() {
          effects.push("identity.verification.retry");
          return Promise.resolve({
            created: overrides.retryCreated ?? true,
            email: "invitee@example.test",
          });
        },
        findIdentityIdByEmail(command) {
          effects.push(`identity.find:${command.email}`);
          return Promise.resolve(undefined);
        },
        isVerifiedInvitationIdentity(command) {
          effects.push(
            `identity.eligible:${command.userId}:${command.expectedEmail}`,
          );
          return Promise.resolve(true);
        },
        issueSession(command) {
          effects.push(`identity.session:${command.userId}`);
          return Promise.resolve({
            expiresAt: new Date("2026-08-16T00:00:00.000Z"),
            token: "authenticated-session",
          });
        },
        listIdentityDisplaySummaries(command) {
          effects.push(`identity.summaries:${command.userIds.join("|")}`);
          return Promise.resolve(command.userIds.map((userId) => ({
            email: "owner@example.test",
            name: "Owner Person",
            userId,
          })));
        },
      },
      mail: {
        sendInvitation(message) {
          effects.push(`mail:${message.token}`);
          return overrides.mailFails
            ? Promise.reject(new Error("provider detail"))
            : Promise.resolve();
        },
        sendVerification(message) {
          effects.push(`verification-mail:${message.token}`);
          return overrides.verificationMailFails
            ? Promise.reject(new Error("provider detail"))
            : Promise.resolve();
        },
      },
      pendingWorkspaces: {
        deletePendingWorkspaces(command) {
          effects.push(`workspaces.discard:${command.userId}`);
          return Promise.resolve();
        },
      },
      repository: {
        create(command) {
          effects.push(
            `create:${command.tokenHash}:${command.expiresAt.toISOString()}`,
          );
          return Promise.resolve(overrides.create ?? "created");
        },
        list() {
          effects.push("list");
          return Promise.resolve({
            invitations: [{
              createdAt: new Date("2026-08-15T12:00:00.123Z"),
              email: "invitee@example.test",
              expiresAt: new Date("2026-08-22T12:00:00.456Z"),
              id: "00000000-0000-4000-8000-000000000008",
              invitedByMemberId: owner.memberId,
              invitedByUserId: owner.userId,
              role: "member" as const,
              status: "pending" as const,
            }, {
              createdAt: new Date("2026-08-14T12:00:00.000Z"),
              email: "orphan@example.test",
              expiresAt: new Date("2026-08-21T12:00:00.000Z"),
              id: "00000000-0000-4000-8000-000000000009",
              invitedByMemberId: null,
              invitedByUserId: null,
              role: "admin" as const,
              status: "pending" as const,
            }],
            members: [{
              id: owner.memberId,
              role: owner.role,
              status: "active" as const,
              userId: owner.userId,
            }],
            status: "ready",
          });
        },
        revoke(command) {
          effects.push(
            `revoke:${command.invitationId}:${command.actor.memberId}:${command.transaction.opaque}`,
          );
          return Promise.resolve(overrides.revoke ?? "revoked");
        },
        inspect(command) {
          effects.push(`inspect:${command.tokenHash}`);
          return Promise.resolve(
            overrides.inspect ?? {
              email: "invitee@example.test",
              role: "member",
              status: "pending",
              workspaceName: "Circle",
            },
          );
        },
        accept(command) {
          effects.push(`accept:${command.tokenHash}:${command.userId}`);
          return Promise.resolve(
            overrides.accept ?? {
              invitationId: "00000000-0000-4000-8000-000000000005",
              invitedByMemberId: owner.memberId,
              memberId: command.memberId,
              role: "member",
              status: "accepted",
              workspaceId: owner.workspaceId,
              workspaceName: "Circle",
            },
          );
        },
        assertAcceptancePostcondition() {
          effects.push("accept.postcondition");
          return overrides.repositoryPostconditionFails
            ? Promise.reject(new Error("perturbed membership"))
            : Promise.resolve();
        },
      },
      tokens: {
        create() {
          effects.push("token.create");
          return Promise.resolve({
            hash: "hashed-token",
            raw: "raw-private-token",
          });
        },
        hash(raw) {
          effects.push(`token.hash:${raw}`);
          return Promise.resolve(`hash:${raw}`);
        },
      },
      transaction: {
        async run(work) {
          effects.push("transaction.begin");
          try {
            const result = await work(transaction);
            effects.push("transaction.commit");
            return result;
          } catch (error) {
            effects.push("transaction.rollback");
            throw error;
          }
        },
      },
    },
  };
}

Deno.test("AUTH-002 creates a bounded invitation and exposes raw token only to mail", async () => {
  const { deps, effects } = dependencies();
  const result = await createWorkspaceInvitationCoordinator(deps).create({
    actor: owner,
    email: "invitee@example.test",
    role: "member",
    workspaceName: "Circle",
  });
  assert(result === "created", "creation succeeds without returning a token");
  assert(
    effects.includes("create:hashed-token:2026-08-22T12:00:00.000Z"),
    "repository gets only the hash and seven-day bound",
  );
  assert(
    effects.at(-1) === "mail:raw-private-token",
    "raw token reaches only post-commit delivery",
  );
});

Deno.test("AUTH-002 rolls back when an exact acceptance postcondition fails", async () => {
  const { deps, effects } = dependencies({
    repositoryPostconditionFails: true,
  });
  await assertRejects(async () => {
    await createWorkspaceInvitationCoordinator(deps).accept({
      token: "raw-token",
      userId: owner.userId,
    });
  }, "a perturbed required effect rejects acceptance");
  assert(
    effects.includes("transaction.rollback") &&
      !effects.includes("transaction.commit") &&
      !effects.includes("audit.postcondition"),
    "postcondition failure rolls back before acceptance can be claimed",
  );
});

Deno.test("AUTH-002 denies members before token creation or persistence", async () => {
  const { deps, effects } = dependencies();
  const result = await createWorkspaceInvitationCoordinator(deps).create({
    actor: { ...owner, role: "member" },
    email: "invitee@example.test",
    role: "admin",
    workspaceName: "Circle",
  });
  assert(result === "forbidden", "member role is denied");
  assert(effects.length === 0, "denial has no secret or persistence effects");
});

for (const outcome of ["already-member", "forbidden"] as const) {
  Deno.test(`AUTH-002 creation preserves ${outcome} without delivery`, async () => {
    const { deps, effects } = dependencies({ create: outcome });
    const result = await createWorkspaceInvitationCoordinator(deps).create({
      actor: owner,
      email: "invitee@example.test",
      role: "member",
      workspaceName: "Circle",
    });
    assert(result === outcome, "repository outcome is preserved");
    assert(
      !effects.some((effect) => effect.startsWith("mail:")),
      "failed creation cannot deliver a link",
    );
  });
}

Deno.test("AUTH-002 reports post-commit delivery failure truthfully", async () => {
  const { deps, effects } = dependencies({ mailFails: true });
  const result = await createWorkspaceInvitationCoordinator(deps).create({
    actor: owner,
    email: "invitee@example.test",
    role: "member",
    workspaceName: "Circle",
  });
  assert(
    result === "delivery-failed",
    "delivery failure is distinct from rollback",
  );
  assert(
    effects.includes("transaction.commit"),
    "invitation remains committed",
  );
});

Deno.test("AUTH-002 accepts and audits the membership in one transaction", async () => {
  const { deps, effects } = dependencies();
  const result = await createWorkspaceInvitationCoordinator(deps).accept({
    token: "raw-token",
    userId: owner.userId,
  });
  assert(result.status === "accepted", "intended user accepts");
  assert(
    effects.join(",") ===
      `token.hash:raw-token,transaction.begin,inspect:hash:raw-token,identity.eligible:${owner.userId}:invitee@example.test,accept:hash:raw-token:${owner.userId},audit:00000000-0000-4000-8000-000000000004,accept.postcondition,audit.postcondition,transaction.commit`,
    "membership, audit, and consumption share the transaction",
  );
});

Deno.test("AUTH-002 registers an invited identity without creating a workspace", async () => {
  const { deps, effects } = dependencies();
  const coordinator = createWorkspaceInvitationCoordinator(
    deps,
  ) as unknown as InvitationCoordinatorUnderTest;
  const result = await coordinator.registerInvitee({
    email: "invitee@example.test",
    firstName: "New",
    lastName: "Invitee",
    passwordHash: "argon2id-hash",
    registrantVerifier: "registrant-verifier",
    token: "raw-token",
  });
  assert(result === "verification-required", "verification is required");
  assert(
    effects.includes("identity.pending:invitee@example.test") &&
      effects.includes("identity.pending.postcondition"),
    "only the pending identity and verification authority are created",
  );
});

Deno.test("AUD-A1 an invitee replaces somebody else's pending registration", async () => {
  const { deps, effects } = dependencies({ claim: "pending" });
  const coordinator = createWorkspaceInvitationCoordinator(
    deps,
  ) as unknown as InvitationCoordinatorUnderTest;
  const result = await coordinator.registerInvitee({
    email: "invitee@example.test",
    firstName: "New",
    lastName: "Invitee",
    passwordHash: "argon2id-hash",
    registrantVerifier: "registrant-verifier",
    token: "raw-token",
  });
  assert(result === "verification-required", "the invitee registers");
  const order = [
    "identity.claim:invitee@example.test",
    "workspaces.discard:pending-user",
    "identity.discard:pending-user",
    "identity.pending:invitee@example.test",
  ].map((effect) => effects.indexOf(effect));
  assert(
    order.every((index, position) =>
      index >= 0 && (position === 0 || index > order[position - 1]!)
    ),
    `the squatter's workspaces and identity go before the new one: ${
      effects.join(",")
    }`,
  );
});

Deno.test("AUD-A1 an invitee cannot register over an existing account", async () => {
  const { deps, effects } = dependencies({ claim: "registered" });
  const coordinator = createWorkspaceInvitationCoordinator(
    deps,
  ) as unknown as InvitationCoordinatorUnderTest;
  const result = await coordinator.registerInvitee({
    email: "invitee@example.test",
    firstName: "New",
    lastName: "Invitee",
    passwordHash: "argon2id-hash",
    registrantVerifier: "registrant-verifier",
    token: "raw-token",
  });
  assert(result === "identity-unavailable", "the existing account is kept");
  assert(
    !effects.some((effect) =>
      effect.startsWith("identity.pending") ||
      effect.startsWith("identity.discard") ||
      effect.startsWith("verification-mail:")
    ),
    "nothing is written or sent for an existing account",
  );
});

Deno.test("AUTH-002 retries invited verification truthfully and within the existing bound", async () => {
  const failed = dependencies({ verificationMailFails: true });
  const failedResult = await createWorkspaceInvitationCoordinator(failed.deps)
    .retryInviteeVerification("raw-token");
  assert(
    failedResult === "delivery-failed",
    "provider failure is visible to scoped caller",
  );
  assert(
    failed.effects.includes("identity.verification.retry") &&
      failed.effects.at(-1) === "verification-mail:raw-private-token",
    "token rotates transactionally before post-commit mail",
  );

  const bounded = dependencies({ retryCreated: false });
  const boundedResult = await createWorkspaceInvitationCoordinator(bounded.deps)
    .retryInviteeVerification("raw-token");
  assert(
    boundedResult === "rate-limited",
    "rapid repeated retries stay bounded",
  );
  assert(
    !bounded.effects.some((effect) => effect.startsWith("verification-mail:")),
    "bounded retry does not send or expose an unpersisted token",
  );
});

Deno.test("AUTH-002 consumes verified entry, membership, audit, and session atomically", async () => {
  const { deps, effects } = dependencies();
  const coordinator = createWorkspaceInvitationCoordinator(
    deps,
  ) as unknown as InvitationCoordinatorUnderTest;
  const result = await coordinator.acceptVerifiedEntry({
    entryToken: "one-use-entry",
    invitationToken: "raw-token",
    userAgent: "browser",
  });
  assert(result.status === "accepted", "verified invitee accepts");
  assert(
    result.status === "accepted" &&
      result.sessionToken === "authenticated-session",
    "acceptance returns only the new authenticated session to transport",
  );
  assert(
    effects.includes(
      "identity.entry:one-use-entry:invitee@example.test",
    ) && effects.includes(
      "accept:hash:raw-token:00000000-0000-4000-8000-000000000006",
    ) && effects.includes(
      "identity.session:00000000-0000-4000-8000-000000000006",
    ) && effects.at(-1) === "transaction.commit",
    "entry consumption, invite acceptance, and session share one transaction",
  );
});

for (
  const status of [
    "already-member",
    "expired",
    "invalid",
    "revoked",
    "used",
    "wrong-user",
  ] as const
) {
  Deno.test(`AUTH-002 acceptance handles ${status} without audit`, async () => {
    const { deps, effects } = dependencies({ accept: { status } });
    const result = await createWorkspaceInvitationCoordinator(deps).accept({
      token: "raw-token",
      userId: owner.userId,
    });
    assert(result.status === status, "safe alternate is preserved");
    assert(
      !effects.some((effect) => effect.startsWith("audit")),
      "non-acceptance cannot claim member joined",
    );
  });
}

Deno.test("AUTH-002 inspection hashes bearer material and list remains actor scoped", async () => {
  const { deps, effects } = dependencies();
  const coordinator = createWorkspaceInvitationCoordinator(deps);
  const inspected = await coordinator.inspect("raw-token");
  const listed = await coordinator.list(owner);
  assert(
    inspected.status === "pending" && listed.status === "ready",
    "read states are available",
  );
  assert(
    listed.status === "ready" &&
      listed.members[0]?.email === "owner@example.test" &&
      listed.invitations[0]?.createdAt === "2026-08-15T12:00:00.123Z" &&
      listed.invitations[0]?.expiresAt === "2026-08-22T12:00:00.456Z",
    "identity summaries and typed timestamps compose at the coordinator",
  );
  assert(
    effects.includes("inspect:hash:raw-token") && effects.includes("list"),
    "reads use hashed token and actor-scoped repository",
  );
});

Deno.test("[SECT-04] the pending list names who sent each invitation", async () => {
  const { deps, effects } = dependencies();
  const listed = await createWorkspaceInvitationCoordinator(deps).list(owner);
  assert(listed.status === "ready", "list is ready");
  const [sent, orphan] = listed.invitations;
  assert(
    sent?.invitedBy?.id === owner.memberId &&
      sent.invitedBy.name === "Owner Person" && sent.role === "member",
    `the sender is named from identity: ${JSON.stringify(sent)}`,
  );
  assert(
    orphan?.invitedBy === null && orphan.role === "admin",
    "an invitation whose sender is gone names nobody",
  );
  assert(
    effects.includes(`identity.summaries:${owner.userId}`),
    `the sender's identity is read once with the members': ${effects}`,
  );
});

Deno.test("[SECT-04] an owner or admin revokes an invitation in one transaction", async () => {
  for (const role of ["owner", "admin"] as const) {
    const { deps, effects } = dependencies();
    const result = await createWorkspaceInvitationCoordinator(deps).revoke(
      { ...owner, role },
      "00000000-0000-4000-8000-000000000008",
    );
    assert(result === "revoked", `${role} revokes`);
    assert(
      effects.join() === [
        "transaction.begin",
        `revoke:00000000-0000-4000-8000-000000000008:${owner.memberId}:transaction`,
        "transaction.commit",
      ].join(),
      `the repository decides inside the transaction: ${effects}`,
    );
  }
  for (const outcome of ["forbidden", "not-found"] as const) {
    const { deps } = dependencies({ revoke: outcome });
    assert(
      await createWorkspaceInvitationCoordinator(deps).revoke(owner, "x") ===
        outcome,
      `the repository's ${outcome} is passed through`,
    );
  }
});

Deno.test("[SECT-04] a member is refused revocation before any read", async () => {
  const { deps, effects } = dependencies();
  const result = await createWorkspaceInvitationCoordinator(deps).revoke(
    { ...owner, role: "member" },
    "00000000-0000-4000-8000-000000000008",
  );
  assert(result === "forbidden", "member role is denied");
  assert(effects.length === 0, `the refusal reads nothing: ${effects}`);
});

Deno.test("[AUD-K5] a member is refused the member list before any read", async () => {
  const { deps, effects } = dependencies();
  const listed = await createWorkspaceInvitationCoordinator(deps).list({
    ...owner,
    role: "member",
  });
  assert(listed.status === "forbidden", "member role is denied");
  assert(effects.length === 0, `the refusal reads nothing: ${effects}`);
});
