import { assert, assertEquals } from "../../../../testing/assert.ts";
import { parseMonicaSource } from "./monica_source.ts";
import { stageContacts } from "../import_rules.ts";

const limits = { maxAttachmentBytes: 10_000_000 };
const sql = (text: string) =>
  parseMonicaSource({ format: "monica-sql", text }, limits);

Deno.test("[IMPORT-001] Monica SQL literals normalize without execution or credentials", () => {
  const parsed = sql(String.raw`# Synthetic Monica export
SET FOREIGN_KEY_CHECKS=0;
INSERT IGNORE INTO \`contacts\` (\`id\`,\`first_name\`,\`last_name\`,\`uuid\`,\`avatar_file_name\`,\`description\`) VALUES
(1,'Ada','O\'Neil',NULL,NULL,'line\nsemi; comma, parens() and \\ path'),
(2,'Zoë','D''Angelo',NULL,NULL,'Unicode 🌍');
INSERT INTO \`users\` (\`password\`,\`google2fa_secret\`) VALUES ('discard-password','discard-factor');
INSERT INTO \`accounts\` (\`api_key\`) VALUES ('discard-key');
SET FOREIGN_KEY_CHECKS=1;`.replaceAll("\\`", "`"));
  assert(typeof parsed !== "string", "SQL should parse");
  assertEquals(parsed.contacts[0]?.last_name, "O'Neil");
  assertEquals(parsed.contacts[1]?.last_name, "D'Angelo");
  assertEquals(
    parsed.contacts[0]?.description,
    "line\nsemi; comma, parens() and \\ path",
  );
  const staged = stageContacts(parsed, () => crypto.randomUUID());
  assert(typeof staged !== "string", "nullable columns should stage");
  assertEquals(staged.contacts.length, 2);
  assertEquals(staged.missingFiles, 0);
  assert(!JSON.stringify(parsed).includes("discard-"), "credentials discarded");
});

Deno.test("[IMPORT-001] SQL refuses expressions, commands, malformed and unbounded data", () => {
  for (
    const text of [
      String.raw`INSERT INTO contacts (id,first_name) VALUES (1,'bad\0value');`,
      "DROP TABLE contacts;",
      "SELECT 1;",
      "SET sql_mode='ANSI_QUOTES';",
      "INSERT INTO contacts (id,first_name) VALUES (1,CONCAT('A','B'));",
      "INSERT INTO contacts (id,first_name) VALUES (1,'A') ON DUPLICATE KEY UPDATE id=2;",
      "INSERT INTO contacts VALUES (1,'A');",
      "INSERT INTO contacts (id,id) VALUES (1,2);",
      "INSERT INTO contacts (id,first_name) VALUES (1);",
      "INSERT INTO contacts (id,first_name) VALUES (1,'unfinished);",
      "INSERT INTO contacts (id,first_name) VALUES (1,'A'); /* unfinished",
      "/*! DROP TABLE contacts */;",
      "INSERT INTO contacts (id,first_name) VALUES (1,'A'); SELECT 'private-value';",
      "x".repeat(1_500_001),
    ]
  ) {
    const parsed = sql(text);
    assert(typeof parsed === "string", "unsafe SQL refused");
    assert(!parsed.includes("private-value"), "errors omit source values");
  }
});

Deno.test("[IMPORT-001] SQL related rows use existing rich contact fields and report losses", async () => {
  const parsed = sql(
    await Deno.readTextFile(new URL("./fixtures/monica.sql", import.meta.url)),
  );
  assert(typeof parsed !== "string", "synthetic export should parse");
  const staged = stageContacts(parsed, () => crypto.randomUUID());
  assert(typeof staged !== "string", "synthetic export should stage");
  const contact = staged.contacts[0]!;
  // Read the new normalized field dynamically so RED fails on behavior.
  const details =
    (contact as unknown as { contact: Record<string, unknown> }).contact;
  assertEquals(details.emails, ["ada@example.test"]);
  assertEquals(details.phones, ["+1 555 0100"]);
  assertEquals(details.jobTitle, "Engineer");
  assertEquals(details.organization, "Example Co");
  assertEquals(details.addresses, []);
  const location = parsed.businessEntities?.find((e) =>
    e.data.kind === "location"
  )?.data;
  assertEquals([
    location?.street,
    location?.city,
    location?.region,
    location?.postalCode,
    location?.country,
  ], ["1 Example Lane", "Sampleton", "Region", "AB1", "US"]);
  assertEquals(details.dates, [{
    kind: "birthday",
    precision: "month_day",
    month: 2,
    day: 29,
    isAgeBased: false,
  }, {
    kind: "first_met",
    day: 3,
    month: 4,
    precision: "full",
    year: 2020,
    isAgeBased: false,
  }]);
  assertEquals(
    parsed.businessEntities?.filter((e) => e.data.kind === "note").map((e) =>
      e.data.body
    ),
    [
      "First note; with comma, and (parentheses).",
      "Second note.",
    ],
  );
  const photo = parsed.businessEntities?.find((e) => e.data.kind === "photo")
    ?.data;
  assertEquals(photo?.filename, "portrait.png");
  assertEquals(photo?.byteSize, 123);
  assertEquals(staged.missingFiles, 0);
  assert(
    !JSON.stringify(staged).includes("synthetic-password"),
    "password discarded",
  );
  assert(
    !JSON.stringify(staged).includes("synthetic-recovery"),
    "recovery discarded",
  );
});

Deno.test("[IMPORT-001] numeric Monica postal codes remain address text", () => {
  const parsed = sql(
    "INSERT INTO contacts (id,first_name) VALUES (1,'Ada'); INSERT INTO addresses (id,contact_id,place_id) VALUES (2,1,3); INSERT INTO places (id,postal_code) VALUES (3,12345);",
  );
  assert(typeof parsed !== "string", "numeric postal code should parse");
  const staged = stageContacts(parsed, () => crypto.randomUUID());
  assert(typeof staged !== "string", "numeric postal code should stage");
  assertEquals(staged.contacts[0]?.contact?.addresses, []);
  assertEquals(
    parsed.businessEntities?.find((e) => e.data.kind === "location")?.data
      .postalCode,
    "12345",
  );
});

Deno.test("[IMPORT-001] joins stay within source accounts and orphaned rows are reported", () => {
  const parsed = sql(
    "INSERT INTO contacts (id,account_id,first_name,birthday_special_date_id,avatar_photo_id,avatar_source) VALUES (1,7,'Ada',8,9,'photo'); INSERT INTO notes (contact_id,account_id,body) VALUES (1,8,'foreign-note'); INSERT INTO special_dates (id,account_id,contact_id,date) VALUES (8,8,1,'2000-01-01'); INSERT INTO photos (id,account_id,original_filename,filesize) VALUES (9,8,'foreign.png',10);",
  );
  assert(typeof parsed !== "string", "export should parse");
  assertEquals(parsed.orphans, 2);
  assertEquals(parsed.unsupportedRows?.notes, 1);
  assertEquals(
    parsed.unsupportedFields?.["contacts.birthday_special_date_id"],
    1,
  );
  assertEquals(parsed.unsupportedFields?.["contacts.avatar_photo_id"], 1);
  assertEquals(parsed.notes?.size, 0);
  assertEquals(parsed.attachments.size, 0);
});

Deno.test("[IMPORT-001] age-only dates keep an approximate year without fabricated birthdays", () => {
  const parsed = sql(
    "INSERT INTO contacts (id,first_name,birthday_special_date_id) VALUES (1,'Ada',8); INSERT INTO special_dates (id,contact_id,is_age_based,is_year_unknown,date) VALUES (8,1,1,0,'1980-01-01');",
  );
  assert(typeof parsed !== "string", "export should parse");
  assertEquals(parsed.details?.get("1")?.dates, [{
    kind: "birthday",
    precision: "year",
    year: 1980,
    isAgeBased: true,
    isYearApproximate: true,
  }]);
});

Deno.test("[IMPORT-001] oversized notes are rejected without truncation or private error text", () => {
  const parsed = sql(
    `INSERT INTO contacts (id,first_name) VALUES (1,'Ada'); INSERT INTO notes (contact_id,body) VALUES (1,'${
      "x".repeat(10_001)
    }');`,
  );
  assertEquals(
    parsed,
    "A Monica note exceeds the 10,000 character limit; no notes were truncated.",
  );
});

Deno.test("[IMPORT-001] data parser supports comments and literals but bounds rows and columns", () => {
  const parsed = sql(
    "/* harmless */ INSERT INTO contacts (id,first_name,description,is_active) VALUES (9007199254740993,\"Ada\",'a\\tb\\rc',TRUE); -- done\n",
  );
  assert(typeof parsed !== "string", "literal syntax should parse");
  assertEquals(parsed.contacts[0]?.id, "9007199254740993");
  assertEquals(parsed.contacts[0]?.description, "a\tb\rc");
  assertEquals(parsed.contacts[0]?.is_active, true);
  for (
    const text of [
      "INSERT INTO notes (body) VALUES ('unused');",
      "INSERT INTO contacts (id,first_name) VALUES " +
      Array.from({ length: 501 }, (_, index) => `(${index},'A')`).join(",") +
      ";",
      "INSERT INTO contacts (id,first_name) VALUES (1,'A'); INSERT INTO ignored (id) VALUES " +
      Array.from({ length: 10_000 }, () => "(1)").join(",") + ";",
      "INSERT INTO contacts (" +
      Array.from({ length: 101 }, (_, index) => `c${index}`).join(",") +
      ") VALUES (1);",
      "INSERT INTO contacts (id,first_name) VALUES (1,'A'); SET FOREIGN_KEY_CHECKS=2;",
    ]
  ) assert(typeof sql(text) === "string", "bounded source rejected");
});

Deno.test("[IMPORT-001] numeric Monica phone values remain contact text", () => {
  const parsed = sql(
    "INSERT INTO contacts (id,first_name) VALUES (1,'Ada'); INSERT INTO contact_field_types (id,type) VALUES (2,'phone'); INSERT INTO contact_fields (contact_id,contact_field_type_id,data) VALUES (1,2,15550100);",
  );
  assert(typeof parsed !== "string", "numeric phone should parse");
  assertEquals(parsed.details?.get("1")?.phones, ["15550100"]);
});

Deno.test("[IMPORT-001] numeric phone and postal lexemes preserve plus signs and leading zeroes", () => {
  const parsed = sql(
    "INSERT INTO contacts (id,first_name,is_starred) VALUES (01,'Ada',1); INSERT INTO contact_field_types (id,type) VALUES (02,'phone'); INSERT INTO contact_fields (contact_id,contact_field_type_id,data) VALUES (1,2,+15550100),(1,2,02071234567); INSERT INTO addresses (contact_id,place_id) VALUES (1,03); INSERT INTO places (id,postal_code) VALUES (3,02108);",
  );
  assert(typeof parsed !== "string", "numeric text should parse");
  assertEquals(parsed.contacts[0]?.id, 1);
  assertEquals(parsed.contacts[0]?.is_starred, 1);
  assertEquals(parsed.details?.get("1")?.phones, ["+15550100", "02071234567"]);
  assertEquals(parsed.details?.get("1")?.addresses, [{ postalCode: "02108" }]);
});

Deno.test("[IMPORT-001] numeric literals in consumed text fields retain their original spelling", () => {
  const parsed = sql(
    "INSERT INTO contacts (id,first_name,description,job,company,avatar_source,avatar_photo_id) VALUES (1,123,00123,456,0789,'photo',2); INSERT INTO notes (contact_id,body) VALUES (1,456); INSERT INTO addresses (contact_id,place_id) VALUES (1,3); INSERT INTO places (id,street,city,province,country) VALUES (3,001,+002,003,004); INSERT INTO photos (id,original_filename,filesize) VALUES (2,00123,00100);",
  );
  assert(typeof parsed !== "string", "numeric text should parse");
  assertEquals(parsed.contacts[0]?.first_name, "123");
  assertEquals(parsed.contacts[0]?.description, "00123");
  assertEquals(
    parsed.businessEntities?.filter((e) => e.data.kind === "note").map((e) =>
      e.data.body
    ),
    ["456"],
  );
  const staged = stageContacts(parsed, () => crypto.randomUUID());
  assert(typeof staged !== "string", "numeric names should stage");
  assertEquals(staged.contacts[0]?.givenName, "123");
  assertEquals(staged.contacts[0]?.contact?.jobTitle, "456");
  assertEquals(staged.contacts[0]?.contact?.organization, "0789");
  assertEquals(staged.contacts[0]?.contact?.addresses, [{
    street: "001",
    city: "+002",
    region: "003",
    country: "004",
  }]);
  assertEquals(
    parsed.businessEntities?.find((e) => e.data.kind === "photo")?.data
      .filename,
    "00123",
  );
  assertEquals(
    parsed.businessEntities?.find((e) => e.data.kind === "photo")?.data
      .byteSize,
    100,
  );
});

Deno.test("[IMPORT-001] Monica custom contact methods retain source type metadata", () => {
  const parsed = sql(
    "INSERT INTO contacts (id,account_id,first_name) VALUES (1,7,'Example'); INSERT INTO contact_field_types (id,account_id,name,type,protocol) VALUES (2,7,'Chat handle','custom','chat'),(3,7,'Work mail','email','mailto'); INSERT INTO contact_fields (contact_id,account_id,contact_field_type_id,data) VALUES (1,7,2,'invented-handle'),(1,7,3,'example@example.test');",
  );
  assert(typeof parsed !== "string", "source parses");
  const details = parsed.details?.get("1") as unknown as {
    contactMethods?: unknown[];
  };
  assertEquals(details?.contactMethods, [
    {
      sourceType: {
        key: "7:2",
        name: "Chat handle",
        kind: "custom",
        protocol: "chat",
      },
      value: "invented-handle",
    },
    {
      sourceType: {
        key: "7:3",
        name: "Work mail",
        kind: "email",
        protocol: "mailto",
      },
      value: "example@example.test",
    },
  ]);
});

Deno.test("SQL sent reminder history is parsed as inert audit history", () => {
  const result = sql(
    "INSERT INTO contacts (id,first_name) VALUES (1,'Example'); INSERT INTO reminders_sent (id,title,sent_date) VALUES (2,'Historical delivery','2020-01-02');",
  );
  assert(typeof result !== "string", "history SQL should parse");
  assertEquals(
    result.businessEntities?.find((e) => e.sourceTable === "reminders_sent")
      ?.data.action,
    "reminder.sent",
  );
});
Deno.test("dry run rejects normalized dependencies discarded by source mapping", () => {
  for (
    const tables of [
      {
        entries: [{ id: 1, post: "" }],
        journal_entries: [{
          id: 1,
          journalable_type: "Entry",
          journalable_id: 1,
          date: "2020-01-01",
        }],
      },
      {
        genders: [{ id: 1, name: "" }],
        contacts: [{ id: 1, first_name: "Example", gender_id: 1 }],
      },
      {
        photos: [{ id: 1, original_filename: "", size: 5 }],
        contacts: [{
          id: 1,
          first_name: "Example",
          avatar_source: "photo",
          avatar_photo_id: 1,
        }],
      },
      {
        contacts: [{
          id: 1,
          first_name: "Example",
          birthday_special_date_id: 1,
          birthday_reminder_id: 1,
        }],
        special_dates: [{ id: 1, contact_id: 1, date: "invalid" }],
        reminders: [{
          id: 1,
          contact_id: 1,
          title: "Birthday",
          initial_date: "2000-01-01",
          frequency_type: "year",
          frequency_number: 1,
        }],
      },
    ]
  ) {
    const result = parseMonicaSource({
      format: "monica-json",
      version: 1,
      tables: { contacts: [{ id: 1, first_name: "Example" }], ...tables },
    }, limits);
    assert(
      typeof result === "string",
      "unresolved graph must be rejected during dry run",
    );
  }
});
