import {
  createFirstWorkspaceRegistration,
  createRegistrationVerification,
  createVerificationDeliveryRetry,
  DEFAULT_RELATIONSHIP_TYPE_VOCABULARY,
  type RegistrationDependencies,
  RegistrationError,
  type RegistrationTransaction,
  type RegistrationVerificationDependencies,
} from "../public.ts";
import type { RegistrationVerificationResult } from "../../identity/public.ts";
import {
  assert,
  assertEquals,
  assertRejects,
} from "../../../testing/assert.ts";
import { fixedClock } from "../../../testing/fakes.ts";

Deno.test("verification delivery retries preserve links and bound provider work", async () => {
  const { deps, effects } = fakeDependencies("mail");
  const retry = createVerificationDeliveryRetry(deps);
  await retry("owner@example.test");
  await retry("owner@example.test");
  assert(
    effects.filter((effect) => effect === "identity.replace-token").length ===
      2,
    "each retry checks pending state transactionally",
  );
  assert(
    effects.filter((effect) => effect === "transaction.commit").length === 2,
    "each retry decision commits before external delivery",
  );
  assert(
    effects.filter((effect) => effect === "mail").length === 1,
    "cooldown prevents repeated provider work",
  );
  assert(
    effects.indexOf("transaction.commit") < effects.indexOf("mail"),
    "retry delivery occurs only after commit",
  );
});

function fakeDependencies(failAt?: string, options: {
  readonly budget?: "admitted" | "exhausted";
  readonly claim?: "available" | "pending" | "registered";
  readonly recoverable?: boolean;
  readonly withoutAccountExistsMail?: boolean;
} = {}): {
  readonly deps: RegistrationDependencies;
  readonly effects: string[];
} {
  const effects: string[] = [];
  let retryCalls = 0;
  const transaction: RegistrationTransaction = { opaque: "test-transaction" };
  const effect = (name: string): void => {
    effects.push(name);
    if (failAt === name) throw new Error(`injected ${name} failure`);
  };
  return {
    effects,
    deps: {
      clock: fixedClock("2026-08-14T12:00:00.000Z"),
      mailBudget: {
        reserve(reservation) {
          effect(
            `budget:${reservation.scope}:${reservation.recipient}:${reservation.recipientCeiling}:${reservation.windowMilliseconds}`,
          );
          return Promise.resolve(options.budget ?? "admitted");
        },
      },
      responseEqualizer: {
        async run(work) {
          effects.push("equalizer.begin");
          try {
            return await work();
          } finally {
            effects.push("equalizer.end");
          }
        },
      },
      ids: {
        create: () =>
          `00000000-0000-4000-8000-${
            String(effects.length + 1).padStart(12, "0")
          }`,
      },
      tokens: {
        create: () =>
          Promise.resolve({
            raw: "raw-verification-token",
            hash: "hashed-verification-token",
          }),
      },
      transaction: {
        async run(work) {
          effects.push("transaction.begin");
          try {
            const result = await work(transaction);
            effect("transaction.commit");
            return result;
          } catch (error) {
            effects.push("transaction.rollback");
            throw error;
          }
        },
      },
      identity: {
        claimRegistrationAddress() {
          effect("identity.claim");
          const claim = options.claim ?? "available";
          return Promise.resolve(
            claim === "pending"
              ? { status: claim, userId: "pending-user" }
              : { status: claim },
          );
        },
        discardPendingUser(command) {
          effect(`identity.discard:${command.userId}`);
          return Promise.resolve();
        },
        createExistingAccountRecovery(command) {
          effect(`identity.recovery:${command.tokenHash}`);
          return Promise.resolve(
            options.recoverable === false ? undefined : {
              email: "owner@example.test",
              expiresAt: new Date("2026-08-14T13:00:00.000Z"),
            },
          );
        },
        createPendingUser(command) {
          assert(
            command.registrantVerifier === "registrant-verifier",
            "the registering browser's verifier reaches identity",
          );
          assert(
            command.registrationIntent === "Ada's circle" &&
              !("workspaceName" in command),
            "the workspace waits as the pending user's registration intent",
          );
          effect("identity");
          return Promise.resolve({
            userId: "00000000-0000-4000-8000-000000000001",
          });
        },
        assertPendingUserPostconditions(command) {
          assert(
            command.registrationIntent === "Ada's circle",
            "the intent is asserted back with the pending user",
          );
          effect("identity.postconditions");
          return Promise.resolve();
        },
        createRetryVerificationToken() {
          effect("identity.replace-token");
          retryCalls += 1;
          return Promise.resolve({
            email: "owner@example.test",
            created: retryCalls === 1,
          });
        },
      },
      workspace: fakeWorkspaceWriter(effect),
      mail: {
        sendVerification(message) {
          assert(
            message.token === "raw-verification-token",
            "mail gets raw token only at delivery boundary",
          );
          effect("mail");
          return Promise.resolve();
        },
        ...(options.withoutAccountExistsMail ? {} : {
          sendAccountExists(message) {
            effect(`mail.account-exists:${message.reset?.token ?? "none"}`);
            return Promise.resolve();
          },
        }),
      },
    },
  };
}

/** The workspace writer, recording each effect by name. */
function fakeWorkspaceWriter(
  effect: (name: string) => void,
): RegistrationDependencies["workspace"] {
  return {
    deletePendingWorkspaces(command) {
      effect(`workspace.discard:${command.userIds.join("+")}`);
      return Promise.resolve();
    },
    createWorkspace(command) {
      assert(command.name === "Ada's circle", "the intent names the workspace");
      assert(
        command.createdByUserId === "verified-user",
        "the verified user creates it",
      );
      effect("workspace");
      return Promise.resolve({
        workspaceId: "00000000-0000-4000-8000-000000000002",
      });
    },
    createOwnerMembership() {
      effect("membership");
      return Promise.resolve({
        memberId: "00000000-0000-4000-8000-000000000003",
      });
    },
    createMemberPreferences() {
      effect("preferences");
      return Promise.resolve();
    },
    createWorkspaceSettings() {
      effect("settings");
      return Promise.resolve();
    },
    provisionDefaultRelationshipTypes(command) {
      assert(command.version === 1, "default vocabulary is versioned");
      assert(
        command.types === DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types,
        "verification uses the one deterministic public vocabulary",
      );
      assert(
        command.types.length === 26,
        "exact default vocabulary is provisioned",
      );
      effect("relationship-types");
      return Promise.resolve();
    },
    assertFirstWorkspacePostconditions() {
      effect("workspace.postconditions");
      return Promise.resolve();
    },
  };
}

function fakeVerificationDependencies(
  verified: RegistrationVerificationResult,
  failAt?: string,
): {
  readonly deps: RegistrationVerificationDependencies;
  readonly effects: string[];
} {
  const effects: string[] = [];
  const transaction: RegistrationTransaction = { opaque: "test-transaction" };
  const effect = (name: string): void => {
    effects.push(name);
    if (failAt === name) throw new Error(`injected ${name} failure`);
  };
  return {
    effects,
    deps: {
      audit: {
        recordWorkspaceCreated() {
          effect("audit");
          return Promise.resolve();
        },
        assertWorkspaceCreatedPostcondition() {
          effect("audit.postconditions");
          return Promise.resolve();
        },
      },
      clock: fixedClock("2026-08-14T12:00:00.000Z"),
      ids: { create: () => crypto.randomUUID() },
      transaction: {
        async run(work) {
          effects.push("transaction.begin");
          try {
            const result = await work(transaction);
            effect("transaction.commit");
            return result;
          } catch (error) {
            effects.push("transaction.rollback");
            throw error;
          }
        },
      },
      verification: {
        verifyInTransaction(command) {
          assert(
            command.transaction === transaction,
            "identity proves the address in the provisioning transaction",
          );
          effect(
            `verify:${command.rawToken}:${command.registrantVerifier ?? "-"}`,
          );
          return Promise.resolve(verified);
        },
      },
      workspace: fakeWorkspaceWriter(effect),
    },
  };
}

const PROVISIONING = [
  "workspace",
  "membership",
  "preferences",
  "settings",
  "relationship-types",
  "audit",
  "workspace.postconditions",
  "audit.postconditions",
];

Deno.test("[AUD-A2] proving the address provisions the registered workspace in the verification's transaction", async () => {
  const { deps, effects } = fakeVerificationDependencies({
    entryToken: "entry",
    registrationIntent: "Ada's circle",
    status: "verified",
    userId: "verified-user",
  });
  const result = await createRegistrationVerification(deps)("raw", "verifier");
  assertEquals(result, { entryToken: "entry", status: "verified" });
  assertEquals(effects, [
    "transaction.begin",
    "verify:raw:verifier",
    ...PROVISIONING,
    "transaction.commit",
  ]);
});

Deno.test("[AUD-A2] a verification from another browser provisions the workspace too", async () => {
  const { deps, effects } = fakeVerificationDependencies({
    registrationIntent: "Ada's circle",
    resetToken: "reset",
    status: "password-required",
    userId: "verified-user",
  });
  const result = await createRegistrationVerification(deps)("raw");
  assertEquals(result, { resetToken: "reset", status: "password-required" });
  assertEquals(effects, [
    "transaction.begin",
    "verify:raw:-",
    ...PROVISIONING,
    "transaction.commit",
  ]);
});

Deno.test("[AUD-A2] a verification without an intent, or one that fails, provisions nothing", async () => {
  const outcomes: readonly RegistrationVerificationResult[] = [
    { entryToken: "entry", status: "verified", userId: "invitee" },
    { resetToken: "reset", status: "password-required", userId: "invitee" },
    { status: "expired" },
    { status: "invalid" },
    { status: "replayed" },
  ];
  for (const verified of outcomes) {
    const { deps, effects } = fakeVerificationDependencies(verified);
    const result = await createRegistrationVerification(deps)("raw");
    assertEquals(result.status, verified.status);
    assert(!("userId" in result), "the verified user stays inside");
    assertEquals(effects, [
      "transaction.begin",
      "verify:raw:-",
      "transaction.commit",
    ]);
  }
});

for (const failure of PROVISIONING) {
  Deno.test(`[AUD-A2] a verification rolls back when ${failure} fails`, async () => {
    const { deps, effects } = fakeVerificationDependencies(
      {
        entryToken: "entry",
        registrationIntent: "Ada's circle",
        status: "verified",
        userId: "verified-user",
      },
      failure,
    );
    await assertRejects(
      () => createRegistrationVerification(deps)("raw"),
      "a failed provisioning fails the verification",
    );
    assertEquals(effects.at(-1), "transaction.rollback");
    assert(
      !effects.includes("transaction.commit"),
      "an address is never proved without its workspace",
    );
  });
}

Deno.test("first workspace registration coordinates every required effect in one transaction", async () => {
  const { deps, effects } = fakeDependencies();
  const register = createFirstWorkspaceRegistration(deps);

  const result = await register({
    email: "owner@example.test",
    firstName: "Ada",
    lastName: "Lovelace",
    passwordHash: "$kinship$argon2id$v=1$encoded",
    registrantVerifier: "registrant-verifier",
    workspaceName: "Ada's circle",
  });

  assert(
    result.status === "verification-required",
    "registration requires verification",
  );
  assert(
    !("token" in result),
    "registration result must not expose raw verification material",
  );
  assert(
    effects.join(",") ===
      "equalizer.begin,budget:registration:owner@example.test:10:86400000,transaction.begin,identity.claim,identity,identity.postconditions,transaction.commit,mail,equalizer.end",
    `unexpected effect order: ${effects.join(",")}`,
  );
});

for (
  const failure of [
    "identity.claim",
    "identity",
    "identity.postconditions",
    "transaction.commit",
  ]
) {
  Deno.test(`registration rolls back when ${failure} fails`, async () => {
    const { deps, effects } = fakeDependencies(failure);
    let error: unknown;
    try {
      await createFirstWorkspaceRegistration(deps)({
        email: "owner@example.test",
        firstName: "Ada",
        lastName: "Lovelace",
        passwordHash: "$kinship$argon2id$v=1$encoded",
        registrantVerifier: "registrant-verifier",
        workspaceName: "Ada's circle",
      });
    } catch (caught) {
      error = caught;
    }
    assert(
      error instanceof RegistrationError,
      "dependency failures must normalize safely",
    );
    assert(
      error.code === "registration_failed",
      "failure uses stable safe code",
    );
    assert(
      effects.at(-2) === "transaction.rollback" &&
        effects.at(-1) === "equalizer.end",
      "database failure must roll back inside the equalizer",
    );
    assert(
      !effects.includes("mail"),
      "mail must not run before a successful commit",
    );
  });
}

Deno.test("post-commit mail failure preserves committed registration for retry", async () => {
  const { deps, effects } = fakeDependencies("mail");
  let error: unknown;
  try {
    await createFirstWorkspaceRegistration(deps)({
      email: "owner@example.test",
      firstName: "Ada",
      lastName: "Lovelace",
      passwordHash: "$kinship$argon2id$v=1$encoded",
      registrantVerifier: "registrant-verifier",
      workspaceName: "Ada's circle",
    });
  } catch (caught) {
    error = caught;
  }
  assert(
    typeof error === "object" && error !== null && "code" in error &&
      error.code === "verification_delivery_failed",
    "delivery failure must have a truthful retryable code",
  );
  assert(
    effects.includes("transaction.commit"),
    "required DB effects stay committed",
  );
  assert(
    !effects.includes("transaction.rollback"),
    "mail failure must not roll back committed DB work",
  );
});

const registration = {
  email: "owner@example.test",
  firstName: "Ada",
  lastName: "Lovelace",
  passwordHash: "$kinship$argon2id$v=1$encoded",
  registrantVerifier: "registrant-verifier",
  workspaceName: "Ada's circle",
};

async function registrationFailure(
  deps: RegistrationDependencies,
): Promise<unknown> {
  try {
    await createFirstWorkspaceRegistration(deps)(registration);
  } catch (caught) {
    return caught;
  }
  return undefined;
}

Deno.test("AUD-A1 a pending registration is replaced, workspaces before identity", async () => {
  const { deps, effects } = fakeDependencies(undefined, { claim: "pending" });
  const result = await createFirstWorkspaceRegistration(deps)(registration);
  assert(result.status === "verification-required", "the address is free");
  assert(
    effects.slice(3, 7).join(",") ===
      "identity.claim,workspace.discard:pending-user,identity.discard:pending-user,identity",
    `the squatter is discarded before the new identity: ${effects.join(",")}`,
  );
  assert(effects.includes("mail"), "the new registrant is mailed a link");
});

Deno.test("AUD-A1 an existing account answers the same and is mailed a reset link", async () => {
  const { deps, effects } = fakeDependencies(undefined, {
    claim: "registered",
  });
  const result = await createFirstWorkspaceRegistration(deps)(registration);
  assert(
    JSON.stringify(result) ===
      JSON.stringify({ status: "verification-required" }),
    "the caller cannot tell an existing account from a new one",
  );
  assert(
    effects.join(",") ===
      "equalizer.begin,budget:registration:owner@example.test:10:86400000,transaction.begin,identity.claim,identity.recovery:hashed-verification-token,transaction.commit,mail.account-exists:raw-verification-token,equalizer.end",
    `only a reset request is written and the owner told: ${effects.join(",")}`,
  );
});

const PROVIDER_PARITY_CASES = [
  ["a fresh address", { claim: "available" }],
  ["a verified address over the reset limit", {
    claim: "registered",
    recoverable: false,
  }],
  ["an imported address", { claim: "registered", recoverable: false }],
  ["a resettable address", { claim: "registered" }],
] as const;

Deno.test("AUD-A1 every registration waits on exactly one provider call, account or not", async () => {
  for (const [label, options] of PROVIDER_PARITY_CASES) {
    const { deps, effects } = fakeDependencies(undefined, options);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const slow = async () => {
      calls += 1;
      await gate;
      effects.push("provider.finished");
    };
    const settled = createFirstWorkspaceRegistration({
      ...deps,
      mail: { sendVerification: slow, sendAccountExists: slow },
    })(registration).then((result) => {
      effects.push("answered");
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(
      !effects.includes("answered"),
      `${label}: the answer waits for the provider: ${effects.join(",")}`,
    );
    release();
    const result = await settled;
    assert(
      result.status === "verification-required" && calls === 1 &&
        effects.indexOf("provider.finished") < effects.indexOf("answered"),
      `${label}: one provider call before the same answer (${calls})`,
    );
  }
});

Deno.test("AUD-A1 a failing provider fails every registration alike, account or not", async () => {
  for (const [label, options] of PROVIDER_PARITY_CASES) {
    const { deps } = fakeDependencies(undefined, options);
    let calls = 0;
    const failing = () => {
      calls += 1;
      return Promise.reject(new Error("provider down"));
    };
    const error = await registrationFailure({
      ...deps,
      mail: { sendVerification: failing, sendAccountExists: failing },
    });
    assert(
      typeof error === "object" && error !== null && "code" in error &&
        error.code === "verification_delivery_failed" && calls === 1,
      `${label}: the same delivery failure after one provider call (${calls})`,
    );
  }
});

Deno.test("AUD-A1 an account that cannot reset is still told, without a reset link", async () => {
  const messages: unknown[] = [];
  const { deps } = fakeDependencies(undefined, {
    claim: "registered",
    recoverable: false,
  });
  await createFirstWorkspaceRegistration({
    ...deps,
    mail: {
      sendVerification: () => Promise.reject(new Error("unexpected")),
      sendAccountExists(message) {
        messages.push(message);
        return Promise.resolve();
      },
    },
  })(registration);
  assert(
    JSON.stringify(messages) ===
      JSON.stringify([{ email: "owner@example.test" }]),
    `the owner is told with no link to spend: ${JSON.stringify(messages)}`,
  );
});

Deno.test("AUD-A1 a failed account-exists email fails like a failed verification email", async () => {
  for (
    const [failAt, options] of [
      [undefined, { claim: "registered", withoutAccountExistsMail: true }],
      ["mail.account-exists:raw-verification-token", { claim: "registered" }],
    ] as const
  ) {
    const error = await registrationFailure(
      fakeDependencies(failAt, options).deps,
    );
    assert(
      typeof error === "object" && error !== null && "code" in error &&
        error.code === "verification_delivery_failed",
      "both paths report the same delivery failure",
    );
  }
});

Deno.test("AUD-A1 a retry answers inside the equalizer without waiting for the provider", async () => {
  const { deps, effects } = fakeDependencies();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  const retry = createVerificationDeliveryRetry({
    ...deps,
    mail: {
      async sendVerification() {
        effects.push("mail.started");
        await pending;
        effects.push("mail.finished");
      },
    },
  });
  await retry("owner@example.test");
  assert(
    !effects.includes("mail.finished") &&
      effects.indexOf("equalizer.end") > effects.indexOf("transaction.commit"),
    `the answer does not wait for the provider: ${effects.join(",")}`,
  );
  release();
  await pending;
});

Deno.test("[AUD-M3] past the address's daily ceiling every registration answers alike and nothing is written or sent", async () => {
  const answers: string[] = [];
  for (const [label, options] of PROVIDER_PARITY_CASES) {
    const { deps, effects } = fakeDependencies(undefined, {
      ...options,
      budget: "exhausted",
    });
    let calls = 0;
    const count = () => {
      calls += 1;
      return Promise.resolve();
    };
    const result = await createFirstWorkspaceRegistration({
      ...deps,
      mail: { sendAccountExists: count, sendVerification: count },
    })(registration);
    answers.push(JSON.stringify(result));
    assert(
      calls === 0 &&
        effects.join(",") ===
          "equalizer.begin,budget:registration:owner@example.test:10:86400000,equalizer.end",
      `${label}: only the budget is asked, inside the equalizer: ${
        effects.join(",")
      }`,
    );
  }
  assert(
    new Set(answers).size === 1 &&
      answers[0] === JSON.stringify({ status: "verification-required" }),
    `every address answers the same: ${answers.join(" ")}`,
  );

  const { deps, effects } = fakeDependencies(undefined, {
    budget: "exhausted",
  });
  await createVerificationDeliveryRetry(deps)("owner@example.test");
  assert(
    effects.join(",") ===
      "equalizer.begin,budget:registration:owner@example.test:10:86400000,equalizer.end",
    `a retry past the ceiling issues and sends nothing: ${effects.join(",")}`,
  );
});

Deno.test("[AUD-M3] a budget that cannot be reached fails the registration as nothing created", async () => {
  const error = await registrationFailure(
    fakeDependencies("budget:registration:owner@example.test:10:86400000").deps,
  );
  assert(error instanceof RegistrationError, "the registration is refused");
});
