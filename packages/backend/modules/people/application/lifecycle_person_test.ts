import {
  createPersonLifecycle,
  type PersonLifecycleDependencies,
  type PersonLifecycleRecord,
} from "../public.ts";
import { assert } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import { fixedClock } from "../../../testing/fakes.ts";

const actor = fixtures.actor();
const personId = fixtures.personId();
const updatedAt = "2026-08-15T08:00:00.000Z";

function fake(lifecycle: "active" | "archived" | "deleted" = "active") {
  let current: PersonLifecycleRecord = {
    familyName: "Lovelace",
    givenName: "Ada",
    id: personId,
    isDeceased: false,
    isPartial: false,
    lifecycle,
    updatedAt,
  };
  let audits = 0;
  const inspected: string[] = [];
  const dependencies: PersonLifecycleDependencies = {
    actors: { revalidate: () => Promise.resolve("active") },
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: () => {
        audits += 1;
        return Promise.resolve("00000000-0000-4000-8000-000000000200");
      },
    },
    clock: fixedClock("2026-08-15T09:00:00.000Z"),
    genders: {
      inspect: (command) => {
        inspected.push(command.genderOptionId);
        return Promise.resolve(
          command.genderOptionId === archivedOption
            ? { archived: true, status: "ready" as const }
            : command.genderOptionId === currentOption
            ? { archived: false, status: "ready" as const }
            : { status: "not-found" as const },
        );
      },
    },
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
          ...(command.input?.description
            ? { description: command.input.description }
            : {}),
          ...(command.input?.genderOptionId
            ? { genderOptionId: command.input.genderOptionId }
            : current.genderOptionId &&
                command.input?.genderOptionId === undefined
            ? { genderOptionId: current.genderOptionId }
            : {}),
          givenName: command.input?.givenName ?? current.givenName,
          id: current.id,
          isDeceased: command.input?.isDeceased ?? current.isDeceased,
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
  return {
    audits: () => audits,
    dependencies,
    inspected: () => inspected,
    seed: (person: Partial<PersonLifecycleRecord>) => {
      current = { ...current, ...person };
    },
  };
}

const currentOption = "00000000-0000-4000-8000-000000000301";
const archivedOption = "00000000-0000-4000-8000-000000000302";
const foreignOption = "00000000-0000-4000-8000-000000000303";

Deno.test("PEOPLE-004 rejects editing an archived person before mutation", async () => {
  let changed = false;
  const dependencies = {
    actors: { revalidate: () => Promise.resolve("active" as const) },
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: () => Promise.resolve("00000000-0000-4000-8000-000000000200"),
    },
    clock: fixedClock("2026-08-15T09:00:00.000Z"),
    genders: { inspect: () => Promise.resolve({ status: "not-found" }) },
    repository: {
      assertPostcondition: () => Promise.resolve(),
      lock: () =>
        Promise.resolve({
          status: "ready" as const,
          person: {
            familyName: "Lovelace",
            givenName: "Ada",
            id: personId,
            isDeceased: false,
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

Deno.test("[AUD-W1] only a restore that happens tells planning, in its transaction", async () => {
  const context = fake();
  const published: { personId: string; transaction: unknown }[] = [];
  const people = createPersonLifecycle({
    ...context.dependencies,
    restorePublisher: {
      restored: (command) => {
        published.push({
          personId: command.personId,
          transaction: command.transaction,
        });
        return Promise.resolve();
      },
    },
  });
  const archived = await people.archive(actor, personId, {
    expectedUpdatedAt: updatedAt,
  });
  assert(archived.status === "archived", "active person is archived");
  assert(published.length < 1, "an archive publishes nothing");
  const restored = await people.restore(actor, personId, {
    expectedUpdatedAt: archived.person.updatedAt,
  });
  assert(restored.status === "restored", "archived person is restored");
  await people.restore(actor, personId, {
    expectedUpdatedAt: archived.person.updatedAt,
  });
  assert(
    published.length === 1 && published[0]!.personId === personId &&
      published[0]!.transaction !== undefined,
    `one restore published once: ${JSON.stringify(published)}`,
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

Deno.test("[GAP-047] an edit saves the description, gender, and deceased state", async () => {
  const context = fake();
  const people = createPersonLifecycle(context.dependencies);
  const result = await people.edit(actor, personId, {
    description: "  Wrote the first program  ",
    expectedUpdatedAt: updatedAt,
    genderOptionId: currentOption,
    givenName: "Ada",
    isDeceased: true,
    isPartial: false,
  });
  assert(result.status === "updated", "the wider identity is saved");
  assert(
    result.person.description === "Wrote the first program" &&
      result.person.genderOptionId === currentOption &&
      result.person.isDeceased && context.audits() === 1,
    "the description is trimmed, the option set, and the edit audited once",
  );
  assert(
    context.inspected().join() === currentOption,
    "a newly chosen option is looked up in the workspace",
  );
});

Deno.test("[GAP-047] an edit refuses a foreign or archived option but keeps a saved one", async () => {
  const context = fake();
  const people = createPersonLifecycle(context.dependencies);
  for (const genderOptionId of [foreignOption, archivedOption]) {
    const refused = await people.edit(actor, personId, {
      expectedUpdatedAt: updatedAt,
      genderOptionId,
      givenName: "Ada",
      isPartial: false,
    });
    assert(
      refused.status === "validation-error" &&
        "genderOptionId" in refused.errors && context.audits() === 0,
      `${genderOptionId} is refused before any write`,
    );
  }
  context.seed({ genderOptionId: archivedOption });
  const kept = await people.edit(actor, personId, {
    expectedUpdatedAt: updatedAt,
    genderOptionId: archivedOption,
    givenName: "Augusta",
    isPartial: false,
  });
  assert(
    kept.status === "updated" && kept.person.genderOptionId === archivedOption,
    "an option archived after it was chosen stays on the person",
  );
  assert(
    context.inspected().length === 2,
    "an unchanged option is not looked up again",
  );
});

Deno.test("[GAP-047] a stale edit of the wider identity changes nothing", async () => {
  const context = fake();
  const result = await createPersonLifecycle(context.dependencies).edit(
    actor,
    personId,
    {
      description: "Later",
      expectedUpdatedAt: "2026-08-15T07:00:00.000Z",
      givenName: "Ada",
      isDeceased: true,
      isPartial: false,
    },
  );
  assert(
    result.status === "stale" && context.audits() === 0,
    "an edit composed against an older revision is refused",
  );
});
