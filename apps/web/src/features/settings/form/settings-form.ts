/**
 * The state of one loaded settings form (GAP-033): the profile, the
 * preferences, and the workspace's general settings. It is a pure reducer;
 * `settings-form.tsx` renders it.
 *
 * A form loads with every control disabled, becomes editable once its values
 * arrive, and says which: loading, unavailable, saving, or its last outcome
 * (`status`). Whether the fields differ from what was last loaded or saved is
 * `dirty`; a draft discarded by a workspace switch says so until the next
 * edit. A field the browser or the server refused is `invalid`, the server's
 * words for it are in `errors`, and the error summary shows until a save
 * lands. Each new refusal moves `validation` on, which is when focus goes to
 * the first refused field.
 */

export interface SettingsFormState<V> {
  readonly phase: "loading" | "ready" | "unavailable";
  /** What the fields start from: the last values loaded. */
  readonly values: V | undefined;
  /** Moves on with each load, so the fields restart from `values`. */
  readonly generation: number;
  readonly status: string;
  readonly saving: boolean;
  readonly dirty: boolean;
  /** Words that replace the dirty line until the next edit. */
  readonly dirtyNote: string | undefined;
  readonly summary: boolean;
  readonly errors: Readonly<Record<string, string>>;
  readonly invalid: readonly string[];
  readonly validation: number;
}

export type SettingsFormAction<V> =
  | { readonly type: "loaded"; readonly values: V }
  | { readonly type: "unavailable"; readonly message: string }
  | { readonly type: "edited"; readonly dirty: boolean }
  | { readonly type: "invalid"; readonly name: string }
  | {
    readonly type: "input";
    readonly name: string;
    readonly valid: boolean;
  }
  | { readonly type: "saving"; readonly message: string }
  | { readonly type: "saved"; readonly message: string }
  | {
    readonly type: "refused";
    readonly message: string;
    /** The field errors to show beside the fields they name. */
    readonly errors?: Readonly<Record<string, string>>;
  }
  | { readonly type: "discarded" };

export const REVIEW_FIELDS = "Review the highlighted fields and try again.";

export function initialSettingsForm<V>(
  message: string,
): SettingsFormState<V> {
  return {
    dirty: false,
    dirtyNote: undefined,
    errors: {},
    generation: 0,
    invalid: [],
    phase: "loading",
    saving: false,
    status: message,
    summary: false,
    validation: 0,
    values: undefined,
  };
}

function withName(names: readonly string[], name: string): readonly string[] {
  return names.includes(name) ? names : [...names, name];
}

export function settingsFormReducer<V>(
  state: SettingsFormState<V>,
  action: SettingsFormAction<V>,
): SettingsFormState<V> {
  switch (action.type) {
    case "loaded":
      return {
        ...state,
        dirty: false,
        dirtyNote: undefined,
        generation: state.generation + 1,
        phase: "ready",
        status: "",
        values: action.values,
      };
    case "unavailable":
      return { ...state, phase: "unavailable", status: action.message };
    case "edited":
      return { ...state, dirty: action.dirty, dirtyNote: undefined };
    case "invalid":
      return {
        ...state,
        invalid: withName(state.invalid, action.name),
        summary: true,
        validation: state.validation + 1,
      };
    case "input": {
      const { [action.name]: _cleared, ...errors } = state.errors;
      return {
        ...state,
        errors,
        invalid: action.valid
          ? state.invalid.filter((name) => name !== action.name)
          : state.invalid,
      };
    }
    case "saving":
      return { ...state, saving: true, status: action.message };
    case "saved":
      return {
        ...state,
        dirty: false,
        dirtyNote: undefined,
        saving: false,
        status: action.message,
        summary: false,
      };
    case "refused": {
      const names = Object.keys(action.errors ?? {});
      if (names.length === 0) {
        return { ...state, saving: false, status: action.message };
      }
      return {
        ...state,
        errors: { ...state.errors, ...action.errors },
        invalid: names.reduce(withName, state.invalid),
        saving: false,
        status: action.message,
        summary: true,
        validation: state.validation + 1,
      };
    }
    case "discarded":
      return {
        ...state,
        dirty: false,
        dirtyNote: "Unsaved changes discarded.",
      };
  }
}

/** The dirty line, and its `data-state`, once the form has loaded. */
export function dirtyLine(
  state: SettingsFormState<unknown>,
): { readonly text: string; readonly state?: "dirty" | "saved" } {
  if (state.phase !== "ready") return { text: "" };
  return {
    state: state.dirty ? "dirty" : "saved",
    text: state.dirtyNote ??
      (state.dirty ? "Unsaved changes." : "All changes saved."),
  };
}
