/**
 * The API access page (GAP-033): creating a scoped personal API token,
 * showing its secret once, and revoking tokens.
 *
 * One read slot owns the list. Token changes run one at a time: while one
 * runs, every token control is disabled, and it settles only after the list
 * has been read again. The form is wired from its first render; a token
 * requested before the page is ready is held, never submitted natively
 * (REL-041), and created once it is.
 */

import { useEffect, useEffectEvent, useReducer, useRef } from "react";
import {
  type ApiResult,
  createApiToken,
  getApiTokens,
  revokeApiToken,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import { settle, useLatestRequest } from "../../../islands/core/index.ts";
import { loadTimePreferences } from "../../../lib/time-presentation.ts";
import { mountSettingsSurface } from "../form/settings-form.tsx";
import { managesWorkspace, resolveSettingsContext } from "../shared/context.ts";
import { useHeldSubmit } from "../shared/hooks.ts";
import {
  API_TOKEN_SCOPE_CHOICES,
  apiAccessReducer,
  initialApiAccess,
  recordActivity,
  recordScope,
} from "./api-access.ts";

export const API_ACCESS_ISLAND = "settings-api-access";

export function ApiAccess(props: { readonly onSettled?: () => void }) {
  const [state, dispatch] = useReducer(apiAccessReducer, initialApiAccess);
  const request = useLatestRequest();
  const workspace = useRef<string | undefined>(undefined);
  const busy = useRef(false);
  const settled = useRef(props.onSettled);

  const load = async () => {
    const workspaceId = workspace.current!;
    dispatch({ message: "Loading API tokens…", type: "status" });
    const answer = await request(() => getApiTokens(workspaceId));
    if (!answer) return;
    if (answer.status !== "ready" || !answer.data) {
      dispatch({
        message: answer.problem?.detail ?? "API tokens could not be loaded.",
        type: "status",
      });
      return;
    }
    dispatch({
      records: answer.data.records,
      scopes: answer.data.scopes,
      type: "loaded",
    });
  };

  const first = useEffectEvent(async () => {
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

  /** Runs one token change; the controls stay held until the list is read. */
  const change = async <T,>(
    message: string,
    call: (workspaceId: string) => Promise<ApiResult<T>>,
    landed: (value: T) => string | undefined,
    failed: string,
  ) => {
    const workspaceId = workspace.current!;
    if (busy.current) return;
    busy.current = true;
    dispatch({ busy: true, message, type: "busy" });
    const result = await settle(() => call(workspaceId));
    if (result.status === "ready") {
      const said = landed(result.data as T);
      if (said) dispatch({ message: said, type: "status" });
      await load();
    } else {
      dispatch({ message: result.problem?.detail ?? failed, type: "status" });
    }
    busy.current = false;
    dispatch({ busy: false, type: "busy" });
  };

  const create = (form: HTMLFormElement) => {
    if (busy.current) return;
    const data = new FormData(form);
    const name = data.get("name")?.toString().trim();
    const expires = data.get("expiresAt")?.toString();
    const selected = data.getAll("scopes");
    const scopes = (state.scopes ?? []).filter((scope) =>
      selected.includes(scope)
    );
    if (!name || scopes.length === 0) {
      dispatch({
        message: "Enter a name and at least one scope.",
        type: "status",
      });
      return;
    }
    void change(
      "Creating API token…",
      (workspaceId) =>
        createApiToken({
          ...(expires ? { expiresAt: new Date(expires).toISOString() } : {}),
          name,
          scopes,
        }, workspaceId),
      (created) => {
        dispatch({ secret: created.secret, type: "created" });
        form.reset();
        return undefined;
      },
      "API token could not be created.",
    );
  };
  const submit = useHeldSubmit(
    state.phase === "ready" && state.scopes !== undefined,
    create,
  );

  const revoke = (id: string) =>
    void change(
      "Revoking API token…",
      (workspaceId) => revokeApiToken(id, workspaceId),
      () => "API token revoked.",
      "API token could not be revoked.",
    );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.secret ?? "");
      dispatch({ message: "API token copied.", type: "status" });
    } catch {
      dispatch({
        message:
          "Copy failed. Select the one-time secret and copy it manually.",
        type: "status",
      });
    }
  };

  const records = state.records ?? [];
  return (
    <>
      <p
        aria-live="polite"
        className="api-access-state"
        data-api-state=""
        role="status"
      >
        {state.status}
      </p>

      <section
        aria-labelledby="create-token-heading"
        className="api-access-section"
      >
        <header>
          <p className="scope-label">Personal credential</p>
          <h2 id="create-token-heading">Create API token</h2>
        </header>
        {state.phase === "member" ? null : (
          <form
            className="api-token-form"
            data-api-create=""
            method="post"
            noValidate
            onSubmit={submit}
          >
            <label>
              Token name<input
                autoComplete="off"
                maxLength={100}
                name="name"
                required
                type="text"
              />
            </label>
            <label>
              Expiry <span className="optional-label">Optional</span>
              <input name="expiresAt" type="datetime-local" />
            </label>
            <fieldset>
              <legend>Scopes</legend>
              <p>
                Grants are independent. For full task automation, select Read
                tasks, Create tasks, and Edit and complete tasks.
              </p>
              {API_TOKEN_SCOPE_CHOICES.filter(({ scope }) =>
                state.scopes?.includes(scope) ?? true
              ).map(({ scope, label, detail }) => (
                <label className="scope-choice" key={scope}>
                  <input
                    aria-label={label}
                    aria-describedby={`scope-${scope}-detail`}
                    disabled={state.busy}
                    name="scopes"
                    type="checkbox"
                    value={scope}
                  />
                  <span>
                    {label}
                    <small id={`scope-${scope}-detail`}>{detail}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <button
              disabled={state.busy || state.scopes === undefined}
              type="submit"
            >
              Create token
            </button>
          </form>
        )}
      </section>

      <section
        aria-labelledby="api-secret-heading"
        className="api-secret-panel"
        data-api-secret-panel=""
        hidden={state.secret === undefined}
      >
        <header>
          <p className="scope-label">Shown once</p>
          <h2 id="api-secret-heading">Copy your token now</h2>
        </header>
        <p>
          This secret cannot be shown again after you leave or dismiss this
          view.
        </p>
        <div className="api-secret-control">
          <input
            aria-label="New API token secret"
            data-api-secret=""
            readOnly
            value={state.secret ?? ""}
          />
          <button data-api-copy="" onClick={() => void copy()} type="button">
            Copy
          </button>
        </div>
        <button
          className={buttonVariants({ variant: "outline" })}
          data-api-dismiss=""
          onClick={() => dispatch({ type: "dismissed" })}
          type="button"
        >
          I have saved it
        </button>
      </section>

      <section
        aria-labelledby="api-token-list-heading"
        className="api-access-section"
      >
        <header>
          <p className="scope-label">Workspace-bound</p>
          <h2 id="api-token-list-heading">Personal API tokens</h2>
        </header>
        <p
          data-api-empty=""
          hidden={state.records === undefined || records.length > 0}
        >
          No API tokens yet.
        </p>
        <ul
          aria-label="Personal API tokens"
          className="api-token-list"
          data-api-list=""
        >
          {records.map((record) => (
            <li key={record.id}>
              <div>
                <strong>{record.name}</strong>
                <span>{recordScope(record, state.timePreferences)}</span>
                <small>{recordActivity(record, state.timePreferences)}</small>
              </div>
              <button
                disabled={Boolean(record.revokedAt) || state.busy}
                onClick={() => revoke(record.id)}
                type="button"
              >
                {record.revokedAt ? "Revoked" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** Mounts the page over the region `api.astro` drew. */
export function mountApiAccess(
  root: ParentNode = document,
): Promise<() => void> {
  return mountSettingsSurface(
    root,
    "[data-api-surface]",
    API_ACCESS_ISLAND,
    (onSettled) => <ApiAccess onSettled={onSettled} />,
  );
}
