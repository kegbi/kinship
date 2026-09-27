/**
 * One loaded settings form as an island (GAP-033), shared by the profile,
 * the preferences, and the workspace's general settings.
 *
 * The form is drawn disabled while the session and its values load, then
 * becomes editable. It keeps the browser's own validation: a submission the
 * browser refuses, or one whose fields the server refuses, marks each field,
 * shows the error summary, and moves focus to the first refused field. It
 * tracks unsaved changes against what was last loaded or saved, and guards
 * leaving the page and switching workspaces while they stand.
 *
 * One read slot resolves the session and loads the values; a save holds the
 * submit control until it settles.
 */

import {
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import type {
  ApiResult,
  ProblemDetails,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { buttonVariants, cardVariants } from "@/components/ui/variants.ts";
import {
  mountIsland,
  settle,
  useLatestRequest,
} from "../../../islands/core/index.ts";
import { resolveSettingsContext } from "../shared/context.ts";
import { useUnsavedGuard } from "../shared/hooks.ts";
import {
  dirtyLine,
  initialSettingsForm,
  REVIEW_FIELDS,
  settingsFormReducer,
  type SettingsFormState,
} from "./settings-form.ts";

export const SESSION_UNCONFIRMED = "Your session could not be confirmed.";
const DISCARD_ON_SWITCH =
  "You have unsaved changes in this workspace. Discard them and switch workspaces?";

/** What a field renders from: its loaded value, its lock, and its error. */
export interface FieldsProps<V> {
  readonly values: V | undefined;
  readonly disabled: boolean;
  readonly errors: Readonly<Record<string, string>>;
}

export interface SettingsFormProps<V> {
  readonly id: string;
  readonly loading: string;
  readonly load: (workspaceId: string) => Promise<ApiResult<V>>;
  readonly loadFailed: (problem: ProblemDetails | undefined) => string;
  readonly fields: (props: FieldsProps<V>) => ReactNode;
  readonly save: (
    form: HTMLFormElement,
    workspaceId: string,
  ) => Promise<ApiResult<unknown>>;
  readonly saving: string;
  readonly saved: string;
  readonly saveFailed: string;
  /** Whether a refused save's field errors are shown beside their fields. */
  readonly fieldErrors?: boolean;
  /** Runs after a save lands, with the form and what the server answered. */
  readonly onSaved?: (
    form: HTMLFormElement,
    value: unknown,
    workspaceId: string,
  ) => void;
  readonly onSettled?: (() => void) | undefined;
}

/** A form's entries, as the dirty check compares them. */
export function formSnapshot(form: HTMLFormElement): string {
  return JSON.stringify(Array.from(new FormData(form).entries()));
}

function namedControls(
  form: HTMLFormElement,
): (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[] {
  return Array.from(form.elements).filter((
    control,
  ): control is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
    (control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLTextAreaElement) && Boolean(control.name)
  );
}

export function SettingsForm<V>(props: SettingsFormProps<V>) {
  const [state, dispatch] = useReducer(
    settingsFormReducer<V>,
    props.loading,
    initialSettingsForm<V>,
  );
  const request = useLatestRequest();
  const form = useRef<HTMLFormElement>(null);
  const baseline = useRef("");
  // What the dirty line last said, read by the guards as soon as an edit
  // lands, before the edit's render.
  const dirtyNow = useRef(false);
  const workspace = useRef<string | undefined>(undefined);
  const settled = useRef(props.onSettled);

  const start = async () => {
    const answer = await request(async () => {
      const context = await resolveSettingsContext();
      if (!context) return { ok: true, value: undefined };
      workspace.current = context.workspaceId;
      const loaded = await props.load(context.workspaceId);
      return loaded.ok ? { ok: true, value: { value: loaded.value } } : loaded;
    });
    if (!answer) return;
    if (answer.status === "ready" && !answer.data) {
      dispatch({ message: SESSION_UNCONFIRMED, type: "unavailable" });
    } else if (answer.status === "ready") {
      dispatch({ type: "loaded", values: answer.data!.value });
    } else {
      dispatch({
        message: props.loadFailed(answer.problem),
        type: "unavailable",
      });
    }
  };
  const first = useEffectEvent(() => start());
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  // The fields restart from each load; that is the baseline edits differ from.
  useLayoutEffect(() => {
    if (form.current && state.generation > 0) {
      baseline.current = formSnapshot(form.current);
    }
  }, [state.generation]);

  // A server refusal is the field's custom validity, so the browser refuses
  // the next submission of it too; `aria-invalid` follows every refusal.
  useLayoutEffect(() => {
    if (!form.current) return;
    for (const control of namedControls(form.current)) {
      if (control instanceof HTMLInputElement) {
        control.setCustomValidity(state.errors[control.name] ?? "");
      }
      if (state.invalid.includes(control.name)) {
        control.setAttribute("aria-invalid", "true");
      } else control.removeAttribute("aria-invalid");
    }
  }, [state.errors, state.invalid]);

  useLayoutEffect(() => {
    if (state.validation === 0 || !form.current) return;
    namedControls(form.current).find((control) => !control.validity.valid)
      ?.focus();
  }, [state.validation]);

  useUnsavedGuard({
    confirmMessage: DISCARD_ON_SWITCH,
    dirty: () => dirtyNow.current,
    onDiscard: () => {
      if (form.current) baseline.current = formSnapshot(form.current);
      dirtyNow.current = false;
      dispatch({ type: "discarded" });
    },
  });

  const edited = () => {
    if (state.phase !== "ready" || !form.current) return;
    const dirty = formSnapshot(form.current) !== baseline.current;
    dirtyNow.current = dirty;
    if (dirty !== state.dirty || state.dirtyNote) {
      dispatch({ dirty, type: "edited" });
    }
  };

  const input = (event: SyntheticEvent<HTMLFormElement>) => {
    const control = event.target as HTMLInputElement;
    if (control.name) {
      control.setCustomValidity?.("");
      dispatch({
        name: control.name,
        type: "input",
        valid: control.validity?.valid ?? true,
      });
    }
    edited();
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const workspaceId = workspace.current!;
    if (state.phase !== "ready" || state.saving) return;
    if (!element.checkValidity()) return;
    dispatch({ message: props.saving, type: "saving" });
    const answer = await settle(() => props.save(element, workspaceId));
    if (answer.status === "ready") {
      baseline.current = formSnapshot(element);
      dirtyNow.current = false;
      dispatch({ message: props.saved, type: "saved" });
      props.onSaved?.(element, answer.data, workspaceId);
      return;
    }
    const problem = answer.problem;
    const inputs = new Set(
      namedControls(element).filter((control) =>
        control instanceof HTMLInputElement
      ).map((control) => control.name),
    );
    const errors = props.fieldErrors && problem?.status === 400
      ? Object.fromEntries(
        Object.entries(problem.errors ?? {}).filter(([name]) =>
          inputs.has(name)
        ),
      )
      : {};
    dispatch({
      errors,
      message: problem?.detail ?? props.saveFailed,
      type: "refused",
    });
  };

  const ready = state.phase === "ready";
  const dirty = dirtyLine(state as SettingsFormState<unknown>);
  return (
    <form
      className={cardVariants({ className: "settings-form" })}
      {...(ready ? { "data-dirty": String(state.dirty) } : {})}
      id={props.id}
      method="post"
      onChange={edited}
      onInput={input}
      onInvalidCapture={(event) => {
        const name = (event.target as HTMLInputElement).name;
        if (name) dispatch({ name, type: "invalid" });
      }}
      onSubmit={(event) => void submit(event)}
      ref={form}
    >
      <p
        className="form-error-summary"
        hidden={!state.summary}
        id="settings-errors"
        role="alert"
        tabIndex={-1}
      >
        {state.summary ? REVIEW_FIELDS : ""}
      </p>
      <FieldsSlot
        key={state.generation}
        render={() =>
          props.fields({
            disabled: !ready,
            errors: state.errors,
            values: state.values,
          })}
      />
      <button
        className={buttonVariants()}
        disabled={!ready || state.saving}
        type="submit"
      >
        Save changes
      </button>
      <p
        aria-live="polite"
        {...(dirty.state ? { "data-state": dirty.state } : {})}
        id="settings-dirty"
        role="status"
      >
        {dirty.text}
      </p>
      <p aria-live="polite" id="settings-status" role="status">
        {state.status}
      </p>
    </form>
  );
}

/** The fields, remounted by their key whenever new values load. */
function FieldsSlot(props: { readonly render: () => ReactNode }) {
  return props.render();
}

/** The `<small>` beside a field that says what the server refused. */
export function FieldError(
  props: {
    readonly id: string;
    readonly name: string;
    readonly errors: Readonly<Record<string, string>>;
  },
) {
  return (
    <small data-field-error={props.name} id={props.id}>
      {props.errors[props.name] ?? ""}
    </small>
  );
}

/**
 * Mounts `element` over the settings form container `selector` finds and
 * resolves, once its first read has settled, with the function that
 * unmounts it.
 */
export function mountSettingsSurface(
  root: ParentNode,
  selector: string,
  name: string,
  element: (onSettled: () => void) => ReactNode,
): Promise<() => void> {
  const container = root.querySelector<HTMLElement>(selector);
  if (!container) return Promise.resolve(() => undefined);
  return new Promise((resolve) => {
    const unmount = mountIsland(
      container,
      name,
      element(() => resolve(unmount)),
    );
  });
}
