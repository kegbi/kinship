/**
 * The fields a profile fact editor is built from (GAP-029).
 *
 * Every section lays its editor out from these few pieces, and each piece
 * reads the section's form from context: a text field, a notes field, a
 * checkbox, a choice list over the section's options, and the option search
 * the section's lookup drives. A field shows the error the contract schema or
 * the API raised for it beside the control and marks the control invalid, so
 * a reader and a screen reader find the problem where it is.
 *
 * Labels, field names, limits, and the native `<select>`s are the ones the
 * vanilla editors had, which keeps keyboard use, mobile pickers, and every
 * end-to-end locator unchanged.
 */

import {
  createContext,
  type ReactNode,
  useContext,
  useId,
  useRef,
} from "react";
import type { FieldError } from "react-hook-form";
import type { ProfileFactOption } from "../../../../../../packages/contracts/generated/auth-client.ts";
import { Button } from "@/components/ui/button.tsx";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import type {
  ContractForm,
  ContractIssue,
} from "../../../islands/core/index.ts";

/** What an editor's fields share: the form, its choices, and its lookup. */
export interface FactFormContext {
  // The fields are typed by each section; the context carries any of them.
  // deno-lint-ignore no-explicit-any
  readonly form: ContractForm<any, any>;
  /** The options a choice field offers, what it held first. */
  readonly choices: (name: string) => readonly ProfileFactOption[];
  /** The lookup's search box and buttons, or nothing without a lookup. */
  readonly lookup: ReactNode;
}

const Context = createContext<FactFormContext | undefined>(undefined);

export const FactFormProvider = Context.Provider;

/** The editor's form, for a section whose fields depend on each other. */
export function useFactForm(): FactFormContext {
  const context = useContext(Context);
  if (!context) throw new Error("A fact field renders inside a fact editor.");
  return context;
}

/** How a section words the issues its contract raises. */
export interface FactWording {
  /** The message for a missing or malformed required field, by name. */
  readonly required?: Readonly<Record<string, string>>;
  /** What a list field holds, for "Choose no more than 20 labels." */
  readonly lists?: Readonly<Record<string, string>>;
  /**
   * Where a fact made of nothing is refused — the contract refuses it as a
   * whole — and what the field says.
   */
  readonly empty?: { readonly field: string; readonly message: string };
}

/** Words one contract issue in the section's terms. */
export function factIssueMessage(
  wording: FactWording,
): (issue: ContractIssue) => string | undefined {
  return (issue) => {
    const field = issue.path?.[0];
    if (issue.code === "too_big") {
      return issue.origin === "array"
        ? `Choose no more than ${String(issue.maximum)} ${
          wording.lists?.[String(field)] ?? "choices"
        }.`
        : `Enter no more than ${String(issue.maximum)} characters.`;
    }
    return field === undefined ? undefined : wording.required?.[String(field)];
  };
}

/** The error a field shows, and the attributes that tie its control to it. */
function useFieldError(name: string): {
  readonly control: {
    readonly "aria-describedby"?: string;
    readonly "aria-invalid"?: true;
  };
  readonly message: ReactNode;
} {
  const { form } = useFactForm();
  const id = useId();
  const error = (form.formState.errors as Record<string, FieldError>)[name];
  if (!error?.message) return { control: {}, message: null };
  return {
    control: { "aria-describedby": id, "aria-invalid": true },
    message: (
      <span className="field-error" data-profile-fact-field-error="" id={id}>
        {error.message}
      </span>
    ),
  };
}

export function TextField(
  props: {
    readonly name: string;
    readonly label: string;
    readonly maxLength?: number;
    readonly required?: boolean;
    readonly type?: "text" | "date";
    /** Runs as the reader types, with what the field holds. */
    readonly onText?: (value: string) => void;
  },
) {
  const { form } = useFactForm();
  const error = useFieldError(props.name);
  const { onText } = props;
  return (
    <label>
      {props.label}
      <Input
        {...form.register(
          props.name,
          onText
            ? {
              onChange: (event: { target: { value: string } }) =>
                onText(event.target.value),
            }
            : {},
        )}
        {...error.control}
        maxLength={props.maxLength}
        required={props.required}
        type={props.type ?? "text"}
      />
      {error.message}
    </label>
  );
}

export function NotesField(
  props: {
    readonly name: string;
    readonly label: string;
    readonly required?: boolean;
  },
) {
  const { form } = useFactForm();
  const error = useFieldError(props.name);
  return (
    <label>
      {props.label}
      <Textarea
        {...form.register(props.name)}
        {...error.control}
        maxLength={2000}
        required={props.required}
        rows={3}
      />
      {error.message}
    </label>
  );
}

export function CheckboxField(
  props: { readonly name: string; readonly label: string },
) {
  const { form } = useFactForm();
  return (
    <label className="checkbox-row">
      <input {...form.register(props.name)} type="checkbox" />
      {props.label}
    </label>
  );
}

/**
 * A choice over the section's options, which the form's value selects. What
 * it held when its options were last listed comes first, so whatever the
 * lookup loads next, the reader's choices stay listed and chosen.
 */
export function ChoiceField(
  props: {
    readonly name: string;
    readonly label: string;
    readonly multiple?: boolean;
    readonly required?: boolean;
    /** Runs after the choice changes, with the chosen value. */
    readonly onChoose?: (value: string) => void;
  },
) {
  const { choices, form } = useFactForm();
  const error = useFieldError(props.name);
  const registration = form.register(props.name);
  return (
    <label>
      {props.label}
      <select
        {...registration}
        {...error.control}
        multiple={props.multiple}
        onChange={(event) => {
          void registration.onChange(event);
          if (!props.multiple) props.onChoose?.(event.target.value);
        }}
        required={props.required}
      >
        {props.multiple ? null : <option value="">Select an option</option>}
        {choices(props.name).map((option) => (
          <option key={option.id} value={option.id}>{option.name}</option>
        ))}
      </select>
      {error.message}
    </label>
  );
}

/** Where the section's lookup — its search box and buttons — sits. */
export function LookupSlot() {
  return useFactForm().lookup;
}

/** The labels and markers of a section's option search. */
export interface OptionSearchLabels {
  /** The search box's field name. */
  readonly name: string;
  /** The search box's label, which its search button shares. */
  readonly label: string;
  readonly more: string;
  /** The `data-*` names tests and the first-run actions find the buttons by. */
  readonly markers: { readonly search: string; readonly more: string };
}

/**
 * The search box and its two buttons. The box is not one of the editor's
 * fields: what it holds is never saved, only asked about.
 */
export function OptionSearch(
  props: {
    readonly labels: OptionSearchLabels;
    readonly busy: boolean;
    /** Whether the last answer offered another page. */
    readonly more: boolean;
    readonly onSearch: (search: string, next: boolean) => void;
  },
) {
  const box = useRef<HTMLInputElement>(null);
  const { labels } = props;
  const search = () => box.current?.value.trim() ?? "";
  // The box and its buttons share one row, so the search button reads as
  // the box's action rather than as a second field.
  return (
    <div className="option-search">
      <label>
        {labels.label}
        <Input maxLength={200} name={labels.name} ref={box} type="search" />
      </label>
      <div className="option-search-actions">
        <Button
          {...{ [`data-${labels.markers.search}`]: "" }}
          disabled={props.busy}
          onClick={() => props.onSearch(search(), false)}
          type="button"
          variant="outline"
        >
          <Search aria-hidden="true" className="size-4" />
          {labels.label}
        </Button>
        <Button
          {...{ [`data-${labels.markers.more}`]: "" }}
          disabled={props.busy}
          hidden={!props.more}
          onClick={() => props.onSearch(search(), true)}
          type="button"
          variant="outline"
        >
          {labels.more}
        </Button>
      </div>
    </div>
  );
}
