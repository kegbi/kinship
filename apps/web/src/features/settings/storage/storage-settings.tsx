/**
 * The storage settings page (GAP-033): workspace file usage, limits, object
 * state, provider health, and a bounded metadata lookup.
 *
 * One read slot owns the diagnostics, so a lookup replaces an earlier read
 * and only the latest answer lands. The lookup form is wired from its first
 * render; a lookup submitted before the first read has landed is held, never
 * submitted natively (REL-041), and run once it has, so the first read does
 * not supersede it.
 */

import { useEffect, useEffectEvent, useReducer, useRef } from "react";
import { getStorageSettings } from "../../../../../../packages/contracts/generated/auth-client.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import { useLatestRequest } from "../../../islands/core/index.ts";
import { mountSettingsSurface } from "../form/settings-form.tsx";
import { managesWorkspace, resolveSettingsContext } from "../shared/context.ts";
import { useHeldSubmit } from "../shared/hooks.ts";
import {
  fileDetails,
  formatBytes,
  initialStorage,
  providerHealth,
  storageReducer,
} from "./storage-settings.ts";

export const STORAGE_SETTINGS_ISLAND = "settings-storage";

export function StorageSettingsPage(
  props: { readonly onSettled?: () => void },
) {
  const [state, dispatch] = useReducer(storageReducer, initialStorage);
  const request = useLatestRequest();
  const workspace = useRef<string | undefined>(undefined);
  const settled = useRef(props.onSettled);

  const load = async (query?: string) => {
    const workspaceId = workspace.current!;
    dispatch({ query, type: "loading" });
    const answer = await request(() => getStorageSettings(query, workspaceId));
    if (!answer) return;
    if (answer.status === "ready" && answer.data) {
      dispatch({ settings: answer.data, type: "loaded" });
    } else if (answer.problem?.status === 403) {
      dispatch({ type: "forbidden" });
    } else dispatch({ type: "failed" });
  };

  const start = async () => {
    const context = await resolveSettingsContext();
    if (!context) {
      dispatch({ type: "no-session" });
      return;
    }
    if (!managesWorkspace(context.role)) {
      dispatch({ type: "forbidden" });
      return;
    }
    workspace.current = context.workspaceId;
    await load();
  };
  const first = useEffectEvent(start);
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  const search = (form: HTMLFormElement) => {
    const query = new FormData(form).get("query")?.toString().trim();
    if (!query) {
      dispatch({
        message: "Enter a file ID, filename, title, or person name.",
        type: "search-status",
      });
      return;
    }
    void load(query);
  };
  const submit = useHeldSubmit(state.phase === "ready", search);

  const retry = () => {
    if (state.phase === "no-session") void start();
    else void load(state.query);
  };

  const { settings } = state;
  const usage = settings?.usage;
  return (
    <>
      <p
        aria-live="polite"
        className="storage-page-state"
        data-storage-state=""
        role="status"
      >
        {state.status}
      </p>
      <button
        className={buttonVariants({ variant: "outline" })}
        data-storage-retry=""
        hidden={!state.retry}
        onClick={retry}
        type="button"
      >
        Retry
      </button>

      <div className="storage-settings-sections">
        <section
          aria-labelledby="storage-usage-heading"
          className="storage-settings-section"
          id="usage-and-limits"
        >
          <header>
            <p className="scope-label">Usage and limits</p>
            <h2 id="storage-usage-heading">Workspace usage</h2>
          </header>
          <dl className="storage-metrics">
            <Metric hook="data-storage-total-files" term="Files">
              {usage ? String(usage.totalFiles) : ""}
            </Metric>
            <Metric hook="data-storage-total-bytes" term="Stored bytes">
              {usage ? formatBytes(usage.totalBytes) : ""}
            </Metric>
            <Metric hook="data-storage-limit" term="Maximum upload">
              {settings ? formatBytes(settings.maximumUploadBytes) : ""}
            </Metric>
          </dl>
        </section>

        <section
          aria-labelledby="object-state-heading"
          className="storage-settings-section"
          id="object-state"
        >
          <header>
            <p className="scope-label">Object state</p>
            <h2 id="object-state-heading">Provider and metadata</h2>
          </header>
          <dl className="storage-object-state">
            <Metric hook="data-storage-available" term="Available">
              {usage ? String(usage.available) : ""}
            </Metric>
            <Metric hook="data-storage-missing" term="Missing">
              {usage ? String(usage.missing) : ""}
            </Metric>
            <Metric hook="data-storage-processing" term="Processing">
              {usage ? String(usage.processing) : ""}
            </Metric>
            <Metric hook="data-storage-quarantined" term="Quarantined">
              {usage ? String(usage.quarantined) : ""}
            </Metric>
            <Metric hook="data-storage-provider" term="Provider">
              {settings?.provider.name ?? ""}
            </Metric>
            <Metric hook="data-storage-bucket" term="Bucket">
              {settings?.provider.bucket ?? ""}
            </Metric>
            <Metric hook="data-storage-health" term="Provider health">
              {settings ? providerHealth(settings.provider.health) : ""}
            </Metric>
          </dl>
        </section>

        <section
          aria-labelledby="file-lookup-heading"
          className="storage-settings-section"
          id="file-lookup"
        >
          <header>
            <p className="scope-label">File lookup</p>
            <h2 id="file-lookup-heading">Metadata lookup</h2>
          </header>
          {state.phase === "forbidden" ? null : (
            <form
              className="storage-search-form"
              data-storage-search=""
              method="post"
              onSubmit={submit}
            >
              <label htmlFor="storage-query">
                File ID, filename, title, or person
              </label>
              <div>
                <input
                  autoComplete="off"
                  id="storage-query"
                  maxLength={100}
                  name="query"
                  required
                  type="search"
                />
                <button type="submit">Search</button>
              </div>
            </form>
          )}
          <p
            aria-live="polite"
            className="section-state"
            data-storage-search-state=""
            role="status"
          >
            {state.searchStatus}
          </p>
          <ul
            aria-label="File metadata results"
            className="storage-results"
            data-storage-results=""
          >
            {settings?.files.map((file) => (
              <li key={file.fileId}>
                <strong>{file.title}</strong>
                <span>{file.filename}</span>
                <small>{fileDetails(file)}</small>
                <code>{file.fileId}</code>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function Metric(
  props: {
    readonly term: string;
    readonly hook: string;
    readonly children: string;
  },
) {
  return (
    <div>
      <dt>{props.term}</dt>
      <dd {...{ [props.hook]: "" }}>{props.children}</dd>
    </div>
  );
}

/** Mounts the page over the region `storage.astro` drew. */
export function mountStorageSettings(
  root: ParentNode = document,
): Promise<() => void> {
  return mountSettingsSurface(
    root,
    "[data-storage-surface]",
    STORAGE_SETTINGS_ISLAND,
    (onSettled) => <StorageSettingsPage onSettled={onSettled} />,
  );
}
