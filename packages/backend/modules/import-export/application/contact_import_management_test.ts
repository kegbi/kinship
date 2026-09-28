import {
  type ContactImportRepository,
  createImportManagement,
  type ImportManagementDependencies,
  type ImportRepository,
} from "../public.ts";
import { assert, assertEquals } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";

const actor = fixtures.actor({ role: "admin" });

const ADA_CARD = [
  "BEGIN:VCARD",
  "VERSION:4.0",
  "UID:ada",
  "FN:Ada Lovelace",
  "N:Lovelace;Ada;;;",
  "EMAIL:ada@example.com",
  "TEL:+44",
  "BDAY:--1210",
  "NOTE:First programmer",
  "ORG:Society",
  "TITLE:Mathematician",
  "PHOTO:https://example.com/a.png",
  "END:VCARD",
].join("\r\n");
const BOB_CARD = "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Bob\r\nEND:VCARD";

interface Recorded {
  readonly audits: string[];
  readonly calls: unknown[];
}

function harness(
  overrides:
    & Partial<Omit<ImportManagementDependencies, "contacts" | "repository">>
    & {
      readonly contactRepository?: Partial<ContactImportRepository>;
      readonly repository?: Partial<ImportRepository>;
    } = {},
) {
  const { contactRepository, repository: repositoryOverrides, ...rest } =
    overrides;
  const recorded: Recorded = { audits: [], calls: [] };
  let next = 0;
  const contacts: ContactImportRepository = {
    history: () => Promise.resolve({ fileImportedBefore: false, matches: [] }),
    lockPendingCsv: () => Promise.resolve(undefined),
    mapCsv: (command) => {
      recorded.calls.push(["mapCsv", command]);
      return Promise.resolve();
    },
    stageContacts: (command) => {
      recorded.calls.push(["stageContacts", command]);
      return Promise.resolve();
    },
    stagePendingCsv: (command) => {
      recorded.calls.push(["stagePendingCsv", command]);
      return Promise.resolve();
    },
    ...contactRepository,
  };
  const repository: ImportRepository = {
    complete: () => Promise.resolve(),
    get: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    prepareCommit: () => Promise.resolve({ status: "not-found" as const }),
    retargetContact: (_importId, entityId, target) => {
      recorded.calls.push(["retarget", entityId, target]);
      return Promise.resolve();
    },
    stage: () => Promise.reject(new Error("a contact format reached Monica")),
    ...repositoryOverrides,
  };
  const imports = createImportManagement({
    actors: { revalidate: () => Promise.resolve("active" as const) },
    audit: {
      record: (command) => {
        recorded.audits.push(command.action);
        return Promise.resolve();
      },
    },
    contactTypes: {
      byKind: () =>
        Promise.resolve({
          email: { byName: false, id: "type-email", name: "Email" },
        }),
    },
    files: { representMissing: () => Promise.resolve() },
    ids: {
      next: () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`,
    },
    notes: {
      addNote: (command) => {
        recorded.calls.push(["addNote", command.personId, command.body]);
        return Promise.resolve();
      },
    },
    people: {
      addDetails: (command) => {
        recorded.calls.push(["addDetails", command.personId, command.details]);
        return Promise.resolve();
      },
      create: (command) => {
        recorded.calls.push(["create", command.person.id]);
        return Promise.resolve();
      },
      presence: () => Promise.resolve("active" as const),
      linkAvatar: () => Promise.resolve(),
    },
    transaction: { run: (work) => work({ opaque: {} }) },
    ...rest,
    contacts,
    repository,
  });
  return { imports, recorded };
}

Deno.test("[IMPORT-002] a vCard dry run stages every card and reports what it loses", async () => {
  const { imports, recorded } = harness();
  const result = await imports.dryRun(actor, {
    format: "vcard",
    text: `\uFEFF${ADA_CARD}\r\n${BOB_CARD}\r\n${BOB_CARD}`,
  });
  assert(result.status === "dry_run", JSON.stringify(result));
  assertEquals(result.report.counts.contacts, 2);
  assertEquals(result.report.counts.unsupported, 1);
  assertEquals(result.report.diagnostics.map((item) => item.code), [
    "skipped-properties",
    "duplicate-in-source",
    "missing-contact-type",
  ]);
  assertEquals(recorded.audits, ["started", "validated"]);
  const [call, command] = recorded.calls[0] as [
    string,
    Parameters<ContactImportRepository["stageContacts"]>[0],
  ];
  assertEquals(call, "stageContacts");
  assertEquals(command.sourceSystem, "vcard");
  assertEquals(command.importId, result.importId);
  assertEquals(
    command.rows.map((row) =>
      row.status === "mapped" ? row.contact.givenName : row.reason
    ),
    ["Ada", "Bob", "duplicate"],
  );
  assert(/^[0-9a-f]{64}$/.test(command.fingerprint), "the file is signed");
});

Deno.test("[IMPORT-002] an earlier import is reused, a changed one is a conflict, and a removed person is imported again", async () => {
  const standing = new Map([["kept", "active"], ["changed", "active"]]);
  const { imports } = harness({
    contactRepository: {
      history: () =>
        Promise.resolve({
          fileImportedBefore: true,
          matches: [
            { changed: false, row: 1, targetPersonId: "kept" },
            { changed: true, row: 2, targetPersonId: "changed" },
            { changed: false, row: 3, targetPersonId: "gone" },
          ],
        }),
    },
    people: {
      addDetails: () => Promise.resolve(),
      create: () => Promise.resolve(),
      presence: (command) =>
        Promise.resolve(
          standing.get(command.personId) === "active" ? "active" : "absent",
        ),
      linkAvatar: () => Promise.resolve(),
    },
  });
  const result = await imports.dryRun(actor, {
    format: "vcard",
    text: [ADA_CARD, BOB_CARD, BOB_CARD.replace("Bob", "Cy")].join("\r\n"),
  });
  assert(result.status === "dry_run", "the dry run completes");
  const messages = result.report.diagnostics.map((item) => item.message);
  assert(
    messages.includes("1 contact was imported before and will be reused."),
    messages.join("\n"),
  );
  assert(
    messages.includes(
      "1 contact shares an identity with an earlier import but changed since; the existing person is kept unchanged.",
    ),
    messages.join("\n"),
  );
  // The same file was imported before, yet the removed person's card is
  // not matched, so the member is told a new person will be made.
  assert(
    messages.includes(
      "This file was imported before, but 1 card differs from that import; edited rows or a changed mapping will create new people.",
    ),
    messages.join("\n"),
  );
});

Deno.test("[IMPORT-002] a contact file that cannot be read never reaches staging", async () => {
  const { imports, recorded } = harness();
  const refusals: readonly [unknown, string][] = [
    [{ format: "vcard" }, "The file text is missing."],
    [
      { format: "vcard", text: "BEGIN:VCARD\uFFFD" },
      "The file is not UTF-8 encoded. Save it as UTF-8 and try again.",
    ],
    [{ format: "vcard", text: "hello" }, "The file contains no vCards."],
    [{ format: "csv", text: "" }, "The CSV file needs a header row."],
    [
      { format: "csv", text: "a\u0000b" },
      "The file is not UTF-8 encoded. Save it as UTF-8 and try again.",
    ],
  ];
  for (const [source, detail] of refusals) {
    assertEquals(await imports.dryRun(actor, source), {
      detail,
      status: "invalid-source",
    });
  }
  assertEquals(recorded.calls, []);
  for (
    const header of ["Password", "api_key", "Session token", "TOTP"]
  ) {
    assertEquals(
      await imports.dryRun(actor, {
        format: "csv",
        text: `Name;${header}\r\nAda;hunter2\r\n`,
      }),
      {
        detail:
          "This file contains a password or secret column; remove it and upload again.",
        status: "invalid-source",
      },
      header,
    );
  }
  assertEquals(recorded.calls, []);
  const member = { ...actor, role: "member" as const };
  assertEquals(
    (await imports.dryRun(member, { format: "csv", text: "a\r\n1" })).status,
    "forbidden",
  );
  assertEquals(
    (await imports.mapColumns(member, "id", ["givenName"])).status,
    "forbidden",
  );
  const revoked = harness({
    actors: { revalidate: () => Promise.resolve("revoked" as const) },
  });
  for (const format of ["vcard", "csv"]) {
    const text = format === "vcard" ? BOB_CARD : "Name\r\nBob";
    assertEquals(
      (await revoked.imports.dryRun(actor, { format, text })).status,
      "forbidden",
    );
  }
  assertEquals(
    (await revoked.imports.mapColumns(actor, "id", ["givenName"])).status,
    "forbidden",
  );
  assertEquals(revoked.recorded.calls, []);
});

Deno.test("[IMPORT-002] a CSV stops at its mapping step and resumes from the stored rows", async () => {
  const { imports, recorded } = harness({
    contactRepository: {
      lockPendingCsv: (_actor, importId) =>
        Promise.resolve(
          importId === "pending"
            ? {
              fingerprint: "f".repeat(64),
              headers: ["Name", "Email", "Birthday"],
              rows: [
                ["Ada", "ada@example.com", "1815-12-10"],
                ["", "", "never"],
                ["Ada", "ada@example.com", "1815-12-10"],
              ],
            }
            : undefined,
        ),
    },
  });
  const staged = await imports.dryRun(actor, {
    format: "csv",
    text:
      "Name;Email;Birthday\r\nAda;ada@example.com;1815-12-10\r\n;;never\r\n",
  });
  assert(staged.status === "mapping", JSON.stringify(staged));
  assertEquals(staged.preview, {
    delimiter: ";",
    headers: ["Name", "Email", "Birthday"],
    rowCount: 2,
    rows: [["Ada", "ada@example.com", "1815-12-10"], ["", "", "never"]],
    suggested: ["givenName", "email", "birthday"],
  });
  assertEquals(recorded.audits, ["started"]);
  assertEquals((recorded.calls[0] as unknown[])[0], "stagePendingCsv");

  assertEquals(
    (await imports.mapColumns(actor, "missing", ["givenName"])).status,
    "not-found",
  );
  assertEquals(
    await imports.mapColumns(actor, "pending", ["note", "note", "note"]),
    {
      detail: "Map at least one column to a name, email, or phone.",
      status: "invalid-mapping",
    },
  );
  const mapped = await imports.mapColumns(actor, "pending", [
    "givenName",
    "email",
    "birthday",
  ]);
  assert(mapped.status === "dry_run", JSON.stringify(mapped));
  assertEquals(mapped.report.counts.contacts, 1);
  assertEquals(mapped.report.diagnostics.map((item) => item.message), [
    "1 CSV value will be skipped: Birthday (1).",
    "1 row with no name, email, or phone will be skipped.",
    "1 duplicate row in this file will be imported once.",
  ]);
  const [, command] = recorded.calls.at(-1) as [
    string,
    Parameters<ContactImportRepository["mapCsv"]>[0],
  ];
  assertEquals(command.mapping, ["givenName", "email", "birthday"]);
  assertEquals(command.rows.map((row) => row.status), [
    "mapped",
    "skipped",
    "skipped",
  ]);
  assertEquals(recorded.audits, ["started", "validated"]);
});

Deno.test("[IMPORT-002] a committed contact writes its details once, and a reused one writes nothing", async () => {
  const contact = {
    addresses: [{ city: "London" }],
    dates: [{
      day: 10,
      kind: "birthday" as const,
      month: 12,
      precision: "month_day" as const,
    }],
    emails: ["ada@example.com"],
    givenName: "Ada",
    jobTitle: "Mathematician",
    note: "First programmer",
    organization: "Society",
    phones: ["+44"],
    urls: [],
  };
  const { imports, recorded } = harness({
    repository: {
      prepareCommit: (_actor, importId) =>
        Promise.resolve({
          avatars: [],
          contacts: [
            {
              archived: false,
              contact,
              entityId: "entity-new",
              givenName: "Ada",
              isDeceased: false,
              isPartial: false,
              isStarred: false,
              sourcePrimaryKey: "entity:new",
              targetPersonId: "person-new",
            },
            {
              archived: false,
              contact: { ...contact, givenName: "Bob" },
              entityId: "entity-old",
              givenName: "Bob",
              isDeceased: false,
              isPartial: false,
              isStarred: false,
              previousTargetPersonId: "person-old",
              sourcePrimaryKey: "entity:old",
              targetPersonId: "person-unused",
            },
          ],
          importId,
          status: "ready" as const,
        }),
    },
  });
  assertEquals(await imports.commit(actor, "run", true), {
    importId: "run",
    peopleCreated: 1,
    peopleReused: 1,
    peopleSkippedDeleted: 0,
    status: "completed",
  });
  assertEquals(recorded.calls, [
    ["create", "person-new"],
    ["addDetails", "person-new", {
      addresses: [{ city: "London" }],
      contactMethods: [{ typeId: "type-email", value: "ada@example.com" }],
      dates: contact.dates,
      occupation: { organizationName: "Society", title: "Mathematician" },
    }],
    ["addNote", "person-new", "First programmer"],
    ["retarget", "entity-old", "person-old"],
  ]);
});

Deno.test("[IMPORT-002] a deleted person is reported as skipped in the dry run and gets nothing on commit", async () => {
  const standing = new Map<string, "active" | "deleted">([
    ["kept", "active"],
    ["deleted", "deleted"],
  ]);
  const people = {
    addDetails: (command: { readonly personId: string }) => {
      recorded.calls.push(["addDetails", command.personId]);
      return Promise.resolve();
    },
    create: (command: { readonly person: { readonly id: string } }) => {
      recorded.calls.push(["create", command.person.id]);
      return Promise.resolve();
    },
    linkAvatar: () => Promise.resolve(),
    presence: (command: { readonly personId: string }) =>
      Promise.resolve(standing.get(command.personId) ?? ("absent" as const)),
  };
  const staged = (key: string, previous: string) => ({
    archived: false,
    contact: {
      addresses: [],
      dates: [],
      emails: ["x@example.com"],
      givenName: key,
      note: "Kept note",
      phones: [],
      urls: [],
    },
    entityId: `entity-${key}`,
    givenName: key,
    isDeceased: false,
    isPartial: false,
    isStarred: false,
    previousTargetPersonId: previous,
    sourcePrimaryKey: `entity:${key}`,
    targetPersonId: `unused-${key}`,
  });
  const { imports, recorded } = harness({
    contactRepository: {
      history: () =>
        Promise.resolve({
          fileImportedBefore: true,
          matches: [
            { changed: false, row: 1, targetPersonId: "kept" },
            { changed: false, row: 2, targetPersonId: "deleted" },
          ],
        }),
    },
    people,
    repository: {
      prepareCommit: (_actor, importId) =>
        Promise.resolve({
          avatars: [],
          contacts: [staged("Ada", "kept"), staged("Bob", "deleted")],
          importId,
          status: "ready" as const,
        }),
    },
  });
  const dryRun = await imports.dryRun(actor, {
    format: "vcard",
    text: [ADA_CARD, BOB_CARD].join("\r\n"),
  });
  assert(dryRun.status === "dry_run", JSON.stringify(dryRun));
  // A deleted person is matched, so the file is not said to differ.
  assertEquals(
    dryRun.report.diagnostics.filter((item) =>
      ["already-imported", "deleted-person-skipped", "file-imported-before"]
        .includes(item.code)
    ),
    [{
      code: "already-imported",
      message: "1 contact was imported before and will be reused.",
      severity: "info",
    }, {
      code: "deleted-person-skipped",
      message:
        "1 contact was imported before and its person was deleted since; it will be skipped and stay deleted.",
      severity: "skipped",
    }],
  );
  recorded.calls.length = 0;
  assertEquals(await imports.commit(actor, "run", true), {
    importId: "run",
    peopleCreated: 0,
    peopleReused: 1,
    peopleSkippedDeleted: 1,
    status: "completed",
  });
  // Neither person is written to, the deleted one's details and note
  // included; both keep their identity for the next run.
  assertEquals(recorded.calls, [
    ["retarget", "entity-Ada", "kept"],
    ["retarget", "entity-Bob", "deleted"],
  ]);
});
