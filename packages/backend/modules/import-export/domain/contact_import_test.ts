import { assert, assertEquals } from "../../../testing/assert.ts";
import {
  contactFingerprint,
  contactImportReport,
  contactLosses,
  credentialName,
  csvMappingProblem,
  importedContact,
  mappedCsvContact,
  personDetails,
  stageSourceContacts,
  suggestedCsvMapping,
} from "./contact_import.ts";
import { canonicalJson } from "./formats/canonical.ts";
import type { SourceContact } from "./formats/contact_source.ts";
import { parseCsv } from "./formats/csv.ts";
import { parseVCardSource } from "./formats/vcard_parse.ts";

const EMPTY: SourceContact = {
  addresses: [],
  dates: [],
  emails: [],
  phones: [],
  urls: [],
};

function same(actual: unknown, expected: unknown, message?: string) {
  assertEquals(canonicalJson(actual), canonicalJson(expected), message);
}

function counter() {
  let next = 0;
  return () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
}

Deno.test("[GAP-050] a contact is named by the best part it carries", () => {
  assertEquals(
    importedContact({
      ...EMPTY,
      familyName: "Hopper",
      fullName: "Grace Hopper",
    })
      ?.givenName,
    "Grace Hopper",
  );
  const familyOnly = importedContact({ ...EMPTY, familyName: "Hopper" });
  assertEquals(familyOnly?.givenName, "Hopper");
  assertEquals(familyOnly?.familyName, undefined, "not Hopper Hopper");
  assertEquals(
    importedContact({ ...EMPTY, emails: [" Grace@Example.COM "] })?.givenName,
    "grace@example.com",
  );
  assertEquals(
    importedContact({ ...EMPTY, phones: ["+1 555 0100"] })?.givenName,
    "+1 555 0100",
  );
  assertEquals(
    importedContact({ ...EMPTY, nickname: "Amazing Grace" })?.nickname,
    undefined,
    "a nickname that became the name is not repeated",
  );
  assertEquals(importedContact({ ...EMPTY, note: "only a note" }), undefined);
  assertEquals(
    importedContact({ ...EMPTY, givenName: "\u0007  " }),
    undefined,
    "control characters and blanks are not a name",
  );
});

Deno.test("[GAP-050] a contact is normalized before it is fingerprinted", async () => {
  const contact = importedContact({
    ...EMPTY,
    addresses: [{ city: " London ", street: "" }, { country: " " }],
    dates: [{ day: 8, kind: "anniversary", month: 7, precision: "month_day" }],
    emails: ["ADA@example.com", "ada@example.com"],
    givenName: " Ada ",
    jobTitle: "Mathematician",
    note: "<b>plain</b>",
    organization: "Society",
    phones: ["+44", "+44"],
    urls: ["https://example.com", "https://example.com"],
  });
  same(contact, {
    addresses: [{ city: "London" }],
    dates: [{
      day: 8,
      kind: "custom",
      label: "Anniversary",
      month: 7,
      precision: "month_day",
    }],
    emails: ["ada@example.com"],
    givenName: "Ada",
    jobTitle: "Mathematician",
    note: "<b>plain</b>",
    organization: "Society",
    phones: ["+44"],
    urls: ["https://example.com"],
  });
  const again = await contactFingerprint(contact!);
  assertEquals(again, await contactFingerprint(contact!));
  assert(
    again !== await contactFingerprint({ ...contact!, givenName: "Adah" }),
    "a changed name changes the fingerprint",
  );
});

Deno.test("[GAP-050] a vCard file stages its UIDs, skips the nameless, imports a duplicate once, and flags a changed UID", async () => {
  const parsed = parseVCardSource(
    [
      "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:a\r\nFN:Ada\r\nEND:VCARD",
      "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:a\r\nFN:Ada again\r\nEND:VCARD",
      "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Bob\r\nEND:VCARD",
      "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Bob\r\nEND:VCARD",
      "BEGIN:VCARD\r\nVERSION:4.0\r\nNOTE:nobody\r\nEND:VCARD",
      "BEGIN:VCARD\r\nVERSION:4.0\r\nUID:b\r\nFN:Ada\r\nEND:VCARD",
    ].join("\r\n"),
  );
  assert(typeof parsed !== "string", "the file parses");
  const staged = await stageSourceContacts(
    parsed.cards.map((contact) => ({
      contact,
      ...(contact.uid ? { sourcePrimaryKey: contact.uid } : {}),
    })),
    counter(),
  );
  same(
    staged.map((row) =>
      row.status === "mapped"
        ? [row.row, row.sourcePrimaryKey ?? null, row.targetPersonId]
        : [row.row, row.reason]
    ),
    [
      [1, "a", "00000000-0000-4000-8000-000000000001"],
      [2, "conflict"],
      [3, null, "00000000-0000-4000-8000-000000000002"],
      [4, "duplicate"],
      [5, "no-name"],
      [6, "b", "00000000-0000-4000-8000-000000000003"],
    ],
  );
});

Deno.test("[GAP-050] what a workspace cannot hold is counted before commit", async () => {
  const staged = await stageSourceContacts([
    {
      contact: {
        ...EMPTY,
        emails: ["a@example.com", "b@example.com"],
        givenName: "Ada",
        organization: "Society",
        phones: ["+1"],
        urls: ["https://example.com"],
      },
    },
    { contact: { ...EMPTY, givenName: "Bob", jobTitle: "Clerk" } },
    { contact: EMPTY },
  ], counter());
  same(
    contactLosses(staged, {
      phone: { byName: true, id: "t-phone", name: "Phone" },
      url: { byName: false, id: "t-url", name: "Web" },
    }, { PHOTO: 1 }),
    {
      missingTypes: { email: 2 },
      namedTypes: [{ kind: "phone", name: "Phone" }],
      organizationsWithoutTitle: 1,
      skipped: { PHOTO: 1 },
    },
  );
});

Deno.test("[GAP-050] the dry-run report names every loss once and stays quiet about zeros", async () => {
  const staged = await stageSourceContacts([
    { contact: { ...EMPTY, givenName: "Ada" } },
    { contact: { ...EMPTY, givenName: "Ada" } },
    { contact: EMPTY },
    { contact: { ...EMPTY, givenName: "Cy" } },
  ], counter());
  same(
    contactImportReport("vcard", staged, {
      missingTypes: { email: 1, phone: 2 },
      organizationsWithoutTitle: 2,
      skipped: { "X-ABLABEL": 1, PHOTO: 2 },
    }, { conflicts: 1, reused: 1 }),
    {
      counts: {
        contacts: 2,
        legacyCredentialsDiscarded: 0,
        missingFiles: 0,
        orphans: 0,
        unsupported: 3,
      },
      diagnostics: [
        {
          code: "skipped-properties",
          message:
            "3 vCard properties will be skipped: PHOTO (2), X-ABLABEL (1). Photos are not imported.",
          severity: "skipped",
        },
        {
          code: "contact-without-name",
          message: "1 card with no name, email, or phone will be skipped.",
          severity: "warning",
        },
        {
          code: "duplicate-in-source",
          message: "1 duplicate card in this file will be imported once.",
          severity: "skipped",
        },
        {
          code: "missing-contact-type",
          message:
            "1 email address will be skipped because the workspace has no email contact type. Add an Email, Phone, or Website contact type in Personalization and set its kind.",
          severity: "warning",
        },
        {
          code: "missing-contact-type",
          message:
            "2 phone numbers will be skipped because the workspace has no phone contact type. Add an Email, Phone, or Website contact type in Personalization and set its kind.",
          severity: "warning",
        },
        {
          code: "organization-without-title",
          message: "2 companies without a job title will be skipped.",
          severity: "skipped",
        },
        {
          code: "already-imported",
          message: "1 contact was imported before and will be reused.",
          severity: "info",
        },
        {
          code: "identity-conflict",
          message:
            "1 contact shares an identity with an earlier import but changed since; the existing person is kept unchanged.",
          severity: "warning",
        },
      ],
    },
  );
  const quiet = contactImportReport("csv", [], {
    missingTypes: {},
    organizationsWithoutTitle: 0,
    skipped: {},
  }, { conflicts: 0, reused: 0 });
  same(quiet.diagnostics, []);
  const plural = contactImportReport("csv", staged, {
    missingTypes: { url: 3 },
    organizationsWithoutTitle: 1,
    skipped: { Birthday: 2 },
  }, { conflicts: 2, reused: 3 });
  same(plural.diagnostics.map((diagnostic) => diagnostic.message), [
    "2 CSV values will be skipped: Birthday (2).",
    "1 row with no name, email, or phone will be skipped.",
    "1 duplicate row in this file will be imported once.",
    "3 websites will be skipped because the workspace has no url contact type. Add an Email, Phone, or Website contact type in Personalization and set its kind.",
    "1 company without a job title will be skipped.",
    "3 contacts were imported before and will be reused.",
    "2 contacts share an identity with an earlier import but changed since; the existing people are kept unchanged.",
  ]);
});

Deno.test("[GAP-050] a CSV header suggests a mapping the member then confirms", async () => {
  const csv = parseCsv(
    await Deno.readTextFile(
      new URL("./formats/fixtures/contacts.csv", import.meta.url),
    ),
  );
  assert(typeof csv !== "string", "the fixture parses");
  const mapping = suggestedCsvMapping(csv.headers);
  assertEquals(mapping, [
    "givenName",
    "familyName",
    "email",
    "phone",
    "birthday",
    "note",
    "company",
    "jobTitle",
  ]);
  assertEquals(csvMappingProblem(csv.headers, mapping), undefined);
  same(mappedCsvContact(csv.headers, csv.rows[0]!, mapping), {
    contact: {
      addresses: [],
      dates: [{
        day: 10,
        kind: "birthday",
        month: 12,
        precision: "full",
        year: 1815,
      }],
      emails: ["ada@example.com"],
      familyName: "Lovelace",
      givenName: "Ada",
      jobTitle: "Mathematician",
      note: 'Wrote the first program;\r\nloved "poetry"',
      organization: "Analytical Engine Society",
      phones: ["+44 20 7946 0000"],
      urls: [],
    },
    unreadable: [],
  });
  const staged = await stageSourceContacts(
    csv.rows.map((row) => ({
      contact: mappedCsvContact(csv.headers, row, mapping).contact,
    })),
    counter(),
  );
  same(
    staged.map((row) =>
      row.status === "mapped" ? row.contact.givenName : row.reason
    ),
    [
      "Ada",
      "no-name",
      "grace@example.com",
      "duplicate",
    ],
  );
});

Deno.test("[GAP-050] a mapping is refused unless it names somebody", () => {
  const headers = ["A", "B"];
  assertEquals(
    csvMappingProblem(headers, ["givenName"]),
    "Map every column, or choose Ignore for it.",
  );
  assertEquals(
    csvMappingProblem(headers, ["givenName", "shoeSize"]),
    "A column is mapped to an unknown field.",
  );
  assertEquals(
    csvMappingProblem(headers, ["note", "ignore"]),
    "Map at least one column to a name, email, or phone.",
  );
  assertEquals(
    suggestedCsvMapping([
      "Name",
      "Full name",
      "Email 1",
      "Email 2",
      "Mobile",
      "ZIP",
      "Street address",
      "City",
      "State",
      "Country",
      "Nickname",
      "Middle name",
      "Title",
      "?",
    ]),
    [
      "givenName",
      "ignore",
      "email",
      "email",
      "phone",
      "postalCode",
      "street",
      "city",
      "region",
      "country",
      "nickname",
      "middleName",
      "jobTitle",
      "ignore",
    ],
  );
});

Deno.test("[GAP-050] repeated columns add values and an unreadable birthday is counted", () => {
  const headers = [
    "Given",
    "Email",
    "Email",
    "Birthday",
    "Notes",
    "More notes",
    "Street",
    "City",
    "Zip",
    "Region",
    "Country",
  ];
  same(
    mappedCsvContact(
      headers,
      [
        "Ada",
        "a@example.com",
        "b@example.com",
        "12/10/1815",
        "one",
        "two",
        "1 Way",
        "Town",
        "12345",
        "Shire",
        "UK",
      ],
      [
        "givenName",
        "email",
        "email",
        "birthday",
        "note",
        "note",
        "street",
        "city",
        "postalCode",
        "region",
        "country",
      ],
    ),
    {
      contact: {
        addresses: [{
          city: "Town",
          country: "UK",
          postalCode: "12345",
          region: "Shire",
          street: "1 Way",
        }],
        dates: [],
        emails: ["a@example.com", "b@example.com"],
        givenName: "Ada",
        note: "one\n\ntwo",
        phones: [],
        urls: [],
      },
      unreadable: ["Birthday"],
    },
  );
});

Deno.test("[GAP-050] a person keeps one birthday and one date of death", () => {
  same(
    importedContact({
      ...EMPTY,
      dates: [
        { kind: "birthday", precision: "year", year: 1900 },
        { kind: "birthday", precision: "year", year: 1901 },
        { kind: "anniversary", precision: "year", year: 1920 },
        { kind: "anniversary", precision: "year", year: 1950 },
        { kind: "deceased", precision: "year", year: 1990 },
        { kind: "deceased", precision: "year", year: 1991 },
      ],
      givenName: "Ada",
    })?.dates.map((date) => [date.kind, date.year]),
    [["birthday", 1900], ["custom", 1920], ["custom", 1950], [
      "deceased",
      1990,
    ]],
  );
});

Deno.test("[GAP-050] a committed contact files its values under the workspace's types", () => {
  const contact = importedContact({
    ...EMPTY,
    addresses: [{ city: "London" }],
    dates: [{ kind: "birthday", precision: "year", year: 1815 }],
    emails: ["ada@example.com"],
    givenName: "Ada",
    jobTitle: "Mathematician",
    note: "A note",
    organization: "Society",
    phones: ["+44"],
    urls: ["https://example.com"],
  })!;
  same(
    personDetails(contact, {
      email: { byName: false, id: "t-email", name: "Email" },
      url: { byName: true, id: "t-url", name: "Website" },
    }),
    {
      details: {
        addresses: [{ city: "London" }],
        contactMethods: [
          { typeId: "t-email", value: "ada@example.com" },
          { typeId: "t-url", value: "https://example.com" },
        ],
        dates: [{ kind: "birthday", precision: "year", year: 1815 }],
        occupation: { organizationName: "Society", title: "Mathematician" },
      },
      note: "A note",
    },
  );
  const { jobTitle: _title, note: _note, ...untitled } = contact;
  same(
    personDetails(untitled, {}),
    {
      details: {
        addresses: [{ city: "London" }],
        contactMethods: [],
        dates: [{ kind: "birthday", precision: "year", year: 1815 }],
      },
    },
  );
  const { organization: _organization, ...freelance } = contact;
  same(personDetails(freelance, {}).details.occupation, {
    title: "Mathematician",
  });
});

Deno.test("[GAP-050] blank values, middle names, and ragged rows are handled", () => {
  same(
    importedContact({
      ...EMPTY,
      emails: ["  "],
      givenName: "Ada",
      middleName: "Augusta",
      phones: [" "],
    }),
    {
      addresses: [],
      dates: [],
      emails: [],
      givenName: "Ada",
      middleName: "Augusta",
      phones: [],
      urls: [],
    },
  );
  same(
    mappedCsvContact(["Name"], ["Ada"], ["givenName", "birthday", "email"]),
    {
      contact: {
        addresses: [],
        dates: [],
        emails: [],
        givenName: "Ada",
        phones: [],
        urls: [],
      },
      unreadable: [],
    },
  );
  same(
    mappedCsvContact(["Name"], ["Ada", "soon"], ["givenName", "birthday"])
      .unreadable,
    ["Column 2"],
  );
});

Deno.test("[GAP-050] one skipped property is named in the singular", async () => {
  const staged = await stageSourceContacts([
    { contact: { ...EMPTY, givenName: "Ada" } },
  ], counter());
  assertEquals(
    contactImportReport("vcard", staged, {
      missingTypes: {},
      organizationsWithoutTitle: 0,
      skipped: { "X-B": 1 },
    }, { conflicts: 0, reused: 0 }).diagnostics[0]?.message,
    "1 vCard property will be skipped: X-B (1).",
  );
  assertEquals(
    contactImportReport("csv", staged, {
      missingTypes: {},
      organizationsWithoutTitle: 0,
      skipped: { B: 1, A: 1 },
    }, { conflicts: 0, reused: 0 }).diagnostics[0]?.message,
    "2 CSV values will be skipped: A (1), B (1).",
  );
});

Deno.test("[GAP-050] a type chosen by its name, and a file seen before, are said in the dry run", async () => {
  const staged = await stageSourceContacts([
    { contact: { ...EMPTY, givenName: "Ada" } },
    { contact: { ...EMPTY, givenName: "Bob" } },
  ], counter());
  same(
    contactImportReport("csv", staged, {
      missingTypes: {},
      namedTypes: [{ kind: "phone", name: "Phone" }, {
        kind: "url",
        name: "Website",
      }],
      organizationsWithoutTitle: 0,
      skipped: {},
    }, { conflicts: 0, fileImportedBefore: true, reused: 1 }).diagnostics.map(
      (item) => [item.code, item.severity, item.message],
    ),
    [
      [
        "contact-type-by-name",
        "info",
        'Phone numbers will be filed under the custom type "Phone", and websites under "Website" because of their names. Set their kind in Personalization to make this explicit.',
      ],
      [
        "already-imported",
        "info",
        "1 contact was imported before and will be reused.",
      ],
      [
        "file-imported-before",
        "warning",
        "This file was imported before, but 1 row differs from that import; edited rows or a changed mapping will create new people.",
      ],
    ],
  );
});

Deno.test("[GAP-050] one UID with different cards in one file is a conflict naming both", async () => {
  const staged = await stageSourceContacts([
    { contact: { ...EMPTY, givenName: "Ada" }, sourcePrimaryKey: "u1" },
    { contact: { ...EMPTY, givenName: "Ada" }, sourcePrimaryKey: "u1" },
    { contact: { ...EMPTY, givenName: "Adah" }, sourcePrimaryKey: "u1" },
  ], counter());
  same(
    staged.map((row) => row.status === "mapped" ? "mapped" : row.reason),
    ["mapped", "duplicate", "conflict"],
  );
  same(
    contactImportReport("vcard", staged, {
      missingTypes: {},
      organizationsWithoutTitle: 0,
      skipped: {},
    }, { conflicts: 0, reused: 0 }).diagnostics.map((item) => [
      item.code,
      item.message,
    ]),
    [
      [
        "duplicate-in-source",
        "1 duplicate card in this file will be imported once.",
      ],
      [
        "identity-conflict-in-file",
        "Cards 1 (Ada) and 3 (Adah) share the UID u1 but differ; card 1 is imported and card 3 is skipped.",
      ],
    ],
  );
});

Deno.test("[GAP-050] a CSV value over its limit is counted, never dropped silently", () => {
  same(
    mappedCsvContact(
      ["Given", "Email", "Phone", "Family"],
      ["x".repeat(501), `${"e".repeat(320)}@x`, "1".repeat(65), "Ok"],
      ["givenName", "email", "phone", "familyName"],
    ).unreadable,
    ["Given", "Email", "Phone"],
  );
});

Deno.test("[GAP-050] a header or property that names a credential is recognized", () => {
  for (
    const name of [
      "Password",
      "user_passwd",
      "PWD",
      "Client Secret",
      "Access-Token",
      "apiKey",
      "API key",
      "private_key",
      "TOTP seed",
      "otp",
      "Session",
      "X-PASSWORD",
      "2FA secret",
    ]
  ) assertEquals(credentialName(name), true, name);
  for (
    const name of [
      "Name",
      "E-mail",
      "Notes",
      "Photo",
      "Hotpot",
      "Tokenring",
      "Shoe size",
      "Secretary",
      "Assistant/Secretary",
      "Birthday",
    ]
  ) assertEquals(credentialName(name), false, name);
});

Deno.test("[GAP-050] one name-chosen type, several changed rows, and a type chosen by kind", async () => {
  const staged = await stageSourceContacts([
    { contact: { ...EMPTY, givenName: "Ada", phones: ["+1"] } },
    { contact: { ...EMPTY, givenName: "Bob" } },
    { contact: { ...EMPTY, givenName: "Cy" } },
  ], counter());
  same(
    contactLosses(staged, {
      phone: { byName: false, id: "t", name: "Mobile" },
    }, {}),
    { missingTypes: {}, organizationsWithoutTitle: 0, skipped: {} },
  );
  same(
    contactImportReport("csv", staged, {
      missingTypes: {},
      namedTypes: [{ kind: "email", name: "EMAIL" }],
      organizationsWithoutTitle: 0,
      skipped: {},
    }, { conflicts: 0, fileImportedBefore: true, reused: 1 }).diagnostics.map(
      (item) => item.message,
    ),
    [
      'Email addresses will be filed under the custom type "EMAIL" because of its name. Set its kind in Personalization to make this explicit.',
      "1 contact was imported before and will be reused.",
      "This file was imported before, but 2 rows differ from that import; edited rows or a changed mapping will create new people.",
    ],
  );
  same(
    mappedCsvContact(["Given"], ["Ada", "x".repeat(501)], [
      "givenName",
      "familyName",
    ]).unreadable,
    ["Column 2"],
  );
});
