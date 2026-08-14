import {
  createFirstWorkspaceRegistration,
  createVerificationDeliveryRetry,
  type RegistrationDependencies,
  RegistrationError,
  type RegistrationTransaction,
} from "./public.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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

function fakeDependencies(failAt?: string): {
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
      clock: { now: () => new Date("2026-08-14T12:00:00.000Z") },
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
        createPendingUser() {
          effect("identity");
          return Promise.resolve({
            userId: "00000000-0000-4000-8000-000000000001",
          });
        },
        assertPendingUserPostconditions() {
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
      workspace: {
        createWorkspace() {
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
        assertFirstWorkspacePostconditions() {
          effect("workspace.postconditions");
          return Promise.resolve();
        },
      },
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
      mail: {
        sendVerification(message) {
          assert(
            message.token === "raw-verification-token",
            "mail gets raw token only at delivery boundary",
          );
          effect("mail");
          return Promise.resolve();
        },
      },
    },
  };
}

Deno.test("first workspace registration coordinates every required effect in one transaction", async () => {
  const { deps, effects } = fakeDependencies();
  const register = createFirstWorkspaceRegistration(deps);

  const result = await register({
    email: "owner@example.test",
    firstName: "Ada",
    lastName: "Lovelace",
    passwordHash: "$kinship$argon2id$v=1$encoded",
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
      "transaction.begin,identity,workspace,membership,preferences,settings,audit,identity.postconditions,workspace.postconditions,audit.postconditions,transaction.commit,mail",
    `unexpected effect order: ${effects.join(",")}`,
  );
});

for (
  const failure of [
    "identity",
    "workspace",
    "membership",
    "preferences",
    "settings",
    "audit",
    "identity.postconditions",
    "workspace.postconditions",
    "audit.postconditions",
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
      effects.at(-1) === "transaction.rollback",
      "database failure must roll back",
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
