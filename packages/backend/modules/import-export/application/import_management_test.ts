import { createImportManagement, type ImportRepository } from "../public.ts";
import { assertEquals } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";

const actor = fixtures.actor({ role: "admin" });
const ids = [
  "00000000-0000-4000-8000-000000000010",
  "00000000-0000-4000-8000-000000000011",
  "00000000-0000-4000-8000-000000000012",
  "00000000-0000-4000-8000-000000000013",
];
const owners = {
  choices: {
    options: () =>
      Promise.resolve({
        currencies: ["EUR", "USD", "JPY", "KWD"],
        genders: [],
      }),
    setTimezone: () => Promise.resolve(),
  },
  actors: { revalidate: () => Promise.resolve("active" as const) },
  audit: { record: () => Promise.resolve() },
  contactTypes: {
    forImport: () => Promise.resolve([]),
    createForImport: () => Promise.resolve("created-type"),
    byKind: () => Promise.resolve({}),
  },
  contacts: {
    history: () => Promise.resolve({ fileImportedBefore: false, matches: [] }),
    lockPendingCsv: () => Promise.resolve(undefined),
    mapCsv: () => Promise.resolve(),
    stageContacts: () => Promise.resolve(),
    stagePendingCsv: () => Promise.resolve(),
  },
  files: { representMissing: () => Promise.resolve() },
  notes: { addNote: () => Promise.resolve() },
  people: {
    addContactMethods: () => Promise.resolve(),
    addDetails: () => Promise.resolve(),
    create: () => Promise.resolve(),
    presence: () => Promise.resolve("active" as const),
    linkAvatar: () => Promise.resolve(),
  },
};

Deno.test("[IMPORT-001] Monica JSON dry-run redacts credentials and commits idempotently", async () => {
  const staged: unknown[] = [];
  let commits = 0;
  const repository: ImportRepository = {
    complete: () => Promise.resolve(),
    prepareCommit: (_actor, importId) => {
      commits++;
      return Promise.resolve({
        avatars: commits === 1
          ? [{
            byteSize: 123,
            fileId: ids[1]!,
            originalFilename: "avatars/ada.png",
            personSourcePrimaryKey: "42",
          }]
          : [],
        contacts: [{
          archived: false,
          entityId: ids[3]!,
          familyName: "Lovelace",
          givenName: "Ada",
          isDeceased: false,
          isPartial: false,
          isStarred: false,
          ...(commits !== 1 ? { previousTargetPersonId: ids[2]! } : {}),
          sourcePrimaryKey: "42",
          targetPersonId: ids[2]!,
        }],
        importId,
        status: "ready" as const,
      });
    },
    get: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    retargetContact: () => Promise.resolve(),
    stage: (command) => {
      staged.push(command);
      return Promise.resolve({
        importId: command.importId,
        report: command.report,
        status: "dry_run" as const,
      });
    },
  };
  let id = 0;
  const imports = createImportManagement({
    ...owners,
    ids: { next: () => ids[id++]! },
    repository,
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  const source = {
    format: "monica-json",
    version: 1,
    tables: {
      contacts: [{
        id: 42,
        first_name: "Ada",
        last_name: "Lovelace",
        avatar_file_name: "avatars/ada.png",
      }],
      users: [{
        id: 7,
        email: "legacy@example.test",
        password: "legacy-hash",
        two_factor_secret: "legacy-totp",
      }],
    },
    attachments: [{
      path: "avatars/ada.png",
      byteSize: 123,
      present: false,
    }],
  };

  const dryRun = await imports.dryRun(actor, source);
  if (dryRun.status !== "dry_run") throw new Error("dry-run unavailable");
  if (
    dryRun.report.counts.contacts !== 1 ||
    dryRun.report.counts.missingFiles !== 1 ||
    dryRun.report.counts.orphans !== 0 ||
    dryRun.report.counts.legacyCredentialsDiscarded !== 1
  ) throw new Error(`unexpected report: ${JSON.stringify(dryRun)}`);
  const serialized = JSON.stringify(staged);
  if (
    serialized.includes("legacy-hash") || serialized.includes("legacy-totp")
  ) {
    throw new Error("legacy credentials reached staging");
  }
  const first = await imports.commit(actor, dryRun.importId, true);
  const rerun = await imports.dryRun(actor, source);
  if (rerun.status !== "dry_run") throw new Error("rerun unavailable");
  const second = await imports.commit(actor, rerun.importId, true);
  if (
    first.status !== "completed" || first.peopleCreated !== 1 ||
    second.status !== "completed" || second.peopleReused !== 1
  ) throw new Error("rerun was not idempotent");
});

Deno.test("[IMPORT-001] rejects unsupported, hostile, oversized, and unconfirmed imports", async () => {
  const repository: ImportRepository = {
    complete: () => Promise.resolve(),
    get: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    prepareCommit: () => Promise.resolve({ status: "not-found" as const }),
    retargetContact: () => Promise.resolve(),
    stage: () => {
      throw new Error("invalid source reached staging");
    },
  };
  const imports = createImportManagement({
    ...owners,
    ids: { next: () => crypto.randomUUID() },
    repository,
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  const unsupported = await imports.dryRun(actor, { format: "sql" });
  const hostile = await imports.dryRun(actor, {
    format: "monica-json",
    version: 1,
    tables: { contacts: [] },
    attachments: [{ path: "../secret", byteSize: 1, present: true }],
  });
  const oversized = await imports.dryRun(actor, {
    format: "monica-json",
    version: 1,
    tables: {
      contacts: Array.from({ length: 501 }, (_, id) => ({
        id,
        first_name: "Person",
      })),
    },
  });
  const unconfirmed = await imports.commit(actor, ids[0]!, false);
  if (
    unsupported.status !== "invalid-source" ||
    hostile.status !== "invalid-source" ||
    oversized.status !== "invalid-source" ||
    unconfirmed.status !== "confirmation-required"
  ) throw new Error("bounded import validation failed");
});

Deno.test("[IMPORT-001] rejects ambiguous identities, truncated text, and unrepresentable manifests", async () => {
  const repository: ImportRepository = {
    complete: () => Promise.resolve(),
    get: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    prepareCommit: () => Promise.resolve({ status: "not-found" as const }),
    retargetContact: () => Promise.resolve(),
    stage: () => Promise.reject(new Error("invalid source reached staging")),
  };
  const imports = createImportManagement({
    ...owners,
    ids: { next: () => crypto.randomUUID() },
    repository,
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  const contact = { id: 1, first_name: "Ada" };
  const invalid: unknown[] = [
    { ...contact, id: { nested: 1 } },
    { ...contact, description: "x".repeat(10_001) },
    { ...contact, is_starred: "1" },
    { ...contact, is_dead: {} },
  ].map((value) => ({
    format: "monica-json",
    version: 1,
    tables: { contacts: [value] },
  }));
  invalid.push({
    format: "monica-json",
    version: 1,
    tables: { contacts: [contact] },
    attachments: [{
      byteSize: 10 * 1024 * 1024 + 1,
      path: "avatars/ada.png",
      present: false,
    }],
  });
  for (const source of invalid) {
    if ((await imports.dryRun(actor, source)).status !== "invalid-source") {
      throw new Error("ambiguous or unrepresentable source was accepted");
    }
  }
});

Deno.test("[IMPORT-001] canonical UUID identities reject case-variant duplicates", async () => {
  const repository: ImportRepository = {
    complete: () => Promise.resolve(),
    get: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    prepareCommit: () => Promise.resolve({ status: "not-found" as const }),
    retargetContact: () => Promise.resolve(),
    stage: () => Promise.reject(new Error("duplicate UUID reached staging")),
  };
  const imports = createImportManagement({
    ...owners,
    ids: { next: () => crypto.randomUUID() },
    repository,
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  const lower = "deadbeef-0000-4000-8000-000000000042";
  const result = await imports.dryRun(actor, {
    format: "monica-json",
    version: 1,
    tables: {
      contacts: [{ id: 1, uuid: lower, first_name: "Ada" }, {
        id: 2,
        uuid: lower.toUpperCase(),
        first_name: "Grace",
      }],
    },
  });
  if (result.status !== "invalid-source") {
    throw new Error("case-variant UUID duplicate was accepted");
  }
});

Deno.test("[IMPORT-001] stages Monica introducer references as business records", async () => {
  let unsupported = -1;
  const repository: ImportRepository = {
    complete: () => Promise.resolve(),
    get: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    prepareCommit: () => Promise.resolve({ status: "not-found" as const }),
    retargetContact: () => Promise.resolve(),
    stage: (command) => {
      unsupported = command.report.counts.unsupported;
      return Promise.resolve({
        importId: command.importId,
        report: command.report,
        status: "dry_run" as const,
      });
    },
  };
  const imports = createImportManagement({
    ...owners,
    ids: { next: () => crypto.randomUUID() },
    repository,
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  const result = await imports.dryRun(actor, {
    format: "monica-json",
    version: 1,
    tables: {
      contacts: [
        { id: 1, first_name: "Ada", first_met_through_contact_id: 2 },
        {
          id: 2,
          first_name: "Grace",
        },
      ],
    },
  });
  assertEquals(result.status, "dry_run");
  assertEquals(unsupported, 0);
});

Deno.test("[IMPORT-001] reports unsupported fields while concealing admin reads from members", async () => {
  let stagedReport: import("../public.ts").ImportReport | undefined;
  const summary = {
    createdAt: "2026-08-23T10:00:00.000Z",
    importId: ids[0]!,
    report: {
      counts: {
        contacts: 1,
        legacyCredentialsDiscarded: 0,
        missingFiles: 0,
        orphans: 1,
        unsupported: 1,
      },
      diagnostics: [],
    },
    sourceProfile: "json_export" as const,
    sourceSystem: "monica" as const,
    status: "dry_run" as const,
  };
  const repository: ImportRepository = {
    complete: () => Promise.resolve(),
    get: () => Promise.resolve(summary),
    list: () => Promise.resolve([summary]),
    prepareCommit: () => Promise.resolve({ status: "not-found" as const }),
    retargetContact: () => Promise.resolve(),
    stage: (command) => {
      stagedReport = command.report;
      return Promise.resolve({
        importId: command.importId,
        report: command.report,
        status: "dry_run" as const,
      });
    },
  };
  const imports = createImportManagement({
    ...owners,
    ids: { next: () => crypto.randomUUID() },
    repository,
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  const result = await imports.dryRun(actor, {
    format: "monica-json",
    version: 1,
    tables: {
      contacts: [{
        id: 1,
        first_name: "Ada",
        first_met_through_contact_id: 999,
        obsolete_field: "reported",
      }],
    },
  });
  if (
    result.status !== "dry_run" || stagedReport?.counts.orphans !== 0 ||
    stagedReport.counts.unsupported !== 2 ||
    !stagedReport.diagnostics.some((item) => item.code === "unsupported-data")
  ) throw new Error("complete diagnostics unavailable");
  const history = await imports.list(actor);
  if (history.status !== "ready" || history.imports.length !== 1) {
    throw new Error("admin history unavailable");
  }
  if ((await imports.get(actor, ids[0]!)).status !== "ready") {
    throw new Error("admin report unavailable");
  }
  // The role rule lives in the domain and every path asks it (GAP-020), so a
  // member is refused rather than shown an empty history.
  const member = { ...actor, role: "member" as const };
  if (
    (await imports.list(member)).status !== "forbidden" ||
    (await imports.get(member, ids[0]!)).status !== "forbidden" ||
    (await imports.dryRun(member, {})).status !== "forbidden" ||
    (await imports.commit(member, ids[0]!, true)).status !== "forbidden"
  ) throw new Error("member import data was not concealed");
});

Deno.test("[IMPORT-001] refuses staging when active admin authority is lost", async () => {
  const repository: ImportRepository = {
    complete: () => Promise.resolve(),
    get: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    prepareCommit: () => Promise.resolve({ status: "not-found" as const }),
    retargetContact: () => Promise.resolve(),
    stage: () => Promise.reject(new Error("unauthorized staging")),
  };
  const imports = createImportManagement({
    ...owners,
    actors: { revalidate: () => Promise.resolve("revoked" as const) },
    ids: { next: () => crypto.randomUUID() },
    repository,
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  const source = {
    format: "monica-json",
    version: 1,
    tables: { contacts: [] },
  };
  if (
    (await imports.dryRun(actor, source)).status !== "forbidden" ||
    (await imports.commit(actor, ids[0]!, true)).status !== "forbidden"
  ) throw new Error("lost authority not enforced");
});

Deno.test("[IMPORT-001] a re-import keeps a deleted person deleted and reports them as skipped", async () => {
  const calls: unknown[] = [];
  const contact = (key: string, previous: string) => ({
    archived: false,
    entityId: `entity-${key}`,
    givenName: key,
    isDeceased: false,
    isPartial: false,
    isStarred: false,
    previousTargetPersonId: previous,
    sourcePrimaryKey: key,
    targetPersonId: `unused-${key}`,
  });
  const repository: ImportRepository = {
    complete: (_actor, _importId, counts) => {
      calls.push(["complete", counts]);
      return Promise.resolve();
    },
    get: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    prepareCommit: (_actor, importId) =>
      Promise.resolve({
        avatars: [{
          byteSize: 1,
          fileId: ids[1]!,
          originalFilename: "avatars/ada.png",
          personSourcePrimaryKey: "ada",
        }],
        contacts: [contact("ada", "deleted"), contact("bob", "kept")],
        importId,
        status: "ready" as const,
      }),
    retargetContact: (_importId, entityId, target) => {
      calls.push(["retarget", entityId, target]);
      return Promise.resolve();
    },
    stage: () => Promise.reject(new Error("unexpected staging")),
  };
  const standing = new Map([["deleted", "deleted"], ["kept", "active"]]);
  const imports = createImportManagement({
    ...owners,
    files: {
      representMissing: () => {
        calls.push(["representMissing"]);
        return Promise.resolve();
      },
    },
    ids: { next: () => crypto.randomUUID() },
    people: {
      addContactMethods: () => Promise.resolve(),
      addDetails: () => Promise.resolve(),
      create: (command) => {
        calls.push(["create", command.person.id]);
        return Promise.resolve();
      },
      linkAvatar: (command) => {
        calls.push(["linkAvatar", command.personId]);
        return Promise.resolve();
      },
      presence: (command) =>
        Promise.resolve(
          (standing.get(command.personId) ?? "absent") as
            | "absent"
            | "active"
            | "deleted",
        ),
    },
    repository,
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  assertEquals(await imports.commit(actor, ids[0]!, true), {
    importId: ids[0]!,
    peopleCreated: 0,
    peopleReused: 1,
    peopleSkippedDeleted: 1,
    status: "completed",
  });
  // The deleted person keeps the identity, so the next run lands on them
  // again, but nothing is created for them and their avatar is not linked.
  assertEquals(calls, [
    ["retarget", "entity-ada", "deleted"],
    ["retarget", "entity-bob", "kept"],
    ["complete", {
      peopleCreated: 0,
      peopleReused: 1,
      peopleSkippedDeleted: 1,
    }],
  ]);
});

Deno.test("[IMPORT-001] SQL dry-run reports workspace losses and commits separate notes", async () => {
  let staged: Parameters<ImportRepository["stage"]>[0] | undefined;
  const bodies: string[] = [];
  const repository: ImportRepository = {
    complete: () => Promise.resolve(),
    get: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    retargetContact: () => Promise.resolve(),
    stage: (command) => {
      staged = command;
      return Promise.resolve({
        importId: command.importId,
        report: command.report,
        status: "dry_run",
      });
    },
    prepareCommit: (_actor, importId) =>
      Promise.resolve({
        avatars: [],
        businessEntities: staged!.businessEntities ?? [],
        contacts: staged!.contacts.map((contact) => ({
          ...contact,
          entityId: crypto.randomUUID(),
        })),
        importId,
        status: "ready",
      }),
  };
  const imports = createImportManagement({
    ...owners,
    ids: { next: () => crypto.randomUUID() },
    business: {
      people: { importRecords: () => Promise.resolve() },
      interactions: {
        importRecords: (command) => {
          for (const r of command.records) {
            if (r.data.kind === "note") bodies.push(String(r.data.body));
          }
          return Promise.resolve();
        },
      },
    },
    notes: {
      addNote: (command) => {
        bodies.push(command.body);
        return Promise.resolve();
      },
    },
    repository,
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  const source = {
    format: "monica-sql",
    text:
      "INSERT INTO contacts (id,first_name,birthday_special_date_id,company) VALUES (1,'Ada',8,'Company without title'); INSERT INTO notes (contact_id,body,created_at) VALUES (1,'One','2020-01-01'),(1,'Two','2020-01-02'); INSERT INTO special_dates (id,contact_id,is_age_based,is_year_unknown,date) VALUES (8,1,1,0,'1980-01-01'); INSERT INTO contact_fields (contact_id,contact_field_type_id,data) VALUES (1,4,'ada@example.test'); INSERT INTO contact_field_types (id,type) VALUES (4,'email'); INSERT INTO relationships (id) VALUES (2);",
  };
  const dry = await imports.dryRun(actor, source);
  if (dry.status !== "dry_run") throw new Error("SQL dry run failed");
  assertEquals(staged?.sourceProfile, "sql_export");
  assertEquals(dry.report.counts.unsupported, 2);
  for (
    const code of [
      "unsupported-table",
      "contact-type-decisions",

      "age-based-date",
      "organization-without-title",
    ]
  ) {
    assertEquals(
      dry.report.diagnostics.some((item) => item.code === code),
      true,
      code,
    );
  }
  assertEquals(
    dry.report.diagnostics.find((item) => item.code === "unsupported-data")
      ?.message,
    "2 unsupported row(s) or field value(s) will be skipped.",
  );
  assertEquals(
    (await imports.commit(actor, dry.importId, true, [{
      sourceKey: ":4",
      action: "skip",
    }], { timezone: "UTC", currencies: [], genders: [] })).status,
    "completed",
  );
  assertEquals(bodies, ["One", "Two"]);
});

Deno.test("[IMPORT-001] missing default and custom types require approval before any writes", async () => {
  let staged: Parameters<ImportRepository["stage"]>[0] | undefined;
  const vocabulary: {
    id: string;
    name: string;
    kind: string;
    archived: boolean;
  }[] = [];
  const writes: string[] = [];
  const methods: unknown[] = [];
  const repository: ImportRepository = {
    complete: () => Promise.resolve(),
    get: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    retargetContact: () => Promise.resolve(),
    stage: (command) => {
      staged = command;
      return Promise.resolve({
        importId: command.importId,
        report: command.report,
        status: "dry_run",
      });
    },
    prepareCommit: (_actor, importId) =>
      Promise.resolve({
        status: "ready",
        importId,
        avatars: [],
        contacts: staged!.contacts.map((row) => ({
          ...row,
          entityId: "entity",
        })),
      }),
  };
  const imports = createImportManagement({
    ...owners,
    repository,
    ids: { next: () => crypto.randomUUID() },
    transaction: { run: (work) => work({ opaque: {} }) },
    contactTypes: {
      byKind: () => Promise.resolve({}),
      forImport: () => Promise.resolve(vocabulary),
      createForImport: (command) => {
        writes.push(command.name);
        vocabulary.push({
          id: command.name,
          name: command.name,
          kind: command.kind,
          archived: false,
        });
        return Promise.resolve(command.name);
      },
    },
    people: {
      ...owners.people,
      create: () => {
        writes.push("person");
        return Promise.resolve();
      },
      addDetails: (command) => {
        methods.push(...command.details.contactMethods);
        return Promise.resolve();
      },
    },
  });
  const dry = await imports.dryRun(actor, {
    format: "monica-sql",
    text:
      "INSERT INTO contacts (id,first_name) VALUES (1,'Example'); INSERT INTO contact_field_types (id,name,type,protocol) VALUES (1,'Email','email','mailto'),(2,'Phone','phone','tel'),(3,'Chat','custom','chat'); INSERT INTO contact_fields (contact_id,contact_field_type_id,data) VALUES (1,1,'example@example.test'),(1,2,'5550100'),(1,3,'example-chat');",
  });
  if (dry.status !== "dry_run") throw new Error("dry run failed");
  assertEquals(
    dry.report.contactMethodTypes?.proposals.map((type) => type.name),
    ["Email", "Phone", "Chat"],
  );
  assertEquals(writes, []);
  assertEquals(
    (await imports.commit(actor, dry.importId, true)).status,
    "contact-type-decision-required",
  );
  assertEquals(
    (await imports.commit(actor, dry.importId, true, [{
      sourceKey: ":1",
      action: "create",
    }])).status,
    "contact-type-decision-required",
  );
  assertEquals(writes, []);
  const choices = dry.report.contactMethodTypes!.proposals.map((type) => ({
    sourceKey: type.key,
    action: "create" as const,
  }));
  assertEquals(
    (await imports.commit(actor, dry.importId, true, choices)).status,
    "completed",
  );
  assertEquals(writes, ["Email", "Phone", "Chat", "person"]);
  assertEquals(methods, [{ typeId: "Email", value: "example@example.test" }, {
    typeId: "Phone",
    value: "5550100",
  }, { typeId: "Chat", value: "example-chat" }]);
  const repeated = await imports.dryRun(actor, {
    format: "monica-sql",
    text:
      "INSERT INTO contacts (id,first_name) VALUES (2,'Other'); INSERT INTO contact_field_types (id,name,type) VALUES (3,'Chat','custom'); INSERT INTO contact_fields (contact_id,contact_field_type_id,data) VALUES (2,3,'other-chat');",
  });
  if (repeated.status !== "dry_run") throw new Error("repeat failed");
  assertEquals(repeated.report.contactMethodTypes, undefined);
  vocabulary[2]!.archived = true;
  assertEquals(
    (await imports.commit(actor, repeated.importId, true)).status,
    "contact-type-decision-required",
  );
  assertEquals(
    (await imports.commit(actor, repeated.importId, true, [{
      sourceKey: ":3",
      action: "map",
      typeId: "foreign-type",
    }])).status,
    "contact-type-decision-required",
  );
  assertEquals(writes, ["Email", "Phone", "Chat", "person"]);
});

Deno.test("[IMPORT-001] a reused active Monica person gains newly approved methods without replacing details", async () => {
  const enriched: unknown[] = [];
  let deleted = false;
  const people = {
    ...owners.people,
    presence: () =>
      Promise.resolve(deleted ? "deleted" as const : "active" as const),
    addContactMethods: (command: { readonly methods: unknown }) => {
      enriched.push(command.methods);
      return Promise.resolve();
    },
    addDetails: () => {
      throw new Error("existing details must remain unchanged");
    },
  };
  const imports = createImportManagement({
    ...owners,
    people,
    ids: { next: () => crypto.randomUUID() },
    transaction: { run: (work) => work({ opaque: {} }) },
    repository: {
      complete: () => Promise.resolve(),
      get: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      stage: () => {
        throw new Error("unused");
      },
      retargetContact: () => Promise.resolve(),
      prepareCommit: (_actor, importId) =>
        Promise.resolve({
          status: "ready",
          importId,
          avatars: [],
          contacts: [{
            entityId: "row",
            previousTargetPersonId: "person",
            targetPersonId: "new-person",
            sourcePrimaryKey: "1",
            archived: false,
            givenName: "Example",
            isDeceased: false,
            isPartial: false,
            isStarred: false,
            contact: {
              givenName: "Example",
              addresses: [],
              dates: [],
              emails: [],
              phones: [],
              urls: [],
              contactMethods: [{
                sourceType: { key: ":1", name: "Chat", kind: "custom" },
                value: "synthetic-handle",
              }],
            },
          }],
        }),
    },
  });
  assertEquals(
    (await imports.commit(actor, "run", true, [{
      sourceKey: ":1",
      action: "create",
    }])).status,
    "completed",
  );
  assertEquals(enriched, [[{
    typeId: "created-type",
    value: "synthetic-handle",
  }]]);
  deleted = true;
  await imports.commit(actor, "run", true, [{
    sourceKey: ":1",
    action: "create",
  }]);
  assertEquals(enriched.length, 1);
});

Deno.test("[IMPORT-001] unused source catalog is staged and all choices resolve without people", async () => {
  for (const action of ["create", "map", "skip"] as const) {
    let staged: Parameters<ImportRepository["stage"]>[0] | undefined;
    const created: unknown[] = [];
    const repository: ImportRepository = {
      complete: () => Promise.resolve(),
      get: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      retargetContact: () => Promise.resolve(),
      stage: (command) => {
        staged = command;
        return Promise.resolve({
          status: "dry_run",
          importId: command.importId,
          report: command.report,
        });
      },
      prepareCommit: (_actor, importId) =>
        Promise.resolve({
          status: "ready",
          importId,
          contacts: [],
          avatars: [],
          contactTypeCatalog: staged!.contactTypeCatalog!,
        }),
    };
    const imports = createImportManagement({
      ...owners,
      repository,
      ids: { next: () => crypto.randomUUID() },
      transaction: { run: (work) => work({ opaque: {} }) },
      contactTypes: {
        ...owners.contactTypes,
        forImport: () =>
          Promise.resolve([{
            id: "existing",
            name: "Other",
            kind: "custom",
            archived: false,
          }]),
        createForImport: (command) => {
          created.push(command);
          return Promise.resolve("created");
        },
      },
      people: {
        ...owners.people,
        create: () => {
          throw new Error("catalog must not invent a person");
        },
      },
    });
    const actual = await imports.dryRun(actor, {
      format: "monica-json",
      version: 1,
      tables: {
        contacts: [],
        contact_field_types: [{
          id: 1,
          name: "Unused",
          type: "custom",
          fontawesome_icon: "fa-chat",
          delible: 0,
          created_at: "2020-01-02 03:04:05",
          updated_at: "2021-02-03 04:05:06",
        }],
      },
    });
    if (actual.status !== "dry_run") throw new Error("catalog dry run failed");
    assertEquals(actual.report.contactMethodTypes?.proposals[0]?.count, 0);
    assertEquals(created, []);
    assertEquals(
      (await imports.commit(actor, actual.importId, true)).status,
      "contact-type-decision-required",
    );
    assertEquals(
      (await imports.commit(actor, actual.importId, true, [{
        sourceKey: ":1",
        action,
        ...(action === "map" ? { typeId: "existing" } : {}),
      }])).status,
      "completed",
    );
    assertEquals(created.length, action === "create" ? 1 : 0);
    if (action === "create") {
      const command = created[0] as Record<string, unknown>;
      assertEquals([
        command.icon,
        command.canDelete,
        command.createdAt,
        command.updatedAt,
      ], [
        "fa-chat",
        false,
        "2020-01-02T03:04:05.000Z",
        "2021-02-03T04:05:06.000Z",
      ]);
    }
  }
});

Deno.test("[IMPORT-001] complete live Monica decisions are validated before configuration writes and committed transactionally", async () => {
  let staged: Parameters<ImportRepository["stage"]>[0];
  const writes: string[] = [];
  const records: Readonly<Record<string, unknown>>[] = [];
  const transaction = { opaque: {} };
  const repository: ImportRepository = {
    stage: (c) => {
      staged = c;
      return Promise.resolve({
        status: "dry_run",
        importId: c.importId,
        report: c.report,
      });
    },
    prepareCommit: (_actor, importId) =>
      Promise.resolve({
        status: "ready",
        importId,
        contacts: staged.contacts.map((c) => ({
          ...c,
          entityId: c.targetPersonId,
        })),
        avatars: [],
        businessEntities: staged.businessEntities!,
        contactTypeCatalog: staged.contactTypeCatalog!,
      }),
    complete: () => {
      writes.push("complete");
      return Promise.resolve();
    },
    get: () => Promise.resolve(undefined),
    list: () => Promise.resolve([]),
    retargetContact: () => Promise.resolve(),
    retargetBusinessEntity: () => Promise.resolve(),
  };
  const imports = createImportManagement({
    ...owners,
    repository,
    ids: { next: () => crypto.randomUUID() },
    transaction: { run: (work) => work(transaction) },
    contactTypes: {
      ...owners.contactTypes,
      createForImport: () => {
        writes.push("type");
        return Promise.resolve("type");
      },
    },
    choices: {
      options: () =>
        Promise.resolve({ currencies: ["JPY", "KWD"], genders: [] }),
      setTimezone: (c) => {
        assertEquals(c.transaction, transaction);
        writes.push(c.timezone);
        return Promise.resolve();
      },
    },
    planning: {
      timezoneChanged: (_actor, tx) => {
        assertEquals(tx, transaction);
        writes.push("reschedule");
        return Promise.resolve();
      },
    },
    business: {
      workspaces: {
        importRecords: (c) => {
          writes.push("gender");
          return Promise.resolve(
            Object.fromEntries(c.records.map((r) => [r.id, "created-gender"])),
          );
        },
      },
      people: {
        importRecords: (c) => {
          records.push(
            ...c.records.map((r) => ({ ...r.data, refs: r.references })),
          );
          return Promise.resolve();
        },
      },
      gifts: {
        importRecords: (c) => {
          records.push(...c.records.map((r) => r.data));
          return Promise.resolve();
        },
      },
    },
  });
  const dry = await imports.dryRun(actor, {
    format: "monica-sql",
    text:
      "INSERT INTO contacts(id,first_name,gender_id) VALUES(1,'Ada',999); INSERT INTO debts(id,contact_id,amount,currency_id,in_debt,status) VALUES(1,1,12345,NULL,'yes','open'),(2,1,888,999,'no','open'); INSERT INTO contact_field_types(id,name,type) VALUES(1,'Chat','custom');",
  });
  if (dry.status !== "dry_run") throw new Error("dry-run failed");
  assertEquals(dry.report.monicaChoices?.debts.length, 2);
  assertEquals(dry.report.monicaChoices?.contacts.length, 1);
  const types = [{ sourceKey: ":1", action: "create" as const }];
  const choices = {
    timezone: "Asia/Tokyo",
    currencies: [{ sourceKey: "1", currencyCode: "JPY" }, {
      sourceKey: "2",
      currencyCode: "KWD",
    }],
    genders: [{ sourceKey: "1", action: "create" as const, name: "Custom" }],
  };
  for (
    const invalid of [undefined, { ...choices, currencies: [] }, {
      ...choices,
      currencies: [choices.currencies[0]!, choices.currencies[0]!],
    }, {
      ...choices,
      genders: [{
        sourceKey: "1",
        action: "map" as const,
        genderId: "foreign",
      }],
    }]
  ) {
    assertEquals(
      (await imports.commit(actor, dry.importId, true, types, invalid)).status,
      "monica-choice-required",
    );
    assertEquals(writes, []);
  }
  assertEquals(
    (await imports.commit(actor, dry.importId, true, [], choices)).status,
    "contact-type-decision-required",
  );
  assertEquals(writes, []);
  assertEquals(
    (await imports.commit(actor, dry.importId, true, types, choices)).status,
    "completed",
  );
  assertEquals(writes, [
    "gender",
    "Asia/Tokyo",
    "reschedule",
    "type",
    "complete",
  ]);
  assertEquals(records.filter((r) => r.kind === "debt").map((r) => r.amount), [
    "12345",
    "0.888",
  ]);
  assertEquals(records.find((r) => r.kind === "profile")?.refs, {
    personId: staged!.contacts[0]!.targetPersonId,
    genderId: "created-gender",
  });
  for (const currency_code of ["EUR", "ZZZ"]) {
    const unavailable = await imports.dryRun(actor, {
      format: "monica-json",
      version: 1,
      tables: {
        contacts: [{ id: 1, first_name: "Ada" }],
        debts: [{
          id: 1,
          contact_id: 1,
          amount: "12.345",
          currency_code,
          in_debt: "yes",
          status: "open",
        }],
      },
    });
    if (unavailable.status !== "dry_run") {
      throw new Error("currency review failed");
    }
    assertEquals(
      unavailable.report.monicaChoices?.debts[0]?.rawAmount,
      "12.345",
    );
    assertEquals(unavailable.report.counts.unsupported, 0);
  }
});
