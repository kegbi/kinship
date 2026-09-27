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
import {
  PostgresPeopleImportBoundary,
} from "../../packages/backend/modules/people/adapters/postgres/import_people_boundary.ts";
import {
  PostgresFileImportBoundary,
} from "../../packages/backend/modules/files/adapters/postgres/import_file_boundary.ts";
import {
  PostgresAuditEventRecorder,
} from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  revocableActor,
  revokeMembership,
} from "../support/database.ts";
import { apiSupport, type SignedInFixture } from "../support/api.ts";

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
    files: new PostgresFileImportBoundary(),
    ids: { next: () => crypto.randomUUID() },
    people: new PostgresPeopleImportBoundary(),
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
        files: new PostgresFileImportBoundary(),
        ids: { next: () => crypto.randomUUID() },
        people: new PostgresPeopleImportBoundary(),
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
Deno.test({
  name: "IMPORT-001 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.all([configured.close(), sql.end()]);
  },
});
