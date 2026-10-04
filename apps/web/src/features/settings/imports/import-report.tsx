/**
 * An import's report (GAP-033): the counts and diagnostics a dry run or a
 * committed import produced, drawn by the new-import page after its dry run
 * and, as its own island, by the import report page, which reads the import
 * its URL names.
 */

import { useEffect, useEffectEvent, useReducer, useRef } from "react";
import {
  getImportReport,
  type ImportReport,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import { useLatestRequest } from "../../../islands/core/index.ts";
import { mountSettingsSurface } from "../form/settings-form.tsx";
import { managesWorkspace, resolveSettingsContext } from "../shared/context.ts";
import {
  importHref,
  reportImportId,
  reportReducer,
  reportStatus,
} from "./imports.ts";

export const IMPORT_REPORT_ISLAND = "settings-import-report";

/** The report's counts and diagnostics. */
export function ReportCounts(props: { readonly report: ImportReport }) {
  const { counts, diagnostics } = props.report;
  return (
    <>
      <dl className="import-counts">
        <div>
          <dt>Contacts</dt>
          <dd data-import-contacts="">{counts.contacts}</dd>
        </div>
        <div>
          <dt>Orphans</dt>
          <dd data-import-orphans="">{counts.orphans}</dd>
        </div>
        <div>
          <dt>Missing files</dt>
          <dd data-import-missing="">{counts.missingFiles}</dd>
        </div>
        <div>
          <dt>Legacy identities discarded</dt>
          <dd data-import-credentials="">
            {counts.legacyCredentialsDiscarded}
          </dd>
        </div>
        <div>
          <dt>Unsupported records</dt>
          <dd data-import-unsupported="">{counts.unsupported}</dd>
        </div>
      </dl>
      <ul className="import-diagnostics" data-import-diagnostics="">
        {diagnostics.map((diagnostic, index) => (
          <li data-severity={diagnostic.severity} key={index}>
            {diagnostic.message}
          </li>
        ))}
      </ul>
    </>
  );
}

export function ImportReportPage(
  props: { readonly pathname?: string; readonly onSettled?: () => void },
) {
  const [state, dispatch] = useReducer(reportReducer, {
    outcome: "",
    report: undefined,
    retry: false,
    status: "Loading import report…",
  });
  const request = useLatestRequest();
  const workspace = useRef<string | undefined>(undefined);
  const settled = useRef(props.onSettled);
  const importId = reportImportId(
    props.pathname ?? globalThis.location.pathname,
  );

  const load = async () => {
    const workspaceId = workspace.current!;
    if (!importId) return;
    const answer = await request(() => getImportReport(importId, workspaceId));
    if (!answer) return;
    if (answer.status !== "ready" || !answer.data) {
      dispatch({
        message: answer.problem?.status === 404
          ? "This import does not exist in the active workspace."
          : "The import report could not be loaded.",
        type: "failed",
      });
      return;
    }
    dispatch({
      outcome: reportStatus(answer.data.status),
      report: answer.data.report,
      ...(answer.data.status === "pending"
        ? { resume: importHref(answer.data) }
        : {}),
      type: "loaded",
    });
  };

  const first = useEffectEvent(async () => {
    const context = await resolveSettingsContext();
    if (!context) {
      dispatch({
        message: "Your session could not be confirmed.",
        type: "status",
      });
      return;
    }
    if (!managesWorkspace(context.role)) {
      dispatch({
        message: "Workspace import requires owner or administrator access.",
        type: "status",
      });
      return;
    }
    if (!importId) {
      dispatch({
        message: "This import report is unavailable.",
        type: "status",
      });
      return;
    }
    workspace.current = context.workspaceId;
    await load();
  });
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  return (
    <>
      <p
        aria-live="polite"
        className="section-state"
        data-import-state=""
        role="status"
      >
        {state.status}
      </p>
      <button
        className={buttonVariants({ variant: "outline" })}
        data-import-retry=""
        hidden={!state.retry}
        onClick={() => void load()}
        type="button"
      >
        Retry
      </button>
      <section
        aria-labelledby="import-report-heading"
        data-import-report=""
        hidden={!state.report}
      >
        <h2 id="import-report-heading">Summary</h2>
        <p data-import-status="">{state.outcome}</p>
        {state.resume
          ? (
            <a
              className={buttonVariants({ shape: "pill", variant: "outline" })}
              data-import-resume=""
              href={state.resume}
            >
              Continue column mapping
            </a>
          )
          : null}
        {state.report ? <ReportCounts report={state.report} /> : null}
      </section>
    </>
  );
}

/** Mounts the report over the region `import-report-shell.astro` drew. */
export function mountImportReport(
  root: ParentNode = document,
  pathname?: string,
): Promise<() => void> {
  return mountSettingsSurface(
    root,
    "[data-import-report-surface]",
    IMPORT_REPORT_ISLAND,
    (onSettled) => (
      <ImportReportPage
        onSettled={onSettled}
        {...(pathname ? { pathname } : {})}
      />
    ),
  );
}
