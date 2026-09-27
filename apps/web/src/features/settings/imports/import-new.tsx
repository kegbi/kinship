/**
 * The new-import page (GAP-033): choosing a Monica JSON export, validating
 * it as a bounded dry run, reviewing the report, and committing it once
 * confirmed.
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
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import { settle } from "../../../islands/core/index.ts";
import { mountSettingsSurface } from "../form/settings-form.tsx";
import { managesWorkspace, resolveSettingsContext } from "../shared/context.ts";
import { useHeldSubmit } from "../shared/hooks.ts";
import {
  CHOOSE_EXPORT,
  initialNewImport,
  newImportReducer,
  recognizeSource,
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
  },
) {
  const [state, dispatch] = useReducer(newImportReducer, initialNewImport);
  const workspace = useRef<string | undefined>(undefined);
  const settled = useRef(props.onSettled);
  // The file the reader chose last, the source it was recognized as, the
  // read still in flight, and whether a validation runs.
  const chosen = useRef<File | undefined>(undefined);
  const source = useRef<unknown>(undefined);
  const reading = useRef<Promise<void> | undefined>(undefined);
  const validating = useRef(false);

  const detect = async (file: File | undefined) => {
    chosen.current = file;
    source.current = undefined;
    dispatch({ type: "detecting" });
    if (!file) {
      dispatch({ message: CHOOSE_EXPORT, type: "detected" });
      return;
    }
    if (!withinStagingLimit(file.size)) {
      dispatch({ message: TOO_LARGE, type: "detected" });
      return;
    }
    let text: string | undefined;
    try {
      text = await file.text();
    } catch {
      text = undefined;
    }
    if (chosen.current !== file) return;
    const recognized = text === undefined
      ? { message: "This file is not valid JSON." }
      : recognizeSource(text);
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
        message: "Choose a supported Monica JSON export first.",
        type: "validated",
      });
      return;
    }
    const result = await settle(() => createImportDryRun(owned, workspaceId));
    validating.current = false;
    if (source.current !== owned) {
      dispatch({
        message: "Source changed. Validate the selected export.",
        type: "validated",
      });
    } else if (result.status !== "ready" || !result.data) {
      dispatch({
        message: result.problem?.detail ?? "The import could not be validated.",
        type: "validated",
      });
    } else {
      dispatch({
        importId: result.data.importId,
        report: result.data.report,
        type: "dry-run",
      });
      dispatch({ type: "validated" });
    }
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
  return (
    <>
      <form
        className="import-form"
        data-import-form=""
        method="post"
        onSubmit={submit}
      >
        <label htmlFor="import-source">Monica JSON export</label>
        <input
          accept="application/json,.json"
          disabled={state.validating}
          id="import-source"
          name="source"
          onChange={choose}
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
      />
    ),
  );
}
