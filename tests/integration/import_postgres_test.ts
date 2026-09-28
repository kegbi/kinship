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
      { confirmed: true },
    )).status === 404,
    "foreign commit concealed",
  );
  const committed = await request(
    primary,
    `/api/v1/imports/${dryBody.importId}/commit`,
    "POST",
    { confirmed: true },
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
    { confirmed: true },
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
    actors: new PostgresActorRevalidation(),
    audit,
    contactTypes: new PostgresContactMethodTypeCatalog(),
    contacts: new PostgresContactImportRepository(),
    files: new PostgresFileImportBoundary(),
    ids: { next: () => crypto.randomUUID() },
    notes: new PostgresInteractionImportBoundary(),
    people: new PostgresPeopleImportBoundary(monicaDates),
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
      await imports.commit(actor, staged.importId, true);
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
    failCommittedAudit = false;
    const retried = await imports.commit(actor, staged.importId, true);
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
        actors: new PostgresActorRevalidation(),
        audit: importAuditFrom(new PostgresAuditEventRecorder()),
        contactTypes: new PostgresContactMethodTypeCatalog(),
        contacts: new PostgresContactImportRepository(),
        files: new PostgresFileImportBoundary(),
        ids: { next: () => crypto.randomUUID() },
        notes: new PostgresInteractionImportBoundary(),
        people: new PostgresPeopleImportBoundary(monicaDates),
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
      const refusedCommit = await imports.commit(
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
        new PostgresPeopleImportBoundary(monicaDates).presence({
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

Deno.test({
  name: "IMPORT-001 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.all([configured.close(), sql.end()]);
  },
});
