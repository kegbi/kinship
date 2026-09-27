/**
 * Person files against a real S3-compatible store (GAP-037): a disposable,
 * pinned RustFS container started with `docker run`, the way the recovery
 * boundary suite starts its own, reached through the product's
 * `S3CompatibleObjectStorage` and request-timeout transport, and driven through
 * the files API. Three faults the product already names are observed here:
 *
 * - a store that stops answering mid-read trips the configured request
 *   timeout and answers `files_unavailable`, leaving the file available;
 * - a metadata row whose object was deleted from the bucket answers
 *   `file_missing` and is marked missing;
 * - a file the scanner quarantined is stored but never served.
 *
 * The stub-backed cases in `files_postgres_test.ts` stay where they are. This
 * suite removes its container in its final test.
 */

import { Client as MinioClient } from "minio";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { resolveObjectStorageConfiguration } from "../../apps/api/file_storage_config.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  createObjectStorageRequestTransport,
  S3CompatibleObjectStorage,
} from "../../packages/backend/modules/files/adapters/object_storage/s3_compatible_object_storage.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import { apiSupport, type SignedInFixture } from "../support/api.ts";
import { openSql, requireDatabaseUrl } from "../support/database.ts";
import { createPerson } from "../support/fixtures.ts";

/** The RustFS image `compose.support.yaml` pins for local and test stores. */
const RUSTFS_IMAGE =
  "rustfs/rustfs:1.0.0-beta.12@sha256:41fe89380f4120a337790c02af192c3fe7bb55c3edc2e6e9357b487b47c6ab21";
const ACCESS_KEY = "kinship";
const SECRET_KEY = `rustfs-${crypto.randomUUID()}`;
const BUCKET = "fault-files";
/** Short enough to trip on a paused store, long enough for a live one. */
const REQUEST_TIMEOUT_MS = "2000";

async function docker(
  args: readonly string[],
  capture = false,
): Promise<string> {
  const output = await new Deno.Command("docker", {
    args: [...args],
    stdin: "null",
    stdout: capture ? "piped" : "null",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `docker ${args[0]} failed with exit code ${output.code}: ${
        new TextDecoder().decode(output.stderr).trim()
      }`,
    );
  }
  return capture ? new TextDecoder().decode(output.stdout).trim() : "";
}

const container = `kinship-files-rustfs-${Deno.pid}-${Date.now()}`;

/**
 * Starts the disposable store and composes the API over it. Once `docker run`
 * has succeeded, any later setup failure removes the container before it is
 * reported, so a failed start never leaves RustFS running.
 */
async function startStore() {
  await docker([
    "run",
    "--detach",
    "--rm",
    "--name",
    container,
    "--env",
    `RUSTFS_ACCESS_KEY=${ACCESS_KEY}`,
    "--env",
    `RUSTFS_SECRET_KEY=${SECRET_KEY}`,
    "--publish",
    "127.0.0.1::9000",
    RUSTFS_IMAGE,
  ]);
  try {
    const port = Number(
      (await docker(["port", container, "9000/tcp"], true)).match(
        /:(\d+)$/,
      )?.[1],
    );
    assert(Number.isInteger(port) && port > 0, "RustFS published no port");

    // The store as the product configures it from its environment.
    const configuration = resolveObjectStorageConfiguration({
      get: (name) =>
        ({
          APP_ENV: "test",
          OBJECT_STORAGE_ACCESS_KEY: ACCESS_KEY,
          OBJECT_STORAGE_BUCKET: BUCKET,
          OBJECT_STORAGE_HOST: "127.0.0.1",
          OBJECT_STORAGE_PORT: String(port),
          OBJECT_STORAGE_REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
          OBJECT_STORAGE_SECRET_KEY: SECRET_KEY,
          OBJECT_STORAGE_USE_SSL: "false",
        } as Readonly<Record<string, string>>)[name],
    });
    const client = new MinioClient({
      accessKey: configuration.accessKey,
      endPoint: configuration.host,
      port: configuration.port,
      secretKey: configuration.secretKey,
      transport: createObjectStorageRequestTransport(
        configuration.useSsl,
        configuration.requestTimeoutMs,
      ),
      useSSL: configuration.useSsl,
    });
    const storage = new S3CompatibleObjectStorage(
      client as unknown as ConstructorParameters<
        typeof S3CompatibleObjectStorage
      >[0],
      configuration.bucket,
    );

    // RustFS answers its health check before it serves S3 requests; the
    // first bucket probe is retried until the store is ready, never in
    // product code.
    for (let attempt = 0;; attempt++) {
      if (await storage.health() !== "unavailable") break;
      if (attempt === 120) throw new Error("Disposable RustFS did not start.");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const databaseUrl = requireDatabaseUrl();
    const sql = openSql(databaseUrl);
    const mail = new CapturedVerificationMail();
    const configured = createConfiguredApiApp(
      databaseUrl,
      mail,
      browserSecurityPolicy("test", "http://localhost"),
      undefined,
      undefined,
      undefined,
      storage,
    );
    return {
      api: apiSupport(configured.app, mail, sql),
      client,
      configured,
      sql,
    };
  } catch (error) {
    await docker(["rm", "--force", container]).catch(() => undefined);
    throw error;
  }
}

const { api, client, configured, sql } = await startStore();

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

async function fixture(name: string): Promise<{
  readonly owner: SignedInFixture;
  readonly personId: string;
}> {
  const owner = await api.register(
    `files-store-${name}-${crypto.randomUUID()}@example.test`,
    `Files store ${name}`,
    { firstName: "Store", lastName: "Tester" },
  );
  return { owner, personId: await createPerson(api, owner, "Stored") };
}

function fileRequest(
  owner: SignedInFixture,
  path: string,
  body?: Uint8Array,
): Promise<Response> {
  return Promise.resolve(configured.app.request(`http://localhost${path}`, {
    ...(body ? { body: body.slice().buffer } : {}),
    headers: {
      cookie: owner.cookie,
      origin: "http://localhost",
      "X-File-Kind": "document",
      "X-File-Name": "care-plan.pdf",
      "X-File-Title": "Care plan",
      "X-Workspace-Id": owner.workspaceId,
      ...(body ? { "content-type": "application/pdf" } : {}),
    },
    method: body ? "POST" : "GET",
  }));
}

async function upload(
  owner: SignedInFixture,
  personId: string,
  bytes: Uint8Array,
): Promise<{ readonly fileId: string; readonly status: string }> {
  const response = await fileRequest(
    owner,
    `/api/v1/people/${personId}/files`,
    bytes,
  );
  const body = await response.json() as {
    readonly file?: { readonly fileId: string; readonly status: string };
  };
  assert(
    response.status === 201 && body.file,
    `upload failed: ${response.status}`,
  );
  return body.file;
}

async function download(
  owner: SignedInFixture,
  personId: string,
  fileId: string,
): Promise<{ readonly code?: string; readonly status: number }> {
  const response = await fileRequest(
    owner,
    `/api/v1/people/${personId}/files/${fileId}/content`,
  );
  if (response.ok) {
    await response.arrayBuffer();
    return { status: response.status };
  }
  const problem = await response.json() as { readonly code?: string };
  return { ...problem, status: response.status };
}

async function storedKey(fileId: string): Promise<string> {
  const [row] = await sql<{ readonly key: string }[]>`
    select storage_key as key from crm.files where id = ${fileId}::uuid
  `;
  assert(row, "the file row was not written");
  return row.key;
}

async function fileState(fileId: string): Promise<{
  readonly reads: number;
  readonly status: string;
}> {
  const [row] = await sql<
    { readonly reads: number; readonly status: string }[]
  >`
    select stored.status,
      (select count(*)::int from crm.audit_events event
        where event.subject_id = stored.id
          and event.action = 'files.file-read') as reads
    from crm.files stored where stored.id = ${fileId}::uuid
  `;
  assert(row, "the file row disappeared");
  return row;
}

Deno.test({
  name:
    "[FILES-001] GAP-037 a stalled RustFS read times out and leaves the file available",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { owner, personId } = await fixture("timeout");
    const file = await upload(owner, personId, PDF);

    await docker(["pause", container]);
    let stalled;
    try {
      stalled = await download(owner, personId, file.fileId);
    } finally {
      await docker(["unpause", container]);
    }
    const afterStall = await fileState(file.fileId);
    assert(
      stalled.status === 503 && stalled.code === "files_unavailable" &&
        afterStall.status === "available" && afterStall.reads === 0,
      `a stalled store was not contained: ${JSON.stringify(stalled)} ${
        JSON.stringify(afterStall)
      }`,
    );

    const recovered = await download(owner, personId, file.fileId);
    const afterRead = await fileState(file.fileId);
    assert(
      recovered.status === 200 && afterRead.status === "available" &&
        afterRead.reads === 1,
      `the recovered store did not serve and audit one read: ${
        JSON.stringify(recovered)
      }`,
    );
  },
});

Deno.test({
  name:
    "[FILES-001] GAP-037 a RustFS object deleted behind the metadata answers missing",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { owner, personId } = await fixture("missing");
    const file = await upload(owner, personId, PDF);
    await client.removeObject(BUCKET, await storedKey(file.fileId));

    const missing = await download(owner, personId, file.fileId);
    const state = await fileState(file.fileId);
    assert(
      missing.status === 410 && missing.code === "file_missing" &&
        state.status === "missing" && state.reads === 0,
      `a missing object was not reported: ${JSON.stringify(missing)} ${
        JSON.stringify(state)
      }`,
    );
    const again = await download(owner, personId, file.fileId);
    assert(
      again.status === 410 && again.code === "file_missing",
      "a file marked missing was served or reported differently",
    );
  },
});

Deno.test({
  name:
    "[FILES-001] GAP-037 a quarantined file is stored in RustFS but never served",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { owner, personId } = await fixture("quarantine");
    // Declared a PDF, but the bytes are not one: the scanner quarantines it.
    const file = await upload(
      owner,
      personId,
      new TextEncoder().encode("not a pdf"),
    );
    const stat = await client.statObject(BUCKET, await storedKey(file.fileId));

    const refused = await download(owner, personId, file.fileId);
    const state = await fileState(file.fileId);
    const [uploaded] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.audit_events
      where subject_id = ${file.fileId}::uuid
        and action = 'files.file-uploaded'
    `;
    assert(
      file.status === "quarantined" && stat.size === 9 &&
        refused.status === 423 && refused.code === "file_quarantined" &&
        state.status === "quarantined" && state.reads === 0 &&
        uploaded?.count === 1,
      `a quarantined file was served or not audited: ${
        JSON.stringify(refused)
      } ${JSON.stringify(state)}`,
    );
  },
});

Deno.test({
  name: "[FILES-001] GAP-037 RustFS container and PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.all([configured.close(), sql.end()]);
    await docker(["rm", "--force", container]);
  },
});
