import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  createPersonFileManagement,
} from "../../packages/backend/modules/files/public.ts";
import { fileAuditFrom } from "../../packages/backend/modules/files/public.ts";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import type { ObjectStorage } from "../../packages/backend/modules/files/public.ts";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  DeclaredMediaScanner,
} from "../../packages/backend/modules/files/adapters/scanning/declared_media_scanner.ts";
import {
  PostgresFileMetadataRepository,
} from "../../packages/backend/modules/files/adapters/postgres/file_metadata_repository.ts";
import {
  WebCryptoFileIdentifiers,
  WebCryptoObjectKeys,
} from "../../packages/backend/modules/files/adapters/crypto/file_identifiers.ts";
import {
  PostgresAuditEventRecorder,
} from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import {
  PostgresPeopleTransaction,
} from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import {
  PostgresActorRevalidation,
} from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import {
  createS3CompatibleClient,
  S3CompatibleObjectStorage,
} from "../../packages/backend/modules/files/adapters/object_storage/s3_compatible_object_storage.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  assertCrossWorkspaceRefused,
  openSql,
  requireDatabaseUrl,
  revocableActor,
  revokeMembership,
} from "../support/database.ts";
import { apiSupport, type SignedInFixture } from "../support/api.ts";
import { createPerson } from "../support/fixtures.ts";
import { silentLogger } from "../../packages/backend/shared-kernel/telemetry.ts";

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

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl);
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
const api = apiSupport(configured.app, mail, sql);
const register = (email: string, workspaceName: string) =>
  api.register(email, workspaceName, { firstName: "File", lastName: "Tester" });
const person = (fixture: SignedInFixture, givenName: string) =>
  createPerson(api, fixture, givenName);

/** A file upload, which carries its bytes and metadata headers. */
function request(
  fixture: SignedInFixture,
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
  // A link from another workspace's person to this file is refused by the
  // database itself (ADR 0008), whichever workspace the row claims.
  for (const workspace of [foreign.workspaceId, primary.workspaceId]) {
    await assertCrossWorkspaceRefused(
      () =>
        sql`
          insert into crm.person_file_links (
            person_id, file_id, kind, title, workspace_id
          ) values (
            ${outsider}::uuid, ${malformedFileId}::uuid, 'document',
            'Foreign secret title', ${workspace}::uuid
          )
        `,
      "a person-file link across workspaces",
    );
  }
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
  const timeoutClient = createS3CompatibleClient({
    accessKey: "access",
    host: "127.0.0.1",
    port: (server.address() as AddressInfo).port,
    secretKey: "secret-value",
    useSsl: false,
  });
  const timeoutStorage = new S3CompatibleObjectStorage(
    timeoutClient,
    "timeout-files",
    100,
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
    // The client keeps its connections alive; close them so the server can.
    timeoutClient.destroy();
    await Promise.all([
      timeoutConfigured.close(),
      new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve())
      ),
    ]);
  }
});

// --- GAP-009 -------------------------------------------------------------

Deno.test({
  name: "[FILES-001] GAP-009 a revoked member cannot upload, read, or remove",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        sql,
        `file-revocation-${crypto.randomUUID()}`,
      );
      const files = createPersonFileManagement({
        actors: new PostgresActorRevalidation(),
        audit: fileAuditFrom(new PostgresAuditEventRecorder()),
        clock: { now: () => new Date() },
        ids: new WebCryptoFileIdentifiers(),
        keys: new WebCryptoObjectKeys(),
        logger: silentLogger(),
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

      await revokeMembership(sql, actor.memberId);

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
Deno.test("[GAP-023] PostgreSQL pages a person's files behind a bound cursor", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(
    `files-page-${suffix}@example.test`,
    "Files pages",
  );
  const foreign = await register(
    `files-page-foreign-${suffix}@example.test`,
    "Files pages foreign",
  );
  const ada = await person(primary, "Ada");
  const grace = await person(primary, "Grace");
  const outsider = await person(foreign, "Outsider");
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  const uploaded: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const response = await request(
      primary,
      `/api/v1/people/${ada}/files`,
      "POST",
      pdf,
    );
    const body = await response.json() as {
      readonly file: { readonly fileId: string };
    };
    assert(response.status === 201, "a paged file uploads");
    uploaded.push(body.file.fileId);
  }
  // One photo sorts ahead of the documents, and every row shares one instant,
  // so the page boundary is decided by the kind and then by the identifier.
  const photo = uploaded.at(-1)!;
  await sql`
    update crm.person_file_links set kind = 'photo'
    where person_id = ${ada}::uuid and file_id = ${photo}::uuid
  `;
  await sql`
    update crm.files set created_at = '2026-08-23T10:00:00Z'
    where id = any(${uploaded}::uuid[])
  `;
  interface Page {
    readonly files: readonly { readonly fileId: string }[];
    readonly nextCursor?: string;
  }
  const first = await request(primary, `/api/v1/people/${ada}/files?limit=2`);
  const firstBody = await first.json() as Page;
  assert(
    first.status === 200 && firstBody.files.length === 2 &&
      firstBody.files[0]?.fileId === photo && firstBody.nextCursor,
    "the first page did not lead with the photo and continue",
  );
  const cursor = encodeURIComponent(firstBody.nextCursor!);
  const second = await request(
    primary,
    `/api/v1/people/${ada}/files?limit=2&cursor=${cursor}`,
  );
  const secondBody = await second.json() as Page;
  const documents = uploaded.filter((id) => id !== photo).sort();
  assert(
    second.status === 200 && secondBody.files.length === 1 &&
      !secondBody.nextCursor &&
      JSON.stringify(
          [...firstBody.files, ...secondBody.files].map((file) => file.fileId),
        ) === JSON.stringify([photo, ...documents]),
    "the file continuation dropped, repeated, or reordered a file",
  );
  for (
    const [fixture, subject, query] of [
      [primary, grace, `cursor=${cursor}`],
      [foreign, outsider, `cursor=${cursor}`],
      [primary, ada, "cursor=not-a-cursor"],
      [primary, ada, "limit=0"],
    ] as const
  ) {
    const refused = await request(
      fixture,
      `/api/v1/people/${subject}/files?${query}`,
    );
    const problem = await refused.json() as { readonly code?: string };
    assert(
      refused.status === 400 && problem.code === "file_query_invalid",
      `${query} against another listing was answered: ${refused.status}`,
    );
  }
});

Deno.test({
  name:
    "[REL-082] the reserved-upload discard reaches only a processing row, linked or not",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const fixture = await register(
      `files-reserved-${crypto.randomUUID()}@example.test`,
      "Files reserved",
    );
    const ada = await person(fixture, "Ada");
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    const uploaded = async () => {
      const response = await request(
        fixture,
        `/api/v1/people/${ada}/files`,
        "POST",
        pdf,
      );
      assert(response.status === 201, "a file uploads");
      return (await response.json() as {
        readonly file: { readonly fileId: string };
      }).file.fileId;
    };
    const state = async (fileId: string) => {
      const [row] = await sql<
        { readonly linked: boolean; readonly status: string }[]
      >`
        select stored.status, exists (
          select 1 from crm.person_file_links link
          where link.file_id = stored.id
        ) as linked
        from crm.files stored where stored.id = ${fileId}::uuid
      `;
      return `${row?.status}:${row?.linked}`;
    };
    const connection = connectDatabase(databaseUrl);
    const repository = new PostgresFileMetadataRepository();
    const transaction = new PostgresPeopleTransaction(connection.db);
    const scope = { workspaceId: fixture.workspaceId };
    try {
      // A filed upload is never the discard's, even called on its own.
      const filed = await uploaded();
      await transaction.run((session) =>
        repository.discardReservedUpload({
          ...scope,
          fileId: filed,
          occurredAt: new Date(),
          transaction: session,
        }), { workspaceId: scope.workspaceId });
      assert(
        await state(filed) === "available:true",
        `a filed upload keeps its row and link: ${await state(filed)}`,
      );

      // A reservation whose link is already gone is still found and locked.
      const reserved = await uploaded();
      await sql`
        update crm.files set status = 'processing' where id = ${reserved}::uuid
      `;
      await sql`
        delete from crm.person_file_links where file_id = ${reserved}::uuid
      `;
      const locked = await transaction.run(
        (session) =>
          repository.lockReservedUpload({
            ...scope,
            fileId: reserved,
            transaction: session,
          }),
        { workspaceId: scope.workspaceId },
      );
      assert(locked?.storageKey, "an unlinked reservation is not hidden");
      await transaction.run((session) =>
        repository.discardReservedUpload({
          ...scope,
          fileId: reserved,
          occurredAt: new Date(),
          transaction: session,
        }), { workspaceId: scope.workspaceId });
      assert(
        await state(reserved) === "deleted:false",
        `the unlinked reservation is recorded deleted: ${await state(
          reserved,
        )}`,
      );
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
