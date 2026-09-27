import {
  createBackup,
  type DatabaseRecoveryPort,
  type ObjectRecoveryPort,
  privateProductionArchivePath,
  restoreBackup,
  runPrivateProductionRecoveryCli,
} from "./private_production_recovery.ts";
import type { PrivateProductionProfile } from "./private_production_probe.ts";

const PROFILE_PATH = "docs/planning/private-production-profile.json";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`expected ${right}, got ${left}`);
}

function database(
  objectKeys: readonly string[],
  effects: { restores: number },
): DatabaseRecoveryPort {
  return {
    assertEmpty: () => Promise.resolve(),
    dump: () => Promise.resolve(new TextEncoder().encode("database-dump")),
    objectKeys: () => Promise.resolve(objectKeys),
    restore: () => {
      effects.restores += 1;
      return Promise.resolve();
    },
    verifyCanonicalV8: () => Promise.resolve(),
  };
}

function objects(
  initial: Readonly<Record<string, string>>,
  effects: { puts: number },
): ObjectRecoveryPort {
  const stored = new Map<string, Uint8Array>(
    Object.entries(initial).map(([key, value]) => [
      key,
      new TextEncoder().encode(value),
    ]),
  );
  return {
    assertEmpty: () => {
      if (stored.size > 0) throw new Error("target object bucket is not empty");
      return Promise.resolve();
    },
    get: (key) => Promise.resolve(stored.get(key)),
    list: () =>
      Promise.resolve([...stored].map(([key, bytes]) => ({
        key,
        size: bytes.byteLength,
      }))),
    put: (key, bytes) => {
      effects.puts += 1;
      stored.set(key, bytes);
      return Promise.resolve();
    },
  };
}

async function profile(): Promise<PrivateProductionProfile> {
  return JSON.parse(await Deno.readTextFile(PROFILE_PATH));
}

function testArchiveId(label: string): string {
  return `test-${label}-${crypto.randomUUID()}`;
}

async function removeArchives(...archiveIds: readonly string[]): Promise<void> {
  await Promise.all(
    archiveIds.map((archiveId) =>
      Deno.remove(privateProductionArchivePath(archiveId), { recursive: true })
        .catch(() => undefined)
    ),
  );
}

Deno.test("OPS-001C backup fails closed when database metadata references a missing object", async () => {
  const missingArchiveId = testArchiveId("missing");
  const policyArchiveId = testArchiveId("policy");
  const databaseEffects = { restores: 0 };
  const objectEffects = { puts: 0 };
  try {
    let failure: unknown;
    try {
      await createBackup({
        archiveId: missingArchiveId,
        bucket: "attachments",
        database: database(["present", "missing"], databaseEffects),
        databaseName: "kinship",
        now: () => new Date("2026-08-24T10:00:00.000Z"),
        objects: objects({ present: "bytes" }, objectEffects),
        profile: await profile(),
      });
    } catch (error) {
      failure = error;
    }
    assert(
      failure instanceof Error && failure.message.includes("1 missing object"),
      "backup must reject incomplete database/object state without exposing keys",
    );
    let policyFailure: unknown;
    const recoveryProfile = await profile();
    try {
      await createBackup({
        archiveId: policyArchiveId,
        bucket: "attachments",
        database: database([], databaseEffects),
        databaseName: "kinship",
        objects: objects({}, objectEffects),
        profile: {
          ...recoveryProfile,
          recovery: { ...recoveryProfile.recovery, retentionDays: 31 },
        },
      });
    } catch (error) {
      policyFailure = error;
    }
    assert(
      policyFailure instanceof Error &&
        policyFailure.message.includes("recovery policy"),
      "unaccepted recovery policy must fail before archive creation",
    );
  } finally {
    await removeArchives(missingArchiveId, policyArchiveId);
  }
});

Deno.test("OPS-001C validates every checksum before mutating an isolated restore target", async () => {
  const archiveId = testArchiveId("checksum");
  const sourceDatabaseEffects = { restores: 0 };
  const targetDatabaseEffects = { restores: 0 };
  const sourceObjectEffects = { puts: 0 };
  const targetObjectEffects = { puts: 0 };
  try {
    const archiveDirectory = privateProductionArchivePath(archiveId);
    await createBackup({
      archiveId,
      bucket: "attachments",
      database: database(["wanted"], sourceDatabaseEffects),
      databaseName: "kinship",
      now: () => new Date("2026-08-24T10:00:00.000Z"),
      objects: objects(
        { wanted: "original", extra: "retained" },
        sourceObjectEffects,
      ),
      profile: await profile(),
    });
    const manifest = JSON.parse(
      await Deno.readTextFile(`${archiveDirectory}/manifest.json`),
    ) as { readonly objects: readonly { readonly file: string }[] };
    await Deno.writeTextFile(
      `${archiveDirectory}/${manifest.objects[0]!.file}`,
      "tampered",
    );

    let failure: unknown;
    try {
      await restoreBackup({
        archiveId,
        bucket: "attachments",
        database: database(["wanted"], targetDatabaseEffects),
        databaseName: "kinship_restore",
        now: () => new Date("2026-08-24T10:05:00.000Z"),
        objects: objects({}, targetObjectEffects),
        profile: await profile(),
      });
    } catch (error) {
      failure = error;
    }
    assert(
      failure instanceof Error && failure.message.includes("checksum mismatch"),
      "tampered archive must fail closed",
    );
    assertEquals(targetDatabaseEffects.restores, 0);
    assertEquals(targetObjectEffects.puts, 0);

    await Deno.writeTextFile(
      `${archiveDirectory}/${manifest.objects[0]!.file}`,
      "original",
    );
    await Deno.writeTextFile(
      `${archiveDirectory}/manifest.json`,
      JSON.stringify({
        ...manifest,
        objects: [{
          ...manifest.objects[0],
          file: `objects/${"0".repeat(64)}.bin`,
        }],
      }),
    );
    let pathFailure: unknown;
    try {
      await restoreBackup({
        archiveId,
        bucket: "attachments",
        database: database(["wanted"], targetDatabaseEffects),
        databaseName: "kinship_restore",
        objects: objects({}, targetObjectEffects),
        profile: await profile(),
      });
    } catch (error) {
      pathFailure = error;
    }
    assert(
      pathFailure instanceof Error &&
        pathFailure.message.includes("path mismatch"),
      "manifest cannot redirect reads outside its content-addressed object path",
    );
  } finally {
    await removeArchives(archiveId);
  }
});

Deno.test("OPS-001C restores and measures the authoritative database/object state", async () => {
  const archiveId = testArchiveId("restore");
  const sourceDatabaseEffects = { restores: 0 };
  const targetDatabaseEffects = { restores: 0 };
  const sourceObjectEffects = { puts: 0 };
  const targetObjectEffects = { puts: 0 };
  try {
    const recoveryProfile = await profile();
    await createBackup({
      archiveId,
      bucket: "attachments",
      database: database(["wanted"], sourceDatabaseEffects),
      databaseName: "kinship",
      now: () => new Date("2026-08-24T10:00:00.000Z"),
      objects: objects(
        { wanted: "original", extra: "retained" },
        sourceObjectEffects,
      ),
      profile: recoveryProfile,
    });

    let bucketFailure: unknown;
    try {
      await restoreBackup({
        archiveId,
        bucket: "other-bucket",
        database: database(["wanted"], targetDatabaseEffects),
        databaseName: "kinship_restore",
        objects: objects({}, targetObjectEffects),
        profile: recoveryProfile,
      });
    } catch (error) {
      bucketFailure = error;
    }
    assert(
      bucketFailure instanceof Error &&
        bucketFailure.message.includes("bucket mismatch"),
      "restore must reject a target bucket name that disagrees with database metadata",
    );
    assertEquals(targetDatabaseEffects.restores, 0);
    assertEquals(targetObjectEffects.puts, 0);

    const result = await restoreBackup({
      archiveId,
      bucket: "attachments",
      database: database(["wanted"], targetDatabaseEffects),
      databaseName: "kinship_restore",
      now: (() => {
        const times = [
          new Date("2026-08-24T10:05:00.000Z"),
          new Date("2026-08-24T10:05:01.250Z"),
        ];
        return () => times.shift() ?? times[0]!;
      })(),
      objects: objects({}, targetObjectEffects),
      profile: recoveryProfile,
    });

    assertEquals(targetDatabaseEffects.restores, 1);
    assertEquals(targetObjectEffects.puts, 2);
    assertEquals(result, {
      databaseObjectCount: 1,
      durationMs: 1_250,
      environment: "private-production",
      event: "operator.recovery",
      extraObjectCount: 1,
      missingObjectCount: 0,
      objectCount: 2,
      recoveryPointAgeMs: 300_000,
      rpoMet: true,
      rtoMet: true,
      schemaVersion: 7,
      state: "attention-required",
    });
    assertEquals(recoveryProfile.recovery, {
      archiveRoot: ".artifacts/private-production-recovery",
      backupSchedule: "daily",
      backupCommand: "deno task ops recovery backup <archive-id>",
      manifestVersion: 1,
      migrationVerificationTask: "deno task test:schema:matrix",
      prerequisites: [
        "Stop API and worker writes, then set PRIVATE_PRODUCTION_WRITES_QUIESCED=true only for the backup invocation.",
        "Use the pinned PostgreSQL 18.4 pg_dump and pg_restore clients and a reachable S3-compatible endpoint.",
        "Restore only into an empty isolated database and bucket, then set PRIVATE_PRODUCTION_ISOLATED_TARGET=true only for the restore invocation.",
        "Keep database, object-storage, archive-encryption, and key material outside the archive and provide them through the OPS-001D secret boundary.",
      ],
      promotionRule:
        "Promote only an exit-zero restored result with zero missing and extra objects and met RPO/RTO; otherwise discard the isolated target and retry from the last valid archive.",
      retentionDays: 30,
      restoreCommand: "deno task ops recovery restore <archive-id>",
      rpoHours: 24,
      rtoMinutes: 240,
      schemaVersion: 7,
    });
  } finally {
    await removeArchives(archiveId);
  }
});

Deno.test("OPS-001C concurrent archive claim preserves the single winner", async () => {
  const archiveId = testArchiveId("concurrent");
  const effects = { restores: 0 };
  const command = {
    archiveId,
    bucket: "attachments",
    database: database([], effects),
    databaseName: "kinship",
    objects: objects({}, { puts: 0 }),
    profile: await profile(),
  };
  try {
    const outcomes = await Promise.allSettled([
      createBackup(command),
      createBackup(command),
    ]);
    assertEquals(
      outcomes.map(({ status }) => status).sort(),
      ["fulfilled", "rejected"],
    );
    const manifest = await Deno.readTextFile(
      `${privateProductionArchivePath(archiveId)}/manifest.json`,
    );
    assert(
      manifest.includes("kinship-private-production-backup"),
      "winner archive remains complete",
    );
  } finally {
    await removeArchives(archiveId);
  }
});

Deno.test("OPS-001C rejects an existing archive and changing source object metadata", async () => {
  const existingArchiveId = testArchiveId("existing");
  const changingArchiveId = testArchiveId("changing");
  const providerArchiveId = testArchiveId("provider");
  const duplicateArchiveId = testArchiveId("duplicate");
  const databaseEffects = { restores: 0 };
  const objectEffects = { puts: 0 };
  try {
    await createBackup({
      archiveId: existingArchiveId,
      bucket: "attachments",
      database: database([], databaseEffects),
      databaseName: "kinship",
      objects: objects({}, objectEffects),
      profile: await profile(),
    });
    let existingFailure: unknown;
    try {
      await createBackup({
        archiveId: existingArchiveId,
        bucket: "attachments",
        database: database([], databaseEffects),
        databaseName: "kinship",
        objects: objects({}, objectEffects),
        profile: await profile(),
      });
    } catch (error) {
      existingFailure = error;
    }
    assert(
      existingFailure instanceof Error &&
        existingFailure.message.includes("already exists"),
      "operator must never overwrite an archive directory",
    );

    const changingObjects: ObjectRecoveryPort = {
      assertEmpty: () => Promise.resolve(),
      get: () => Promise.resolve(new TextEncoder().encode("short")),
      list: () => Promise.resolve([{ key: "changing", size: 100 }]),
      put: () => Promise.resolve(),
    };
    let changingFailure: unknown;
    try {
      await createBackup({
        archiveId: changingArchiveId,
        bucket: "attachments",
        database: database([], databaseEffects),
        databaseName: "kinship",
        objects: changingObjects,
        profile: await profile(),
      });
    } catch (error) {
      changingFailure = error;
    }
    assert(
      changingFailure instanceof Error &&
        changingFailure.message.includes("changed or unavailable"),
      "list/read drift must fail without publishing a manifest",
    );

    let providerFailure: unknown;
    try {
      await createBackup({
        archiveId: providerArchiveId,
        bucket: "attachments",
        database: database([], databaseEffects),
        databaseName: "kinship",
        objects: {
          ...changingObjects,
          get: () => Promise.reject(new Error("provider exposed changing")),
          list: () => Promise.resolve([{ key: "changing", size: 5 }]),
        },
        profile: await profile(),
      });
    } catch (error) {
      providerFailure = error;
    }
    assert(
      providerFailure instanceof Error &&
        providerFailure.message === "Object backup read failed." &&
        !providerFailure.message.includes("changing"),
      "provider errors must not disclose object keys",
    );

    const duplicateObjects: ObjectRecoveryPort = {
      ...changingObjects,
      get: () => Promise.resolve(new TextEncoder().encode("same")),
      list: () =>
        Promise.resolve([
          { key: "duplicate", size: 4 },
          { key: "duplicate", size: 4 },
        ]),
    };
    let duplicateFailure: unknown;
    try {
      await createBackup({
        archiveId: duplicateArchiveId,
        bucket: "attachments",
        database: database([], databaseEffects),
        databaseName: "kinship",
        objects: duplicateObjects,
        profile: await profile(),
      });
    } catch (error) {
      duplicateFailure = error;
    }
    assert(
      duplicateFailure instanceof Error &&
        duplicateFailure.message.includes("duplicate object"),
      "duplicate listing must not create an ambiguous manifest",
    );
  } finally {
    await removeArchives(
      existingArchiveId,
      changingArchiveId,
      providerArchiveId,
      duplicateArchiveId,
    );
  }
});

Deno.test("OPS-001C rejects invalid manifest metadata and policy before target mutation", async () => {
  const archiveId = testArchiveId("manifest");
  const databaseEffects = { restores: 0 };
  const objectEffects = { puts: 0 };
  try {
    const archiveDirectory = privateProductionArchivePath(archiveId);
    const recoveryProfile = await profile();
    await createBackup({
      archiveId,
      bucket: "attachments",
      database: database([], databaseEffects),
      databaseName: "kinship",
      objects: objects({}, objectEffects),
      profile: recoveryProfile,
    });
    const manifestPath = `${archiveDirectory}/manifest.json`;
    const original = JSON.parse(
      await Deno.readTextFile(manifestPath),
    ) as Record<string, unknown>;
    const invalidCases: readonly [Record<string, unknown>, string][] = [
      [{ ...original, createdAt: "not-a-date" }, "metadata"],
      [{ ...original, version: 2 }, "manifest"],
      [{
        ...original,
        database: {
          ...(original.database as Record<string, unknown>),
          sha256: "0".repeat(64),
        },
      }, "database backup checksum mismatch"],
      [{
        ...original,
        recovery: {
          ...(original.recovery as Record<string, unknown>),
          retentionDays: 31,
        },
      }, "policy mismatch"],
    ];
    for (const [invalid, message] of invalidCases) {
      await Deno.writeTextFile(manifestPath, JSON.stringify(invalid));
      let failure: unknown;
      try {
        await restoreBackup({
          archiveId,
          bucket: "attachments",
          database: database([], databaseEffects),
          databaseName: "restore",
          objects: objects({}, objectEffects),
          profile: recoveryProfile,
        });
      } catch (error) {
        failure = error;
      }
      assert(
        failure instanceof Error &&
          failure.message.toLowerCase().includes(message),
        `invalid ${message} must fail closed`,
      );
    }
    assertEquals(databaseEffects.restores, 0);
    assertEquals(objectEffects.puts, 0);
  } finally {
    await removeArchives(archiveId);
  }
});

Deno.test("OPS-001C refuses a non-empty isolated target after validating the archive", async () => {
  const archiveId = testArchiveId("non-empty");
  const sourceDatabaseEffects = { restores: 0 };
  const targetDatabaseEffects = { restores: 0 };
  const sourceObjectEffects = { puts: 0 };
  const targetObjectEffects = { puts: 0 };
  try {
    const recoveryProfile = await profile();
    await createBackup({
      archiveId,
      bucket: "attachments",
      database: database([], sourceDatabaseEffects),
      databaseName: "kinship",
      objects: objects({}, sourceObjectEffects),
      profile: recoveryProfile,
    });
    let failure: unknown;
    try {
      await restoreBackup({
        archiveId,
        bucket: "attachments",
        database: database([], targetDatabaseEffects),
        databaseName: "restore",
        objects: objects({ occupied: "do-not-overwrite" }, targetObjectEffects),
        profile: recoveryProfile,
      });
    } catch (error) {
      failure = error;
    }
    assert(
      failure instanceof Error && failure.message.includes("not empty"),
      "non-empty target must be preserved",
    );
    assertEquals(targetDatabaseEffects.restores, 0);
    assertEquals(targetObjectEffects.puts, 0);
  } finally {
    await removeArchives(archiveId);
  }
});

Deno.test("OPS-001C operator CLI serializes backup then isolated restore without secret output", async () => {
  const archiveId = testArchiveId("cli");
  const invalidArchiveId = testArchiveId("invalid-config");
  const sourceDatabaseEffects = { restores: 0 };
  const targetDatabaseEffects = { restores: 0 };
  const sourceObjectEffects = { puts: 0 };
  const targetObjectEffects = { puts: 0 };
  const sourceObjects = objects(
    { wanted: "original", extra: "retained" },
    sourceObjectEffects,
  );
  const targetObjects = objects({}, targetObjectEffects);
  const output: string[] = [];
  const values = new Map<string, string>([
    ["DATABASE_URL", "postgres://operator:secret@database/kinship"],
    ["PRIVATE_PRODUCTION_WRITES_QUIESCED", "true"],
  ]);
  const environment = { get: (name: string) => values.get(name) };
  const recoveryProfile = await profile();
  try {
    const dependencies = {
      database: (databaseUrl: string) =>
        database(
          databaseUrl.includes("restore") ? ["wanted"] : ["wanted"],
          databaseUrl.includes("restore")
            ? targetDatabaseEffects
            : sourceDatabaseEffects,
        ),
      loadProfile: () => Promise.resolve(recoveryProfile),
      objects: (_environment: unknown, prefix = "OBJECT_STORAGE_") => ({
        bucket: "attachments",
        port: prefix.startsWith("RECOVERY") ? targetObjects : sourceObjects,
      }),
      write: (value: string) => output.push(value),
    };
    assertEquals(
      await runPrivateProductionRecoveryCli(
        ["backup", archiveId],
        environment,
        dependencies,
      ),
      0,
    );
    values.delete("DATABASE_URL");
    values.set(
      "RECOVERY_DATABASE_URL",
      "postgres://operator:secret@database/kinship_restore",
    );
    values.set("PRIVATE_PRODUCTION_ISOLATED_TARGET", "true");
    assertEquals(
      await runPrivateProductionRecoveryCli(
        ["restore", archiveId],
        environment,
        dependencies,
      ),
      2,
    );
    assertEquals(sourceDatabaseEffects.restores, 0);
    assertEquals(targetDatabaseEffects.restores, 1);
    assert(
      output.length === 2 && !output.join("\n").includes("secret") &&
        !output.join("\n").includes("wanted"),
      "structured operator output must omit credentials and object keys",
    );
    assertEquals(
      await runPrivateProductionRecoveryCli([], environment, dependencies),
      64,
    );
    let unsafeArchiveFailure: unknown;
    try {
      privateProductionArchivePath("../outside");
    } catch (error) {
      unsafeArchiveFailure = error;
    }
    assert(
      unsafeArchiveFailure instanceof Error &&
        unsafeArchiveFailure.message.includes("Archive ID"),
      "archive IDs cannot escape the controlled recovery root",
    );

    const invalidConfiguration = new Map<string, string>([
      ["DATABASE_URL", "postgres://operator:secret@database/kinship"],
      ["PRIVATE_PRODUCTION_WRITES_QUIESCED", "true"],
    ]);
    const invalidEnvironment = {
      get: (name: string) => invalidConfiguration.get(name),
    };
    for (
      const [expected, configure] of [
        ["configuration", () => undefined],
        ["PORT", () => {
          invalidConfiguration.set("OBJECT_STORAGE_ACCESS_KEY", "access");
          invalidConfiguration.set("OBJECT_STORAGE_BUCKET", "attachments");
          invalidConfiguration.set("OBJECT_STORAGE_HOST", "storage");
          invalidConfiguration.set("OBJECT_STORAGE_SECRET_KEY", "secret-value");
          invalidConfiguration.set("OBJECT_STORAGE_PORT", "invalid");
        }],
        ["USE_SSL", () => {
          invalidConfiguration.set("OBJECT_STORAGE_PORT", "9000");
          invalidConfiguration.set("OBJECT_STORAGE_USE_SSL", "sometimes");
        }],
      ] as const
    ) {
      configure();
      let configurationFailure: unknown;
      try {
        await runPrivateProductionRecoveryCli(
          ["backup", invalidArchiveId],
          invalidEnvironment,
          { loadProfile: () => Promise.resolve(recoveryProfile) },
        );
      } catch (error) {
        configurationFailure = error;
      }
      assert(
        configurationFailure instanceof Error &&
          configurationFailure.message.includes(expected),
        `invalid object storage ${expected} must fail before backup`,
      );
    }
  } finally {
    await removeArchives(archiveId, invalidArchiveId);
  }
});
