import { assert, assertEquals, assertThrows } from "../../../testing/assert.ts";
import { historicalAuditData } from "./historical_audit_import.ts";

const data = {
  action: "contact.updated",
  occurredAt: "2020-01-01T00:00:00Z",
  createdAt: "2020-01-02T00:00:00Z",
  actorNameSnapshot: "Historical Author",
  visibleOnDashboard: true,
  payload: { safe: { token: "secret", text: "history" }, password: "secret" },
};
Deno.test("historical audit boundary validates data and strips credentials independently of the source mapper", () => {
  const result = historicalAuditData({ ...data, actorMemberId: "untrusted" });
  assertEquals(result.payload, { safe: { text: "history" } });
  assertEquals(result.actorNameSnapshot, "Historical Author");
  assertEquals(
    (result as unknown as Record<string, unknown>).actorMemberId,
    undefined,
  );
});
Deno.test("historical audit refuses invalid dates, flags, actions and payload shapes", () => {
  for (
    const override of [
      { action: "" },
      { occurredAt: "invalid" },
      { occurredAt: "2020-02-31" },
      { visibleOnDashboard: "yes" },
      { payload: [] },
    ]
  ) {
    assertThrows(
      () => historicalAuditData({ ...data, ...override }),
      "invalid data must fail",
    );
  }
  assertThrows(
    () =>
      historicalAuditData({ ...data, payload: { safe: "x".repeat(100_001) } }),
    "oversized payload must fail",
  );
  assert(
    historicalAuditData({ ...data, actorNameSnapshot: null })
      .actorNameSnapshot === null,
    "null actor remains anonymous",
  );
});

Deno.test("historical audit owner boundary refuses revoked actors and foreign workspace references before writing", async () => {
  const { createHistoricalAuditImport } = await import(
    "./historical_audit_import.ts"
  );
  const { assertRejects } = await import("../../../testing/assert.ts");
  const written: unknown[] = [];
  let active = true;
  const boundary = createHistoricalAuditImport({
    actors: {
      revalidate: (command) => {
        assertEquals(command.lock, true);
        return Promise.resolve(active ? "active" : "revoked");
      },
    },
    references: {
      personExists: (command) =>
        Promise.resolve(
          command.actor.workspaceId === "workspace" &&
            command.personId === "person",
        ),
      reminderExists: (command) =>
        Promise.resolve(
          command.actor.workspaceId === "workspace" &&
            command.reminderId === "reminder",
        ),
    },
    recorder: {
      recordImported: (command) => {
        written.push(command);
        return Promise.resolve();
      },
    },
  });
  const actor = {
    workspaceId: "workspace",
    memberId: "member",
    role: "owner" as const,
    userId: "user",
  };
  const transaction = { opaque: {} };
  for (
    const references of [{ personId: "foreign" }, { reminderId: "foreign" }]
  ) {
    await assertRejects(() =>
      boundary.importRecords({
        actor,
        records: [{ id: "event", data, references }],
        transaction,
      }), "foreign references must fail");
  }
  active = false;
  await assertRejects(
    () =>
      boundary.importRecords({
        actor,
        records: [{ id: "event", data, references: {} }],
        transaction,
      }),
    "revoked actor must fail",
  );
  active = true;
  await assertRejects(
    () =>
      boundary.importRecords({
        actor: { ...actor, role: "member" },
        records: [],
        transaction,
      }),
    "ordinary member must fail",
  );
  assertEquals(written.length, 0);
  await boundary.importRecords({
    actor,
    records: [{
      id: "event",
      data,
      references: { personId: "person", reminderId: "reminder" },
    }],
    transaction,
  });
  assertEquals(written.length, 1);
  const event = written[0] as Record<string, unknown>;
  assertEquals(event.personId, "person");
  assertEquals(event.reminderId, "reminder");
  assertEquals(event.actorMemberId, undefined);
});
