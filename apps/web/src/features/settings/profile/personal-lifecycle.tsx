/**
 * The personal lifecycle panel (GAP-033): leaving this workspace and
 * deleting the member's identity, each behind the current impact, a typed
 * confirmation, and the current password.
 *
 * One read loads the impact. Until it is shown both actions are disabled,
 * and a submission made meanwhile is dropped rather than replayed (REL-041):
 * the impact must be reviewed first. Each action revalidates on the server;
 * a refusal keeps the page and says why, and a success follows the
 * destination the server names.
 */

import {
  type SyntheticEvent,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
} from "react";
import {
  deletePersonalIdentity,
  getPersonalLifecyclePreview,
  leaveCurrentWorkspace,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import { settle, useLatestRequest } from "../../../islands/core/index.ts";
import {
  clearActiveWorkspace,
  setActiveWorkspace,
} from "../../../lib/workspace-context.ts";
import {
  mountSettingsSurface,
  SESSION_UNCONFIRMED,
} from "../form/settings-form.tsx";
import {
  browserNavigate,
  type Navigate,
  resolveSettingsContext,
} from "../shared/context.ts";
import { useHeldSubmit } from "../shared/hooks.ts";
import {
  blockersText,
  initialLifecycle,
  type LifecycleAction,
  lifecycleBlocks,
  lifecycleReducer,
  membershipDetail,
} from "./personal-lifecycle.ts";

export const PERSONAL_LIFECYCLE_ISLAND = "settings-personal-lifecycle";

function field(form: HTMLFormElement, name: string): string {
  return new FormData(form).get(name) as string;
}

export function PersonalLifecycle(
  props: {
    readonly navigate: Navigate;
    readonly onSettled?: () => void;
  },
) {
  const [state, dispatch] = useReducer(lifecycleReducer, initialLifecycle);
  const request = useLatestRequest();
  const settled = useRef(props.onSettled);
  const { navigate } = props;

  const first = useEffectEvent(async () => {
    const answer = await request(async () => {
      const context = await resolveSettingsContext();
      if (!context) return { ok: true, value: undefined };
      const { workspaceId } = context;
      const loaded = await getPersonalLifecyclePreview(workspaceId);
      return loaded.ok
        ? { ok: true, value: { preview: loaded.value, workspaceId } }
        : loaded;
    });
    if (!answer) return;
    if (answer.status !== "ready") {
      dispatch({
        message: answer.problem?.detail ??
          "Current account impact could not be loaded.",
        type: "unavailable",
      });
    } else if (!answer.data) {
      dispatch({ message: SESSION_UNCONFIRMED, type: "unavailable" });
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
  const blocks = ready
    ? lifecycleBlocks(preview, workspaceId)
    : { delete: true, leave: true };

  const run = async (action: LifecycleAction, form: HTMLFormElement) => {
    if (!ready || state.busy || blocks[action]) return;
    dispatch({ action, type: "submitting" });
    const command = {
      confirmation: field(form, "confirmation"),
      password: field(form, "password"),
    };
    if (action === "leave") {
      const result = await settle(() =>
        leaveCurrentWorkspace(command, workspaceId)
      );
      if (result.status !== "ready" || !result.data) {
        dispatch({
          message: result.problem?.detail ?? "The workspace could not be left.",
          type: "refused",
        });
        return;
      }
      if (result.data.nextWorkspaceId) {
        setActiveWorkspace(result.data.nextWorkspaceId);
      } else clearActiveWorkspace();
      navigate(result.data.next);
      return;
    }
    const result = await settle(() =>
      deletePersonalIdentity(command, workspaceId)
    );
    if (result.status !== "ready" || !result.data) {
      dispatch({
        message: result.problem?.detail ??
          "Your personal identity was not deleted.",
        type: "refused",
      });
      return;
    }
    clearActiveWorkspace();
    navigate(result.data.next);
  };

  const submitLeave = useHeldSubmit(
    ready,
    (form) => void run("leave", form),
    { replay: false },
  );
  const submitDelete = useHeldSubmit(
    ready,
    (form) => void run("delete", form),
    { replay: false },
  );
  const blockers = preview ? blockersText(preview) : undefined;

  return (
    <>
      <header>
        <p className="eyebrow">Account lifecycle</p>
        <h2 id="account-lifecycle-heading">
          Memberships and personal identity
        </h2>
        <p>
          Review the current impact before leaving this workspace or deleting
          your identity.
        </p>
      </header>
      <div aria-live="polite" id="lifecycle-impact">
        <p hidden={state.phase === "ready"} id="lifecycle-loading">
          Loading current memberships and sessions…
        </p>
        <dl hidden={state.phase !== "ready"} id="lifecycle-counts">
          <div>
            <dt>Affected memberships</dt>
            <dd id="lifecycle-membership-count">
              {preview?.memberships.length ?? 0}
            </dd>
          </div>
          <div>
            <dt>Active sessions</dt>
            <dd id="lifecycle-session-count">
              {preview?.activeSessionCount ?? 0}
            </dd>
          </div>
        </dl>
        <ul
          aria-label="Affected memberships"
          className="member-list"
          id="lifecycle-memberships"
        >
          {preview?.memberships.map((membership) => (
            <li key={membership.id}>
              <strong>{membership.workspace.name}</strong>
              <span>{membershipDetail(membership)}</span>
            </li>
          ))}
        </ul>
        <p
          className="form-error-summary"
          hidden={blockers === undefined}
          id="lifecycle-blockers"
        >
          {blockers}
        </p>
        <p>
          Legal acceptance records are retained as compliance evidence. Personal
          sign-in data and access are removed when your identity is deleted;
          workspace CRM records remain owned by their workspaces.
        </p>
      </div>
      <LifecycleForm
        confirmation={preview?.confirmations.leaveWorkspace}
        confirmationId="leave-confirmation-value"
        disabled={blocks.leave || state.busy !== undefined}
        id="leave-workspace-form"
        label="Leave confirmation"
        onSubmit={submitLeave}
        submit="Leave workspace"
        title="Leave this workspace"
      >
        Your other memberships remain active. Type{" "}
      </LifecycleForm>
      <LifecycleForm
        confirmation={preview?.confirmations.deleteIdentity}
        confirmationId="delete-confirmation-value"
        disabled={blocks.delete || state.busy !== undefined}
        id="delete-identity-form"
        label="Deletion confirmation"
        onSubmit={submitDelete}
        submit="Delete personal identity"
        title="Delete personal identity"
        trailer=" exactly, then reauthenticate."
      >
        This signs you out everywhere and ends every membership. Type{" "}
      </LifecycleForm>
      <p aria-live="polite" id="lifecycle-status" role="status">
        {state.status}
      </p>
    </>
  );
}

function LifecycleForm(
  props: {
    readonly id: string;
    readonly title: string;
    readonly children: string;
    readonly trailer?: string;
    readonly confirmation: string | undefined;
    readonly confirmationId: string;
    readonly label: string;
    readonly submit: string;
    readonly disabled: boolean;
    readonly onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  },
) {
  return (
    <form
      className="lifecycle-form"
      id={props.id}
      method="post"
      onSubmit={props.onSubmit}
    >
      <h3>{props.title}</h3>
      <p>
        {props.children}
        <code id={props.confirmationId}>{props.confirmation}</code>
        {props.trailer ?? " exactly."}
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

/** Mounts the panel over the one `profile.astro` drew. */
export function mountPersonalLifecycle(
  root: ParentNode = document,
  navigate: Navigate = browserNavigate,
): Promise<() => void> {
  return mountSettingsSurface(
    root,
    "#account-lifecycle",
    PERSONAL_LIFECYCLE_ISLAND,
    (onSettled) => (
      <PersonalLifecycle navigate={navigate} onSettled={onSettled} />
    ),
  );
}
