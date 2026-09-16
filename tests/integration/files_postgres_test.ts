import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  createPersonFileManagement,
  DeclaredMediaScanner,
  PostgresFileMetadataRepository,
  WebCryptoFileIdentifiers,
  WebCryptoObjectKeys,
} from "../../packages/backend/modules/files/public.ts";
import { fileAuditFrom } from "../../packages/backend/modules/files/public.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/public.ts";
import { PostgresPeopleTransaction } from "../../packages/backend/modules/people/public.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/public.ts";
import postgres from "postgres";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import type { ObjectStorage } from "../../packages/backend/modules/files/public.ts";
import {
  createObjectStorageRequestTransport,
  S3CompatibleObjectStorage,
} from "../../packages/backend/modules/files/public.ts";
import { Client as MinioClient } from "minio";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class CapturedObjectStorage implements ObjectStorage {
  readonly bucket = "captured-files";
  readonly objects = new Map<string, Uint8Array>();
  readonly provider = "captured";
  failRemove = false;
  putCalls = 0;
  blockedKey: string | undefined;
  #entered?: () => void;
  #release?: () => void;
  #released?: Promise<void>;

  blockRemoval(key: string): Promise<void> {
    this.blockedKey = key;
    this.#released = new Promise((resolve) => this.#release = resolve);
    return new Promise((resolve) => this.#entered = resolve);
  }

  releaseRemoval(): void {
    this.#release?.();
  }

  get(command: { readonly key: string }): Promise<Uint8Array | undefined> {
    return Promise.resolve(this.objects.get(command.key));
  }
  health(): Promise<"available"> {
    return Promise.resolve("available");
  }
  put(
    command: { readonly bytes: Uint8Array; readonly key: string },
  ): Promise<void> {
    this.putCalls += 1;
    this.objects.set(command.key, command.bytes.slice());
    return Promise.resolve();
  }
  async remove(command: { readonly key: string }): Promise<void> {
    if (this.failRemove) {
      throw new Error("object store unavailable");
    }
    if (command.key === this.blockedKey) {
      this.#entered?.();
      await this.#released;
      this.blockedKey = undefined;
    }
    this.objects.delete(command.key);
  }
}

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
const mail = new CapturedVerificationMail();
const storage = new CapturedObjectStorage();
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
  readonly workspaceId: string;
}

async function register(
  email: string,
  workspaceName: string,
): Promise<Fixture> {
  const registration = await configured.app.request(
    "http://localhost/api/v1/registrations",
    {
      body: JSON.stringify({
        email,
        firstName: "File",
        lastName: "Tester",
        password,
        workspaceName,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  assert(registration.status === 202, "file fixture registers");
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
    "file fixture verifies",
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
    readonly workspace: { readonly id: string };
  };
  const cookie = signed.headers.get("set-cookie")?.split(";")[0];
  assert(signed.status === 200 && cookie, "file fixture signs in");
  return { cookie, workspaceId: body.workspace.id };
}

async function person(fixture: Fixture, givenName: string): Promise<string> {
  const response = await configured.app.request(
    "http://localhost/api/v1/people",
    {
      body: JSON.stringify({ givenName, isPartial: false }),
      headers: {
        "content-type": "application/json",
        cookie: fixture.cookie,
        origin: "http://localhost",
        "X-Workspace-Id": fixture.workspaceId,
      },
      method: "POST",
    },
  );
  const body = await response.json() as {
    readonly person: { readonly id: string };
  };
  assert(response.status === 201, "file person created");
  return body.person.id;
}

function request(
  fixture: Fixture,
  path: string,
  method: "DELETE" | "GET" | "POST" = "GET",
  body?: Uint8Array,
): Promise<Response> {
  return Promise.resolve(configured.app.request(`http://localhost${path}`, {
    ...(body ? { body: body.slice().buffer } : {}),
    headers: {
      cookie: fixture.cookie,
      origin: "http://localhost",
      "X-File-Kind": "document",
      "X-File-Name": "care-plan.pdf",
      "X-File-Title": "Care plan",
      "X-Workspace-Id": fixture.workspaceId,
      ...(body ? { "content-type": "application/pdf" } : {}),
    },
    method,
  }));
}

Deno.test("[FILES-001] PostgreSQL and object effects stay tenant-safe and compensating", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(
    `files-${suffix}@example.test`,
    "Files primary",
  );
  const foreign = await register(
    `files-foreign-${suffix}@example.test`,
    "Files foreign",
  );
  const ada = await person(primary, "Ada");
  const outsider = await person(foreign, "Outsider");
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

  const uploaded = await request(
    primary,
    `/api/v1/people/${ada}/files`,
    "POST",
    pdf,
  );
  const uploadBody = await uploaded.json() as {
    readonly file: { readonly fileId: string; readonly status: string };
  };
  assert(uploaded.status === 201, "bounded PDF uploads");
  assert(uploadBody.file.status === "available", "clean file is available");
  const fileId = uploadBody.file.fileId;
  const [stored] = await sql<{
    readonly storage_bucket: string;
    readonly storage_key: string;
    readonly storage_provider: string;
  }[]>`
    select storage_bucket, storage_key, storage_provider
    from crm.files where id = ${fileId}::uuid
  `;
  assert(
    stored && storage.objects.has(stored.storage_key),
    "opaque object is stored",
  );
  assert(
    stored.storage_bucket === storage.bucket &&
      stored.storage_provider === storage.provider,
    "metadata records the concrete object-store reference",
  );

  const diagnostics = await request(
    primary,
    `/api/v1/settings/storage?query=${fileId}`,
  );
  const diagnosticsBody = await diagnostics.json() as {
    readonly files: readonly { readonly fileId: string }[];
    readonly usage: { readonly available: number; readonly totalFiles: number };
  };
  assert(
    diagnostics.status === 200 && diagnosticsBody.usage.totalFiles === 1 &&
      diagnosticsBody.usage.available === 1 &&
      diagnosticsBody.files[0]?.fileId === fileId,
    "workspace owner receives canonical usage and bounded metadata lookup",
  );
  const crossWorkspaceDiagnostics = await configured.app.request(
    "http://localhost/api/v1/settings/storage",
    {
      headers: {
        cookie: primary.cookie,
        "X-Workspace-Id": foreign.workspaceId,
      },
    },
  );
  assert(
    crossWorkspaceDiagnostics.status === 401,
    "inaccessible workspace storage inventory is concealed",
  );
  await sql`
    update crm.workspace_members set role = 'member'
    where workspace_id = ${primary.workspaceId}::uuid
  `;
  assert(
    (await request(primary, "/api/v1/settings/storage")).status === 403,
    "ordinary member cannot receive workspace storage diagnostics",
  );
  await sql`
    update crm.workspace_members set role = 'owner'
    where workspace_id = ${primary.workspaceId}::uuid
  `;
  const malformedFileId = crypto.randomUUID();
  await sql`
    insert into crm.files (
      id, workspace_id, original_filename, storage_provider, storage_bucket,
      storage_key, byte_size, mime_type, status
    ) values (
      ${malformedFileId}::uuid, ${primary.workspaceId}::uuid, 'neutral.pdf',
      'captured', 'captured-files', 'objects/malformed', 1,
      'application/pdf', 'available'
    )
  `;
  await sql`
    insert into crm.person_file_links (
      person_id, file_id, kind, title
    ) values (
      ${outsider}::uuid, ${malformedFileId}::uuid, 'document',
      'Foreign secret title'
    )
  `;
  const malformedLookup = await request(
    primary,
    "/api/v1/settings/storage?query=foreign-secret",
  );
  assert(
    malformedLookup.status === 200 &&
      ((await malformedLookup.json()) as { readonly files: unknown[] }).files
          .length === 0,
    "malformed cross-workspace links cannot contribute lookup metadata",
  );

  const listed = await request(primary, `/api/v1/people/${ada}/files`);
  assert(listed.status === 200, "metadata lists on the person profile");
  const concealed = await request(
    foreign,
    `/api/v1/people/${ada}/files/${fileId}/content`,
  );
  assert(concealed.status === 404, "foreign workspace is concealed");
  const downloaded = await request(
    primary,
    `/api/v1/people/${ada}/files/${fileId}/content`,
  );
  assert(
    downloaded.status === 200 &&
      (await downloaded.arrayBuffer()).byteLength === pdf.byteLength,
    "authorized member retrieves bytes",
  );
  const [readLink] = await sql<{ readonly download_count: number }[]>`
    select download_count from crm.person_file_links
    where person_id = ${ada}::uuid and file_id = ${fileId}::uuid
  `;
  assert(
    readLink?.download_count === 1,
    "authorized reads update link metadata",
  );

  await sql`update crm.files set status = 'quarantined' where id = ${fileId}::uuid`;
  assert(
    (await request(primary, `/api/v1/people/${ada}/files/${fileId}/content`))
      .status === 423,
    "quarantine blocks byte delivery",
  );
  await sql`update crm.files set status = 'available' where id = ${fileId}::uuid`;
  storage.objects.delete(stored.storage_key);
  assert(
    (await request(primary, `/api/v1/people/${ada}/files/${fileId}/content`))
      .status === 410,
    "missing object is explicit",
  );
  const [missing] = await sql<
    { readonly status: string }[]
  >`select status from crm.files where id = ${fileId}::uuid`;
  assert(missing?.status === "missing", "missing state persists");

  const putsBeforeConcealedUpload = storage.putCalls;
  const compensated = await request(
    foreign,
    `/api/v1/people/${ada}/files`,
    "POST",
    pdf,
  );
  assert(compensated.status === 404, "cross-workspace upload is concealed");
  assert(
    storage.putCalls === putsBeforeConcealedUpload,
    "cross-workspace ownership is rejected before object storage",
  );
  assert(
    storage.objects.size === 0,
    "cross-workspace metadata rejection compensates bytes",
  );

  const secondUpload = await request(
    primary,
    `/api/v1/people/${ada}/files`,
    "POST",
    pdf,
  );
  const secondBody = await secondUpload.json() as {
    readonly file: { readonly fileId: string };
  };
  storage.failRemove = true;
  assert(
    (await request(
      primary,
      `/api/v1/people/${ada}/files/${secondBody.file.fileId}`,
      "DELETE",
    )).status === 503,
    "object-store remove failure is recoverable",
  );
  const [stillLinked] = await sql<{ readonly status: string }[]>`
    select stored.status from crm.files stored
    join crm.person_file_links link on link.file_id = stored.id
    where stored.id = ${secondBody.file.fileId}::uuid and link.person_id = ${ada}::uuid
  `;
  assert(
    stillLinked?.status === "available",
    "failed remove rolls back metadata for retry",
  );
  storage.failRemove = false;
  assert(
    (await request(
      primary,
      `/api/v1/people/${ada}/files/${secondBody.file.fileId}`,
      "DELETE",
    )).status === 200,
    "failed removal is retryable",
  );

  const removableUpload = await request(
    primary,
    `/api/v1/people/${ada}/files`,
    "POST",
    pdf,
  );
  const removableFileId = (await removableUpload.json() as {
    readonly file: { readonly fileId: string };
  }).file.fileId;
  const [removableStored] = await sql<{ readonly storage_key: string }[]>`
    select storage_key from crm.files where id = ${removableFileId}::uuid
  `;
  const entered = storage.blockRemoval(removableStored!.storage_key);
  const firstRemoval = request(
    primary,
    `/api/v1/people/${ada}/files/${removableFileId}`,
    "DELETE",
  );
  await entered;
  const secondRemoval = request(
    primary,
    `/api/v1/people/${ada}/files/${removableFileId}`,
    "DELETE",
  );
  storage.releaseRemoval();
  const concurrentStatuses = (await Promise.all([firstRemoval, secondRemoval]))
    .map((response) => response.status).sort();
  assert(
    concurrentStatuses.join(",") === "200,404" &&
      !storage.objects.has(removableStored!.storage_key),
    "two PostgreSQL connections yield one removal winner without resurrection",
  );

  const archivedUpload = await request(
    primary,
    `/api/v1/people/${ada}/files`,
    "POST",
    pdf,
  );
  const archivedFileId = (await archivedUpload.json() as {
    readonly file: { readonly fileId: string };
  }).file.fileId;
  await sql`update crm.people set archived_at = now() where id = ${ada}::uuid`;
  const archivedRemove = await request(
    primary,
    `/api/v1/people/${ada}/files/${archivedFileId}`,
    "DELETE",
  );
  assert(archivedRemove.status === 404, "archived person files are read-only");

  const audit = await sql<{ readonly action: string }[]>`
    select action from crm.audit_events
    where workspace_id = ${primary.workspaceId}::uuid
      and subject_type = 'file'
    order by occurred_at, created_at, id
  `;
  assert(
    audit.some((event) => event.action === "files.file-uploaded"),
    "upload audited",
  );
  assert(
    audit.some((event) => event.action === "files.file-read"),
    "read audited",
  );
  assert(
    audit.some((event) => event.action === "files.file-removed"),
    "remove audited",
  );
});

Deno.test("[FILES-001] a stalled object removal aborts and rolls back for a clean retry", async () => {
  const effects = { aborts: 0, deletes: 0 };
  let stall = true;
  const server = createServer((request, response) => {
    if (request.method !== "DELETE") {
      response.writeHead(200).end();
      return;
    }
    if (!stall) {
      effects.deletes += 1;
      response.writeHead(204).end();
      return;
    }
    let aborted = false;
    const abort = () => {
      if (aborted || response.writableEnded) return;
      aborted = true;
      effects.aborts += 1;
      clearTimeout(delayedDelete);
    };
    const delayedDelete = setTimeout(() => {
      if (aborted) return;
      effects.deletes += 1;
      response.writeHead(204).end();
    }, 250);
    request.once("aborted", abort);
    response.once("close", abort);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const timeoutStorage = new S3CompatibleObjectStorage(
    new MinioClient({
      accessKey: "access",
      endPoint: "127.0.0.1",
      port: (server.address() as AddressInfo).port,
      region: "us-east-1",
      secretKey: "secret-value",
      transport: createObjectStorageRequestTransport(false, 100),
      useSSL: false,
    }) as unknown as ConstructorParameters<
      typeof S3CompatibleObjectStorage
    >[0],
    "timeout-files",
  );
  const timeoutConfigured = createConfiguredApiApp(
    databaseUrl,
    new CapturedVerificationMail(),
    browserSecurityPolicy("test", "http://localhost"),
    undefined,
    undefined,
    undefined,
    timeoutStorage,
  );
  try {
    const suffix = crypto.randomUUID();
    const fixture = await register(
      `files-timeout-${suffix}@example.test`,
      "Files timeout",
    );
    const personId = await person(fixture, "Timeout");
    const uploaded = await request(
      fixture,
      `/api/v1/people/${personId}/files`,
      "POST",
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    );
    const fileId = (await uploaded.json() as {
      readonly file: { readonly fileId: string };
    }).file.fileId;

    const timedOut = await timeoutConfigured.app.request(
      `http://localhost/api/v1/people/${personId}/files/${fileId}`,
      {
        headers: {
          cookie: fixture.cookie,
          origin: "http://localhost",
          "X-Workspace-Id": fixture.workspaceId,
        },
        method: "DELETE",
      },
    );
    assert(
      timedOut.status === 503,
      `stalled removal is contained (status ${timedOut.status}, aborts ${effects.aborts}, deletes ${effects.deletes})`,
    );
    const [afterTimeout] = await sql<{ readonly status: string }[]>`
      select status from crm.files where id = ${fileId}::uuid
    `;
    assert(
      afterTimeout?.status === "available",
      "request timeout rolls back the removal transaction",
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert(
      effects.aborts === 1 && effects.deletes === 0,
      "destroyed request cannot delete after transaction rollback",
    );

    stall = false;
    const retried = await timeoutConfigured.app.request(
      `http://localhost/api/v1/people/${personId}/files/${fileId}`,
      {
        headers: {
          cookie: fixture.cookie,
          origin: "http://localhost",
          "X-Workspace-Id": fixture.workspaceId,
        },
        method: "DELETE",
      },
    );
    assert(
      retried.status === 200 && Number(effects.deletes) === 1,
      "retry performs exactly one object deletion",
    );
  } finally {
    await Promise.all([
      timeoutConfigured.close(),
      new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      ),
    ]);
  }
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
  name: "[FILES-001] GAP-009 a revoked member cannot upload, read, or remove",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        `file-revocation-${crypto.randomUUID()}`,
      );
      const files = createPersonFileManagement({
        actors: new PostgresActorRevalidation(),
        audit: fileAuditFrom(new PostgresAuditEventRecorder()),
        clock: { now: () => new Date() },
        ids: new WebCryptoFileIdentifiers(),
        keys: new WebCryptoObjectKeys(),
        repository: new PostgresFileMetadataRepository(),
        scanner: new DeclaredMediaScanner(),
        storage: new CapturedObjectStorage(),
        transaction: new PostgresPeopleTransaction(connection.db),
      });
      const upload = {
        bytes: new TextEncoder().encode("first"),
        filename: "first.txt",
        kind: "document" as const,
        mimeType: "text/plain",
        title: "First",
      };

      const allowed = await files.upload(actor, actor.personId, upload);
      assert(allowed.status === "created", "an active member uploads a file");

      await revokeMembership(actor.memberId);

      const refusedUpload = await files.upload(actor, actor.personId, {
        ...upload,
        bytes: new TextEncoder().encode("second"),
        filename: "second.txt",
        title: "Second",
      });
      const refusedList = await files.list(actor, actor.personId);
      const refusedDownload = await files.download(
        actor,
        actor.personId,
        allowed.status === "created"
          ? allowed.file.fileId
          : crypto.randomUUID(),
      );
      const refusedRemove = await files.remove(
        actor,
        actor.personId,
        allowed.status === "created"
          ? allowed.file.fileId
          : crypto.randomUUID(),
      );
      assert(
        refusedUpload.status === "forbidden" &&
          refusedList.status === "forbidden" &&
          refusedDownload.status === "forbidden" &&
          refusedRemove.status === "forbidden",
        "a revoked member still reached person files",
      );
      const [remaining] = await sql<[{ readonly count: number }]>`
        select count(*)::int as count from crm.files
        where workspace_id = ${actor.workspaceId}
      `;
      assert(remaining?.count === 1, "a revoked member wrote a file row");
    } finally {
      await connection.destroy();
    }
  },
});
Deno.test({
  name: "FILES-001 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.all([configured.close(), sql.end()]);
  },
});
