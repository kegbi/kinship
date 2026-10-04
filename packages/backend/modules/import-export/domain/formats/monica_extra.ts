/** Source-only mappings for profile facts, money, journal references and files. */
import { redacted, sourceId, textValue } from "./monica_source.ts";

type Row = Record<string, unknown>;
type Reference = { readonly table: string; readonly key: string };
export interface MonicaExtraEntity {
  readonly owner: "people" | "gifts" | "journal" | "files" | "workspaces";
  readonly sourceTable: string;
  readonly sourcePrimaryKey: string;
  readonly targetTable: string;
  readonly data: Record<string, unknown>;
  readonly references?: Readonly<Record<string, Reference>>;
}
export interface MonicaExtra {
  readonly entities: readonly MonicaExtraEntity[];
  readonly handledTables: readonly string[];
  readonly unsupportedRows: Readonly<Record<string, number>>;
  readonly unsupportedFields: Readonly<Record<string, number>>;
}

// Monica 4.x migrations 2017_06_10_155349 and 2017_12_24_115641.
// The account SQL exporter omits these global catalogs. Later currencies are
// intentionally not guessed because their IDs vary with installation history.
const CURRENCIES: Readonly<Record<string, string>> = {
  1: "CAD",
  2: "USD",
  3: "GBP",
  4: "EUR",
  5: "RUB",
};
const PETS = [
  "reptile",
  "bird",
  "cat",
  "dog",
  "fish",
  "hamster",
  "horse",
  "rabbit",
  "rat",
  "small_animal",
  "other",
];
const TABLES = [
  "genders",
  "pet_categories",
  "tags",
  "contact_tag",
  "pets",
  "gifts",
  "debts",
  "entries",
  "days",
  "journal_entries",
  "photos",
  "contact_photo",
  "modules",
  "life_event_categories",
  "life_event_types",
  "places",
  "addresses",
];

function timestamp(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?)?$/
      .test(value)
  ) return undefined;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(
    normalized.length === 10
      ? `${normalized}T00:00:00Z`
      : /(?:Z|[+-]\d\d:\d\d)$/.test(normalized)
      ? normalized
      : `${normalized}Z`,
  );
  return Number.isFinite(date.valueOf()) ? date.toISOString() : undefined;
}
function money(
  value: unknown,
  currency: string,
  sql: boolean,
): string | undefined {
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) || (sql && !Number.isSafeInteger(value)))
  ) return undefined;
  const raw = String(value);
  if (!sql) return /^\d{1,15}(?:\.\d{1,4})?$/.test(raw) ? raw : undefined;
  if (!/^\d{1,19}$/.test(raw)) return undefined;
  const digits = [
      "BIF",
      "CLP",
      "DJF",
      "GNF",
      "JPY",
      "KMF",
      "KRW",
      "PYG",
      "RWF",
      "UGX",
      "VND",
      "VUV",
      "XAF",
      "XOF",
      "XPF",
    ].includes(currency)
    ? 0
    : ["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"].includes(currency)
    ? 3
    : ["CLF", "UYW"].includes(currency)
    ? 4
    : 2;
  const padded = BigInt(raw).toString().padStart(digits + 1, "0");
  const result = digits
    ? `${padded.slice(0, -digits)}.${padded.slice(-digits)}`
    : padded;
  return /^\d{1,15}(?:\.\d{1,4})?$/.test(result) ? result : undefined;
}

export function monicaExtra(
  tables: Readonly<Record<string, unknown>>,
  options: { readonly sourceProfile?: "sql_export" | "json_export" } = {},
): MonicaExtra | string {
  const rows = (name: string): Row[] =>
    Array.isArray(tables[name]) ? tables[name] as Row[] : [];
  for (const table of TABLES) {
    if (
      tables[table] !== undefined &&
      (!Array.isArray(tables[table]) ||
        rows(table).some((r) =>
          !r || typeof r !== "object" || Array.isArray(r)
        ))
    ) return "Every related Monica table must contain objects.";
  }
  const entities: MonicaExtraEntity[] = [];
  const unsupportedRows: Record<string, number> = {};
  const unsupportedFields: Record<string, number> = {};
  const unsupported = (table: string) => {
    unsupportedRows[table] = (unsupportedRows[table] ?? 0) + 1;
  };
  const find = (table: string, id: unknown, row: Row): Row | undefined => {
    const key = sourceId(id);
    const matches = rows(table).filter((candidate) =>
      key !== undefined && sourceId(candidate.id) === key &&
      (candidate.account_id === undefined ||
        sourceId(candidate.account_id) === sourceId(row.account_id))
    );
    return matches.length === 1 ? matches[0] : undefined;
  };
  const ref = (table: string, key: unknown): Reference => ({
    table,
    key: sourceId(key)!,
  });
  const add = (
    owner: MonicaExtraEntity["owner"],
    table: string,
    target: string,
    row: Row,
    data: Row,
    references: Record<string, Reference> = {},
    key = sourceId(row.id),
  ) => {
    if (!key) {
      unsupported(table);
      return;
    }
    entities.push({
      owner,
      sourceTable: table,
      sourcePrimaryKey: key,
      targetTable: target,
      data: {
        ...data,
        sourceAccountId: sourceId(row.account_id) ?? "",
        source: redacted(row),
        ...(timestamp(row.created_at)
          ? { createdAt: timestamp(row.created_at) }
          : {}),
        ...(timestamp(row.updated_at)
          ? { updatedAt: timestamp(row.updated_at) }
          : {}),
      },
      references,
    });
  };
  for (const row of rows("genders")) {
    const name = textValue(row.name);
    if (!name) {
      unsupported("genders");
      continue;
    }
    add("workspaces", "genders", "gender_options", row, {
      kind: "gender",
      name,
      code: textValue(row.type) ?? null,
    });
  }
  const categories = new Map<string, Row>();
  for (const row of rows("pet_categories")) {
    if (sourceId(row.id)) categories.set(sourceId(row.id)!, row);
  }
  for (const pet of rows("pets")) {
    const id = sourceId(pet.pet_category_id);
    if (id && !categories.has(id) && PETS[Number(id) - 1]) {
      categories.set(id, {
        id,
        name: PETS[Number(id) - 1],
        is_common: ["3", "4", "5"].includes(id),
      });
    }
  }
  for (const row of categories.values()) {
    const name = textValue(row.name);
    if (!name || !PETS.includes(name)) {
      categories.delete(sourceId(row.id)!);
      unsupported("pet_categories");
      continue;
    }
    add("workspaces", "pet_categories", "pet_categories", row, {
      kind: "pet_category",
      name,
      isCommon: row.is_common === true || row.is_common === 1,
    });
  }
  for (const row of rows("tags")) {
    const name = textValue(row.name);
    if (!name) {
      unsupported("tags");
      continue;
    }
    add("people", "tags", "tags", row, {
      kind: "tag",
      name,
      slug: textValue(row.name_slug) ?? `monica-${sourceId(row.id)}`,
      description: textValue(row.description, 10000) ?? null,
    });
  }
  for (const row of rows("places")) {
    add("people", "places", "locations", row, {
      kind: "location",
      street: textValue(row.street, 1000) ?? null,
      city: textValue(row.city) ?? null,
      region: textValue(row.province) ?? null,
      postalCode: (row.postal_code === null || row.postal_code === undefined)
        ? null
        : String(row.postal_code),
      country: textValue(row.country) ?? null,
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
    });
  }
  const addressOrdinals = new Map<string, number>();
  for (const row of rows("addresses")) {
    if (
      !find("contacts", row.contact_id, row) ||
      !find("places", row.place_id, row)
    ) {
      unsupported("addresses");
      continue;
    }
    const place = find("places", row.place_id, row)!;
    const signature = JSON.stringify([
      row.account_id,
      row.contact_id,
      ...["street", "city", "province", "postal_code", "country"].map((k) =>
        place[k] ?? null
      ),
    ]);
    const duplicateOrdinal = addressOrdinals.get(signature) ?? 0;
    addressOrdinals.set(signature, duplicateOrdinal + 1);
    add("people", "addresses", "person_addresses", row, {
      kind: "address",
      duplicateOrdinal,
      displayName: textValue(row.name) ?? null,
    }, {
      personId: ref("contacts", row.contact_id),
      locationId: ref("places", row.place_id),
    });
  }
  for (const row of rows("contacts")) {
    const refs: Record<string, Reference> = {
      personId: ref("contacts", row.id),
    };
    for (
      const [field, dateKind] of [["birthday_special_date_id", "birthday"], [
        "deceased_special_date_id",
        "deceased",
      ], ["first_met_special_date_id", "first_met"]]
    ) {
      const date = find("special_dates", row[field!], row);
      if (date && sourceId(date.contact_id) === sourceId(row.id)) {
        add("people", "special_dates", "person_dates", date, {
          kind: "existing_date",
          dateKind,
        }, { personId: ref("contacts", row.id) });
      }
    }

    if (find("genders", row.gender_id, row)) {
      refs.genderId = ref("genders", row.gender_id);
    } else if (sourceId(row.gender_id)) {
      unsupportedFields["contacts.gender_id"] =
        (unsupportedFields["contacts.gender_id"] ?? 0) + 1;
    }
    if (
      refs.genderId || timestamp(row.created_at) || timestamp(row.updated_at)
    ) {
      add("people", "contacts_extra", "people", row, { kind: "profile" }, refs);
    }
    const placeText = textValue(row.first_met_where, 10000),
      notes = textValue(row.first_met_additional_info, 10000);
    const introduced = find("contacts", row.first_met_through_contact_id, row);
    if (sourceId(row.first_met_through_contact_id) && !introduced) {
      unsupportedFields["contacts.first_met_through_contact_id"] =
        (unsupportedFields["contacts.first_met_through_contact_id"] ?? 0) + 1;
    }
    if (placeText || notes || introduced) {
      add("people", "contacts_first_meeting", "person_first_meetings", row, {
        kind: "first_meeting",
        placeText: placeText ?? null,
        notes: notes ?? null,
      }, {
        personId: refs.personId!,
        ...(introduced && introduced.id !== row.id
          ? { introducedById: ref("contacts", introduced.id) }
          : {}),
      });
    }
  }
  for (const row of rows("contact_tag")) {
    if (
      !find("contacts", row.contact_id, row) || !find("tags", row.tag_id, row)
    ) {
      unsupported("contact_tag");
      continue;
    }
    add("people", "contact_tag", "person_tags", row, { kind: "person_tag" }, {
      personId: ref("contacts", row.contact_id),
      tagId: ref("tags", row.tag_id),
    }, `${sourceId(row.contact_id)}:${sourceId(row.tag_id)}`);
  }
  for (const row of rows("pets")) {
    if (!find("contacts", row.contact_id, row)) {
      unsupported("pets");
      continue;
    }
    const categoryId = sourceId(row.pet_category_id);
    const category = categoryId && categories.has(categoryId);
    if (categoryId && !category) {
      unsupportedFields["pets.pet_category_id"] =
        (unsupportedFields["pets.pet_category_id"] ?? 0) + 1;
    }
    add("people", "pets", "pets", row, {
      kind: "pet",
      name: textValue(row.name) ?? null,
    }, {
      personId: ref("contacts", row.contact_id),
      ...(category ? { categoryId: ref("pet_categories", categoryId) } : {}),
    });
  }
  for (const table of ["gifts", "debts"]) {
    for (const row of rows(table)) {
      const currencyRow = find("currencies", row.currency_id, row);
      const currencyCode =
        textValue(currencyRow?.iso ?? currencyRow?.code ?? row.currency_code)
          ?.toUpperCase() ?? CURRENCIES[sourceId(row.currency_id) ?? ""];
      const amount =
        (row.amount === null || row.amount === undefined) && table === "gifts"
          ? null
          : money(
            row.amount,
            currencyCode ?? "",
            options.sourceProfile === "sql_export",
          );
      const person = find("contacts", row.contact_id, row);
      if (
        !person || amount === undefined ||
        (sourceId(row.currency_id) && !currencyCode)
      ) {
        unsupported(table);
        continue;
      }
      const references: Record<string, Reference> = {
        personId: ref("contacts", row.contact_id),
      };
      if (table === "debts") {
        const direction = row.in_debt === "yes"
          ? "i_owe"
          : row.in_debt === "no"
          ? "they_owe"
          : undefined;
        const status = row.status === "inprogress" || row.status === "open"
          ? "open"
          : ["complete", "completed", "settled"].includes(String(row.status))
          ? "settled"
          : row.status === "cancelled"
          ? "cancelled"
          : undefined;
        const settledAt = status === "settled"
          ? timestamp(row.settled_at ?? row.updated_at)
          : null;
        if (!direction || !status || (status === "settled" && !settledAt)) {
          unsupported(table);
          continue;
        }
        add("gifts", table, "debts", row, {
          kind: "debt",
          direction,
          status,
          amount,
          currencyCode: currencyCode ?? null,
          reason: textValue(row.reason, 10000) ?? null,
          settledAt,
        }, references);
      } else {
        const name = textValue(row.name, 1000);
        if (!name) {
          unsupported(table);
          continue;
        }
        if (sourceId(row.is_for) && sourceId(row.is_for) !== "0") {
          if (!find("contacts", row.is_for, row)) {
            unsupported(table);
            continue;
          }
          references.recipientId = ref("contacts", row.is_for);
        }
        add("gifts", table, "gifts", row, {
          kind: "gift",
          name,
          status: textValue(row.status) ?? "idea",
          amount,
          currencyCode: currencyCode ?? null,
          url: textValue(row.url, 2048) ?? null,
          comment: textValue(row.comment, 10000) ?? null,
          eventAt: timestamp(row.date) ?? null,
        }, references);
      }
    }
  }
  for (const row of rows("entries")) {
    const body = textValue(row.post ?? row.body, 10000);
    if (!body) {
      unsupported("entries");
      continue;
    }
    add("journal", "entries", "journal_posts", row, {
      kind: "journal_post",
      body,
      title: textValue(row.title) ?? null,
      occurredAt: timestamp(row.date ?? row.created_at) ?? null,
    });
  }
  for (const row of rows("days")) {
    const date = timestamp(row.date);
    if (!date || !Number.isSafeInteger(row.rate ?? row.rating)) {
      unsupported("days");
      continue;
    }
    add("journal", "days", "journal_day_ratings", row, {
      kind: "journal_day",
      ratedOn: date.slice(0, 10),
      rating: row.rate ?? row.rating,
      comment: textValue(row.comment, 10000) ?? null,
    });
  }
  for (const row of rows("journal_entries")) {
    const type = String(row.journalable_type).split("\\").pop()?.toLowerCase();
    const source = type === "activity"
      ? "activities"
      : type === "entry"
      ? "entries"
      : type === "day"
      ? "days"
      : undefined;
    const occurredAt = timestamp(row.date);
    if (!source || !find(source, row.journalable_id, row) || !occurredAt) {
      unsupported("journal_entries");
      continue;
    }
    add("journal", "journal_entries", "journal_items", row, {
      kind: "journal_item",
      occurredAt,
    }, {
      [
        source === "activities"
          ? "activityId"
          : source === "entries"
          ? "postId"
          : "dayId"
      ]: ref(source, row.journalable_id),
    });
  }
  for (const row of rows("photos")) {
    const filename = textValue(row.original_filename, 1000);
    if (
      !filename || !Number.isSafeInteger(row.filesize) ||
      Number(row.filesize) < 0
    ) {
      unsupported("photos");
      continue;
    }
    add("files", "photos", "files", row, {
      kind: "photo",
      filename,
      byteSize: row.filesize,
      mimeType: textValue(row.mime_type) ?? null,
    });
  }
  for (const row of rows("contacts")) {
    if (
      row.avatar_source === "photo" && find("photos", row.avatar_photo_id, row)
    ) {
      add("people", "contacts_avatar", "person_avatars", row, {
        kind: "avatar",
      }, {
        personId: ref("contacts", row.id),
        fileId: ref("photos", row.avatar_photo_id),
      });
    }
  }
  for (const original of rows("contact_photo")) {
    const candidates = rows("contacts").filter((p) =>
      sourceId(p.id) === sourceId(original.contact_id)
    );
    const person = candidates.length === 1 ? candidates[0] : undefined;
    const row: Row = {
      ...original,
      account_id: original.account_id ?? person?.account_id,
    };
    if (
      !person || !find("contacts", row.contact_id, row) ||
      !find("photos", row.photo_id, row)
    ) {
      unsupported("contact_photo");
      continue;
    }
    add("files", "contact_photo", "person_file_links", row, {
      kind: "person_photo",
    }, {
      personId: ref("contacts", row.contact_id),
      fileId: ref("photos", row.photo_id),
    }, `${sourceId(row.contact_id)}:${sourceId(row.photo_id)}`);
  }
  for (const row of rows("modules")) {
    // Monica 4.x 2018_04_04_220850_create_default_modules_table.php.
    // Several source relationship sections share one destination section.
    const aliases: Readonly<Record<string, string>> = {
      contact_information: "contact-methods",
      how_you_met: "first-meeting",
      work_information: "work",
      food_preferences: "food-preferences",
      phone_calls: "calls",
      love_relationships: "relationships",
      family_relationships: "relationships",
      other_relationships: "relationships",
    };
    const sourceKey = textValue(row.key);
    const key = sourceKey ? aliases[sourceKey] ?? sourceKey : undefined;
    const supported = [
      "contact-methods",
      "addresses",
      "relationships",
      "first-meeting",
      "work",
      "food-preferences",
      "pets",
      "life-events",
      "notes",
      "conversations",
      "calls",
      "activities",
      "tasks",
    ];
    if (!key || !supported.includes(key)) {
      unsupported("modules");
      continue;
    }
    const relationshipRows = key === "relationships"
      ? rows("modules").filter((other) =>
        sourceId(other.account_id) === sourceId(row.account_id) &&
        (aliases[String(other.key)] ?? other.key) === "relationships"
      )
      : [];
    const isEnabled = (source: Row) =>
      source.active === true || source.active === 1;
    if (
      relationshipRows.some(isEnabled) &&
      relationshipRows.some((other) => !isEnabled(other))
    ) {
      unsupportedFields["modules.relationship_visibility_consolidated"] =
        (unsupportedFields["modules.relationship_visibility_consolidated"] ??
          0) + 1;
    }
    add("workspaces", "modules", "workspace_profile_modules", row, {
      kind: "profile_module",
      key,
      name: textValue(row.name) ?? null,
      translationKey: textValue(row.translation_key) ?? null,
      canDelete: row.delible === true || row.delible === 1,
      enabled: relationshipRows.length
        ? relationshipRows.some(isEnabled)
        : isEnabled(row),
    });
  }
  for (const row of rows("life_event_categories")) {
    const name = textValue(row.name) ??
      textValue(row.default_life_event_category_key) ??
      textValue(row.translation_key);
    if (!name) {
      unsupported("life_event_categories");
      continue;
    }
    add("workspaces", "life_event_categories", "life_event_categories", row, {
      kind: "life_event_category",
      name,
      seedKey:
        textValue(row.default_life_event_category_key ?? row.translation_key) ??
          null,
      isSystem: row.core_monica_data === true || row.core_monica_data === 1,
    });
  }
  for (const row of rows("life_event_types")) {
    const category = find(
      "life_event_categories",
      row.life_event_category_id,
      row,
    );
    if (sourceId(row.life_event_category_id) && !category) {
      unsupported("life_event_types");
      continue;
    }
    let informationSchema: unknown = row.specific_information_structure ??
      row.specific_information ?? null;
    if (typeof informationSchema === "string") {
      try {
        informationSchema = JSON.parse(informationSchema);
      } catch {
        /* Source text remains in metadata. */ informationSchema = null;
      }
    }
    add(
      "workspaces",
      "life_event_types",
      "life_event_types",
      row,
      {
        kind: "life_event_type",
        name: textValue(row.name) ?? null,
        seedKey:
          textValue(row.default_life_event_type_key ?? row.translation_key) ??
            null,
        isSystem: row.core_monica_data === true || row.core_monica_data === 1,
        informationSchema,
      },
      category ? { categoryId: ref("life_event_categories", category.id) } : {},
    );
  }
  return {
    entities,
    handledTables: TABLES,
    unsupportedRows,
    unsupportedFields,
  };
}
