import type { Failure } from "../../../shared-kernel/result.ts";
import {
  createExportManagement,
  type ExportActor,
  type ExportFileBoundary,
  type ExportRepository,
  type ExportSummary,
  type ExportTransaction,
  type PeopleExportBoundary,
  type StoredExport,
} from "../public.ts";
import { assert } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import { fixedClock } from "../../../testing/fakes.ts";

const actor: ExportActor = fixtures.actor({ role: "admin" });
const exportId = "00000000-0000-4000-8000-000000000004";
const fileId = "00000000-0000-4000-8000-000000000005";
const personId = "00000000-0000-4000-8000-000000000006";

class MemoryRepository implements ExportRepository {
  summary?: ExportSummary;
  stored?: StoredExport;
  /** The member the outstanding link was issued to. */
  downloadMemberId?: string;
  failed = false;
  completeFails = false;
  complete(command: Parameters<ExportRepository["complete"]>[0]) {
    if (this.completeFails) return Promise.reject(new Error("commit lost"));
    this.summary = {
      completedAt: command.completedAt.toISOString(),
      createdAt: command.completedAt.toISOString(),
      expiresAt: command.expiresAt.toISOString(),
      exportId: command.exportId,
      format: "json",
      manifest: command.manifest,
      status: "completed",
    };
    this.stored = { ...this.summary, fileId: command.fileId };
    return Promise.resolve(this.summary);
  }
  fail(): Promise<void> {
    this.failed = true;
    if (this.stored) this.stored = { ...this.stored, status: "failed" };
    return Promise.resolve();
  }
  consumeDownload(
    command: Parameters<ExportRepository["consumeDownload"]>[0],
  ): ReturnType<ExportRepository["consumeDownload"]> {
    if (!this.stored || this.stored.exportId !== command.exportId) {
      return Promise.resolve({ status: "not-found" });
    }
    if (
      this.stored.downloadDigest !== command.digest ||
      Date.parse(this.stored.downloadExpiresAt ?? "") <= command.now.getTime()
    ) return Promise.resolve({ status: "expired" });
    if (this.downloadMemberId !== command.actor.memberId) {
      return Promise.resolve({ status: "forbidden" });
    }
    const fileId = this.stored.fileId!;
    const { downloadDigest: _digest, downloadExpiresAt: _expires, ...stored } =
      this.stored;
    this.stored = stored;
    return Promise.resolve({ fileId, status: "consumed" });
  }
  issueDownload(
    command: Parameters<ExportRepository["issueDownload"]>[0],
  ): Promise<boolean> {
    if (!this.stored) return Promise.resolve(false);
    this.stored = {
      ...this.stored,
      downloadDigest: command.digest,
      downloadExpiresAt: command.expiresAt.toISOString(),
    };
    this.downloadMemberId = command.actor.memberId;
    return Promise.resolve(true);
  }
  list(): Promise<readonly ExportSummary[]> {
    return Promise.resolve(this.summary ? [this.summary] : []);
  }
  lock(): Promise<StoredExport | undefined> {
    return Promise.resolve(this.stored);
  }
  startOrResume(
    command: Parameters<ExportRepository["startOrResume"]>[0],
  ): ReturnType<ExportRepository["startOrResume"]> {
    if (this.stored?.status === "running") {
      return Promise.resolve({
        created: false,
        exportId: this.stored.exportId,
      });
    }
    this.stored = {
      createdAt: command.startedAt.toISOString(),
      exportId: command.exportId,
      format: "json",
      manifest: {
        attachments: { count: 0, items: [], sha256: "" },
        limitations: [],
        profile: "monica-json",
        rows: { people: { count: 0, sha256: "" } },
        version: 1,
      },
      status: "running",
    };
    return Promise.resolve({ created: true, exportId: command.exportId });
  }
}

class MemoryFiles implements ExportFileBoundary {
  bytes: Uint8Array | undefined;
  storeCount = 0;
  discard(): ReturnType<ExportFileBoundary["discard"]> {
    this.bytes = undefined;
    return Promise.resolve({ status: "discarded" });
  }
  recover(): ReturnType<ExportFileBoundary["recover"]> {
    return Promise.resolve(
      this.bytes
        ? { bytes: this.bytes, fileId, status: "stored" }
        : { status: "absent" },
    );
  }
  read(): Promise<
    | {
      readonly bytes: Uint8Array;
      readonly filename: string;
      readonly mimeType: string;
      readonly status: "ready";
    }
    | Failure<"forbidden" | "not-found" | "unavailable", "missing">
  > {
    return Promise.resolve(
      this.bytes
        ? {
          bytes: this.bytes,
          filename: "kinship-export.json",
          mimeType: "application/json",
          status: "ready",
        }
        : { status: "missing" },
    );
  }
  store(
    command: Parameters<ExportFileBoundary["store"]>[0],
  ): ReturnType<ExportFileBoundary["store"]> {
    this.storeCount++;
    this.bytes = command.bytes;
    return Promise.resolve({ fileId, status: "stored" } as const);
  }
}

const people: PeopleExportBoundary = {
  getPerson: () =>
    Promise.resolve({
      dates: [],
      contactMethods: [
        { kind: "email", label: "Work", value: "ada@example.test" },
        { kind: "phone", label: "Mobile", value: "+381111111" },
      ],
      familyName: "Lovelace",
      givenName: "Ada",
      id: personId,
      isDeceased: false,
      isPartial: false,
      isStarred: true,
    }),
  listWorkspace: () =>
    Promise.resolve([{
      dates: [],
      contactMethods: [{
        kind: "email",
        label: "Work",
        value: "ada@example.test",
      }],
      familyName: "Lovelace",
      givenName: "Ada",
      id: personId,
      isDeceased: false,
      isPartial: false,
      isStarred: true,
    }]),
};

function context() {
  const files = new MemoryFiles();
  const repository = new MemoryRepository();
  // The actor's standing is the `workspaces` port's answer now, so the test
  // withdraws authority here rather than through the export repository.
  const standing = { active: true };
  const audit: Array<{ readonly action: string; readonly subjectId: string }> =
    [];
  const exports = createExportManagement({
    actors: {
      revalidate: () =>
        Promise.resolve(standing.active ? "active" as const : "revoked"),
    },
    audit: {
      record: (command) => {
        audit.push({ action: command.action, subjectId: command.exportId });
        return Promise.resolve();
      },
      recordPersonDownload: (command) => {
        audit.push({ action: "downloaded", subjectId: command.personId });
        return Promise.resolve();
      },
    },
    clock: fixedClock("2026-08-23T10:00:00.000Z"),
    files,
    ids: { next: () => exportId },
    people,
    repository,
    tokens: { next: () => "download-secret" },
    transaction: {
      run: <T>(work: (transaction: ExportTransaction) => Promise<T>) =>
        work({ opaque: {} }),
    },
  });
  return { audit, exports, files, repository, standing };
}

Deno.test("[EXPORT-001] creates a checksum-manifested portable person subset", async () => {
  const { exports, files } = context();
  const created = await exports.createWorkspace(actor);
  assert(created.status === "completed", "workspace export completed");
  assert(created.manifest.version === 1, "manifest is versioned");
  assert(created.manifest.rows.people.count === 1, "person count recorded");
  assert(
    /^[0-9a-f]{64}$/.test(created.manifest.rows.people.sha256),
    "row checksum recorded",
  );
  assert(
    created.manifest.attachments.count === 0,
    "unsupported attachments are honest",
  );
  const portable = JSON.parse(new TextDecoder().decode(files.bytes)) as {
    format: string;
    tables: { contacts: Array<Record<string, unknown>> };
    version: number;
  };
  assert(
    portable.format === "monica-json" && portable.version === 1,
    "import-compatible profile emitted",
  );
  assert(
    portable.tables.contacts[0]?.first_name === "Ada",
    "supported person fields emitted",
  );
  assert(!("password" in portable.tables.contacts[0]!), "secrets absent");
  assert(
    (await exports.createWorkspace({ ...actor, role: "member" })).status ===
      "forbidden",
    "member workspace export rejected",
  );
});

Deno.test("[EXPORT-001] exports a member-authorized vCard with escaped contact data", async () => {
  const { audit, exports } = context();
  const result = await exports.exportVCard(
    { ...actor, role: "member" },
    personId,
  );
  assert(result.status === "ready", "member vCard is ready");
  const vcard = new TextDecoder().decode(result.bytes);
  assert(vcard.includes("BEGIN:VCARD\r\nVERSION:4.0"), "vCard 4 emitted");
  assert(vcard.includes("FN:Ada Lovelace"), "display name emitted");
  assert(vcard.includes("EMAIL;TYPE=Work:ada@example.test"), "email emitted");
  assert(vcard.includes("TEL;TYPE=Mobile:+381111111"), "phone emitted");
  assert(
    audit.some((event) =>
      event.action === "downloaded" && event.subjectId === personId
    ),
    "person-scoped vCard download is audited",
  );
  const hostile = createExportManagement({
    actors: { revalidate: () => Promise.resolve("active") },
    audit: {
      record: () => Promise.resolve(),
      recordPersonDownload: () => Promise.resolve(),
    },
    clock: fixedClock("2026-08-23T10:00:00.000Z"),
    files: new MemoryFiles(),
    ids: { next: () => exportId },
    people: {
      ...people,
      getPerson: () =>
        Promise.resolve({
          dates: [],
          contactMethods: [{
            kind: "email",
            label: "Work:unsafe\nTYPE=home",
            value: "safe@example.test",
          }],
          givenName: "Ada\rInjected",
          id: personId,
          isDeceased: false,
          isPartial: false,
          isStarred: false,
        }),
    },
    repository: new MemoryRepository(),
    tokens: { next: () => "download-secret" },
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  const sanitized = await hostile.exportVCard(actor, personId);
  assert(sanitized.status === "ready", "hostile label fixture exported");
  assert(
    new TextDecoder().decode(sanitized.bytes).includes(
      "FN:Ada\\nInjected\r\nN:;Ada\\nInjected;;;\r\nEMAIL;TYPE=Work-unsafe-TYPE-home:safe@example.test",
    ),
    "vCard parameter and lone carriage returns are constrained",
  );
});

Deno.test("[EXPORT-001] persists resumable history and validates each short-lived download", async () => {
  const { exports } = context();
  assert(
    (await exports.createWorkspace(actor)).status === "completed",
    "fixture export completed",
  );
  const history = await exports.list(actor);
  assert(
    history.status === "ready" && history.exports.length === 1,
    "persisted history resumes",
  );
  const reference = await exports.createDownload(actor, exportId);
  assert(
    reference.status === "ready" && reference.href.includes("download-secret"),
    "fresh reference issued",
  );
  const downloaded = await exports.download(actor, exportId, "download-secret");
  assert(
    downloaded.status === "ready" &&
      new TextDecoder().decode(downloaded.bytes).includes("monica-json"),
    "authorized artifact read",
  );
  assert(
    (await exports.download(actor, exportId, "download-secret")).status ===
      "expired",
    "download reference is consumed once",
  );
  assert(
    (await exports.download(actor, exportId, "stale")).status === "expired",
    "wrong token rejected as expired",
  );
  // AUD-T1 (SECT-10): another admin holding the link is refused, and the
  // refusal leaves it for the member it was issued to.
  assert(
    (await exports.createDownload(actor, exportId)).status === "ready",
    "a second reference issued",
  );
  const colleague = {
    ...actor,
    memberId: "00000000-0000-4000-8000-000000000007",
  };
  assert(
    (await exports.download(colleague, exportId, "download-secret")).status ===
      "forbidden",
    "another admin redeemed the member's download reference",
  );
  assert(
    (await exports.download(actor, exportId, "download-secret")).status ===
      "ready",
    "the refusal spent the member's download reference",
  );
  assert(
    (await exports.createDownload({ ...actor, role: "member" }, exportId))
      .status === "forbidden",
    "member cannot mint workspace download",
  );
});

Deno.test("[EXPORT-001] leaves artifact ambiguity recoverable without presenting completion", async () => {
  const { exports, files, repository } = context();
  files.store = () => Promise.resolve({ status: "unavailable" });
  assert(
    (await exports.createWorkspace(actor)).status === "unavailable",
    "storage failure is visible",
  );
  assert(!repository.failed, "canonical running job remains recoverable");
  repository.failed = false;
  files.store = () => Promise.reject(new Error("object store disconnected"));
  assert(
    (await exports.createWorkspace(actor)).status === "unavailable",
    "thrown storage failure is settled",
  );
  assert(!repository.failed, "thrown storage ambiguity remains recoverable");
});

Deno.test("[EXPORT-001] resumes one running export and finalizes its verified artifact", async () => {
  const { exports, files, repository } = context();
  repository.completeFails = true;
  assert(
    (await exports.createWorkspace(actor)).status === "unavailable",
    "ambiguous finalization is visible",
  );
  assert(
    repository.stored?.status === "running" && files.storeCount === 1,
    "running job and private artifact remain recoverable",
  );
  repository.completeFails = false;
  const resumed = await exports.createWorkspace(actor);
  assert(
    resumed.status === "completed" && resumed.exportId === exportId,
    "same running export is finalized after restart",
  );
  assert(files.storeCount === 1, "verified artifact is not duplicated");
});

Deno.test("[EXPORT-001] conceals lost authority, missing people, and missing jobs", async () => {
  const { exports, repository, standing } = context();
  standing.active = false;
  assert(
    (await exports.createWorkspace(actor)).status === "forbidden",
    "lost create authority rejected",
  );
  assert(
    (await exports.list(actor)).status === "forbidden",
    "lost history authority rejected",
  );
  assert(
    (await exports.download(actor, exportId, "secret")).status === "not-found",
    "lost download authority conceals the artifact",
  );
  standing.active = true;
  assert(
    (await exports.createDownload(actor, exportId)).status === "not-found",
    "missing job concealed",
  );
  assert(
    (await exports.download(actor, exportId, "secret")).status === "not-found",
    "missing artifact concealed",
  );
  const missingPeople: PeopleExportBoundary = {
    ...people,
    getPerson: () => Promise.resolve(undefined),
  };
  const unavailable = createExportManagement({
    actors: { revalidate: () => Promise.resolve("active") },
    audit: {
      record: () => Promise.resolve(),
      recordPersonDownload: () => Promise.resolve(),
    },
    clock: fixedClock("2026-08-23T10:00:00.000Z"),
    files: new MemoryFiles(),
    ids: { next: () => exportId },
    people: missingPeople,
    repository,
    tokens: { next: () => "download-secret" },
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  assert(
    (await unavailable.exportVCard(actor, personId)).status === "not-found",
    "missing person concealed",
  );
  repository.failed = false;
  const oversized = createExportManagement({
    actors: { revalidate: () => Promise.resolve("active") },
    audit: {
      record: () => Promise.resolve(),
      recordPersonDownload: () => Promise.resolve(),
    },
    clock: fixedClock("2026-08-23T10:00:00.000Z"),
    files: new MemoryFiles(),
    ids: { next: () => exportId },
    people: {
      ...people,
      listWorkspace: () =>
        Promise.resolve(Array.from({ length: 501 }, () => ({
          dates: [],
          contactMethods: [],
          givenName: "Person",
          id: personId,
          isDeceased: false,
          isPartial: false,
          isStarred: false,
        }))),
    },
    repository,
    tokens: { next: () => "download-secret" },
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  assert(
    (await oversized.createWorkspace(actor)).status === "too-large",
    "oversized subset is rejected instead of truncated",
  );
  assert(repository.failed, "oversized canonical job is marked failed");
});

Deno.test("[EXPORT-002] a CSV export is one archive stored and audited like the JSON one", async () => {
  const { audit, exports, files } = context();
  const created = await exports.createWorkspace(actor, "csv");
  assert(created.status === "completed", "CSV export completed");
  assert(created.manifest.profile === "csv", "the manifest names its profile");
  assert(
    created.manifest.rows.contactMethods?.count === 1 &&
      created.manifest.rows.dates?.count === 0,
    "every table is signed",
  );
  const archive = new TextDecoder().decode(files.bytes);
  assert(archive.startsWith("PK\u0003\u0004"), "a ZIP archive is stored");
  assert(archive.includes("people.csv"), "the people table is archived");
  assert(
    audit.map((event) => event.action).join() === "requested,completed",
    "requested and completed are audited",
  );
});

Deno.test("[EXPORT-002] a vCard export resumes from its stored bytes and rebuilds changed ones", async () => {
  const { exports, files, repository } = context();
  const created = await exports.createWorkspace(actor, "vcard");
  assert(created.status === "completed", "vCard export completed");
  assert(
    new TextDecoder().decode(files.bytes).includes("FN:Ada Lovelace"),
    "every person's card is written",
  );
  // An interrupted run whose stored bytes still match what the people
  // produce finishes from them; one whose bytes changed stores new ones.
  repository.stored = { ...repository.stored!, status: "running" };
  assert(
    (await exports.createWorkspace(actor, "vcard")).status === "completed",
    "a resumed run completes",
  );
  const stores = () => files.storeCount;
  assert(stores() === 1, "matching bytes are not stored twice");
  repository.stored = { ...repository.stored!, status: "running" };
  files.bytes = new TextEncoder().encode("tampered");
  assert(
    (await exports.createWorkspace(actor, "vcard")).status === "completed",
    "a run with changed bytes completes",
  );
  assert(stores() === 2, "changed bytes are discarded and rebuilt");
});

Deno.test("[PEOPLE-009] exports the selected people as one vCard and counts who is skipped", async () => {
  const { audit, exports, standing } = context();
  const grace = "00000000-0000-4000-8000-000000000007";
  const missing = "00000000-0000-4000-8000-000000000008";
  const selection = createExportManagement({
    actors: { revalidate: () => Promise.resolve("active") },
    audit: {
      record: () => Promise.resolve(),
      recordPersonDownload: (command) => {
        audit.push({ action: "downloaded", subjectId: command.personId });
        return Promise.resolve();
      },
    },
    clock: fixedClock("2026-08-23T10:00:00.000Z"),
    files: new MemoryFiles(),
    ids: { next: () => exportId },
    people: {
      ...people,
      getPerson: (command) =>
        command.personId === missing
          ? Promise.resolve(undefined)
          : people.getPerson(command).then((person) =>
            command.personId === grace
              ? {
                ...person!,
                contactMethods: [],
                familyName: "Hopper",
                givenName: "Grace",
                id: grace,
              }
              : person
          ),
    },
    repository: new MemoryRepository(),
    tokens: { next: () => "download-secret" },
    transaction: { run: (work) => work({ opaque: {} }) },
  });
  const result = await selection.exportVCards(
    { ...actor, role: "member" },
    [grace, missing, personId],
  );
  assert(result.status === "ready", "the selection is exported");
  const text = new TextDecoder().decode(result.bytes);
  assert(
    text.indexOf("FN:Grace Hopper") < text.indexOf("FN:Ada Lovelace") &&
      text.indexOf("FN:Grace Hopper") >= 0,
    "one card per person, in request order",
  );
  assert(
    text.split("BEGIN:VCARD").length === 3,
    "the missing person has no card",
  );
  assert(result.skipped === 1, "the missing person is counted");
  assert(result.mimeType === "text/vcard; charset=utf-8", "vCard media type");
  assert(result.filename === "kinship-people-2.vcf", "selection filename");
  assert(
    audit.filter((event) => event.action === "downloaded").map((event) =>
      event.subjectId
    ).join() === [grace, personId].join(),
    "each exported person's download is audited",
  );
  assert(
    (await selection.exportVCards(actor, [missing])).status === "not-found",
    "a selection of nobody exportable is not found",
  );
  standing.active = false;
  assert(
    (await exports.exportVCards(actor, [personId])).status === "forbidden",
    "a revoked member is refused",
  );
});
