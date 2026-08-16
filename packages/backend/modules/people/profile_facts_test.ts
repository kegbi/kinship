import {
  createProfileFactManagement,
  type ProfileFactAudit,
  type ProfileFactOption,
  type ProfileFactRepository,
  type ProfileFactWorkspaceBoundary,
} from "./public.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const actor = {
  memberId: "10000000-0000-4000-8000-000000000001",
  role: "member" as const,
  userId: "10000000-0000-4000-8000-000000000002",
  workspaceId: "10000000-0000-4000-8000-000000000003",
};
const personId = "10000000-0000-4000-8000-000000000004";
const transaction = { opaque: { test: true } };

Deno.test("PEOPLE-006 separates create from locked update targets", async () => {
  const revision = "2026-08-16T12:00:00.000000Z";
  const existingId = "10000000-0000-4000-8000-000000000005";
  const missingId = "10000000-0000-4000-8000-000000000099";
  const locked: string[] = [];
  const written: string[] = [];
  let personRevision = revision;
  const repository = {
    assertPostcondition: () => Promise.resolve(),
    delete: () => Promise.resolve(undefined),
    inspectContext: () =>
      Promise.resolve({
        personUpdatedAt: personRevision,
        status: "ready" as const,
      }),
    list: () => Promise.resolve([]),
    lockContext: () =>
      Promise.resolve({
        personUpdatedAt: personRevision,
        status: "ready" as const,
      }),
    lockFact: (command: { readonly factId: string }) => {
      locked.push(command.factId);
      return Promise.resolve(
        command.factId === existingId
          ? {
            id: existingId,
            section: "pets" as const,
            updatedAt: revision,
            value: { name: "Byron" },
          }
          : undefined,
      );
    },
    save: (command: { readonly id: string; readonly section: "pets" }) => {
      written.push(command.id);
      personRevision = "2026-08-16T12:00:00.000001Z";
      return Promise.resolve({
        personUpdatedAt: personRevision,
        record: {
          id: command.id,
          section: command.section,
          updatedAt: "2026-08-16T12:00:00.000001Z",
          value: { name: "Byron" },
        },
      });
    },
  } as unknown as ProfileFactRepository;
  const facts = createProfileFactManagement({
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: () => Promise.resolve(crypto.randomUUID()),
    },
    clock: { now: () => new Date("2026-08-16T12:00:00Z") },
    ids: { create: () => "10000000-0000-4000-8000-000000000006" },
    repository,
    transaction: { run: (work) => work(transaction) },
    workspace: {
      inspect: () => Promise.resolve({ options: [], status: "ready" }),
    },
  });

  const created = await facts.create(actor, personId, "pets", {
    expectedPersonUpdatedAt: revision,
    name: "Byron",
  });
  assert(created.status === "saved", "server-generated create succeeds");
  const missing = await facts.update(actor, personId, "pets", {
    expectedPersonUpdatedAt: created.personUpdatedAt,
    expectedUpdatedAt: revision,
    id: missingId,
    name: "Missing",
  });
  assert(missing.status === "not-found", "missing update target is concealed");
  assert(
    locked.includes(missingId) && !written.includes(missingId),
    "unused client update IDs are locked and never inserted",
  );
});

Deno.test("PEOPLE-006 clears food preferences with revision and audit", async () => {
  const revision = "2026-08-16T12:00:00.000000Z";
  const nextRevision = "2026-08-16T12:00:00.000001Z";
  let audits = 0;
  const before = {
    id: personId,
    section: "food-preferences" as const,
    updatedAt: revision,
    value: { foodPreferences: "Tea" },
  };
  const repository: ProfileFactRepository = {
    assertPostcondition: () => Promise.resolve(),
    delete: () => Promise.resolve({ before, personUpdatedAt: nextRevision }),
    inspectContext: () =>
      Promise.resolve({ personUpdatedAt: revision, status: "ready" }),
    list: () => Promise.resolve([before]),
    lockContext: () =>
      Promise.resolve({ personUpdatedAt: revision, status: "ready" }),
    lockFact: () => Promise.resolve(before),
    save: () => Promise.resolve(undefined),
  };
  const facts = createProfileFactManagement({
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: () => {
        audits++;
        return Promise.resolve(crypto.randomUUID());
      },
    },
    clock: { now: () => new Date("2026-08-16T12:00:00Z") },
    ids: { create: () => crypto.randomUUID() },
    repository,
    transaction: { run: (work) => work(transaction) },
    workspace: {
      inspect: () => Promise.resolve({ options: [], status: "ready" }),
    },
  });

  const result = await facts.delete(
    actor,
    personId,
    "food-preferences",
    personId,
    revision,
    revision,
  );
  assert(result.status === "deleted", "food preferences are cleared");
  assert(
    result.personUpdatedAt === nextRevision,
    "clear returns next revision",
  );
  assert(audits === 1, "clear is audited in the mutation transaction");
});

Deno.test("PEOPLE-006 rejects empty food saves before persistence", async () => {
  const revision = "2026-08-16T12:00:00.000000Z";
  let writes = 0;
  const repository: ProfileFactRepository = {
    assertPostcondition: () => Promise.resolve(),
    delete: () => Promise.resolve(undefined),
    inspectContext: () =>
      Promise.resolve({ personUpdatedAt: revision, status: "ready" }),
    list: () => Promise.resolve([]),
    lockContext: () =>
      Promise.resolve({ personUpdatedAt: revision, status: "ready" }),
    lockFact: () => Promise.resolve(undefined),
    save: () => {
      writes++;
      return Promise.resolve(undefined);
    },
  };
  const facts = createProfileFactManagement({
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: () => Promise.resolve(crypto.randomUUID()),
    },
    clock: { now: () => new Date() },
    ids: { create: () => crypto.randomUUID() },
    repository,
    transaction: { run: (work) => work(transaction) },
    workspace: {
      inspect: () => Promise.resolve({ options: [], status: "ready" }),
    },
  });

  const result = await facts.create(actor, personId, "food-preferences", {
    expectedPersonUpdatedAt: revision,
    foodPreferences: "   ",
  });
  assert(result.status === "validation-error", "blank food is invalid");
  assert(
    result.errors.foodPreferences !== undefined,
    "food field receives an adjacent error",
  );
  assert(writes === 0, "blank food never reaches persistence");
});

Deno.test("PEOPLE-006 hidden profile facts retain data and do not audit a write", async () => {
  let writes = 0;
  let audits = 0;
  const repository: ProfileFactRepository = {
    assertPostcondition: () => Promise.resolve(),
    delete: () => Promise.resolve(undefined),
    inspectContext: () =>
      Promise.resolve({
        personUpdatedAt: "2026-08-16T11:00:00.000000Z",
        status: "ready",
      }),
    list: () => Promise.resolve([]),
    lockFact: () =>
      Promise.resolve({
        id: personId,
        section: "food-preferences",
        updatedAt: "2026-08-16T11:00:00.000000Z",
        value: { foodPreferences: "Existing" },
      }),
    lockContext: () =>
      Promise.resolve({
        personUpdatedAt: "2026-08-16T11:00:00.000000Z",
        status: "ready",
      }),
    save: () => {
      writes++;
      return Promise.resolve({
        personUpdatedAt: "2026-08-16T12:00:00.000001Z",
        record: {
          id: personId,
          section: "food-preferences",
          updatedAt: "2026-08-16T12:00:00.000001Z",
          value: { foodPreferences: "No shellfish" },
        },
      });
    },
  };
  const workspace: ProfileFactWorkspaceBoundary = {
    inspect: () => Promise.resolve({ options: [], status: "hidden" }),
  };
  const audit: ProfileFactAudit = {
    assertPostcondition: () => Promise.resolve(),
    record: () => {
      audits++;
      return Promise.resolve(crypto.randomUUID());
    },
  };
  const facts = createProfileFactManagement({
    audit,
    clock: { now: () => new Date("2026-08-16T12:00:00Z") },
    ids: { create: () => crypto.randomUUID() },
    repository,
    transaction: { run: (work) => work(transaction) },
    workspace,
  });

  const result = await facts.update(actor, personId, "food-preferences", {
    id: personId,
    expectedPersonUpdatedAt: "2026-08-16T11:00:00.000000Z",
    expectedUpdatedAt: "2026-08-16T11:00:00.000000Z",
    foodPreferences: "No shellfish",
  });

  assert(result.status === "hidden", "disabled module is reported as hidden");
  assert(writes === 0, "hidden data is retained without a repository write");
  assert(audits === 0, "a rejected hidden write has no audit event");
});

Deno.test("PEOPLE-006 advances one shared person revision across fact mutations", async () => {
  const oldRevision = "2026-08-16T12:00:00.000000Z";
  const tagRevision = "2026-08-16T12:00:00.000001Z";
  const foodRevision = "2026-08-16T12:00:00.000002Z";
  let currentRevision = oldRevision;
  const repository: ProfileFactRepository = {
    save: (command) => {
      currentRevision = currentRevision === oldRevision
        ? tagRevision
        : foodRevision;
      return Promise.resolve({
        personUpdatedAt: currentRevision,
        record: {
          id: personId,
          section: command.section,
          updatedAt: currentRevision,
          value: command.value,
        },
      });
    },
    assertPostcondition: () => Promise.resolve(),
    delete: () => Promise.resolve(undefined),
    inspectContext: () =>
      Promise.resolve({ personUpdatedAt: currentRevision, status: "ready" }),
    list: () => Promise.resolve([]),
    lockFact: (command) =>
      Promise.resolve({
        id: personId,
        section: command.section,
        updatedAt: currentRevision,
        value: command.section === "tags"
          ? { tagIds: [] }
          : { foodPreferences: "Existing" },
      }),
    lockContext: () =>
      Promise.resolve({ personUpdatedAt: currentRevision, status: "ready" }),
  };
  const facts = createProfileFactManagement({
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: () => Promise.resolve(crypto.randomUUID()),
    },
    clock: { now: () => new Date("2026-08-16T12:00:00Z") },
    ids: { create: () => crypto.randomUUID() },
    repository,
    transaction: { run: (work) => work(transaction) },
    workspace: {
      inspect: () => Promise.resolve({ options: [], status: "ready" }),
    },
  });

  const tags = await facts.update(actor, personId, "tags", {
    expectedPersonUpdatedAt: oldRevision,
    expectedUpdatedAt: oldRevision,
    id: personId,
    tagIds: [],
  });
  assert(tags.status === "saved", "tags save succeeds");
  assert(tags.personUpdatedAt === tagRevision, "tags return new revision");
  const food = await facts.update(actor, personId, "food-preferences", {
    expectedPersonUpdatedAt: tags.personUpdatedAt,
    expectedUpdatedAt: tags.personUpdatedAt,
    id: personId,
    foodPreferences: "Tea",
  });
  assert(food.status === "saved", "food save accepts propagated revision");
  assert(food.personUpdatedAt === foodRevision, "food returns next revision");
});

Deno.test("PEOPLE-006 validates work ranges and introducers before persistence", async () => {
  let writes = 0;
  let referenceChecks = 0;
  const repository: ProfileFactRepository = {
    assertPostcondition: () => Promise.resolve(),
    delete: () => Promise.resolve(undefined),
    inspectContext: () =>
      Promise.resolve({
        personUpdatedAt: "2026-08-16T12:00:00.000000Z",
        status: "ready",
      }),
    inspectPersonReference: () => {
      referenceChecks++;
      return Promise.resolve(false);
    },
    list: () => Promise.resolve([]),
    lockFact: () => Promise.resolve(undefined),
    lockContext: () =>
      Promise.resolve({
        personUpdatedAt: "2026-08-16T12:00:00.000000Z",
        status: "ready",
      }),
    save: () => {
      writes++;
      return Promise.resolve(undefined);
    },
  };
  const facts = createProfileFactManagement({
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: () => Promise.resolve(crypto.randomUUID()),
    },
    clock: { now: () => new Date("2026-08-16T12:00:00Z") },
    ids: { create: () => crypto.randomUUID() },
    repository,
    transaction: { run: (work) => work(transaction) },
    workspace: {
      inspect: () => Promise.resolve({ options: [], status: "ready" }),
    },
  });

  const range = await facts.create(actor, personId, "work", {
    endOn: "2025-12-31",
    expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
    isCurrent: false,
    startOn: "2026-01-01",
    title: "Engineer",
  });
  assert(range.status === "validation-error", "invalid range is rejected");
  assert(range.errors.endOn !== undefined, "end date receives field error");

  const self = await facts.create(actor, personId, "first-meeting", {
    expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
    introducedByPersonId: personId,
  });
  assert(self.status === "validation-error", "self introducer is rejected");
  const missing = await facts.create(actor, personId, "first-meeting", {
    expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
    introducedByPersonId: "10000000-0000-4000-8000-000000000099",
  });
  assert(missing.status === "invalid-reference", "missing target is concealed");
  assert(referenceChecks === 1 && writes === 0, "invalid targets never write");
});

Deno.test("PEOPLE-006 fact reads are bounded by revision-stable continuation", async () => {
  const revision = "2026-08-16T12:00:00.000000Z";
  const records = Array.from({ length: 60 }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    section: "pets" as const,
    updatedAt: revision,
    value: { name: `Pet ${index}` },
  }));
  const listCommands: unknown[] = [];
  const repository: ProfileFactRepository & {
    readonly inspectPageAnchor: (command: {
      readonly after: { readonly id: string };
    }) => Promise<boolean>;
  } = {
    assertPostcondition: () => Promise.resolve(),
    delete: () => Promise.resolve(undefined),
    inspectContext: () =>
      Promise.resolve({ personUpdatedAt: revision, status: "ready" }),
    inspectPageAnchor: (command) =>
      Promise.resolve(
        command.after.id !==
          "10000000-0000-4000-8000-000000000099",
      ),
    list: (command) => {
      listCommands.push(command);
      const after = (command as unknown as {
        readonly after?: { readonly id: string };
      }).after;
      const start = after
        ? records.findIndex((record) => record.id === after.id) + 1
        : 0;
      return Promise.resolve(
        records.slice(start, start + (command.limit ?? 51)),
      );
    },
    lockFact: () => Promise.resolve(undefined),
    lockContext: () =>
      Promise.resolve({ personUpdatedAt: revision, status: "ready" }),
    save: () => Promise.resolve(undefined),
  };
  const facts = createProfileFactManagement({
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: () => Promise.resolve(crypto.randomUUID()),
    },
    clock: { now: () => new Date() },
    ids: { create: () => crypto.randomUUID() },
    repository,
    transaction: { run: (work) => work(transaction) },
    workspace: {
      inspect: () => Promise.resolve({ options: [], status: "ready" }),
    },
  });

  const first = await facts.list(actor, personId, "pets");
  assert(first.status === "ready", "first page is ready");
  assert(first.records.length === 50 && first.nextCursor, "first page bounded");
  const second = await facts.list(actor, personId, "pets", {
    cursor: first.nextCursor,
  });
  assert(second.status === "ready", "continuation is ready");
  assert(second.records.length === 10 && !second.nextCursor, "tail is exact");
  const secondCommand = listCommands[1] as {
    readonly after?: { readonly id: string; readonly updatedAt: string };
    readonly offset?: number;
  };
  assert(
    secondCommand.after?.id === records[49]?.id &&
      secondCommand.after?.updatedAt === records[49]?.updatedAt &&
      secondCommand.offset === undefined,
    "fact continuation uses the last complete keyset without an offset",
  );
  const decoded = JSON.parse(atob(
    first.nextCursor.replaceAll("-", "+")
      .replaceAll("_", "/").padEnd(
        first.nextCursor.length + (4 - first.nextCursor.length % 4) % 4,
        "=",
      ),
  ));
  const forged = btoa(JSON.stringify({
    ...decoded,
    id: "10000000-0000-4000-8000-000000000099",
  })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const stale = await facts.list(actor, personId, "pets", { cursor: forged });
  assert(stale.status === "stale-cursor", "forged fact anchor is rejected");
});

Deno.test("PEOPLE-006 hydrates every selected vocabulary descriptor without a global cap", async () => {
  const revision = "2026-08-16T12:00:00.000000Z";
  const records = Array.from({ length: 50 }, (_, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    return {
      id: `10000000-0000-4000-8001-${suffix}`,
      section: "contact-methods" as const,
      updatedAt: revision,
      value: {
        isPrimary: false,
        labelIds: [`10000000-0000-4000-8002-${suffix}`],
        typeId: `10000000-0000-4000-8003-${suffix}`,
        value: `person-${index}@example.test`,
      },
    };
  });
  const selectedCommands: readonly string[][] = [];
  const facts = createProfileFactManagement({
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: () => Promise.resolve(crypto.randomUUID()),
    },
    clock: { now: () => new Date() },
    ids: { create: () => crypto.randomUUID() },
    repository: {
      assertPostcondition: () => Promise.resolve(),
      delete: () => Promise.resolve(undefined),
      inspectContext: () =>
        Promise.resolve({ personUpdatedAt: revision, status: "ready" }),
      list: () => Promise.resolve(records),
      lockFact: () => Promise.resolve(undefined),
      lockContext: () =>
        Promise.resolve({ personUpdatedAt: revision, status: "ready" }),
      save: () => Promise.resolve(undefined),
    },
    transaction: { run: (work) => work(transaction) },
    workspace: {
      inspect: (command) => {
        if (command.selectedOptionIds?.length) {
          (selectedCommands as string[][]).push([...command.selectedOptionIds]);
        }
        return Promise.resolve({
          options: (command.selectedOptionIds ?? []).map((id) => ({
            id,
            kind: records.some((record) => record.value.typeId === id)
              ? "contact-type" as const
              : "contact-label" as const,
            name: id,
          })),
          optionsRevision: "options-v1",
          status: "ready" as const,
        });
      },
    },
  });

  const result = await facts.list(actor, personId, "contact-methods");
  assert(result.status === "ready", "contact facts are ready");
  const hydrated = result.records as readonly (typeof result.records[number] & {
    readonly referencesResolved?: boolean;
    readonly selectedOptions?: readonly ProfileFactOption[];
  })[];
  assert(
    selectedCommands[0]?.length === 100 &&
      hydrated.every((record) =>
        record.referencesResolved === true &&
        record.selectedOptions?.length === 2
      ),
    "every record carries both of its selected descriptors in one bounded hydration",
  );
});

Deno.test("PEOPLE-006 tag facts hydrate every assigned descriptor in one repository call", async () => {
  const revision = "2026-08-16T12:00:00.000000Z";
  const tagIds = Array.from(
    { length: 75 },
    (_, index) =>
      `10000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
  );
  let descriptorCalls = 0;
  const repository: ProfileFactRepository = {
    assertPostcondition: () => Promise.resolve(),
    delete: () => Promise.resolve(undefined),
    inspectContext: () =>
      Promise.resolve({ personUpdatedAt: revision, status: "ready" }),
    list: () =>
      Promise.resolve([{
        id: personId,
        section: "tags",
        updatedAt: revision,
        value: { tagIds },
      }]),
    listTagDescriptors: (command) => {
      descriptorCalls++;
      return Promise.resolve(command.tagIds.map((id) => ({ id, name: id })));
    },
    lockFact: () => Promise.resolve(undefined),
    lockContext: () =>
      Promise.resolve({ personUpdatedAt: revision, status: "ready" }),
    save: () => Promise.resolve(undefined),
  };
  const facts = createProfileFactManagement({
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: () => Promise.resolve(crypto.randomUUID()),
    },
    clock: { now: () => new Date() },
    ids: { create: () => crypto.randomUUID() },
    repository,
    transaction: { run: (work) => work(transaction) },
    workspace: {
      inspect: () =>
        Promise.resolve({
          options: [],
          optionsRevision: "tags-module-v1",
          status: "ready",
        }),
    },
  });

  const result = await facts.list(actor, personId, "tags");
  assert(result.status === "ready", "tag facts are ready");
  assert(
    result.options.length === tagIds.length && descriptorCalls === 1,
    "all assigned descriptors use one bulk tenant-scoped repository call",
  );
});

Deno.test("PEOPLE-006 workspace options use bounded search-stable continuation", async () => {
  const revision = "2026-08-16T12:00:00.000000Z";
  const optionCommands: Array<{
    readonly optionAfter?: {
      readonly id: string;
      readonly primary: string;
      readonly secondary: string;
    };
    readonly optionLimit?: number;
    readonly optionSearch?: string;
  }> = [];
  const repository: ProfileFactRepository = {
    assertPostcondition: () => Promise.resolve(),
    delete: () => Promise.resolve(undefined),
    inspectContext: () =>
      Promise.resolve({ personUpdatedAt: revision, status: "ready" }),
    list: () => Promise.resolve([]),
    lockFact: () => Promise.resolve(undefined),
    lockContext: () =>
      Promise.resolve({ personUpdatedAt: revision, status: "ready" }),
    save: () => Promise.resolve(undefined),
  };
  const facts = createProfileFactManagement({
    audit: {
      assertPostcondition: () => Promise.resolve(),
      record: () => Promise.resolve(crypto.randomUUID()),
    },
    clock: { now: () => new Date() },
    ids: { create: () => crypto.randomUUID() },
    repository,
    transaction: { run: (work) => work(transaction) },
    workspace: {
      inspect: (
        command: Parameters<ProfileFactWorkspaceBoundary["inspect"]>[0] & {
          readonly optionAfter?: {
            readonly id: string;
            readonly primary: string;
            readonly secondary: string;
          };
        },
      ) => {
        optionCommands.push(command);
        if (
          command.optionAfter?.id ===
            "10000000-0000-4000-8000-000000000999"
        ) {
          return Promise.resolve({
            options: [],
            status: "stale-cursor" as const,
          });
        }
        const offset = command.optionAfter ? 50 : 0;
        const length = offset === 0 ? 50 : 2;
        return Promise.resolve({
          hasMore: offset === 0,
          ...(offset === 0
            ? {
              nextOptionAnchor: {
                id: "10000000-0000-4000-8000-000000000149",
                primary: "email 49",
                secondary: "contact-type",
              },
            }
            : {}),
          options: Array.from({ length }, (_, index) => ({
            id: `10000000-0000-4000-8000-${
              String(offset + index + 100).padStart(12, "0")
            }`,
            kind: "contact-type" as const,
            name: `Email ${offset + index}`,
          })),
          status: "ready" as const,
        });
      },
    } as unknown as ProfileFactWorkspaceBoundary,
  });

  const first = await facts.list(actor, personId, "contact-methods", {
    includeOptions: true,
    optionSearch: " EMAIL ",
  });
  assert(first.status === "ready", "first option page is ready");
  assert(
    first.options.length === 50 && first.nextOptionsCursor,
    "first option page is bounded",
  );
  const second = await facts.list(actor, personId, "contact-methods", {
    includeOptions: true,
    optionCursor: first.nextOptionsCursor,
    optionSearch: "email",
  });
  assert(second.status === "ready", "option continuation is ready");
  assert(
    second.options.length === 2 && !second.nextOptionsCursor,
    "option tail is exact",
  );
  assert(
    optionCommands.every((command) => command.optionLimit === 50) &&
      optionCommands[1]?.optionAfter?.id ===
        "10000000-0000-4000-8000-000000000149" &&
      optionCommands.every((command) => command.optionSearch === "email"),
    "workspace boundary receives a fixed keyset and normalized search",
  );
  const decoded = JSON.parse(atob(
    first.nextOptionsCursor.replaceAll("-", "+")
      .replaceAll("_", "/").padEnd(
        first.nextOptionsCursor.length +
          (4 - first.nextOptionsCursor.length % 4) % 4,
        "=",
      ),
  ));
  const forged = btoa(JSON.stringify({
    ...decoded,
    id: "10000000-0000-4000-8000-000000000999",
  })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const stale = await facts.list(actor, personId, "contact-methods", {
    includeOptions: true,
    optionCursor: forged,
    optionSearch: "email",
  });
  assert(
    stale.status === "stale-cursor",
    "forged workspace option anchor is stale-rejected",
  );
  const beforeMissingInclude = optionCommands.length;
  for (
    const [cursor, search] of [
      [first.nextOptionsCursor, "email"],
      [first.nextOptionsCursor, "different-search"],
      [forged, "email"],
    ] as const
  ) {
    const missingInclude = await facts.list(
      actor,
      personId,
      "contact-methods",
      { optionCursor: cursor, optionSearch: search } as never,
    );
    assert(
      missingInclude.status === "stale-cursor",
      "application rejects option continuation without options mode",
    );
  }
  assert(
    optionCommands.length === beforeMissingInclude,
    "invalid option continuation never reaches workspace configuration",
  );
});
