import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  createExportManagement,
  PostgresExportRepository,
  PostgresExportTransaction,
} from "../../packages/backend/modules/import-export/public.ts";
import {
  PostgresExportFileBoundary,
  WebCryptoFileIdentifiers,
  WebCryptoObjectKeys,
} from "../../packages/backend/modules/files/public.ts";
import { PostgresPeopleExportBoundary } from "../../packages/backend/modules/people/public.ts";
import { PostgresExportAudit } from "../../packages/backend/modules/governance/public.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/public.ts";
import postgres from "postgres";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import type { ObjectStorage } from "../../packages/backend/modules/files/public.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
class CapturedStorage implements ObjectStorage {
  readonly bucket = "export-test";
  readonly provider = "captured";
  readonly objects = new Map<string, Uint8Array>();
  throwAfterPut = false;
  get(command: { readonly key: string }) {
    return Promise.resolve(this.objects.get(command.key)?.slice());
  }
  health(): Promise<"available"> {
    return Promise.resolve("available");
  }
  put(command: { readonly bytes: Uint8Array; readonly key: string }) {
    this.objects.set(command.key, command.bytes.slice());
    if (this.throwAfterPut) {
      this.throwAfterPut = false;
      return Promise.reject(new Error("ambiguous put acknowledgement"));
    }
    return Promise.resolve();
  }
  remove(command: { readonly key: string }) {
    this.objects.delete(command.key);
    return Promise.resolve();
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
const mail = new CapturedVerificationMail();
const storage = new CapturedStorage();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
  undefined,
  undefined,
  undefined,
  storage,
);
const password = "correct horse battery staple";

interface Fixture {
  readonly cookie: string;
  readonly memberId: string;
  readonly workspaceId: string;
}
async function register(email: string): Promise<Fixture> {
  assert(
    (await configured.app.request("http://localhost/api/v1/registrations", {
      body: JSON.stringify({
        email,
        firstName: "Export",
        lastName: "Admin",
        password,
        workspaceName: email,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })).status === 202,
    "export fixture registers",
  );
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
    "export fixture verifies",
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
  assert(signed.status === 200 && cookie, "export fixture signs in");
  return { cookie, memberId: body.member.id, workspaceId: body.workspace.id };
}
function request(fixture: Fixture, path: string, method: "GET" | "POST") {
  return configured.app.request(`http://localhost${path}`, {
    headers: {
      cookie: fixture.cookie,
      origin: "http://localhost",
      "X-Workspace-Id": fixture.workspaceId,
    },
    method,
  });
}

Deno.test("[EXPORT-001] PostgreSQL export is portable, private, and tenant-safe", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(`export-${suffix}@example.test`);
  const foreign = await register(`export-foreign-${suffix}@example.test`);
  const personId = crypto.randomUUID();
  const typeId = crypto.randomUUID();
  await sql`insert into crm.people (id, workspace_id, created_by_member_id, given_name, family_name, is_starred)
    values (${personId}::uuid, ${primary.workspaceId}::uuid, ${primary.memberId}::uuid, 'Ada', 'Lovelace', true)`;
  await sql`insert into crm.contact_method_types (id, workspace_id, name, kind)
    values (${typeId}::uuid, ${primary.workspaceId}::uuid, 'Work', 'email')`;
  await sql`insert into crm.person_contact_methods (person_id, type_id, value, normalized_value, is_primary)
    values (${personId}::uuid, ${typeId}::uuid, 'ada@example.test', 'ada@example.test', true)`;

  const created = await request(primary, "/api/v1/exports", "POST");
  const body = await created.json() as {
    exportId: string;
    manifest: {
      rows: { people: { count: number; sha256: string } };
      attachments: { count: number; sha256: string };
    };
  };
  assert(
    created.status === 201 && body.manifest.rows.people.count === 1,
    "canonical export completed",
  );
  assert(
    /^[0-9a-f]{64}$/.test(body.manifest.rows.people.sha256) &&
      /^[0-9a-f]{64}$/.test(body.manifest.attachments.sha256),
    "row and attachment manifests checksummed",
  );
  assert(
    (await request(
      foreign,
      `/api/v1/exports/${body.exportId}/downloads`,
      "POST",
    )).status === 404,
    "secondary workspace artifact concealed",
  );
  const foreignVCard = await request(
    foreign,
    `/api/v1/people/${personId}/vcard`,
    "GET",
  );
  assert(foreignVCard.status === 404, "secondary workspace person concealed");

  const issued = await request(
    primary,
    `/api/v1/exports/${body.exportId}/downloads`,
    "POST",
  );
  const reference = await issued.json() as { href: string };
  assert(
    issued.status === 201 && reference.href.includes("token="),
    "short-lived reference issued",
  );
  const replay = await Promise.all([
    request(primary, reference.href, "GET"),
    request(primary, reference.href, "GET"),
  ]);
  assert(
    replay.map((response) => response.status).sort().join(",") === "200,410",
    "concurrent token replay has exactly one winner",
  );
  const downloaded = replay.find((response) => response.status === 200)!;
  const portableBytes = new Uint8Array(
    await downloaded.clone().arrayBuffer(),
  );
  const portable = await downloaded.json() as {
    format: string;
    version: number;
    tables: { contacts: Array<Record<string, unknown>> };
  };
  assert(
    downloaded.status === 200 && portable.format === "monica-json" &&
      portable.version === 1,
    "portable artifact downloaded",
  );
  assert(
    portable.tables.contacts[0]?.first_name === "Ada" &&
      !("password" in portable.tables.contacts[0]!),
    "supported secret-free person subset exported",
  );
  const roundTrip = await configured.app.request(
    "http://localhost/api/v1/imports/dry-runs",
    {
      body: JSON.stringify({ source: portable }),
      headers: {
        "content-type": "application/json",
        cookie: primary.cookie,
        origin: "http://localhost",
        "X-Workspace-Id": primary.workspaceId,
      },
      method: "POST",
    },
  );
  assert(
    roundTrip.status === 201,
    "portable subset is accepted by the delivered import boundary",
  );
  const vcard = await request(
    primary,
    `/api/v1/people/${personId}/vcard`,
    "GET",
  );
  assert(
    vcard.status === 200 &&
      (await vcard.text()).includes("EMAIL;TYPE=Work:ada@example.test"),
    "member-scoped vCard preserves contact method",
  );
  const [vcardAudit] = await sql<
    {
      action: string;
      payload: Record<string, unknown>;
      person_id: string;
      subject_id: string;
      subject_type: string;
    }[]
  >`
    select action, payload, person_id::text, subject_id::text, subject_type
    from crm.audit_events
    where workspace_id = ${primary.workspaceId}::uuid
      and person_id = ${personId}::uuid and action = 'export.downloaded'
    order by occurred_at desc limit 1`;
  assert(
    vcardAudit?.subject_type === "person" &&
      vcardAudit.subject_id === personId && vcardAudit.person_id === personId &&
      JSON.stringify(vcardAudit.payload) === '{"format":"vcard"}',
    "vCard audit is person-scoped and contains no exported content",
  );

  const startOnlyId = crypto.randomUUID();
  await sql`insert into crm.data_exports (
    id, workspace_id, requested_by_member_id, format, status, started_at
  ) values (
    ${startOnlyId}::uuid, ${primary.workspaceId}::uuid,
    ${primary.memberId}::uuid, 'json', 'running', now()
  )`;
  const resumedStart = await request(primary, "/api/v1/exports", "POST");
  const resumedStartBody = await resumedStart.json() as {
    exportId: string;
    status: string;
  };
  assert(
    resumedStart.status === 201 && resumedStartBody.exportId === startOnlyId &&
      resumedStartBody.status === "completed",
    "restart after canonical job start resumes the same export",
  );

  const finalizationId = crypto.randomUUID();
  const recoveredFileId = crypto.randomUUID();
  const recoveredKey = crypto.randomUUID();
  storage.objects.set(recoveredKey, portableBytes.slice());
  await sql`insert into crm.data_exports (
    id, workspace_id, requested_by_member_id, format, status, started_at
  ) values (
    ${finalizationId}::uuid, ${primary.workspaceId}::uuid,
    ${primary.memberId}::uuid, 'json', 'running', now()
  )`;
  await sql`insert into crm.files (
    id, workspace_id, uploaded_by_member_id, original_filename,
    storage_provider, storage_bucket, storage_key, byte_size, mime_type,
    checksum_sha256, status, visibility, metadata
  ) values (
    ${recoveredFileId}::uuid, ${primary.workspaceId}::uuid,
    ${primary.memberId}::uuid, 'recoverable.json', ${storage.provider},
    ${storage.bucket}, ${recoveredKey}, ${portableBytes.byteLength},
    'application/json', ${await sha256(portableBytes)}, 'processing', 'private',
    ${JSON.stringify({ exportId: finalizationId })}::text::jsonb
  )`;
  const finalized = await request(primary, "/api/v1/exports", "POST");
  const finalizedBody = await finalized.json() as { exportId: string };
  const [finalizedRow] = await sql<
    { file_id: string; file_status: string; status: string }[]
  >`select export.status, export.file_id::text,
      file.status as file_status
    from crm.data_exports export join crm.files file on file.id = export.file_id
    where export.id = ${finalizationId}::uuid`;
  assert(
    finalized.status === 201 && finalizedBody.exportId === finalizationId &&
      finalizedRow?.status === "completed" &&
      finalizedRow.file_id === recoveredFileId &&
      finalizedRow.file_status === "available",
    "verified put survives process death before canonical finalization",
  );

  storage.throwAfterPut = true;
  const ambiguousPut = await request(primary, "/api/v1/exports", "POST");
  assert(
    ambiguousPut.status === 201 && !storage.throwAfterPut,
    "ambiguous put acknowledgement is reconciled by checksum and size",
  );

  const tamperedCreated = await request(primary, "/api/v1/exports", "POST");
  const tamperedBody = await tamperedCreated.json() as { exportId: string };
  const [tamperedFile] = await sql<
    { file_id: string; storage_key: string }[]
  >`select file.id::text as file_id, file.storage_key
    from crm.data_exports export join crm.files file on file.id = export.file_id
    where export.id = ${tamperedBody.exportId}::uuid`;
  assert(tamperedFile, "tamper fixture has a private artifact");
  storage.objects.set(
    tamperedFile.storage_key,
    new TextEncoder().encode("tampered"),
  );
  const tamperedReference = await request(
    primary,
    `/api/v1/exports/${tamperedBody.exportId}/downloads`,
    "POST",
  );
  const tamperedHref = (await tamperedReference.json() as { href: string })
    .href;
  assert(
    (await request(primary, tamperedHref, "GET")).status === 503 &&
      (await request(primary, tamperedHref, "GET")).status === 410,
    "tampered artifact is unavailable and its token remains spent",
  );
  const [tamperedState] = await sql<
    { audits: string; status: string }[]
  >`select file.status,
      (select count(*)::text from crm.audit_events event
        where event.subject_type = 'data_export'
          and event.subject_id = ${tamperedBody.exportId}::uuid
          and event.action = 'export.downloaded') as audits
    from crm.files file where file.id = ${tamperedFile.file_id}::uuid`;
  assert(
    tamperedState?.status === "quarantined" && tamperedState.audits === "0",
    "tamper is quarantined without a downloaded audit",
  );

  const [persisted] = await sql<
    {
      status: string;
      file_status: string;
      visibility: string;
      audits: string;
    }[]
  >`
    select export.status, file.status as file_status, file.visibility,
      (select count(*)::text from crm.audit_events event where event.subject_id = export.id and event.action in ('export.requested', 'export.completed', 'export.downloaded')) as audits
    from crm.data_exports export join crm.files file on file.id = export.file_id
    where export.id = ${body.exportId}::uuid`;
  assert(
    persisted?.status === "completed" &&
      persisted.file_status === "available" &&
      persisted.visibility === "private" && persisted.audits === "3",
    "canonical job, private file, and lifecycle audit persisted",
  );
});

// --- GAP-009 -------------------------------------------------------------

/**
 * A workspace whose only member can be revoked mid-test. The actor is built
 * directly so the use case is exercised without the session layer refusing
 * first.
 */
async function revocableActor(name: string): Promise<{
  readonly memberId: string;
  readonly personId: string;
  readonly role: "owner";
  readonly userId: string;
  readonly workspaceId: string;
}> {
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const personId = crypto.randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`
      insert into crm.users (id, email, first_name, status)
      values (${userId}, ${`${name}@example.test`}, 'Revocable', 'active')
    `;
    await transaction`
      insert into crm.workspaces (id, name, status, created_by_user_id)
      values (${workspaceId}, ${name}, 'active', ${userId})
    `;
    await transaction`
      insert into crm.workspace_members (
        id, workspace_id, user_id, role, status, joined_at
      ) values (${memberId}, ${workspaceId}, ${userId}, 'owner', 'active', now())
    `;
    await transaction`
      insert into crm.people (id, workspace_id, created_by_member_id, given_name)
      values (${personId}, ${workspaceId}, ${memberId}, 'Revocation subject')
    `;
  });
  return { memberId, personId, role: "owner", userId, workspaceId };
}

async function revokeMembership(memberId: string): Promise<void> {
  await sql`
    update crm.workspace_members set status = 'left', left_at = now()
    where id = ${memberId}
  `;
}

Deno.test({
  name: "[EXPORT-001] GAP-009 a revoked member cannot start or list exports",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        `export-revocation-${crypto.randomUUID()}`,
      );
      const storage = new CapturedStorage();
      const exports = createExportManagement({
        actors: new PostgresActorRevalidation(),
        audit: new PostgresExportAudit(),
        clock: { now: () => new Date() },
        files: new PostgresExportFileBoundary(connection.db, {
          ids: new WebCryptoFileIdentifiers(),
          keys: new WebCryptoObjectKeys(),
          storage,
        }),
        ids: { next: () => crypto.randomUUID() },
        people: new PostgresPeopleExportBoundary(),
        repository: new PostgresExportRepository(),
        tokens: { next: () => crypto.randomUUID() },
        transaction: new PostgresExportTransaction(connection.db),
      });

      const allowed = await exports.list(actor);
      assert(allowed.status === "ready", "an active member lists exports");

      await revokeMembership(actor.memberId);

      const refusedCreate = await exports.createWorkspace(actor);
      const refusedList = await exports.list(actor);
      const refusedDownload = await exports.createDownload(
        actor,
        crypto.randomUUID(),
      );
      assert(
        refusedCreate.status === "forbidden" &&
          refusedList.status === "forbidden" &&
          refusedDownload.status === "not-found",
        "a revoked member still reached workspace exports",
      );
      const [remaining] = await sql<[{ readonly count: number }]>`
        select count(*)::int as count from crm.data_exports
        where workspace_id = ${actor.workspaceId}
      `;
      assert(remaining?.count === 0, "a revoked member started an export");
    } finally {
      await connection.destroy();
    }
  },
});
Deno.test({
  name: "EXPORT-001 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.all([configured.close(), sql.end()]);
  },
});
