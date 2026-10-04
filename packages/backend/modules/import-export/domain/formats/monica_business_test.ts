import { assertEquals } from "../../../../testing/assert.ts";
import { monicaBusiness } from "./monica_business.ts";
Deno.test("business mapping preserves directional edges and historical record metadata", () => {
  const result = monicaBusiness({
    contacts: [{ id: 1, account_id: 2 }, { id: 2, account_id: 2 }],
    relationship_types: [{
      id: 3,
      account_id: 2,
      name: "parent",
      name_reverse_relationship: "child",
      relationship_type_group_id: null,
    }],
    relationships: [{
      id: 4,
      account_id: 2,
      contact_is: 1,
      of_contact: 2,
      relationship_type_id: 3,
    }],
    activities: [{
      id: 5,
      account_id: 2,
      summary: "Walk",
      happened_at: "2020-01-02 11:00:00",
    }],
    notes: [{
      id: 6,
      account_id: 2,
      contact_id: 1,
      body: "Remember",
      is_favorited: 1,
      created_at: "2020-01-01 10:00:00",
    }],
    reminders: [{
      id: 7,
      account_id: 2,
      contact_id: 1,
      title: "Call",
      initial_date: "2020-01-01",
      frequency_type: "month",
      frequency_number: 2,
    }],
  });
  assertEquals(result.entities.map((x) => x.sourceTable), [
    "relationship_types",
    "relationships",
    "activities",
    "notes",
    "reminders",
  ]);
  assertEquals(
    result.entities.find((x) => x.sourceTable === "notes")?.data.isFavorited,
    true,
  );
  assertEquals(
    result.entities.find((x) => x.sourceTable === "reminders")?.data
      .recurrenceInterval,
    2,
  );
});

Deno.test("business mapping collapses mirrored relationships and rejects cross-account references", () => {
  const result = monicaBusiness({
    contacts: [{ id: 1, account_id: 1 }, { id: 2, account_id: 1 }, {
      id: 3,
      account_id: 2,
    }],
    relationship_types: [{
      id: 1,
      account_id: 1,
      name: "parent",
      name_reverse_relationship: "child",
    }, {
      id: 2,
      account_id: 1,
      name: "child",
      name_reverse_relationship: "parent",
    }],
    relationships: [{
      id: 1,
      account_id: 1,
      contact_is: 1,
      of_contact: 2,
      relationship_type_id: 1,
    }, {
      id: 2,
      account_id: 1,
      contact_is: 2,
      of_contact: 1,
      relationship_type_id: 2,
    }, {
      id: 3,
      account_id: 1,
      contact_is: 1,
      of_contact: 3,
      relationship_type_id: 1,
    }],
  });
  assertEquals(
    result.entities.filter((e) => e.data.kind === "relationship").length,
    1,
  );
  assertEquals(result.unsupportedRows?.relationships, 1);
});

import { parseMonicaSource } from "./monica_source.ts";
Deno.test("business dry run refuses oversized text, malformed timestamps and invalid recurrence", () => {
  for (
    const values of [
      { notes: [{ id: 1, contact_id: 1, body: "x".repeat(10001) }] },
      { activities: [{ id: 1, summary: "Walk", happened_at: "yesterday" }] },
      {
        reminders: [{
          id: 1,
          contact_id: 1,
          title: "Call",
          initial_date: "2020-01-01",
          frequency_type: "month",
          frequency_number: -1,
        }],
      },
    ]
  ) {
    assertEquals(
      typeof parseMonicaSource({
        format: "monica-json",
        version: 1,
        tables: { contacts: [{ id: 1, first_name: "Example" }], ...values },
      }, { maxAttachmentBytes: 1000 }),
      "string",
    );
  }
});

Deno.test("business mapper preserves activity participants, call direction, emotions, reminder state and cadence", () => {
  const result = monicaBusiness({
    contacts: [{
      id: 1,
      account_id: 1,
      birthday_reminder_id: 1,
      birthday_special_date_id: 1,
      stay_in_touch_frequency: 7,
      stay_in_touch_trigger_date: "2026-10-01",
      last_talked_to: "2026-09-24",
      is_active: 0,
    }, { id: 2, account_id: 1, stay_in_touch_frequency: 14 }],
    special_dates: [{ id: 1, account_id: 1, contact_id: 1 }],
    relationship_type_groups: [{
      id: 1,
      account_id: 1,
      name: "Family",
      delible: 1,
      created_at: "2020-01-01",
      updated_at: "2020-01-02",
    }],
    relationship_types: [{
      id: 1,
      account_id: 1,
      name: "friend",
      relationship_type_group_id: 1,
    }],
    relationships: [{
      id: 1,
      account_id: 1,
      contact_is: 1,
      of_contact: 1,
      relationship_type_id: 1,
    }, {
      id: 2,
      account_id: 1,
      contact_is: 1,
      of_contact: 2,
      relationship_type_id: 1,
      status: "ended",
    }],
    activity_type_categories: [{
      id: 1,
      account_id: 1,
      name: "Social",
      translation_key: "social",
    }, { id: 2, account_id: 1 }],
    activity_types: [{
      id: 1,
      account_id: 1,
      activity_type_category_id: 1,
      name: "Walking",
      translation_key: "walk",
      location_type: "place",
    }, { id: 2, account_id: 1 }],
    activities: [{
      id: 1,
      account_id: 1,
      activity_type_id: 1,
      summary: "Walking",
      description: "Outside",
      happened_at: "2020-01-01",
    }, { id: 2, account_id: 1 }],
    activity_contact: [{
      account_id: 1,
      activity_id: 1,
      contact_id: 1,
      role: "host",
    }, { account_id: 1, activity_id: 1, contact_id: 2 }],
    calls: [{
      id: 1,
      account_id: 1,
      contact_id: 1,
      called_at: "2020-01-02",
      contact_called: 1,
      content: "Hello",
    }],
    emotion_call: [{ account_id: 1, call_id: 1, emotion_id: 1 }, {
      account_id: 1,
      call_id: 99,
      emotion_id: 2,
    }, { account_id: 1, call_id: 1, emotion_id: 999 }],
    emotion_activity: [{ account_id: 1, activity_id: 1, emotion_id: 1 }],
    notes: [{
      id: 1,
      account_id: 1,
      contact_id: 1,
      body: "Remember",
      favorited_at: "2020-01-01",
    }],
    reminder_rules: [{
      id: 1,
      account_id: 1,
      number_of_days_before: 7,
      active: 0,
    }, { id: 2, account_id: 1, number_of_days_before: 0 }],
    reminders: [
      {
        id: 1,
        account_id: 1,
        contact_id: 1,
        initial_date: "2020-01-01",
        frequency_type: "year",
        frequency_number: 1,
        inactive: 1,
        delible: 0,
        description: "Birthday",
      },
      {
        id: 2,
        account_id: 1,
        initial_date: "2020-01-01",
        frequency_type: "one_time",
      },
      {
        id: 3,
        account_id: 1,
        initial_date: "2020-01-01",
        frequency_type: "week",
      },
      { id: 4, account_id: 1, frequency_type: "unknown" },
      { id: 5, account_id: 1, frequency_type: "day" },
    ],
  });
  const find = (kind: string) =>
    result.entities.find((e) => e.data.kind === kind)!;
  assertEquals(find("relationship").data.status, "ended");
  assertEquals(find("call").data.contactWasCaller, true);
  assertEquals(find("call_emotion").references?.emotionId, {
    table: "emotions",
    key: "1",
  });
  assertEquals(find("activity_emotion").references?.parentId, {
    table: "activities",
    key: "1",
  });
  assertEquals(find("reminder").references?.dateId, {
    table: "special_dates",
    key: "1",
  });
  assertEquals(find("reminder").data.isActive, false);
  assertEquals(find("cadence").data.intervalCount, 7);
  assertEquals(find("cadence").data.lastContactedAt, "2026-09-24");
  assertEquals(find("rule").data.isActive, false);
  assertEquals(result.unsupportedRows, {
    relationships: 1,
    emotion_call: 2,
    reminders: 2,
  });
});

Deno.test("business dry run rejects impossible calendar dates instead of silently rolling them forward", () => {
  const result = parseMonicaSource({
    format: "monica-json",
    version: 1,
    tables: {
      contacts: [{ id: 1, first_name: "Example" }],
      calls: [{ id: 1, contact_id: 1, called_at: "2020-02-30" }],
    },
  }, { maxAttachmentBytes: 1000 });
  assertEquals(typeof result, "string");
});

Deno.test("business dry run validates required fields, source identities and table shapes before staging", () => {
  const invalids: Record<string, unknown>[] = [
    { activities: "invalid" },
    { activities: [null] },
    {
      activities: [{
        id: 1,
        summary: "x".repeat(10001),
        happened_at: "2020-01-01",
      }],
    },
    { activities: [{ id: 1, summary: "Walk", happened_at: 123 }] },
    {
      activities: [{
        id: 1,
        summary: "Walk",
        happened_at: "2020-01-01T99:00:00Z",
      }],
    },
    { activities: [{ id: 1, summary: 1, happened_at: "2020-01-01" }] },
    { calls: [{ id: 1, contact_id: 1 }] },
    { relationship_types: [{ id: 1 }] },
    { notes: [{ id: 1, contact_id: 1, body: "" }] },
    {
      notes: [{ id: 1, contact_id: 1, body: "Same" }, {
        id: 1,
        contact_id: 1,
        body: "Same",
      }],
    },
    { reminder_rules: [{ id: 1, number_of_days_before: -1 }] },
    { reminders: [{ id: 1, initial_date: "invalid", frequency_type: "year" }] },
    {
      reminders: [{
        id: 1,
        initial_date: "2020-02-30",
        frequency_type: "year",
      }],
    },
  ];
  for (const tables of invalids) {
    assertEquals(
      typeof parseMonicaSource({
        format: "monica-json",
        version: 1,
        tables: { contacts: [{ id: 1, first_name: "Example" }], ...tables },
      }, { maxAttachmentBytes: 1000 }),
      "string",
    );
  }
  const valid = parseMonicaSource({
    format: "monica-json",
    version: 1,
    tables: {
      contacts: [{ id: 1, first_name: "Example" }],
      notes: [{
        id: 1,
        contact_id: 1,
        body: "Retained",
        created_at: "2020-01-01 12:00:00",
        updated_at: "2020-01-02T12:00:00Z",
      }],
      calls: [{ id: 1, contact_id: 1, called_at: "2020-01-01T12:00:00+02:00" }],
    },
  }, { maxAttachmentBytes: 1000 });
  if (typeof valid === "string") throw new Error(valid);
  assertEquals(
    valid.businessEntities?.find((e) => e.data.kind === "note")?.data.createdAt,
    "2020-01-01T12:00:00.000Z",
  );
  assertEquals(
    valid.businessEntities?.find((e) => e.data.kind === "call")?.data.calledAt,
    "2020-01-01T10:00:00.000Z",
  );
});
