import { describe, expect, it } from "vitest";
import type { StorageSettings } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  FORBIDDEN,
  formatBytes,
  initialStorage,
  providerHealth,
  storageReducer,
} from "./storage-settings.ts";

const settings = {
  files: [],
  maximumUploadBytes: 1,
  provider: { bucket: "b", health: "available", name: "s3" },
  usage: {
    available: 0,
    missing: 0,
    processing: 0,
    quarantined: 0,
    totalBytes: 0,
    totalFiles: 0,
  },
} as unknown as StorageSettings;

describe("FILES-001 storage state", () => {
  it("reads, searches, fails, and withdraws", () => {
    const loading = storageReducer(initialStorage, {
      query: undefined,
      type: "loading",
    });
    expect(loading.status).toBe("Loading workspace storage diagnostics…");
    const failed = storageReducer(loading, { type: "failed" });
    expect(failed).toMatchObject({ phase: "ready", retry: true });
    const searching = storageReducer(failed, { query: "x", type: "loading" });
    expect(searching).toMatchObject({ query: "x", retry: false });
    expect(storageReducer(searching, { type: "failed" }).status).toMatch(
      /^File metadata search could not be completed/,
    );
    expect(storageReducer(searching, { settings, type: "loaded" }).searchStatus)
      .toBe("No files match this workspace lookup.");
    const withdrawn = storageReducer(
      storageReducer(loading, { settings, type: "loaded" }),
      { type: "forbidden" },
    );
    expect(withdrawn).toMatchObject({
      phase: "forbidden",
      settings: undefined,
      status: FORBIDDEN,
    });
    const noSession = storageReducer(initialStorage, { type: "no-session" });
    expect(noSession).toMatchObject({ phase: "no-session", retry: true });
    expect(
      storageReducer(noSession, { query: undefined, type: "loading" }).phase,
    )
      .toBe("loading");
    expect(
      storageReducer(withdrawn, { query: undefined, type: "loading" }).phase,
    )
      .toBe("forbidden");
    expect(
      storageReducer(initialStorage, { message: "m", type: "search-status" })
        .searchStatus,
    ).toBe("m");
  });

  it("formats sizes and provider health", () => {
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 ** 5)).toBe("1,024 TB");
    expect(providerHealth("available")).toBe("Available");
    expect(providerHealth("not-initialized")).toBe("Not initialized");
    expect(providerHealth("unavailable")).toBe("Unavailable");
  });
});
