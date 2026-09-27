/**
 * The import history page (GAP-033): each Monica import the workspace has
 * validated or committed, with its report one link away, so a dry run left
 * awaiting confirmation can be resumed. One read slot owns the list.
 */

import { useEffect, useEffectEvent, useReducer, useRef } from "react";
import { listImports } from "../../../../../../packages/contracts/generated/auth-client.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import { useLatestRequest } from "../../../islands/core/index.ts";
import {
  formatInstant,
  loadTimePreferences,
} from "../../../lib/time-presentation.ts";
import { mountSettingsSurface } from "../form/settings-form.tsx";
import { managesWorkspace, resolveSettingsContext } from "../shared/context.ts";
import { historyReducer, importHeading, importStatus } from "./imports.ts";

export const IMPORT_HISTORY_ISLAND = "settings-import-history";

export function ImportHistory(props: { readonly onSettled?: () => void }) {
  const [state, dispatch] = useReducer(historyReducer, {
    imports: undefined,
    member: false,
    retry: false,
    status: "Loading import history…",
    timePreferences: undefined,
  });
  const request = useLatestRequest();
  const workspace = useRef<string | undefined>(undefined);
  const settled = useRef(props.onSettled);

  const load = async () => {
    const workspaceId = workspace.current!;
    dispatch({ message: "Loading import history…", type: "status" });
    const answer = await request(() => listImports(workspaceId));
    if (!answer) return;
    if (answer.status !== "ready" || !answer.data) {
      dispatch({ type: "failed" });
      return;
    }
    dispatch({ imports: answer.data.imports, type: "loaded" });
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
      dispatch({ type: "member" });
      return;
    }
    workspace.current = context.workspaceId;
    dispatch({
      timePreferences: await loadTimePreferences(context.workspaceId),
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
  if (state.member) return stateLine;
  return (
    <>
      {stateLine}
      <button
        className={buttonVariants({ variant: "outline" })}
        data-import-retry=""
        hidden={!state.retry}
        onClick={() => void load()}
        type="button"
      >
        Retry
      </button>
      <ol
        aria-label="Import history"
        className="import-history"
        data-import-history=""
      >
        {state.imports?.map((run) => (
          <li key={run.importId}>
            <a href={`/app/settings/import/${run.importId}`}>
              {importHeading(run)}
            </a>
            <span>
              {importStatus(run.status)} ·{" "}
              {formatInstant(run.createdAt, state.timePreferences)}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

/** Mounts the history over the region `import/index.astro` drew. */
export function mountImportHistory(
  root: ParentNode = document,
): Promise<() => void> {
  return mountSettingsSurface(
    root,
    "[data-import-history-surface]",
    IMPORT_HISTORY_ISLAND,
    (onSettled) => <ImportHistory onSettled={onSettled} />,
  );
}
