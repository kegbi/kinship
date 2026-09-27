import { describe, expect, it } from "vitest";
import type {
  ImportReport,
  ImportSummary,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  CHOOSE_EXPORT,
  DETECTED,
  historyLine,
  historyReducer,
  importHeading,
  importStatus,
  initialNewImport,
  type NewImportAction,
  newImportReducer,
  recognizeSource,
  reportImportId,
  reportReducer,
  reportStatus,
  withinStagingLimit,
} from "./imports.ts";

const report = {
  counts: { contacts: 1 },
  diagnostics: [],
} as unknown as ImportReport;
const reduce = (...actions: NewImportAction[]) =>
  actions.reduce(newImportReducer, initialNewImport);

describe("IMPORT-001 import state", () => {
  it("recognizes only a Monica JSON v1 source within the staging limit", () => {
    expect(withinStagingLimit(1_500_000)).toBe(true);
    expect(withinStagingLimit(1_500_001)).toBe(false);
    expect(recognizeSource('{"format":"monica-json","version":1}')).toEqual({
      message: DETECTED,
      source: { format: "monica-json", version: 1 },
    });
    expect(recognizeSource('{"format":"monica-json","version":2}').source)
      .toBeUndefined();
    expect(recognizeSource("null").message).toBe(
      "Unsupported export. Choose Monica JSON version 1.",
    );
    expect(recognizeSource("{").message).toBe("This file is not valid JSON.");
  });

  it("withdraws a dry run whenever the source or validation moves on", () => {
    expect(initialNewImport.detection).toBe(CHOOSE_EXPORT);
    const reviewed = reduce(
      { type: "ready" },
      { type: "validating" },
      { importId: "i", report, type: "dry-run" },
      { type: "validated" },
      { confirmed: true, type: "confirm" },
    );
    expect(reviewed).toMatchObject({
      confirmed: true,
      importId: "i",
      phase: "ready",
      status: "Dry run complete. Review the report before committing.",
      validating: false,
    });
    expect(newImportReducer(reviewed, { type: "detecting" })).toMatchObject({
      confirmed: false,
      importId: undefined,
      report: undefined,
    });
    expect(newImportReducer(reviewed, { type: "validating" })).toMatchObject({
      importId: undefined,
      status: "Validating bounded staging…",
      validating: true,
    });
    expect(
      newImportReducer(reviewed, { message: "Changed.", type: "validated" })
        .status,
    ).toBe("Changed.");
    const committing = newImportReducer(reviewed, { type: "committing" });
    expect(committing).toMatchObject({
      committing: true,
      status: "Committing validated import…",
    });
    expect(
      newImportReducer(committing, { message: "No.", type: "commit-refused" }),
    ).toMatchObject({ committing: false, status: "No." });
    expect(
      newImportReducer(committing, {
        created: 1,
        importId: "i",
        reused: 2,
        type: "committed",
      }),
    ).toMatchObject({
      committed: "i",
      status: "Import completed: 1 created, 2 reused.",
    });
    expect(reduce({ message: "d", type: "detected" }).detection).toBe("d");
    expect(reduce({ message: "s", type: "status" }).status).toBe("s");
    expect(reduce({ type: "member" }).phase).toBe("member");
    expect(reduce({ type: "no-session" }).status).toBe(
      "Your session could not be confirmed.",
    );
  });

  it("words the history and the report", () => {
    const run = { report, status: "completed" } as unknown as ImportSummary;
    expect(importHeading(run)).toBe("1 contact");
    expect(importStatus("dry_run")).toBe("Dry run");
    expect(importStatus("failed")).toBe("Failed");
    expect(reportStatus("dry_run")).toBe("Awaiting confirmation");
    expect(historyLine(0)).toBe("No imports yet.");
    expect(historyLine(2)).toBe("2 imports.");
    const history = historyReducer({
      imports: undefined,
      member: false,
      retry: false,
      status: "",
      timePreferences: undefined,
    }, { type: "failed" });
    expect(history.retry).toBe(true);
    expect(historyReducer(history, { imports: [run], type: "loaded" }))
      .toMatchObject({ retry: false, status: "1 import." });
    expect(historyReducer(history, { type: "member" }).member).toBe(true);
    expect(
      historyReducer(history, { timePreferences: undefined, type: "context" })
        .timePreferences,
    ).toBeUndefined();
    expect(historyReducer(history, { message: "m", type: "status" }).status)
      .toBe("m");
    const failed = reportReducer({
      outcome: "",
      report: undefined,
      retry: false,
      status: "",
    }, { message: "No.", type: "failed" });
    expect(failed).toMatchObject({ retry: true, status: "No." });
    expect(reportReducer(failed, { outcome: "Failed", report, type: "loaded" }))
      .toMatchObject({ outcome: "Failed", retry: false });
    expect(reportReducer(failed, { message: "m", type: "status" }).status)
      .toBe("m");
    expect(
      reportImportId(
        "/app/settings/import/00000000-0000-4000-8000-000000000010/",
      ),
    ).toBe("00000000-0000-4000-8000-000000000010");
    expect(reportImportId("/app/settings/import/new")).toBeUndefined();
  });
});
