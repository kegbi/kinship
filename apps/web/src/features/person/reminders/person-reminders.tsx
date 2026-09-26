/**
 * A person's reminders card and stay-in-touch rail block as one island
 * (GAP-031).
 *
 * One read answers both sections, and every write refreshes both, so one
 * component owns them: it renders the reminders card into the section it
 * mounts over and the stay-in-touch block into its rail sibling through a
 * portal. Its state moves through one pure reducer (`reminders.ts`). Every
 * read — the first, a refresh after a write, the next page — goes through
 * one latest-request slot; every write goes through one busy owner, so while
 * a save, a disable, or the first read is in flight neither section starts
 * another write, and both say so with `aria-busy`.
 *
 * It tells the hero and the rail what they show — the stay-in-touch due
 * state, the next reminder after a write, the block's count and empty state
 * — through `profile-summary.ts` at the moments `lib/reminders.ts` did: when
 * a read starts and when it answers. Only the profile summary knows the next
 * pending reminder across every record, so a write re-reads it.
 *
 * The cadence form keeps the rail editors' rules (`lib/rail-editors.ts`); the
 * phone sheet moves it and the block's status line, so every element of the
 * block always renders and the form stays last.
 */

import {
  type SyntheticEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import { createPortal, flushSync } from "react-dom";
import {
  createReminder,
  createStayInTouchCadence,
  getPerson,
  listPersonReminders,
  type Reminder,
  setReminderActive,
  type StayInTouchCadence,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { Button } from "@/components/ui/button.tsx";
import { formActionsVariants } from "@/components/ui/variants.ts";
import {
  LoadMore,
  mountIsland,
  settle,
  useDocumentEvent,
  useLatestRequest,
} from "../../../islands/core/index.ts";
import {
  registerRailEditors,
  requestRailEditorOpen,
} from "../../../lib/rail-editors.ts";
import type { TimePreferences } from "../../../lib/time-presentation.ts";
import {
  markFormSaved,
  saveWithLockedForm,
} from "../../../lib/unsaved-changes.ts";
import {
  setNextReminder,
  setRailCount,
  setRailEmpty,
  setStayInTouch,
} from "../profile-summary.ts";
import type { SectionMount } from "../section-mounts.ts";
import {
  CADENCE_FAILED,
  CADENCE_LOADING,
  cadenceText,
  initialRemindersState,
  intervalText,
  nextReminderText,
  type PendingRow,
  REMINDERS_FAILED,
  REMINDERS_LOADING,
  remindersReducer,
  reminderStateText,
  reminderSummary,
  stayInTouchText,
} from "./reminders.ts";

export const PERSON_REMINDERS_ISLAND = "person-reminders";

export interface PersonRemindersProps {
  readonly personId: string;
  readonly workspaceId: string;
  readonly archived: boolean;
  readonly timePreferences?: TimePreferences | undefined;
  /** The two sections the shell drew; the reminders card is the root. */
  readonly sections: {
    readonly reminders: HTMLElement;
    readonly stayInTouch: HTMLElement;
  };
  /** The shell's headings the add controls render into. */
  readonly headings: {
    readonly reminders?: HTMLElement | undefined;
    readonly stayInTouch?: HTMLElement | undefined;
  };
  /** Called once, when the first read has settled either way. */
  readonly onSettled?: () => void;
}

function sectionState(
  status: "loading" | "ready" | "error",
  count: number,
): string {
  return status === "ready" ? count === 0 ? "empty" : "ready" : status;
}

function PendingItem(props: { readonly row: PendingRow | undefined }) {
  if (!props.row) return null;
  return (
    <li aria-busy="true" className="optimistic-save">
      <h3>{props.row.title}</h3>
      <p>{props.row.detail}</p>
    </li>
  );
}

export function PersonReminders(props: PersonRemindersProps) {
  const { personId, sections, timePreferences, workspaceId } = props;
  const [state, dispatch] = useReducer(
    remindersReducer,
    props.archived,
    initialRemindersState,
  );
  const request = useLatestRequest();
  // The one write owner: set in the same task a write starts, so a second
  // submission or click in that task is already refused.
  const busy = useRef(false);
  const reminderRequestId = useRef<string | undefined>(undefined);
  const cadenceRequestId = useRef<string | undefined>(undefined);
  const reminderForm = useRef<HTMLFormElement>(null);
  const cadenceForm = useRef<HTMLFormElement>(null);
  const reminderAdd = useRef<HTMLButtonElement>(null);
  const cadenceAdd = useRef<HTMLButtonElement>(null);
  const cadenceState = useRef<HTMLParagraphElement>(null);
  const settled = useRef(props.onSettled);

  const setBusy = (value: boolean) => {
    busy.current = value;
    dispatch({ busy: value, type: "busy" });
  };

  /**
   * Reads both sections, and with `summary` the profile's next reminder, and
   * applies the answer if it is still the latest.
   */
  const read = (summary: boolean, cursor?: string): Promise<void> => {
    dispatch({ type: "loading" });
    setStayInTouch("Loading cadence…");
    if (summary) setNextReminder("Refreshing…");
    setRailEmpty("stay-in-touch", false);
    return request(async () => {
      const [list, profile] = await Promise.all([
        settle(() =>
          listPersonReminders(personId, workspaceId, cursor ? { cursor } : {})
        ),
        summary
          ? settle(() => getPerson(personId, workspaceId, "summary"))
          : undefined,
      ]);
      return { ok: true as const, value: { list, profile } };
    }).then((answer) => {
      if (!answer?.data) return;
      const { list, profile } = answer.data;
      if (summary) {
        setNextReminder(
          nextReminderText(profile?.data?.dueInformation, timePreferences),
        );
      }
      if (list.status !== "ready" || !list.data) {
        dispatch({ type: "failed" });
        setStayInTouch("Unavailable");
        setRailCount("stay-in-touch", undefined);
        setRailEmpty("stay-in-touch", false);
        return;
      }
      const cadences = list.data.cadences.filter((cadence) => cadence.isActive);
      dispatch({
        cadences,
        continued: cursor !== undefined,
        nextCursor: list.data.nextCursor,
        reminders: list.data.reminders,
        type: "loaded",
      });
      setStayInTouch(stayInTouchText(cadences));
      setRailCount("stay-in-touch", cadences.length);
      setRailEmpty("stay-in-touch", cadences.length === 0);
    });
  };

  /** A read that holds both sections, unless a write already does. */
  const reload = async (): Promise<void> => {
    if (busy.current) return;
    setBusy(true);
    try {
      await read(false);
    } finally {
      setBusy(false);
    }
  };

  /** Takes the write owner, unless the person is read-only or it is held. */
  const begin = (): boolean => {
    if (state.archived || busy.current) return false;
    setBusy(true);
    return true;
  };

  // The first read starts in the loading state the island mounted with.
  const first = useEffectEvent(() => reload());
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  useLayoutEffect(() => {
    const pairs = [
      [sections.reminders, state.reminders.length],
      [sections.stayInTouch, state.cadences.length],
    ] as const;
    for (const [section, count] of pairs) {
      section.setAttribute(
        "data-section-state",
        sectionState(state.status, count),
      );
      if (state.busy) section.setAttribute("aria-busy", "true");
      else section.removeAttribute("aria-busy");
    }
  }, [
    sections,
    state.busy,
    state.cadences.length,
    state.reminders.length,
    state.status,
  ]);

  // The rail's one-editor rule and, on a phone, the modal sheet. Another
  // editor closing this one leaves focus where the reader is going.
  useLayoutEffect(() => {
    const element = cadenceForm.current!;
    return registerRailEditors([element], () => {
      element.reset();
      flushSync(() => dispatch({ editor: "cadence", type: "close" }));
    });
  }, []);

  useLayoutEffect(() => {
    const target = state.focus?.target;
    if (!target) return;
    const field = (form: HTMLFormElement | null) =>
      form?.querySelector<HTMLElement>("input, select, textarea");
    ({
      "cadence-add": cadenceAdd.current,
      "cadence-field": field(cadenceForm.current),
      "cadence-state": cadenceState.current,
      "reminder-add": reminderAdd.current,
      "reminder-field": field(reminderForm.current),
    })[target]?.focus();
  }, [state.focus]);

  useDocumentEvent<
    CustomEvent<{ readonly archived?: unknown; readonly personId?: unknown }>
  >("person-lifecycle-changed", (event) => {
    const detail = event.detail;
    if (detail?.personId !== personId || typeof detail.archived !== "boolean") {
      return;
    }
    dispatch({ archived: detail.archived, type: "lifecycle" });
    // A write in flight refreshes both sections before it lets go.
    if (!detail.archived) void reload();
  });

  const disable = async (reminder: Reminder) => {
    if (!begin()) return;
    dispatch({
      notice: "Disabling reminder…",
      section: "reminder",
      type: "notice",
    });
    try {
      const answer = await settle(() =>
        setReminderActive(reminder.id, false, workspaceId)
      );
      dispatch({
        notice: answer.status === "ready"
          ? "Reminder disabled."
          : "Reminder could not be disabled.",
        section: "reminder",
        type: "notice",
      });
      if (answer.status === "ready") await read(true);
    } finally {
      setBusy(false);
    }
  };

  const saveReminder = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = reminderForm.current!;
    if (!begin()) return;
    dispatch({
      notice: "Saving reminder…",
      section: "reminder",
      type: "notice",
    });
    const requestId = reminderRequestId.current ??= crypto.randomUUID();
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const title = value("title");
    const anchorOn = value("anchorOn");
    const sendTime = value("sendTime");
    dispatch({
      row: {
        detail: `Saving for ${anchorOn || "the selected date"} at ${
          sendTime || "the selected time"
        }…`,
        title: title || "Untitled reminder",
      },
      section: "reminder",
      type: "pending",
    });
    try {
      const answer = await settle(() =>
        createReminder({
          anchorOn,
          personId,
          recurrenceInterval: Number(value("recurrenceInterval")),
          recurrenceUnit: value("recurrenceUnit") as Reminder["recurrenceUnit"],
          requestId,
          sendTime,
          title,
        }, workspaceId)
      );
      const created = answer.status === "ready";
      dispatch({
        notice: created
          ? "Reminder created."
          : "Reminder could not be saved. Review the calendar fields.",
        section: "reminder",
        type: "notice",
      });
      if (created) {
        reminderRequestId.current = undefined;
        form.reset();
        dispatch({ editor: "reminder", type: "close" });
        await read(true);
      }
    } finally {
      dispatch({ row: undefined, section: "reminder", type: "pending" });
      setBusy(false);
    }
  };

  const saveCadence = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = cadenceForm.current!;
    if (!begin()) return;
    dispatch({ notice: "Saving cadence…", section: "cadence", type: "notice" });
    const requestId = cadenceRequestId.current ??= crypto.randomUUID();
    const data = new FormData(form);
    const intervalCount = Number(
      String(data.get("intervalCount") ?? "").trim(),
    );
    const intervalUnit = String(data.get("intervalUnit") ?? "")
      .trim() as StayInTouchCadence["intervalUnit"];
    dispatch({
      row: {
        detail: "Saving stay-in-touch cadence…",
        title: intervalText(intervalCount, intervalUnit),
      },
      section: "cadence",
      type: "pending",
    });
    try {
      const answer = await saveWithLockedForm(
        form,
        () =>
          settle(() =>
            createStayInTouchCadence({
              intervalCount,
              intervalUnit,
              personId,
              requestId,
            }, workspaceId)
          ),
      );
      const saved = answer.status === "ready";
      dispatch({
        focus: !saved,
        notice: saved ? "Cadence saved." : "Cadence could not be saved.",
        section: "cadence",
        type: "notice",
      });
      if (saved) {
        cadenceRequestId.current = undefined;
        markFormSaved(form);
        dispatch({ editor: "cadence", type: "close" });
        await read(true);
      }
    } finally {
      dispatch({ row: undefined, section: "cadence", type: "pending" });
      setBusy(false);
    }
  };

  const openCadence = (opener: HTMLElement) => {
    if (!requestRailEditorOpen(cadenceForm.current!, false, opener)) return;
    dispatch({ editor: "cadence", type: "open" });
  };

  const { archived, status } = state;
  const locked = state.busy || archived;
  const addable = status === "ready" && !archived;
  const reminderLine = status === "loading"
    ? REMINDERS_LOADING
    : state.reminderNotice ??
      (status === "error"
        ? REMINDERS_FAILED
        : reminderSummary(state.reminders.length, !!state.nextCursor));
  const cadenceLine = status === "loading"
    ? CADENCE_LOADING
    : state.cadenceNotice ??
      (status === "error"
        ? CADENCE_FAILED
        : state.cadences.length
        ? "Stay-in-touch cadence is active."
        : "No stay-in-touch cadence yet.");

  const addReminder = (
    <Button
      className="profile-section-cta"
      data-reminder-add=""
      disabled={locked}
      hidden={!addable}
      onClick={() => dispatch({ editor: "reminder", type: "open" })}
      ref={reminderAdd}
      type="button"
    >
      Add reminder
    </Button>
  );
  const addCadence = (
    <Button
      aria-label="Add stay-in-touch cadence"
      className="profile-rail-add"
      data-cadence-add=""
      disabled={locked}
      hidden={!addable}
      onClick={(event) => openCadence(event.currentTarget)}
      ref={cadenceAdd}
      type="button"
    >
      <span aria-hidden="true">+</span>
    </Button>
  );

  return (
    <>
      {props.headings.reminders
        ? createPortal(addReminder, props.headings.reminders)
        : null}
      {props.headings.stayInTouch
        ? createPortal(addCadence, props.headings.stayInTouch)
        : null}
      <p className="section-state" data-reminder-state="">{reminderLine}</p>
      <ul
        aria-label="Person reminders"
        className="task-list reminder-list"
        data-reminder-list=""
        id="person-reminder-list"
      >
        {state.reminders.map((reminder) => (
          <li className="reminder-item" key={reminder.id}>
            <h3>{reminder.title}</h3>
            <p>{reminderStateText(reminder, timePreferences)}</p>
            {!archived && reminder.isActive
              ? (
                <Button
                  disabled={locked}
                  onClick={() => void disable(reminder)}
                  type="button"
                  variant="outline"
                >
                  Disable reminder
                </Button>
              )
              : null}
          </li>
        ))}
        <PendingItem row={state.pendingReminder} />
      </ul>
      <LoadMore
        controls="person-reminder-list"
        // A write's refresh owns the list until it lands and brings the
        // cursor back, so no page may retire it.
        cursor={state.busy ? undefined : state.nextCursor}
        label="Load more reminders"
        list="reminders"
        onLoad={(cursor) => read(false, cursor)}
      />
      <form
        className="profile-fact-form"
        data-reminder-form=""
        hidden={!state.reminderOpen}
        method="post"
        noValidate
        onSubmit={(event) => void saveReminder(event)}
        ref={reminderForm}
      >
        <label>
          Title <input maxLength={500} name="title" required />
        </label>
        <label>
          First date <input name="anchorOn" required type="date" />
        </label>
        <label>
          Send time{" "}
          <input defaultValue="09:00" name="sendTime" required type="time" />
        </label>
        <label>
          Repeat{" "}
          <select name="recurrenceUnit">
            <option value="none">Once</option>
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
          </select>
        </label>
        <label>
          Every{" "}
          <input
            defaultValue="1"
            max={100}
            min={1}
            name="recurrenceInterval"
            required
            type="number"
          />
        </label>
        <div className={formActionsVariants()} data-form-actions="">
          <Button disabled={locked} type="submit">Save reminder</Button>
          <Button
            data-reminder-cancel=""
            onClick={() => {
              reminderForm.current?.reset();
              dispatch({ editor: "reminder", focus: true, type: "close" });
            }}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
        </div>
      </form>
      {createPortal(
        <>
          <p
            className="section-state"
            data-cadence-state=""
            data-rail-editor-feedback=""
            ref={cadenceState}
            tabIndex={-1}
          >
            {cadenceLine}
          </p>
          <ul
            aria-label="Stay-in-touch cadence"
            className="task-list"
            data-cadence-list=""
          >
            {state.cadences.map((cadence) => (
              <li key={cadence.id}>{cadenceText(cadence, timePreferences)}</li>
            ))}
            <PendingItem row={state.pendingCadence} />
          </ul>
          <form
            className="profile-fact-form"
            data-cadence-form=""
            hidden={!state.cadenceOpen}
            method="post"
            noValidate
            onSubmit={(event) => void saveCadence(event)}
            ref={cadenceForm}
          >
            <label>
              Reconnect every{" "}
              <input
                defaultValue="1"
                max={100}
                min={1}
                name="intervalCount"
                required
                type="number"
              />
            </label>
            <label>
              Calendar unit{" "}
              <select name="intervalUnit">
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
                <option value="day">Day</option>
              </select>
            </label>
            <div className={formActionsVariants()} data-form-actions="">
              <Button disabled={locked} type="submit">Save cadence</Button>
              <Button
                data-cadence-cancel=""
                onClick={() => {
                  cadenceForm.current?.reset();
                  dispatch({ editor: "cadence", focus: true, type: "close" });
                }}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </div>
          </form>
        </>,
        sections.stayInTouch,
      )}
    </>
  );
}

/**
 * Mounts the island over the reminders card, with the stay-in-touch block
 * beside it, and resolves, once the first read has settled, with the
 * function that unmounts it. Each section's heading stays: the rail island
 * shows the block's count there and this island each add control. Without
 * both sections and their forms, the markup the shell always draws, there
 * is nothing to own.
 */
export const mountPersonReminders: SectionMount = (container, props) => {
  const reminders = container.querySelector<HTMLElement>(
    '[data-profile-section="reminders"]',
  );
  const stayInTouch = container.querySelector<HTMLElement>(
    '[data-profile-section="stay-in-touch"]',
  );
  if (
    !reminders?.querySelector("[data-reminder-form]") ||
    !stayInTouch?.querySelector("[data-cadence-form]")
  ) return Promise.resolve(() => undefined);
  const heading = (section: HTMLElement, add: string) => {
    const found = section.querySelector<HTMLElement>(":scope > header") ??
      undefined;
    found?.querySelector(add)?.remove();
    return found;
  };
  const headings = {
    reminders: heading(reminders, "[data-reminder-add]"),
    stayInTouch: heading(stayInTouch, "[data-cadence-add]"),
  };
  // The block renders through a portal, which appends; the shell's body goes
  // in the same task as the first commit, so nothing blank is painted.
  stayInTouch.replaceChildren(
    ...(headings.stayInTouch ? [headings.stayInTouch] : []),
  );
  return new Promise((resolve) => {
    const unmount = mountIsland(
      reminders,
      PERSON_REMINDERS_ISLAND,
      <PersonReminders
        archived={props.archived}
        headings={headings}
        onSettled={() => resolve(unmount)}
        personId={props.personId}
        sections={{ reminders, stayInTouch }}
        timePreferences={props.preferences}
        workspaceId={props.workspaceId}
      />,
    );
    if (headings.reminders) reminders.prepend(headings.reminders);
  });
};
