import { PostgresImportChoicesBoundary } from "../../packages/backend/modules/workspaces/adapters/postgres/import_choices.ts";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  createImportManagement,
} from "../../packages/backend/modules/import-export/public.ts";
import {
  type ImportAudit,
  importAuditFrom,
} from "../../packages/backend/modules/governance/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  PostgresActorRevalidation,
} from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import {
  PostgresImportRepository,
  PostgresImportTransaction,
} from "../../packages/backend/modules/import-export/adapters/postgres/import_repository.ts";
import { PostgresContactImportRepository } from "../../packages/backend/modules/import-export/adapters/postgres/contact_import_repository.ts";
import { PostgresInteractionImportBoundary } from "../../packages/backend/modules/interactions/adapters/postgres/import_note_boundary.ts";
import { PostgresContactMethodTypeCatalog } from "../../packages/backend/modules/workspaces/adapters/postgres/contact_method_types.ts";
import {
  PostgresPeopleImportBoundary,
} from "../../packages/backend/modules/people/adapters/postgres/import_people_boundary.ts";
import {
  PostgresFileImportBoundary,
} from "../../packages/backend/modules/files/adapters/postgres/import_file_boundary.ts";
import {
  PostgresAuditEventRecorder,
} from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  revocableActor,
  revokeMembership,
} from "../support/database.ts";
import { apiSupport, type SignedInFixture } from "../support/api.ts";

/**
 * The reminder publisher the people import boundary requires. A Monica
 * contact carries no dates, so these suites never reach it.
 */
const monicaDates = {
  regenerate: () =>
    Promise.reject(new Error("A Monica import regenerated a reminder.")),
};

function commitMonica(
  imports: ReturnType<typeof createImportManagement>,
  ...args: Parameters<ReturnType<typeof createImportManagement>["commit"]>
) {
  return imports.commit(
    args[0],
    args[1],
    args[2],
    args[3],
    args[4] ?? { timezone: "UTC", currencies: [], genders: [] },
  );
}

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl);
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
type Fixture = SignedInFixture;
const api = apiSupport(configured.app, mail, sql);
const register = (email: string) =>
  api.register(email, email, { firstName: "Import", lastName: "Admin" });
function request(
  fixture: Fixture,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
) {
  return api.request(fixture, path, method, body);
}
const source = {
  format: "monica-json",
  version: 1,
  tables: {
    contacts: [{
      id: "customer:42",
      uuid: "00000000-0000-4000-8000-000000000042",
      first_name: "Ada",
      last_name: "Lovelace",
      nickname: "Enchantress",
      is_starred: 1,
      avatar_file_name: "avatars/ada.png",
      default_avatar_color: "#B3D5FE",
    }],
    users: [{
      id: 7,
      email: "legacy-login@example.test",
      password: "legacy-hash",
      two_factor_secret: "legacy-totp",
      remember_token: "legacy-session",
    }],
  },
  attachments: [{ path: "avatars/ada.png", byteSize: 123, present: false }],
};

Deno.test("[IMPORT-001] PostgreSQL import is tenant-safe, atomic, idempotent, and leaves legacy credentials inactive", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(`import-${suffix}@example.test`);
  const foreign = await register(`import-foreign-${suffix}@example.test`);
  const dry = await request(primary, "/api/v1/imports/dry-runs", "POST", {
    source,
  });
  const dryBody = await dry.json() as {
    importId: string;
    report: {
      counts: {
        contacts: number;
        legacyCredentialsDiscarded: number;
        missingFiles: number;
        orphans: number;
      };
    };
  };
  assert(
    dry.status === 201 && dryBody.report.counts.contacts === 1 &&
      dryBody.report.counts.missingFiles === 1 &&
      dryBody.report.counts.legacyCredentialsDiscarded === 1,
    "canonical dry-run report persisted",
  );
  assert(
    (await request(foreign, `/api/v1/imports/${dryBody.importId}`, "GET"))
      .status === 404,
    "foreign report concealed",
  );
  assert(
    (await request(
      foreign,
      `/api/v1/imports/${dryBody.importId}/commit`,
      "POST",
      {
        confirmed: true,
        monicaChoices: { timezone: "UTC", currencies: [], genders: [] },
      },
    )).status === 404,
    "foreign commit concealed",
  );
  const committed = await request(
    primary,
    `/api/v1/imports/${dryBody.importId}/commit`,
    "POST",
    {
      confirmed: true,
      monicaChoices: { timezone: "UTC", currencies: [], genders: [] },
    },
  );
  const committedBody = await committed.json() as {
    peopleCreated: number;
    peopleReused: number;
  };
  assert(
    committed.status === 200 && committedBody.peopleCreated === 1 &&
      committedBody.peopleReused === 0,
    "first import atomically creates person",
  );
  const [person] = await sql<
    {
      id: string;
      given_name: string;
      family_name: string;
      is_starred: boolean;
    }[]
  >`select id::text, given_name, family_name, is_starred from crm.people where workspace_id = ${primary.workspaceId}::uuid and given_name = 'Ada'`;
  assert(
    person?.family_name === "Lovelace" && person.is_starred,
    "canonical contacts mapping committed",
  );
  const [avatar] = await sql<
    { status: string; storage_key: string | null }[]
  >`select file.status, file.storage_key from crm.files file join crm.person_avatars avatar on avatar.file_id = file.id where avatar.person_id = ${person.id}::uuid`;
  assert(
    avatar?.status === "missing" && avatar.storage_key === null,
    "manifest creates recoverable missing metadata without unsafe object key",
  );
  const [presentation] = await sql<
    { background_color: string | null; source: string }[]
  >`select background_color, source from crm.person_avatars where person_id = ${person.id}::uuid`;
  assert(
    presentation?.background_color === "#b3d5fe" &&
      presentation.source === "file",
    "[GAP-045] the Monica avatar colour lands in person_avatars beside the file avatar",
  );
  const [leaked] = await sql<
    { leaked: boolean }[]
  >`select exists (select 1 from crm.data_import_entities where import_id = ${dryBody.importId}::uuid and raw_snapshot::text ~ 'legacy-hash|legacy-totp|legacy-session') as leaked`;
  const [legacyIdentity] = await sql<
    { count: string }[]
  >`select count(*)::text as count from crm.users where lower(email) = 'legacy-login@example.test'`;
  assert(
    leaked?.leaked === false && legacyIdentity?.count === "0",
    "legacy credentials neither staged nor activated",
  );

  const rerun = await request(primary, "/api/v1/imports/dry-runs", "POST", {
    source,
  });
  const rerunBody = await rerun.json() as { importId: string };
  const repeated = await request(
    primary,
    `/api/v1/imports/${rerunBody.importId}/commit`,
    "POST",
    {
      confirmed: true,
      monicaChoices: { timezone: "UTC", currencies: [], genders: [] },
    },
  );
  const repeatedBody = await repeated.json() as {
    peopleCreated: number;
    peopleReused: number;
  };
  const [people] = await sql<
    { count: string }[]
  >`select count(*)::text as count from crm.people where workspace_id = ${primary.workspaceId}::uuid and given_name = 'Ada'`;
  assert(
    repeated.status === 200 && repeatedBody.peopleCreated === 0 &&
      repeatedBody.peopleReused === 1 && people?.count === "1",
    "same source identity rerun is idempotent",
  );
  const [audits] = await sql<
    { actions: string[] }[]
  >`select array_agg(action order by occurred_at, id) as actions from crm.audit_events where workspace_id = ${primary.workspaceId}::uuid and subject_id in (${dryBody.importId}::uuid, ${rerunBody.importId}::uuid)`;
  assert(
    audits?.actions.includes("import.started") &&
      audits.actions.includes("import.validated") &&
      audits.actions.includes("import.committed"),
    "import lifecycle audited",
  );
});

Deno.test("[IMPORT-001] owning-boundary failure rolls back every commit effect and permits retry", async () => {
  const fixture = await register(
    `import-rollback-${crypto.randomUUID()}@example.test`,
  );
  const connection = connectDatabase(databaseUrl);
  const persistedAudit = importAuditFrom(new PostgresAuditEventRecorder());
  let failCommittedAudit = true;
  const audit: ImportAudit = {
    async record(command) {
      await persistedAudit.record(command);
      if (command.action === "committed" && failCommittedAudit) {
        throw new Error("deterministic import audit failure");
      }
    },
  };
  const imports = createImportManagement({
    choices: new PostgresImportChoicesBoundary(),
    actors: new PostgresActorRevalidation(),
    audit,
    contactTypes: new PostgresContactMethodTypeCatalog(),
    contacts: new PostgresContactImportRepository(),
    files: new PostgresFileImportBoundary(),
    ids: { next: () => crypto.randomUUID() },
    notes: new PostgresInteractionImportBoundary(),
    people: new PostgresPeopleImportBoundary(
      monicaDates,
      new PostgresContactMethodTypeCatalog(),
    ),
    repository: new PostgresImportRepository(connection.db),
    transaction: new PostgresImportTransaction(connection.db),
  });
  const actor = {
    memberId: fixture.memberId,
    role: "owner" as const,
    userId: fixture.userId,
    workspaceId: fixture.workspaceId,
  };
  try {
    const staged = await imports.dryRun(actor, source);
    assert(staged.status === "dry_run", "rollback fixture staged");
    let failed = false;
    try {
      await commitMonica(imports, actor, staged.importId, true);
    } catch (error) {
      failed = error instanceof Error &&
        error.message === "deterministic import audit failure";
    }
    assert(failed, "owning boundary failed after recording commit audit");
    const [rolledBack] = await sql<
      {
        committed_audits: string;
        files: string;
        people: string;
        person_avatars: string;
        status: string;
      }[]
    >`select run.status, (select count(*)::text from crm.people person where person.workspace_id = run.workspace_id and person.given_name = 'Ada') as people, (select count(*)::text from crm.files file where file.workspace_id = run.workspace_id and file.metadata->>'importId' = run.id::text) as files, (select count(*)::text from crm.person_avatars avatar join crm.people person on person.id = avatar.person_id where person.workspace_id = run.workspace_id and person.given_name = 'Ada') as person_avatars, (select count(*)::text from crm.audit_events event where event.workspace_id = run.workspace_id and event.subject_id = run.id and event.action = 'import.committed') as committed_audits from crm.data_imports run where run.id = ${staged.importId}::uuid`;
    assert(
      rolledBack?.status === "dry_run" && rolledBack.people === "0" &&
        rolledBack.files === "0" && rolledBack.person_avatars === "0" &&
        rolledBack.committed_audits === "0",
      `commit transaction leaked effects: ${JSON.stringify(rolledBack)}`,
    );
    const [rolledBackPreference] =
      await sql`select timezone from crm.member_preferences where member_id=${actor.memberId}::uuid`;
    assertEquals(
      rolledBackPreference?.timezone ?? null,
      null,
      "failed import does not save the timezone",
    );
    failCommittedAudit = false;
    const retried = await commitMonica(imports, actor, staged.importId, true);
    assert(
      retried.status === "completed" && retried.peopleCreated === 1,
      "same dry-run succeeds after owning boundary recovers",
    );
    const [committed] = await sql<
      { audits: string; files: string; people: string; status: string }[]
    >`select run.status, (select count(*)::text from crm.people person where person.workspace_id = run.workspace_id and person.given_name = 'Ada') as people, (select count(*)::text from crm.files file where file.workspace_id = run.workspace_id and file.metadata->>'importId' = run.id::text) as files, (select count(*)::text from crm.audit_events event where event.workspace_id = run.workspace_id and event.subject_id = run.id and event.action = 'import.committed') as audits from crm.data_imports run where run.id = ${staged.importId}::uuid`;
    assert(
      committed?.status === "completed" && committed.people === "1" &&
        committed.files === "1" && committed.audits === "1",
      "successful retry atomically persists owner effects",
    );
  } finally {
    await connection.destroy();
  }
});

// --- GAP-009 -------------------------------------------------------------

Deno.test({
  name:
    "[IMPORT-001] GAP-009 a revoked member cannot stage or commit an import",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        sql,
        `import-revocation-${crypto.randomUUID()}`,
      );
      const imports = createImportManagement({
        choices: new PostgresImportChoicesBoundary(),
        actors: new PostgresActorRevalidation(),
        audit: importAuditFrom(new PostgresAuditEventRecorder()),
        contactTypes: new PostgresContactMethodTypeCatalog(),
        contacts: new PostgresContactImportRepository(),
        files: new PostgresFileImportBoundary(),
        ids: { next: () => crypto.randomUUID() },
        notes: new PostgresInteractionImportBoundary(),
        people: new PostgresPeopleImportBoundary(
          monicaDates,
          new PostgresContactMethodTypeCatalog(),
        ),
        repository: new PostgresImportRepository(connection.db),
        transaction: new PostgresImportTransaction(connection.db),
      });
      const source = {
        format: "monica-json",
        tables: { contacts: [] },
        version: 1,
      };

      const allowed = await imports.dryRun(actor, source);
      assert(allowed.status === "dry_run", "an active member stages an import");

      await revokeMembership(sql, actor.memberId);

      const refusedDryRun = await imports.dryRun(actor, source);
      const refusedCommit = await commitMonica(
        imports,
        actor,
        allowed.status === "dry_run" ? allowed.importId : crypto.randomUUID(),
        true,
      );
      assert(
        refusedDryRun.status === "forbidden" &&
          refusedCommit.status === "forbidden",
        "a revoked member still reached the importer",
      );
      const history = await imports.list(actor);
      const report = await imports.get(
        actor,
        allowed.status === "dry_run" ? allowed.importId : crypto.randomUUID(),
      );
      assert(
        history.status === "ready" && history.imports.length === 0 &&
          report.status === "not-found",
        "a revoked member still read import history",
      );
    } finally {
      await connection.destroy();
    }
  },
});
/** Deletes a person as a member does: read the impact, then confirm it. */
async function deletePerson(fixture: Fixture, personId: string) {
  const impact = await api.request(
    fixture,
    `/api/v1/people/${personId}/deletion-impact`,
  );
  const { impact: body } = await impact.json() as {
    readonly impact: {
      readonly confirmation: string;
      readonly person: { readonly updatedAt: string };
    };
  };
  const deleted = await api.request(
    fixture,
    `/api/v1/people/${personId}`,
    "DELETE",
    {
      confirmation: body.confirmation,
      expectedUpdatedAt: body.person.updatedAt,
    },
  );
  assertEquals(deleted.status, 200, "the member deletes the person");
}

/** Archives a person as a member does. */
async function archivePerson(fixture: Fixture, personId: string) {
  const identity = await api.request(fixture, `/api/v1/people/${personId}`);
  const { person } = await identity.json() as {
    readonly person: { readonly updatedAt: string };
  };
  const archived = await api.request(
    fixture,
    `/api/v1/people/${personId}/archive`,
    "POST",
    { expectedUpdatedAt: person.updatedAt },
  );
  assertEquals(archived.status, 200, "the member archives the person");
}

Deno.test("[IMPORT-001] a re-import leaves a deleted person deleted, reuses an archived one, and says so", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(`import-deleted-${suffix}@example.test`);
  const foreign = await register(
    `import-deleted-foreign-${suffix}@example.test`,
  );
  const twoContacts = {
    ...source,
    tables: {
      contacts: [
        source.tables.contacts[0],
        { id: "customer:43", first_name: "Grace", last_name: "Hopper" },
        // Already deleted in the Monica source: made deleted, then skipped.
        {
          id: "customer:44",
          first_name: "Alan",
          last_name: "Turing",
          deleted_at: "2020-01-01T00:00:00Z",
        },
      ],
    },
  };
  const importOnce = async (fixture: Fixture) => {
    const dry = await request(fixture, "/api/v1/imports/dry-runs", "POST", {
      source: twoContacts,
    });
    const { importId } = await dry.json() as { importId: string };
    const commit = () =>
      request(fixture, `/api/v1/imports/${importId}/commit`, "POST", {
        confirmed: true,
        monicaChoices: { timezone: "UTC", currencies: [], genders: [] },
      });
    const committed = await commit();
    assertEquals(committed.status, 200);
    const body = await committed.json() as Record<string, unknown>;
    // Committing the same run again answers with the same report.
    assertEquals(await (await commit()).json(), body);
    const { importId: _, status, ...counts } = body;
    assertEquals(status, "completed");
    return counts;
  };
  const counts = (created: number, reused: number, deleted: number) => ({
    peopleCreated: created,
    peopleReused: reused,
    peopleSkippedDeleted: deleted,
  });
  assertEquals(await importOnce(primary), counts(3, 0, 0));
  const people = await sql<{ given_name: string; id: string }[]>`
    select id::text, given_name from crm.people
    where workspace_id = ${primary.workspaceId}::uuid order by given_name`;
  const [ada, alan, grace] = people;
  assert(
    ada?.given_name === "Ada" && alan?.given_name === "Alan" &&
      grace?.given_name === "Grace",
    "three",
  );
  await deletePerson(primary, ada.id);
  await archivePerson(primary, grace.id);
  const before = await sql<{ files: string }[]>`
    select count(*)::text as files from crm.files
    where workspace_id = ${primary.workspaceId}::uuid`;

  for (let run = 0; run < 2; run++) {
    assertEquals(
      await importOnce(primary),
      counts(0, 1, 2),
      `re-import ${run + 1} keeps both deleted people deleted`,
    );
  }
  const after = await sql<
    { archived: boolean; deleted: boolean; given_name: string }[]
  >`
    select given_name, deleted_at is not null as deleted,
      archived_at is not null as archived
    from crm.people where workspace_id = ${primary.workspaceId}::uuid
    order by given_name`;
  assertEquals(after, [
    { given_name: "Ada", deleted: true, archived: false },
    { given_name: "Alan", deleted: true, archived: false },
    { given_name: "Grace", deleted: false, archived: true },
  ]);
  // Nothing from Ada's row, her avatar included, was represented again.
  assertEquals(
    await sql<{ files: string }[]>`
      select count(*)::text as files from crm.files
      where workspace_id = ${primary.workspaceId}::uuid`,
    before,
  );
  const [stats] = await sql<{ skipped: string }[]>`
    select stats->>'peopleSkippedDeleted' as skipped from crm.data_imports
    where workspace_id = ${primary.workspaceId}::uuid
    order by completed_at desc limit 1`;
  assertEquals(stats?.skipped, "2", "the count is kept on the run");

  // The people boundary scopes `presence` by the actor's workspace, so
  // another workspace's deleted person is absent there.
  const connection = connectDatabase(databaseUrl);
  try {
    const presence = (fixture: Fixture, personId: string) =>
      new PostgresImportTransaction(connection.db).run((transaction) =>
        new PostgresPeopleImportBoundary(
          monicaDates,
          new PostgresContactMethodTypeCatalog(),
        ).presence({
          actor: {
            memberId: fixture.memberId,
            role: "owner",
            userId: fixture.userId,
            workspaceId: fixture.workspaceId,
          },
          personId,
          transaction,
        })
      );
    assertEquals(await presence(primary, ada.id), "deleted");
    assertEquals(await presence(primary, grace.id), "active");
    assertEquals(await presence(foreign, ada.id), "absent");
  } finally {
    await connection.destroy();
  }

  // Another workspace's deleted person decides nothing here.
  assertEquals(await importOnce(foreign), counts(3, 0, 0));
});

Deno.test("[IMPORT-001] SQL contacts and related details commit once through existing boundaries", async () => {
  const primary = await register(
    `sql-import-${crypto.randomUUID()}@example.test`,
  );
  for (const kind of ["email", "phone"]) {
    const created = await request(
      primary,
      "/api/v1/settings/personalization/contact-method-types",
      "POST",
      { name: kind, contactKind: kind },
    );
    assertEquals(created.status, 200);
  }
  const source = {
    format: "monica-sql",
    text: await Deno.readTextFile(
      new URL(
        "../../packages/backend/modules/import-export/domain/formats/fixtures/monica.sql",
        import.meta.url,
      ),
    ),
  };
  for (let run = 0; run < 2; run++) {
    const dry = await request(primary, "/api/v1/imports/dry-runs", "POST", {
      source,
    });
    assertEquals(dry.status, 201);
    const staged = await dry.json() as {
      importId: string;
      report: {
        counts: { contacts: number; missingFiles: number; orphans: number };
        diagnostics: { code: string; message: string }[];
      };
    };
    assertEquals(staged.report.counts.contacts, 2);
    assertEquals(staged.report.counts.missingFiles, 1);
    assertEquals(staged.report.counts.orphans, 1);
    assert(
      staged.report.diagnostics.some((item) =>
        item.code === "unsupported-table" &&
        item.message.startsWith("relationships:")
      ),
      "unsupported relationships are disclosed",
    );
    const committed = await request(
      primary,
      `/api/v1/imports/${staged.importId}/commit`,
      "POST",
      {
        confirmed: true,
        monicaChoices: { timezone: "UTC", currencies: [], genders: [] },
        contactMethodTypes: [{ sourceKey: "7:3", action: "create" }],
      },
    );
    assertEquals(committed.status, 200);
    const result = await committed.json() as {
      peopleCreated: number;
      peopleReused: number;
    };
    assertEquals(result.peopleCreated, run === 0 ? 2 : 0);
    assertEquals(result.peopleReused, run === 0 ? 0 : 2);
    const [counts] = await sql`
      select
        (select count(*)::int from crm.people where workspace_id = ${primary.workspaceId}::uuid) as people,
        (select count(*)::int from crm.notes where workspace_id = ${primary.workspaceId}::uuid) as notes,
        (select count(*)::int from crm.person_contact_methods m join crm.people p on p.id=m.person_id where p.workspace_id = ${primary.workspaceId}::uuid) as methods,
        (select count(*)::int from crm.person_addresses a join crm.people p on p.id=a.person_id where p.workspace_id = ${primary.workspaceId}::uuid) as addresses,
        (select count(*)::int from crm.person_dates d join crm.people p on p.id=d.person_id where p.workspace_id = ${primary.workspaceId}::uuid) as dates,
        (select count(*)::int from crm.person_occupations o join crm.people p on p.id=o.person_id where p.workspace_id = ${primary.workspaceId}::uuid) as occupations`;
    assertEquals(counts, {
      people: 2,
      notes: 2,
      methods: 3,
      addresses: 1,
      dates: 2,
      occupations: 1,
    });
    const [runRow] =
      await sql`select source_profile from crm.data_imports where id=${staged.importId}::uuid`;
    assertEquals(runRow?.source_profile, "sql_export");
    const entities =
      await sql`select raw_snapshot from crm.data_import_entities where import_id=${staged.importId}::uuid`;
    assert(
      !JSON.stringify(entities).includes("synthetic-"),
      "credential values never reach staging",
    );
  }
});

Deno.test("[IMPORT-001] approved vocabulary is atomic, tenant scoped, retired-safe and idempotent", async () => {
  const actor = await revocableActor(sql, `types-${crypto.randomUUID()}`, {
    role: "owner",
  });
  const foreign = await revocableActor(
    sql,
    `foreign-types-${crypto.randomUUID()}`,
    { role: "owner" },
  );
  const [foreignType] =
    await sql`insert into crm.contact_method_types(workspace_id,name,kind) values (${foreign.workspaceId},'Foreign','custom') returning id`;
  const connection = connectDatabase(databaseUrl);
  let fail = true;
  const imports = createImportManagement({
    choices: new PostgresImportChoicesBoundary(),
    actors: new PostgresActorRevalidation(),
    audit: {
      record: (command) => {
        if (fail && command.action === "committed") {
          throw new Error("rollback approved types");
        }
        return Promise.resolve();
      },
    },
    contactTypes: new PostgresContactMethodTypeCatalog(),
    contacts: new PostgresContactImportRepository(),
    files: new PostgresFileImportBoundary(),
    ids: { next: () => crypto.randomUUID() },
    notes: new PostgresInteractionImportBoundary(),
    people: new PostgresPeopleImportBoundary(
      monicaDates,
      new PostgresContactMethodTypeCatalog(),
    ),
    repository: new PostgresImportRepository(connection.db),
    transaction: new PostgresImportTransaction(connection.db),
  });
  const source = {
    format: "monica-sql",
    text:
      "INSERT INTO contacts(id,first_name) VALUES (1,'Synthetic'); INSERT INTO contact_field_types(id,name,type,protocol) VALUES (1,'Email','email','mailto'),(2,'Phone','phone','tel'),(3,'Chat','custom','chat'),(4,'Deferred','custom','chat'); INSERT INTO contact_fields(contact_id,contact_field_type_id,data) VALUES (1,1,'synthetic@example.test'),(1,2,'5550100'),(1,3,'synthetic-handle'),(1,4,'deferred-handle');",
  };
  const countTypes = async () =>
    (await sql`select count(*)::int as count from crm.contact_method_types where workspace_id=${actor.workspaceId}`)[
      0
    ]!.count;
  try {
    const dry = await imports.dryRun(actor, source);
    assert(dry.status === "dry_run", "types source stages");
    assertEquals(dry.report.contactMethodTypes?.proposals.length, 4);
    assertEquals(await countTypes(), 0, "dry run never creates configuration");
    const choices = dry.report.contactMethodTypes!.proposals.map((type) => ({
      sourceKey: type.key,
      action: type.key === ":4" ? "skip" as const : "create" as const,
    }));
    assertEquals(
      (await commitMonica(imports, actor, dry.importId, true, [{
        sourceKey: ":1",
        action: "map",
        typeId: foreignType!.id,
      }, ...choices.slice(1)])).status,
      "contact-type-decision-required",
    );
    assertEquals(
      await countTypes(),
      0,
      "foreign mappings fail before any creation",
    );
    let rolledBack = false;
    try {
      await commitMonica(imports, actor, dry.importId, true, choices);
    } catch (error) {
      rolledBack = error instanceof Error &&
        error.message === "rollback approved types";
    }
    assert(rolledBack, "forced failure rolls back");
    assertEquals(
      await countTypes(),
      0,
      "later import failure rolls back vocabulary",
    );
    fail = false;
    assertEquals(
      (await commitMonica(imports, actor, dry.importId, true, choices)).status,
      "completed",
    );
    assertEquals(await countTypes(), 3);
    const completedReport = await imports.get(actor, dry.importId);
    assert(completedReport.status === "ready", "completed report is available");
    assertEquals(completedReport.import.report.contactMethodTypes, undefined);
    assertEquals(completedReport.import.report.counts.unsupported, 1);
    assert(
      completedReport.import.report.diagnostics.some((item) =>
        item.code === "contact-type-outcome" &&
        item.message.includes("1 explicitly skipped")
      ),
      "report records choices",
    );
    const types =
      await sql`select name,kind,protocol from crm.contact_method_types where workspace_id=${actor.workspaceId} order by name`;
    assertEquals(types.map((type) => ({ ...type })), [
      { name: "Chat", kind: "custom", protocol: "chat" },
      { name: "Email", kind: "email", protocol: "mailto" },
      { name: "Phone", kind: "phone", protocol: "tel" },
    ]);
    const methods =
      await sql`select m.value from crm.person_contact_methods m join crm.people p on p.id=m.person_id where p.workspace_id=${actor.workspaceId}`;
    assertEquals(methods.length, 3);
    assertEquals(
      (await commitMonica(imports, actor, dry.importId, true, choices)).status,
      "completed",
    );
    const repeat = await imports.dryRun(actor, source);
    assert(repeat.status === "dry_run", "repeat source stages");
    assertEquals(
      repeat.report.contactMethodTypes?.proposals.map((type) => type.name),
      ["Deferred"],
    );
    const enriched = await commitMonica(imports, actor, repeat.importId, true, [
      {
        sourceKey: ":4",
        action: "create",
      },
    ]);
    assert(enriched.status === "completed", "reimport enriches methods");
    assertEquals(enriched.peopleReused, 1);
    assertEquals(
      (await sql`select m.id from crm.person_contact_methods m join crm.people p on p.id=m.person_id where p.workspace_id=${actor.workspaceId}`)
        .length,
      4,
    );
    const stable = await imports.dryRun(actor, source);
    assert(stable.status === "dry_run", "stable repeat stages");
    assertEquals(stable.report.contactMethodTypes, undefined);
    assertEquals(
      (await commitMonica(imports, actor, stable.importId, true)).status,
      "completed",
    );
    assertEquals(
      (await sql`select m.id from crm.person_contact_methods m join crm.people p on p.id=m.person_id where p.workspace_id=${actor.workspaceId}`)
        .length,
      4,
    );
    const stale = await imports.dryRun(actor, source);
    assert(stale.status === "dry_run", "stale repeat stages");
    await sql`update crm.contact_method_types set is_archived=true where workspace_id=${actor.workspaceId} and name='Chat'`;
    assertEquals(
      (await commitMonica(imports, actor, stale.importId, true)).status,
      "contact-type-decision-required",
    );
    assertEquals(
      (await commitMonica(imports, actor, stale.importId, true, [{
        sourceKey: ":3",
        action: "create",
      }])).status,
      "contact-type-decision-required",
    );
    assertEquals(await countTypes(), 4);
    assertEquals(
      (await commitMonica(imports, actor, stale.importId, true, [{
        sourceKey: ":3",
        action: "skip",
      }])).status,
      "completed",
    );
  } finally {
    await connection.destroy();
  }
});

Deno.test("[IMPORT-001] pre-type-support fingerprints reuse UUID and numeric-only imports safely", async () => {
  for (const hasUuid of [false, true]) {
    const primary = await register(
      `upgrade-${hasUuid}-${crypto.randomUUID()}@example.test`,
    );
    const foreign = await register(
      `foreign-upgrade-${hasUuid}-${crypto.randomUUID()}@example.test`,
    );
    const source = {
      format: "monica-sql",
      text: `INSERT INTO contacts(id,first_name${
        hasUuid ? ",uuid" : ""
      }) VALUES (1,'Upgrade'${
        hasUuid ? ",'00000000-0000-4000-8000-000000000001'" : ""
      }),(2,'Deleted'${
        hasUuid ? ",'00000000-0000-4000-8000-000000000002'" : ""
      }); INSERT INTO contact_field_types(id,name,type,protocol) VALUES (1,'Email','email','mailto'),(2,'Chat','custom','chat'); INSERT INTO contact_fields(contact_id,contact_field_type_id,data) VALUES (1,1,'upgrade@example.test'),(2,1,'deleted@example.test'),(1,2,'upgrade-handle'),(2,2,'deleted-handle');`,
    };
    const stage = async (fixture = primary) => {
      const response = await request(
        fixture,
        "/api/v1/imports/dry-runs",
        "POST",
        { source },
      );
      assertEquals(response.status, 201);
      return await response.json() as { importId: string };
    };
    const first = await stage();
    assertEquals(
      (await request(
        primary,
        `/api/v1/imports/${first.importId}/commit`,
        "POST",
        {
          confirmed: true,
          monicaChoices: { timezone: "UTC", currencies: [], genders: [] },
          contactMethodTypes: [{ sourceKey: ":1", action: "create" }, {
            sourceKey: ":2",
            action: "skip",
          }],
        },
      )).status,
      200,
    );
    const [prior] =
      await sql`select stats->>'fingerprint' as current, stats->'compatibleFingerprints'->>0 as legacy from crm.data_imports where id=${first.importId}`;
    assert(
      prior?.legacy && prior.legacy !== prior.current,
      "upgrade hashes differ from old normalizer",
    );
    // Model an a95770c completed import: its original fingerprint and detail
    // snapshot contain only basic methods, with no compatibility metadata.
    await sql`update crm.data_imports set stats=jsonb_set(stats-'compatibleFingerprints','{fingerprint}',to_jsonb(${prior.legacy}::text)) where id=${first.importId}`;
    await sql`update crm.data_import_entities set raw_snapshot=jsonb_set(raw_snapshot,'{contact}',(raw_snapshot->'contact')-'contactMethods') where import_id=${first.importId} and source_table='contacts'`;
    const [deleted] =
      await sql`select target_key from crm.data_import_entities where import_id=${first.importId} and source_primary_key='2' and source_table='contacts'`;
    await deletePerson(primary, deleted!.target_key);
    const second = await stage();
    const response = await request(
      primary,
      `/api/v1/imports/${second.importId}/commit`,
      "POST",
      {
        confirmed: true,
        monicaChoices: { timezone: "UTC", currencies: [], genders: [] },
        contactMethodTypes: [{ sourceKey: ":2", action: "create" }],
      },
    );
    assertEquals(response.status, 200);
    const result = await response.json();
    assertEquals([
      result.peopleCreated,
      result.peopleReused,
      result.peopleSkippedDeleted,
    ], [0, 1, 1]);
    assertEquals(
      (await sql`select id from crm.people where workspace_id=${primary.workspaceId}`)
        .length,
      2,
    );
    assertEquals(
      (await sql`select m.id from crm.person_contact_methods m join crm.people p on p.id=m.person_id where p.workspace_id=${primary.workspaceId} and m.value='upgrade-handle'`)
        .length,
      1,
    );
    assertEquals(
      (await sql`select m.id from crm.person_contact_methods m join crm.people p on p.id=m.person_id where p.workspace_id=${primary.workspaceId} and m.value='deleted-handle'`)
        .length,
      0,
    );
    const third = await stage();
    assertEquals(
      (await request(
        primary,
        `/api/v1/imports/${third.importId}/commit`,
        "POST",
        {
          confirmed: true,
          monicaChoices: { timezone: "UTC", currencies: [], genders: [] },
        },
      )).status,
      200,
    );
    assertEquals(
      (await sql`select m.id from crm.person_contact_methods m join crm.people p on p.id=m.person_id where p.workspace_id=${primary.workspaceId} and m.value='upgrade-handle'`)
        .length,
      1,
    );
    const foreignRun = await stage(foreign);
    const foreignCommit = await request(
      foreign,
      `/api/v1/imports/${foreignRun.importId}/commit`,
      "POST",
      {
        confirmed: true,
        monicaChoices: { timezone: "UTC", currencies: [], genders: [] },
        contactMethodTypes: [{ sourceKey: ":1", action: "create" }, {
          sourceKey: ":2",
          action: "create",
        }],
      },
    );
    assertEquals(foreignCommit.status, 200);
    assertEquals((await foreignCommit.json()).peopleCreated, 2);
  }
});

Deno.test("[IMPORT-001] source catalog metadata persists only on newly created types and methods", async () => {
  const actor = await revocableActor(sql, `catalog-${crypto.randomUUID()}`, {
    role: "owner",
  });
  const connection = connectDatabase(databaseUrl);
  const imports = createImportManagement({
    choices: new PostgresImportChoicesBoundary(),
    actors: new PostgresActorRevalidation(),
    audit: { record: () => Promise.resolve() },
    contactTypes: new PostgresContactMethodTypeCatalog(),
    contacts: new PostgresContactImportRepository(),
    files: new PostgresFileImportBoundary(),
    ids: { next: () => crypto.randomUUID() },
    notes: new PostgresInteractionImportBoundary(),
    people: new PostgresPeopleImportBoundary(
      monicaDates,
      new PostgresContactMethodTypeCatalog(),
    ),
    repository: new PostgresImportRepository(connection.db),
    transaction: new PostgresImportTransaction(connection.db),
  });
  const source = {
    format: "monica-sql",
    text:
      "INSERT INTO contacts(id,first_name) VALUES (1,'Catalog example'); INSERT INTO contact_field_types(id,name,type,fontawesome_icon,delible,created_at,updated_at) VALUES (1,'Chat','custom','fa-chat',0,'2020-01-02 03:04:05','2021-02-03 04:05:06'),(2,'Unused','custom','fa-unused',1,'2018-01-01 00:00:00','2019-01-01 00:00:00'),(3,'Skipped','custom',NULL,1,NULL,NULL),(4,'Mapped','custom','fa-map',0,NULL,NULL); INSERT INTO contact_fields(contact_id,contact_field_type_id,data,created_at,updated_at) VALUES (1,1,'catalog-handle','2022-03-04 05:06:07','2023-04-05 06:07:08');",
  };
  try {
    const [existing] =
      await sql`insert into crm.contact_method_types(workspace_id,name,kind,icon,can_delete,created_at,updated_at) values (${actor.workspaceId},'Existing','custom','keep',true,'2010-01-01','2011-01-01') returning id`;
    const dry = await imports.dryRun(actor, source);
    assert(dry.status === "dry_run", "catalog stages");
    assertEquals(dry.report.counts.unsupported, 0);
    assertEquals(
      dry.report.contactMethodTypes?.proposals.map(({ count }) => count),
      [1, 0, 0, 0],
    );
    assertEquals(
      (await sql`select count(*)::int as count from crm.contact_method_types where workspace_id=${actor.workspaceId}`)[
        0
      ]!.count,
      1,
    );
    const choices = [
      { sourceKey: ":1", action: "create" as const },
      { sourceKey: ":2", action: "create" as const },
      { sourceKey: ":3", action: "skip" as const },
      { sourceKey: ":4", action: "map" as const, typeId: existing!.id },
    ];
    assertEquals(
      (await commitMonica(imports, actor, dry.importId, true, choices)).status,
      "completed",
    );
    const readTypes = async () =>
      (await sql`select name,icon,can_delete,created_at,updated_at from crm.contact_method_types where workspace_id=${actor.workspaceId} order by name`)
        .map((row) => ({
          ...row,
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        }));
    assertEquals(await readTypes(), [
      {
        name: "Chat",
        icon: "fa-chat",
        can_delete: false,
        created_at: "2020-01-02T03:04:05.000Z",
        updated_at: "2021-02-03T04:05:06.000Z",
      },
      {
        name: "Existing",
        icon: "keep",
        can_delete: true,
        created_at: "2010-01-01T00:00:00.000Z",
        updated_at: "2011-01-01T00:00:00.000Z",
      },
      {
        name: "Unused",
        icon: "fa-unused",
        can_delete: true,
        created_at: "2018-01-01T00:00:00.000Z",
        updated_at: "2019-01-01T00:00:00.000Z",
      },
    ]);
    const readMethods = () =>
      sql`select m.id,m.created_at,m.updated_at from crm.person_contact_methods m join crm.people p on p.id=m.person_id where p.workspace_id=${actor.workspaceId}`;
    const [method] = await readMethods();
    assertEquals(method!.created_at.toISOString(), "2022-03-04T05:06:07.000Z");
    assertEquals(method!.updated_at.toISOString(), "2023-04-05T06:07:08.000Z");
    await sql`update crm.person_contact_methods set created_at='2001-01-01',updated_at='2002-01-01' where id=${
      method!.id
    }`;
    await sql`update crm.contact_method_types set icon='member-edited',updated_at='2003-01-01' where workspace_id=${actor.workspaceId} and name='Chat'`;
    const beforeTypes = await readTypes();
    const beforeMethods = await readMethods();
    const repeat = await imports.dryRun(actor, source);
    assert(repeat.status === "dry_run", "repeat stages");
    assertEquals(
      (await commitMonica(imports, actor, repeat.importId, true, choices))
        .status,
      "completed",
    );
    assertEquals(
      await readTypes(),
      beforeTypes,
      "existing type metadata never overwritten",
    );
    assertEquals(
      await readMethods(),
      beforeMethods,
      "existing method timestamps never overwritten",
    );
  } finally {
    await connection.destroy();
  }
});

Deno.test("[IMPORT-001] Monica choices enforce complete live selections, save only your timezone and safely repair old unresolved imports", async () => {
  const owner = await register(`choices-${crypto.randomUUID()}@example.test`);
  const foreign = await register(
    `choice-foreign-${crypto.randomUUID()}@example.test`,
  );
  const otherMember = crypto.randomUUID();
  await sql`insert into crm.workspace_members(id,workspace_id,user_id,role,status) values(${otherMember}::uuid,${owner.workspaceId}::uuid,${foreign.userId}::uuid,'member','active')`;
  await sql`insert into crm.member_preferences(member_id,timezone,locale) values(${otherMember}::uuid,'Asia/Tokyo','fr')`;
  const [outside] =
    await sql`insert into crm.gender_options(workspace_id,name) values(${foreign.workspaceId}::uuid,'Outside') returning id`;
  const [retired] =
    await sql`insert into crm.gender_options(workspace_id,name,is_archived) values(${owner.workspaceId}::uuid,'Retired',true) returning id`;
  const source = {
    format: "monica-sql",
    text:
      "INSERT INTO contacts(id,first_name,gender_id,created_at,updated_at) VALUES(1,'Currency Ada',999,'2020-01-01','2020-01-01'),(2,'Currency Grace',888,'2020-01-01','2020-01-01'); INSERT INTO genders(id,name,type) VALUES(3,'Source custom','O'); INSERT INTO debts(id,contact_id,amount,currency_id,in_debt,status,reason,created_at,updated_at) VALUES(1,1,12345,NULL,'yes','open','Train','2020-01-01','2020-01-01'),(2,2,555,NULL,'no','open','Lunch','2020-01-01','2020-01-01'); INSERT INTO reminders(id,contact_id,title,initial_date,frequency_type,frequency_number,inactive,send_time) VALUES(1,1,'Choice reminder','2030-01-02','year',1,0,'09:00'); INSERT INTO contact_field_types(id,name,type) VALUES(1,'Choice chat','custom');",
  };
  const stage = async () => {
    const response = await api.request(
      owner,
      "/api/v1/imports/dry-runs",
      "POST",
      { source },
    );
    assertEquals(response.status, 201);
    return await response.json() as {
      importId: string;
      report: import("../../packages/contracts/client/types.ts").ImportReport;
    };
  };
  const dry = await stage();
  assertEquals(dry.report.monicaChoices?.debts.length, 2);
  assertEquals(dry.report.monicaChoices?.contacts.length, 2);
  assertEquals(dry.report.counts.unsupported, 0);
  const choices = {
    timezone: "America/New_York",
    currencies: [{ sourceKey: "1", currencyCode: "JPY" }, {
      sourceKey: "2",
      currencyCode: "KWD",
    }],
    genders: [{ sourceKey: "1", action: "source", genderId: "3" }, {
      sourceKey: "2",
      action: "create",
      name: "Chosen custom",
    }],
  };
  const post = (
    importId: string,
    monicaChoices: unknown,
    contactMethodTypes: unknown = [{ sourceKey: ":1", action: "create" }],
  ) =>
    api.request(owner, `/api/v1/imports/${importId}/commit`, "POST", {
      confirmed: true,
      contactMethodTypes,
      ...(monicaChoices === undefined ? {} : { monicaChoices }),
    });
  for (
    const invalid of [
      undefined,
      { ...choices, timezone: "No/Zone" },
      { ...choices, currencies: [] },
      {
        ...choices,
        currencies: [choices.currencies[0], choices.currencies[0]],
      },
      {
        ...choices,
        currencies: [
          { sourceKey: "foreign", currencyCode: "JPY" },
          choices.currencies[1],
        ],
      },
      ...[outside!.id, retired!.id].map((genderId) => ({
        ...choices,
        genders: [
          { sourceKey: "1", action: "map", genderId },
          choices.genders[1],
        ],
      })),
    ]
  ) {
    assertEquals((await post(dry.importId, invalid)).status, 400);
  }
  assertEquals((await post(dry.importId, choices, [])).status, 400);
  assertEquals(
    (await sql`select timezone from crm.member_preferences where member_id=${owner.memberId}::uuid`)[
      0
    ]?.timezone ?? null,
    null,
  );
  assertEquals(
    (await sql`select count(*)::int as n from crm.contact_method_types where workspace_id=${owner.workspaceId}::uuid and name='Choice chat'`)[
      0
    ]?.n,
    0,
  );
  assertEquals(
    (await sql`select count(*)::int as n from crm.gender_options where workspace_id=${owner.workspaceId}::uuid and name='Chosen custom'`)[
      0
    ]?.n,
    0,
  );
  const done = await post(dry.importId, choices);
  assertEquals(done.status, 200, JSON.stringify(await done.json()));
  const debts =
    await sql`select id,amount::text,currency_code,reason from crm.debts where workspace_id=${owner.workspaceId}::uuid order by reason`;
  assertEquals(debts.map((d) => [d.reason, d.amount, d.currency_code]), [[
    "Lunch",
    "0.5550",
    "KWD",
  ], ["Train", "12345.0000", "JPY"]]);
  const people =
    await sql`select p.id,p.given_name,g.name as gender from crm.people p left join crm.gender_options g on g.id=p.gender_option_id where p.workspace_id=${owner.workspaceId}::uuid order by p.given_name`;
  assertEquals(people.map((p) => p.gender), ["Source custom", "Chosen custom"]);
  assertEquals(
    (await sql`select timezone from crm.member_preferences where member_id=${owner.memberId}::uuid`)[
      0
    ]?.timezone,
    "America/New_York",
  );
  assertEquals(
    (await sql`select timezone,locale from crm.member_preferences where member_id=${otherMember}::uuid`)[
      0
    ],
    { timezone: "Asia/Tokyo", locale: "fr" },
  );
  const occurrences =
    await sql`select o.member_id,extract(hour from o.deliver_at at time zone 'UTC')::int as hour from crm.reminder_occurrences o join crm.reminders r on r.id=o.reminder_id where r.workspace_id=${owner.workspaceId}::uuid and o.occurs_on='2030-01-02' and o.lead_time_days is null`;
  assert(
    occurrences.some((o) => o.member_id === owner.memberId && o.hour === 14),
    "importing member reminder uses selected timezone",
  );
  assertEquals(
    occurrences.some((o) => o.member_id === otherMember),
    false,
    "new imported personal reminders belong to the importing member",
  );
  const completed = await request(
    owner,
    `/api/v1/imports/${dry.importId}`,
    "GET",
  );
  const completedReport = (await completed.json()).report;
  assertEquals(completedReport.monicaChoices, undefined);
  assert(
    JSON.stringify(completedReport).includes("Source custom"),
    "report shows selected gender name",
  );
  const repeated = await stage();
  assertEquals(repeated.report.monicaChoices?.debts, []);
  assertEquals(repeated.report.monicaChoices?.contacts, []);
  assertEquals(
    (await post(repeated.importId, {
      timezone: "Europe/Paris",
      currencies: [],
      genders: [],
    }, [])).status,
    200,
  );
  assertEquals(
    (await sql`select extract(hour from o.deliver_at at time zone 'UTC')::int as hour from crm.reminder_occurrences o join crm.reminders r on r.id=o.reminder_id where r.workspace_id=${owner.workspaceId}::uuid and o.occurs_on='2030-01-02' and o.member_id=${owner.memberId}::uuid and o.status='pending' limit 1`)[
      0
    ]?.hour,
    8,
    "reimport reschedules existing imported reminders with your new setting",
  );
  // Recreate the prior importer’s unresolved state and identity snapshots.
  await sql`update crm.data_import_entities set raw_snapshot=jsonb_set(raw_snapshot,'{business,data}',(raw_snapshot->'business'->'data') - 'reviewedChoice' - 'unresolvedCurrency' - 'unresolvedGender' - 'selectedGenderId') where import_id in (${dry.importId}::uuid,${repeated.importId}::uuid) and raw_snapshot ? 'business'`;
  await sql`update crm.data_import_entities set raw_snapshot=jsonb_set(raw_snapshot,'{business,data,amount}',to_jsonb(case source_primary_key when '1' then '123.45' else '5.55' end)) where import_id in (${dry.importId}::uuid,${repeated.importId}::uuid) and source_table='debts'`;
  await sql`update crm.people set gender_option_id=null,updated_at='2020-01-01' where workspace_id=${owner.workspaceId}::uuid`;
  await sql`update crm.debts set currency_code=null,amount=case reason when 'Train' then 123.45 else 5.55 end,updated_at='2020-01-01' where workspace_id=${owner.workspaceId}::uuid`;
  await sql`update crm.people set updated_at=(select first.completed_at + (last.completed_at-first.completed_at)/2 from crm.data_imports first,crm.data_imports last where first.id=${dry.importId}::uuid and last.id=${repeated.importId}::uuid) where id=${
    people[1]!.id
  }::uuid`;
  await sql`update crm.debts set amount=99,updated_at=(select first.completed_at + (last.completed_at-first.completed_at)/2 from crm.data_imports first,crm.data_imports last where first.id=${dry.importId}::uuid and last.id=${repeated.importId}::uuid) where reason='Lunch' and workspace_id=${owner.workspaceId}::uuid`;
  // People without source timestamps were created with an application instant;
  // PostgreSQL now() used by the old completion record is its transaction start.
  await sql`update crm.people set created_at=(select completed_at+interval '1 millisecond' from crm.data_imports where id=${dry.importId}::uuid),updated_at=(select completed_at+interval '1 millisecond' from crm.data_imports where id=${dry.importId}::uuid) where id=${
    people[0]!.id
  }::uuid`;
  const repair = await stage();
  assertEquals(repair.report.monicaChoices?.debts.length, 2);
  assertEquals(
    (await post(repair.importId, {
      ...choices,
      genders: [{
        sourceKey: "1",
        action: "map",
        genderId:
          (await sql`select id from crm.gender_options where workspace_id=${owner.workspaceId}::uuid and name='Source custom'`)[
            0
          ]!.id,
      }, {
        sourceKey: "2",
        action: "map",
        genderId:
          (await sql`select id from crm.gender_options where workspace_id=${owner.workspaceId}::uuid and name='Chosen custom'`)[
            0
          ]!.id,
      }],
    }, [])).status,
    200,
  );
  assertEquals(
    (await sql`select amount::text,currency_code from crm.debts where reason='Train' and workspace_id=${owner.workspaceId}::uuid`)[
      0
    ],
    { amount: "12345.0000", currency_code: "JPY" },
  );
  assertEquals(
    (await sql`select amount::text,currency_code from crm.debts where reason='Lunch' and workspace_id=${owner.workspaceId}::uuid`)[
      0
    ],
    { amount: "99.0000", currency_code: null },
  );
  assert(
    (await sql`select gender_option_id from crm.people where id=${
      people[0]!.id
    }::uuid`)[0]?.gender_option_id,
    "unchanged unresolved gender repaired",
  );
  assertEquals(
    (await sql`select gender_option_id from crm.people where id=${
      people[1]!.id
    }::uuid`)[0]?.gender_option_id,
    null,
    "later user edit preserved",
  );
});

Deno.test("[IMPORT-001] Monica choices insert a newly supported debt for a reused contact without a prior debt identity", async () => {
  const owner = await register(`new-debt-${crypto.randomUUID()}@example.test`);
  const contacts =
    "INSERT INTO contacts(id,uuid,first_name) VALUES(1,'11111111-1111-4111-8111-111111111111','Debt upgrade');";
  const debt =
    "INSERT INTO debts(id,contact_id,amount,currency_id,in_debt,status,reason) VALUES(1,1,12345,999,'yes','open','Previously skipped currency');";
  const stage = async (text: string) => {
    const response = await api.request(
      owner,
      "/api/v1/imports/dry-runs",
      "POST",
      { source: { format: "monica-sql", text } },
    );
    assertEquals(response.status, 201);
    return await response.json() as {
      importId: string;
      report: import("../../packages/contracts/client/types.ts").ImportReport;
    };
  };
  const commit = (
    importId: string,
    currencies: readonly { sourceKey: string; currencyCode: string }[],
  ) =>
    api.request(owner, `/api/v1/imports/${importId}/commit`, "POST", {
      confirmed: true,
      monicaChoices: { timezone: "UTC", currencies, genders: [] },
    });
  const baseline = await stage(contacts);
  assertEquals((await commit(baseline.importId, [])).status, 200);
  const upgrade = await stage(contacts + debt);
  assertEquals(upgrade.report.monicaChoices?.debts.length, 1);
  const committed = await commit(upgrade.importId, [{
    sourceKey: "1",
    currencyCode: "JPY",
  }]);
  assertEquals(committed.status, 200);
  assertEquals((await committed.json()).peopleReused, 1);
  const readDebts = () =>
    sql`select amount::text,currency_code from crm.debts where workspace_id=${owner.workspaceId}::uuid`;
  assertEquals(await readDebts(), [{
    amount: "12345.0000",
    currency_code: "JPY",
  }], "a reused contact does not turn a new debt into an update-only repair");
  const repeat = await stage(contacts + debt);
  assertEquals(repeat.report.monicaChoices?.debts, []);
  assertEquals((await commit(repeat.importId, [])).status, 200);
  assertEquals(await readDebts(), [{
    amount: "12345.0000",
    currency_code: "JPY",
  }], "new debt identity remains idempotent");
});

Deno.test("[IMPORT-001] Monica choices reject a stale staged run after another run resolves the same source identities", async () => {
  const owner = await register(
    `stale-choices-${crypto.randomUUID()}@example.test`,
  );
  const source = {
    format: "monica-sql",
    text:
      "INSERT INTO contacts(id,first_name,gender_id) VALUES(1,'Concurrent import',999); INSERT INTO debts(id,contact_id,amount,currency_id,in_debt,status) VALUES(1,1,12345,NULL,'yes','open');",
  };
  const stage = async () => {
    const response = await api.request(
      owner,
      "/api/v1/imports/dry-runs",
      "POST",
      { source },
    );
    assertEquals(response.status, 201);
    return await response.json() as {
      importId: string;
      report: import("../../packages/contracts/client/types.ts").ImportReport;
    };
  };
  const first = await stage(), stale = await stage();
  const commit = (
    importId: string,
    currencyCode: string,
    name: string,
    timezone: string,
  ) =>
    api.request(owner, `/api/v1/imports/${importId}/commit`, "POST", {
      confirmed: true,
      monicaChoices: {
        timezone,
        currencies: [{ sourceKey: "1", currencyCode }],
        genders: [{ sourceKey: "1", action: "create", name }],
      },
    });
  assertEquals(
    (await commit(first.importId, "EUR", "First resolution", "UTC")).status,
    200,
  );
  const rejected = await commit(
    stale.importId,
    "USD",
    "Stale resolution",
    "Asia/Tokyo",
  );
  assertEquals(
    rejected.status,
    400,
    "a stale preview must be revalidated before any second set of choices is applied or recorded",
  );
  const problem = await rejected.json();
  assertEquals(problem.code, "import_monica_choices_changed");
  assert(
    problem.detail.includes("Validate the source again"),
    "stale choice response explains recovery",
  );
  assertEquals(
    (await sql`select timezone from crm.member_preferences where member_id=${owner.memberId}::uuid`)[
      0
    ]?.timezone,
    "UTC",
  );
  assertEquals(
    (await sql`select count(*)::int as count from crm.gender_options where workspace_id=${owner.workspaceId}::uuid and name='Stale resolution'`)[
      0
    ]?.count,
    0,
  );
  assertEquals(
    (await sql`select currency_code from crm.debts where workspace_id=${owner.workspaceId}::uuid`)[
      0
    ]?.currency_code,
    "EUR",
  );
  assertEquals(
    (await sql`select g.name from crm.people p join crm.gender_options g on g.id=p.gender_option_id where p.workspace_id=${owner.workspaceId}::uuid`)[
      0
    ]?.name,
    "First resolution",
  );
  assertEquals(
    (await sql`select count(*)::int as count from crm.data_import_entities where import_id=${stale.importId}::uuid and raw_snapshot->'business'->'data'->>'reviewedChoice'='true'`)[
      0
    ]?.count,
    0,
  );
  const refreshed = await stage();
  assertEquals(refreshed.report.monicaChoices?.debts, []);
  assertEquals(refreshed.report.monicaChoices?.contacts, []);
  assertEquals(
    (await api.request(
      owner,
      `/api/v1/imports/${refreshed.importId}/commit`,
      "POST",
      {
        confirmed: true,
        monicaChoices: { timezone: "UTC", currencies: [], genders: [] },
      },
    )).status,
    200,
  );
});

Deno.test({
  name: "IMPORT-001 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.all([configured.close(), sql.end()]);
  },
});
