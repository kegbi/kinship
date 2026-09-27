import type { Failure } from "../../../shared-kernel/result.ts";
import {
  createPersonFileManagement,
  type FileAudit,
  type FileMetadataRepository,
  type ObjectStorage,
  type PersonFileActor,
  type PersonFilePageAnchor,
  type PersonFileRecord,
} from "../public.ts";
import type { PeopleTransaction } from "../../people/public.ts";
import { assert } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import { fixedClock } from "../../../testing/fakes.ts";

const actor: PersonFileActor = fixtures.actor();
const personId = "00000000-0000-4000-8000-000000000004";
const fileId = "00000000-0000-4000-8000-000000000005";
const transaction = { opaque: {} } satisfies PeopleTransaction;

class MemoryStorage implements ObjectStorage {
  readonly bucket = "test-files";
  readonly objects = new Map<string, Uint8Array>();
  readonly provider = "memory";
  failPut = false;
  failRemove = false;
  putCalls = 0;

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
    if (this.failPut) return Promise.reject(new Error("store unavailable"));
    this.objects.set(command.key, command.bytes.slice());
    return Promise.resolve();
  }

  remove(command: { readonly key: string }): Promise<void> {
    if (this.failRemove) return Promise.reject(new Error("store unavailable"));
    this.objects.delete(command.key);
    return Promise.resolve();
  }
}

class MemoryFiles implements FileMetadataRepository {
  readonly records = new Map<
    string,
    PersonFileRecord & { readonly storageKey: string }
  >();
  reserveStatus: "reserved" | "forbidden" | "not-found" = "reserved";
  authorizeStatus: "authorized" | "forbidden" | "not-found" = "authorized";
  failFinalize = false;
  failFinalizeRemoval = false;
  failReserve = false;
  markedMissing: string[] = [];
  /** Every page the use case asked for, as `after id | limit`. */
  listed: string[] = [];
  /** The anchor the next page would resume from, when a test sets one. */
  nextPage: PersonFilePageAnchor | undefined;

  authorizeUpload(): Promise<
    | { readonly status: "authorized" }
    | Failure<"forbidden" | "not-found">
  > {
    return Promise.resolve({ status: this.authorizeStatus });
  }

  reserveUpload(
    command: Parameters<FileMetadataRepository["reserveUpload"]>[0],
  ) {
    if (this.failReserve) {
      return Promise.reject(new Error("database unavailable"));
    }
    if (this.reserveStatus !== "reserved") {
      return Promise.resolve({ status: this.reserveStatus } as const);
    }
    const record: PersonFileRecord & { readonly storageKey: string } = {
      byteSize: command.byteSize,
      createdAt: command.occurredAt.toISOString(),
      fileId: command.fileId,
      filename: command.filename,
      kind: command.kind,
      mimeType: command.mimeType,
      personId: command.personId,
      status: "processing",
      storageKey: command.storageKey,
      title: command.title,
    };
    this.records.set(record.fileId, record);
    return Promise.resolve({ file: record, status: "reserved" } as const);
  }

  finalizeUpload(
    command: Parameters<FileMetadataRepository["finalizeUpload"]>[0],
  ) {
    if (this.failFinalize) {
      return Promise.reject(new Error("database unavailable"));
    }
    const record = this.records.get(command.fileId);
    if (!record || record.personId !== command.personId) {
      return Promise.resolve({ status: "not-found" } as const);
    }
    const finalized = { ...record, status: command.status };
    this.records.set(command.fileId, finalized);
    return Promise.resolve({ file: finalized, status: "created" } as const);
  }

  find(command: Parameters<FileMetadataRepository["find"]>[0]) {
    const record = this.records.get(command.fileId);
    return Promise.resolve(
      command.workspaceId !== actor.workspaceId || !record ||
        record.personId !== command.personId
        ? { status: "not-found" } as const
        : { file: record, status: "found" } as const,
    );
  }

  list(command: Parameters<FileMetadataRepository["list"]>[0]) {
    this.listed.push(`${command.after?.fileId ?? "-"} | ${command.limit}`);
    return Promise.resolve({
      files: [...this.records.values()].filter((file) =>
        file.personId === command.personId
      ),
      ...(this.nextPage && !command.after ? { next: this.nextPage } : {}),
      status: "ready" as const,
    });
  }

  markMissing(command: Parameters<FileMetadataRepository["markMissing"]>[0]) {
    this.markedMissing.push(command.fileId);
    const current = this.records.get(command.fileId)!;
    this.records.set(command.fileId, { ...current, status: "missing" });
    return Promise.resolve();
  }

  recordRead(_command: Parameters<FileMetadataRepository["recordRead"]>[0]) {
    return Promise.resolve();
  }

  reserveRemoval(
    command: Parameters<FileMetadataRepository["reserveRemoval"]>[0],
  ) {
    const record = this.records.get(command.fileId);
    if (!record || record.status === "deleted") {
      return Promise.resolve({ status: "not-found" } as const);
    }
    if (record.status === "processing") {
      return Promise.resolve({ status: "processing" } as const);
    }
    this.records.set(command.fileId, { ...record, status: "processing" });
    return Promise.resolve({ file: record, status: "reserved" } as const);
  }

  finalizeRemoval(
    command: Parameters<FileMetadataRepository["finalizeRemoval"]>[0],
  ) {
    if (this.failFinalizeRemoval) {
      this.failFinalizeRemoval = false;
      return Promise.reject(new Error("database unavailable"));
    }
    const record = this.records.get(command.fileId);
    if (!record || record.status !== "processing") {
      return Promise.resolve({ status: "not-found" } as const);
    }
    this.records.set(command.fileId, { ...record, status: "deleted" });
    return Promise.resolve({ file: record, status: "removed" } as const);
  }
}

class MemoryAudit implements FileAudit {
  readonly actions: string[] = [];
  record(command: Parameters<FileAudit["record"]>[0]): Promise<string> {
    this.actions.push(command.action);
    return Promise.resolve(crypto.randomUUID());
  }
}

function management(
  options: { storage?: MemoryStorage; repository?: MemoryFiles } = {},
) {
  const audit = new MemoryAudit();
  const repository = options.repository ?? new MemoryFiles();
  const storage = options.storage ?? new MemoryStorage();
  return {
    audit,
    files: createPersonFileManagement({
      actors: { revalidate: () => Promise.resolve("active" as const) },
      audit,
      clock: fixedClock("2026-08-23T08:00:00.000Z"),
      ids: { next: () => fileId },
      keys: { next: () => "objects/opaque-generated-key" },
      repository,
      scanner: { inspect: () => Promise.resolve("clean") },
      storage,
      transaction: {
        run: async <T>(
          work: (transaction: PeopleTransaction) => Promise<T>,
        ) => {
          const before = new Map(repository.records);
          try {
            return await work(transaction);
          } catch (error) {
            repository.records.clear();
            for (const [id, record] of before) {
              repository.records.set(id, record);
            }
            throw error;
          }
        },
      },
    }),
    repository,
    storage,
  };
}

Deno.test("[FILES-001] uploads an allowed person document under an opaque generated key", async () => {
  const context = management();
  const bytes = new TextEncoder().encode("bounded private content");
  const result = await context.files.upload(actor, personId, {
    bytes,
    filename: "care plan.pdf",
    kind: "document",
    mimeType: "application/pdf",
    title: "Care plan",
  });

  assert(result.status === "created", "upload succeeds");
  assert(result.file.status === "available", "metadata is available");
  assert(!("storageKey" in result.file), "storage key is not exposed");
  assert(
    context.storage.objects.has("objects/opaque-generated-key"),
    "generated key is used instead of the client filename",
  );
  assert(context.audit.actions.join(",") === "uploaded", "upload is audited");
});

Deno.test("[FILES-001] rejects storage limits and media before object effects", async () => {
  const context = management();
  const tooLarge = new Uint8Array(10 * 1024 * 1024 + 1);
  const limited = await context.files.upload(actor, personId, {
    bytes: tooLarge,
    filename: "large.pdf",
    kind: "document",
    mimeType: "application/pdf",
    title: "Large",
  });
  const rejected = await context.files.upload(actor, personId, {
    bytes: new Uint8Array([1]),
    filename: "script.svg",
    kind: "photo",
    mimeType: "image/svg+xml",
    title: "Unsafe",
  });

  assert(limited.status === "storage-limit", "size limit is explicit");
  assert(rejected.status === "rejected-media", "media rejection is explicit");
  assert(
    context.storage.objects.size === 0,
    "invalid uploads have no object effect",
  );
});

Deno.test("[FILES-001] compensates object storage when metadata cannot attach", async () => {
  const repository = new MemoryFiles();
  repository.failReserve = true;
  const context = management({ repository });
  const result = await context.files.upload(actor, personId, {
    bytes: new Uint8Array([1, 2, 3]),
    filename: "portrait.jpg",
    kind: "photo",
    mimeType: "image/jpeg",
    title: "Portrait",
  });

  assert(result.status === "unavailable", "database failure is recoverable");
  assert(
    context.storage.putCalls === 0,
    "reservation failure precedes storage",
  );
});

Deno.test("[FILES-001] finalize interruption leaves a tracked processing reservation", async () => {
  const repository = new MemoryFiles();
  const storage = new MemoryStorage();
  repository.failFinalize = true;
  storage.failRemove = true;
  const context = management({ repository, storage });
  const result = await context.files.upload(actor, personId, {
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    filename: "tracked.pdf",
    kind: "document",
    mimeType: "application/pdf",
    title: "Tracked",
  });
  assert(result.status === "unavailable", "finalize interruption is retryable");
  assert(
    context.repository.records.get(fileId)?.status === "processing",
    "stored bytes retain tracked processing metadata",
  );
});

Deno.test("[FILES-001] object put failure leaves tracked missing metadata", async () => {
  const storage = new MemoryStorage();
  storage.failPut = true;
  const context = management({ storage });
  const result = await context.files.upload(actor, personId, {
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    filename: "missing.pdf",
    kind: "document",
    mimeType: "application/pdf",
    title: "Missing",
  });
  assert(result.status === "unavailable", "object failure is retryable");
  assert(
    context.repository.records.get(fileId)?.status === "missing",
    "failed put keeps an explicit tracked state",
  );
});

Deno.test("[FILES-001] rejects unauthorized person ownership before object storage", async () => {
  for (const status of ["not-found", "forbidden"] as const) {
    const repository = new MemoryFiles();
    repository.authorizeStatus = status;
    const context = management({ repository });
    const result = await context.files.upload(actor, personId, {
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      filename: "private.pdf",
      kind: "document",
      mimeType: "application/pdf",
      title: "Private",
    });
    assert(result.status === status, "ownership result is preserved");
    assert(
      context.storage.putCalls === 0,
      "authorization precedes object storage",
    );
  }
});

Deno.test("[FILES-001] conceals cross-workspace files and exposes missing/quarantined states", async () => {
  const context = management();
  await context.files.upload(actor, personId, {
    bytes: new Uint8Array([7, 8]),
    filename: "portrait.webp",
    kind: "photo",
    mimeType: "image/webp",
    title: "Portrait",
  });
  const stored = context.repository.records.get(fileId)!;
  context.repository.records.set(fileId, { ...stored, status: "quarantined" });
  const quarantined = await context.files.download(actor, personId, fileId);
  assert(quarantined.status === "quarantined", "quarantine is explicit");

  context.repository.records.set(fileId, { ...stored, status: "available" });
  context.storage.objects.clear();
  const missing = await context.files.download(actor, personId, fileId);
  assert(missing.status === "missing", "missing object is explicit");
  assert(
    context.repository.markedMissing[0] === fileId,
    "metadata records missing state",
  );

  const concealed = await context.files.download(
    { ...actor, workspaceId: "00000000-0000-4000-8000-000000000099" },
    personId,
    fileId,
  );
  assert(concealed.status === "not-found", "other workspace is concealed");
});

Deno.test("[FILES-001] retrieves bytes and safely audits removal", async () => {
  const context = management();
  await context.files.upload(actor, personId, {
    bytes: new Uint8Array([11, 12, 13]),
    filename: "letter.pdf",
    kind: "document",
    mimeType: "application/pdf",
    title: "Letter",
  });
  const downloaded = await context.files.download(actor, personId, fileId);
  assert(downloaded.status === "ready", "download succeeds");
  assert(
    downloaded.bytes.join(",") === "11,12,13",
    "authorized bytes returned",
  );

  const removed = await context.files.remove(actor, personId, fileId);
  assert(removed.status === "removed", "remove succeeds");
  assert(context.storage.objects.size === 0, "removed object is gone");
  assert(
    context.audit.actions.join(",") === "uploaded,read,removed",
    "observable file actions are audited",
  );
});

Deno.test("[FILES-001] keeps metadata available when object removal fails", async () => {
  const storage = new MemoryStorage();
  const context = management({ storage });
  await context.files.upload(actor, personId, {
    bytes: new Uint8Array([21]),
    filename: "letter.pdf",
    kind: "document",
    mimeType: "application/pdf",
    title: "Letter",
  });
  storage.failRemove = true;
  const removed = await context.files.remove(actor, personId, fileId);
  assert(removed.status === "unavailable", "store failure is explicit");
  storage.failRemove = false;
  assert(
    (await context.files.remove(actor, personId, fileId)).status === "removed",
    "storage failure rolls back for retry",
  );
});

Deno.test("[FILES-001] finalize interruption rolls back removal for idempotent retry", async () => {
  const repository = new MemoryFiles();
  const context = management({ repository });
  await context.files.upload(actor, personId, {
    bytes: new Uint8Array([41]),
    filename: "retry.pdf",
    kind: "document",
    mimeType: "application/pdf",
    title: "Retry",
  });
  repository.failFinalizeRemoval = true;
  assert(
    (await context.files.remove(actor, personId, fileId)).status ===
      "unavailable",
    "finalize interruption is explicit",
  );
  assert(
    (await context.files.remove(actor, personId, fileId)).status === "removed",
    "idempotent object delete permits retry",
  );
});

Deno.test("[FILES-001] concurrent remove loser never resurrects winner bytes", async () => {
  const context = management();
  await context.files.upload(actor, personId, {
    bytes: new Uint8Array([31, 32]),
    filename: "shared.pdf",
    kind: "document",
    mimeType: "application/pdf",
    title: "Shared",
  });
  const results = await Promise.all([
    context.files.remove(actor, personId, fileId),
    context.files.remove(actor, personId, fileId),
  ]);
  assert(
    results.some((result) => result.status === "removed"),
    "one remove wins",
  );
  assert(
    context.storage.objects.size === 0,
    "loser does not restore deleted bytes",
  );
});

Deno.test("[GAP-023] a person's files page behind a cursor bound to the workspace and the person", async () => {
  const context = management();
  context.repository.nextPage = {
    createdAt: "2026-08-23T08:00:00.000000Z",
    fileId,
    kind: "photo",
    sortOrder: 0,
  };
  const first = await context.files.list(actor, personId);
  assert(
    first.status === "ready" && first.nextCursor !== undefined,
    "a page with more rows publishes its continuation",
  );
  const cursor = first.nextCursor;
  const second = await context.files.list(actor, personId, {
    cursor,
    limit: 500,
  });
  assert(
    second.status === "ready" && second.nextCursor === undefined,
    "the last page carries no continuation",
  );
  const otherWorkspace = await context.files.list(
    { ...actor, workspaceId: "00000000-0000-4000-8000-0000000000ff" },
    personId,
    { cursor },
  );
  const otherPerson = await context.files.list(
    actor,
    "00000000-0000-4000-8000-0000000000fe",
    { cursor },
  );
  const forged = await context.files.list(actor, personId, {
    cursor: "forged",
  });
  assert(
    [otherWorkspace, otherPerson, forged].every((result) =>
      result.status === "validation-error"
    ),
    "a foreign or malformed cursor is a rejected query",
  );
  assert(
    context.repository.listed.join(",") === `- | 20,${fileId} | 50`,
    "the default page, the clamped page, and nothing for a refused cursor",
  );
});
