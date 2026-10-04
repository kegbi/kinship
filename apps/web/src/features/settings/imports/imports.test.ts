import { describe, expect, it } from "vitest";
import type {
  ImportReport,
  ImportSummary,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  CHOOSE_CONTACTS,
  CHOOSE_EXPORT,
  debtAmountPreview,
  DETECTED,
  historyLine,
  historyReducer,
  importHeading,
  importHref,
  importStatus,
  initialNewImport,
  monicaChoicesComplete,
  type NewImportAction,
  newImportReducer,
  NOT_UTF8,
  recognizeContactFile,
  recognizeSource,
  reportImportId,
  reportReducer,
  reportStatus,
  resumedImportId,
  selectedMonicaChoices,
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
        skippedDeleted: 0,
        type: "committed",
      }),
    ).toMatchObject({
      committed: "i",
      status: "Import completed: 1 created, 2 reused.",
    });
    // A person a member deleted since stays deleted and is said so (REL-065).
    expect(
      newImportReducer(committing, {
        created: 0,
        importId: "i",
        reused: 1,
        skippedDeleted: 2,
        type: "committed",
      }).status,
    ).toBe(
      "Import completed: 0 created, 1 reused, 2 skipped because they were deleted.",
    );
    expect(
      newImportReducer(committing, {
        created: 0,
        importId: "i",
        reused: 0,
        skippedDeleted: 1,
        type: "committed",
      }).status,
    ).toBe(
      "Import completed: 0 created, 0 reused, 1 skipped because it was deleted.",
    );
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

const ENCODER = new TextEncoder();
const preview = {
  delimiter: ",",
  headers: ["Name"],
  rowCount: 3,
  rows: [["Ada"]],
  suggested: ["givenName"],
} as const;

describe("IMPORT-002 contact import state", () => {
  it("recognizes a vCard or CSV file only when it is UTF-8", () => {
    expect(recognizeContactFile("vcard", ENCODER.encode("BEGIN:VCARD\r\n")))
      .toEqual({
        message: "vCard file detected.",
        source: { format: "vcard", text: "BEGIN:VCARD\r\n" },
      });
    expect(recognizeContactFile("vcard", ENCODER.encode("FN:Ada")).message)
      .toBe("This file does not look like a vCard.");
    expect(recognizeContactFile("csv", ENCODER.encode("Name\nAda")).source)
      .toEqual({ format: "csv", text: "Name\nAda" });
    expect(recognizeContactFile("csv", ENCODER.encode(" \n")).message).toBe(
      "This CSV file has no header row.",
    );
    expect(recognizeContactFile("csv", new Uint8Array([0xff, 0xfe])))
      .toEqual({ message: NOT_UTF8 });
  });

  it("withdraws the dry run and the mapping when the source changes", () => {
    const mapped = reduce({ type: "ready" }, {
      importId: "i",
      preview,
      type: "mapping",
    });
    expect(mapped).toMatchObject({
      mapping: { importId: "i", preview },
      source: "csv",
      status:
        "Map each column to a field, or choose Ignore, then apply the mapping.",
    });
    const applying = newImportReducer(mapped, { type: "applying" });
    expect(applying).toMatchObject({
      applying: true,
      status: "Applying the mapping…",
    });
    expect(
      newImportReducer(applying, { message: "No.", type: "apply-refused" }),
    )
      .toMatchObject({
        applying: false,
        mapping: mapped.mapping,
        status: "No.",
      });
    const dry = newImportReducer(applying, {
      importId: "i",
      report,
      type: "dry-run",
    });
    expect(dry).toMatchObject({ applying: false, importId: "i", report });
    expect(dry.mapping).toBeUndefined();
    const vcard = newImportReducer(dry, { source: "vcard", type: "source" });
    expect(vcard).toMatchObject({
      detection: CHOOSE_CONTACTS,
      importId: undefined,
      report: undefined,
      source: "vcard",
    });
    expect(newImportReducer(vcard, { source: "monica", type: "source" }))
      .toMatchObject({ detection: CHOOSE_EXPORT, source: "monica" });
    expect(newImportReducer(mapped, { type: "detecting" }).mapping)
      .toBeUndefined();
  });

  it("words and links a contact import in the history", () => {
    const pending = {
      importId: "00000000-0000-4000-8000-000000000020",
      preview,
      report,
      sourceSystem: "csv",
      status: "pending",
    } as unknown as ImportSummary;
    expect(importHeading(pending)).toBe("3 rows · CSV");
    expect(importHref(pending)).toBe(
      "/app/settings/import/new?import=00000000-0000-4000-8000-000000000020",
    );
    expect(importStatus("pending")).toBe("Awaiting column mapping");
    expect(reportStatus("pending")).toBe("Awaiting column mapping");
    const vcard = {
      importId: "v",
      report,
      sourceSystem: "vcard",
      status: "completed",
    } as unknown as ImportSummary;
    expect(importHeading(vcard)).toBe("1 contact · vCard");
    expect(importHref(vcard)).toBe("/app/settings/import/v");
    expect(resumedImportId(`?import=${pending.importId}`)).toBe(
      pending.importId,
    );
    expect(resumedImportId("?import=../../x")).toBeUndefined();
    expect(resumedImportId("")).toBeUndefined();
  });
});

it("IMPORT-001 recognizes a Monica SQL data export for server validation", () => {
  const text =
    "# Monica export\nSET FOREIGN_KEY_CHECKS=0;\nINSERT IGNORE INTO `contacts` (`id`,`first_name`) VALUES (1,'Ada');";
  expect(recognizeSource(text)).toEqual({
    message: "Monica SQL export detected. Validate to review supported data.",
    source: { format: "monica-sql", text },
  });
});

it("Monica choices validate timezone and use exact previews without changing JSON amounts", () => {
  const report: ImportReport = {
    counts: {
      contacts: 1,
      missingFiles: 0,
      legacyCredentialsDiscarded: 0,
      orphans: 0,
      unsupported: 0,
    },
    diagnostics: [],
    monicaChoices: {
      currencyMinorUnits: { JPY: 0 },
      currencies: ["JPY"],
      genders: [{ id: "active", name: "Custom", source: false }],
      debts: [{
        sourceKey: "1",
        contactName: "Ada",
        rawAmount: "12345",
        minorUnits: true,
      }],
      contacts: [{ sourceKey: "1", contactName: "Ada", sourceGender: "999" }],
    },
  };
  let state = newImportReducer(initialNewImport, {
    type: "dry-run",
    report,
    importId: "run",
  });
  expect(monicaChoicesComplete(state)).toBe(false);
  state = {
    ...state,
    timezone: "Not/AZone",
    currencyChoices: { "1": "JPY" },
    genderChoices: { "1": "map:active" },
  };
  expect(monicaChoicesComplete(state)).toBe(false);
  state = { ...state, timezone: "UTC" };
  expect(monicaChoicesComplete(state)).toBe(true);
  expect(selectedMonicaChoices(state)?.genders).toEqual([{
    sourceKey: "1",
    action: "map",
    genderId: "active",
  }]);
  expect(
    selectedMonicaChoices({
      ...state,
      genderChoices: { "1": "create" },
      genderNames: { "1": " New " },
    })?.genders,
  ).toEqual([{ sourceKey: "1", action: "create", name: "New" }]);
  expect(debtAmountPreview("9007199254740993", true, "KWD", 3)).toBe(
    "9007199254740.993",
  );
  expect(debtAmountPreview("12345", true, "MGA", 2)).toBe("123.45");
  expect(debtAmountPreview("12345", true, "JPY", 0)).toBe("12345");
  expect(debtAmountPreview("1.2345", false, "JPY", 0)).toBe("1.2345");
  for (
    const action of [{ type: "detecting" }, { type: "validating" }, {
      type: "source",
      source: "csv",
    }] as const
  ) {
    const cleared = newImportReducer(state, action);
    expect(cleared.timezone).toBe("");
    expect(cleared.genderChoices).toEqual({});
    expect(cleared.currencyChoices).toEqual({});
  }
  expect(selectedMonicaChoices(initialNewImport)).toBeUndefined();
});
