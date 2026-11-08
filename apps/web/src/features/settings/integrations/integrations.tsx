/**
 * The DAV integrations page (GAP-033): adding a CardDAV or CalDAV
 * collection, and synchronizing or disabling each connection.
 *
 * One read slot owns the list. DAV operations run one at a time: while one
 * runs, every DAV control is disabled, and it settles only after the list it
 * changed has been read again. The form is wired from its first render; a
 * connection added before the page is ready is held, never submitted
 * natively (REL-041), and added once it is. The secret never reaches the
 * page after it is sent.
 */

import { useEffect, useEffectEvent, useReducer, useRef } from "react";
import {
  type ApiResult,
  createDavSubscription,
  type DavSubscription,
  disableDavSubscription,
  getDavSubscriptions,
  synchronizeDavSubscription,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import { settle, useLatestRequest } from "../../../islands/core/index.ts";
import { mountSettingsSurface } from "../form/settings-form.tsx";
import { managesWorkspace, resolveSettingsContext } from "../shared/context.ts";
import { useHeldSubmit } from "../shared/hooks.ts";
import {
  initialIntegrations,
  integrationsReducer,
  needsRetry,
  subscriptionStatus,
} from "./integrations.ts";

export const INTEGRATIONS_ISLAND = "settings-integrations";

export function Integrations(props: { readonly onSettled?: () => void }) {
  const [state, dispatch] = useReducer(
    integrationsReducer,
    initialIntegrations,
  );
  const request = useLatestRequest();
  const workspace = useRef<string | undefined>(undefined);
  const busy = useRef(false);
  const settled = useRef(props.onSettled);

  const load = async () => {
    const workspaceId = workspace.current!;
    const answer = await request(() => getDavSubscriptions(workspaceId));
    if (!answer) return;
    if (answer.status !== "ready" || !answer.data) {
      dispatch({
        message: answer.problem?.detail ?? "Integrations could not be loaded.",
        type: "status",
      });
      return;
    }
    dispatch({ subscriptions: answer.data.subscriptions, type: "loaded" });
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

  /** Runs one DAV operation; the controls stay held until the list is read. */
  const operate = async (
    message: string,
    call: (workspaceId: string) => Promise<ApiResult<unknown>>,
    outcome: { readonly done: string; readonly failed: string },
    onDone?: () => void,
  ) => {
    const workspaceId = workspace.current!;
    if (busy.current) return;
    busy.current = true;
    dispatch({ busy: true, message, type: "busy" });
    const result = await settle(() => call(workspaceId));
    if (result.status === "ready") {
      dispatch({ message: outcome.done, type: "status" });
      onDone?.();
      await load();
    } else {
      dispatch({
        message: result.problem?.detail ?? outcome.failed,
        type: "status",
      });
    }
    busy.current = false;
    dispatch({ busy: false, type: "busy" });
  };

  const add = (form: HTMLFormElement) => {
    if (busy.current) return;
    const data = new FormData(form);
    const name = data.get("name")?.toString().trim();
    const remoteUrl = data.get("remoteUrl")?.toString().trim();
    const username = data.get("username")?.toString().trim();
    const password = data.get("password")?.toString();
    if (!name || !remoteUrl || !password) {
      dispatch({
        message: "Enter a name, public HTTPS DAV URL, and secret.",
        type: "status",
      });
      return;
    }
    void operate(
      "Adding DAV connection…",
      (workspaceId) =>
        createDavSubscription(
          { name, password, remoteUrl, ...(username ? { username } : {}) },
          workspaceId,
        ),
      {
        done: "DAV connection added.",
        failed: "The DAV connection could not be added.",
      },
      () => form.reset(),
    );
  };
  const submit = useHeldSubmit(state.phase === "ready", add);

  const synchronize = (subscription: DavSubscription) =>
    void operate(
      "Synchronizing DAV…",
      (workspaceId) => synchronizeDavSubscription(subscription.id, workspaceId),
      {
        done: "DAV synchronization finished.",
        failed: "The DAV operation could not finish.",
      },
    );
  const disable = (subscription: DavSubscription) =>
    void operate(
      "Disabling DAV…",
      (workspaceId) => disableDavSubscription(subscription.id, workspaceId),
      {
        done: "DAV connection disabled.",
        failed: "The DAV operation could not finish.",
      },
    );

  const subscriptions = state.subscriptions ?? [];
  const managing = state.phase !== "member";
  return (
    <>
      <p
        aria-live="polite"
        className="api-access-state"
        data-integration-state=""
        role="status"
      >
        {state.status}
      </p>

      <section
        aria-labelledby="configure-dav-heading"
        className="api-access-section"
      >
        <header>
          <p className="scope-label">Workspace connection</p>
          <h2 id="configure-dav-heading">Add DAV collection</h2>
        </header>
        {managing
          ? (
            <form
              className="api-token-form"
              data-integration-create=""
              method="post"
              noValidate
              onSubmit={submit}
            >
              <label>
                Connection name<input
                  maxLength={100}
                  name="name"
                  required
                  type="text"
                />
              </label>
              <label>
                DAV collection URL<input
                  inputMode="url"
                  name="remoteUrl"
                  placeholder="https://dav.example.com/collection/"
                  required
                  type="url"
                />
              </label>
              <label>
                Username<input
                  autoComplete="username"
                  maxLength={255}
                  name="username"
                  type="text"
                />
              </label>
              <label>
                Secret<input
                  autoComplete="new-password"
                  maxLength={4096}
                  name="password"
                  required
                  type="password"
                />
              </label>
              <button disabled={state.busy} type="submit">
                Add connection
              </button>
            </form>
          )
          : null}
      </section>

      <section
        aria-labelledby="dav-list-heading"
        className="api-access-section"
      >
        <header>
          <p className="scope-label">Durable checkpoint</p>
          <h2 id="dav-list-heading">DAV connections</h2>
        </header>
        <p
          data-integration-empty=""
          hidden={state.subscriptions === undefined || subscriptions.length > 0}
        >
          No DAV connections yet.
        </p>
        <ul
          aria-label="DAV connections"
          className="api-token-list"
          data-integration-list=""
        >
          {subscriptions.map((subscription) => (
            <li key={subscription.id}>
              <div>
                <strong>{subscription.name}</strong>
                <span>{subscription.remoteUrl}</span>
                <small>
                  {subscriptionStatus(subscription, state.timePreferences)}
                </small>
              </div>
              <div>
                <button
                  disabled={!subscription.isActive || state.busy}
                  onClick={() => synchronize(subscription)}
                  type="button"
                >
                  {needsRetry(subscription) ? "Retry" : "Sync now"}
                </button>
                <button
                  className={buttonVariants({ variant: "outline" })}
                  disabled={!subscription.isActive || state.busy}
                  onClick={() => disable(subscription)}
                  type="button"
                >
                  {subscription.isActive ? "Disable" : "Disabled"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** Mounts the page over the region `integrations.astro` drew. */
export function mountIntegrations(
  root: ParentNode = document,
): Promise<() => void> {
  return mountSettingsSurface(
    root,
    "[data-integrations-surface]",
    INTEGRATIONS_ISLAND,
    (onSettled) => <Integrations onSettled={onSettled} />,
  );
}
