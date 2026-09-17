import { assertEquals } from "../../../testing/assert.ts";
import {
  EXPORT_WINDOWS,
  publicSummary,
  type StoredExport,
} from "./export_rules.ts";

const STORED: StoredExport = {
  completedAt: "2026-03-01T10:05:00.000Z",
  createdAt: "2026-03-01T10:00:00.000Z",
  downloadDigest: "9".repeat(64),
  downloadExpiresAt: "2026-03-01T10:10:00.000Z",
  expiresAt: "2026-03-08T10:05:00.000Z",
  exportId: "e1",
  fileId: "f1",
  format: "json",
  manifest: {
    attachments: { count: 0, items: [], sha256: "a" },
    limitations: [],
    profile: "monica-json",
    rows: { people: { count: 2, sha256: "b" } },
    version: 1,
  },
  status: "completed",
};

Deno.test("[GAP-018] a member sees the run without the artifact or the credential", () => {
  assertEquals(publicSummary(STORED), {
    completedAt: "2026-03-01T10:05:00.000Z",
    createdAt: "2026-03-01T10:00:00.000Z",
    expiresAt: "2026-03-08T10:05:00.000Z",
    exportId: "e1",
    format: "json",
    manifest: STORED.manifest,
    status: "completed",
  });
});

Deno.test("[GAP-018] a run that never got that far loses nothing it did not have", () => {
  assertEquals(
    publicSummary({
      createdAt: "2026-03-01T10:00:00.000Z",
      error: "Portable export is limited to 500 people.",
      exportId: "e2",
      format: "json",
      manifest: STORED.manifest,
      status: "failed",
    }),
    {
      createdAt: "2026-03-01T10:00:00.000Z",
      error: "Portable export is limited to 500 people.",
      exportId: "e2",
      format: "json",
      manifest: STORED.manifest,
      status: "failed",
    },
  );
});

Deno.test("[GAP-018] a download link lives for minutes and an artifact for a week", () => {
  assertEquals(EXPORT_WINDOWS.downloadMs, 300_000);
  assertEquals(EXPORT_WINDOWS.artifactMs, 604_800_000);
});
