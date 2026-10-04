import { assertEquals, assertRejects } from "../../../testing/assert.ts";
import { commitBusinessEntities } from "./business_import.ts";
import {
  type BusinessEntity,
  businessTargetId,
} from "../domain/business_entities.ts";
import * as fixtures from "../../../testing/fixtures.ts";
const actor = fixtures.actor({ role: "admin" }), transaction = { opaque: {} };
const note: BusinessEntity = {
  owner: "interactions",
  sourceTable: "notes",
  sourcePrimaryKey: "1",
  targetTable: "notes",
  targetId: "note-id",
  data: { kind: "note", body: "Hello" },
  references: { personId: { table: "contacts", key: "1" } },
};
Deno.test("business identities isolate unrelated sources with the same numeric account and row IDs", async () => {
  const first = await businessTargetId(
    actor.workspaceId,
    note,
    "contact-uuid-one",
  );
  assertEquals(
    first,
    await businessTargetId(actor.workspaceId, note, "contact-uuid-one"),
  );
  assertEquals(
    first ===
      await businessTargetId(actor.workspaceId, note, "contact-uuid-two"),
    false,
  );
});
Deno.test("business commit enriches reused people in the same transaction and skips deleted descendants", async () => {
  const written: unknown[] = [];
  await commitBusinessEntities({
    actor,
    transaction,
    entities: [note, {
      ...note,
      sourcePrimaryKey: "2",
      references: { personId: { table: "contacts", key: "2" } },
    }],
    contacts: new Map([["1", {
      outcome: "reused",
      targetPersonId: "existing",
      legacyNotes: ["Hello"],
      legacyStartedAt: "2020-01-01",
      legacyCompletedAt: "2020-01-02",
    }], ["2", { outcome: "deleted", targetPersonId: "deleted" }]]),
    boundaries: {
      interactions: {
        importRecords: (c) => {
          assertEquals(c.transaction, transaction);
          written.push(c.records[0]);
          return Promise.resolve();
        },
      },
    },
    retarget: () => Promise.resolve(),
  });
  assertEquals(written.length, 1);
  assertEquals((written[0] as { references: unknown }).references, {
    personId: "existing",
  });
});
Deno.test("already imported natural-key records retain their identity and are not written twice", async () => {
  const writes: string[] = [];
  await commitBusinessEntities({
    actor,
    transaction,
    entities: [{ ...note, alreadyImported: true, targetId: "original" }],
    contacts: new Map([["1", {
      outcome: "reused",
      targetPersonId: "existing",
    }]]),
    boundaries: {},
    retarget: (_e, id) => {
      writes.push(id);
      return Promise.resolve();
    },
  });
  assertEquals(writes, ["original"]);
});
Deno.test("unresolved business references abort rather than silently losing records", async () => {
  await assertRejects(
    () =>
      commitBusinessEntities({
        actor,
        transaction,
        entities: [note],
        contacts: new Map(),
        boundaries: {},
        retarget: () => Promise.resolve(),
      }),
    "unresolved references",
  );
});

Deno.test("source reminder rules are all imported before reminder scheduling regardless of staging order", async () => {
  const written: string[] = [];
  const reminder: BusinessEntity = {
    owner: "planning",
    sourceTable: "reminders",
    sourcePrimaryKey: "1",
    targetTable: "reminders",
    targetId: "reminder-one",
    data: { kind: "reminder" },
    references: { personId: { table: "contacts", key: "1" } },
  };
  const rule: BusinessEntity = {
    owner: "planning",
    sourceTable: "reminder_rules",
    sourcePrimaryKey: "7",
    targetTable: "reminder_rules",
    targetId: "rule-seven",
    data: { kind: "rule", daysBefore: 7 },
  };
  await commitBusinessEntities({
    actor,
    transaction,
    entities: [reminder, rule, {
      ...reminder,
      sourcePrimaryKey: "2",
      targetId: "reminder-two",
    }, {
      ...rule,
      sourcePrimaryKey: "0",
      targetId: "rule-zero",
      data: { kind: "rule", daysBefore: 0 },
    }],
    contacts: new Map([["1", { outcome: "reused", targetPersonId: "person" }]]),
    boundaries: {
      planning: {
        assertReminder: () => Promise.resolve(true),
        importRecords: (c) => {
          written.push(c.records[0]!.id);
          return Promise.resolve();
        },
      },
    },
    retarget: () => Promise.resolve(),
  });
  assertEquals(written, [
    "rule-seven",
    "rule-zero",
    "reminder-one",
    "reminder-two",
  ]);
});

Deno.test("only reviewed profiles inherit a reused contact's repair guard; new debts are inserted", async () => {
  const written: Readonly<Record<string, unknown>>[] = [];
  const boundary = {
    importRecords: (
      c: {
        readonly records: readonly {
          readonly data: Readonly<Record<string, unknown>>;
        }[];
      },
    ) => {
      written.push(...c.records.map((r) => r.data));
      return Promise.resolve();
    },
  };
  const entity = { ...note, data: { kind: "debt", reviewedChoice: true } };
  await commitBusinessEntities({
    actor,
    transaction,
    entities: [
      { ...entity, owner: "gifts", sourcePrimaryKey: "new-debt" },
      {
        ...entity,
        owner: "gifts",
        sourcePrimaryKey: "existing-debt",
        data: { ...entity.data, repairBefore: "2020-01-01" },
      },
      {
        ...entity,
        owner: "people",
        sourcePrimaryKey: "profile",
        data: { kind: "profile", reviewedChoice: true },
      },
    ],
    contacts: new Map([["1", {
      outcome: "reused",
      targetPersonId: "person",
      repairBefore: "2019-01-01",
    }]]),
    boundaries: { gifts: boundary, people: boundary },
    retarget: () => Promise.resolve(),
  });
  assertEquals(written.map((r) => r.repairBefore ?? null), [
    null,
    "2020-01-01",
    "2019-01-01",
  ]);
});
