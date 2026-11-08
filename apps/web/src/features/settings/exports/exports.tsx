/**
 * The export page (GAP-033): creating a portable workspace export and
 * minting a short-lived download for a completed one.
 *
 * One read slot owns the history. Create export stays disabled until the
 * page knows its workspace (REL-041: an early click is never lost to a
 * control that looks ready), and while an export is being created. A
 * prepared download replaces its action with the link and takes focus.
 * The format choice (GAP-050) decides what the next export is; it is locked
 * while one is being created.
 */

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import {
  createExportDownload,
  createWorkspaceExport,
  type ExportSummary,
  listExports,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import { settle, useLatestRequest } from "../../../islands/core/index.ts";
import { formatInstant } from "../../../lib/time-presentation.ts";
import { mountSettingsSurface } from "../form/settings-form.tsx";
import { managesWorkspace, resolveSettingsContext } from "../shared/context.ts";
import {
  EXPORT_FORMATS,
  exportCompleted,
  exportHeading,
  exportsReducer,
  exportStatus,
  initialExports,
} from "./exports.ts";

export const EXPORTS_ISLAND = "settings-exports";

export function ExportsPage(props: { readonly onSettled?: () => void }) {
  const [state, dispatch] = useReducer(exportsReducer, initialExports);
  const request = useLatestRequest();
  const workspace = useRef<string | undefined>(undefined);
  const creating = useRef(false);
  const focusDownload = useRef<string | undefined>(undefined);
  const history = useRef<HTMLOListElement>(null);
  const settled = useRef(props.onSettled);

  const load = async () => {
    const workspaceId = workspace.current!;
    dispatch({ message: "Loading export history…", type: "status" });
    const answer = await request(() => listExports(workspaceId));
    if (!answer) return;
    if (answer.status !== "ready" || !answer.data) {
      dispatch({ type: "failed" });
      return;
    }
    dispatch({ exports: answer.data.exports, type: "loaded" });
  };

  const first = useEffectEvent(async () => {
    const context = await resolveSettingsContext({ timePreferences: true });
    if (!context) {
      dispatch({ type: "no-session" });
      return;
    }
    if (!managesWorkspace(context.role)) {
      dispatch({ type: "member" });
      return;
    }
    workspace.current = context.workspaceId;
    dispatch({
      timePreferences: context.timePreferences,
      type: "context",
    });
    await load();
  });
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  useLayoutEffect(() => {
    const exportId = focusDownload.current;
    if (!exportId || !state.downloads[exportId]) return;
    focusDownload.current = undefined;
    history.current?.querySelector<HTMLElement>(
      `[data-export-download="${exportId}"]`,
    )?.focus();
  }, [state.downloads]);

  const create = async () => {
    const workspaceId = workspace.current!;
    if (creating.current) return;
    creating.current = true;
    const format = state.format;
    dispatch({ creating: true, type: "creating" });
    const result = await settle(() =>
      createWorkspaceExport(
        workspaceId,
        format === "json" ? undefined : format,
      )
    );
    if (result.status === "ready" && result.data) {
      await load();
      dispatch({
        message: exportCompleted(result.data.manifest.rows.people.count),
        type: "status",
      });
    } else {
      dispatch({
        message: result.problem?.detail ?? "The export could not be completed.",
        type: "status",
      });
    }
    creating.current = false;
    dispatch({ creating: false, type: "creating" });
  };

  const prepare = async (run: ExportSummary) => {
    const workspaceId = workspace.current!;
    if (state.preparing.includes(run.exportId)) return;
    dispatch({ exportId: run.exportId, type: "preparing" });
    const result = await settle(() =>
      createExportDownload(run.exportId, workspaceId)
    );
    if (result.status !== "ready" || !result.data) {
      dispatch({
        exportId: run.exportId,
        message: result.problem?.detail ?? "A download could not be prepared.",
        type: "prepared",
      });
      return;
    }
    focusDownload.current = run.exportId;
    dispatch({
      exportId: run.exportId,
      href: result.data.href,
      message: `Download ready until ${
        formatInstant(result.data.expiresAt, state.timePreferences)
      }.`,
      type: "prepared",
    });
  };

  const stateLine = (
    <p
      aria-live="polite"
      className="section-state"
      data-export-state=""
      role="status"
    >
      {state.status}
    </p>
  );
  if (state.phase === "member") return stateLine;
  return (
    <>
      <header className="settings-heading">
        <div>
          <p className="eyebrow">Data settings</p>
          <h1>Export</h1>
          <p>
            Portable person data with versioned checksums and short-lived
            downloads.
          </p>
        </div>
        <button
          className={buttonVariants()}
          data-export-create=""
          disabled={state.phase !== "ready" || state.creating}
          onClick={() => void create()}
          type="button"
        >
          Create export
        </button>
      </header>
      <fieldset className="export-formats" data-export-formats="">
        <legend>Format</legend>
        {EXPORT_FORMATS.map((option) => (
          <div className="export-format" key={option.id}>
            <label>
              <input
                aria-describedby={`export-format-${option.id}-hint`}
                checked={state.format === option.id}
                disabled={state.creating}
                name="exportFormat"
                onChange={() =>
                  dispatch({ format: option.id, type: "format" })}
                type="radio"
                value={option.id}
              />{" "}
              {option.label}
            </label>
            <span className="field-hint" id={`export-format-${option.id}-hint`}>
              {option.description}
            </span>
          </div>
        ))}
      </fieldset>
      {stateLine}
      <button
        className={buttonVariants({ variant: "outline" })}
        data-export-retry=""
        hidden={!state.retry}
        onClick={() => void load()}
        type="button"
      >
        Retry
      </button>
      <section aria-labelledby="export-history-heading">
        <h2 id="export-history-heading">Export history</h2>
        <ol
          aria-label="Export history"
          className="import-history"
          data-export-history=""
          ref={history}
        >
          {state.exports?.map((run) => {
            const href = state.downloads[run.exportId];
            return (
              <li data-export-format={run.format} key={run.exportId}>
                <strong>{exportHeading(run)}</strong>
                <span>
                  {exportStatus(run)} ·{" "}
                  {formatInstant(run.createdAt, state.timePreferences)}
                </span>
                {run.status !== "completed" ? null : href
                  ? (
                    <a
                      className={buttonVariants({
                        className: "mt-(--space-4)",
                        shape: "pill",
                      })}
                      data-export-download={run.exportId}
                      download=""
                      href={href}
                    >
                      Download export
                    </a>
                  )
                  : (
                    <button
                      className={buttonVariants({ variant: "outline" })}
                      disabled={state.preparing.includes(run.exportId)}
                      onClick={() => void prepare(run)}
                      type="button"
                    >
                      Prepare download
                    </button>
                  )}
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}

/** Mounts the page over the region `export.astro` drew. */
export function mountExports(root: ParentNode = document): Promise<() => void> {
  return mountSettingsSurface(
    root,
    "[data-export-surface]",
    EXPORTS_ISLAND,
    (onSettled) => <ExportsPage onSettled={onSettled} />,
  );
}
