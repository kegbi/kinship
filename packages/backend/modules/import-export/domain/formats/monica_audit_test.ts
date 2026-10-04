import { assert, assertEquals } from "../../../../testing/assert.ts";
import { monicaAudit } from "./monica_audit.ts";

const audit = {
  id: 7,
  account_id: 1,
  author_id: 2,
  about_contact_id: 3,
  author_name: "Historical Author",
  action: "contact.updated",
  objects: JSON.stringify({
    title: "Changed",
    nested: { password: "secret", safe: 3 },
    apiKey: "secret",
  }),
  should_appear_on_dashboard: 1,
  audited_at: "2020-01-02 03:04:05",
  created_at: "2020-01-03 03:04:05",
  updated_at: "2020-01-04 03:04:05",
};
Deno.test("Monica historical audit preserves provenance, actor snapshot and dates, redacting nested credentials", () => {
  const result = monicaAudit({
    contacts: [{ id: 3, account_id: 1 }],
    audit_logs: [audit],
  });
  assert(typeof result !== "string", "valid source");
  const entity = result.entities[0]!;
  assertEquals(entity.sourcePrimaryKey, "7");
  assertEquals(entity.references, {
    personId: { table: "contacts", key: "3" },
  });
  assertEquals(entity.data.actorNameSnapshot, "Historical Author");
  assertEquals(entity.data.occurredAt, "2020-01-02T03:04:05.000Z");
  assertEquals(entity.data.createdAt, "2020-01-03T03:04:05.000Z");
  assertEquals(entity.data.visibleOnDashboard, true);
  assertEquals((entity.data.payload as Record<string, unknown>).objects, {
    title: "Changed",
    nested: { safe: 3 },
  });
  assertEquals(entity.data.actorMemberId, undefined);
});
Deno.test("Monica history keeps deleted or foreign-account subjects only as source provenance", () => {
  const result = monicaAudit({
    contacts: [{ id: 3, account_id: 9 }],
    audit_logs: [audit],
  });
  assert(typeof result !== "string", "history remains importable");
  assertEquals(result.entities[0]!.references, {});
  const payload = result.entities[0]!.data.payload as Record<string, unknown>;
  assertEquals((payload.source as Record<string, unknown>).contactId, "3");
});
Deno.test("Monica sent reminders become inert historical events with exact source references", () => {
  const result = monicaAudit({
    contacts: [{ id: 3, account_id: 1 }],
    reminders: [{ id: 4, account_id: 1 }],
    reminders_sent: [{
      id: 5,
      account_id: 1,
      contact_id: 3,
      reminder_id: 4,
      title: "Anniversary",
      description: "Message",
      html_sent_content: "<p>Message</p>",
      scheduled_number_days_before: 2,
      sent_date: "2020-01-02",
      created_at: "2020-01-01 00:00:00",
    }],
  });
  assert(typeof result !== "string", "valid reminder history");
  assertEquals(result.entities[0]!.data.action, "reminder.sent");
  assertEquals(result.entities[0]!.references, {
    personId: { table: "contacts", key: "3" },
    reminderId: { table: "reminders", key: "4" },
  });
});
Deno.test("Monica audit rejects unusable history without silently inventing timestamps or losing rows", () => {
  for (
    const value of [{ ...audit, audited_at: "not a date" }, {
      ...audit,
      objects: "{bad json",
    }, { ...audit, should_appear_on_dashboard: "yes" }]
  ) {
    assert(
      typeof monicaAudit({ audit_logs: [value] }) === "string",
      "invalid history rejected",
    );
  }
  assert(
    typeof monicaAudit({ audit_logs: [null] }) === "string",
    "invalid row rejected",
  );
});

Deno.test("Monica audit refuses malformed rows, fields, dates, oversized payloads and excessive nesting", () => {
  for (const table of [null, {}, [false], [[]], [null]]) {
    assert(
      typeof monicaAudit({ audit_logs: table }) === "string",
      "malformed audit table must fail",
    );
    assert(
      typeof monicaAudit({ reminders_sent: table }) === "string",
      "malformed reminder history must fail",
    );
  }
  let deep: unknown = "leaf";
  for (let index = 0; index < 15; index++) deep = { child: deep };
  const invalidFields = [
    { id: null },
    { id: -1 },
    { action: 12 },
    { action: " " },
    { action: "x".repeat(501) },
    { author_name: false },
    { author_name: "x".repeat(10_001) },
    { audited_at: null },
    { audited_at: "2020-02-31" },
    { audited_at: "2020-13-01" },
    { audited_at: "2020-01-01T25:00:00Z" },
    { created_at: "invalid" },
    { objects: { text: "x".repeat(100_001) } },
    { objects: deep },
  ];
  for (const fields of invalidFields) {
    assert(
      typeof monicaAudit({ audit_logs: [{ ...audit, ...fields }] }) ===
        "string",
      "invalid history must fail as a whole",
    );
  }
});

Deno.test("Monica audit normalizes explicit zones and falls back to the event date only when creation is absent", () => {
  for (
    const [auditedAt, expected] of [
      ["2020-01-02", "2020-01-02T00:00:00.000Z"],
      ["2020-01-02T03:04:05Z", "2020-01-02T03:04:05.000Z"],
      ["2020-01-02 03:04:05.123+02:00", "2020-01-02T01:04:05.123Z"],
    ]
  ) {
    const result = monicaAudit({
      audit_logs: [{
        ...audit,
        audited_at: auditedAt,
        created_at: null,
        author_name: null,
        objects: null,
        should_appear_on_dashboard: false,
      }],
    });
    assert(typeof result !== "string", "valid source date");
    assertEquals(result.entities[0]!.data.occurredAt, expected);
    assertEquals(result.entities[0]!.data.createdAt, expected);
    assertEquals(result.entities[0]!.data.actorNameSnapshot, null);
    assertEquals(result.entities[0]!.data.visibleOnDashboard, false);
    assertEquals(
      (result.entities[0]!.data.payload as Record<string, unknown>).objects,
      {},
    );
  }
  const blank = monicaAudit({
    audit_logs: [{
      ...audit,
      objects: "",
      should_appear_on_dashboard: undefined,
    }],
  });
  assert(typeof blank !== "string", "blank legacy payload is preserved");
  assertEquals(
    (blank.entities[0]!.data.payload as Record<string, unknown>).objects,
    "",
  );
  assertEquals(blank.entities[0]!.data.visibleOnDashboard, false);
});

Deno.test("Monica audit redacts credentials in arrays and encoded nested JSON while preserving ordinary values", () => {
  const result = monicaAudit({
    audit_logs: [{
      ...audit,
      objects: {
        changes: [{ token: "secret", label: "safe", values: [null, 0, true] }],
        encoded: JSON.stringify({
          password: "secret",
          nested: [{ api_key: "secret", value: "safe" }],
        }),
        unstructured: "{not a structured JSON value",
      },
    }],
  });
  assert(typeof result !== "string", "nested history is importable");
  assertEquals(
    (result.entities[0]!.data.payload as Record<string, unknown>).objects,
    {
      changes: [{ label: "safe", values: [null, 0, true] }],
      encoded: { nested: [{ value: "safe" }] },
      unstructured: "{not a structured JSON value",
    },
  );
});

Deno.test("Monica audit resolves numeric and UUID source identities without trusting a legacy actor", () => {
  const legacyAuthor = "01234567-89ab-4def-8123-456789abcdef";
  const contactId = "11234567-89ab-4def-8123-456789abcdef";
  const result = monicaAudit({
    users: [{ id: legacyAuthor, account_id: 1, active: true, role: "owner" }],
    contacts: [{ id: 999, account_id: 1 }, { id: contactId, account_id: "1" }],
    audit_logs: [{
      ...audit,
      id: "7",
      account_id: "1",
      author_id: legacyAuthor,
      about_contact_id: contactId,
      actor_member_id: legacyAuthor,
    }],
  });
  assert(typeof result !== "string", "string identifiers remain importable");
  const entity = result.entities[0]!;
  assertEquals(entity.references, {
    personId: { table: "contacts", key: contactId },
  });
  assertEquals(entity.data.actorMemberId, undefined);
  assertEquals(
    (entity.data.payload as Record<string, Record<string, unknown>>).source!
      .authorId,
    legacyAuthor,
  );
  const duplicate = monicaAudit({
    contacts: [{ id: 3, account_id: 1 }, { id: "3", account_id: "1" }],
    audit_logs: [audit],
  });
  assert(
    typeof duplicate !== "string",
    "ambiguous source references retain history",
  );
  assertEquals(duplicate.entities[0]!.references, {});
});

Deno.test("Monica sent reminder history preserves absent fields without scheduling or inventing references", () => {
  assertEquals(monicaAudit({}), {
    entities: [],
    handledTables: ["audit_logs", "reminders_sent"],
  });
  const result = monicaAudit({
    reminders_sent: [{
      id: "sent-1",
      sent_date: "2020-01-02",
      updated_at: "2020-01-03",
    }],
  });
  assert(typeof result !== "string", "minimal delivered history is valid");
  const entity = result.entities[0]!;
  assertEquals(entity.owner, "governance");
  assertEquals(entity.targetTable, "audit_events");
  assertEquals(entity.references, {});
  assertEquals(entity.data.actorNameSnapshot, null);
  assertEquals(entity.data.visibleOnDashboard, false);
  assertEquals(entity.data.createdAt, "2020-01-02T00:00:00.000Z");
  assertEquals(entity.data.payload, {
    title: null,
    description: null,
    html_sent_content: null,
    lead_time_days: null,
    source_updated_at: "2020-01-03",
    source: {
      system: "monica",
      table: "reminders_sent",
      id: "sent-1",
      accountId: null,
      authorId: null,
      contactId: null,
      reminderId: null,
      updatedAt: "2020-01-03",
    },
  });
  const missingSentDate = monicaAudit({
    reminders_sent: [{ id: 1, created_at: "2020-01-01" }],
  });
  assert(
    typeof missingSentDate === "string",
    "creation is not evidence of delivery",
  );
});
