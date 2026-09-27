/**
 * The add-a-person form as an island (GAP-033): `/app/people/new`. It
 * replaces `lib/people-create.ts`.
 *
 * The page draws the form statically with its save controls disabled; the
 * island renders it again over that at once, keeping whatever was typed, and
 * the given and family names a "new person" link prefills. It resolves the
 * workspace as it mounts, and a person saved before that answers is created
 * once it does (REL-041), so an early save never falls back to a native
 * submission and is never lost.
 *
 * A possible duplicate is guidance, not a block: the reader can review the
 * names or create the person anyway. "Save and add another" keeps the reader
 * on the page with an empty form; "Save person" opens the new person.
 */

import {
  type SyntheticEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  createPerson,
  type PersonInput,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  buttonVariants,
  formActionsVariants,
} from "@/components/ui/variants.ts";
import { mountIsland, settle } from "../../../islands/core/index.ts";
import { readStaticForm } from "../../../lib/static-form.ts";
import { resolveWorkspaceSession } from "../../../lib/workspace-context.ts";
import {
  CREATE_FAILED,
  CREATE_FIELDS,
  createdName,
  type CreateValues,
  ERROR_SUMMARY,
  localErrors,
  personInput,
} from "./create.ts";

export const PEOPLE_CREATE_ISLAND = "people-create";

type Navigate = (path: string) => void;

const browserNavigate: Navigate = (path) => globalThis.location.assign(path);

export interface PersonCreateProps {
  /** The fields' starting values: what was typed, or what a link prefilled. */
  readonly initial: Readonly<Record<string, string>>;
  readonly navigate?: Navigate | undefined;
}

/** Where focus goes after a render; a new object each time it is asked for. */
type FocusRequest = { readonly target: "invalid" | "duplicate" | "given" };

interface CreateState {
  readonly errors: Readonly<Record<string, string>>;
  readonly summary: boolean;
  readonly status: string;
  /** A possible duplicate's detail while the warning shows. */
  readonly duplicate: string | undefined;
  readonly pending: boolean;
  readonly focus: FocusRequest | undefined;
}

const INITIAL: CreateState = {
  duplicate: undefined,
  errors: {},
  focus: undefined,
  pending: false,
  status: "",
  summary: false,
};

/** The workspace this page writes to, or none when it cannot be confirmed. */
async function workspace(): Promise<string | undefined> {
  const session = await resolveWorkspaceSession();
  return session.status === "ready" ? session.session.workspace.id : undefined;
}

function valuesOf(form: HTMLFormElement): CreateValues {
  const input = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement;
  return {
    familyName: input("familyName").value,
    givenName: input("givenName").value,
    isPartial: input("isPartial").checked,
    middleName: input("middleName").value,
    nickname: input("nickname").value,
  };
}

export function PersonCreate(props: PersonCreateProps) {
  const navigate = props.navigate ?? browserNavigate;
  const [state, setState] = useState<CreateState>(INITIAL);
  const form = useRef<HTMLFormElement>(null);
  const duplicate = useRef<HTMLElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const initial = useRef(props.initial);
  const workspaceId = useRef<Promise<string | undefined> | undefined>(
    undefined,
  );
  const pending = useRef(false);
  const addAnother = useRef(false);

  const update = (next: Partial<CreateState>) =>
    setState((current) => ({ ...current, ...next }));

  // The starting values become the fields' values, not their defaults, so
  // "Save and add another" empties the form.
  useLayoutEffect(() => {
    const fields = form.current!.elements;
    for (const [name, value] of Object.entries(initial.current)) {
      const field = fields.namedItem(name);
      if (!(field instanceof HTMLInputElement)) continue;
      if (field.type === "checkbox") field.checked = value === "on";
      else field.value = value;
    }
  }, []);

  useEffect(() => {
    const resolving = workspace();
    workspaceId.current = resolving;
    void resolving.then((id) => {
      if (!id) {
        update({ status: "Your active workspace could not be confirmed." });
      }
    });
  }, []);

  useLayoutEffect(() => {
    const target = state.focus?.target;
    if (!target) return;
    const fields = form.current!;
    if (target === "duplicate") duplicate.current?.focus();
    else if (target === "given") {
      fields.querySelector<HTMLInputElement>('[name="givenName"]')?.focus();
    } else {
      (fields.querySelector<HTMLElement>("[aria-invalid='true']") ??
        summary.current)?.focus();
    }
  }, [state.focus]);

  // A field's server or local error is its own: the browser's validity
  // follows the message shown under it.
  useLayoutEffect(() => {
    const fields = form.current!;
    for (const name of CREATE_FIELDS) {
      fields.querySelector<HTMLInputElement>(`[name="${name}"]`)
        ?.setCustomValidity(state.errors[name] ?? "");
    }
  }, [state.errors]);

  const showErrors = (errors: Readonly<Record<string, string>>) => {
    const known = Object.fromEntries(
      Object.entries(errors).filter(([name]) =>
        (CREATE_FIELDS as readonly string[]).includes(name)
      ),
    );
    update({ errors: known, focus: { target: "invalid" }, summary: true });
  };

  const save = async (duplicateOverride: boolean): Promise<void> => {
    const element = form.current!;
    if (pending.current) return;
    const person: PersonInput = personInput(
      valuesOf(element),
      duplicateOverride,
    );
    update({ errors: {}, summary: false });
    const errors = localErrors(person);
    if (Object.keys(errors).length > 0) {
      showErrors(errors);
      return;
    }
    pending.current = true;
    update({ pending: true, status: "Saving person…" });
    const id = await workspaceId.current;
    if (!id) {
      pending.current = false;
      update({
        pending: false,
        status: "Your active workspace could not be confirmed.",
      });
      return;
    }
    const answer = await settle(() => createPerson(person, id));
    pending.current = false;
    if (answer.status !== "ready") {
      const problem = answer.problem;
      const status = problem?.detail ?? CREATE_FAILED;
      if (problem?.code === "possible_duplicate") {
        update({
          duplicate: problem.detail,
          focus: { target: "duplicate" },
          pending: false,
          status,
        });
        return;
      }
      update({ pending: false, status });
      if (problem?.errors) showErrors(problem.errors);
      return;
    }
    const created = answer.data!;
    if (addAnother.current) {
      addAnother.current = false;
      element.reset();
      update({
        duplicate: undefined,
        focus: { target: "given" },
        pending: false,
        status: `${createdName(created.person)} created. Add another person.`,
      });
      return;
    }
    update({ duplicate: undefined, pending: false });
    navigate(created.next);
  };

  const submit = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    // A submission while one is pending changes nothing about that one.
    if (pending.current) return;
    addAnother.current =
      (event.nativeEvent.submitter as HTMLElement | null)?.id ===
        "save-add-another";
    void save(false);
  };

  const clearField = (event: SyntheticEvent<HTMLFormElement>) => {
    const name = (event.target as HTMLInputElement).name;
    if (!state.errors[name]) return;
    const { [name]: _cleared, ...rest } = state.errors;
    update({ errors: rest });
  };

  const review = () => {
    update({ duplicate: undefined, focus: { target: "given" } });
  };

  const invalid = (name: string) =>
    state.errors[name] ? { "aria-invalid": true as const } : {};

  return (
    <form
      ref={form}
      className="person-form"
      id="people-create-form"
      method="post"
      noValidate
      onInput={clearField}
      onSubmit={submit}
    >
      <p
        ref={summary}
        className="form-error-summary"
        hidden={!state.summary}
        id="people-form-errors"
        role="alert"
        tabIndex={-1}
      >
        {state.summary ? ERROR_SUMMARY : ""}
      </p>
      <div className="name-grid">
        <div className="name-field">
          <label>
            <span className="field-label">Given name</span>
            <input
              aria-describedby="person-given-name-error"
              autoComplete="given-name"
              maxLength={200}
              name="givenName"
              {...invalid("givenName")}
            />
          </label>
          <small data-field-error="givenName" id="person-given-name-error">
            {state.errors.givenName ?? ""}
          </small>
        </div>
        <label>
          <span className="field-label">
            Middle name <small>Optional</small>
          </span>
          <input
            autoComplete="additional-name"
            maxLength={200}
            name="middleName"
            {...invalid("middleName")}
          />
        </label>
        <label>
          <span className="field-label">
            Family name <small>Optional</small>
          </span>
          <input
            autoComplete="family-name"
            maxLength={200}
            name="familyName"
            {...invalid("familyName")}
          />
        </label>
        <label>
          <span className="field-label">
            Nickname <small>Optional</small>
          </span>
          <input maxLength={200} name="nickname" {...invalid("nickname")} />
        </label>
      </div>
      <div className="partial-person-control">
        <input
          id="person-is-partial"
          name="isPartial"
          type="checkbox"
          {...invalid("isPartial")}
        />
        <span className="partial-person-copy">
          <label htmlFor="person-is-partial">
            <strong>Some identity details are unknown</strong>
          </label>
          <small>
            Use this when the given name or other identity information is
            incomplete. Kinship will not invent a value.
          </small>
          <small data-field-error="isPartial">
            {state.errors.isPartial ?? ""}
          </small>
        </span>
      </div>
      <section
        ref={duplicate}
        className="duplicate-warning"
        hidden={state.duplicate === undefined}
        id="duplicate-warning"
        role="alert"
        tabIndex={-1}
      >
        <h2>Possible duplicate</h2>
        <p id="duplicate-detail">{state.duplicate ?? ""}</p>
        <div className={formActionsVariants()}>
          <button
            className={buttonVariants({ variant: "outline" })}
            disabled={state.pending}
            id="create-anyway"
            onClick={() => void save(true)}
            type="button"
          >
            Create anyway
          </button>
          <button
            className={buttonVariants()}
            disabled={state.pending}
            id="review-person"
            onClick={review}
            type="button"
          >
            Review the names
          </button>
        </div>
      </section>
      <div className={formActionsVariants()}>
        <button
          className={buttonVariants()}
          disabled={state.pending}
          id="save-person"
          type="submit"
        >
          Save person
        </button>
        <button
          className={buttonVariants({ variant: "outline" })}
          disabled={state.pending}
          id="save-add-another"
          type="submit"
        >
          Save and add another
        </button>
      </div>
      <p aria-live="polite" id="people-create-status" role="status">
        {state.status}
      </p>
    </form>
  );
}

/**
 * Mounts the form over the region the page drew (`[data-people-create]`)
 * and answers the function that unmounts it. What was typed carries over;
 * otherwise the given and family names come from the address.
 */
export function mountPeopleCreate(
  root: ParentNode = document,
  navigate?: Navigate,
): () => void {
  const region = root.querySelector<HTMLElement>("[data-people-create]");
  if (!region) return () => undefined;
  const typed = readStaticForm(
    region.querySelector<HTMLFormElement>("#people-create-form"),
  );
  const parameters = new URLSearchParams(globalThis.location.search);
  const initial: Record<string, string> = {};
  for (const name of ["givenName", "familyName"] as const) {
    const prefill = parameters.get(name);
    if (prefill !== null) initial[name] = prefill;
  }
  for (const [name, value] of Object.entries(typed.values)) {
    if (value) initial[name] = value;
  }
  const unmount = mountIsland(
    region,
    PEOPLE_CREATE_ISLAND,
    <PersonCreate initial={initial} navigate={navigate} />,
  );
  typed.restoreFocus(region);
  return unmount;
}
