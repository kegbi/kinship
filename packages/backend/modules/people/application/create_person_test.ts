import {
  createPeopleManagement,
  type PeopleManagementDependencies,
  type PeopleTransaction,
  type PersonIdentity,
} from "../public.ts";
import { assert, assertRejects } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import { fixedClock } from "../../../testing/fakes.ts";
import { derivePersonId } from "../domain/person_identity.ts";

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
      actors: {
        revalidate(command) {
          effects.push(
            command.lock ? "authorization.lock" : "authorization.read",
          );
          return Promise.resolve(
            options.authorize === false ? "revoked" : "active",
          );
        },
      },
      clock: fixedClock("2026-08-15T12:00:00.000Z"),
      ids: {
        create: () => "00000000-0000-4000-8000-000000000100",
      },
      repository: {
        lockRequest() {
          effects.push("request.lock");
          return Promise.resolve();
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
              updatedAt: "2026-08-15T11:00:00.000000Z",
            },
            status: "ready",
          });
        },
        getRequestedIdentity(command) {
          return this.getIdentity(command);
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
            updatedAt: "2026-08-15T12:00:00.000000Z",
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

const actor = fixtures.actor();

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
  await assertRejects(async () => {
    await createPeopleManagement(failedFake.dependencies).create(actor, {
      givenName: "Ada",
      isPartial: false,
    });
  }, "required audit failure surfaces");
  assert(
    failedFake.effects.at(-1) === "transaction.rollback",
    "person and audit are atomic",
  );
});

Deno.test("PEOPLE-001 reads identity through the public active-workspace facade", async () => {
  const personId = fixtures.personId();
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
      `transaction.begin,authorization.read,people.get:${personId},transaction.commit`,
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

/**
 * A people store that remembers what it was asked to write, so a retry meets
 * the row the first attempt left behind (MCP-D4).
 */
function storedPeople() {
  const effects: string[] = [];
  const rows = new Map<
    string,
    { readonly person: PersonIdentity; state: "archived" | "deleted" | "ready" }
  >();
  let fresh = 0;
  const transaction: PeopleTransaction = { opaque: "people-request-test" };
  const dependencies: PeopleManagementDependencies = {
    actors: { revalidate: () => Promise.resolve("active") },
    audit: {
      record() {
        effects.push("audit.record");
        return Promise.resolve();
      },
      assertPostcondition: () => Promise.resolve(),
    },
    clock: fixedClock("2026-11-22T12:00:00.000Z"),
    ids: {
      create: () =>
        `00000000-0000-4000-8000-${String(++fresh).padStart(12, "0")}`,
    },
    repository: {
      lockRequest(command) {
        effects.push(`request.lock:${command.id}`);
        return Promise.resolve();
      },
      findPossibleDuplicates(command) {
        effects.push("duplicates");
        return Promise.resolve(
          [...rows.values()].filter((row) =>
            row.state === "ready" &&
            row.person.givenName === command.givenName &&
            row.person.familyName === command.familyName
          ).map((row) => ({
            displayName: row.person.givenName,
            id: row.person.id,
          })),
        );
      },
      getIdentity(command) {
        const row = rows.get(command.personId);
        if (!row || row.state === "deleted") {
          return Promise.resolve({ status: "not-found" });
        }
        return Promise.resolve({ person: row.person, status: row.state });
      },
      getRequestedIdentity(command) {
        effects.push(`people.requested:${command.personId}`);
        const row = rows.get(command.personId);
        if (!row) return Promise.resolve({ status: "not-found" });
        if (row.state === "deleted") {
          return Promise.resolve({ status: "deleted" });
        }
        return Promise.resolve({ person: row.person, status: row.state });
      },
      create(command) {
        effects.push(`people.create:${command.id}`);
        if (rows.has(command.id)) {
          return Promise.reject(new Error("duplicate primary key"));
        }
        const person = {
          ...(command.familyName ? { familyName: command.familyName } : {}),
          givenName: command.givenName,
          id: command.id,
          isPartial: command.isPartial,
          ...(command.middleName ? { middleName: command.middleName } : {}),
          ...(command.nickname ? { nickname: command.nickname } : {}),
          updatedAt: "2026-11-22T12:00:00.000000Z",
        };
        rows.set(command.id, { person, state: "ready" });
        return Promise.resolve(person);
      },
      assertCreatedPostcondition: () => Promise.resolve(),
    },
    transaction: { run: (work) => work(transaction) },
  };
  return { dependencies, effects, rows };
}

const REQUEST = "0f9e8d7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f";

/** How many people the store holds, read fresh at every call. */
function stored(store: ReturnType<typeof storedPeople>): number {
  return store.rows.size;
}

Deno.test("MCP-D4 a person created with a requestId is created once and replayed by id", async () => {
  const store = storedPeople();
  const people = createPeopleManagement(store.dependencies);
  const derived = await derivePersonId(actor.workspaceId, REQUEST);
  const input = {
    familyName: "Lovelace",
    givenName: "Ada",
    isPartial: false,
    requestId: REQUEST,
  };

  const first = await people.create(actor, input);
  assert(first.status === "created", `first create: ${first.status}`);
  assert(first.person.id === derived, "the request names the person");

  const replay = await people.create(actor, {
    ...input,
    familyName: "  Lovelace ",
    requestId: REQUEST.toUpperCase(),
  });
  assert(replay.status === "created", `replay: ${replay.status}`);
  assert(replay.person.id === derived, "the replay returns the same person");
  assert(store.rows.size === 1, "a replay creates no second person");
  assert(
    store.effects.filter((effect) => effect === "audit.record").length === 1,
    "a replay audits nothing new",
  );
  assert(
    store.effects.filter((effect) => effect === "duplicates").length === 1,
    "a replay is answered before duplicate detection",
  );
});

Deno.test("MCP-E1 a replayed request answers the stored person's current revision", async () => {
  const store = storedPeople();
  const people = createPeopleManagement(store.dependencies);
  const input = { givenName: "Ada", isPartial: false, requestId: REQUEST };
  const first = await people.create(actor, input);
  assert(first.status === "created", `first create: ${first.status}`);
  const moved = "2026-11-22T12:00:00.000001Z";
  store.rows.set(first.person.id, {
    person: { ...first.person, updatedAt: moved },
    state: "ready",
  });
  const replay = await people.create(actor, input);
  assert(replay.status === "created", `replay: ${replay.status}`);
  assert(
    replay.person.updatedAt === moved,
    `the replay answers the revision now stored: ${replay.person.updatedAt}`,
  );
});

Deno.test("MCP-D4 the same requestId with other names is an idempotency conflict", async () => {
  const store = storedPeople();
  const people = createPeopleManagement(store.dependencies);
  await people.create(actor, {
    givenName: "Ada",
    isPartial: false,
    requestId: REQUEST,
  });
  const changes = [
    { familyName: "Byron" },
    { nickname: "Countess" },
    { middleName: "Augusta" },
    { givenName: "Augusta" },
    { isPartial: true },
  ];
  for (const changed of changes) {
    const result = await people.create(actor, {
      givenName: "Ada",
      isPartial: false,
      requestId: REQUEST,
      ...changed,
    });
    assert(
      result.status === "idempotency-conflict",
      `${JSON.stringify(changed)} conflicts: ${result.status}`,
    );
  }
  assert(store.rows.size === 1, "a conflict writes nothing");
});

Deno.test("MCP-D4 a malformed requestId is refused before any transaction", async () => {
  const store = storedPeople();
  const result = await createPeopleManagement(store.dependencies).create(
    actor,
    { givenName: "Ada", isPartial: false, requestId: "not-a-request" },
  );
  assert(
    result.status === "validation-error" &&
      result.errors.requestId !== undefined,
    "the request identifier must be canonical",
  );
  assert(store.effects.length === 0, "nothing was read or written");
});

Deno.test("MCP-D4 without a requestId every create is a new person, as before", async () => {
  const store = storedPeople();
  const people = createPeopleManagement(store.dependencies);
  const first = await people.create(actor, {
    givenName: "Ada",
    isPartial: false,
  });
  const second = await people.create(actor, {
    duplicateOverride: true,
    givenName: "Ada",
    isPartial: false,
  });
  assert(
    first.status === "created" && second.status === "created" &&
      first.person.id !== second.person.id,
    "two creates without a request identifier are two people",
  );
  assert(
    !store.effects.some((effect) => effect.startsWith("request.lock")),
    "no request lock without a request identifier",
  );
});

Deno.test("MCP-D4 a possible duplicate creates nothing, and the override retry with the same requestId creates it", async () => {
  const store = storedPeople();
  const people = createPeopleManagement(store.dependencies);
  await people.create(actor, {
    familyName: "Lovelace",
    givenName: "Ada",
    isPartial: false,
  });
  const input = {
    familyName: "Lovelace",
    givenName: "Ada",
    isPartial: false,
    requestId: REQUEST,
  };
  const warned = await people.create(actor, input);
  assert(warned.status === "possible-duplicate", `warned: ${warned.status}`);
  assert(stored(store) === 1, "the warning created nothing");

  const overridden = await people.create(actor, {
    ...input,
    duplicateOverride: true,
  });
  assert(overridden.status === "created", `override: ${overridden.status}`);
  const derived = await derivePersonId(actor.workspaceId, REQUEST);
  assert(overridden.person.id === derived, "the override uses the request id");

  const overrideRetry = await people.create(actor, {
    ...input,
    duplicateOverride: true,
  });
  const originalRetry = await people.create(actor, input);
  assert(
    overrideRetry.status === "created" &&
      overrideRetry.person.id === derived &&
      originalRetry.status === "created" &&
      originalRetry.person.id === derived,
    "duplicateOverride is not part of the compared payload",
  );
  assert(stored(store) === 2, "the retries created no third person");
});

Deno.test("MCP-D4 a replay never resurrects a deleted person, and an archived one is returned as stored", async () => {
  const store = storedPeople();
  const people = createPeopleManagement(store.dependencies);
  const input = { givenName: "Ada", isPartial: false, requestId: REQUEST };
  const created = await people.create(actor, input);
  if (created.status !== "created") throw new Error(created.status);

  store.rows.get(created.person.id)!.state = "archived";
  const archived = await people.create(actor, input);
  assert(
    archived.status === "created" && archived.person.id === created.person.id,
    "an archived person is the person the request created",
  );

  store.rows.get(created.person.id)!.state = "deleted";
  const deleted = await people.create(actor, input);
  assert(
    deleted.status === "idempotency-conflict",
    `a deleted person is not recreated: ${deleted.status}`,
  );
  const ensured = await people.ensure(actor, REQUEST, {
    givenName: "Ada",
    isPartial: false,
  });
  assert(
    ensured.status === "idempotency-conflict",
    `ensure does not recreate a deleted person: ${ensured.status}`,
  );
  assert(
    store.rows.get(created.person.id)!.state === "deleted" &&
      store.rows.size === 1,
    "nothing was resurrected or duplicated",
  );
});

Deno.test("MCP-D4 a revoked member's request is refused before the request is read", async () => {
  const store = storedPeople();
  const people = createPeopleManagement({
    ...store.dependencies,
    actors: { revalidate: () => Promise.resolve("revoked") },
  });
  const result = await people.create(actor, {
    givenName: "Ada",
    isPartial: false,
    requestId: REQUEST,
  });
  assert(result.status === "forbidden", `revoked: ${result.status}`);
  assert(store.effects.length === 0, "nothing was locked, read, or written");
});
