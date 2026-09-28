/**
 * The person's life-events card (GAP-028, JOURNAL-002).
 *
 * The card lists the person's life events and records, edits, and removes
 * them in one editor; the unified timeline above lists them too and reads
 * again after every change (`person-timeline-changed`). A failure stays
 * local: a refused or unreachable read says so here, with a retry when
 * retrying can help, while every other section stays usable. A workspace
 * that turned the module off sees no card and no request is made; a module
 * turned off since the page loaded hides the card and tells the section
 * navigation. An archived person's events are read-only.
 *
 * State moves through one pure reducer (`life-events.ts`). The one read is
 * the list, through one latest-request slot; a save or removal answers with
 * what the card needs, so the list is not read again after a write. The
 * editor validates with the create route's own contract schema, an editor
 * opened by a click focuses its first field inside that click (REL-051), and
 * opening another event first asks the page's unsaved-changes guard.
 */

import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import { flushSync } from "react-dom";
import type { FieldError } from "react-hook-form";
import {
  createPersonLifeEvent,
  deletePersonLifeEvent,
  listPersonLifeEvents,
  type PersonLifeEvent,
  type PersonLifeEventInput,
  type PersonLifeEventType,
  type ProblemDetails,
  updatePersonLifeEvent,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import {
  buttonVariants,
  formActionsVariants,
} from "@/components/ui/variants.ts";
import { PERSON_TIMELINE_CHANGED_EVENT } from "../../features/interactions/shared.ts";
import { Quiet } from "../../features/person/facts/fact-list.tsx";
import { SectionGlyph } from "../../features/person/section-glyph.tsx";
import { SectionLoading } from "../../features/person/section-loading.tsx";
import { SECTION_HIDDEN_EVENT } from "../../features/person/sections.ts";
import type { StatusRegionProps } from "../../features/person/status-region.ts";
import {
  markFormSaved,
  requestFormDiscard,
  saveWithLockedForm,
} from "../../lib/unsaved-changes.ts";
import {
  settle,
  useContractForm,
  useDocumentEvent,
  useLatestRequest,
} from "../core/index.ts";
import {
  DISCARD_EDIT,
  editorOpeningDisabled,
  eventDate,
  eventTitle,
  formValues,
  initialLifeEventsState,
  type LifeEventEditor as EditorState,
  lifeEventForm,
  type LifeEventPrecision,
  lifeEventsReducer,
  precisionComponents,
  problemMessage,
  rowControlsDisabled,
  sectionState,
  statusLine,
  UNAVAILABLE,
} from "./life-events.ts";

export interface PersonLifeEventsProps {
  readonly personId: string;
  readonly workspaceId: string;
  /** Whether the workspace had the module off when the page loaded. */
  readonly hidden: boolean;
  /** Whether the person was archived when the page loaded. */
  readonly archived: boolean;
  /** The card the island renders into; it carries the section state. */
  readonly section: HTMLElement;
  /** Called once, when the first read has settled either way. */
  readonly onSettled?: () => void;
  /** What the state line spreads to be a live region, if anything. */
  readonly statusRegion?: StatusRegionProps;
}

const BADGES: Readonly<Record<string, string>> = {
  empty: "Empty",
  forbidden: "Forbidden",
  hidden: "Hidden",
  loading: "Loading",
  ready: "Ready",
};

const STATE_ID = "life-events-state";
const FORM_STATE_ID = "life-event-form-state";

/** A save refused with no problem body: the service was not reached. */
const UNREACHED: ProblemDetails = {
  code: "life_events_unavailable",
  detail: UNAVAILABLE,
  status: 503,
  title: "Life events unavailable",
  type: "about:blank",
};

export function PersonLifeEvents(props: PersonLifeEventsProps) {
  const { personId, section, workspaceId } = props;
  const [state, dispatch] = useReducer(
    lifeEventsReducer,
    undefined,
    () => initialLifeEventsState(props.hidden, props.archived),
  );
  const request = useLatestRequest();
  const settled = useRef(props.onSettled);
  const form = useRef<HTMLFormElement | null>(null);
  const stateLine = useRef<HTMLParagraphElement>(null);
  const formState = useRef<HTMLParagraphElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  /** Reads the events and applies the answer if it is still the latest. */
  const read = useCallback(
    (): Promise<void> =>
      request(() => listPersonLifeEvents(personId, workspaceId)).then(
        (answer) => {
          if (!answer) return;
          if (answer.status === "ready" && answer.data) {
            if (answer.data.status === "hidden") {
              dispatch({ type: "hidden" });
              document.dispatchEvent(
                new CustomEvent(SECTION_HIDDEN_EVENT, {
                  detail: { sectionId: "life-events" },
                }),
              );
              return;
            }
            dispatch({
              events: answer.data.events,
              type: "loaded",
              types: answer.data.types,
            });
            return;
          }
          const status = answer.problem?.status ?? 503;
          dispatch({
            detail: answer.problem?.detail ?? UNAVAILABLE,
            status: status === 403
              ? "forbidden"
              : status === 404
              ? "not-found"
              : "error",
            type: "failed",
          });
        },
      ),
    [personId, request, workspaceId],
  );

  // The first read starts in the loading state the island mounted with.
  useEffect(() => {
    const first = props.hidden ? Promise.resolve() : read();
    void first.finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, [props.hidden, read]);

  const shown = sectionState(state);
  useLayoutEffect(() => {
    section.setAttribute("data-section-state", shown);
    section.toggleAttribute("hidden", shown === "hidden");
  }, [section, shown]);

  useLayoutEffect(() => {
    const target = state.focus?.target;
    if (!target) return;
    if (target === "field" && form.current) markFormSaved(form.current);
    const element = {
      add: addButton.current,
      field: form.current?.querySelector<HTMLElement>(
        "input, select, textarea",
      ),
      "form-state": formState.current,
      state: stateLine.current,
    }[target];
    element?.focus();
  }, [state.focus]);

  useDocumentEvent<CustomEvent<{ archived?: unknown; personId?: unknown }>>(
    "person-lifecycle-changed",
    (event) => {
      const detail = event.detail;
      if (typeof detail?.archived !== "boolean") return;
      if (detail.personId !== undefined && detail.personId !== personId) {
        return;
      }
      dispatch({ archived: detail.archived, type: "lifecycle" });
    },
  );

  const open = (event?: PersonLifeEvent) => {
    if (form.current && !requestFormDiscard([form.current], DISCARD_EDIT)) {
      return;
    }
    // The field takes focus inside the opening click: Firefox draws a script
    // focus ring only while it handles the input that asked for it.
    flushSync(() =>
      dispatch(event ? { event, type: "open" } : { type: "open" })
    );
  };

  const timelineChanged = () =>
    document.dispatchEvent(
      new CustomEvent(PERSON_TIMELINE_CHANGED_EVENT, {
        detail: { personIds: [personId] },
      }),
    );

  /** Saves the editor's value; answers the problem that refused it. */
  const save = async (
    input: PersonLifeEventInput,
  ): Promise<ProblemDetails | undefined> => {
    // The editor is open while it submits, and its form is locked (inert)
    // and its Save control disabled until the answer arrives.
    const element = form.current!;
    const { event: existing, generation } = state.editor!;
    dispatch({ type: "saving" });
    const answer = await saveWithLockedForm(
      element,
      () =>
        settle<{ readonly event: PersonLifeEvent }>(() =>
          existing
            ? updatePersonLifeEvent(
              personId,
              existing.id,
              { ...input, expectedUpdatedAt: existing.updatedAt },
              workspaceId,
            )
            : createPersonLifeEvent(personId, input, workspaceId)
        ),
    );
    if (answer.status !== "ready" || !answer.data) {
      dispatch({ generation, type: "save-failed" });
      return answer.problem ?? UNREACHED;
    }
    markFormSaved(element);
    dispatch({ event: answer.data.event, generation, type: "saved" });
    timelineChanged();
    return undefined;
  };

  const remove = async (event: PersonLifeEvent) => {
    if (state.confirming !== event.id) {
      dispatch({ id: event.id, type: "confirm" });
      return;
    }
    dispatch({ id: event.id, type: "remove" });
    const answer = await settle(() =>
      deletePersonLifeEvent(
        personId,
        event.id,
        { expectedUpdatedAt: event.updatedAt },
        workspaceId,
      )
    );
    if (answer.status !== "ready") {
      dispatch({
        message: problemMessage(answer.problem),
        type: "remove-failed",
      });
      return;
    }
    dispatch({ id: event.id, type: "removed" });
    timelineChanged();
  };

  const ready = state.status === "ready";
  const writable = ready && !state.archived;
  const line = state.status === "loading" && state.initial
    ? <SectionLoading label="Loading life events…" />
    : statusLine(state);

  return (
    <>
      <header className="profile-section-heading">
        <SectionGlyph className="profile-section-glyph" name="life-events" />
        <div className="profile-section-title">
          <h3 id="profile-section-life-events-heading">Life events</h3>
          <Badge data-life-event-badge="" variant="status">
            {BADGES[shown] ?? "Unavailable"}
          </Badge>
        </div>
        <button
          className={buttonVariants({ className: "profile-section-cta" })}
          data-life-event-add=""
          disabled={editorOpeningDisabled(state)}
          hidden={!writable}
          onClick={() => open()}
          ref={addButton}
          type="button"
        >
          Add life event
        </button>
      </header>
      <p
        className="section-state"
        data-life-event-state=""
        id={STATE_ID}
        ref={stateLine}
        tabIndex={-1}
        {...props.statusRegion}
      >
        {line}
      </p>
      <Button
        data-life-event-retry=""
        hidden={state.status !== "error"}
        onClick={() => {
          dispatch({ type: "retry" });
          void read();
        }}
        type="button"
        variant="outline"
      >
        Retry life events
      </Button>
      <ol
        aria-label="Saved life events"
        className="life-event-list"
        data-life-event-list=""
        hidden={!ready || state.events.length === 0}
      >
        {state.events.map((event) => (
          <li data-life-event-id={event.id} key={event.id}>
            <div>
              <strong>{eventTitle(event)}</strong>
              <span>{eventDate(event)}</span>
              {event.name && event.typeName
                ? <small>{event.typeName}</small>
                : null}
              {event.note ? <small>{event.note}</small> : null}
            </div>
            {writable
              ? (
                <div className="life-event-actions">
                  <Button
                    disabled={rowControlsDisabled(state, event.id).edit}
                    onClick={() => open(event)}
                    type="button"
                    variant="outline"
                  >
                    <Quiet action="Edit" context={eventTitle(event)} />
                  </Button>
                  <Button
                    disabled={rowControlsDisabled(state, event.id).remove}
                    onClick={() =>
                      void remove(event)}
                    type="button"
                    variant="destructive"
                  >
                    {state.confirming === event.id
                      ? `Confirm remove ${eventTitle(event)}`
                      : <Quiet action="Remove" context={eventTitle(event)} />}
                  </Button>
                </div>
              )
              : null}
          </li>
        ))}
      </ol>
      {state.editor
        ? (
          <LifeEventEditor
            editor={state.editor}
            formRef={form}
            key={state.editor.generation}
            onCancel={() => dispatch({ focus: true, type: "close" })}
            onSave={save}
            stateRef={formState}
            types={state.types}
          />
        )
        : null}
    </>
  );
}

const PRECISIONS: readonly (readonly [LifeEventPrecision, string])[] = [
  ["full", "Year, month, and day"],
  ["year_month", "Year and month"],
  ["month_day", "Month and day; year unknown"],
  ["year", "Year only"],
  ["month", "Month only"],
  ["day", "Day only"],
  ["unknown", "Date unknown"],
];

const MONTHS = Array.from({ length: 12 }, (_, index) => `${index + 1}`);

/** The refusal under a field, which the field points at. */
function fieldError(
  id: string,
  error: FieldError | undefined,
): { readonly control: object; readonly message: ReactNode } {
  if (!error?.message) return { control: {}, message: null };
  return {
    control: { "aria-describedby": id, "aria-invalid": true },
    message: <small data-field-error="" id={id}>{error.message}</small>,
  };
}

/**
 * The editor, drawn from the opened event. Which components it asks for
 * follows the chosen precision; a component the precision drops keeps its
 * field value but is never sent.
 */
function LifeEventEditor(
  props: {
    readonly editor: EditorState;
    readonly formRef: Ref<HTMLFormElement>;
    readonly onCancel: () => void;
    readonly onSave: (
      input: PersonLifeEventInput,
    ) => Promise<ProblemDetails | undefined>;
    readonly stateRef: Ref<HTMLParagraphElement>;
    readonly types: readonly PersonLifeEventType[];
  },
) {
  const { editor, formRef, onCancel, onSave, stateRef, types } = props;
  const { busy, event } = editor;
  const form = useContractForm(lifeEventForm, {
    defaultValues: formValues(event),
  });
  const { errors } = form.formState;
  const precision = form.watch("precision");
  const components = precisionComponents(precision);
  const errorFor = (field: "day" | "month" | "name" | "typeId" | "year") =>
    fieldError(`life-event-${field}-error`, errors[field]);
  const name = errorFor("name");
  const type = errorFor("typeId");
  const year = errorFor("year");
  const month = errorFor("month");
  const day = errorFor("day");
  // An event keeps a retired type; the choice stays offered for it alone.
  const retired = event?.typeId &&
      !types.some((choice) => choice.id === event.typeId)
    ? [{ id: event.typeId, name: `${event.typeName ?? "Type"} (archived)` }]
    : [];
  const submit = form.handleSubmit(async (input) => {
    // The submission drops every blank field before the schema reads it, so
    // an optional member is absent rather than `undefined`.
    const problem = await onSave(input as PersonLifeEventInput);
    if (problem) form.applyProblem(problem);
  });

  return (
    <form
      aria-busy={busy ? "true" : undefined}
      aria-labelledby="life-event-form-heading"
      className="profile-fact-form life-event-form"
      data-life-event-form=""
      method="post"
      noValidate
      onSubmit={(submitted) => void submit(submitted)}
      ref={formRef}
    >
      <h4 id="life-event-form-heading">
        {event ? `Edit ${eventTitle(event)}` : "New life event"}
      </h4>
      <label>
        Name{" "}
        <Input {...form.register("name")} {...name.control} maxLength={200} />
        {name.message}
      </label>
      <label>
        Type
        <select {...form.register("typeId")} {...type.control}>
          <option value="">No type</option>
          {[...types, ...retired].map((choice) => (
            <option key={choice.id} value={choice.id}>{choice.name}</option>
          ))}
        </select>
        {type.message}
      </label>
      <div className="form-grid">
        <label>
          Known components
          <select {...form.register("precision")}>
            {PRECISIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label hidden={!components.has("year")}>
          Year{" "}
          <Input
            {...form.register("year")}
            {...year.control}
            disabled={!components.has("year")}
            inputMode="numeric"
            max={9999}
            min={1}
            type="number"
          />
          {year.message}
        </label>
        <label hidden={!components.has("month")}>
          Month
          <select
            {...form.register("month")}
            {...month.control}
            disabled={!components.has("month")}
          >
            <option value="">Select month</option>
            {MONTHS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
          {month.message}
        </label>
        <label hidden={!components.has("day")}>
          Day{" "}
          <Input
            {...form.register("day")}
            {...day.control}
            disabled={!components.has("day")}
            inputMode="numeric"
            max={31}
            min={1}
            type="number"
          />
          {day.message}
        </label>
      </div>
      <label>
        Note (optional){" "}
        <Textarea {...form.register("note")} maxLength={10000} rows={3} />
      </label>
      <p
        className="section-state"
        id={FORM_STATE_ID}
        ref={stateRef}
        role="alert"
        tabIndex={-1}
      >
        {errors.root?.server?.message}
      </p>
      <div className={formActionsVariants()} data-form-actions="">
        <Button disabled={busy} type="submit">Save life event</Button>
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
      </div>
    </form>
  );
}
