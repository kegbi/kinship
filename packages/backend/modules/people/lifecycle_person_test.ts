import {
  createPersonLifecycle,
  type PersonLifecycleDependencies,
  type PersonLifecycleRecord,
} from "./application/lifecycle_person.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const actor = {
  memberId: "00000000-0000-4000-8000-000000000002",
  role: "member" as const,
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000003",
};
const personId = "00000000-0000-4000-8000-000000000100";
const updatedAt = "2026-08-15T08:00:00.000Z";

function fake(lifecycle: "active" | "archived" | "deleted" = "active") {
  let current: PersonLifecycleRecord = {
    familyName: "Lovelace",
    givenName: "Ada",
    id: personId,
    isPartial: false,
    lifecycle,
    updatedAt,
  };
  let audits = 0;
  const dependencies: PersonLifecycleDependencies = {
    actors: { revalidate: () => Promise.resolve("active") },
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: () => {
        audits += 1;
        return Promise.resolve("00000000-0000-4000-8000-000000000200");
      },
    },
    clock: { now: () => new Date("2026-08-15T09:00:00.000Z") },
    repository: {
      assertPostcondition: () => Promise.resolve(),
      lock: () => Promise.resolve({ person: current, status: "ready" }),
      mutate: (command) => {
        current = {
          ...(command.input?.familyName
            ? { familyName: command.input.familyName }
            : command.action === "edit"
            ? {}
            : current.familyName
            ? { familyName: current.familyName }
            : {}),
          givenName: command.input?.givenName ?? current.givenName,
          id: current.id,
          isPartial: command.input?.isPartial ?? current.isPartial,
          lifecycle: command.action === "archive"
            ? "archived"
            : command.action === "restore"
            ? "active"
            : command.action === "delete"
            ? "deleted"
            : current.lifecycle,
          updatedAt: command.occurredAt.toISOString(),
        };
        return Promise.resolve(current);
      },
    },
    transaction: {
      run: <T>(work: (transaction: { opaque: unknown }) => Promise<T>) =>
        work({ opaque: undefined }),
    },
  };
  return { audits: () => audits, dependencies };
}

Deno.test("PEOPLE-004 rejects editing an archived person before mutation", async () => {
  let changed = false;
  const dependencies = {
    actors: { revalidate: () => Promise.resolve("active" as const) },
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: () => Promise.resolve("00000000-0000-4000-8000-000000000200"),
    },
    clock: { now: () => new Date("2026-08-15T09:00:00.000Z") },
    repository: {
      assertPostcondition: () => Promise.resolve(),
      lock: () =>
        Promise.resolve({
          status: "ready" as const,
          person: {
            familyName: "Lovelace",
            givenName: "Ada",
            id: personId,
            isPartial: false,
            lifecycle: "archived" as const,
            updatedAt,
          },
        }),
      mutate: () => {
        changed = true;
        return Promise.resolve(undefined);
      },
    },
    transaction: {
      run: <T>(work: (transaction: { opaque: unknown }) => Promise<T>) =>
        work({ opaque: undefined }),
    },
  } satisfies PersonLifecycleDependencies;

  const result = await createPersonLifecycle(dependencies).edit(
    actor,
    personId,
    {
      expectedUpdatedAt: updatedAt,
      familyName: "Byron",
      givenName: "Ada",
      isPartial: false,
    },
  );

  assert(result.status === "archived-write-rejected", "archive blocks edit");
  assert(!changed, "no archived person mutation occurs");
});

Deno.test("PEOPLE-004 validates and atomically audits identity edits", async () => {
  const context = fake();
  const people = createPersonLifecycle(context.dependencies);
  const invalid = await people.edit(actor, personId, {
    expectedUpdatedAt: "invalid",
    givenName: "",
    isPartial: false,
  });
  assert(invalid.status === "validation-error", "invalid edit is rejected");

  const result = await people.edit(actor, personId, {
    expectedUpdatedAt: updatedAt,
    familyName: "  Byron  ",
    givenName: " Augusta ",
    isPartial: false,
    middleName: " ",
  });
  assert(result.status === "updated", "valid edit is applied");
  assert(
    result.person.givenName === "Augusta" &&
      result.person.familyName === "Byron" && context.audits() === 1,
    "identity is normalized and audited once",
  );
});

Deno.test("PEOPLE-004 archive and restore transitions are idempotent", async () => {
  const context = fake();
  const people = createPersonLifecycle(context.dependencies);
  const archived = await people.archive(actor, personId, {
    expectedUpdatedAt: updatedAt,
  });
  assert(archived.status === "archived", "active person is archived");
  const repeatedArchive = await people.archive(actor, personId, {
    expectedUpdatedAt: updatedAt,
  });
  assert(
    repeatedArchive.status === "archived" && context.audits() === 1,
    "archive replay is a no-op",
  );
  const restored = await people.restore(actor, personId, {
    expectedUpdatedAt: archived.person.updatedAt,
  });
  assert(restored.status === "restored", "archived person is restored");
  const repeatedRestore = await people.restore(actor, personId, {
    expectedUpdatedAt: archived.person.updatedAt,
  });
  assert(
    repeatedRestore.status === "restored" && context.audits() === 2,
    "restore replay is a no-op",
  );
});

Deno.test("PEOPLE-004 previews retained dependents and requires exact deletion confirmation", async () => {
  const context = fake();
  const people = createPersonLifecycle(context.dependencies);
  const preview = await people.previewDeletion(actor, personId);
  assert(preview.status === "ready", "deletion impact is available");
  assert(
    preview.impact.confirmation === "DELETE Ada Lovelace" &&
      preview.impact.dependentRecordPolicy === "retained",
    "preview exposes canonical soft-delete impact",
  );
  const cancelled = await people.delete(actor, personId, {
    confirmation: "",
    expectedUpdatedAt: updatedAt,
  });
  assert(
    cancelled.status === "confirmation-required" && context.audits() === 0,
    "missing confirmation changes nothing",
  );
  const stale = await people.delete(actor, personId, {
    confirmation: preview.impact.confirmation,
    expectedUpdatedAt: "2026-08-14T00:00:00.000Z",
  });
  assert(stale.status === "stale", "stale preview cannot delete");
  const deleted = await people.delete(actor, personId, {
    confirmation: preview.impact.confirmation,
    expectedUpdatedAt: updatedAt,
  });
  assert(
    deleted.status === "deleted" && context.audits() === 1,
    "confirmed deletion is audited",
  );
  const repeated = await people.delete(actor, personId, {
    confirmation: preview.impact.confirmation,
    expectedUpdatedAt: updatedAt,
  });
  assert(
    repeated.status === "deleted" && context.audits() === 1,
    "delete replay is idempotent",
  );
});

Deno.test("PEOPLE-004 carries archived state into the delete postcondition", async () => {
  const context = fake("archived");
  let beforeLifecycle = "";
  const dependencies: PersonLifecycleDependencies = {
    ...context.dependencies,
    repository: {
      ...context.dependencies.repository,
      assertPostcondition: (command) => {
        beforeLifecycle = command.before.lifecycle;
        return Promise.resolve();
      },
    },
  };
  const result = await createPersonLifecycle(dependencies).delete(
    actor,
    personId,
    {
      confirmation: "DELETE Ada Lovelace",
      expectedUpdatedAt: updatedAt,
    },
  );

  assert(result.status === "deleted", "archived person deletes directly");
  assert(
    beforeLifecycle === "archived",
    "delete postcondition receives the locked archive state",
  );
});

Deno.test("PEOPLE-004 returns indistinguishable missing and explicit forbidden states", async () => {
  for (const status of ["not-found", "forbidden"] as const) {
    const context = fake();
    const dependencies: PersonLifecycleDependencies = {
      ...context.dependencies,
      repository: {
        ...context.dependencies.repository,
        lock: () => Promise.resolve({ status }),
      },
    };
    const result = await createPersonLifecycle(dependencies)
      .previewDeletion(actor, personId);
    assert(result.status === status, `${status} is preserved`);
  }
});
