import postgres from "postgres";
import { Client as MinioClient } from "minio";
import { Buffer } from "node:buffer";
import {
  createBackup,
  MinioRecovery,
  PostgresRecovery,
  privateProductionArchivePath,
  restoreBackup,
} from "./private_production_recovery.ts";
import { loadPrivateProductionProfile } from "./private_production_probe.ts";

const POSTGRES_IMAGE =
  "postgres:18.4-alpine3.23@sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e";
const MINIO_IMAGE =
  "minio/minio:RELEASE.2025-07-23T15-54-02Z@sha256:d249d1fb6966de4d8ad26c04754b545205ff15a62e4fd19ebd0f26fa5baacbc0";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
    throw new Error(`docker command failed with exit code ${output.code}`);
  }
  return capture ? new TextDecoder().decode(output.stdout).trim() : "";
}

async function mappedPort(container: string, port: number): Promise<number> {
  const mapping = await docker(["port", container, `${port}/tcp`], true);
  const value = Number(mapping.match(/:(\d+)$/)?.[1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Could not resolve disposable container port.");
  }
  return value;
}

async function waitForPostgres(databaseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const sql = postgres(databaseUrl, { connect_timeout: 1, max: 1 });
    try {
      await sql`select 1`;
      await sql.end();
      return;
    } catch {
      await sql.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Disposable PostgreSQL did not become ready.");
}

async function applyCanonicalSchema(databaseUrl: string): Promise<void> {
  const output = await new Deno.Command("deno", {
    args: ["task", "migration:apply"],
    env: { DATABASE_URL: databaseUrl, DENO_NO_PACKAGE_JSON: "1" },
    stdin: "null",
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `canonical migration verifier failed with exit code ${output.code}`,
    );
  }
}

async function waitForMinio(client: MinioClient): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await client.listBuckets();
      return;
    } catch {
      if (attempt === 59) {
        throw new Error("Disposable MinIO did not become ready.");
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

Deno.test({
  name:
    "OPS-001C restores a real PostgreSQL and S3-compatible backup into isolated targets",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const suffix = `${Deno.pid}-${Date.now()}`;
    const sourceContainer = `kinship-recovery-source-${suffix}`;
    const targetContainer = `kinship-recovery-target-${suffix}`;
    const sourceMinioContainer = `kinship-recovery-minio-source-${suffix}`;
    const targetMinioContainer = `kinship-recovery-minio-target-${suffix}`;
    const password = `test-${crypto.randomUUID()}`;
    const accessKey = "kinship-recovery";
    const secretKey = `test-${crypto.randomUUID()}`;
    const completeArchiveId = `boundary-complete-${suffix}`;
    const missingArchiveId = `boundary-missing-${suffix}`;
    const containers = [
      sourceContainer,
      targetContainer,
      sourceMinioContainer,
      targetMinioContainer,
    ];
    try {
      await docker([
        "run",
        "--detach",
        "--rm",
        "--name",
        sourceContainer,
        "--env",
        "POSTGRES_DB=kinship",
        "--env",
        "POSTGRES_USER=kinship",
        "--env",
        `POSTGRES_PASSWORD=${password}`,
        "--publish",
        "127.0.0.1::5432",
        POSTGRES_IMAGE,
      ]);
      await docker([
        "run",
        "--detach",
        "--rm",
        "--name",
        targetContainer,
        "--env",
        "POSTGRES_DB=kinship_restore",
        "--env",
        "POSTGRES_USER=kinship",
        "--env",
        `POSTGRES_PASSWORD=${password}`,
        "--publish",
        "127.0.0.1::5432",
        POSTGRES_IMAGE,
      ]);
      await docker([
        "run",
        "--detach",
        "--rm",
        "--name",
        sourceMinioContainer,
        "--env",
        `MINIO_ROOT_USER=${accessKey}`,
        "--env",
        `MINIO_ROOT_PASSWORD=${secretKey}`,
        "--publish",
        "127.0.0.1::9000",
        MINIO_IMAGE,
        "server",
        "/data",
      ]);
      await docker([
        "run",
        "--detach",
        "--rm",
        "--name",
        targetMinioContainer,
        "--env",
        `MINIO_ROOT_USER=${accessKey}`,
        "--env",
        `MINIO_ROOT_PASSWORD=${secretKey}`,
        "--publish",
        "127.0.0.1::9000",
        MINIO_IMAGE,
        "server",
        "/data",
      ]);

      const sourcePort = await mappedPort(sourceContainer, 5432);
      const targetPort = await mappedPort(targetContainer, 5432);
      const sourceMinioPort = await mappedPort(sourceMinioContainer, 9000);
      const targetMinioPort = await mappedPort(targetMinioContainer, 9000);
      const sourceUrl = `postgres://kinship:${
        encodeURIComponent(password)
      }@127.0.0.1:${sourcePort}/kinship`;
      const targetUrl = `postgres://kinship:${
        encodeURIComponent(password)
      }@127.0.0.1:${targetPort}/kinship_restore`;
      await Promise.all([
        waitForPostgres(sourceUrl),
        waitForPostgres(targetUrl),
      ]);
      await applyCanonicalSchema(sourceUrl);

      const sourceSql = postgres(sourceUrl, { max: 1 });
      await sourceSql`
        insert into crm.workspaces (id, name)
        values ('10000000-0000-4000-8000-000000000001', 'Recovery workspace')
      `;
      await sourceSql`
        insert into crm.files (
          id, workspace_id, original_filename, storage_provider,
          storage_bucket, storage_key, byte_size, mime_type
        ) values (
          '20000000-0000-4000-8000-000000000001',
          '10000000-0000-4000-8000-000000000001', 'wanted.txt', 's3',
          'attachments', 'wanted', 6, 'text/plain'
        )
      `;
      await sourceSql.end();

      const sourceClient = new MinioClient({
        accessKey,
        endPoint: "127.0.0.1",
        port: sourceMinioPort,
        secretKey,
        useSSL: false,
      });
      const targetClient = new MinioClient({
        accessKey,
        endPoint: "127.0.0.1",
        port: targetMinioPort,
        secretKey,
        useSSL: false,
      });
      await Promise.all([
        waitForMinio(sourceClient),
        waitForMinio(targetClient),
      ]);
      await sourceClient.makeBucket("attachments");
      await sourceClient.putObject(
        "attachments",
        "wanted",
        Buffer.from("wanted"),
        6,
      );
      await sourceClient.putObject(
        "attachments",
        "extra",
        Buffer.from("extra"),
        5,
      );

      const sourceDatabase = new PostgresRecovery(sourceUrl, {
        dump: {
          argsPrefix: ["exec", sourceContainer, "pg_dump"],
          executable: "docker",
        },
        restore: {
          argsPrefix: ["exec", "--interactive", sourceContainer, "pg_restore"],
          executable: "docker",
        },
      });
      const targetDatabase = new PostgresRecovery(targetUrl, {
        dump: {
          argsPrefix: ["exec", targetContainer, "pg_dump"],
          executable: "docker",
        },
        restore: {
          argsPrefix: ["exec", "--interactive", targetContainer, "pg_restore"],
          executable: "docker",
        },
      });
      const profile = await loadPrivateProductionProfile();
      await createBackup({
        archiveId: completeArchiveId,
        bucket: "attachments",
        database: sourceDatabase,
        databaseName: "kinship",
        objects: new MinioRecovery(sourceClient, "attachments"),
        profile,
      });
      const sentinelSql = postgres(targetUrl, { max: 1 });
      await sentinelSql`create table public.restore_sentinel (id integer primary key)`;
      await sentinelSql.end();
      let sentinelFailure: unknown;
      try {
        await restoreBackup({
          archiveId: completeArchiveId,
          bucket: "attachments",
          database: targetDatabase,
          databaseName: "kinship_restore",
          objects: new MinioRecovery(targetClient, "attachments"),
          profile,
        });
      } catch (error) {
        sentinelFailure = error;
      }
      assert(
        sentinelFailure instanceof Error &&
          sentinelFailure.message.includes("not empty"),
        "public user relation must reject restore before target mutation",
      );
      const rejectedTargetSql = postgres(targetUrl, { max: 1 });
      const [rejectedState] = await rejectedTargetSql<{
        readonly crm_present: boolean;
        readonly sentinel_present: boolean;
      }[]>`
        select
          to_regnamespace('crm') is not null as crm_present,
          to_regclass('public.restore_sentinel') is not null as sentinel_present
      `;
      await rejectedTargetSql`drop table public.restore_sentinel`;
      await rejectedTargetSql.end();
      assert(
        rejectedState?.crm_present === false && rejectedState.sentinel_present,
        "rejected restore preserves sentinel and creates no CRM schema",
      );
      assert(
        !(await targetClient.bucketExists("attachments")),
        "rejected restore creates no target object bucket",
      );
      const result = await restoreBackup({
        archiveId: completeArchiveId,
        bucket: "attachments",
        database: targetDatabase,
        databaseName: "kinship_restore",
        objects: new MinioRecovery(targetClient, "attachments"),
        profile,
      });
      assert(
        result.missingObjectCount === 0,
        "restored DB references must resolve",
      );
      assert(
        result.extraObjectCount === 1,
        "orphan object must be reconciled explicitly",
      );
      assert(
        result.state === "attention-required",
        "orphan object must produce a non-clean recovery state",
      );
      assert(
        result.rpoMet && result.rtoMet,
        "private recovery objectives must be measured",
      );

      const targetSql = postgres(targetUrl, { max: 1 });
      const [restored] = await targetSql<
        { readonly name: string; readonly storage_key: string }[]
      >`
        select w.name, f.storage_key from crm.workspaces w
        join crm.files f on f.workspace_id = w.id
      `;
      await targetSql.end();
      assert(
        restored?.name === "Recovery workspace" &&
          restored.storage_key === "wanted",
        "PostgreSQL restore must preserve application metadata",
      );
      const restoredBytes = await new MinioRecovery(
        targetClient,
        "attachments",
      ).get("wanted");
      assert(
        restoredBytes && new TextDecoder().decode(restoredBytes) === "wanted",
        "object restore must preserve bytes",
      );

      await sourceClient.removeObject("attachments", "wanted");
      let missingFailure: unknown;
      try {
        await createBackup({
          archiveId: missingArchiveId,
          bucket: "attachments",
          database: sourceDatabase,
          databaseName: "kinship",
          objects: new MinioRecovery(sourceClient, "attachments"),
          profile,
        });
      } catch (error) {
        missingFailure = error;
      }
      assert(
        missingFailure instanceof Error &&
          missingFailure.message.includes("1 missing object"),
        "real missing S3 bytes must reject backup without exposing the key",
      );
    } finally {
      await Promise.all(
        containers.map((container) =>
          docker(["rm", "--force", container]).catch(() => undefined)
        ),
      );
      await Promise.all(
        [completeArchiveId, missingArchiveId].map((archiveId) =>
          Deno.remove(privateProductionArchivePath(archiveId), {
            recursive: true,
          }).catch(() => undefined)
        ),
      );
    }
  },
});
