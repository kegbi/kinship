/**
 * Workspace personalization (GAP-033): profile modules and the workspace's
 * controlled vocabularies, one `?section=` at a time, as one island over the
 * layout `personalization.astro` drew.
 *
 * One read slot loads a section, so only the latest read lands; while one
 * is in flight every mutation control is inert, and a change the reader
 * asked for holds them until the section it changed has been read again.
 * Section links push an indexed history entry; Back and Forward return to
 * it, and a draft is never discarded without asking: a refused step puts
 * the reader back on the entry they were on. The rows and the create form
 * are uncontrolled drafts compared, as the page's forms, against the
 * baseline the last authoritative read set (`personalization.ts` holds the
 * rules).
 */

import {
  type SyntheticEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import {
  type ApiResult,
  type ContactMethodKind,
  createPersonalizationEntry,
  deletePersonalizationEntry,
  listPersonalizationEntries,
  type PersonalizationEntry,
  type PersonalizationSection,
  updatePersonalizationEntry,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { badgeVariants } from "@/components/ui/variants.ts";
import { settle, useLatestRequest } from "../../../islands/core/index.ts";
import { mountSettingsSurface } from "../form/settings-form.tsx";
import { resolveSettingsContext } from "../shared/context.ts";
import { useUnsavedGuard } from "../shared/hooks.ts";
import {
  CONTACT_KIND_LABELS,
  CONTACT_METHOD_KINDS,
  dirtyLine,
  draftRules,
  entryCapabilities,
  entryDetail,
  entryReadOnly,
  FINISH_DRAFT,
  historyValue,
  initialPersonalization,
  PERSONALIZATION_SECTIONS,
  type PersonalizationHistoryState,
  personalizationHistoryState,
  personalizationReducer,
  type PersonalizationState,
  type RenderedSection,
  resolvePersonalizationSection,
  sectionLabel,
} from "./personalization.ts";

export const PERSONALIZATION_ISLAND = "settings-personalization";

const NAVIGATION_CONFIRM =
  "You have unsaved personalization changes. Discard them and continue?";
const SWITCH_CONFIRM =
  "You have unsaved personalization changes. Discard them and switch workspaces?";
const BLOCKED_TITLE =
  "Save or revert the active draft before using this action.";

type LoadOutcome = "loaded" | "failed" | "stale";

type DraftControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** One control's value: its checked state for a checkbox or radio. */
type DraftValue = string | boolean;

export interface FormBaseline {
  readonly snapshot: string;
  readonly values: readonly (readonly [DraftControl, DraftValue])[];
}

/** The controls a draft is made of: every named field the form holds. */
function draftControls(form: HTMLFormElement): DraftControl[] {
  return Array.from(
    form.querySelectorAll<DraftControl>(
      "input[name], select[name], textarea[name]",
    ),
  ).filter((control) => !["button", "reset", "submit"].includes(control.type));
}

function checkable(control: DraftControl): control is HTMLInputElement {
  return control.type === "checkbox" || control.type === "radio";
}

function valueOf(control: DraftControl): DraftValue {
  return checkable(control) ? control.checked : control.value;
}

/** A draft's values, as the dirty check compares them. */
export function draftSnapshot(form: HTMLFormElement): string {
  return JSON.stringify(
    draftControls(form).map((control) => [control.name, valueOf(control)]),
  );
}

export function baselineOf(form: HTMLFormElement): FormBaseline {
  return {
    snapshot: draftSnapshot(form),
    values: draftControls(form).map((control) => [control, valueOf(control)]),
  };
}

export function restore(saved: FormBaseline): void {
  for (const [control, value] of saved.values) {
    if (typeof value === "boolean") {
      (control as HTMLInputElement).checked = value;
    } else control.value = value;
  }
}

function field(form: HTMLFormElement, name: string): HTMLInputElement | null {
  return form.elements.namedItem(name) as HTMLInputElement | null;
}

/** What a create form asks the server to create, or `undefined`. */
function createInput(
  form: HTMLFormElement,
  section: PersonalizationSection,
  count: number,
) {
  const name = field(form, "name")?.value.trim() ?? "";
  if (section === "reminder-rules") {
    return { daysBefore: Number(field(form, "daysBefore")?.value) };
  }
  if (section === "relationship-types") {
    return {
      forwardLabel: field(form, "forwardLabel")?.value.trim() ?? "",
      reverseLabel: field(form, "reverseLabel")?.value.trim() ?? "",
      sortOrder: count,
    };
  }
  if (section === "contact-labels" || section === "tags") return { name };
  if (section === "emotion-options" || section === "pet-categories") {
    return undefined;
  }
  if (section === "contact-method-types") {
    return {
      contactKind: (field(form, "contactKind")?.value ??
        "custom") as ContactMethodKind,
      name,
      sortOrder: count,
    };
  }
  return { name, sortOrder: count };
}

/** A contact-method type's kind, which the importer files values by. */
function KindSelect(
  props: {
    readonly defaultValue: ContactMethodKind;
    readonly disabled: boolean;
    readonly label: string;
  },
) {
  return (
    <label data-create-field="kind">
      Kind
      <select
        aria-label={props.label}
        defaultValue={props.defaultValue}
        disabled={props.disabled}
        name="contactKind"
      >
        {CONTACT_METHOD_KINDS.map((kind) => (
          <option key={kind} value={kind}>{CONTACT_KIND_LABELS[kind]}</option>
        ))}
      </select>
    </label>
  );
}

export function Personalization(props: { readonly onSettled?: () => void }) {
  const [state, dispatch] = useReducer(
    personalizationReducer,
    initialPersonalization,
  );
  const read = useLatestRequest();
  const settled = useRef(props.onSettled);
  const content = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const workspace = useRef<string | undefined>(undefined);
  // Where history stands: the section the URL names and its entry's index,
  // and the entry a refused Back or Forward is being returned to.
  const current = useRef<PersonalizationSection>("profile-modules");
  const index = useRef(0);
  const suppressed = useRef<number | undefined>(undefined);
  // What handlers must read before the next render: the drafts' baselines,
  // whether one differs, the section shown, and whether a change runs.
  const baselines = useRef(new Map<string, FormBaseline>());
  const dirtyNow = useRef(false);
  const shown = useRef<RenderedSection | undefined>(undefined);
  const mutatingNow = useRef(false);

  const forms = (): HTMLFormElement[] =>
    Array.from(
      content.current?.querySelectorAll<HTMLFormElement>(
        "form[data-personalization-form]",
      ) ?? [],
    );
  const formKey = (form: HTMLFormElement) =>
    form.dataset.personalizationForm ?? "";

  const capture = () => {
    baselines.current = new Map(
      forms().map((form) => [formKey(form), baselineOf(form)]),
    );
    dirtyNow.current = false;
  };

  const recompute = () => {
    if (!shown.current) return;
    const dirtyForms = forms().filter((form) =>
      baselines.current.get(formKey(form))?.snapshot !== draftSnapshot(form)
    ).map(formKey);
    dirtyNow.current = dirtyForms.length > 0;
    dispatch({ dirtyForms, type: "edited" });
  };

  const load = async (
    section: PersonalizationSection = current.current,
    focus = false,
    cleanMessage?: string,
  ): Promise<LoadOutcome> => {
    const workspaceId = workspace.current!;
    dispatch({ section, type: "loading" });
    const answer = await read(() =>
      listPersonalizationEntries(section, workspaceId)
    );
    if (!answer) return "stale";
    if (answer.status !== "ready" || !answer.data) {
      const message = answer.problem?.detail ??
        "This section could not be loaded.";
      const rendered = shown.current;
      const retry = !rendered ||
          (section === current.current && section !== rendered.section)
        ? { cleanMessage, focus, kind: "section" as const, section }
        : undefined;
      dispatch({ focus, message, retry, type: "load-failed" });
      return "failed";
    }
    const rendered: RenderedSection = {
      canCreate: answer.data.capabilities?.create ?? true,
      entries: answer.data.entries,
      section,
    };
    shown.current = rendered;
    dirtyNow.current = false;
    dispatch({ cleanMessage, focus, rendered, type: "loaded" });
    return "loaded";
  };

  const first = useEffectEvent(async () => {
    const context = await resolveSettingsContext();
    if (!context) {
      dispatch({ type: "no-session" });
      return;
    }
    workspace.current = context.workspaceId;
    current.current = resolvePersonalizationSection(globalThis.location.search);
    const initial = personalizationHistoryState(globalThis.history.state);
    index.current = initial?.section === current.current ? initial.index : 0;
    globalThis.history.replaceState(
      historyValue(globalThis.history.state, index.current, current.current),
      "",
      `?section=${current.current}`,
    );
    dispatch({ type: "ready" });
    await load();
  });
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  // Each authoritative read, and each emptied create form, is the baseline.
  const rebaseline = useEffectEvent(() => {
    if (shown.current) capture();
  });
  useLayoutEffect(() => rebaseline(), [state.generation, state.createKey]);

  // A change's outcome arrives while the reader may already be clicking
  // elsewhere: scrolling to it would slide the sticky section links from
  // under a pressed pointer and lose that click (REL-086).
  useLayoutEffect(() => {
    if (state.statusFocus > 0) status.current?.focus({ preventScroll: true });
  }, [state.statusFocus]);
  useLayoutEffect(() => {
    if (state.headingFocus > 0) heading.current?.focus();
  }, [state.headingFocus]);

  useUnsavedGuard({
    confirmMessage: SWITCH_CONFIRM,
    dirty: () => dirtyNow.current,
    onDiscard: () => {
      capture();
      dispatch({
        message: "Changes discarded for workspace switch.",
        type: "baseline",
      });
    },
  });

  const onPopState = useEffectEvent(async (event: PopStateEvent) => {
    const restoreCurrentEntry = () =>
      globalThis.history.replaceState(
        historyValue(globalThis.history.state, index.current, current.current),
        "",
        `?section=${current.current}`,
      );
    const restorePoppedEntry = (target: PersonalizationHistoryState) => {
      // Never zero: an entry at the current index was handled above, and
      // both indexes are bounded by MAX_PERSONALIZATION_HISTORY_INDEX.
      const delta = index.current - target.index;
      suppressed.current = index.current;
      globalThis.history.go(delta);
    };
    const target = personalizationHistoryState(event.state);
    if (suppressed.current !== undefined) {
      const expected = suppressed.current;
      suppressed.current = undefined;
      if (
        target?.index === expected && target.section === current.current &&
        globalThis.location.search === `?section=${current.current}`
      ) return;
      restoreCurrentEntry();
      return;
    }
    if (
      !target ||
      (target.index === index.current && target.section !== current.current)
    ) {
      restoreCurrentEntry();
      return;
    }
    if (target.index === index.current) return;
    let cleanMessage: string | undefined;
    if (dirtyNow.current) {
      if (!globalThis.confirm(NAVIGATION_CONFIRM)) {
        restorePoppedEntry(target);
        return;
      }
      cleanMessage = "Changes discarded.";
    }
    const outcome = await load(target.section, true, cleanMessage);
    if (outcome === "failed") {
      restorePoppedEntry(target);
      return;
    }
    if (outcome === "stale") return;
    current.current = target.section;
    index.current = target.index;
  });
  useEffect(() => {
    if (state.phase !== "ready") return;
    const listener = (event: PopStateEvent) => void onPopState(event);
    globalThis.addEventListener("popstate", listener);
    return () => globalThis.removeEventListener("popstate", listener);
  }, [state.phase]);

  const navigate = (
    event: SyntheticEvent<HTMLAnchorElement>,
    section: PersonalizationSection,
  ) => {
    // Before the session is known the link is an ordinary page load.
    if (state.phase !== "ready") return;
    event.preventDefault();
    if (section === current.current) {
      dispatch({
        message: "That personalization section is already open.",
        type: "status",
      });
      return;
    }
    let cleanMessage: string | undefined;
    if (dirtyNow.current) {
      if (!globalThis.confirm(NAVIGATION_CONFIRM)) return;
      cleanMessage = "Changes discarded.";
    }
    current.current = section;
    index.current += 1;
    globalThis.history.pushState(
      historyValue(globalThis.history.state, index.current, section),
      "",
      `?section=${section}`,
    );
    void load(section, true, cleanMessage);
  };

  const focusActiveDraft = () => {
    forms().find((form) => formKey(form) === state.active)?.querySelector<
      DraftControl
    >(
      "input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
    )?.focus();
  };
  /** Whether `form` may be saved; asks for the active draft otherwise. */
  const mayChange = (form: string): boolean => {
    if (!state.active) return true;
    if (form === state.active && state.dirtyForms.length === 1) return true;
    dispatch({ message: FINISH_DRAFT, type: "note" });
    focusActiveDraft();
    return false;
  };

  /**
   * Runs one change the reader asked for, then reads the section again.
   * A change the server took whose section could not be read again says so
   * and keeps the drafts as they stand as the baseline.
   */
  const change = async (
    call: () => Promise<ApiResult<unknown>>,
    done: string,
    failed: string,
    options: {
      readonly onLoaded?: () => void;
      readonly guardSection?: boolean;
    } = {},
  ) => {
    if (mutatingNow.current || state.loading) return;
    mutatingNow.current = true;
    dispatch({ mutating: true, type: "mutating" });
    const section = current.current;
    const result = await settle(call);
    try {
      if (options.guardSection && section !== current.current) return;
      if (result.status !== "ready") {
        dispatch({
          focus: true,
          message: result.problem?.detail ?? failed,
          type: "status",
        });
        return;
      }
      const outcome = await load();
      if (outcome === "loaded") {
        options.onLoaded?.();
        dispatch({ focus: true, message: done, type: "status" });
      } else if (outcome === "failed") {
        capture();
        dispatch({ type: "baseline" });
        dispatch({ type: "refresh-failed" });
      }
    } finally {
      mutatingNow.current = false;
      dispatch({ mutating: false, type: "mutating" });
    }
  };

  const create = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const rendered = state.rendered;
    const workspaceId = workspace.current!;
    if (!rendered || !mayChange("create")) return;
    const section = current.current;
    const input = createInput(
      event.currentTarget,
      section,
      rendered.entries.length,
    );
    if (!input) {
      dispatch({
        focus: true,
        message: "Option could not be created.",
        type: "status",
      });
      return;
    }
    void change(
      () =>
        createPersonalizationEntry(
          section,
          input as Parameters<typeof createPersonalizationEntry>[1],
          workspaceId,
        ),
      "Option created.",
      "Option could not be created.",
      {
        guardSection: true,
        onLoaded: () => dispatch({ type: "reset-create" }),
      },
    );
  };

  const save = (
    event: SyntheticEvent<HTMLFormElement>,
    entry: PersonalizationEntry,
  ) => {
    event.preventDefault();
    const workspaceId = workspace.current!;
    const rendered = state.rendered!;
    if (!mayChange(entry.id)) return;
    const form = event.currentTarget;
    const capabilities = entryCapabilities(entry, rendered.section);
    const text = (name: string) => field(form, name)?.value.trim();
    const contactKind = field(form, "contactKind")?.value as
      | ContactMethodKind
      | undefined;
    const days = field(form, "daysBefore");
    const order = field(form, "sortOrder");
    const forwardLabel = text("forwardLabel");
    const name = text("name");
    const reverseLabel = text("reverseLabel");
    const section = current.current;
    void change(
      () =>
        updatePersonalizationEntry(
          section,
          entry.id,
          {
            ...(contactKind === undefined ? {} : { contactKind }),
            ...(days && capabilities.editValue
              ? { daysBefore: Number(days.value) }
              : {}),
            expectedUpdatedAt: entry.updatedAt,
            ...(forwardLabel === undefined ? {} : { forwardLabel }),
            ...(name === undefined ? {} : { name }),
            ...(reverseLabel === undefined ? {} : { reverseLabel }),
            ...(capabilities.reorder && order
              ? { sortOrder: Number(order.value) }
              : {}),
          } as Parameters<typeof updatePersonalizationEntry>[2],
          workspaceId,
        ),
      "Option saved.",
      "Option could not be saved.",
    );
  };

  const update = (
    entry: PersonalizationEntry,
    input: { readonly isActive: boolean } | { readonly isDefault: true },
    done: string,
    failed: string,
  ) => {
    const workspaceId = workspace.current!;
    const section = current.current;
    void change(
      () =>
        updatePersonalizationEntry(
          section,
          entry.id,
          {
            expectedUpdatedAt: entry.updatedAt,
            ...input,
          } as Parameters<typeof updatePersonalizationEntry>[2],
          workspaceId,
        ),
      done,
      failed,
    );
  };

  const remove = (entry: PersonalizationEntry, row: HTMLElement) => {
    const workspaceId = workspace.current!;
    const replacement = row.querySelector<HTMLSelectElement>(
      "select[data-personalization-replacement]",
    );
    if (entry.referenceCount > 0 && !replacement?.value) {
      replacement?.focus();
      dispatch({
        focus: true,
        message: `${entry.referenceCount} references require a replacement.`,
        type: "status",
      });
      return;
    }
    const section = current.current;
    void change(
      () =>
        deletePersonalizationEntry(
          section,
          entry.id,
          entry.updatedAt,
          replacement?.value || undefined,
          workspaceId,
        ),
      "Option deleted; existing history was retained.",
      "Option could not be deleted.",
    );
  };

  const revert = (form: HTMLFormElement) => {
    const saved = baselines.current.get(formKey(form));
    if (!shown.current || !saved) return;
    const target = draftControls(form).find((control) => !control.disabled);
    restore(saved);
    recompute();
    dispatch({ message: "Changes reverted.", type: "note" });
    target?.focus();
  };

  const retry = async () => {
    const pending = state.retry;
    if (!pending) return;
    dispatch({ type: "retrying" });
    if (pending.kind === "section") {
      await load(pending.section, pending.focus, pending.cleanMessage);
      return;
    }
    const outcome = await load();
    if (outcome === "loaded") {
      dispatch({ focus: true, message: "Section refreshed.", type: "status" });
    } else if (outcome === "failed") dispatch({ type: "refresh-failed" });
  };

  const { rendered } = state;
  const locked = !rendered || state.loading || state.mutating;
  const dirty = dirtyLine(state);
  return (
    <>
      <nav
        aria-label="Personalization sections"
        className="personalization-nav"
      >
        {PERSONALIZATION_SECTIONS.map(({ id, label }) => (
          <a
            aria-current={rendered?.section === id ? "page" : undefined}
            data-personalization-section={id}
            href={`/app/settings/personalization?section=${id}`}
            key={id}
            onClick={(event) => navigate(event, id)}
          >
            {label}
          </a>
        ))}
      </nav>
      <section
        aria-labelledby="personalization-heading"
        className="personalization-content"
        onChange={recompute}
        onInput={recompute}
        ref={content}
      >
        <h2 id="personalization-heading" ref={heading} tabIndex={-1}>
          {rendered ? sectionLabel(rendered.section) : "Profile modules"}
        </h2>
        <p>
          Names must be unique in this workspace. Impact counts are shown before
          replacement, disabling, or deletion.
        </p>
        <CreateForm
          key={state.createKey}
          locked={locked}
          onRevert={revert}
          onSubmit={create}
          rendered={rendered}
          state={state}
        />
        <p
          aria-live="polite"
          className="inline-status"
          data-state={dirty.state}
          id="personalization-dirty"
          role="status"
        >
          {dirty.text}
        </p>
        <p
          aria-live="polite"
          className="inline-status"
          id="personalization-status"
          ref={status}
          role="status"
          tabIndex={-1}
        >
          {state.status}
          {state.retry
            ? (
              <button
                disabled={state.retrying}
                onClick={() => void retry()}
                type="button"
              >
                Retry
              </button>
            )
            : null}
        </p>
        <ul
          aria-busy={state.loading ? "true" : "false"}
          aria-label="Personalization options"
          className="personalization-list"
          id="personalization-list"
        >
          {rendered?.entries.map((entry) => (
            <EntryRow
              entries={rendered.entries}
              entry={entry}
              key={`${entry.id}:${state.generation}`}
              locked={locked}
              onRemove={remove}
              onRevert={revert}
              onSave={save}
              onUpdate={update}
              section={rendered.section}
              state={state}
            />
          ))}
        </ul>
      </section>
    </>
  );
}

/** A control's lock under the draft rules, with why it is held. */
function blocked(held: boolean) {
  return held
    ? { "aria-describedby": "personalization-dirty", title: BLOCKED_TITLE }
    : {};
}

function RevertButton(
  props: {
    readonly shown: boolean;
    readonly locked: boolean;
    readonly onRevert: (form: HTMLFormElement) => void;
  },
) {
  return (
    <button
      data-personalization-revert="true"
      disabled={props.locked}
      hidden={!props.shown}
      onClick={(event) => props.onRevert(event.currentTarget.form!)}
      type="button"
    >
      Revert
    </button>
  );
}

function CreateForm(
  props: {
    readonly rendered: RenderedSection | undefined;
    readonly state: PersonalizationState;
    readonly locked: boolean;
    readonly onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
    readonly onRevert: (form: HTMLFormElement) => void;
  },
) {
  const { locked, rendered } = props;
  const section = rendered?.section;
  const canCreate = rendered?.canCreate ?? false;
  const nameHidden = section === "relationship-types" ||
    section === "reminder-rules";
  const rules = draftRules(props.state, "create");
  return (
    <form
      aria-busy={props.state.loading ? "true" : "false"}
      className="personalization-create"
      data-personalization-form="create"
      hidden={!canCreate}
      id="personalization-create"
      method="post"
      onSubmit={props.onSubmit}
    >
      <label hidden={nameHidden}>
        New option name<input
          disabled={locked || !canCreate || nameHidden}
          maxLength={200}
          name="name"
          required={!nameHidden}
        />
      </label>
      {section === "relationship-types"
        ? (
          <>
            <label data-create-field="forward">
              Forward label<input
                disabled={locked}
                maxLength={200}
                name="forwardLabel"
                required
              />
            </label>
            <label data-create-field="reverse">
              Reverse label<input
                disabled={locked}
                maxLength={200}
                name="reverseLabel"
                required
              />
            </label>
          </>
        )
        : null}
      {section === "contact-method-types"
        ? (
          <KindSelect
            defaultValue="custom"
            disabled={locked || !canCreate}
            label="New option kind"
          />
        )
        : null}
      {section === "reminder-rules"
        ? (
          <label data-create-field="days">
            Days before<input
              disabled={locked}
              max="3650"
              min="0"
              name="daysBefore"
              required
              type="number"
            />
          </label>
        )
        : null}
      <button
        disabled={locked || !canCreate || rules.saveBlocked}
        type="submit"
        {...blocked(rules.saveBlocked)}
      >
        Create option
      </button>
      <RevertButton
        locked={locked}
        onRevert={props.onRevert}
        shown={rules.revertShown}
      />
    </form>
  );
}

function EntryRow(
  props: {
    readonly entry: PersonalizationEntry;
    readonly entries: readonly PersonalizationEntry[];
    readonly section: PersonalizationSection;
    readonly state: PersonalizationState;
    readonly locked: boolean;
    readonly onSave: (
      event: SyntheticEvent<HTMLFormElement>,
      entry: PersonalizationEntry,
    ) => void;
    readonly onUpdate: (
      entry: PersonalizationEntry,
      input: { readonly isActive: boolean } | { readonly isDefault: true },
      done: string,
      failed: string,
    ) => void;
    readonly onRemove: (entry: PersonalizationEntry, row: HTMLElement) => void;
    readonly onRevert: (form: HTMLFormElement) => void;
  },
) {
  const { entry, locked } = props;
  const capabilities = entryCapabilities(entry, props.section);
  const kind = entry.kind ?? "named";
  const readOnly = entryReadOnly(entry);
  const rules = draftRules(props.state, entry.id);
  const text = (label: string, name: string, value: string) => (
    <label>
      {label}
      <input
        aria-label={`${label} for ${entry.name}`}
        defaultValue={value}
        disabled={locked || readOnly}
        maxLength={200}
        name={name}
        required
      />
    </label>
  );
  const actions = (held: boolean) => ({
    disabled: locked || held,
    ...blocked(held),
  });
  return (
    <li className="personalization-row">
      <form
        className="personalization-entry-form"
        data-personalization-form={entry.id}
        method="post"
        onSubmit={(event) => props.onSave(event, entry)}
      >
        {kind === "relationship-type"
          ? (
            <>
              {text("Forward label", "forwardLabel", entry.forwardLabel ?? "")}
              {text("Reverse label", "reverseLabel", entry.reverseLabel ?? "")}
            </>
          )
          : kind === "reminder-rule"
          ? (
            <label>
              Days before
              <input
                aria-label={`Days before for ${entry.name}`}
                defaultValue={String(entry.daysBefore ?? 0)}
                disabled={locked || readOnly || !capabilities.editValue}
                max="3650"
                maxLength={200}
                min="0"
                name="daysBefore"
                required
                type="number"
              />
            </label>
          )
          : readOnly
          ? <strong>{entry.name}</strong>
          : text("Name", "name", entry.name)}
        {props.section === "contact-method-types" && !readOnly
          ? (
            <KindSelect
              defaultValue={entry.contactKind ?? "custom"}
              disabled={locked}
              label={`Kind for ${entry.name}`}
            />
          )
          : null}
        {capabilities.reorder
          ? (
            <label>
              Order
              <input
                aria-label={`Order for ${entry.name}`}
                defaultValue={String(entry.sortOrder)}
                disabled={locked || readOnly}
                max="10000"
                min="0"
                name="sortOrder"
                type="number"
              />
            </label>
          )
          : null}
        <p>{entryDetail(entry)}</p>
        <div className="personalization-actions">
          {readOnly
            ? (
              <span className={badgeVariants({ variant: "secondary" })}>
                {entry.readOnly === true
                  ? "Read-only shared option"
                  : "Shared required option"}
              </span>
            )
            : (
              <>
                {capabilities.editValue || capabilities.rename ||
                    capabilities.reorder
                  ? (
                    <button type="submit" {...actions(rules.saveBlocked)}>
                      Save
                    </button>
                  )
                  : null}
                <RevertButton
                  locked={locked}
                  onRevert={props.onRevert}
                  shown={rules.revertShown}
                />
                {props.section === "profile-modules" && !capabilities.delete
                  ? (
                    // A person-workspace section is turned off, never
                    // deleted (GAP-047).
                    <span className={badgeVariants({ variant: "secondary" })}>
                      Core section · cannot be deleted
                    </span>
                  )
                  : null}
                {capabilities.disable
                  ? (
                    <button
                      onClick={() =>
                        props.onUpdate(
                          entry,
                          { isActive: !entry.isActive },
                          "Option updated.",
                          "Option could not be updated.",
                        )}
                      type="button"
                      {...actions(rules.actionsBlocked)}
                    >
                      {entry.isActive ? "Disable" : "Enable"}
                    </button>
                  )
                  : null}
                {!entry.isDefault && capabilities.setDefault
                  ? (
                    <button
                      onClick={() =>
                        props.onUpdate(
                          entry,
                          { isDefault: true },
                          "Default updated.",
                          "Default could not be updated.",
                        )}
                      type="button"
                      {...actions(rules.actionsBlocked)}
                    >
                      Set default
                    </button>
                  )
                  : null}
                {capabilities.delete && entry.referenceCount > 0
                  ? (
                    <select
                      aria-label={`Replacement for ${entry.name}`}
                      data-personalization-replacement=""
                      defaultValue=""
                      disabled={locked}
                    >
                      <option value="">Choose replacement</option>
                      {props.entries.filter((candidate) =>
                        candidate.id !== entry.id
                      ).map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                    </select>
                  )
                  : null}
                {capabilities.delete
                  ? (
                    <button
                      onClick={(event) =>
                        props.onRemove(
                          entry,
                          event.currentTarget.closest("li")!,
                        )}
                      type="button"
                      {...actions(rules.actionsBlocked)}
                    >
                      {entry.referenceCount > 0
                        ? "Replace and delete"
                        : "Delete"}
                    </button>
                  )
                  : null}
              </>
            )}
        </div>
      </form>
    </li>
  );
}

/** Mounts the page over the layout `personalization.astro` drew. */
export function mountPersonalization(
  root: ParentNode = document,
): Promise<() => void> {
  return mountSettingsSurface(
    root,
    "[data-personalization]",
    PERSONALIZATION_ISLAND,
    (onSettled) => <Personalization onSettled={onSettled} />,
  );
}
