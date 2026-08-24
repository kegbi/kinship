import {
  createPeopleManagement,
  type PeopleManagementDependencies,
  type PeopleTransaction,
} from "./public.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function dependencies(options: {
  readonly authorize?: boolean;
  readonly duplicate?: boolean;
  readonly failAuditPostcondition?: boolean;
  readonly readStatus?: "forbidden" | "not-found" | "ready";
} = {}): {
  readonly dependencies: PeopleManagementDependencies;
  readonly effects: string[];
} {
  const effects: string[] = [];
  const transaction: PeopleTransaction = { opaque: "people-test" };
  return {
    effects,
    dependencies: {
      audit: {
        record() {
          effects.push("audit.record");
          return Promise.resolve();
        },
        assertPostcondition() {
          effects.push("audit.assert");
          if (options.failAuditPostcondition) {
            return Promise.reject(new Error("audit missing"));
          }
          return Promise.resolve();
        },
      },
      clock: { now: () => new Date("2026-08-15T12:00:00.000Z") },
      ids: {
        create: () => "00000000-0000-4000-8000-000000000100",
      },
      repository: {
        lockRequest() {
          effects.push("request.lock");
          return Promise.resolve();
        },
        revalidateAndLockCreateContext() {
          effects.push("authorization.lock");
          return Promise.resolve(options.authorize !== false);
        },
        findPossibleDuplicates(command) {
          effects.push(`duplicates:${command.workspaceId}`);
          return Promise.resolve(
            options.duplicate
              ? [{
                displayName: "Ada Lovelace",
                id: "00000000-0000-4000-8000-000000000099",
              }]
              : [],
          );
        },
        getIdentity(command) {
          effects.push(`people.get:${command.personId}`);
          if (options.readStatus === "forbidden") {
            return Promise.resolve({ status: "forbidden" });
          }
          if (options.readStatus === "not-found") {
            return Promise.resolve({ status: "not-found" });
          }
          return Promise.resolve({
            person: {
              familyName: "Lovelace",
              givenName: "Ada",
              id: command.personId,
              isPartial: false,
            },
            status: "ready",
          });
        },
        create(command) {
          effects.push("people.create");
          return Promise.resolve({
            ...(command.familyName ? { familyName: command.familyName } : {}),
            givenName: command.givenName,
            id: command.id,
            isPartial: command.isPartial,
            ...(command.middleName ? { middleName: command.middleName } : {}),
            ...(command.nickname ? { nickname: command.nickname } : {}),
          });
        },
        assertCreatedPostcondition() {
          effects.push("people.assert");
          return Promise.resolve();
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

const actor = {
  memberId: "00000000-0000-4000-8000-000000000002",
  role: "member" as const,
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000003",
};

Deno.test("PEOPLE-001 preserves partial unknown identity values explicitly", async () => {
  const fake = dependencies();
  const people = createPeopleManagement(fake.dependencies);
  const invalid = await people.create(actor, {
    givenName: "",
    isPartial: false,
    nickname: "The Countess",
  });
  assert(invalid.status === "validation-error", "unknown given name explicit");
  assert(fake.effects.length === 0, "invalid identity does not transact");

  const result = await people.create(actor, {
    familyName: "  Lovelace  ",
    givenName: "",
    isPartial: true,
    nickname: "  The Countess  ",
  });
  assert(result.status === "created", "explicit partial identity is created");
  assert(result.person.givenName === "", "unknown given name is not invented");
  assert(
    result.person.familyName === "Lovelace" &&
      result.person.nickname === "The Countess",
    "known identity values are normalized",
  );
  assert(
    fake.effects.join(",") ===
      "transaction.begin,authorization.lock,duplicates:00000000-0000-4000-8000-000000000003,people.create,audit.record,people.assert,audit.assert,transaction.commit",
    `unexpected effect order: ${fake.effects.join(",")}`,
  );
});

Deno.test("PEOPLE-001 warns on an active-workspace duplicate and permits explicit override", async () => {
  const fake = dependencies({ duplicate: true });
  const people = createPeopleManagement(fake.dependencies);
  const warning = await people.create(actor, {
    familyName: "Lovelace",
    givenName: "Ada",
    isPartial: false,
  });
  assert(warning.status === "possible-duplicate", "duplicate is guidance");
  assert(!fake.effects.includes("people.create"), "warning does not persist");

  const created = await people.create(actor, {
    duplicateOverride: true,
    familyName: "Lovelace",
    givenName: "Ada",
    isPartial: false,
  });
  assert(created.status === "created", "explicit override creates another");
});

Deno.test("PEOPLE-001 rejects stale membership and rolls back missing audit", async () => {
  const forbiddenFake = dependencies({ authorize: false });
  const forbidden = await createPeopleManagement(forbiddenFake.dependencies)
    .create(actor, { givenName: "Ada", isPartial: false });
  assert(forbidden.status === "forbidden", "membership is rechecked on write");
  assert(
    forbiddenFake.effects.join(",") ===
      "transaction.begin,authorization.lock,transaction.commit",
    "one authorization check denies before lookup, write, or audit",
  );

  const failedFake = dependencies({ failAuditPostcondition: true });
  let failed = false;
  try {
    await createPeopleManagement(failedFake.dependencies).create(actor, {
      givenName: "Ada",
      isPartial: false,
    });
  } catch {
    failed = true;
  }
  assert(failed, "required audit failure surfaces");
  assert(
    failedFake.effects.at(-1) === "transaction.rollback",
    "person and audit are atomic",
  );
});

Deno.test("PEOPLE-001 reads identity through the public active-workspace facade", async () => {
  const personId = "00000000-0000-4000-8000-000000000100";
  const readyFake = dependencies();
  const ready = await createPeopleManagement(readyFake.dependencies).get(
    actor,
    personId,
  );
  assert(
    ready.status === "ready" && ready.person.id === personId,
    "canonical identity is returned",
  );
  assert(
    readyFake.effects.join(",") ===
      `transaction.begin,people.get:${personId},transaction.commit`,
    "identity read stays inside the application transaction boundary",
  );

  for (const status of ["not-found", "forbidden"] as const) {
    const fake = dependencies({ readStatus: status });
    const result = await createPeopleManagement(fake.dependencies).get(
      actor,
      personId,
    );
    assert(result.status === status, `${status} remains explicit`);
  }
});

Deno.test("DAV person ensure reuses the exact deterministic identity and ignores similar-name duplicate heuristics", async () => {
  const first = dependencies({ duplicate: true, readStatus: "not-found" });
  const created = await createPeopleManagement(first.dependencies).ensure(
    actor,
    "00000000-0000-4000-8000-000000000777",
    { familyName: "Lovelace", givenName: "Ada", isPartial: false },
  );
  assert(created.status === "ready", "remote identity created");
  assert(
    !first.effects.some((effect) => effect.startsWith("duplicates:")),
    "similar names are not remote identity",
  );
  assert(first.effects.includes("request.lock"), "stable identity serialized");

  const replay = dependencies();
  const found = await createPeopleManagement(replay.dependencies).ensure(
    actor,
    "00000000-0000-4000-8000-000000000777",
    { familyName: "Lovelace", givenName: "Ada", isPartial: false },
  );
  assert(found.status === "ready", "exact deterministic identity replayed");
  assert(
    !replay.effects.includes("people.create"),
    "replay does not create a second person",
  );

  const bound = dependencies({ readStatus: "not-found" });
  const davTransaction = { opaque: "dav-transaction" };
  const inTransaction = await createPeopleManagement(bound.dependencies)
    .ensureInTransaction(
      actor,
      "00000000-0000-4000-8000-000000000778",
      { familyName: "Hopper", givenName: "Grace", isPartial: false },
      davTransaction,
    );
  assert(inTransaction.status === "ready", "bound DAV identity created");
  assert(
    !bound.effects.includes("transaction.begin"),
    "existing DAV transaction is used without opening another owner",
  );
});
