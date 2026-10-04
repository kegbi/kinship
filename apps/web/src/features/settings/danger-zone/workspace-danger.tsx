/**
 * The workspace danger zone (GAP-033): resetting the workspace's CRM data or
 * deleting the workspace, for an active owner only, each behind the current
 * impact, a typed confirmation, and the current password.
 *
 * One read loads the impact and the token that proves it was shown. Until
 * then both actions are disabled and a submission is dropped (REL-041). A
 * refusal keeps the page and says why; a success clears the active workspace
 * and follows the destination the server names.
 */

import {
  type SyntheticEvent,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
} from "react";
import {
  deleteWorkspace,
  getWorkspaceLifecyclePreview,
  resetWorkspace,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import { settle, useLatestRequest } from "../../../islands/core/index.ts";
import { clearActiveWorkspace } from "../../../lib/workspace-context.ts";
import { mountSettingsSurface } from "../form/settings-form.tsx";
import {
  browserNavigate,
  type Navigate,
  resolveSettingsContext,
} from "../shared/context.ts";
import { useHeldSubmit } from "../shared/hooks.ts";
import {
  countLabel,
  type DangerAction,
  dangerReducer,
  initialDanger,
} from "./workspace-danger.ts";

export const WORKSPACE_DANGER_ISLAND = "settings-workspace-danger";

function field(form: HTMLFormElement, name: string): string {
  return new FormData(form).get(name) as string;
}

export function WorkspaceDanger(
  props: { readonly navigate: Navigate; readonly onSettled?: () => void },
) {
  const [state, dispatch] = useReducer(dangerReducer, initialDanger);
  const request = useLatestRequest();
  const settled = useRef(props.onSettled);
  const { navigate } = props;

  const first = useEffectEvent(async () => {
    const answer = await request(async () => {
      const context = await resolveSettingsContext();
      if (context?.role !== "owner") return { ok: true, value: undefined };
      const { workspaceId } = context;
      const loaded = await getWorkspaceLifecyclePreview(workspaceId);
      return loaded.ok
        ? { ok: true, value: { preview: loaded.value, workspaceId } }
        : loaded;
    });
    if (!answer) return;
    if (answer.status !== "ready") {
      dispatch({
        message: answer.problem?.detail ??
          "Current workspace impact could not be loaded.",
        type: "withdrawn",
      });
    } else if (!answer.data) {
      dispatch({
        message: "An active owner session could not be confirmed.",
        type: "withdrawn",
      });
    } else dispatch({ ...answer.data, type: "loaded" });
  });
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  const { preview, workspaceId } = state;
  const ready = state.phase === "ready" && preview !== undefined &&
    workspaceId !== undefined;

  const run = async (action: DangerAction, form: HTMLFormElement) => {
    if (!ready || state.busy) return;
    dispatch({ action, type: "submitting" });
    const command = {
      confirmation: field(form, "confirmation"),
      impactToken: preview.impactToken,
      password: field(form, "password"),
    };
    const result = await settle<{
      readonly cleanupStatus: "pending" | "complete";
      readonly next: "/auth/sign-in";
      readonly status: "reset" | "deleted";
    }>(() =>
      action === "reset"
        ? resetWorkspace(command, workspaceId)
        : deleteWorkspace(command, workspaceId)
    );
    if (result.status !== "ready" || !result.data) {
      dispatch({
        message: result.problem?.detail ?? "The workspace was not changed.",
        type: "refused",
      });
      return;
    }
    clearActiveWorkspace();
    navigate(result.data.next);
  };
  const submitReset = useHeldSubmit(
    ready,
    (form) => void run("reset", form),
    { replay: false },
  );
  const submitDelete = useHeldSubmit(
    ready,
    (form) => void run("delete", form),
    { replay: false },
  );
  const withdrawn = state.phase === "withdrawn";

  return (
    <>
      <p
        aria-live="polite"
        className="section-state"
        data-danger-status=""
        role="status"
      >
        {state.status}
      </p>
      <section aria-labelledby="impact-heading">
        <h2 id="impact-heading">Current impact</h2>
        <dl className="impact-grid" data-danger-counts="" hidden={!preview}>
          {Object.entries(preview?.counts ?? {}).map(([name, value]) => (
            <div key={name}>
              <dt>{countLabel(name)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p>
          <strong data-danger-sessions="">
            {preview?.activeSessionCount ?? 0}
          </strong>{" "}
          active sessions will be revoked.
        </p>
      </section>
      <section aria-labelledby="reset-heading">
        <h2 id="reset-heading">Reset CRM data</h2>
        <p>
          Removes people and all delivered CRM history, files, imports, exports,
          and custom vocabularies. Workspace identity, members, preferences, and
          module visibility remain.
        </p>
        <DangerForm
          confirmation={preview?.confirmations.resetWorkspace}
          confirmationHook="data-reset-confirmation"
          disabled={!ready || state.busy !== undefined}
          formHook="data-danger-reset"
          hidden={withdrawn}
          label="Reset confirmation"
          onSubmit={submitReset}
          submit="Reset workspace data"
        />
      </section>
      <section aria-labelledby="delete-heading">
        <h2 id="delete-heading">Delete workspace</h2>
        <p>
          Deletes the workspace, memberships, sessions, and all CRM data. A
          minimal deletion-security result and pending object-cleanup state are
          retained.
        </p>
        <DangerForm
          confirmation={preview?.confirmations.deleteWorkspace}
          confirmationHook="data-delete-confirmation"
          disabled={!ready || state.busy !== undefined}
          formHook="data-danger-delete"
          hidden={withdrawn}
          label="Deletion confirmation"
          onSubmit={submitDelete}
          submit="Delete workspace"
        />
      </section>
    </>
  );
}

function DangerForm(
  props: {
    readonly formHook: string;
    readonly confirmationHook: string;
    readonly confirmation: string | undefined;
    readonly label: string;
    readonly submit: string;
    readonly disabled: boolean;
    readonly hidden: boolean;
    readonly onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  },
) {
  return (
    <form
      {...{ [props.formHook]: "" }}
      hidden={props.hidden}
      method="post"
      onSubmit={props.onSubmit}
    >
      <p>
        Type{" "}
        <code {...{ [props.confirmationHook]: "" }}>
          {props.confirmation}
        </code>{" "}
        exactly.
      </p>
      <label>
        {props.label}
        <input
          autoComplete="off"
          maxLength={300}
          name="confirmation"
          required
        />
      </label>
      <label>
        Current password<input
          autoComplete="current-password"
          maxLength={1024}
          name="password"
          required
          type="password"
        />
      </label>
      <button
        className={buttonVariants({ variant: "destructive" })}
        disabled={props.disabled}
        type="submit"
      >
        {props.submit}
      </button>
    </form>
  );
}

/** Mounts the danger zone over the region `danger-zone.astro` drew. */
export function mountWorkspaceDanger(
  root: ParentNode = document,
  navigate: Navigate = browserNavigate,
): Promise<() => void> {
  return mountSettingsSurface(
    root,
    "[data-danger-surface]",
    WORKSPACE_DANGER_ISLAND,
    (onSettled) => (
      <WorkspaceDanger
        navigate={navigate}
        onSettled={onSettled}
      />
    ),
  );
}
