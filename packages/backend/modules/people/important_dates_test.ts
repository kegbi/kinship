import {
  createImportantDateManagement,
  type ImportantDateDependencies,
  type PeopleTransaction,
} from "./public.ts";

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
const dateId = "00000000-0000-4000-8000-000000000200";

function dependencies(options: {
  readonly authorization?: "archived" | "forbidden" | "not-found" | "ready";
  readonly failAudit?: boolean;
} = {}): { dependencies: ImportantDateDependencies; effects: string[] } {
  const effects: string[] = [];
  const transaction: PeopleTransaction = { opaque: "important-date-test" };
  return {
    effects,
    dependencies: {
      audit: {
        record(command) {
          effects.push(`audit:${command.action}`);
          return Promise.resolve("00000000-0000-4000-8000-000000000300");
        },
        assertPostcondition() {
          effects.push("audit.assert");
          return options.failAudit
            ? Promise.reject(new Error("audit missing"))
            : Promise.resolve();
        },
      },
      clock: { now: () => new Date("2026-08-15T12:00:00.000Z") },
      ids: { create: () => dateId },
      publisher: {
        regenerate(command) {
          effects.push(
            `planning:${command.after?.precision ?? "deleted"}:${
              command.after?.isYearApproximate ?? false
            }`,
          );
          return Promise.resolve();
        },
      },
      repository: {
        lockContext() {
          effects.push("authorization.lock");
          const status = options.authorization ?? "ready";
          return Promise.resolve(
            status === "ready" || status === "archived"
              ? { status }
              : { status },
          );
        },
        lockDate() {
          effects.push("date.lock");
          return Promise.resolve({ status: "not-found" });
        },
        list() {
          effects.push("date.list");
          return Promise.resolve([]);
        },
        create(command) {
          effects.push("date.create");
          return Promise.resolve({
            ...command.value,
            createdAt: command.occurredAt.toISOString(),
            id: command.id,
            personId: command.personId,
            scheduling: "not-schedulable" as const,
            updatedAt: command.occurredAt.toISOString(),
          });
        },
        update() {
          throw new Error("not used");
        },
        delete() {
          throw new Error("not used");
        },
        assertPostcondition() {
          effects.push("date.assert");
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

Deno.test("PEOPLE-005 preserves approximate year independently from component precision", async () => {
  const fake = dependencies();
  const result = await createImportantDateManagement(fake.dependencies).create(
    actor,
    personId,
    {
      isAgeBased: true,
      isYearApproximate: true,
      kind: "birthday",
      precision: "year",
      year: 1984,
    },
  );
  assert(result.status === "created", "approximate year is accepted");
  assert(result.date.year === 1984, "known year is preserved");
  assert(result.date.isYearApproximate, "approximation is not collapsed");
  assert(
    fake.effects.join(",") ===
      "transaction.begin,authorization.lock,date.create,planning:year:true,audit:create,date.assert,audit.assert,transaction.commit",
    `unexpected effect order: ${fake.effects.join(",")}`,
  );
});

Deno.test("PEOPLE-005 rejects contradictory and impossible dates before persistence", async () => {
  const fake = dependencies();
  const dates = createImportantDateManagement(fake.dependencies);
  for (
    const input of [
      {
        day: 29,
        isAgeBased: false,
        isYearApproximate: false,
        kind: "custom" as const,
        label: "Launch",
        month: 2,
        precision: "full" as const,
        year: 2023,
      },
      {
        day: 2,
        isAgeBased: false,
        isYearApproximate: false,
        kind: "custom" as const,
        label: "Launch",
        month: 1,
        precision: "year" as const,
        year: 2020,
      },
    ]
  ) {
    const result = await dates.create(actor, personId, input);
    assert(result.status === "validation-error", "invalid shape is rejected");
  }
  assert(fake.effects.length === 0, "invalid values never transact");
});

Deno.test("PEOPLE-005 rejects archived writes and rolls back planning/audit failures", async () => {
  const archived = dependencies({ authorization: "archived" });
  const denied = await createImportantDateManagement(archived.dependencies)
    .create(actor, personId, {
      isAgeBased: false,
      isYearApproximate: false,
      kind: "first_met",
      month: 8,
      precision: "month",
    });
  assert(denied.status === "archived-write-rejected", "archived is read-only");

  const failed = dependencies({ failAudit: true });
  let rolledBack = false;
  try {
    await createImportantDateManagement(failed.dependencies).create(
      actor,
      personId,
      {
        day: 29,
        isAgeBased: false,
        isYearApproximate: false,
        kind: "custom",
        label: "Leap day",
        month: 2,
        precision: "month_day",
      },
    );
  } catch {
    rolledBack = true;
  }
  assert(rolledBack, "audit postcondition failure surfaces");
  assert(
    failed.effects.at(-1) === "transaction.rollback",
    "date, reminder state, and audit roll back together",
  );
});
