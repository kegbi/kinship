import {
  createGiftManagement,
  createRecurringDebtCharging,
  type GiftManagementDependencies,
  type RecurringDebtRepository,
  type StoredDebt,
  type StoredRecurringDebt,
} from "../public.ts";
import { describeChargedDebtEvent, describeGiftEvent } from "./audit_events.ts";
import { assert, assertEquals } from "../../../testing/assert.ts";
import { fixedClock, sequentialIds } from "../../../testing/fakes.ts";

const actor = {
  memberId: "10000000-0000-4000-8000-000000000001",
  role: "member" as const,
  userId: "10000000-0000-4000-8000-000000000002",
  workspaceId: "10000000-0000-4000-8000-000000000003",
};
const otherWorkspaceId = "10000000-0000-4000-8000-0000000000ff";
const personId = "10000000-0000-4000-8000-000000000004";

const monthlyRent = {
  amount: "500",
  currencyCode: "EUR",
  dayOfMonth: 31,
  direction: "they_owe" as const,
  intervalMonths: 1,
  reason: "Rent share",
  startsOn: "2026-05-31",
};

interface StoredRule {
  readonly rule: StoredRecurringDebt;
  readonly workspaceId: string;
}

/**
 * An in-memory rule store with the one-debt-per-period key the schema
 * enforces, so a test sees exactly what charging twice would do.
 */
function memoryRepository(
  options: { readonly failingClaims?: ReadonlySet<string> } = {},
) {
  const rules = new Map<string, StoredRule>();
  const debts: (StoredDebt & { readonly workspaceId: string })[] = [];
  const owned = (id: string, workspaceId: string, person: string) => {
    const found = rules.get(id);
    return found && found.workspaceId === workspaceId &&
        found.rule.personId === person
      ? found
      : undefined;
  };
  const repository: RecurringDebtRepository = {
    listForPerson: (command) =>
      Promise.resolve(
        [...rules.values()].filter((entry) =>
          entry.workspaceId === command.workspaceId &&
          entry.rule.personId === command.personId
        ).map((entry) => entry.rule),
      ),
    create: (command) => {
      if (command.personId !== personId) {
        return Promise.resolve({ status: "not-found" });
      }
      const rule: StoredRecurringDebt = {
        active: true,
        amount: command.amount,
        createdAt: command.occurredAt.toISOString(),
        currencyCode: command.currencyCode,
        dayOfMonth: command.dayOfMonth,
        direction: command.direction,
        ...(command.endsOn ? { endsOn: command.endsOn } : {}),
        id: command.id,
        intervalMonths: command.intervalMonths,
        ...(command.nextOccurrenceOn
          ? { nextOccurrenceOn: command.nextOccurrenceOn }
          : {}),
        personId: command.personId,
        ...(command.reason ? { reason: command.reason } : {}),
        startsOn: command.startsOn,
        updatedAt: command.occurredAt.toISOString(),
      };
      rules.set(rule.id, { rule, workspaceId: command.workspaceId });
      return Promise.resolve({ recurringDebt: rule, status: "created" });
    },
    find: (command) => {
      const found = owned(command.id, command.workspaceId, command.personId);
      if (!found) return Promise.resolve({ status: "not-found" });
      const charged = debts.filter((debt) =>
        debt.recurringDebtId === command.id
      )
        .map((debt) => debt.occurrenceOn!).sort();
      return Promise.resolve({
        ...(charged.length ? { lastChargedOn: charged.at(-1)! } : {}),
        recurringDebt: found.rule,
        status: "found",
      });
    },
    save: (command) => {
      const found = owned(command.id, command.workspaceId, command.personId);
      if (!found) return Promise.resolve({ status: "not-found" });
      const rule: StoredRecurringDebt = {
        active: command.active,
        amount: command.amount,
        createdAt: found.rule.createdAt,
        currencyCode: command.currencyCode,
        dayOfMonth: command.dayOfMonth,
        direction: command.direction,
        ...(command.endsOn ? { endsOn: command.endsOn } : {}),
        id: command.id,
        intervalMonths: command.intervalMonths,
        ...(command.nextOccurrenceOn
          ? { nextOccurrenceOn: command.nextOccurrenceOn }
          : {}),
        personId: command.personId,
        ...(command.reason ? { reason: command.reason } : {}),
        startsOn: command.startsOn,
        updatedAt: command.occurredAt.toISOString(),
      };
      rules.set(rule.id, { rule, workspaceId: found.workspaceId });
      return Promise.resolve({ recurringDebt: rule, status: "saved" });
    },
    lockRequest: () => Promise.resolve(),
    exists: (command) => Promise.resolve(rules.has(command.id)),
    remove: (command) =>
      Promise.resolve(
        owned(command.id, command.workspaceId, command.personId) !==
            undefined && rules.delete(command.id),
      ),
    listDue: (command) =>
      Promise.resolve(
        [...rules.values()].filter((entry) =>
          entry.rule.active && entry.rule.nextOccurrenceOn !== undefined &&
          entry.rule.nextOccurrenceOn <= command.through
        ).map((entry) => ({
          id: entry.rule.id,
          workspaceId: entry.workspaceId,
        }))
          .slice(0, command.limit),
      ),
    claim: (command) => {
      if (options.failingClaims?.has(command.id)) {
        return Promise.reject(new Error("lock timeout"));
      }
      const found = rules.get(command.id);
      return Promise.resolve(
        found?.rule.active && found.rule.nextOccurrenceOn
          ? { recurringDebt: found.rule, workspaceId: found.workspaceId }
          : undefined,
      );
    },
    charge: (command) => {
      const inserted: StoredDebt[] = [];
      command.dates.forEach((date, index) => {
        if (
          debts.some((debt) =>
            debt.recurringDebtId === command.recurringDebt.id &&
            debt.occurrenceOn?.slice(0, 7) === date.slice(0, 7)
          )
        ) return;
        const debt: StoredDebt = {
          amount: command.recurringDebt.amount,
          createdAt: command.occurredAt.toISOString(),
          currencyCode: command.recurringDebt.currencyCode,
          direction: command.recurringDebt.direction,
          id: command.ids[index]!,
          occurrenceOn: date,
          personId: command.recurringDebt.personId,
          ...(command.recurringDebt.reason
            ? { reason: command.recurringDebt.reason }
            : {}),
          recurringDebtId: command.recurringDebt.id,
          status: "open",
          updatedAt: command.occurredAt.toISOString(),
        };
        debts.push({ ...debt, workspaceId: command.workspaceId });
        inserted.push(debt);
      });
      return Promise.resolve(inserted);
    },
    advance: (command) => {
      const found = rules.get(command.id);
      if (found && found.workspaceId === command.workspaceId) {
        const { nextOccurrenceOn: _old, ...rest } = found.rule;
        rules.set(command.id, {
          rule: command.nextOccurrenceOn
            ? { ...rest, nextOccurrenceOn: command.nextOccurrenceOn }
            : rest,
          workspaceId: found.workspaceId,
        });
      }
      return Promise.resolve();
    },
  };
  return { debts, repository, rules };
}

function fixture(
  options: {
    readonly failingClaims?: ReadonlySet<string>;
    readonly now?: string;
    readonly standing?: "active" | "revoked";
    readonly timezones?: ReadonlyMap<string, string>;
  } = {},
) {
  const memory = memoryRepository(options);
  const audits: string[] = [];
  const audited = new Set<string>();
  const dependencies: GiftManagementDependencies = {
    actors: {
      revalidate: () =>
        Promise.resolve((options.standing ?? "active") as "active"),
    },
    attachments: {} as never,
    audit: {
      record: (command) => {
        audits.push(`${command.recordType}:${command.action}`);
        audited.add(`${command.recordType}:${command.record.id}`);
        return Promise.resolve("audit");
      },
      recorded: (command) =>
        Promise.resolve(
          audited.has(`${command.recordType}:${command.subjectId}`),
        ),
      recordCharged: (command) => {
        audits.push(
          `charged:${command.workspaceId}:${command.debt.occurrenceOn}`,
        );
        return Promise.resolve("audit");
      },
    },
    calendar: {
      timezones: (command) =>
        Promise.resolve(
          new Map(
            [...(options.timezones ?? new Map())].filter(([id]) =>
              command.workspaceIds.includes(id)
            ),
          ),
        ),
    },
    clock: fixedClock(options.now ?? "2026-08-23T10:00:00.000Z"),
    currencies: {
      isSupported: ({ code }) => Promise.resolve(code === "EUR"),
      listSupported: () => Promise.resolve(["EUR", "USD"]),
      preferredFor: () => Promise.resolve(undefined),
    },
    ids: sequentialIds({ prefix: "20000000-0000-4000-8000-" }),
    recurringDebts: memory.repository,
    repository: {} as never,
    transaction: { run: (work) => work({ opaque: "transaction" }) },
  };
  return {
    ...memory,
    audits,
    charging: createRecurringDebtCharging(dependencies),
    management: createGiftManagement(dependencies),
  };
}

Deno.test("[GIFTS-001] resuming preserves a deleted latest charge and an ended rule", async () => {
  for (const endsOn of [undefined, "2026-10-14"]) {
    const { debts, management, charging } = fixture({
      now: "2026-10-14T10:00:00.000Z",
    });
    const created = await management.createRecurringDebt(actor, personId, {
      ...monthlyRent,
      dayOfMonth: 14,
      startsOn: "2026-09-14",
      ...(endsOn ? { endsOn } : {}),
    });
    if (created.status !== "created") throw new Error(created.status);
    assertEquals(debts.map((debt) => debt.occurrenceOn), [
      "2026-09-14",
      "2026-10-14",
    ]);
    // Permanent removal leaves the rule's advanced cursor, but changes MAX(occurrence_on).
    debts.splice(
      debts.findIndex((debt) => debt.occurrenceOn === "2026-10-14"),
      1,
    );
    const id = created.recurringDebt.id;
    for (let retry = 0; retry < 2; retry++) {
      await management.changeRecurringDebt(actor, personId, id, {
        active: false,
      });
      const resumed = await management.changeRecurringDebt(
        actor,
        personId,
        id,
        { active: true },
      );
      if (resumed.status !== "saved") throw new Error(resumed.status);
      assertEquals(resumed.charged, 0);
      assertEquals(
        resumed.recurringDebt.nextOccurrenceOn,
        endsOn ? undefined : "2026-11-14",
      );
      await charging.chargeDue();
      assertEquals(debts.map((debt) => debt.occurrenceOn), ["2026-09-14"]);
    }
    if (endsOn) {
      await management.changeRecurringDebt(actor, personId, id, {
        active: false,
      });
      const extended = await management.changeRecurringDebt(
        actor,
        personId,
        id,
        { active: true, endsOn: "2026-12-14" },
      );
      assertEquals(
        extended.status === "saved" ? extended.charged : extended.status,
        1,
        "an explicit schedule extension may regenerate a removed period",
      );
    }
  }
});

Deno.test("[GIFTS-001] a rule that started in the past charges every missed period at once", async () => {
  const { audits, debts, management } = fixture();
  const created = await management.createRecurringDebt(
    actor,
    personId,
    monthlyRent,
  );
  if (created.status !== "created") throw new Error(created.status);
  assertEquals(created.charged, 3);
  assertEquals(
    debts.map((debt) => debt.occurrenceOn),
    ["2026-05-31", "2026-06-30", "2026-07-31"],
  );
  assertEquals(created.recurringDebt.nextOccurrenceOn, "2026-08-31");
  assert(
    debts.every((debt) =>
      debt.status === "open" && debt.amount === "500" &&
      debt.reason === "Rent share" && debt.workspaceId === actor.workspaceId
    ),
    "every period is its own open debt with the rule's values",
  );
  assertEquals(audits, [
    "recurring-debt:created",
    "debt:created",
    "debt:created",
    "debt:created",
  ]);
});

Deno.test("[GIFTS-001] a rule that starts later charges nothing yet", async () => {
  const { debts, management } = fixture();
  const created = await management.createRecurringDebt(actor, personId, {
    ...monthlyRent,
    startsOn: "2026-09-01",
  });
  assertEquals(
    created.status === "created"
      ? [created.charged, created.recurringDebt.nextOccurrenceOn]
      : created.status,
    [0, "2026-09-30"],
  );
  assertEquals(debts.length, 0);
});

Deno.test("[GIFTS-001] a rule is refused before anything is stored", async () => {
  const { management, rules } = fixture();
  for (
    const [input, status] of [
      [{ ...monthlyRent, dayOfMonth: 32 }, "validation-error"],
      [{ ...monthlyRent, currencyCode: "XXX" }, "validation-error"],
      [{ ...monthlyRent, endsOn: "2026-01-01" }, "validation-error"],
    ] as const
  ) {
    assertEquals(
      await management.createRecurringDebt(actor, personId, input),
      { status },
    );
  }
  assertEquals(
    await management.createRecurringDebt(
      actor,
      "10000000-0000-4000-8000-000000000099",
      monthlyRent,
    ),
    { status: "not-found" },
  );
  assertEquals(rules.size, 0);
  const revoked = fixture({ standing: "revoked" });
  assertEquals(
    await revoked.management.createRecurringDebt(actor, personId, monthlyRent),
    { status: "forbidden" },
  );
});

Deno.test("[GIFTS-001] a person carries at most fifty rules", async () => {
  const { management } = fixture({ now: "2026-01-01T10:00:00.000Z" });
  for (let index = 0; index < 50; index += 1) {
    const created = await management.createRecurringDebt(actor, personId, {
      ...monthlyRent,
      startsOn: "2026-12-31",
    });
    assertEquals(created.status, "created");
  }
  assertEquals(
    await management.createRecurringDebt(actor, personId, monthlyRent),
    { status: "limit-reached" },
  );
});

Deno.test("[GIFTS-001] pausing stops charges and resuming skips the paused periods", async () => {
  const { debts, management } = fixture({ now: "2026-06-01T10:00:00.000Z" });
  const created = await management.createRecurringDebt(
    actor,
    personId,
    monthlyRent,
  );
  if (created.status !== "created") throw new Error(created.status);
  const id = created.recurringDebt.id;
  const paused = await management.changeRecurringDebt(actor, personId, id, {
    active: false,
  });
  assertEquals(
    paused.status === "saved"
      ? [paused.recurringDebt.active, paused.charged]
      : paused.status,
    [false, 0],
  );

  const later = fixture({ now: "2026-09-15T10:00:00.000Z" });
  // The same rule, paused since June, resumed in mid-September.
  later.rules.set(id, {
    rule: {
      ...(paused.status === "saved"
        ? paused.recurringDebt
        : created.recurringDebt),
    },
    workspaceId: actor.workspaceId,
  });
  later.debts.push(
    ...debts.map((debt) => ({ ...debt, workspaceId: actor.workspaceId })),
  );
  const resumed = await later.management.changeRecurringDebt(
    actor,
    personId,
    id,
    { active: true },
  );
  assertEquals(
    resumed.status === "saved"
      ? [resumed.charged, resumed.recurringDebt.nextOccurrenceOn]
      : resumed.status,
    [0, "2026-09-30"],
  );
  assertEquals(
    later.debts.map((debt) => debt.occurrenceOn),
    ["2026-05-31"],
    "the periods that passed while paused were not charged",
  );
});

Deno.test("[GIFTS-001] an edit changes later charges and never repeats a charged period", async () => {
  const { debts, management } = fixture();
  const created = await management.createRecurringDebt(
    actor,
    personId,
    monthlyRent,
  );
  if (created.status !== "created") throw new Error(created.status);
  const id = created.recurringDebt.id;
  const amount = await management.changeRecurringDebt(actor, personId, id, {
    amount: "550",
    reason: null,
  });
  assertEquals(
    amount.status === "saved"
      ? [
        amount.recurringDebt.amount,
        amount.recurringDebt.reason,
        amount.recurringDebt.nextOccurrenceOn,
        amount.charged,
      ]
      : amount.status,
    ["550", undefined, "2026-08-31", 0],
  );
  const moved = await management.changeRecurringDebt(actor, personId, id, {
    dayOfMonth: 15,
  });
  assertEquals(
    moved.status === "saved"
      ? [moved.recurringDebt.nextOccurrenceOn, moved.charged]
      : moved.status,
    ["2026-09-15", 1],
    "the period after the last charged month is due at once",
  );
  assertEquals(
    debts.map((debt) => `${debt.occurrenceOn} ${debt.amount}`),
    [
      "2026-05-31 500",
      "2026-06-30 500",
      "2026-07-31 500",
      "2026-08-15 550",
    ],
  );
  assertEquals(
    await management.changeRecurringDebt(actor, personId, id, {
      intervalMonths: 0,
    }),
    { status: "validation-error" },
  );
  assertEquals(
    await management.changeRecurringDebt(actor, personId, id, {
      currencyCode: "XXX",
    }),
    { status: "validation-error" },
  );
  assertEquals(
    await management.changeRecurringDebt(
      { ...actor, workspaceId: otherWorkspaceId },
      personId,
      id,
      { amount: "1" },
    ),
    { status: "not-found" },
    "another workspace cannot reach the rule",
  );
});

Deno.test("[GIFTS-001] moving a charged rule's start earlier backfills only uncharged months", async () => {
  const { charging, debts, management } = fixture({
    now: "2026-10-14T10:00:00.000Z",
  });
  const created = await management.createRecurringDebt(actor, personId, {
    ...monthlyRent,
    dayOfMonth: 14,
    startsOn: "2026-10-14",
  });
  if (created.status !== "created") throw new Error(created.status);
  const original = { ...debts[0]! };
  const id = created.recurringDebt.id;
  const backfilled = await management.changeRecurringDebt(actor, personId, id, {
    startsOn: "2026-07-22",
  });
  assertEquals(
    backfilled.status === "saved"
      ? [backfilled.charged, backfilled.recurringDebt.nextOccurrenceOn]
      : backfilled.status,
    [2, "2026-11-14"],
  );
  assertEquals(debts.map((debt) => debt.occurrenceOn).sort(), [
    "2026-08-14",
    "2026-09-14",
    "2026-10-14",
  ]);
  assertEquals(debts[0], original, "the existing debt remains unchanged");
  const earlierDay = await management.changeRecurringDebt(actor, personId, id, {
    dayOfMonth: 1,
    startsOn: "2026-06-22",
  });
  assertEquals(
    earlierDay.status === "saved"
      ? [earlierDay.charged, earlierDay.recurringDebt.nextOccurrenceOn]
      : earlierDay.status,
    [1, "2026-11-01"],
  );
  assertEquals(debts.map((debt) => debt.occurrenceOn).sort(), [
    "2026-07-01",
    "2026-08-14",
    "2026-09-14",
    "2026-10-14",
  ], "a changed due day still skips every previously charged month");
  assertEquals(await charging.chargeDue(), { charged: 0, failed: 0, rules: 0 });
});

Deno.test("[GIFTS-001] a bounded backfill keeps its pending months through schedule edits", async () => {
  const { charging, debts, management } = fixture({
    now: "2026-10-14T10:00:00.000Z",
  });
  const created = await management.createRecurringDebt(actor, personId, {
    ...monthlyRent,
    dayOfMonth: 14,
    startsOn: "2026-10-14",
  });
  if (created.status !== "created") throw new Error(created.status);
  const id = created.recurringDebt.id;
  const backfilled = await management.changeRecurringDebt(actor, personId, id, {
    startsOn: "2000-01-14",
  });
  assertEquals(
    backfilled.status === "saved"
      ? [backfilled.charged, backfilled.recurringDebt.nextOccurrenceOn]
      : backfilled.status,
    [120, "2010-01-14"],
  );
  const edited = await management.changeRecurringDebt(actor, personId, id, {
    dayOfMonth: 1,
  });
  assertEquals(
    edited.status === "saved"
      ? [edited.charged, edited.recurringDebt.nextOccurrenceOn]
      : edited.status,
    [120, "2020-01-01"],
    "changing the day preserves unfinished backfill before the latest charge",
  );
  assertEquals(await charging.chargeDue(), {
    charged: 81,
    failed: 0,
    rules: 1,
  });
  assertEquals(debts.length, 322);
  assertEquals(
    new Set(debts.map((debt) => debt.occurrenceOn!.slice(0, 7))).size,
    322,
  );
  assertEquals(await charging.chargeDue(), { charged: 0, failed: 0, rules: 0 });
});

Deno.test("[GIFTS-001] moving the start forward retains unfinished bounded backfill", async () => {
  const { charging, debts, management } = fixture({
    now: "2026-10-14T10:00:00.000Z",
  });
  const created = await management.createRecurringDebt(actor, personId, {
    ...monthlyRent,
    dayOfMonth: 14,
    startsOn: "2026-10-14",
  });
  if (created.status !== "created") throw new Error(created.status);
  const id = created.recurringDebt.id;
  const original = { ...debts[0]! };
  const backfilled = await management.changeRecurringDebt(actor, personId, id, {
    startsOn: "2000-01-14",
  });
  assertEquals(
    backfilled.status === "saved"
      ? [backfilled.charged, backfilled.recurringDebt.nextOccurrenceOn]
      : backfilled.status,
    [120, "2010-01-14"],
  );
  const moved = await management.changeRecurringDebt(actor, personId, id, {
    startsOn: "2001-01-14",
  });
  assertEquals(
    moved.status === "saved"
      ? [moved.charged, moved.recurringDebt.nextOccurrenceOn]
      : moved.status,
    [120, "2020-01-14"],
    "the pending backfill continues even when the start moves forward",
  );
  assertEquals(await charging.chargeDue(), {
    charged: 81,
    failed: 0,
    rules: 1,
  });
  assertEquals(debts.length, 322);
  assertEquals(
    new Set(debts.map((debt) => debt.occurrenceOn!.slice(0, 7))).size,
    322,
    "every month is charged once across the edits and worker run",
  );
  assertEquals(debts[0], original, "the existing October debt is preserved");
  assertEquals(await charging.chargeDue(), { charged: 0, failed: 0, rules: 0 });
});

Deno.test("[GIFTS-001] backfill respects ended rules and edits while paused do not charge on resume", async () => {
  for (const paused of [false, true]) {
    const { debts, management } = fixture({ now: "2026-10-14T10:00:00.000Z" });
    const created = await management.createRecurringDebt(actor, personId, {
      ...monthlyRent,
      dayOfMonth: 14,
      endsOn: "2026-10-14",
      startsOn: "2026-10-14",
    });
    if (created.status !== "created") throw new Error(created.status);
    const id = created.recurringDebt.id;
    if (paused) {
      await management.changeRecurringDebt(actor, personId, id, {
        active: false,
      });
    }
    const edited = await management.changeRecurringDebt(actor, personId, id, {
      startsOn: "2026-07-22",
    });
    assertEquals(
      edited.status === "saved" ? edited.charged : edited.status,
      paused ? 0 : 2,
    );
    if (paused) {
      const resumed = await management.changeRecurringDebt(
        actor,
        personId,
        id,
        { active: true },
      );
      assertEquals(
        resumed.status === "saved" ? resumed.charged : resumed.status,
        0,
      );
      assertEquals(debts.map((debt) => debt.occurrenceOn), ["2026-10-14"]);
    } else {
      assertEquals(
        edited.status === "saved"
          ? edited.recurringDebt.nextOccurrenceOn
          : edited.status,
        undefined,
      );
      assertEquals(debts.length, 3);
    }
  }
});

Deno.test("[GIFTS-001] deleting a rule keeps the debts it charged", async () => {
  const { audits, debts, management, rules } = fixture();
  const created = await management.createRecurringDebt(
    actor,
    personId,
    monthlyRent,
  );
  if (created.status !== "created") throw new Error(created.status);
  const id = created.recurringDebt.id;
  assertEquals(
    await management.deleteRecurringDebt(
      { ...actor, workspaceId: otherWorkspaceId },
      personId,
      id,
    ),
    { status: "not-found" },
  );
  assertEquals(await management.deleteRecurringDebt(actor, personId, id), {
    recurringDebtId: id,
    status: "deleted",
  });
  assertEquals([rules.size, debts.length], [0, 3]);
  assertEquals(audits.at(-1), "recurring-debt:deleted");
  assertEquals(await management.deleteRecurringDebt(actor, personId, id), {
    status: "not-found",
  });
});

Deno.test("[GIFTS-001] the worker charges each workspace on its own calendar, once", async () => {
  const belgrade = "10000000-0000-4000-8000-0000000000b1";
  const timezones = new Map([[belgrade, "Europe/Belgrade"]]);
  const setup = fixture({ now: "2026-08-20T10:00:00.000Z", timezones });
  for (const workspaceId of [actor.workspaceId, belgrade]) {
    const created = await setup.management.createRecurringDebt(
      { ...actor, workspaceId },
      personId,
      { ...monthlyRent, dayOfMonth: 1, startsOn: "2026-09-01" },
    );
    assertEquals(created.status, "created");
  }
  const { audits, charging, debts, rules } = fixture({
    now: "2026-08-31T22:30:00.000Z",
    timezones,
  });
  for (const [id, entry] of setup.rules) rules.set(id, entry);

  assertEquals(await charging.chargeDue(), { charged: 1, failed: 0, rules: 2 });
  assertEquals(
    debts.map((debt) => `${debt.workspaceId} ${debt.occurrenceOn}`),
    [`${belgrade} 2026-09-01`],
    "only the workspace already in September is charged",
  );
  assertEquals(audits.at(-1), `charged:${belgrade}:2026-09-01`);
  assertEquals(await charging.chargeDue(), { charged: 0, failed: 0, rules: 1 });
  assertEquals(debts.length, 1, "a second run charges nothing again");
  assertEquals(
    [...rules.values()].map((entry) => entry.rule.nextOccurrenceOn).sort(),
    ["2026-09-01", "2026-10-01"],
  );
});

Deno.test("[GIFTS-001] the worker catches up after downtime and survives a failing rule", async () => {
  const setup = fixture({ now: "2026-01-01T10:00:00.000Z" });
  const first = await setup.management.createRecurringDebt(actor, personId, {
    ...monthlyRent,
    startsOn: "2026-01-31",
  });
  const second = await setup.management.createRecurringDebt(actor, personId, {
    ...monthlyRent,
    endsOn: "2026-03-31",
    startsOn: "2026-01-31",
  });
  if (first.status !== "created" || second.status !== "created") {
    throw new Error("rules expected");
  }
  const later = fixture({
    failingClaims: new Set([first.recurringDebt.id]),
    now: "2026-05-02T10:00:00.000Z",
  });
  for (const [id, entry] of setup.rules) later.rules.set(id, entry);
  assertEquals(await later.charging.chargeDue(), {
    charged: 3,
    failed: 1,
    rules: 2,
  });
  assertEquals(
    later.debts.map((debt) => debt.occurrenceOn),
    ["2026-01-31", "2026-02-28", "2026-03-31"],
    "the ended rule charged its three periods and stopped",
  );
  assertEquals(
    later.rules.get(second.recurringDebt.id)?.rule.nextOccurrenceOn,
    undefined,
  );
  assertEquals(
    later.rules.get(first.recurringDebt.id)?.rule.nextOccurrenceOn,
    "2026-01-31",
    "a failed rule is left for the next run",
  );
});

Deno.test("[GIFTS-001] a worker that cannot list rules reports one failure", async () => {
  const charging = createRecurringDebtCharging({
    audit: {} as never,
    calendar: {} as never,
    clock: fixedClock("2026-08-23T10:00:00.000Z"),
    ids: sequentialIds(),
    recurringDebts: {} as never,
    transaction: { run: () => Promise.reject(new Error("offline")) },
  });
  assertEquals(await charging.chargeDue({ limit: 5 }), {
    charged: 0,
    failed: 1,
    rules: 0,
  });
});

Deno.test("[GIFTS-001] recurring debt writes report an unavailable store", async () => {
  const { management } = fixture();
  const unavailable = createGiftManagement({
    ...({} as GiftManagementDependencies),
    actors: { revalidate: () => Promise.resolve("active" as const) },
    clock: fixedClock("2026-08-23T10:00:00.000Z"),
    transaction: { run: () => Promise.reject(new Error("offline")) },
  });
  const id = crypto.randomUUID();
  assertEquals(
    await unavailable.createRecurringDebt(actor, personId, monthlyRent),
    { status: "unavailable" },
  );
  assertEquals(
    await unavailable.changeRecurringDebt(actor, personId, id, { amount: "1" }),
    { status: "unavailable" },
  );
  assertEquals(await unavailable.deleteRecurringDebt(actor, personId, id), {
    status: "unavailable",
  });
  assertEquals(
    await management.changeRecurringDebt(actor, personId, id, { amount: "1" }),
    { status: "not-found" },
  );
});

Deno.test("[GIFTS-001] a rule and a charged debt describe their own audit rows", () => {
  const rule: StoredRecurringDebt = {
    active: false,
    amount: "500",
    createdAt: "2026-08-23T10:00:00.000000Z",
    currencyCode: "EUR",
    dayOfMonth: 31,
    direction: "they_owe",
    id: "20000000-0000-4000-8000-000000000001",
    intervalMonths: 1,
    personId,
    startsOn: "2026-05-31",
    updatedAt: "2026-08-23T10:00:00.000000Z",
  };
  assertEquals(
    describeGiftEvent({
      action: "changed",
      actor,
      occurredAt: new Date("2026-08-23T10:00:00.000Z"),
      record: rule,
      recordType: "recurring-debt",
      transaction: { opaque: "describe" },
    }),
    {
      action: "gifts.recurring-debt-created-or-state-changed",
      actorMemberId: actor.memberId,
      occurredAt: new Date("2026-08-23T10:00:00.000Z"),
      payload: { action: "changed", personId, status: "paused" },
      personId,
      subjectId: rule.id,
      subjectType: "recurring_debt",
      visibleOnDashboard: true,
      workspaceId: actor.workspaceId,
    },
  );
  assertEquals(
    describeChargedDebtEvent({
      debt: {
        amount: "500",
        createdAt: "2026-08-23T10:00:00.000000Z",
        direction: "they_owe",
        id: "20000000-0000-4000-8000-000000000002",
        occurrenceOn: "2026-08-31",
        personId,
        recurringDebtId: rule.id,
        status: "open",
        updatedAt: "2026-08-23T10:00:00.000000Z",
      },
      occurredAt: new Date("2026-08-31T00:00:00.000Z"),
      requestId: "job-run",
      transaction: { opaque: "describe" },
      workspaceId: actor.workspaceId,
    }),
    {
      action: "gifts.debt-created-or-state-changed",
      occurredAt: new Date("2026-08-31T00:00:00.000Z"),
      payload: {
        action: "charged",
        personId,
        recurringDebtId: rule.id,
        status: "open",
      },
      personId,
      requestId: "job-run",
      subjectId: "20000000-0000-4000-8000-000000000002",
      subjectType: "debt",
      visibleOnDashboard: true,
      workspaceId: actor.workspaceId,
    },
  );
});

Deno.test("[MCP-D3] a rule create retried with its request id never charges twice", async () => {
  const { audits, debts, management, rules } = fixture();
  const requestId = "20000000-0000-4000-8000-0000000000aa";
  const created = await management.createRecurringDebt(actor, personId, {
    ...monthlyRent,
    requestId,
  });
  if (created.status !== "created") throw new Error(created.status);
  assertEquals([created.charged, debts.length], [3, 3]);
  const audited = audits.length;
  const replay = await management.createRecurringDebt(actor, personId, {
    ...monthlyRent,
    amount: "500.00",
    currencyCode: "eur",
    requestId,
  });
  assertEquals(replay, {
    charged: 0,
    recurringDebt: created.recurringDebt,
    status: "created",
  });
  assertEquals([rules.size, debts.length], [1, 3], "nothing charged again");
  assertEquals(audits.length, audited, "a replay is not audited");
  for (
    const [person, input] of [
      [personId, { ...monthlyRent, dayOfMonth: 1, requestId }],
      [personId, { ...monthlyRent, reason: "Rent", requestId }],
      ["10000000-0000-4000-8000-0000000000ee", { ...monthlyRent, requestId }],
    ] as const
  ) {
    assertEquals(
      await management.createRecurringDebt(actor, person, input),
      { status: "idempotency-conflict" },
    );
  }
  assertEquals(
    await management.createRecurringDebt(actor, personId, {
      ...monthlyRent,
      requestId: "rent",
    }),
    { status: "validation-error" },
  );
  await management.deleteRecurringDebt(
    actor,
    personId,
    created.recurringDebt.id,
  );
  assertEquals(
    await management.createRecurringDebt(actor, personId, {
      ...monthlyRent,
      requestId,
    }),
    { status: "request-deleted" },
    "a deleted rule is not recreated, and charges nothing",
  );
  assertEquals([rules.size, debts.length], [0, 3]);
});

Deno.test("[MCP-D3] a rule change at a stale revision changes and charges nothing", async () => {
  const { debts, management, rules } = fixture();
  const created = await management.createRecurringDebt(actor, personId, {
    ...monthlyRent,
    startsOn: "2026-09-30",
  });
  if (created.status !== "created") throw new Error(created.status);
  const stale = await management.changeRecurringDebt(
    actor,
    personId,
    created.recurringDebt.id,
    { startsOn: "2026-05-31" },
    { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" },
  );
  assertEquals(stale, { status: "stale" });
  assertEquals(debts.length, 0, "no backfill");
  assertEquals(
    rules.get(created.recurringDebt.id)?.rule.startsOn,
    "2026-09-30",
  );
  const current = await management.changeRecurringDebt(
    actor,
    personId,
    created.recurringDebt.id,
    { startsOn: "2026-05-31" },
    { expectedUpdatedAt: created.recurringDebt.updatedAt },
  );
  assertEquals(current.status, "saved");
  assertEquals(debts.length, 3);
});
