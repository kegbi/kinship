import { MONICA_EMOTIONS } from "./monica_emotions.ts";
import type {
  BusinessParseResult,
  UnstagedBusinessEntity,
} from "../business_entities.ts";
import { booleanValue, sourceId } from "./monica_source.ts";
type Row = Record<string, unknown>;
export function monicaBusiness(
  tables: Readonly<Record<string, unknown>>,
): BusinessParseResult {
  const rows = (table: string): Row[] =>
    Array.isArray(tables[table]) ? tables[table] as Row[] : [];
  const entities: UnstagedBusinessEntity[] = [];
  const unsupportedRows: Record<string, number> = {};
  const handledTables = [
    "relationship_type_groups",
    "relationship_types",
    "relationships",
    "activity_type_categories",
    "activity_types",
    "activities",
    "activity_contact",
    "calls",
    "notes",
    "reminders",
    "reminder_rules",
    "emotion_call",
    "emotion_activity",
  ];
  const ref = (table: string, key: unknown) => ({
    table,
    key: sourceId(key) ?? "",
  });
  const times = (r: Row) => ({
    createdAt: r.created_at ?? null,
    updatedAt: r.updated_at ?? null,
    sourceAccountId: sourceId(r.account_id) ?? "",
  });
  const add = (
    table: string,
    target: string,
    owner: UnstagedBusinessEntity["owner"],
    r: Row,
    data: Record<string, unknown>,
    references: UnstagedBusinessEntity["references"] = {},
    key = sourceId(r.id),
  ) => {
    const valid = key &&
      Object.values(references).every((x) =>
        rows(x.table).some((v) =>
          sourceId(v.id) === x.key &&
          (v.account_id === undefined || r.account_id === undefined ||
            sourceId(v.account_id) === sourceId(r.account_id))
        )
      );
    if (!valid) {
      unsupportedRows[table] = (unsupportedRows[table] ?? 0) + 1;
      return;
    }
    entities.push({
      sourceTable: table,
      sourcePrimaryKey: key!,
      targetTable: target,
      owner,
      data: { ...times(r), ...data },
      references,
    });
  };
  for (const r of rows("relationship_type_groups")) {
    add(
      "relationship_type_groups",
      "relationship_type_groups",
      "vocabulary",
      r,
      {
        kind: "relationship_group",
        name: r.name,
        canDelete: booleanValue(r.delible),
      },
    );
  }
  for (const r of rows("relationship_types")) {
    add(
      "relationship_types",
      "relationship_types",
      "vocabulary",
      r,
      {
        kind: "relationship_type",
        forwardLabel: r.name,
        reverseLabel: r.name_reverse_relationship ?? r.name,
        canDelete: booleanValue(r.delible),
      },
      (r.relationship_type_group_id === null ||
          r.relationship_type_group_id === undefined)
        ? {}
        : {
          groupId: ref(
            "relationship_type_groups",
            r.relationship_type_group_id,
          ),
        },
    );
  }
  const seenEdges = new Map<string, string>();
  for (const r of rows("relationships")) {
    const t = rows("relationship_types").find((t) =>
      sourceId(t.id) === sourceId(r.relationship_type_id) &&
      sourceId(t.account_id) === sourceId(r.account_id)
    );
    const f = sourceId(r.contact_is), to = sourceId(r.of_contact);
    const edge = JSON.stringify([
      r.account_id,
      f,
      to,
      t?.name,
      t?.name_reverse_relationship,
    ]);
    const inverse = JSON.stringify([
      r.account_id,
      to,
      f,
      t?.name_reverse_relationship,
      t?.name,
    ]);
    const existing = seenEdges.get(edge) ?? seenEdges.get(inverse);
    if (existing) {
      add("relationships", "relationships", "relationships", r, {
        kind: "relationship_alias",
      }, { relationshipId: ref("relationships", existing) });
      continue;
    }
    if (sourceId(r.id)) seenEdges.set(edge, sourceId(r.id)!);
    if (f === to) {
      unsupportedRows.relationships = (unsupportedRows.relationships ?? 0) + 1;
      continue;
    }
    add("relationships", "relationships", "relationships", r, {
      kind: "relationship",
      status: r.status === "ended" ? "ended" : "active",
    }, {
      fromPersonId: ref("contacts", f),
      toPersonId: ref("contacts", to),
      typeId: ref("relationship_types", r.relationship_type_id),
    });
  }
  for (const r of rows("activity_type_categories")) {
    add(
      "activity_type_categories",
      "activity_type_categories",
      "vocabulary",
      r,
      {
        kind: "activity_category",
        name: r.name ?? null,
        translationKey: r.translation_key ?? null,
      },
    );
  }
  for (const r of rows("activity_types")) {
    add(
      "activity_types",
      "activity_types",
      "vocabulary",
      r,
      {
        kind: "activity_type",
        name: r.name ?? null,
        translationKey: r.translation_key ?? null,
        locationBehavior: r.location_type ?? null,
      },
      (r.activity_type_category_id === null ||
          r.activity_type_category_id === undefined)
        ? {}
        : {
          categoryId: ref(
            "activity_type_categories",
            r.activity_type_category_id,
          ),
        },
    );
  }
  for (const r of rows("activities")) {
    add(
      "activities",
      "activities",
      "interactions",
      r,
      {
        kind: "activity",
        summary: r.summary ?? "",
        description: r.description ?? null,
        happenedAt: r.happened_at,
      },
      (r.activity_type_id === null || r.activity_type_id === undefined)
        ? {}
        : { typeId: ref("activity_types", r.activity_type_id) },
    );
  }
  for (const r of rows("activity_contact")) {
    add("activity_contact", "activity_participants", "interactions", r, {
      kind: "participant",
      role: r.role ?? null,
    }, {
      activityId: ref("activities", r.activity_id),
      personId: ref("contacts", r.contact_id),
    }, `${r.activity_id}:${r.contact_id}`);
  }
  for (const r of rows("calls")) {
    add("calls", "calls", "interactions", r, {
      kind: "call",
      calledAt: r.called_at,
      content: r.content ?? null,
      contactWasCaller: booleanValue(r.contact_called),
    }, { personId: ref("contacts", r.contact_id) });
  }
  for (const table of ["emotion_call", "emotion_activity"]) {
    for (const r of rows(table)) {
      const name = MONICA_EMOTIONS[Number(r.emotion_id) - 1];
      if (!name) {
        unsupportedRows[table] = (unsupportedRows[table] ?? 0) + 1;
        continue;
      }
      const emotionKey = String(r.emotion_id);
      if (
        !entities.some((e) =>
          e.sourceTable === "emotions" && e.sourcePrimaryKey === emotionKey
        )
      ) {
        entities.push({
          owner: "vocabulary",
          sourceTable: "emotions",
          sourcePrimaryKey: emotionKey,
          targetTable: "emotion_options",
          data: { kind: "emotion", name },
        });
      }
      const call = table === "emotion_call";
      const parent = call ? "calls" : "activities",
        parentId = call ? r.call_id : r.activity_id;
      const existing = rows(parent).some((v) =>
        sourceId(v.id) === sourceId(parentId) &&
        sourceId(v.account_id) === sourceId(r.account_id)
      );
      if (!existing) {
        unsupportedRows[table] = (unsupportedRows[table] ?? 0) + 1;
        continue;
      }
      entities.push({
        owner: "interactions",
        sourceTable: table,
        sourcePrimaryKey: `${parentId}:${emotionKey}`,
        targetTable: call ? "call_emotions" : "activity_emotions",
        data: { ...times(r), kind: call ? "call_emotion" : "activity_emotion" },
        references: {
          parentId: ref(parent, parentId),
          emotionId: ref("emotions", emotionKey),
        },
      });
    }
  }
  for (const [index, r] of rows("notes").entries()) {
    add(
      "notes",
      "notes",
      "interactions",
      r,
      {
        kind: "note",
        body: r.body,
        isFavorited: booleanValue(r.is_favorited),
        favoritedAt: r.favorited_at ?? null,
      },
      { personId: ref("contacts", r.contact_id) },
      sourceId(r.id) ?? `${r.contact_id}:${index}`,
    );
  }
  for (const r of rows("reminder_rules")) {
    add("reminder_rules", "reminder_rules", "planning", r, {
      kind: "rule",
      daysBefore: r.number_of_days_before,
      isActive: (r.active === null || r.active === undefined)
        ? true
        : booleanValue(r.active),
    });
  }
  for (const r of rows("reminders")) {
    const units: Record<string, string> = {
      one_time: "none",
      once: "none",
      none: "none",
      day: "day",
      week: "week",
      month: "month",
      year: "year",
    };
    const recurrenceUnit = units[String(r.frequency_type)];
    if (!recurrenceUnit || typeof r.initial_date !== "string") {
      unsupportedRows.reminders = (unsupportedRows.reminders ?? 0) + 1;
      continue;
    }
    const dateContact = rows("contacts").find((c) =>
      sourceId(c.account_id) === sourceId(r.account_id) &&
      ["birthday", "deceased", "first_met"].some((kind) =>
        sourceId(c[`${kind}_reminder_id`]) === sourceId(r.id)
      )
    );
    const dateKind = dateContact
      ? ["birthday", "deceased", "first_met"].find((kind) =>
        sourceId(dateContact[`${kind}_reminder_id`]) === sourceId(r.id)
      )
      : undefined;
    const refs: Record<string, { table: string; key: string }> =
      (r.contact_id === null || r.contact_id === undefined)
        ? {}
        : { personId: ref("contacts", r.contact_id) };
    if (
      dateContact && dateKind &&
      sourceId(dateContact[`${dateKind}_special_date_id`]) !== undefined
    ) {
      refs.dateId = ref(
        "special_dates",
        dateContact[`${dateKind}_special_date_id`],
      );
    }
    add("reminders", "reminders", "planning", r, {
      kind: "reminder",
      title: r.title ?? null,
      description: r.description ?? null,
      anchorOn: r.initial_date.slice(0, 10),
      recurrenceUnit,
      recurrenceInterval: recurrenceUnit === "none"
        ? 1
        : (r.frequency_number === null || r.frequency_number === undefined)
        ? 1
        : Number(r.frequency_number),
      isActive: !booleanValue(r.inactive),
      canDelete: (r.delible === null || r.delible === undefined)
        ? true
        : booleanValue(r.delible),
      sendTime: r.send_time ?? null,
      deletedAt: r.deleted_at ?? null,
    }, refs);
  }
  for (const r of rows("contacts")) {
    if (Number(r.stay_in_touch_frequency) > 0) {
      add("contacts_cadence", "stay_in_touch_cadences", "planning", r, {
        kind: "cadence",
        intervalCount: Number(r.stay_in_touch_frequency),
        nextDueAt: r.stay_in_touch_trigger_date ?? null,
        lastContactedAt: r.last_talked_to ?? null,
        isActive: (r.is_active === null || r.is_active === undefined)
          ? true
          : booleanValue(r.is_active),
      }, { personId: ref("contacts", r.id) });
    }
  }
  return { entities, handledTables, unsupportedRows };
}
