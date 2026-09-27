import {
  createLifeEventManagement,
  type LifeEventManagementDependencies,
  type LifeEventRepository,
  type StoredLifeEvent,
} from "../public.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import { fixedClock, sequentialIds } from "../../../testing/fakes.ts";

const actor = fixtures.actor();
const personId = fixtures.personId();
const TYPE_ID = "7d0b0a3e-8f1c-4c4b-9c55-0d9e3c1f2a10";
const ARCHIVED_TYPE_ID = "7d0b0a3e-8f1c-4c4b-9c55-0d9e3c1f2a11";
const NOW = "2026-09-27T10:00:00.000Z";

type Audited = { readonly action: string; readonly lifeEventId: string };

/** A repository over one map, with the revision check the adapter makes. */
function memoryRepository(
  initial: readonly StoredLifeEvent[] = [],
): LifeEventRepository & { readonly rows: Map<string, StoredLifeEvent> } {
  const rows = new Map(initial.map((event) => [event.id, event]));
  const owned = (id: string, owner: string) => {
    const event = rows.get(id);
    return event?.personId === owner ? event : undefined;
  };
  return {
    rows,
    create: (command) => {
      const event: StoredLifeEvent = {
        ...command.value,
        createdAt: command.now.toISOString(),
        id: command.id,
        personId: command.personId,
        updatedAt: command.now.toISOString(),
      };
      rows.set(event.id, event);
      return Promise.resolve(event);
    },
    delete: (command) => {
      const event = owned(command.lifeEventId, command.personId);
      if (event?.updatedAt !== command.expectedUpdatedAt) {
        return Promise.resolve(false);
      }
      rows.delete(event.id);
      return Promise.resolve(true);
    },
    lock: (command) =>
      Promise.resolve(owned(command.lifeEventId, command.personId)),
    update: (command) => {
      const event = owned(command.lifeEventId, command.personId);
      if (event?.updatedAt !== command.expectedUpdatedAt) {
        return Promise.resolve(undefined);
      }
      const next: StoredLifeEvent = {
        ...command.value,
        createdAt: event.createdAt,
        ...(command.keepHappenedAt && event.happenedAt
          ? { happenedAt: event.happenedAt }
          : {}),
        id: event.id,
        personId: event.personId,
        updatedAt: command.now.toISOString(),
      };
      rows.set(event.id, next);
      return Promise.resolve(next);
    },
  };
}

function management(
  overrides: Partial<LifeEventManagementDependencies> = {},
  audited: Audited[] = [],
) {
  const repository = memoryRepository();
  const dependencies: LifeEventManagementDependencies = {
    actors: { revalidate: () => Promise.resolve("active" as const) },
    audit: {
      record: (command) => {
        audited.push({
          action: command.action,
          lifeEventId: command.lifeEventId,
        });
        return Promise.resolve("audit-id");
      },
    },
    clock: fixedClock(NOW),
    ids: sequentialIds(),
    people: { inspect: () => Promise.resolve({ status: "ready" }) },
    repository,
    transaction: { run: (work) => work({ opaque: {} }) },
    workspace: {
      inspect: (command) =>
        Promise.resolve(
          command.typeId === undefined
            ? { status: "ready" }
            : command.typeId === TYPE_ID || command.typeId === ARCHIVED_TYPE_ID
            ? {
              status: "ready",
              type: {
                archived: command.typeId === ARCHIVED_TYPE_ID,
                id: command.typeId,
                name: "Graduation",
              },
            }
            : { status: "not-found" },
        ),
    },
    ...overrides,
  };
  return {
    lifeEvents: createLifeEventManagement(dependencies),
    repository: (overrides.repository ?? repository) as ReturnType<
      typeof memoryRepository
    >,
  };
}

Deno.test("[JOURNAL-002] a member records, edits, and removes a person's life event with audit", async () => {
  const audited: Audited[] = [];
  const { lifeEvents, repository } = management({}, audited);

  const created = await lifeEvents.create(actor, personId, {
    month: 6,
    name: "  Moved to Lisbon ",
    precision: "year_month",
    typeId: TYPE_ID,
    year: 2019,
  });
  if (created.status !== "created") throw new Error(created.status);
  if (
    created.event.name !== "Moved to Lisbon" ||
    created.event.typeName !== "Graduation" ||
    created.event.personId !== personId
  ) throw new Error(`created ${JSON.stringify(created.event)}`);

  const edited = await lifeEvents.update(actor, personId, created.event.id, {
    expectedUpdatedAt: created.event.updatedAt,
    name: "Moved to Porto",
    precision: "year",
    year: 2020,
  });
  if (edited.status !== "updated") throw new Error(edited.status);
  if (edited.event.name !== "Moved to Porto" || edited.event.month) {
    throw new Error(`edited ${JSON.stringify(edited.event)}`);
  }

  const removed = await lifeEvents.delete(actor, personId, created.event.id, {
    expectedUpdatedAt: edited.event.updatedAt,
  });
  if (removed.status !== "deleted" || repository.rows.size !== 0) {
    throw new Error("the life event was not removed");
  }
  if (
    JSON.stringify(audited.map((entry) => entry.action)) !==
      JSON.stringify(["created", "updated", "deleted"]) ||
    audited.some((entry) => entry.lifeEventId !== created.event.id)
  ) throw new Error(`audited ${JSON.stringify(audited)}`);
});

Deno.test("[JOURNAL-002] invalid life events are refused before any transaction", async () => {
  let opened = 0;
  const { lifeEvents } = management({
    transaction: {
      run: (work) => {
        opened += 1;
        return work({ opaque: {} });
      },
    },
  });
  const unnamed = await lifeEvents.create(actor, personId, {
    precision: "unknown",
  });
  const contradicted = await lifeEvents.create(actor, personId, {
    month: 2,
    name: "Moved",
    precision: "year",
  });
  const unversioned = await lifeEvents.update(actor, personId, TYPE_ID, {
    expectedUpdatedAt: "yesterday",
    name: "Moved",
    precision: "unknown",
  });
  const undatedDelete = await lifeEvents.delete(actor, personId, TYPE_ID, {
    expectedUpdatedAt: "",
  });
  if (
    unnamed.status !== "validation-error" ||
    unnamed.errors.name !== "Enter a name or choose a type." ||
    contradicted.status !== "validation-error" ||
    contradicted.errors.year === undefined ||
    unversioned.status !== "validation-error" ||
    unversioned.errors.expectedUpdatedAt === undefined ||
    undatedDelete.status !== "validation-error" || opened !== 0
  ) throw new Error("an invalid life event reached the transaction");
});

Deno.test("[JOURNAL-002] a type must be this workspace's and current to be chosen", async () => {
  const { lifeEvents, repository } = management();
  const foreign = await lifeEvents.create(actor, personId, {
    precision: "unknown",
    typeId: "7d0b0a3e-8f1c-4c4b-9c55-0d9e3c1f2aff",
  });
  const archived = await lifeEvents.create(actor, personId, {
    precision: "unknown",
    typeId: ARCHIVED_TYPE_ID,
  });
  if (
    foreign.status !== "validation-error" ||
    foreign.errors.typeId !== "Choose a life-event type from this workspace." ||
    archived.status !== "validation-error" ||
    archived.errors.typeId !==
      "This life-event type is archived. Choose another type." ||
    repository.rows.size !== 0
  ) throw new Error("a foreign or archived type was accepted");

  repository.rows.set("00000000-0000-4000-8000-0000000000e1", {
    createdAt: NOW,
    id: "00000000-0000-4000-8000-0000000000e1",
    personId,
    precision: "unknown",
    typeId: ARCHIVED_TYPE_ID,
    typeName: "Graduation",
    updatedAt: NOW,
  });
  const kept = await lifeEvents.update(
    actor,
    personId,
    "00000000-0000-4000-8000-0000000000e1",
    {
      expectedUpdatedAt: NOW,
      note: "Kept its retired type",
      precision: "unknown",
      typeId: ARCHIVED_TYPE_ID,
    },
  );
  if (kept.status !== "updated") {
    throw new Error(
      `an event could not keep its archived type: ${kept.status}`,
    );
  }
});

Deno.test("[JOURNAL-002] a recorded instant survives an edit that keeps the date", async () => {
  const id = "00000000-0000-4000-8000-0000000000e2";
  const stored: StoredLifeEvent = {
    createdAt: NOW,
    day: 4,
    happenedAt: "1990-03-04T10:15:00.000Z",
    id,
    month: 3,
    name: "Born",
    personId,
    precision: "full",
    updatedAt: NOW,
    year: 1990,
  };
  const repository = memoryRepository([stored]);
  const { lifeEvents } = management({ repository });
  const renamed = await lifeEvents.update(actor, personId, id, {
    day: 4,
    expectedUpdatedAt: NOW,
    month: 3,
    name: "Born in Leeds",
    precision: "full",
    year: 1990,
  });
  if (renamed.status !== "updated" || !renamed.event.happenedAt) {
    throw new Error("renaming dropped the recorded instant");
  }
  const moved = await lifeEvents.update(actor, personId, id, {
    day: 5,
    expectedUpdatedAt: renamed.event.updatedAt,
    month: 3,
    name: "Born in Leeds",
    precision: "full",
    year: 1990,
  });
  if (moved.status !== "updated" || moved.event.happenedAt) {
    throw new Error("moving the date kept an instant that no longer applies");
  }
});

Deno.test("[JOURNAL-002] refusals: standing, person, module, row, and revision", async () => {
  const id = "00000000-0000-4000-8000-0000000000e3";
  const stored: StoredLifeEvent = {
    createdAt: NOW,
    id,
    name: "Moved",
    personId,
    precision: "unknown",
    updatedAt: NOW,
  };
  const value = { name: "Moved", precision: "unknown" as const };
  const audited: Audited[] = [];

  const revoked = management({
    actors: { revalidate: () => Promise.resolve("revoked" as const) },
  }, audited).lifeEvents;
  const archived = management({
    people: { inspect: () => Promise.resolve({ status: "archived" }) },
  }, audited).lifeEvents;
  const missing = management({
    people: { inspect: () => Promise.resolve({ status: "not-found" }) },
  }, audited).lifeEvents;
  const hidden = management({
    workspace: { inspect: () => Promise.resolve({ status: "hidden" }) },
  }, audited).lifeEvents;
  const offline = management({
    transaction: { run: () => Promise.reject(new Error("offline")) },
  }, audited).lifeEvents;
  const existing = management({
    repository: memoryRepository([stored]),
  }, audited).lifeEvents;

  const outcomes = [
    (await revoked.create(actor, personId, value)).status,
    (await archived.create(actor, personId, value)).status,
    (await archived.update(actor, personId, id, {
      ...value,
      expectedUpdatedAt: NOW,
    })).status,
    (await archived.delete(actor, personId, id, { expectedUpdatedAt: NOW }))
      .status,
    (await missing.create(actor, personId, value)).status,
    (await hidden.create(actor, personId, value)).status,
    (await offline.create(actor, personId, value)).status,
    (await existing.update(actor, fixtures.personId(9), id, {
      ...value,
      expectedUpdatedAt: NOW,
    })).status,
    (await existing.delete(actor, personId, id, {
      expectedUpdatedAt: "2026-09-26T10:00:00.000Z",
    })).status,
    (await existing.update(actor, personId, id, {
      ...value,
      expectedUpdatedAt: "2026-09-26T10:00:00.000Z",
    })).status,
  ];
  const expected = [
    "forbidden",
    "archived-write-rejected",
    "archived-write-rejected",
    "archived-write-rejected",
    "not-found",
    "hidden",
    "unavailable",
    "not-found",
    "stale",
    "stale",
  ];
  if (JSON.stringify(outcomes) !== JSON.stringify(expected)) {
    throw new Error(`unexpected refusals: ${outcomes.join(", ")}`);
  }
  if (audited.length !== 0) throw new Error("a refused write was audited");
});

Deno.test("[JOURNAL-002] a write that loses its revision race is stale, not saved", async () => {
  const id = "00000000-0000-4000-8000-0000000000e4";
  const stored: StoredLifeEvent = {
    createdAt: NOW,
    id,
    name: "Moved",
    personId,
    precision: "unknown",
    updatedAt: NOW,
  };
  const repository = memoryRepository([stored]);
  const racing: LifeEventRepository = {
    ...repository,
    delete: () => Promise.resolve(false),
    update: () => Promise.resolve(undefined),
  };
  const { lifeEvents } = management({ repository: racing });
  const updated = await lifeEvents.update(actor, personId, id, {
    expectedUpdatedAt: NOW,
    name: "Moved again",
    precision: "unknown",
  });
  const deleted = await lifeEvents.delete(actor, personId, id, {
    expectedUpdatedAt: NOW,
  });
  if (updated.status !== "stale" || deleted.status !== "stale") {
    throw new Error(`${updated.status}, ${deleted.status}`);
  }
});

Deno.test("[JOURNAL-002] an edit is judged like a new event, and a missing event is not found", async () => {
  const id = "00000000-0000-4000-8000-0000000000e5";
  const stored: StoredLifeEvent = {
    createdAt: NOW,
    id,
    name: "Moved",
    personId,
    precision: "unknown",
    updatedAt: NOW,
  };
  const { lifeEvents } = management({
    repository: memoryRepository([stored]),
  });
  const invalidEdit = await lifeEvents.update(actor, personId, id, {
    expectedUpdatedAt: NOW,
    precision: "unknown",
  });
  const foreignType = await lifeEvents.update(actor, personId, id, {
    expectedUpdatedAt: NOW,
    precision: "unknown",
    typeId: "7d0b0a3e-8f1c-4c4b-9c55-0d9e3c1f2aff",
  });
  const missing = await lifeEvents.delete(
    actor,
    personId,
    "00000000-0000-4000-8000-0000000000e6",
    { expectedUpdatedAt: NOW },
  );
  if (
    invalidEdit.status !== "validation-error" ||
    invalidEdit.errors.name === undefined ||
    foreignType.status !== "validation-error" ||
    foreignType.errors.typeId === undefined ||
    missing.status !== "not-found"
  ) {
    throw new Error(
      `${invalidEdit.status}, ${foreignType.status}, ${missing.status}`,
    );
  }
});
