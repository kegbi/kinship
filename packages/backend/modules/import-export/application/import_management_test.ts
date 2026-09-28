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
  actors: { revalidate: () => Promise.resolve("active" as const) },
  audit: { record: () => Promise.resolve() },
  contactTypes: { byKind: () => Promise.resolve({}) },
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

Deno.test("[IMPORT-001] reports Monica introducer references as explicitly skipped", async () => {
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
  if (
    result.status !== "dry_run" || unsupported !== 1 ||
    !result.report.diagnostics.some((item) =>
      item.code === "unsupported-data" && item.severity === "skipped"
    )
  ) throw new Error("dropped introducer was falsely declared supported");
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
