/**
 * The new-import page (GAP-033): choosing a Monica JSON export, validating
 * it as a bounded dry run, reviewing the report, and committing it once
 * confirmed. GAP-050 adds two sources: a vCard file follows the same steps,
 * and a CSV file stops after validation at a column-mapping step whose
 * mapping produces the dry run. A CSV run awaiting its mapping resumes here
 * from `?import=<id>`, which the import history links to.
 *
 * A chosen file is read and recognized at once; a slower read of a file the
 * reader has since replaced is ignored. The form is wired from its first
 * render: a validation submitted before the page knows its workspace is
 * held, never submitted natively (REL-041), and run once it does, after the
 * chosen file has been read. Validation runs one at a time, and a dry run
 * whose source was replaced while it ran is never committable.
 */

import {
  type ChangeEvent,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
} from "react";
import {
  commitImport,
  createImportDryRun,
  type CsvColumnTarget,
  getImportReport,
  mapImportColumns,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import { settle, useLatestRequest } from "../../../islands/core/index.ts";
import { mountSettingsSurface } from "../form/settings-form.tsx";
import { managesWorkspace, resolveSettingsContext } from "../shared/context.ts";
import { useHeldSubmit } from "../shared/hooks.ts";
import { ColumnMapping } from "./column-mapping.tsx";
import {
  CHOOSE_CONTACTS,
  CHOOSE_EXPORT,
  IMPORT_SOURCES,
  type ImportSource,
  initialNewImport,
  newImportReducer,
  recognizeContactFile,
  recognizeSource,
  resumedImportId,
  TOO_LARGE,
  withinStagingLimit,
} from "./imports.ts";
import { ReportCounts } from "./import-report.tsx";

export const IMPORT_NEW_ISLAND = "settings-import-new";

export function NewImport(
  props: {
    readonly onSettled?: () => void;
    /** A file the reader picked in the page before the island mounted. */
    readonly initialFile?: File | undefined;
    /** The query string a resumed CSV mapping is read from. */
    readonly search?: string;
  },
) {
  const [state, dispatch] = useReducer(newImportReducer, initialNewImport);
  const workspace = useRef<string | undefined>(undefined);
  const settled = useRef(props.onSettled);
  // One slot owns the page's source reads: the resumed run and the dry run.
  // A dry run the reader starts replaces a resume still in flight.
  const request = useLatestRequest();
  // The file the reader chose last, the source it was recognized as, the
  // read still in flight, and whether a validation runs.
  const chosen = useRef<File | undefined>(undefined);
  const source = useRef<unknown>(undefined);
  const reading = useRef<Promise<void> | undefined>(undefined);
  const validating = useRef(false);
  const applying = useRef(false);
  // The source kind the chosen file is read as, which the file field names.
  const kind = useRef<ImportSource>("monica");
  const fileInput = useRef<HTMLInputElement>(null);

  const detect = async (file: File | undefined) => {
    chosen.current = file;
    source.current = undefined;
    const as = kind.current;
    dispatch({ type: "detecting" });
    if (!file) {
      dispatch({
        message: as === "monica" ? CHOOSE_EXPORT : CHOOSE_CONTACTS,
        type: "detected",
      });
      return;
    }
    if (!withinStagingLimit(file.size)) {
      dispatch({ message: TOO_LARGE, type: "detected" });
      return;
    }
    let recognized: { readonly source?: unknown; readonly message: string };
    try {
      recognized = as === "monica"
        ? recognizeSource(await file.text())
        : recognizeContactFile(as, new Uint8Array(await file.arrayBuffer()));
    } catch {
      recognized = {
        message: as === "monica"
          ? "This file is not valid JSON."
          : "This file could not be read.",
      };
    }
    if (chosen.current !== file || kind.current !== as) return;
    source.current = recognized.source;
    dispatch({ message: recognized.message, type: "detected" });
  };

  const startDetection = (file: File | undefined) => {
    const read = detect(file).finally(() => {
      if (reading.current === read) reading.current = undefined;
    });
    reading.current = read;
  };
  const choose = (event: ChangeEvent<HTMLInputElement>) =>
    startDetection(event.currentTarget.files?.[0]);

  /** A new source kind: the chosen file no longer means anything. */
  const pick = (next: ImportSource) => {
    kind.current = next;
    chosen.current = undefined;
    source.current = undefined;
    fileInput.current!.value = "";
    dispatch({ source: next, type: "source" });
  };

  /** Resumes the CSV mapping a history entry links to, if it is pending. */
  const resume = async (workspaceId: string) => {
    const importId = resumedImportId(
      props.search ?? globalThis.location.search,
    );
    if (!importId) return;
    const answer = await request(() => getImportReport(importId, workspaceId));
    // Superseded, or the reader already chose something else to import.
    if (!answer || chosen.current || kind.current !== "monica") return;
    const run = answer.data;
    if (
      answer.status !== "ready" || !run?.preview || run.status !== "pending"
    ) {
      dispatch({
        message: "That import is not awaiting a column mapping.",
        type: "status",
      });
      return;
    }
    kind.current = "csv";
    dispatch({ importId: run.importId, preview: run.preview, type: "mapping" });
  };

  const first = useEffectEvent(async () => {
    if (props.initialFile) startDetection(props.initialFile);
    const context = await resolveSettingsContext();
    if (!context) {
      dispatch({ type: "no-session" });
      return;
    }
    if (!managesWorkspace(context.role)) {
      dispatch({ type: "member" });
      return;
    }
    workspace.current = context.workspaceId;
    dispatch({ type: "ready" });
    await resume(context.workspaceId);
  });
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  const validate = async () => {
    const workspaceId = workspace.current!;
    if (validating.current) return;
    validating.current = true;
    // Held from here, including while the chosen file is still being read,
    // which is the one this validation is for.
    dispatch({ type: "validating" });
    if (reading.current) await reading.current;
    const owned = source.current;
    if (!owned) {
      validating.current = false;
      dispatch({
        message: kind.current === "monica"
          ? "Choose a supported Monica JSON export first."
          : "Choose a supported file first.",
        type: "validated",
      });
      return;
    }
    const result = await request(() => createImportDryRun(owned, workspaceId));
    validating.current = false;
    // The dry run is always the slot's latest request, so only unmounting
    // drops its answer, and then nothing is shown.
    if (!result || source.current !== owned) {
      dispatch({
        message: "Source changed. Validate the selected export.",
        type: "validated",
      });
    } else if (result.status !== "ready" || !result.data) {
      dispatch({
        message: result.problem?.detail ?? "The import could not be validated.",
        type: "validated",
      });
    } else if (result.data.status === "mapping") {
      dispatch({
        importId: result.data.importId,
        preview: result.data.preview,
        type: "mapping",
      });
      dispatch({ type: "validated" });
    } else {
      dispatch({
        importId: result.data.importId,
        report: result.data.report,
        type: "dry-run",
      });
      dispatch({ type: "validated" });
    }
  };

  // One mapping is applied at a time; its answer is the dry run.
  const apply = async (columns: readonly CsvColumnTarget[]) => {
    const workspaceId = workspace.current!;
    // The mapping step is only drawn, and so only submitted, with a mapping.
    const mapping = state.mapping!;
    if (applying.current) return;
    applying.current = true;
    dispatch({ type: "applying" });
    const result = await settle(() =>
      mapImportColumns(mapping.importId, columns, workspaceId)
    );
    applying.current = false;
    if (result.status !== "ready" || !result.data) {
      dispatch({
        message: result.problem?.detail ?? "The mapping could not be applied.",
        type: "apply-refused",
      });
      return;
    }
    dispatch({
      importId: result.data.importId,
      report: result.data.report,
      type: "dry-run",
    });
  };
  const submit = useHeldSubmit(state.phase === "ready", () => void validate());

  // Commit is enabled only for a confirmed dry run, and not while it runs.
  const commit = async () => {
    const workspaceId = workspace.current!;
    const importId = state.importId!;
    dispatch({ type: "committing" });
    const result = await settle(() => commitImport(importId, workspaceId));
    if (result.status !== "ready" || !result.data) {
      dispatch({
        message: result.problem?.detail ?? "The import could not be committed.",
        type: "commit-refused",
      });
      return;
    }
    dispatch({
      created: result.data.peopleCreated,
      importId: result.data.importId,
      reused: result.data.peopleReused,
      skippedDeleted: result.data.peopleSkippedDeleted,
      type: "committed",
    });
  };

  const stateLine = (
    <p
      aria-live="polite"
      className="section-state"
      data-import-state=""
      role="status"
    >
      {state.status}
    </p>
  );
  if (state.phase === "member") return stateLine;
  const chosenSource = IMPORT_SOURCES.find((option) =>
    option.id === state.source
  )!;
  return (
    <>
      <form
        className="import-form"
        data-import-form=""
        method="post"
        onSubmit={submit}
      >
        <fieldset className="import-sources" data-import-sources="">
          <legend>Source</legend>
          {IMPORT_SOURCES.map((option) => (
            <label key={option.id}>
              <input
                checked={state.source === option.id}
                disabled={state.validating || state.applying}
                name="sourceKind"
                onChange={() => pick(option.id)}
                type="radio"
                value={option.id}
              />{" "}
              {option.label}
            </label>
          ))}
        </fieldset>
        {state.source === "vcard"
          ? (
            <p className="section-state">
              Photos and properties the importer cannot map are listed as
              skipped in the dry run.
            </p>
          )
          : null}
        <label htmlFor="import-source">{chosenSource.field}</label>
        <input
          accept={chosenSource.accept}
          disabled={state.validating}
          id="import-source"
          name="source"
          onChange={choose}
          ref={fileInput}
          required
          type="file"
        />
        <p
          aria-live="polite"
          className="section-state"
          data-import-detection=""
          role="status"
        >
          {state.detection}
        </p>
        <button disabled={state.validating} type="submit">
          Validate dry run
        </button>
      </form>
      {stateLine}
      {state.mapping
        ? (
          <ColumnMapping
            applying={state.applying}
            mapping={state.mapping}
            onApply={(columns) => void apply(columns)}
          />
        )
        : null}
      <section
        aria-labelledby="import-report-heading"
        data-import-report=""
        hidden={!state.report}
      >
        <h2 id="import-report-heading">Dry-run report</h2>
        {state.report ? <ReportCounts report={state.report} /> : null}
        <label className="confirmation-control">
          <input
            checked={state.confirmed}
            data-import-confirm=""
            onChange={(event) =>
              dispatch({
                confirmed: event.currentTarget.checked,
                type: "confirm",
              })}
            type="checkbox"
          />{" "}
          I confirm this validated import
        </label>
        {state.committed
          ? (
            <a
              className={buttonVariants({
                className: "secondary-link mt-(--space-4)",
                shape: "pill",
                variant: "outline",
              })}
              href={`/app/settings/import/${state.committed}`}
            >
              Open import report
            </a>
          )
          : (
            <button
              data-import-commit=""
              disabled={!state.confirmed || !state.importId ||
                state.committing}
              onClick={() => void commit()}
              type="button"
            >
              Commit import
            </button>
          )}
      </section>
    </>
  );
}

/** Mounts the page over the region `import/new.astro` drew. */
export function mountNewImport(
  root: ParentNode = document,
  search?: string,
): Promise<() => void> {
  return mountSettingsSurface(
    root,
    "[data-import-new-surface]",
    IMPORT_NEW_ISLAND,
    (onSettled) => (
      <NewImport
        initialFile={root.querySelector<HTMLInputElement>(
          "[data-import-new-surface] #import-source",
        )?.files?.[0]}
        onSettled={onSettled}
        {...(search === undefined ? {} : { search })}
      />
    ),
  );
}
