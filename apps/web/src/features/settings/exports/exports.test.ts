import { describe, expect, it } from "vitest";
import type { ExportSummary } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  exportCompleted,
  exportHeading,
  exportsReducer,
  exportStatus,
  initialExports,
} from "./exports.ts";

const run = {
  exportId: "e",
  manifest: { rows: { people: { count: 2 } } },
  status: "completed",
} as unknown as ExportSummary;

describe("EXPORT-001 export state", () => {
  it("moves through its phases and keeps each download until a new history", () => {
    const ready = exportsReducer(initialExports, {
      timePreferences: undefined,
      type: "context",
    });
    expect(ready.phase).toBe("ready");
    const loaded = exportsReducer(ready, { exports: [run], type: "loaded" });
    expect(loaded.status).toBe("1 export.");
    const preparing = exportsReducer(loaded, {
      exportId: "e",
      type: "preparing",
    });
    expect(preparing.preparing).toEqual(["e"]);
    const prepared = exportsReducer(preparing, {
      exportId: "e",
      href: "/download",
      message: "Ready.",
      type: "prepared",
    });
    expect(prepared).toMatchObject({
      downloads: { e: "/download" },
      preparing: [],
      status: "Ready.",
    });
    expect(
      exportsReducer(preparing, {
        exportId: "e",
        message: "No.",
        type: "prepared",
      }).downloads,
    ).toEqual({});
    expect(
      exportsReducer(prepared, { exports: [run], type: "loaded" }).downloads,
    )
      .toEqual({});
    const creating = exportsReducer(ready, {
      creating: true,
      type: "creating",
    });
    expect(creating.status).toBe("Creating portable export…");
    expect(exportsReducer(creating, { creating: false, type: "creating" }))
      .toMatchObject({ creating: false, status: "Creating portable export…" });
    expect(exportsReducer(ready, { type: "failed" })).toMatchObject({
      retry: true,
      status: "Export history could not be loaded.",
    });
    expect(exportsReducer(ready, { exports: [], type: "loaded" }).status).toBe(
      "No exports yet.",
    );
    expect(exportsReducer(ready, { type: "member" }).phase).toBe("member");
    expect(exportsReducer(ready, { type: "no-session" }).phase).toBe(
      "no-session",
    );
    expect(exportsReducer(ready, { message: "x", type: "status" }).status)
      .toBe("x");
  });

  it("words each export", () => {
    expect(exportHeading(run)).toBe("2 persons");
    expect(exportStatus(run)).toBe("Completed");
    expect(exportCompleted(1)).toBe("Export completed for 1 person.");
  });
});
