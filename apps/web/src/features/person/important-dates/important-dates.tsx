/**
 * The important-dates rail block as an island (GAP-031).
 *
 * The block lists a person's dates with only the components each one's
 * precision declares, edits them in one form the rail presents inline or, on
 * a phone, as a sheet, and deletes a date only on a second, confirming press.
 * Its state moves through one pure reducer (`dates.ts`); its one read is the
 * first list, through one latest-request slot, and every save or delete
 * answers with what the block needs, so nothing is read again after a write.
 *
 * It tells the hero and the rail what it shows — the block's count and empty
 * state, the birthday and first-meeting vitals — through `profile-summary.ts`
 * whenever its dates change, exactly as the vanilla block it replaced did.
 *
 * The form keeps the rail editors' rules (`lib/rail-editors.ts`): opening it
 * asks the page's unsaved-changes guard before any other editor closes, and
 * another editor opening closes this one without taking focus. The form is
 * the block's last element and every element before it always renders,
 * because the phone sheet moves the form.
 */

import {
  type ChangeEvent,
  type SyntheticEvent,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import { createPortal, flushSync } from "react-dom";
import {
  createImportantDate,
  deleteImportantDate,
  type ImportantDate,
  listImportantDates,
  updateImportantDate,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  formActionsVariants,
  skeletonVariants,
} from "@/components/ui/variants.ts";
import {
  mountIsland,
  settle,
  useDocumentEvent,
  useLatestRequest,
} from "../../../islands/core/index.ts";
import {
  registerRailEditors,
  requestRailEditorOpen,
} from "../../../lib/rail-editors.ts";
import {
  markFormSaved,
  saveWithLockedForm,
} from "../../../lib/unsaved-changes.ts";
import { Quiet } from "../facts/fact-list.tsx";
import {
  setFirstMeetingDate,
  setRailCount,
  setRailEmpty,
  setVitalStat,
} from "../profile-summary.ts";
import type { SectionMount } from "../section-mounts.ts";
import {
  collapsedDateIds,
  type DateComponent,
  type DateEditor,
  type DateField,
  dateInput,
  type DateKind,
  type DatePrecision,
  datesReducer,
  dateTitle,
  DELETE_UNAVAILABLE,
  formatBirthday,
  formatImportantDate,
  formProblem,
  initialDatesState,
  precisionComponents,
  problemMessage,
  schedulingText,
  summaryText,
} from "./dates.ts";

/**
 * The one-line skeleton the static shell draws in the block's status line
 * (`PersonSection.astro`), drawn again until the first answer arrives, so
 * hydration never flashes an empty line and the loading label stays readable.
 */
function RailLoading(props: { readonly label: string }) {
  return (
    <>
      <span className="sr-only">{props.label}</span>
      <span
        aria-hidden="true"
        className={skeletonVariants({ shape: "line-80" })}
        data-slot="skeleton"
      />
    </>
  );
}

export const IMPORTANT_DATES_ISLAND = "person-important-dates";

export interface ImportantDatesProps {
  readonly personId: string;
  readonly workspaceId: string;
  readonly archived: boolean;
  /** The block the island renders into; it carries the section state. */
  readonly root: HTMLElement;
  /** The shell's heading the add control renders into. */
  readonly heading?: HTMLElement | undefined;
  /** Called once, when the first read has settled either way. */
  readonly onSettled?: () => void;
}

/** Tells the hero and the rail what the block shows. */
function publishDates(dates: readonly ImportantDate[], now: Date): void {
  setRailCount("important-dates", dates.length);
  setRailEmpty("important-dates", dates.length === 0);
  const birthday = dates.find((date) => date.kind === "birthday");
  setVitalStat(
    "birthday",
    birthday ? formatBirthday(birthday, now) : undefined,
  );
  const firstMeeting = dates.find((date) => date.kind === "first_met");
  setFirstMeetingDate(
    firstMeeting ? formatImportantDate(firstMeeting) : undefined,
  );
}

const STATE_ID = "important-dates-state";
const FORM_STATE_ID = "important-date-form-state";

export function ImportantDates(props: ImportantDatesProps) {
  const { personId, root, workspaceId } = props;
  const [state, dispatch] = useReducer(
    datesReducer,
    props.archived,
    initialDatesState,
  );
  const request = useLatestRequest();
  const form = useRef<HTMLFormElement>(null);
  const stateLine = useRef<HTMLParagraphElement>(null);
  const formState = useRef<HTMLParagraphElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  const settled = useRef(props.onSettled);

  useEffect(() => {
    void request(() => listImportantDates(personId, workspaceId)).then(
      (answer) => {
        if (!answer) return;
        if (answer.status === "ready" && answer.data) {
          dispatch({ dates: answer.data.dates, type: "loaded" });
          return;
        }
        const denied = answer.problem?.status === 401 ||
          answer.problem?.status === 403;
        dispatch({
          message: problemMessage(answer.problem),
          status: denied ? "forbidden" : "error",
          type: "failed",
        });
      },
    ).finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, [personId, request, workspaceId]);

  // What the block shows reaches the hero and the rail after each change.
  useEffect(() => {
    if (state.status === "loading") return;
    if (state.status === "ready") publishDates(state.dates, new Date());
    else {
      setRailCount("important-dates", undefined);
      setRailEmpty("important-dates", false);
    }
  }, [state.dates, state.status]);

  useLayoutEffect(() => {
    root.setAttribute("data-section-state", state.status);
  }, [root, state.status]);

  // The rail's one-editor rule and, on a phone, the modal sheet. Another
  // editor closing this one leaves focus where the reader is going.
  useLayoutEffect(() => {
    const element = form.current!;
    return registerRailEditors([element], () => {
      element.reset();
      flushSync(() => dispatch({ type: "close" }));
    });
  }, []);

  useLayoutEffect(() => {
    const target = state.focus?.target;
    if (!target) return;
    if (target === "field" && form.current) markFormSaved(form.current);
    const element = {
      add: addButton.current,
      field: form.current?.querySelector<HTMLElement>(
        "input:not([type=hidden]), select",
      ),
      "form-state": formState.current,
      state: stateLine.current,
    }[target];
    element?.focus();
  }, [state.focus]);

  useDocumentEvent<CustomEvent<{ readonly archived?: unknown }>>(
    "person-lifecycle-changed",
    (event) => {
      const archived = event.detail?.archived;
      if (typeof archived === "boolean") {
        dispatch({ archived, type: "lifecycle" });
      }
    },
  );

  const open = (date: ImportantDate | undefined, opener: HTMLElement) => {
    const element = form.current;
    if (!element || !requestRailEditorOpen(element, true, opener)) return;
    element.reset();
    dispatch(date ? { date, type: "open" } : { type: "open" });
  };

  const cancel = () => {
    form.current?.reset();
    dispatch({ focus: true, type: "close" });
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = form.current;
    const editor = state.editor;
    if (!element || !editor || saving.current) return;
    if (!element.reportValidity()) return;
    const data = new FormData(element);
    const text = (name: string) => String(data.get(name) ?? "");
    const input = dateInput({
      day: text("day"),
      isAgeBased: data.has("isAgeBased"),
      isYearApproximate: data.has("isYearApproximate"),
      kind: editor.kind,
      label: text("label"),
      month: text("month"),
      notes: text("notes"),
      precision: editor.precision,
      year: text("year"),
    });
    const existing = editor.date;
    saving.current = true;
    const answer = await saveWithLockedForm(
      element,
      () =>
        settle<{ readonly date: ImportantDate }>(() =>
          existing
            ? updateImportantDate(
              personId,
              existing.id,
              { ...input, expectedUpdatedAt: existing.updatedAt },
              workspaceId,
            )
            : createImportantDate(personId, input, workspaceId)
        ),
    );
    saving.current = false;
    if (answer.status !== "ready" || !answer.data) {
      dispatch({ problem: formProblem(answer.problem), type: "save-failed" });
      return;
    }
    markFormSaved(element);
    dispatch({ date: answer.data.date, type: "saved" });
  };

  const remove = async (date: ImportantDate) => {
    if (state.confirming !== date.id) {
      dispatch({ id: date.id, type: "confirm" });
      return;
    }
    dispatch({ id: date.id, type: "delete" });
    const answer = await settle(() =>
      deleteImportantDate(
        personId,
        date.id,
        { expectedUpdatedAt: date.updatedAt },
        workspaceId,
      )
    );
    if (answer.status !== "ready") {
      dispatch({
        message: answer.problem
          ? problemMessage(answer.problem)
          : DELETE_UNAVAILABLE,
        type: "delete-failed",
      });
      return;
    }
    dispatch({ id: date.id, type: "deleted" });
  };

  const { archived, dates, status } = state;
  const ready = status === "ready";
  const collapsed = ready ? collapsedDateIds(dates, new Date()) : new Set();
  const summary = ready && state.feedback === undefined;
  const add = (
    <Button
      aria-label="Add important date"
      className="profile-rail-add"
      hidden={!ready || archived}
      id="important-date-add"
      onClick={(event) => open(undefined, event.currentTarget)}
      ref={addButton}
      type="button"
    >
      <span aria-hidden="true">+</span>
    </Button>
  );

  return (
    <>
      {props.heading ? createPortal(add, props.heading) : null}
      <p
        className="section-state"
        data-rail-summary={summary && !archived ? "true" : undefined}
        id={STATE_ID}
        ref={stateLine}
        tabIndex={-1}
      >
        {status === "loading"
          ? <RailLoading label="Loading important dates…" />
          : state.feedback ?? summaryText(dates, archived)}
      </p>
      <ul
        aria-label="Saved important dates"
        className="important-dates-list"
        id="important-dates-list"
      >
        {dates.map((date) => (
          <li
            hidden={collapsed.has(date.id) && !state.expanded}
            key={date.id}
          >
            <div>
              <strong>{dateTitle(date)}</strong>
              <span>{formatImportantDate(date)}</span>
              <small>{schedulingText(date)}</small>
            </div>
            {archived ? null : (
              <div className="important-date-actions">
                <Button
                  onClick={(event) => open(date, event.currentTarget)}
                  type="button"
                  variant="outline"
                >
                  <Quiet action="Edit" context={dateTitle(date)} />
                </Button>
                <Button
                  className="profile-rail-remove"
                  disabled={state.deleting === date.id}
                  onClick={() => void remove(date)}
                  type="button"
                  variant="destructive"
                >
                  {state.confirming === date.id
                    ? `Confirm delete ${dateTitle(date)}`
                    : <Quiet action="Delete" context={dateTitle(date)} />}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Button
        aria-expanded={state.expanded}
        className="profile-rail-summary-control profile-rail-expander"
        data-important-dates-expander=""
        hidden={collapsed.size === 0}
        onClick={() => dispatch({ type: "expand" })}
        type="button"
        variant="outline"
      >
        <Quiet
          action={state.expanded
            ? "Show fewer"
            : `Show all (${collapsed.size})`}
          context="important dates"
        />
      </Button>
      <form
        className="important-date-form"
        hidden={state.editor === undefined}
        id="important-date-form"
        method="post"
        noValidate
        onSubmit={(event) => void submit(event)}
        ref={form}
      >
        {state.editor
          ? (
            <DateFields
              editor={state.editor}
              key={state.editor.generation}
              onKind={(kind) => dispatch({ kind, type: "kind" })}
              onPrecision={(precision) =>
                dispatch({ precision, type: "precision" })}
            />
          )
          : null}
        <p className="form-hint">
          Annual reminders are scheduled only when both month and day are known.
          Missing components are never invented.
        </p>
        <p
          className="section-state"
          id={FORM_STATE_ID}
          ref={formState}
          role="alert"
          tabIndex={-1}
        >
          {state.editor?.problem?.message}
        </p>
        <div className={formActionsVariants()} data-form-actions="">
          <Button type="submit">Save date</Button>
          <Button
            id="important-date-cancel"
            onClick={cancel}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}

const KINDS: readonly (readonly [DateKind, string])[] = [
  ["birthday", "Birthday"],
  ["first_met", "First meeting"],
  ["deceased", "Date of death"],
  ["custom", "Custom"],
];

const PRECISIONS: readonly (readonly [DatePrecision, string])[] = [
  ["full", "Year, month, and day"],
  ["year_month", "Year and month"],
  ["month_day", "Month and day; year unknown"],
  ["year", "Year only"],
  ["month", "Month only"],
  ["day", "Day only"],
  ["unknown", "Date unknown"],
];

const MONTHS = Array.from({ length: 12 }, (_, index) => `${index + 1}`);

/**
 * The editor's fields, drawn from the opened date. Only the kind and the
 * precision are the reducer's, because they decide which fields exist; the
 * rest stay the form's own until it is submitted.
 */
function DateFields(
  props: {
    readonly editor: DateEditor;
    readonly onKind: (kind: DateKind) => void;
    readonly onPrecision: (precision: DatePrecision) => void;
  },
) {
  const { date, kind, precision, problem } = props.editor;
  const components = precisionComponents(precision);
  const hasYear = components.has("year");
  const custom = kind === "custom";
  const invalid = (field: DateField) =>
    problem?.field === field
      ? { "aria-describedby": FORM_STATE_ID, "aria-invalid": true as const }
      : {};
  const active = (component: DateComponent) => components.has(component);

  // A component the new precision drops loses its value, so nothing hidden
  // is ever sent; a year the precision drops takes its flags with it.
  const choosePrecision = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.currentTarget.value as DatePrecision;
    const keeps = precisionComponents(next);
    const fields = event.currentTarget.form!.elements;
    for (const component of ["year", "month", "day"] as const) {
      if (keeps.has(component)) continue;
      (fields.namedItem(component) as HTMLInputElement).value = "";
    }
    if (!keeps.has("year")) {
      for (const flag of ["isYearApproximate", "isAgeBased"]) {
        (fields.namedItem(flag) as HTMLInputElement).checked = false;
      }
    }
    props.onPrecision(next);
  };
  const chooseKind = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.currentTarget.value as DateKind;
    if (next !== "custom") {
      (event.currentTarget.form!.elements.namedItem("label") as
        | HTMLInputElement
        | null)!.value = "";
    }
    props.onKind(next);
  };

  return (
    <>
      <div className="form-grid">
        <label>
          Date type
          <select
            id="important-date-kind"
            name="kind"
            onChange={chooseKind}
            value={kind}
          >
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label hidden={!custom} id="important-date-label-row">
          Custom label
          <input
            defaultValue={date?.label ?? ""}
            id="important-date-label"
            maxLength={200}
            name="label"
            required={custom}
            {...invalid("label")}
          />
        </label>
        <label>
          Known components
          <select
            id="important-date-precision"
            name="precision"
            onChange={choosePrecision}
            value={precision}
          >
            {PRECISIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label data-date-component="year" hidden={!active("year")}>
          Year
          <input
            defaultValue={date?.year === undefined ? "" : `${date.year}`}
            disabled={!active("year")}
            id="important-date-year"
            inputMode="numeric"
            max={9999}
            min={1}
            name="year"
            required={active("year")}
            type="number"
            {...invalid("year")}
          />
        </label>
        <label data-date-component="month" hidden={!active("month")}>
          Month
          <select
            defaultValue={date?.month === undefined ? "" : `${date.month}`}
            disabled={!active("month")}
            id="important-date-month"
            name="month"
            required={active("month")}
            {...invalid("month")}
          >
            <option value="">Select month</option>
            {MONTHS.map((month) => (
              <option key={month} value={month}>{month}</option>
            ))}
          </select>
        </label>
        <label data-date-component="day" hidden={!active("day")}>
          Day
          <input
            defaultValue={date?.day === undefined ? "" : `${date.day}`}
            disabled={!active("day")}
            id="important-date-day"
            inputMode="numeric"
            max={31}
            min={1}
            name="day"
            required={active("day")}
            type="number"
            {...invalid("day")}
          />
        </label>
      </div>
      <label
        className="checkbox-row"
        hidden={!hasYear}
        id="important-date-approximate-row"
      >
        <input
          defaultChecked={date?.isYearApproximate ?? false}
          disabled={!hasYear}
          id="important-date-approximate"
          name="isYearApproximate"
          type="checkbox"
        />
        The stated year is approximate
      </label>
      <label className="checkbox-row">
        <input
          defaultChecked={date?.isAgeBased ?? false}
          disabled={!hasYear}
          id="important-date-age"
          name="isAgeBased"
          type="checkbox"
        />
        Show age when the year is known
      </label>
      <label>
        Notes (optional)
        <textarea
          defaultValue={date?.notes ?? ""}
          id="important-date-notes"
          maxLength={2000}
          name="notes"
          rows={3}
        />
      </label>
    </>
  );
}

/**
 * Mounts the block over the element the shell drew for it and resolves, once
 * its first read has settled, with the function that unmounts it. The
 * block's heading stays: the rail island shows the count there and this
 * island its add control. Without the block and its form, the markup the
 * shell always draws, there is nothing to own.
 */
export const mountImportantDates: SectionMount = (container, props) => {
  const root = container.querySelector<HTMLElement>(
    "#profile-section-important-dates",
  );
  if (!root?.querySelector("#important-date-form")) {
    return Promise.resolve(() => undefined);
  }
  const heading = root.querySelector<HTMLElement>(":scope > header") ??
    undefined;
  heading?.querySelector("#important-date-add")?.remove();
  return new Promise((resolve) => {
    const unmount = mountIsland(
      root,
      IMPORTANT_DATES_ISLAND,
      <ImportantDates
        archived={props.archived}
        heading={heading}
        onSettled={() => resolve(unmount)}
        personId={props.personId}
        root={root}
        workspaceId={props.workspaceId}
      />,
    );
    if (heading) root.prepend(heading);
  });
};
