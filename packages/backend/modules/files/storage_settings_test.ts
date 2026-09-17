import {
  createStorageSettings,
  type PersonFileActor,
  type StorageSettingsRepository,
} from "./public.ts";
import type { PeopleTransaction } from "../people/public.ts";
import { assert } from "../../testing/assert.ts";
import * as fixtures from "../../testing/fixtures.ts";

const admin: PersonFileActor = fixtures.actor({ role: "admin" });

class MemoryStorageSettings implements StorageSettingsRepository {
  calls = 0;

  read(command: Parameters<StorageSettingsRepository["read"]>[0]) {
    this.calls += 1;
    if (
      command.workspaceId !== admin.workspaceId || command.role === "member"
    ) {
      return Promise.resolve({ status: "forbidden" } as const);
    }
    return Promise.resolve({
      files: command.query
        ? [{
          byteSize: 2048,
          createdAt: "2026-08-23T08:00:00.000Z",
          fileId: "00000000-0000-4000-8000-000000000004",
          filename: "care-plan.pdf",
          kind: "document" as const,
          mimeType: "application/pdf",
          personId: "00000000-0000-4000-8000-000000000005",
          personName: "Ada Lovelace",
          status: "available" as const,
          title: "Care plan",
        }]
        : [],
      status: "ready" as const,
      usage: {
        available: 1,
        missing: 1,
        processing: 0,
        quarantined: 1,
        totalBytes: 4096,
        totalFiles: 3,
      },
    });
  }
}

function settings(repository = new MemoryStorageSettings()) {
  let probes = 0;
  return {
    repository,
    settings: createStorageSettings({
      actors: { revalidate: () => Promise.resolve("active" as const) },
      maximumUploadBytes: 10_485_760,
      provider: { bucket: "attachments", name: "s3" },
      providerHealth: () => {
        probes += 1;
        return Promise.resolve("available" as const);
      },
      repository,
      transaction: {
        run: <T>(work: (transaction: PeopleTransaction) => Promise<T>) =>
          work({ opaque: {} }),
      },
    }),
    probes: () => probes,
  };
}

Deno.test("[FILES-001] storage settings expose bounded safe workspace metadata to admins", async () => {
  const context = settings();
  const result = await context.settings.get(admin, " care ");
  assert(result.status === "ready", "admin storage settings are ready");
  assert(result.files.length === 1, "bounded metadata lookup returned");
  assert(result.files[0]?.title === "Care plan", "safe metadata is visible");
  assert(result.usage.totalFiles === 3, "canonical file count returned");
  assert(result.provider.health === "available", "provider health returned");
  assert(result.provider.name === "s3", "effective provider returned");
  assert(result.provider.bucket === "attachments", "effective bucket returned");
  assert(result.maximumUploadBytes === 10_485_760, "effective limit returned");
  assert(!("storageKey" in result.files[0]!), "raw object key is concealed");
});

Deno.test("[FILES-001] ordinary members cannot trigger inventory or provider probes", async () => {
  const context = settings();
  const result = await context.settings.get(
    { ...admin, role: "member" },
    "care",
  );
  assert(result.status === "forbidden", "ordinary member is forbidden");
  assert(context.repository.calls === 0, "inventory query was not attempted");
  assert(context.probes() === 0, "provider probe was not attempted");
});

Deno.test("[FILES-001] storage lookup rejects unbounded query input", async () => {
  const context = settings();
  const result = await context.settings.get(admin, "x".repeat(101));
  assert(result.status === "validation-error", "oversized lookup is rejected");
  assert(
    context.repository.calls === 0,
    "invalid query never reaches storage metadata",
  );
});
