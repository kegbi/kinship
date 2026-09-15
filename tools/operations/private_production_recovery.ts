import postgres from "postgres";
// The MinIO package is an S3 protocol client; local/test servers are RustFS.
import { Client as S3Client } from "minio";
import { Buffer } from "node:buffer";
import { applyCanonicalSchema } from "../migrations/baseline.ts";
import {
  loadPrivateProductionProfile,
  type PrivateProductionProfile,
} from "./private_production_probe.ts";

const FORMAT = "kinship-private-production-backup";
const MANIFEST_FILE = "manifest.json";
const DATABASE_FILE = "database.dump";
export const PRIVATE_PRODUCTION_ARCHIVE_ROOT =
  ".artifacts/private-production-recovery";
const ARCHIVE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export interface DatabaseRecoveryPort {
  readonly assertEmpty: () => Promise<void>;
  readonly dump: () => Promise<Uint8Array>;
  readonly objectKeys: () => Promise<readonly string[]>;
  readonly restore: (dump: Uint8Array) => Promise<void>;
  readonly verifyCanonicalV7: () => Promise<void>;
}

export interface ObjectRecoveryPort {
  readonly assertEmpty: () => Promise<void>;
  readonly get: (key: string) => Promise<Uint8Array | undefined>;
  readonly list: () => Promise<
    readonly { readonly key: string; readonly size: number }[]
  >;
  readonly put: (key: string, bytes: Uint8Array) => Promise<void>;
}

interface BackupManifest {
  readonly createdAt: string;
  readonly database: {
    readonly file: typeof DATABASE_FILE;
    readonly name: string;
    readonly objectKeys: readonly string[];
    readonly sha256: string;
    readonly size: number;
  };
  readonly environment: "private-production";
  readonly format: typeof FORMAT;
  readonly objects: readonly {
    readonly file: string;
    readonly key: string;
    readonly sha256: string;
    readonly size: number;
  }[];
  readonly recovery: PrivateProductionProfile["recovery"];
  readonly sourceBucket: string;
  readonly version: 1;
}

export interface RecoveryResult {
  readonly databaseObjectCount: number;
  readonly durationMs: number;
  readonly environment: "private-production";
  readonly event: "operator.recovery";
  readonly extraObjectCount: number;
  readonly missingObjectCount: number;
  readonly objectCount: number;
  readonly recoveryPointAgeMs: number;
  readonly rpoMet: boolean;
  readonly rtoMet: boolean;
  readonly schemaVersion: 7;
  readonly state: "attention-required" | "restored";
}

interface BackupCommand {
  readonly archiveId: string;
  readonly bucket: string;
  readonly database: DatabaseRecoveryPort;
  readonly databaseName: string;
  readonly now?: () => Date;
  readonly objects: ObjectRecoveryPort;
  readonly profile: PrivateProductionProfile;
}

interface RestoreCommand extends BackupCommand {}

function path(directory: string, relative: string): string {
  return `${directory}/${relative}`;
}

export function privateProductionArchivePath(archiveId: string): string {
  if (!ARCHIVE_ID_PATTERN.test(archiveId)) {
    throw new Error(
      "Archive ID must contain 1-64 lowercase letters, digits, or hyphens.",
    );
  }
  return path(PRIVATE_PRODUCTION_ARCHIVE_ROOT, archiveId);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function objectFile(key: string): Promise<string> {
  return `objects/${await sha256(new TextEncoder().encode(key))}.bin`;
}

function reconciliation(
  databaseKeys: readonly string[],
  objectKeys: readonly string[],
): { readonly extra: number; readonly missing: number } {
  const database = new Set(databaseKeys);
  const objects = new Set(objectKeys);
  return {
    extra: [...objects].filter((key) => !database.has(key)).length,
    missing: [...database].filter((key) => !objects.has(key)).length,
  };
}

async function claimNewDirectory(archiveId: string): Promise<string> {
  const directory = privateProductionArchivePath(archiveId);
  await Deno.mkdir(PRIVATE_PRODUCTION_ARCHIVE_ROOT, { recursive: true });
  try {
    await Deno.mkdir(directory);
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      throw new Error("Backup archive ID already exists.");
    }
    throw error;
  }
  return directory;
}

function assertProfile(profile: PrivateProductionProfile): void {
  if (
    profile.environment !== "private-production" ||
    profile.recovery.archiveRoot !== PRIVATE_PRODUCTION_ARCHIVE_ROOT ||
    profile.recovery.backupSchedule !== "daily" ||
    !profile.recovery.backupCommand ||
    profile.recovery.manifestVersion !== 1 ||
    profile.recovery.migrationVerificationTask !==
      "deno task test:schema:matrix" ||
    profile.recovery.prerequisites.length < 3 ||
    profile.recovery.retentionDays !== 30 ||
    !profile.recovery.restoreCommand ||
    profile.recovery.rpoHours !== 24 ||
    profile.recovery.rtoMinutes !== 240 ||
    profile.recovery.schemaVersion !== 7
  ) {
    throw new Error("Invalid private-production recovery policy.");
  }
}

export async function createBackup(command: BackupCommand): Promise<void> {
  assertProfile(command.profile);
  let ownedDirectory: string | undefined;
  try {
    ownedDirectory = await claimNewDirectory(command.archiveId);
    await Deno.mkdir(path(ownedDirectory, "objects"));
    await command.database.verifyCanonicalV7();
    const [dump, databaseKeys, listedObjects] = await Promise.all([
      command.database.dump(),
      command.database.objectKeys(),
      command.objects.list().catch(() => {
        throw new Error("Object listing failed.");
      }),
    ]);
    const listedKeys = listedObjects.map(({ key }) => key);
    const sourceState = reconciliation(databaseKeys, listedKeys);
    if (sourceState.missing > 0) {
      throw new Error(
        `Backup rejected: ${sourceState.missing} missing object${
          sourceState.missing === 1 ? "" : "s"
        } referenced by database metadata.`,
      );
    }

    await Deno.writeFile(path(ownedDirectory, DATABASE_FILE), dump);
    const manifestObjects: BackupManifest["objects"][number][] = [];
    const uniqueKeys = new Set<string>();
    for (
      const listed of [...listedObjects].sort((a, b) =>
        a.key.localeCompare(b.key)
      )
    ) {
      if (uniqueKeys.has(listed.key)) {
        throw new Error("Backup rejected duplicate object metadata.");
      }
      uniqueKeys.add(listed.key);
      const bytes = await command.objects.get(listed.key).catch(() => {
        throw new Error("Object backup read failed.");
      });
      if (!bytes || bytes.byteLength !== listed.size) {
        throw new Error("Backup rejected changed or unavailable object data.");
      }
      const file = await objectFile(listed.key);
      await Deno.writeFile(path(ownedDirectory, file), bytes);
      manifestObjects.push({
        file,
        key: listed.key,
        sha256: await sha256(bytes),
        size: bytes.byteLength,
      });
    }

    const manifest: BackupManifest = {
      createdAt: (command.now ?? (() => new Date()))().toISOString(),
      database: {
        file: DATABASE_FILE,
        name: command.databaseName,
        objectKeys: [...new Set(databaseKeys)].sort(),
        sha256: await sha256(dump),
        size: dump.byteLength,
      },
      environment: "private-production",
      format: FORMAT,
      objects: manifestObjects,
      recovery: command.profile.recovery,
      sourceBucket: command.bucket,
      version: 1,
    };
    await Deno.writeTextFile(
      path(ownedDirectory, MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { createNew: true },
    );
  } catch (error) {
    if (ownedDirectory) {
      await Deno.remove(ownedDirectory, { recursive: true }).catch(
        () => undefined,
      );
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseManifest(value: unknown): BackupManifest {
  if (
    !isRecord(value) || !isRecord(value.database) ||
    !isRecord(value.recovery) || !Array.isArray(value.objects) ||
    value.format !== FORMAT || value.version !== 1 ||
    value.environment !== "private-production" ||
    value.database.file !== DATABASE_FILE ||
    typeof value.database.name !== "string" ||
    typeof value.database.sha256 !== "string" ||
    typeof value.database.size !== "number" ||
    !Array.isArray(value.database.objectKeys) ||
    typeof value.createdAt !== "string" ||
    typeof value.sourceBucket !== "string"
  ) {
    throw new Error("Invalid backup manifest.");
  }
  const manifest = value as unknown as BackupManifest;
  if (
    !Number.isFinite(new Date(manifest.createdAt).getTime()) ||
    !manifest.database.objectKeys.every((key) => typeof key === "string")
  ) {
    throw new Error("Invalid backup manifest metadata.");
  }
  const keys = new Set<string>();
  const files = new Set<string>();
  for (const entry of manifest.objects) {
    if (
      !isRecord(entry) || typeof entry.key !== "string" ||
      typeof entry.file !== "string" || typeof entry.sha256 !== "string" ||
      typeof entry.size !== "number" || keys.has(entry.key) ||
      files.has(entry.file)
    ) {
      throw new Error("Invalid backup object manifest.");
    }
    keys.add(entry.key);
    files.add(entry.file);
  }
  return manifest;
}

async function readValidatedArchive(
  directory: string,
  profile: PrivateProductionProfile,
): Promise<{
  readonly dump: Uint8Array;
  readonly manifest: BackupManifest;
  readonly objects: readonly {
    readonly bytes: Uint8Array;
    readonly key: string;
  }[];
}> {
  assertProfile(profile);
  const manifest = parseManifest(JSON.parse(
    await Deno.readTextFile(path(directory, MANIFEST_FILE)),
  ));
  if (JSON.stringify(manifest.recovery) !== JSON.stringify(profile.recovery)) {
    throw new Error("Backup recovery policy mismatch.");
  }
  const dump = await Deno.readFile(path(directory, manifest.database.file));
  if (
    dump.byteLength !== manifest.database.size ||
    await sha256(dump) !== manifest.database.sha256
  ) {
    throw new Error("Database backup checksum mismatch.");
  }
  const objects: { readonly bytes: Uint8Array; readonly key: string }[] = [];
  for (const entry of manifest.objects) {
    if (entry.file !== await objectFile(entry.key)) {
      throw new Error("Object backup path mismatch.");
    }
    const bytes = await Deno.readFile(path(directory, entry.file));
    if (
      bytes.byteLength !== entry.size || await sha256(bytes) !== entry.sha256
    ) {
      throw new Error("Object backup checksum mismatch.");
    }
    objects.push({ bytes, key: entry.key });
  }
  return { dump, manifest, objects };
}

export async function restoreBackup(
  command: RestoreCommand,
): Promise<RecoveryResult> {
  const startedAt = (command.now ?? (() => new Date()))();
  const archiveDirectory = privateProductionArchivePath(command.archiveId);
  const archive = await readValidatedArchive(
    archiveDirectory,
    command.profile,
  );
  if (command.bucket !== archive.manifest.sourceBucket) {
    throw new Error("Restore bucket mismatch with backup manifest.");
  }
  await Promise.all([
    command.database.assertEmpty(),
    command.objects.assertEmpty(),
  ]);
  await command.database.restore(archive.dump);
  for (const object of archive.objects) {
    await command.objects.put(object.key, object.bytes).catch(() => {
      throw new Error("Object restore failed.");
    });
  }
  await command.database.verifyCanonicalV7();
  const [databaseKeys, objectMetadata] = await Promise.all([
    command.database.objectKeys(),
    command.objects.list().catch(() => {
      throw new Error("Object reconciliation failed.");
    }),
  ]);
  const state = reconciliation(
    databaseKeys,
    objectMetadata.map(({ key }) => key),
  );
  const completedAt = (command.now ?? (() => new Date()))();
  const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
  const recoveryPointAgeMs = Math.max(
    0,
    startedAt.getTime() - new Date(archive.manifest.createdAt).getTime(),
  );
  return {
    databaseObjectCount: databaseKeys.length,
    durationMs,
    environment: "private-production",
    event: "operator.recovery",
    extraObjectCount: state.extra,
    missingObjectCount: state.missing,
    objectCount: objectMetadata.length,
    recoveryPointAgeMs,
    rpoMet: recoveryPointAgeMs <= command.profile.recovery.rpoHours * 3_600_000,
    rtoMet: durationMs <= command.profile.recovery.rtoMinutes * 60_000,
    schemaVersion: 7,
    state: state.missing === 0 && state.extra === 0
      ? "restored"
      : "attention-required",
  };
}

function postgresEnvironment(databaseUrl: string): {
  readonly database: string;
  readonly environment: Record<string, string>;
  readonly user: string;
} {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("PostgreSQL connection URL is required.");
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database) throw new Error("PostgreSQL database name is required.");
  const user = decodeURIComponent(url.username);
  if (!user) throw new Error("PostgreSQL user is required.");
  return {
    database,
    user,
    environment: {
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
      PGHOST: url.hostname,
      PGPASSWORD: decodeURIComponent(url.password),
      PGPORT: url.port || "5432",
      PGUSER: user,
    },
  };
}

async function runPostgresTool(
  kind: "pg_dump" | "pg_restore",
  databaseUrl: string,
  input?: Uint8Array,
  command: {
    readonly argsPrefix: readonly string[];
    readonly executable: string;
  } = {
    argsPrefix: [],
    executable: kind,
  },
): Promise<Uint8Array> {
  const connection = postgresEnvironment(databaseUrl);
  const version = await new Deno.Command(command.executable, {
    args: [...command.argsPrefix, "--version"],
    env: connection.environment,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (
    !version.success ||
    !new TextDecoder().decode(version.stdout).includes("18.4")
  ) {
    throw new Error(`${kind} must use the pinned PostgreSQL 18.4 client.`);
  }
  const child = new Deno.Command(command.executable, {
    args: [
      ...command.argsPrefix,
      ...(kind === "pg_dump"
        ? ["--format=custom", "--no-owner", "--no-privileges"]
        : ["--exit-on-error", "--no-owner", "--no-privileges"]),
      "--username",
      connection.user,
      "--dbname",
      connection.database,
    ],
    env: connection.environment,
    stdin: input ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  if (input && child.stdin) {
    const writer = child.stdin.getWriter();
    await writer.write(input);
    await writer.close();
  }
  const output = await child.output();
  if (!output.success) {
    throw new Error(`${kind} failed with exit code ${output.code}.`);
  }
  return output.stdout;
}

async function canonicalArtifacts() {
  const root = new URL("../../", import.meta.url);
  const read = (relative: string) => Deno.readTextFile(new URL(relative, root));
  const [
    v1Sql,
    v2Sql,
    v3Sql,
    v4Sql,
    v5Sql,
    v6Sql,
    v7Sql,
    migrationV1ToV2,
    migrationV2ToV3,
    migrationV3ToV4,
    migrationV4ToV5,
    migrationV5ToV6,
    migrationV6ToV7,
  ] = await Promise.all([
    read("personal-crm-schema/v1/personal_crm_rewrite_schema_v3.sql"),
    read("personal-crm-schema/v2/personal_crm_schema_v2.sql"),
    read("personal-crm-schema/v3/personal_crm_schema_v3.sql"),
    read("personal-crm-schema/v4/personal_crm_schema_v4.sql"),
    read("personal-crm-schema/v5/personal_crm_schema_v5.sql"),
    read("personal-crm-schema/v6/personal_crm_schema_v6.sql"),
    read("personal-crm-schema/v7/personal_crm_schema_v7.sql"),
    read(
      "personal-crm-schema/v2/migrations/0002_add_authentication_subject_digest.sql",
    ),
    read("personal-crm-schema/v3/migrations/0003_add_user_session_purpose.sql"),
    read("personal-crm-schema/v4/migrations/0004_seed_iso_4217_currencies.sql"),
    read(
      "personal-crm-schema/v5/migrations/0005_add_person_date_year_approximation.sql",
    ),
    read(
      "personal-crm-schema/v6/migrations/0006_add_durable_reminder_delivery.sql",
    ),
    read(
      "personal-crm-schema/v7/migrations/0007_add_workspace_deletion_records.sql",
    ),
  ]);
  return {
    migrationV1ToV2,
    migrationV2ToV3,
    migrationV3ToV4,
    migrationV4ToV5,
    migrationV5ToV6,
    migrationV6ToV7,
    v1Sql,
    v2Sql,
    v3Sql,
    v4Sql,
    v5Sql,
    v6Sql,
    v7Sql,
  };
}

export class PostgresRecovery implements DatabaseRecoveryPort {
  constructor(
    private readonly databaseUrl: string,
    private readonly commands?: {
      readonly dump: {
        readonly argsPrefix: readonly string[];
        readonly executable: string;
      };
      readonly restore: {
        readonly argsPrefix: readonly string[];
        readonly executable: string;
      };
    },
  ) {}

  async assertEmpty(): Promise<void> {
    const sql = postgres(this.databaseUrl, { max: 1 });
    try {
      const [row] = await sql<{
        readonly relation_present: boolean;
        readonly schema_present: boolean;
      }[]>`
        select
          exists(
            select 1 from pg_class relation
            join pg_namespace namespace on namespace.oid = relation.relnamespace
            where namespace.nspname not in ('pg_catalog', 'information_schema')
              and namespace.nspname not like 'pg_%'
              and relation.relkind in ('r', 'p', 'v', 'm', 'S', 'f', 'c')
          ) as relation_present,
          exists(
            select 1 from pg_namespace
            where nspname not in ('public', 'pg_catalog', 'information_schema')
              and nspname not like 'pg_%'
          ) as schema_present
      `;
      if (row?.relation_present || row?.schema_present) {
        throw new Error("Restore database is not empty.");
      }
    } finally {
      await sql.end();
    }
  }

  dump(): Promise<Uint8Array> {
    return runPostgresTool(
      "pg_dump",
      this.databaseUrl,
      undefined,
      this.commands?.dump,
    );
  }

  async objectKeys(): Promise<readonly string[]> {
    const sql = postgres(this.databaseUrl, { max: 1 });
    try {
      const rows = await sql<{ readonly storage_key: string }[]>`
        select distinct storage_key from crm.files
        where storage_key is not null order by storage_key
      `;
      return rows.map(({ storage_key }) => storage_key);
    } finally {
      await sql.end();
    }
  }

  async restore(dump: Uint8Array): Promise<void> {
    await runPostgresTool(
      "pg_restore",
      this.databaseUrl,
      dump,
      this.commands?.restore,
    );
  }

  async verifyCanonicalV7(): Promise<void> {
    const sql = postgres(this.databaseUrl, { max: 1 });
    try {
      const [row] = await sql<{ readonly present: boolean }[]>`
        select to_regclass('crm.workspace_lifecycle_records') is not null as present
      `;
      if (!row?.present) {
        throw new Error("Database is not the canonical schema v7.");
      }
    } finally {
      await sql.end();
    }
    const action = await applyCanonicalSchema(
      this.databaseUrl,
      await canonicalArtifacts(),
    );
    if (action !== "verify-v7") {
      throw new Error("Database is not the canonical schema v7.");
    }
  }
}

export class S3Recovery implements ObjectRecoveryPort {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async assertEmpty(): Promise<void> {
    if (!(await this.client.bucketExists(this.bucket))) return;
    if ((await this.list()).length > 0) {
      throw new Error("Restore object bucket is not empty.");
    }
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      const stream = await this.client.getObject(this.bucket, key);
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) chunks.push(new Uint8Array(chunk));
      const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
      if (code === "NoSuchKey" || code === "NotFound") return undefined;
      throw error;
    }
  }

  async list(): Promise<
    readonly { readonly key: string; readonly size: number }[]
  > {
    if (!(await this.client.bucketExists(this.bucket))) {
      throw new Error("Object bucket does not exist.");
    }
    const objects: { key: string; size: number }[] = [];
    for await (const item of this.client.listObjectsV2(this.bucket, "", true)) {
      if (item.name) objects.push({ key: item.name, size: item.size });
    }
    return objects.sort((a, b) => a.key.localeCompare(b.key));
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    if (!(await this.client.bucketExists(this.bucket))) {
      await this.client.makeBucket(this.bucket);
    }
    await this.client.putObject(
      this.bucket,
      key,
      Buffer.from(bytes),
      bytes.byteLength,
    );
  }
}

function s3(
  environment: { readonly get: (name: string) => string | undefined },
  prefix = "OBJECT_STORAGE_",
): { bucket: string; port: ObjectRecoveryPort } {
  const get = (name: string) => environment.get(`${prefix}${name}`);
  const accessKey = get("ACCESS_KEY");
  const bucket = get("BUCKET");
  const host = get("HOST");
  const secretKey = get("SECRET_KEY");
  if (!accessKey || !bucket || !host || !secretKey) {
    throw new Error(
      `Complete ${prefix} object storage configuration is required.`,
    );
  }
  const numericPort = Number(get("PORT") ?? "9000");
  if (
    !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65_535
  ) {
    throw new Error(`Invalid ${prefix}PORT.`);
  }
  const ssl = get("USE_SSL") ?? "true";
  if (ssl !== "true" && ssl !== "false") {
    throw new Error(`Invalid ${prefix}USE_SSL.`);
  }
  const useSSL = ssl === "true";
  return {
    bucket,
    port: new S3Recovery(
      new S3Client({
        accessKey,
        endPoint: host,
        port: numericPort,
        secretKey,
        useSSL,
      }),
      bucket,
    ),
  };
}

interface RecoveryCliDependencies {
  readonly database: (databaseUrl: string) => DatabaseRecoveryPort;
  readonly loadProfile: () => Promise<PrivateProductionProfile>;
  readonly objects: (
    environment: { readonly get: (name: string) => string | undefined },
    prefix?: string,
  ) => { readonly bucket: string; readonly port: ObjectRecoveryPort };
  readonly write: (value: string) => void;
}

const DEFAULT_CLI_DEPENDENCIES: RecoveryCliDependencies = {
  database: (databaseUrl) => new PostgresRecovery(databaseUrl),
  loadProfile: () => loadPrivateProductionProfile(),
  objects: s3,
  write: (value) => console.log(value),
};

export async function runPrivateProductionRecoveryCli(
  args: readonly string[],
  environment: { readonly get: (name: string) => string | undefined },
  dependencyOverrides: Partial<RecoveryCliDependencies> = {},
): Promise<number> {
  const dependencies = { ...DEFAULT_CLI_DEPENDENCIES, ...dependencyOverrides };
  const [operation, archiveId] = args;
  if (
    (operation !== "backup" && operation !== "restore") ||
    !archiveId || args.length !== 2
  ) {
    dependencies.write(
      "Usage: deno task ops recovery <backup|restore> <archive-id>",
    );
    return 64;
  }
  const profile = await dependencies.loadProfile();
  if (operation === "backup") {
    if (environment.get("PRIVATE_PRODUCTION_WRITES_QUIESCED") !== "true") {
      throw new Error(
        "Backup requires an explicitly quiesced application and worker.",
      );
    }
    const databaseUrl = environment.get("DATABASE_URL");
    if (!databaseUrl) throw new Error("DATABASE_URL is required.");
    const storage = dependencies.objects(environment);
    await createBackup({
      archiveId,
      bucket: storage.bucket,
      database: dependencies.database(databaseUrl),
      databaseName: postgresEnvironment(databaseUrl).database,
      objects: storage.port,
      profile,
    });
    dependencies.write(
      JSON.stringify({
        environment: profile.environment,
        event: "operator.backup",
        state: "created",
      }),
    );
    return 0;
  }
  if (environment.get("PRIVATE_PRODUCTION_ISOLATED_TARGET") !== "true") {
    throw new Error("Restore requires an explicitly isolated empty target.");
  }
  const databaseUrl = environment.get("RECOVERY_DATABASE_URL");
  if (!databaseUrl) throw new Error("RECOVERY_DATABASE_URL is required.");
  const storage = dependencies.objects(
    environment,
    "RECOVERY_OBJECT_STORAGE_",
  );
  const result = await restoreBackup({
    archiveId,
    bucket: storage.bucket,
    database: dependencies.database(databaseUrl),
    databaseName: postgresEnvironment(databaseUrl).database,
    objects: storage.port,
    profile,
  });
  dependencies.write(JSON.stringify(result));
  return result.missingObjectCount === 0 && result.extraObjectCount === 0 &&
      result.rpoMet && result.rtoMet
    ? 0
    : 2;
}

if (import.meta.main) {
  Deno.exit(await runPrivateProductionRecoveryCli(Deno.args, Deno.env));
}
