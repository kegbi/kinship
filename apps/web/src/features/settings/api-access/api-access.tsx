/**
 * The API access page (GAP-033): creating a scoped personal API token,
 * showing its secret once, and revoking tokens. Owners and administrators see
 * and revoke every token of the workspace, each named by who created it
 * (SECT-07).
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
import { Badge } from "@/components/ui/badge.tsx";
import { buttonVariants } from "@/components/ui/variants.ts";
import { settle, useLatestRequest } from "../../../islands/core/index.ts";
import { mountSettingsSurface } from "../form/settings-form.tsx";
import { managesWorkspace, resolveSettingsContext } from "../shared/context.ts";
import { useHeldSubmit } from "../shared/hooks.ts";
import {
  ACCESS_TEXT,
  type AgentConfigurations,
  agentConfigurations,
  apiAccessReducer,
  cautionText,
  configurationBlocks,
  initialApiAccess,
  mcpEndpoint,
  recordActivity,
  recordIssuer,
  recordScope,
  SCOPE_PRESETS,
  type ScopeChoice,
  scopeGroups,
  type ScopePreset,
  TOKEN_PLACEHOLDER,
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

  const copy = async (
    text: string,
    copied: string,
    failed = "Copy failed. Select the text and copy it manually.",
  ) => {
    try {
      await navigator.clipboard.writeText(text);
      dispatch({ message: copied, type: "status" });
    } catch {
      dispatch({ message: failed, type: "status" });
    }
  };

  /** Ticks exactly the preset's offered grants; every box stays adjustable. */
  const apply = (preset: ScopePreset, form: HTMLFormElement | null) => {
    form?.querySelectorAll<HTMLInputElement>('input[name="scopes"]').forEach(
      (input) => {
        input.checked = (preset.scopes as readonly string[]).includes(
          input.value,
        );
      },
    );
    dispatch({
      message: `${preset.label} grants selected. Adjust them before creating.`,
      type: "status",
    });
  };

  const endpoint = mcpEndpoint(globalThis.location.origin);
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
            <fieldset className="scope-picker">
              <legend>Scopes</legend>
              <p>
                Grants are independent: none implies another, and a write grant
                does not include reading. For full task automation, select Read
                tasks, Create tasks, and Edit and complete tasks.
              </p>
              <div className="scope-presets">
                {SCOPE_PRESETS.map((preset) => (
                  <div key={preset.id}>
                    <button
                      aria-describedby={`preset-${preset.id}-detail`}
                      className={buttonVariants({ variant: "outline" })}
                      disabled={state.busy}
                      onClick={(event) =>
                        apply(preset, event.currentTarget.form)}
                      type="button"
                    >
                      {preset.label}
                    </button>
                    <small id={`preset-${preset.id}-detail`}>
                      {preset.detail}
                    </small>
                  </div>
                ))}
              </div>
              {scopeGroups(state.scopes).map((group) => (
                <fieldset className="scope-group" key={group.id}>
                  <legend>{group.title}</legend>
                  {group.choices.map((choice) => (
                    <ScopeCheckbox
                      choice={choice}
                      disabled={state.busy}
                      key={choice.scope}
                    />
                  ))}
                </fieldset>
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
          <button
            data-api-copy=""
            onClick={() =>
              void copy(
                state.secret ?? "",
                "API token copied.",
                "Copy failed. Select the one-time secret and copy it manually.",
              )}
            type="button"
          >
            Copy
          </button>
        </div>
        {state.secret === undefined ? null : (
          <AgentConfiguration
            configurations={agentConfigurations(endpoint, state.secret)}
            copy={copy}
            suffix=" with your new token"
          />
        )}
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
        aria-labelledby="connect-agent-heading"
        className="api-access-section"
        data-api-connect=""
      >
        <header>
          <p className="scope-label">Model Context Protocol</p>
          <h2 id="connect-agent-heading">Connect an AI agent</h2>
        </header>
        <p>
          An AI agent connects to this workspace's MCP endpoint with a personal
          API token and sees only the tools its scopes allow. The agent can do
          whatever the token's scopes allow in this workspace, with the role of
          the member who created the token. Revoking the token cuts the agent
          off.
        </p>
        <div className="api-secret-control">
          <input
            aria-label="MCP endpoint URL"
            data-api-endpoint=""
            readOnly
            value={endpoint}
          />
          <button
            onClick={() => void copy(endpoint, "MCP endpoint URL copied.")}
            type="button"
          >
            Copy endpoint URL
          </button>
        </div>
        <AgentConfiguration
          configurations={agentConfigurations(endpoint)}
          copy={copy}
          suffix=""
        />
        <p>
          Replace <code>{TOKEN_PLACEHOLDER}</code>{" "}
          with a token's secret, or copy the filled-in configuration while a new
          token is shown. Each operation and the grant it needs is listed in the
          {" "}
          <a href="/docs/api">API reference</a>.
        </p>
      </section>

      <section
        aria-labelledby="api-token-list-heading"
        className="api-access-section"
      >
        <header>
          <p className="scope-label">Workspace-bound</p>
          <h2 id="api-token-list-heading">Workspace API tokens</h2>
        </header>
        <p>
          Every personal API token in this workspace, whoever created it. Revoke
          any you do not recognize.
        </p>
        <p
          data-api-empty=""
          hidden={state.records === undefined || records.length > 0}
        >
          No API tokens yet.
        </p>
        <ul
          aria-label="Workspace API tokens"
          className="api-token-list"
          data-api-list=""
        >
          {records.map((record) => (
            <li key={record.id}>
              <div>
                <strong>{record.name}</strong>
                <span>{recordIssuer(record)}</span>
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

/** One grant: a real checkbox named by its label, described by its marks. */
function ScopeCheckbox(
  props: { readonly choice: ScopeChoice; readonly disabled: boolean },
) {
  const { access, caution, detail, label, scope } = props.choice;
  const id = `scope-${scope}`;
  return (
    <label className="scope-choice" data-scope-access={access}>
      <input
        aria-describedby={[
          `${id}-access`,
          ...(caution ? [`${id}-caution`] : []),
          `${id}-detail`,
        ].join(" ")}
        aria-label={label}
        disabled={props.disabled}
        name="scopes"
        type="checkbox"
        value={scope}
      />
      <span>
        <span className="scope-choice-title">
          {label}
          <Badge
            id={`${id}-access`}
            variant={access === "read" ? "secondary" : "warning"}
          >
            {ACCESS_TEXT[access]}
          </Badge>
          {caution
            ? (
              <Badge
                className={caution === "destructive"
                  ? "bg-(--danger-soft) text-(--danger-strong)"
                  : undefined}
                id={`${id}-caution`}
              >
                {cautionText(caution)}
              </Badge>
            )
            : null}
        </span>
        <small id={`${id}-detail`}>{detail}</small>
      </span>
    </label>
  );
}

/** Ready-to-paste client configuration, each block with its own copy button. */
function AgentConfiguration(props: {
  readonly configurations: AgentConfigurations;
  readonly copy: (text: string, copied: string) => Promise<void>;
  readonly suffix: string;
}) {
  const { configurations, copy, suffix } = props;
  return (
    <div className="agent-configuration">
      {configurationBlocks(configurations).map(({ heading, name, text }) => (
        <div key={name}>
          <h3>{heading}</h3>
          {/* A named, focusable scroll region lets keyboard users read long lines. */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard access to the named scrollable code region. */}
          <pre aria-label={`${name}${suffix}`} role="region" tabIndex={0}>
            <code>{text}</code>
          </pre>
          <button
            className={buttonVariants({ variant: "outline" })}
            onClick={() =>
              void copy(text, `${name} copied.`)}
            type="button"
          >
            {`Copy ${name}${suffix}`}
          </button>
        </div>
      ))}
    </div>
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
