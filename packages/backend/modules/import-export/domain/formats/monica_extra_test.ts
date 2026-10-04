import { assertEquals } from "../../../../testing/assert.ts";
import { monicaExtra } from "./monica_extra.ts";

Deno.test("Monica extra rows preserve money, references, profile context and source timestamps", () => {
  const result = monicaExtra({
    contacts: [{
      id: 1,
      account_id: 9,
      gender_id: 2,
      created_at: "2020-01-01 12:00:00",
      first_met_additional_info: "At school",
      first_met_through_contact_id: 3,
    }, { id: 3, account_id: 9 }],
    genders: [{ id: 2, account_id: 9, name: "Custom", type: "O" }],
    tags: [{ id: 5, account_id: 9, name: "Friends", name_slug: "friends" }],
    contact_tag: [{ account_id: 9, contact_id: 1, tag_id: 5 }],
    pets: [{
      id: 6,
      account_id: 9,
      contact_id: 1,
      pet_category_id: 3,
      name: "Mittens",
    }],
    debts: [{
      id: 7,
      account_id: 9,
      contact_id: 1,
      in_debt: "yes",
      status: "complete",
      amount: 12345,
      currency_id: 5,
      updated_at: "2022-02-03 04:05:06",
    }],
    activities: [{ id: 8, account_id: 9 }],
    journal_entries: [{
      id: 9,
      account_id: 9,
      date: "2022-02-03",
      journalable_id: 8,
      journalable_type: "App\\Models\\Contact\\Activity",
    }],
  }, { sourceProfile: "sql_export" });
  if (typeof result === "string") throw new Error(result);
  const debt = result.entities.find((e) => e.sourceTable === "debts")!;
  assertEquals(debt.data.amount, "123.45");
  assertEquals(debt.data.currencyCode, "RUB");
  assertEquals(debt.data.direction, "i_owe");
  assertEquals(debt.data.status, "settled");
  assertEquals(debt.data.settledAt, "2022-02-03T04:05:06.000Z");
  assertEquals(debt.references?.personId, { table: "contacts", key: "1" });
  const meeting = result.entities.find((e) => e.data.kind === "first_meeting")!;
  assertEquals(meeting.data.notes, "At school");
  assertEquals(meeting.references?.introducedById, {
    table: "contacts",
    key: "3",
  });
  assertEquals(
    result.entities.find((e) => e.data.kind === "profile")?.data.createdAt,
    "2020-01-01T12:00:00.000Z",
  );
  assertEquals(
    result.entities.find((e) => e.data.kind === "pet_category")?.data.name,
    "cat",
  );
  assertEquals(
    result.entities.find((e) => e.data.kind === "journal_item")?.references,
    { activityId: { table: "activities", key: "8" } },
  );
});

Deno.test("Monica extra rows reject cross-account references and stage unknown money for review", () => {
  const result = monicaExtra({
    contacts: [{ id: 1, account_id: 1 }],
    pets: [{ id: 2, account_id: 2, contact_id: 1 }],
    debts: [{
      id: 3,
      account_id: 1,
      contact_id: 1,
      in_debt: "no",
      status: "inprogress",
      amount: 3,
      currency_id: 999,
    }],
  });
  if (typeof result === "string") throw new Error(result);
  assertEquals(
    result.entities.filter((e) => ["pets", "debts"].includes(e.sourceTable))
      .map((e) => e.data.unresolvedCurrency),
    [true],
  );
  assertEquals(result.unsupportedRows, { pets: 1 });
});

Deno.test("Monica extra money keeps JSON decimal strings exact and refuses unsafe SQL numbers", () => {
  const tables = {
    contacts: [{ id: 1 }],
    debts: [{
      id: 1,
      contact_id: 1,
      in_debt: "no",
      status: "inprogress",
      amount: "123456789012345.6789",
      currency_id: 2,
    }],
  };
  const result = monicaExtra(tables);
  if (typeof result === "string") throw new Error(result);
  assertEquals(
    result.entities.find((e) => e.data.kind === "debt")?.data.amount,
    "123456789012345.6789",
  );
  const invalid = monicaExtra({
    ...tables,
    debts: [{ ...tables.debts[0], amount: Number.MAX_SAFE_INTEGER + 1 }],
  }, { sourceProfile: "sql_export" });
  if (typeof invalid === "string") throw new Error(invalid);
  assertEquals(invalid.unsupportedRows.debts, 1);
});

Deno.test("Monica extra imports address labels, missing gallery files, modules and event vocabularies", () => {
  const result = monicaExtra({
    contacts: [{
      id: 1,
      account_id: 9,
      avatar_source: "photo",
      avatar_photo_id: 2,
    }],
    places: [{
      id: 4,
      account_id: 9,
      street: "1 Example Road",
      latitude: 12.5,
      longitude: -34.6,
    }],
    addresses: [{
      id: 5,
      account_id: 9,
      contact_id: 1,
      place_id: 4,
      name: "Home",
    }],
    photos: [{
      id: 2,
      account_id: 9,
      original_filename: "portrait.png",
      filesize: 100,
      mime_type: "image/png",
    }],
    contact_photo: [{ contact_id: 1, photo_id: 2 }],
    modules: [{ id: 6, account_id: 9, key: "pets", active: 0, delible: 1 }],
    life_event_categories: [{ id: 7, account_id: 9, name: "Career" }],
    life_event_types: [{
      id: 8,
      account_id: 9,
      life_event_category_id: 7,
      name: "New job",
      specific_information: '{"fields":["company"]}',
    }],
  });
  if (typeof result === "string") throw new Error(result);
  assertEquals(result.unsupportedRows, {});
  assertEquals(
    result.entities.find((e) => e.data.kind === "address")?.data.displayName,
    "Home",
  );
  assertEquals(
    result.entities.find((e) => e.data.kind === "location")?.data.latitude,
    12.5,
  );
  assertEquals(
    result.entities.find((e) => e.data.kind === "avatar")?.references?.fileId,
    { table: "photos", key: "2" },
  );
  assertEquals(
    result.entities.find((e) => e.data.kind === "person_photo")?.references
      ?.personId,
    { table: "contacts", key: "1" },
  );
  assertEquals(
    result.entities.find((e) => e.data.kind === "profile_module")?.data.enabled,
    false,
  );
  assertEquals(
    result.entities.find((e) => e.data.kind === "life_event_type")?.data
      .informationSchema,
    { fields: ["company"] },
  );
});

Deno.test("Monica extra reports invalid state and cross-account journal, address and photo rows", () => {
  const result = monicaExtra({
    contacts: [{ id: 1, account_id: 1 }],
    activities: [{ id: 2, account_id: 2 }],
    journal_entries: [{
      id: 3,
      account_id: 1,
      journalable_id: 2,
      journalable_type: "Activity",
      date: "2020-01-01",
    }],
    addresses: [{ id: 5, contact_id: 1, account_id: 1, place_id: 9 }],
    photos: [{
      id: 2,
      account_id: 2,
      original_filename: "other.png",
      filesize: 100,
    }],
    contact_photo: [{ contact_id: 1, photo_id: 2 }],
    debts: [{
      id: 6,
      contact_id: 1,
      account_id: 1,
      amount: 3,
      currency_id: 2,
      in_debt: "maybe",
      status: "open",
    }],
  });
  if (typeof result === "string") throw new Error(result);
  assertEquals(result.unsupportedRows, {
    addresses: 1,
    debts: 1,
    journal_entries: 1,
    contact_photo: 1,
  });
  assertEquals(typeof monicaExtra({ pets: [null] }), "string");
});

Deno.test("Monica SQL debts without a currency retain raw minor units pending selection", () => {
  const result = monicaExtra({
    contacts: [{ id: 1 }],
    debts: [{
      id: 1,
      contact_id: 1,
      in_debt: "no",
      status: "inprogress",
      amount: "12345",
      currency_id: null,
    }],
  }, { sourceProfile: "sql_export" });
  if (typeof result === "string") throw new Error(result);
  assertEquals(
    result.entities.find((e) => e.data.kind === "debt")?.data.amount,
    null,
  );
  assertEquals(
    result.entities.find((e) => e.data.kind === "debt")?.data.currencyCode,
    null,
  );
  assertEquals(result.unsupportedRows, {});
});

function extra(
  tables: Readonly<Record<string, unknown>>,
  sourceProfile: "sql_export" | "json_export" = "json_export",
) {
  const result = monicaExtra(tables, { sourceProfile });
  if (typeof result === "string") throw new Error(result);
  return result;
}

Deno.test("Monica SQL monetary precision follows source currencies without floating point rounding", () => {
  const fixtures = [
    { currency: "JPY", amount: "12345", expected: "12345" },
    { currency: "KWD", amount: "12345", expected: "12.345" },
    { currency: "CLF", amount: "12345", expected: "1.2345" },
    { currency: "EUR", amount: "1", expected: "0.01" },
    { currency: "USD", amount: "0", expected: "0.00" },
    {
      currency: "USD",
      amount: "99999999999999999",
      expected: "999999999999999.99",
    },
  ];
  for (const { currency, amount, expected } of fixtures) {
    const result = extra({
      contacts: [{ id: 1, account_id: 2 }],
      currencies: [{ id: 9, iso: currency.toLowerCase() }],
      debts: [{
        id: 3,
        account_id: 2,
        contact_id: 1,
        amount,
        currency_id: 9,
        in_debt: "no",
        status: "open",
        reason: "Shared bill",
      }],
    }, "sql_export");
    const debt = result.entities.find((e) => e.data.kind === "debt")!;
    assertEquals(debt.data.amount, expected);
    assertEquals(debt.data.currencyCode, currency);
    assertEquals(debt.data.reason, "Shared bill");
    assertEquals(result.unsupportedRows, {});
  }
  const namedCurrency = extra({
    contacts: [{ id: 1 }],
    currencies: [{ id: 8, code: "GBP" }],
    debts: [{
      id: 1,
      contact_id: 1,
      currency_id: 8,
      amount: 1.25,
      status: "cancelled",
      in_debt: "yes",
    }],
  });
  assertEquals(namedCurrency.entities[0]?.data.amount, "1.25");
  assertEquals(namedCurrency.entities[0]?.data.status, "cancelled");
  assertEquals(namedCurrency.entities[0]?.data.settledAt, null);
});

Deno.test("Monica money rejects invalid precision, overflow, unknown states and untraceable settlements", () => {
  const base = {
    id: 1,
    contact_id: 1,
    currency_code: "USD",
    amount: "1",
    status: "open",
    in_debt: "yes",
  };
  for (const sourceProfile of ["sql_export", "json_export"] as const) {
    for (
      const amount of [
        NaN,
        Infinity,
        -1,
        "-1",
        "",
        "one",
        "1e3",
        "123456789012345678901",
        null,
        undefined,
      ]
    ) {
      const result = extra({
        contacts: [{ id: 1 }],
        debts: [{ ...base, amount }],
      }, sourceProfile);
      assertEquals(result.entities, []);
      assertEquals(result.unsupportedRows, { debts: 1 });
    }
  }
  for (const amount of ["1.23456", "1000000000000000"]) {
    assertEquals(
      extra({ contacts: [{ id: 1 }], debts: [{ ...base, amount }] })
        .unsupportedRows,
      { debts: 1 },
    );
  }
  for (
    const amount of ["1.5", "9999999999999999999", Number.MAX_SAFE_INTEGER + 1]
  ) {
    assertEquals(
      extra(
        { contacts: [{ id: 1 }], debts: [{ ...base, amount }] },
        "sql_export",
      ).unsupportedRows,
      { debts: 1 },
    );
  }
  for (
    const patch of [{ status: "unknown" }, { status: "settled" }, {
      status: "completed",
      updated_at: "2020-13-01",
    }, { contact_id: 9 }]
  ) {
    assertEquals(
      extra({ contacts: [{ id: 1 }], debts: [{ ...base, ...patch }] })
        .unsupportedRows,
      { debts: 1 },
    );
  }
  const settled = extra({
    contacts: [{ id: 1 }],
    debts: [{
      ...base,
      status: "completed",
      settled_at: "2020-03-04T06:07:08+02:00",
      updated_at: "2021-01-01T00:00:00Z",
    }],
  });
  assertEquals(settled.entities[0]?.data.settledAt, "2020-03-04T04:07:08.000Z");
  assertEquals(settled.entities[0]?.data.updatedAt, "2021-01-01T00:00:00.000Z");
});

Deno.test("Monica gift ideas and history preserve optional recipient, money and arbitrary source status", () => {
  const result = extra({
    contacts: [{ id: 1, account_id: 2 }, { id: 3, account_id: 2 }, {
      id: 4,
      account_id: 5,
    }],
    gifts: [
      {
        id: 1,
        account_id: 2,
        contact_id: 1,
        name: "Book",
        is_for: 3,
        amount: "19.9900",
        currency_code: "eur",
        status: "received",
        url: "https://example.test/book",
        comment: "First edition",
        date: "2021-01-02",
      },
      {
        id: 2,
        account_id: 2,
        contact_id: 1,
        name: "Tickets",
        is_for: 0,
        amount: null,
      },
      {
        id: 3,
        account_id: 2,
        contact_id: 1,
        name: "Sketch",
        amount: undefined,
        status: "custom-history",
      },
      { id: 4, account_id: 2, contact_id: 1, name: "Foreign", is_for: 4 },
      { id: 5, account_id: 2, contact_id: 1, name: " " },
    ],
  });
  const gift = result.entities.find((e) => e.sourcePrimaryKey === "1")!;
  assertEquals(gift.references?.recipientId, { table: "contacts", key: "3" });
  assertEquals(gift.data.amount, "19.9900");
  assertEquals(gift.data.status, "received");
  assertEquals(gift.data.eventAt, "2021-01-02T00:00:00.000Z");
  assertEquals(gift.data.url, "https://example.test/book");
  assertEquals(gift.data.comment, "First edition");
  const idea = result.entities.find((e) => e.sourcePrimaryKey === "2")!;
  assertEquals(idea.references, { personId: { table: "contacts", key: "1" } });
  assertEquals(idea.data.status, "idea");
  assertEquals(idea.data.amount, null);
  assertEquals(idea.data.currencyCode, null);
  assertEquals(idea.data.eventAt, null);
  assertEquals(
    result.entities.find((e) => e.sourcePrimaryKey === "3")?.data.status,
    "custom-history",
  );
  assertEquals(result.unsupportedRows, { gifts: 2 });
});

Deno.test("Monica journal maps posts and ratings into typed references without duplicating their contents", () => {
  const result = extra({
    entries: [
      {
        id: 1,
        post: "A good day",
        title: "Tuesday",
        date: "2020-01-01T12:00:00",
      },
      { id: 2, body: "Older post", created_at: "2020-01-02" },
      { id: 3, body: "Undated post" },
      { id: 4, post: "" },
      { id: 5, body: "x".repeat(10001) },
    ],
    days: [
      { id: 6, date: "2020-01-01", rate: 3, comment: "Sunny" },
      { id: 7, date: "2020-01-02", rating: 0 },
      { id: 8, date: "not a date", rating: 4 },
      { id: 9, date: "2020-01-03", rating: 1.5 },
    ],
    journal_entries: [{
      id: 1,
      journalable_type: "App\\Models\\Journal\\Entry",
      journalable_id: 1,
      date: "2020-02-01",
    }, {
      id: 2,
      journalable_type: "Day",
      journalable_id: 6,
      date: "2020-01-01",
    }, {
      id: 3,
      journalable_type: "Note",
      journalable_id: 1,
      date: "2020-01-01",
    }, {
      id: 4,
      journalable_type: "Entry",
      journalable_id: 1,
      date: "2020-15-15",
    }],
  });
  const post = result.entities.find((e) =>
    e.sourceTable === "entries" && e.sourcePrimaryKey === "1"
  )!;
  assertEquals(post.data.body, "A good day");
  assertEquals(post.data.title, "Tuesday");
  assertEquals(post.data.occurredAt, "2020-01-01T12:00:00.000Z");
  assertEquals(
    result.entities.find((e) =>
      e.sourceTable === "entries" && e.sourcePrimaryKey === "2"
    )?.data.occurredAt,
    "2020-01-02T00:00:00.000Z",
  );
  assertEquals(
    result.entities.find((e) =>
      e.sourceTable === "entries" && e.sourcePrimaryKey === "3"
    )?.data.occurredAt,
    null,
  );
  const indexes = result.entities.filter((e) =>
    e.sourceTable === "journal_entries"
  );
  assertEquals(indexes.map((e) => e.references), [{
    postId: { table: "entries", key: "1" },
  }, { dayId: { table: "days", key: "6" } }]);
  assertEquals(indexes.map((e) => e.data.body), [undefined, undefined]);
  assertEquals(
    result.entities.find((e) =>
      e.sourceTable === "days" && e.sourcePrimaryKey === "7"
    )?.data.rating,
    0,
  );
  assertEquals(result.unsupportedRows, {
    entries: 2,
    days: 2,
    journal_entries: 2,
  });
});

Deno.test("Monica profile references report dangling identities and retain optional source fields without invented values", () => {
  const result = extra({
    contacts: [
      {
        id: 1,
        account_id: 8,
        gender_id: 99,
        first_met_through_contact_id: 99,
        updated_at: "2020-01-01",
        birthday_special_date_id: 1,
        deceased_special_date_id: 2,
        first_met_special_date_id: 3,
      },
      { id: 2, account_id: 8, gender_id: 99, first_met_through_contact_id: 99 },
      { id: 3, account_id: 8, first_met_through_contact_id: 3 },
      {
        id: 4,
        account_id: 8,
        first_met_special_date_id: 3,
        avatar_source: "photo",
        avatar_photo_id: 999,
      },
    ],
    special_dates: [{ id: 1, account_id: 8, contact_id: 1 }, {
      id: 2,
      account_id: 8,
      contact_id: 1,
    }, { id: 3, account_id: 8, contact_id: 1 }],
    genders: [{ id: 8, account_id: 8, name: "Custom" }, { id: 9, name: "" }, {
      name: "Missing identity",
    }],
    pet_categories: [{ id: 42, name: "Ferret", is_common: 1 }, {
      id: 43,
      name: "",
    }, { name: "Missing identity" }],
    pets: [
      { id: 1, account_id: 8, contact_id: 1, pet_category_id: 42 },
      { id: 2, account_id: 8, contact_id: 1, pet_category_id: 999 },
      { id: 3, account_id: 8, contact_id: 1, pet_category_id: 999 },
      { id: 4, account_id: 8, contact_id: 1 },
    ],
    tags: [{
      id: 1,
      account_id: 8,
      name: "Friends",
      description: "People I know",
    }, { id: 2, name: "" }],
    contact_tag: [{ account_id: 8, contact_id: 999, tag_id: 1 }, {
      account_id: 8,
      contact_id: 1,
      tag_id: 999,
    }],
  });
  assertEquals(result.unsupportedFields, {
    "contacts.first_met_through_contact_id": 2,
    "pets.pet_category_id": 3,
  });
  assertEquals(result.unsupportedRows, {
    genders: 2,
    pet_categories: 2,
    tags: 1,
    contact_tag: 2,
  });
  assertEquals(
    result.entities.filter((e) => e.sourceTable === "special_dates").map((e) =>
      e.data.dateKind
    ),
    ["birthday", "deceased", "first_met"],
  );
  const self = result.entities.find((e) =>
    e.sourceTable === "contacts_first_meeting" && e.sourcePrimaryKey === "3"
  )!;
  assertEquals(self.references, { personId: { table: "contacts", key: "3" } });
  assertEquals(
    result.entities.find((e) =>
      e.sourceTable === "pets" && e.sourcePrimaryKey === "2"
    )?.references,
    { personId: { table: "contacts", key: "1" } },
  );
  assertEquals(
    result.entities.find((e) => e.data.kind === "tag")?.data.slug,
    "monica-1",
  );
  assertEquals(
    result.entities.find((e) => e.data.kind === "tag")?.data.description,
    "People I know",
  );
  assertEquals(
    result.entities.find((e) => e.data.kind === "gender")?.data.code,
    null,
  );
});

Deno.test("Monica repeated source addresses keep multiplicity and numeric postal codes", () => {
  const result = extra({
    contacts: [{ id: 1 }],
    places: [{
      id: 1,
      street: "Example road",
      city: "Town",
      province: "Region",
      postal_code: 12345,
      country: "GB",
    }, { id: 2, postal_code: null }],
    addresses: [{ id: 1, contact_id: 1, place_id: 1 }, {
      id: 2,
      contact_id: 1,
      place_id: 1,
    }, { id: 3, contact_id: 999, place_id: 1 }],
  });
  const location = result.entities.find((e) =>
    e.sourceTable === "places" && e.sourcePrimaryKey === "1"
  )!;
  assertEquals(location.data.postalCode, "12345");
  assertEquals(location.data.city, "Town");
  assertEquals(location.data.region, "Region");
  assertEquals(location.data.country, "GB");
  assertEquals(
    result.entities.filter((e) => e.sourceTable === "addresses").map((
      e,
    ) => [e.data.duplicateOrdinal, e.data.displayName]),
    [[0, null], [1, null]],
  );
  assertEquals(result.unsupportedRows, { addresses: 1 });
});

Deno.test("Monica media refuses malformed manifests and ambiguous or foreign gallery ownership", () => {
  const result = extra({
    contacts: [{ id: 1, account_id: 1 }, { id: 2, account_id: 1 }, {
      id: 2,
      account_id: 2,
    }],
    photos: [
      { id: 1, account_id: 1, original_filename: "photo.png", filesize: 0 },
      { id: 2, original_filename: "", filesize: 1 },
      { id: 3, original_filename: "bad.png", filesize: 0.5 },
      { id: 4, original_filename: "bad.png", filesize: -1 },
    ],
    contact_photo: [
      { account_id: 1, contact_id: 1, photo_id: 1 },
      { contact_id: 2, photo_id: 1 },
      { contact_id: 999, photo_id: 1 },
      { account_id: 9, contact_id: 1, photo_id: 1 },
    ],
  });
  assertEquals(result.unsupportedRows, { photos: 3, contact_photo: 3 });
  const photo = result.entities.find((e) => e.sourceTable === "photos")!;
  assertEquals(photo.data.byteSize, 0);
  assertEquals(photo.data.mimeType, null);
  assertEquals(
    result.entities.filter((e) => e.data.kind === "person_photo").length,
    1,
  );
});

Deno.test("Monica workspace catalogs preserve seed metadata, information schemas and module flags", () => {
  const result = extra({
    modules: [
      {
        id: 1,
        key: "pets",
        name: "Pets",
        translation_key: "profile.pets",
        active: true,
        delible: true,
      },
      { id: 2, key: "notes", active: 1, delible: 0 },
      { id: 3, key: "" },
    ],
    life_event_categories: [
      {
        id: 1,
        default_life_event_category_key: "career",
        core_monica_data: true,
      },
      { id: 2, translation_key: "family", core_monica_data: 1 },
      { id: 3 },
    ],
    life_event_types: [
      {
        id: 1,
        life_event_category_id: 1,
        default_life_event_type_key: "promotion",
        core_monica_data: true,
        specific_information_structure: { fields: ["company"] },
      },
      {
        id: 2,
        translation_key: "custom",
        core_monica_data: 1,
        specific_information_structure: "malformed source JSON",
      },
      { id: 3 },
      { id: 4, life_event_category_id: 999 },
    ],
  });
  const module = result.entities.find((e) =>
    e.sourceTable === "modules" && e.sourcePrimaryKey === "1"
  )!;
  assertEquals([
    module.data.name,
    module.data.translationKey,
    module.data.enabled,
    module.data.canDelete,
  ], ["Pets", "profile.pets", true, true]);
  const category = result.entities.find((e) =>
    e.sourceTable === "life_event_categories" && e.sourcePrimaryKey === "1"
  )!;
  assertEquals([
    category.data.name,
    category.data.seedKey,
    category.data.isSystem,
  ], ["career", "career", true]);
  const type = result.entities.find((e) =>
    e.sourceTable === "life_event_types" && e.sourcePrimaryKey === "1"
  )!;
  assertEquals([
    type.data.seedKey,
    type.data.isSystem,
    type.data.informationSchema,
  ], ["promotion", true, { fields: ["company"] }]);
  const malformed = result.entities.find((e) =>
    e.sourceTable === "life_event_types" && e.sourcePrimaryKey === "2"
  )!;
  assertEquals(malformed.data.informationSchema, null);
  assertEquals(
    (malformed.data.source as Record<string, unknown>)
      .specific_information_structure,
    "malformed source JSON",
  );
  assertEquals(result.unsupportedRows, {
    modules: 1,
    life_event_categories: 1,
    life_event_types: 1,
  });
});

Deno.test("Monica related table containers must be arrays of objects", () => {
  for (
    const table of [
      "genders",
      "pets",
      "gifts",
      "debts",
      "entries",
      "days",
      "photos",
      "modules",
      "places",
    ]
  ) {
    for (const invalid of [null, "table", {}, [null], ["row"], [[]]]) {
      assertEquals(
        monicaExtra({ [table]: invalid }),
        "Every related Monica table must contain objects.",
      );
    }
  }
});

Deno.test("Monica custom pet category names cannot leak into the global catalog", () => {
  const result = monicaExtra({
    contacts: [{ id: 1, account_id: 1 }],
    pet_categories: [{ id: 30, name: "Private workspace taxonomy" }],
    pets: [{
      id: 1,
      account_id: 1,
      contact_id: 1,
      pet_category_id: 30,
      name: "Companion",
    }],
  });
  if (typeof result === "string") throw new Error(result);
  assertEquals(
    result.entities.some((e) => e.data.kind === "pet_category"),
    false,
  );
  assertEquals(
    result.entities.find((e) => e.data.kind === "pet")?.references?.categoryId,
    undefined,
  );
  assertEquals(result.unsupportedRows.pet_categories, 1);
  assertEquals(result.unsupportedFields["pets.pet_category_id"], 1);
});

Deno.test("legacy profile module keys control canonical sections and consolidate relationship visibility", () => {
  const result = extra({
    modules: [
      { id: 1, key: "contact_information", active: 0 },
      { id: 2, key: "how_you_met", active: 0 },
      { id: 3, key: "work_information", active: 1 },
      { id: 4, key: "food_preferences", active: 0 },
      { id: 5, key: "phone_calls", active: 0 },
      { id: 6, key: "love_relationships", active: 0 },
      { id: 7, key: "family_relationships", active: 1 },
      { id: 8, key: "other_relationships", active: 0 },
      { id: 9, key: "documents", active: 0 },
      { id: 10, key: "unknown", active: 1 },
    ],
  });
  const modules = result.entities.filter((e) =>
    e.data.kind === "profile_module"
  );
  assertEquals(modules.map((e) => e.data.key), [
    "contact-methods",
    "first-meeting",
    "work",
    "food-preferences",
    "calls",
    "relationships",
    "relationships",
    "relationships",
  ]);
  assertEquals(modules.slice(5).every((e) => e.data.enabled === true), true);
  assertEquals(modules[0]!.data.enabled, false);
  assertEquals(result.unsupportedRows.modules, 2);
  assertEquals(
    result.unsupportedFields["modules.relationship_visibility_consolidated"],
    3,
  );
});

Deno.test("unresolved debt currencies and nonnull gender references remain staged for explicit review", () => {
  const result = monicaExtra({
    contacts: [{ id: 1, account_id: 1, gender_id: 999 }],
    debts: [null, 999].map((currency_id, index) => ({
      id: index + 1,
      account_id: 1,
      contact_id: 1,
      currency_id,
      amount: "9007199254740993",
      in_debt: "yes",
      status: "open",
    })),
  }, { sourceProfile: "sql_export" });
  if (typeof result === "string") throw new Error(result);
  assertEquals(
    result.entities.filter((e) => e.data.kind === "debt").map((e) =>
      e.data.rawAmount
    ),
    ["9007199254740993", "9007199254740993"],
  );
  assertEquals(
    result.entities.find((e) => e.data.kind === "profile")?.data
      .unresolvedGender,
    "999",
  );
  assertEquals(result.unsupportedFields?.["contacts.gender_id"], undefined);
  assertEquals(result.unsupportedRows?.debts, undefined);
});
