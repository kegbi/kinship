import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import { openSql, requireDatabaseUrl } from "../support/database.ts";
import { apiSupport, type SignedInFixture } from "../support/api.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl);
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const api = apiSupport(configured.app, mail, sql);
const register = (label: string) => {
  const email = `${label}-${crypto.randomUUID()}@example.test`;
  return api.register(email, email, {
    firstName: "Contacts",
    lastName: "Admin",
  });
};

interface Report {
  readonly counts: { readonly contacts: number; readonly unsupported: number };
  readonly diagnostics: readonly {
    readonly code: string;
    readonly message: string;
  }[];
}

async function post(
  fixture: SignedInFixture,
  path: string,
  body: unknown,
): Promise<
  { readonly body: Record<string, unknown>; readonly status: number }
> {
  const response = await api.request(fixture, path, "POST", body);
  return {
    body: await response.json() as Record<string, unknown>,
    status: response.status,
  };
}

/** Stages, then commits, a vCard file; answers with both halves. */
async function importVCard(fixture: SignedInFixture, text: string) {
  const staged = await post(fixture, "/api/v1/imports/dry-runs", {
    source: { format: "vcard", text },
  });
  assertEquals(staged.status, 201, JSON.stringify(staged.body));
  const committed = await post(
    fixture,
    `/api/v1/imports/${staged.body.importId}/commit`,
    { confirmed: true },
  );
  assertEquals(committed.status, 200, JSON.stringify(committed.body));
  return {
    committed: committed.body as {
      peopleCreated: number;
      peopleReused: number;
    },
    importId: String(staged.body.importId),
    report: staged.body.report as Report,
  };
}

/**
 * The Email and Phone types, made as a member makes them: through
 * Personalization, the Phone one created as custom and then given its kind.
 */
async function contactTypes(fixture: SignedInFixture) {
  const path = "/api/v1/settings/personalization/contact-method-types";
  const email = await post(fixture, path, {
    contactKind: "email",
    name: "Email",
  });
  assertEquals(email.status, 200, JSON.stringify(email.body));
  assertEquals(
    (email.body.entry as { contactKind: string }).contactKind,
    "email",
  );
  const pager = await post(fixture, path, { name: "Mobile" });
  const created = pager.body.entry as {
    contactKind: string;
    id: string;
    updatedAt: string;
  };
  assertEquals(created.contactKind, "custom", "custom is the default");
  const changed = await api.request(fixture, `${path}/${created.id}`, "PATCH", {
    contactKind: "phone",
    expectedUpdatedAt: created.updatedAt,
  });
  assertEquals(changed.status, 200);
  assertEquals(
    ((await changed.json()) as { entry: { contactKind: string } }).entry
      .contactKind,
    "phone",
  );
}

const ADA = [
  "BEGIN:VCARD",
  "VERSION:4.0",
  "UID:urn:uuid:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1",
  "FN:Ada Lovelace",
  "N:Lovelace;Ada;;;",
  "EMAIL:ada@example.com",
  "TEL:+44 20 7946 0000",
  "URL:https://example.com/ada",
  "ADR:;;12 St James's Square;London;;SW1Y 4JH;United Kingdom",
  "BDAY:--1210",
  "NOTE:Wrote the first program.",
  "ORG:Analytical Engine Society",
  "TITLE:Mathematician",
  "PHOTO:https://example.com/ada.png",
  "END:VCARD",
].join("\r\n");
const CHARLES =
  "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Charles Babbage\r\nN:Babbage;Charles;;;\r\nEND:VCARD";

Deno.test("[IMPORT-002] a vCard import writes each person's details once and re-imports without duplicates", async () => {
  const primary = await register("vcard");
  await contactTypes(primary);
  const file = `${ADA}\r\n${CHARLES}\r\n`;
  const first = await importVCard(primary, file);
  assertEquals(first.report.counts.contacts, 2);
  assertEquals(first.report.counts.unsupported, 1);
  assert(
    first.report.diagnostics.some((item) =>
      item.code === "skipped-properties" && item.message.includes("PHOTO (1)")
    ) &&
      first.report.diagnostics.some((item) =>
        item.code === "missing-contact-type" && item.message.includes("website")
      ),
    JSON.stringify(first.report),
  );
  assertEquals(first.committed.peopleCreated, 2);

  const [ada] = await sql<{
    addresses: string;
    birthday: string;
    methods: string;
    notes: string;
    occupation: string;
  }[]>`
    select
      (select string_agg(type.kind || ':' || method.value, ',' order by type.kind)
        from crm.person_contact_methods method
        join crm.contact_method_types type on type.id = method.type_id
        where method.person_id = person.id) as methods,
      (select string_agg(concat_ws('|', location.street, location.city, location.postal_code, location.country), ',')
        from crm.person_addresses address
        join crm.locations location on location.id = address.location_id
        where address.person_id = person.id) as addresses,
      (select concat_ws('|', date.kind, date.precision, date.month, date.day)
        from crm.person_dates date where date.person_id = person.id) as birthday,
      (select string_agg(note.body, ',') from crm.notes note
        where note.person_id = person.id) as notes,
      (select concat_ws('|', occupation.title, organization.name)
        from crm.person_occupations occupation
        left join crm.organizations organization
          on organization.id = occupation.organization_id
        where occupation.person_id = person.id) as occupation
    from crm.people person
    where person.workspace_id = ${primary.workspaceId}::uuid
      and person.given_name = 'Ada'
  `;
  assertEquals(ada, {
    methods: "email:ada@example.com,phone:+44 20 7946 0000",
    addresses: "12 St James's Square|London|SW1Y 4JH|United Kingdom",
    birthday: "birthday|month_day|12|10",
    notes: "Wrote the first program.",
    occupation: "Mathematician|Analytical Engine Society",
  });
  // An imported birthday reminds exactly as a typed one does.
  const [reminders] = await sql<{ count: string }[]>`
    select count(*)::text as count from crm.reminders reminder
    join crm.person_dates date on date.id = reminder.person_date_id
    join crm.people person on person.id = date.person_id
    where person.workspace_id = ${primary.workspaceId}::uuid`;
  assertEquals(reminders?.count, "1");

  const again = await importVCard(primary, file);
  assert(
    again.report.diagnostics.some((item) =>
      item.message === "2 contacts were imported before and will be reused."
    ),
    JSON.stringify(again.report),
  );
  assertEquals(again.committed.peopleCreated, 0);
  assertEquals(again.committed.peopleReused, 2);
  const [counts] = await sql<
    { methods: string; notes: string; people: string }[]
  >`
    select
      (select count(*)::text from crm.people where workspace_id = ${primary.workspaceId}::uuid) as people,
      (select count(*)::text from crm.notes where workspace_id = ${primary.workspaceId}::uuid) as notes,
      (select count(*)::text from crm.person_contact_methods method
        join crm.people person on person.id = method.person_id
        where person.workspace_id = ${primary.workspaceId}::uuid) as methods`;
  assertEquals(counts, { people: "2", notes: "1", methods: "2" });
});

Deno.test("[IMPORT-002] a card whose UID was imported before but changed is a conflict and updates nothing", async () => {
  const primary = await register("vcard-conflict");
  await importVCard(primary, ADA);
  const changed = await importVCard(
    primary,
    ADA.replace("FN:Ada Lovelace", "FN:Augusta Ada King").replace(
      "N:Lovelace;Ada;;;",
      "N:King;Augusta;;;",
    ),
  );
  assert(
    changed.report.diagnostics.some((item) =>
      item.code === "identity-conflict"
    ),
    JSON.stringify(changed.report),
  );
  assertEquals(changed.committed.peopleCreated, 0);
  assertEquals(changed.committed.peopleReused, 1);
  const names = await sql<{ given_name: string }[]>`
    select given_name from crm.people
    where workspace_id = ${primary.workspaceId}::uuid`;
  assertEquals(names.map((row) => row.given_name), ["Ada"]);
});

Deno.test("[IMPORT-002] a CSV import is mapped, resumable, de-duplicated, and idempotent", async () => {
  const primary = await register("csv");
  await contactTypes(primary);
  const text = [
    "First name;Last name;E-mail;Birthday;Notes;Shoe size",
    "Ada;Lovelace;ada@example.com;1815-12-10;First programmer;38",
    ";;;;just a note;",
    ";;grace@example.com;--12-09;;",
    "Ada;Lovelace;ada@example.com;1815-12-10;First programmer;38",
    "Bad;Date;;12/10/1815;;",
  ].join("\r\n");
  const stageAndMap = async () => {
    const staged = await post(primary, "/api/v1/imports/dry-runs", {
      source: { format: "csv", text },
    });
    assertEquals(staged.status, 201);
    assertEquals(staged.body.status, "mapping");
    const importId = String(staged.body.importId);
    // The mapping step survives a reload: the pending run carries its preview.
    const resumed = await api.request(
      primary,
      `/api/v1/imports/${importId}`,
      "GET",
    );
    const summary = await resumed.json() as {
      preview: {
        headers: string[];
        rowCount: number;
        rows: string[][];
        suggested: string[];
      };
      sourceSystem: string;
      status: string;
    };
    assertEquals(summary.status, "pending");
    assertEquals(summary.sourceSystem, "csv");
    assertEquals(summary.preview.rowCount, 5);
    assertEquals(summary.preview.rows.length, 5);
    assertEquals(summary.preview.suggested, [
      "givenName",
      "familyName",
      "email",
      "birthday",
      "note",
      "ignore",
    ]);
    const mapped = await post(primary, `/api/v1/imports/${importId}/mapping`, {
      columns: summary.preview.suggested,
    });
    assertEquals(mapped.status, 200, JSON.stringify(mapped.body));
    const again = await post(primary, `/api/v1/imports/${importId}/mapping`, {
      columns: summary.preview.suggested,
    });
    assertEquals(again.status, 404, "a mapped run cannot be mapped twice");
    const committed = await post(
      primary,
      `/api/v1/imports/${importId}/commit`,
      { confirmed: true },
    );
    assertEquals(committed.status, 200);
    return {
      committed: committed.body,
      importId,
      report: mapped.body.report as Report,
    };
  };
  const first = await stageAndMap();
  assertEquals(first.report.counts.contacts, 3);
  assertEquals(
    first.report.diagnostics.map((item) => item.message),
    [
      "1 CSV value will be skipped: Birthday (1).",
      "1 row with no name, email, or phone will be skipped.",
      "1 duplicate row in this file will be imported once.",
    ],
  );
  assertEquals(first.committed.peopleCreated, 3);
  const [stored] = await sql<{ mapping: unknown; skipped: string }[]>`
    select stats->'mapping' as mapping,
      (select count(*)::text from crm.data_import_entities entity
        where entity.import_id = run.id and entity.status = 'skipped') as skipped
    from crm.data_imports run where run.id = ${first.importId}::uuid`;
  assertEquals(stored?.skipped, "2");
  assertEquals(
    JSON.stringify(stored?.mapping),
    JSON.stringify([
      "givenName",
      "familyName",
      "email",
      "birthday",
      "note",
      "ignore",
    ]),
  );
  const second = await stageAndMap();
  assertEquals(second.committed.peopleCreated, 0);
  assertEquals(second.committed.peopleReused, 3);
  const people = await sql<{ given_name: string }[]>`
    select given_name from crm.people
    where workspace_id = ${primary.workspaceId}::uuid order by given_name`;
  assertEquals(people.map((row) => row.given_name), [
    "Ada",
    "Bad",
    "grace@example.com",
  ]);
});

Deno.test("[IMPORT-002] contact imports are tenant-safe, admin-only, and bounded", async () => {
  const primary = await register("contacts-owner");
  const foreign = await register("contacts-foreign");
  const staged = await post(primary, "/api/v1/imports/dry-runs", {
    source: { format: "csv", text: "Name\r\nAda" },
  });
  const importId = String(staged.body.importId);
  for (
    const [path, body] of [
      [`/api/v1/imports/${importId}/mapping`, { columns: ["givenName"] }],
      [`/api/v1/imports/${importId}/commit`, { confirmed: true }],
    ] as const
  ) {
    assertEquals((await post(foreign, path, body)).status, 404, path);
  }
  assertEquals(
    (await api.request(foreign, `/api/v1/imports/${importId}`, "GET")).status,
    404,
  );
  // A committed CSV run in another workspace is not an earlier import here.
  await post(primary, `/api/v1/imports/${importId}/mapping`, {
    columns: ["givenName"],
  });
  await post(primary, `/api/v1/imports/${importId}/commit`, {
    confirmed: true,
  });
  const theirs = await post(foreign, "/api/v1/imports/dry-runs", {
    source: { format: "csv", text: "Name\r\nAda" },
  });
  const mapped = await post(
    foreign,
    `/api/v1/imports/${theirs.body.importId}/mapping`,
    { columns: ["givenName"] },
  );
  assert(
    !(mapped.body.report as Report).diagnostics.some((item) =>
      item.code === "already-imported"
    ),
    "another workspace's import is not reused",
  );

  const [member] = await sql<{ id: string }[]>`
    update crm.workspace_members set role = 'member'
    where id = ${foreign.memberId}::uuid returning id::text`;
  assert(member, "the foreign admin is demoted");
  assertEquals(
    (await post(foreign, "/api/v1/imports/dry-runs", {
      source: { format: "vcard", text: CHARLES },
    })).status,
    403,
  );

  const refusals: readonly [unknown, number, string][] = [
    [
      { format: "vcard", text: `${CHARLES}\r\n`.repeat(501) },
      400,
      "A vCard file may contain at most 500 cards.",
    ],
    [
      { format: "csv", text: `Name\r\n${"Ada\r\n".repeat(501)}` },
      400,
      "A CSV file may contain at most 500 rows.",
    ],
    [
      { format: "csv", text: "Name\r\nJ�rgen" },
      400,
      "The file is not UTF-8 encoded. Save it as UTF-8 and try again.",
    ],
    [
      { format: "vcard", text: "x".repeat(1_500_001) },
      413,
      "The import source exceeds the 1.5 MB staging limit.",
    ],
  ];
  for (const [source, status, detail] of refusals) {
    const refused = await post(primary, "/api/v1/imports/dry-runs", { source });
    assertEquals(refused.status, status, detail);
    assertEquals(refused.body.detail, detail);
  }
});

Deno.test("[IMPORT-002] a custom type named for a kind stands in for it, and the dry run says so", async () => {
  const primary = await register("contacts-named-type");
  await sql`insert into crm.contact_method_types (workspace_id, name, kind)
    values (${primary.workspaceId}::uuid, 'website', 'custom'),
      (${primary.workspaceId}::uuid, 'Phone', 'custom')`;
  const imported = await importVCard(primary, ADA);
  const messages = imported.report.diagnostics.map((item) => item.message);
  assert(
    messages.includes(
      'Phone numbers will be filed under the custom type "Phone", and websites under "website" because of their names. Set their kind in Personalization to make this explicit.',
    ) &&
      messages.includes(
        "1 email address will be skipped because the workspace has no email contact type. Add an Email, Phone, or Website contact type in Personalization and set its kind.",
      ),
    messages.join("\n"),
  );
  const methods = await sql<{ name: string; value: string }[]>`
    select type.name, method.value from crm.person_contact_methods method
    join crm.contact_method_types type on type.id = method.type_id
    where type.workspace_id = ${primary.workspaceId}::uuid
    order by type.name`;
  assertEquals(methods.map((row) => `${row.name}:${row.value}`), [
    "Phone:+44 20 7946 0000",
    "website:https://example.com/ada",
  ]);
});

Deno.test("[IMPORT-002] nothing credential-like, and nothing unmapped, is kept", async () => {
  const primary = await register("contacts-redaction");
  const refused = await post(primary, "/api/v1/imports/dry-runs", {
    source: { format: "csv", text: "Name;Password\r\nAda;hunter2\r\n" },
  });
  assertEquals(refused.status, 400);
  assertEquals(
    refused.body.detail,
    "This file contains a password or secret column; remove it and upload again.",
  );
  const [none] = await sql<{ runs: string }[]>`
    select count(*)::text as runs from crm.data_imports
    where workspace_id = ${primary.workspaceId}::uuid`;
  assertEquals(none?.runs, "0", "a refused file stores nothing");

  const card = ADA.replace(
    "END:VCARD",
    "X-PASSWORD:hunter2\r\nX-SESSION-TOKEN:tok-123\r\nEND:VCARD",
  );
  const vcard = await post(primary, "/api/v1/imports/dry-runs", {
    source: { format: "vcard", text: card },
  });
  assertEquals(vcard.status, 201);
  assert(
    (vcard.body.report as Report).diagnostics[0]?.message.includes(
      "X-PASSWORD (1)",
    ),
    JSON.stringify(vcard.body.report),
  );

  const staged = await post(primary, "/api/v1/imports/dry-runs", {
    source: {
      format: "csv",
      text:
        "Name;Shoe size;Notes\r\nAda;SECRET-SHOE-38;keep me\r\n;SECRET-SHOE-40;\r\n",
    },
  });
  const importId = String(staged.body.importId);
  const mapped = await post(primary, `/api/v1/imports/${importId}/mapping`, {
    columns: ["givenName", "ignore", "note"],
  });
  assertEquals(mapped.status, 200);
  const [stored] = await sql<{ everything: string }[]>`
    select coalesce(string_agg(entity.raw_snapshot::text, ' '), '') || ' ' ||
      (select string_agg(run.stats::text, ' ') from crm.data_imports run
        where run.workspace_id = ${primary.workspaceId}::uuid) as everything
    from crm.data_import_entities entity
    join crm.data_imports run on run.id = entity.import_id
    where run.workspace_id = ${primary.workspaceId}::uuid`;
  const everything = stored?.everything ?? "";
  for (
    const secret of [
      "hunter2",
      "tok-123",
      "SECRET-SHOE",
      '"cells"',
      '"preview"',
    ]
  ) {
    assert(!everything.includes(secret), `${secret} was kept: ${everything}`);
  }
  assert(everything.includes("keep me"), "the mapped note is kept");
});

Deno.test("[IMPORT-002] a file imported before under another mapping is flagged, and a deleted person is not recreated", async () => {
  const primary = await register("contacts-remap");
  const text = "First name;Last name\r\nGrace;Hopper\r\n";
  const importCsv = async (columns: readonly string[]) => {
    const staged = await post(primary, "/api/v1/imports/dry-runs", {
      source: { format: "csv", text },
    });
    const importId = String(staged.body.importId);
    const mapped = await post(primary, `/api/v1/imports/${importId}/mapping`, {
      columns,
    });
    const committed = await post(
      primary,
      `/api/v1/imports/${importId}/commit`,
      {
        confirmed: true,
      },
    );
    return {
      committed: committed.body as {
        peopleCreated: number;
        peopleReused: number;
      },
      messages: (mapped.body.report as Report).diagnostics.map((item) =>
        item.message
      ),
    };
  };
  await importCsv(["givenName", "familyName"]);
  const remapped = await importCsv(["givenName", "ignore"]);
  assert(
    remapped.messages.includes(
      "This file was imported before, but 1 row differs from that import; edited rows or a changed mapping will create new people.",
    ),
    remapped.messages.join("\n"),
  );
  assertEquals(remapped.committed.peopleCreated, 1);

  // The Monica behaviour, kept (REL-063): a deleted person is reused.
  await sql`update crm.people set deleted_at = now()
    where workspace_id = ${primary.workspaceId}::uuid`;
  const again = await importCsv(["givenName", "familyName"]);
  assertEquals(again.committed.peopleCreated, 0);
  assertEquals(again.committed.peopleReused, 1);
});
