import postgres from "postgres";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  createImportManagement,
  PostgresImportRepository,
  PostgresImportTransaction,
} from "../../packages/backend/modules/import-export/public.ts";
import { PostgresPeopleImportBoundary } from "../../packages/backend/modules/people/public.ts";
import { PostgresFileImportBoundary } from "../../packages/backend/modules/files/public.ts";
import {
  type ImportAudit,
  PostgresImportAudit,
} from "../../packages/backend/modules/governance/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const password = "correct horse battery staple";

interface Fixture {
  cookie: string;
  memberId: string;
  userId: string;
  workspaceId: string;
}
async function register(email: string): Promise<Fixture> {
  const registered = await configured.app.request(
    "http://localhost/api/v1/registrations",
    {
      body: JSON.stringify({
        email,
        firstName: "Import",
        lastName: "Admin",
        password,
        workspaceName: email,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  assert(registered.status === 202, "import fixture registers");
  const token = mail.latestToken(email);
  assert(token, "verification token captured");
  assert(
    (await configured.app.request(
      "http://localhost/api/v1/email-verifications",
      {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    )).status === 200,
    "import fixture verifies",
  );
  const signed = await configured.app.request(
    "http://localhost/api/v1/sessions",
    {
      body: JSON.stringify({ email, password }),
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      method: "POST",
    },
  );
  const body = await signed.json() as {
    member: { id: string };
    workspace: { id: string };
  };
  const cookie = signed.headers.get("set-cookie")?.split(";")[0];
  assert(signed.status === 200 && cookie, "import fixture signs in");
  const [identity] = await sql<
    { user_id: string }[]
  >`select user_id::text from crm.workspace_members where id = ${body.member.id}::uuid`;
  assert(identity, "import fixture resolves principal");
  return {
    cookie,
    memberId: body.member.id,
    userId: identity.user_id,
    workspaceId: body.workspace.id,
  };
}
function request(
  fixture: Fixture,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
) {
  return configured.app.request(`http://localhost${path}`, {
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: {
      "content-type": "application/json",
      cookie: fixture.cookie,
      origin: "http://localhost",
      "X-Workspace-Id": fixture.workspaceId,
    },
    method,
  });
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
  const persistedAudit = new PostgresImportAudit();
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

globalThis.addEventListener("unload", () => {
  void Promise.all([configured.close(), sql.end()]);
});
