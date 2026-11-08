/**
 * One profile fact section, whichever it is (GAP-029).
 *
 * The seven fact sections — contact methods, addresses, work, pets, food
 * preferences, first meeting, and tags — share every behaviour but their
 * fields and how a record reads, so each is this editor given its section's
 * pieces (`FactEditorProps`). The editor owns the section's DOM and its one
 * read of the facts:
 *
 * - It lists a page of records (`fact-list.tsx`), each with its details, and
 *   edit and delete controls unless the person or the section is read-only.
 * - Its editor is a contract form (`useContractForm`): the fields validate
 *   against the create or update schema the API parses the save with, and a
 *   refused save puts the API's field errors back on the fields. Saves are
 *   never optimistic: a saved fact refreshes the section through the same
 *   read that loaded it, and only then says so. Every read of the section —
 *   the first, a retry, a refresh, another page — goes through one request
 *   slot, so only the latest answer lands.
 * - It publishes what the hero and the rail show about it — counts, vitals,
 *   the tag preview — through `profile-summary.ts`, as the vanilla module
 *   did.
 * - A failed read offers a retry that asks before it discards a draft in the
 *   same section and never touches another section's (APR-003). A draft
 *   survives a declined navigation and a failed save, with its focus, and the
 *   save can be retried (APR-001): the form is one element for the section's
 *   life, so the page's unsaved-changes guard and the rail's one-editor rule
 *   (`lib/unsaved-changes.ts`, `lib/rail-editors.ts`) keep tracking it, and
 *   on a phone the rail presents it as a modal sheet. The form is always the
 *   section's last element, and nothing is ever inserted before it, because
 *   the sheet moves it.
 */

import {
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";
import type { FieldError, FieldValues } from "react-hook-form";
import { z } from "zod";
import {
  createProfileFact,
  deleteProfileFact,
  listProfileFacts,
  type PersonRailHideableSection,
  type ProfileFactRecord,
  type ProfileFactSection,
  type ProfileFactSectionId,
  updateProfileFact,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { Button } from "@/components/ui/button.tsx";
import { formActionsVariants } from "@/components/ui/variants.ts";
import {
  markFormSaved,
  requestFormDiscard,
  saveWithLockedForm,
} from "../../../lib/unsaved-changes.ts";
import {
  registerRailEditors,
  requestRailEditorOpen,
} from "../../../lib/rail-editors.ts";
import {
  settle,
  type Settled,
  useContractForm,
  useDocumentEvent,
  useLatestRequest,
} from "../../../islands/core/index.ts";
import { SECTION_HIDDEN_EVENT } from "../sections.ts";
import { useFactChoices } from "./choices.ts";
import {
  type FactFormContext,
  FactFormProvider,
  factIssueMessage,
  type FactWording,
  OptionSearch,
} from "./fact-form.tsx";
import {
  FactList,
  FactPages,
  type FactRemoval,
  type FactRows,
} from "./fact-list.tsx";
import type { FactLookup } from "./lookup.ts";
import {
  type FactPage,
  isLaterRevision,
  mergeOptions,
  pageShape,
  pageSummary,
} from "./records.ts";

export type { FactRows };

/** What mounting a fact section hands it. */
export interface FactSectionProps {
  readonly personId: string;
  readonly workspaceId: string;
  /** Whether the person is archived when the section mounts. */
  readonly archived: boolean;
  /** Whether the workspace had the section's module off when the page loaded. */
  readonly hidden: boolean;
  /** The person's revision the page loaded, which the first save expects. */
  readonly personUpdatedAt: string;
  /** How many records the profile summary counted, when it did. */
  readonly total?: number | undefined;
  /**
   * The first page the person read's rail answered for this section, which
   * the section shows instead of reading it (AUD-Q3).
   */
  readonly preloaded?:
    | PersonRailHideableSection<ProfileFactSection>
    | undefined;
  /** The element the section renders into; it carries the section state. */
  readonly root: HTMLElement;
  /** The shell's heading the add control renders into, for a rail block. */
  readonly heading?: HTMLElement | undefined;
  /** Called once, when the first read has settled either way. */
  readonly onSettled?: () => void;
}

/** What a section tells the hero and the rail. */
export interface FactPublisher {
  /** A page of records is on screen. */
  readonly page: (page: FactPage) => void;
  /** The section shows nothing: its module is off or access was lost. */
  readonly clear: () => void;
  /** A read failed; whatever was shown stays. */
  readonly failed: () => void;
}

/** The section's form: its values, its contract, and its layout. */
export interface FactFormSpec<Values extends FieldValues> {
  /** The values of an empty editor. */
  readonly empty: Values;
  /** The values an editor opened on `record` starts with. */
  readonly values: (record: ProfileFactRecord) => Values;
  /**
   * The request body the values make, without the revisions and ids the
   * editor adds: blank text is left out, so the contract calls it missing.
   */
  readonly input: (values: Values) => Record<string, unknown>;
  /** The contracts a new and an existing record are saved with. */
  readonly create: z.ZodType;
  readonly update: z.ZodType;
  readonly wording: FactWording;
  /** The fields, in reading order. */
  readonly fields: ReactNode;
}

export interface FactEditorProps<Values extends FieldValues>
  extends FactSectionProps {
  readonly section: ProfileFactSectionId;
  /** What the section is called in its status line and control names. */
  readonly noun: string;
  /** A section with at most one record, which its add control edits. */
  readonly singleton?: boolean;
  /** How the add control reads, given the records on screen. */
  readonly addLabel?: (records: readonly ProfileFactRecord[]) => string;
  readonly remove?: FactRemoval;
  /**
   * Whether the section's records are stored on the person, so a new person
   * revision is their new revision too (tags and food preferences).
   */
  readonly followsPerson?: boolean;
  /** The status line over a loaded page. */
  readonly summaryText?: (page: FactPage) => string;
  /** Whether "Profile fact saved." follows the refreshed status line. */
  readonly savedAfterSummary?: boolean;
  readonly form: FactFormSpec<Values>;
  readonly lookup?: FactLookup;
  readonly rows?: FactRows;
  readonly publish: FactPublisher;
  /** Work another owner must redo after this section saved or deleted. */
  readonly afterWrite?: () => Promise<void>;
  /**
   * The add control: the rail's icon in the heading, or a labelled button
   * beside the status line (the tags editor).
   */
  readonly addControl?: "icon" | "button";
}

type Status = "loading" | "loaded" | "error" | "forbidden" | "hidden";

/** The outcome of a read, which a caller may word its feedback from. */
type ReadOutcome =
  | { readonly status: "loaded"; readonly page: FactPage }
  | { readonly status: "error" | "forbidden" | "hidden" | "superseded" };

type FocusTarget = "state" | "retry" | "form" | "add" | "field";

interface Editing {
  /** Bumped on every open, so the fields start from the opened record. */
  readonly generation: number;
  readonly recordId?: string | undefined;
  readonly expectedUpdatedAt?: string | undefined;
}

/** Where a request's revision goes until the editor sends it. */
const PENDING_REVISION = "1970-01-01T00:00:00.000000Z";

const UNAVAILABLE =
  "This profile section is temporarily unavailable. Try again.";
const FORBIDDEN = "Your active workspace no longer permits this action.";

export function FactEditor<Values extends FieldValues>(
  props: FactEditorProps<Values>,
) {
  const { personId, publish, root, section, workspaceId } = props;
  const [archived, setArchived] = useState(props.archived);
  const [status, setStatus] = useState<Status>(
    props.hidden ? "hidden" : "loading",
  );
  const [page, setPage] = useState<FactPage | undefined>(undefined);
  const [feedback, setFeedback] = useState<string | undefined>(undefined);
  const [paging, setPaging] = useState(false);
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [formNotice, setFormNotice] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [preparing, setPreparing] = useState(false);
  // Whether the last read failed in a way retrying can help: the retry
  // stays, unavailable, while the next read runs.
  const [failed, setFailed] = useState(false);
  const [focus, setFocus] = useState<
    { readonly target: FocusTarget; readonly tick: number } | undefined
  >(undefined);

  const request = useLatestRequest();
  const revision = useRef(props.personUpdatedAt);
  const formElement = useRef<HTMLFormElement>(null);
  const stateLine = useRef<HTMLParagraphElement>(null);
  const formState = useRef<HTMLParagraphElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  const settled = useRef(props.onSettled);
  const total = useRef(props.total);
  // Handlers that outlive a render read the latest page and editor.
  const editingRef = useRef(editing);
  const pageRef = useRef(page);
  useLayoutEffect(() => {
    editingRef.current = editing;
    pageRef.current = page;
  }, [editing, page]);

  const focusOn = useCallback((target: FocusTarget) => {
    setFocus((current) => ({ target, tick: (current?.tick ?? 0) + 1 }));
  }, []);

  const applyRevision = useCallback((candidate: string, announce: boolean) => {
    if (!isLaterRevision(candidate, revision.current)) return;
    revision.current = candidate;
    if (announce) {
      document.dispatchEvent(
        new CustomEvent("person-revision-changed", {
          detail: { personUpdatedAt: candidate },
        }),
      );
    }
  }, []);

  // The contract validates the request the editor would send. The person's
  // revision it expects is stamped when it sends, since another section's
  // save may move it while the editor is open.
  const schema = z.preprocess(
    (values) => ({
      ...props.form.input(values as Values),
      expectedPersonUpdatedAt: PENDING_REVISION,
      section,
      ...(editing?.recordId
        ? { expectedUpdatedAt: editing.expectedUpdatedAt, id: editing.recordId }
        : {}),
    }),
    editing?.recordId ? props.form.update : props.form.create,
  ) as unknown as z.ZodType<Record<string, unknown>, Values>;
  const form = useContractForm(schema, {
    defaultValues: props.form.empty as never,
    issueMessage: factIssueMessage(props.form.wording),
  });
  const choices = useFactChoices(
    props.lookup,
    { personId, section, workspaceId },
    () => form.getValues() as Record<string, unknown>,
  );
  const { learn, reset } = choices;

  /** Closes the editor, discarding what it holds. */
  const close = useCallback(() => {
    formElement.current?.reset();
    setEditing(undefined);
    setFormNotice(undefined);
  }, []);

  /** Shows that the workspace no longer lets the member see the section. */
  const refuse = useCallback((): ReadOutcome => {
    setFailed(false);
    setPage(undefined);
    close();
    publish.clear();
    setStatus("forbidden");
    setFeedback(FORBIDDEN);
    return { status: "forbidden" };
  }, [close, publish]);

  /** Shows what a read of the section's first page answered. */
  const show = useCallback((
    answer: Settled<ProfileFactSection> | undefined,
  ): ReadOutcome => {
    if (!answer) return { status: "superseded" };
    const knownTotal = total.current;
    total.current = undefined;
    const retryable = answer.status !== "ready" || !answer.data;
    if (
      retryable &&
      (answer.problem?.status === 401 || answer.problem?.status === 403)
    ) return refuse();
    setFailed(retryable);
    if (retryable) {
      publish.failed();
      setStatus("error");
      setFeedback(UNAVAILABLE);
      return { status: "error" };
    }
    const read = answer.data;
    applyRevision(read.personUpdatedAt, false);
    if (read.status === "hidden") {
      setPage(undefined);
      close();
      publish.clear();
      setStatus("hidden");
      setFeedback(undefined);
      if (section !== "tags") {
        document.dispatchEvent(
          new CustomEvent(SECTION_HIDDEN_EVENT, {
            detail: { sectionId: section },
          }),
        );
      }
      return { status: "hidden" };
    }
    const options = mergeOptions(
      read.options,
      read.records.flatMap((record) => record.selectedOptions ?? []),
    );
    const loaded: FactPage = {
      archived: read.status === "archived",
      cursors: [undefined],
      index: 0,
      nextCursor: read.nextCursor,
      options,
      records: read.records,
      total: knownTotal,
    };
    reset(options);
    setPage(loaded);
    setExpanded(false);
    setStatus("loaded");
    setFeedback(undefined);
    publish.page(loaded);
    return { page: loaded, status: "loaded" };
  }, [applyRevision, close, publish, refuse, reset, section]);

  // A read's answer is drawn before the read settles, so the page acting on a
  // settled section finds the add control it shows (REL-074).
  const read = useCallback(
    (): Promise<ReadOutcome> =>
      request(() => listProfileFacts(personId, section, {}, workspaceId)).then(
        (answer) => flushSync(() => show(answer)),
      ),
    [personId, request, section, show, workspaceId],
  );

  /** Reads the section again, disabling its controls until it answers. */
  const load = useCallback((): Promise<ReadOutcome> => {
    setStatus("loading");
    setConfirming(undefined);
    return read();
  }, [read]);

  // The first read starts in the loading state the section mounted with. A
  // section whose first page came with the person read shows it, its
  // refusal (REL-127), or its own outage (AUD-Q3). Otherwise a section the
  // profile summary counted empty needs none: it shows its empty state and
  // its add control, and the first write reads it (FEQ-04). Tags always
  // read: their one record, the person's assignments, is what the editor
  // saves, even while it assigns none.
  const firstRead = useEffectEvent(() => {
    if (props.hidden) return Promise.resolve();
    const preloaded = props.preloaded;
    if (preloaded?.status === "forbidden") {
      return Promise.resolve().then(() => flushSync(() => refuse()));
    }
    const empty: ProfileFactSection = {
      options: [],
      personUpdatedAt: revision.current,
      records: [],
      status: archived ? "archived" : "ready",
    };
    const answer: Settled<ProfileFactSection> | undefined = !preloaded
      ? props.total !== 0 || section === "tags"
        ? undefined
        : { data: empty, status: "ready" }
      : preloaded.status === "ready"
      ? { data: preloaded.value, status: "ready" }
      : preloaded.status === "hidden"
      ? { data: { ...empty, status: "hidden" }, status: "ready" }
      : { status: "unavailable" };
    if (!answer) return read();
    return Promise.resolve().then(() => flushSync(() => show(answer)));
  });
  useEffect(() => {
    void firstRead().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  // The rail's one-editor rule and, on a phone, the modal sheet.
  useLayoutEffect(() => {
    const element = formElement.current;
    if (!element) return;
    return registerRailEditors([element], () => close());
  }, [close]);

  useLayoutEffect(() => {
    root.setAttribute(
      "data-section-state",
      status === "loaded" ? page?.archived ? "read-only" : "ready" : status,
    );
    root.toggleAttribute("hidden", status === "hidden");
  }, [page?.archived, root, status]);

  useLayoutEffect(() => {
    if (!focus) return;
    const target = {
      add: addButton.current,
      field: formElement.current?.querySelector<HTMLElement>(
        "input, select, textarea",
      ),
      form: formState.current,
      retry: retryButton.current,
      state: stateLine.current,
    }[focus.target];
    if (focus.target === "field" && formElement.current) {
      // The opened editor holds its record: that is the draft's baseline.
      markFormSaved(formElement.current);
    }
    if (target && !target.closest("[hidden]")) target.focus();
  }, [focus]);

  useDocumentEvent<CustomEvent<{ readonly archived?: unknown }>>(
    "person-lifecycle-changed",
    (event) => {
      if (typeof event.detail?.archived === "boolean") {
        setArchived(event.detail.archived);
      }
      close();
      void load();
    },
  );

  useDocumentEvent<CustomEvent<{ readonly personUpdatedAt?: unknown }>>(
    "person-revision-changed",
    (event) => {
      const candidate = event.detail?.personUpdatedAt;
      if (typeof candidate !== "string") return;
      applyRevision(candidate, false);
      if (!props.followsPerson) return;
      const current = revision.current;
      setPage((loaded) =>
        loaded && {
          ...loaded,
          records: loaded.records.map((record) => ({
            ...record,
            updatedAt: current,
          })),
        }
      );
      setEditing((open) =>
        open?.expectedUpdatedAt ? { ...open, expectedUpdatedAt: current } : open
      );
    },
  );

  /** Opens the editor on `record`, or on a new record, once it is ready. */
  const open = async (
    record: ProfileFactRecord | undefined,
    opener: HTMLElement,
  ) => {
    const element = formElement.current;
    if (!element || !requestRailEditorOpen(element, true, opener)) return;
    const target = record ??
      (props.singleton ? pageRef.current?.records[0] : undefined);
    setPreparing(true);
    const refusal = await saveWithLockedForm(
      element,
      () => choices.prepare(target),
    );
    setPreparing(false);
    if (refusal) {
      setFeedback(refusal);
      focusOn("state");
      return;
    }
    const values = target ? props.form.values(target) : props.form.empty;
    form.reset(values);
    choices.pin(values);
    choices.unblock();
    setFormNotice(undefined);
    setEditing((current) => ({
      expectedUpdatedAt: target?.updatedAt,
      generation: (current?.generation ?? 0) + 1,
      recordId: target?.id,
    }));
    focusOn("field");
  };

  const search = async (text: string, next: boolean) => {
    const failure = await choices.search(text, next);
    if (failure) setFeedback(failure);
  };

  const cancel = () => {
    close();
    focusOn("add");
    setFeedback("Edit cancelled. No changes were saved.");
  };

  const retry = async () => {
    const element = formElement.current;
    if (
      element && !requestFormDiscard(
        [element],
        "Discard unsaved changes in this section and retry loading it?",
      )
    ) return;
    close();
    const outcome = await load();
    if (outcome.status === "error") focusOn("retry");
    else if (outcome.status !== "hidden") focusOn("state");
  };

  /** Reads the section again after a write, with whatever else it affects. */
  const refresh = async (): Promise<ReadOutcome> => {
    const [outcome] = await Promise.all([load(), props.afterWrite?.()]);
    return outcome;
  };

  const save = async (validated: Record<string, unknown>) => {
    const element = formElement.current;
    if (!element || saving.current) return;
    saving.current = true;
    const body = { ...validated, expectedPersonUpdatedAt: revision.current };
    const recordId = editingRef.current?.recordId;
    const answer = await saveWithLockedForm(
      element,
      () =>
        settle(() =>
          recordId
            ? updateProfileFact(
              personId,
              section,
              recordId,
              body as never,
              workspaceId,
            )
            : createProfileFact(personId, section, body as never, workspaceId)
        ),
    );
    saving.current = false;
    if (answer.status !== "ready" || !answer.data) {
      setFormNotice(
        answer.problem?.detail ?? "Save is temporarily unavailable.",
      );
      formState.current?.focus();
      if (answer.problem) {
        const [first] = form.applyProblem(answer.problem);
        if (first) form.setFocus(first as never);
      }
      return;
    }
    markFormSaved(element);
    applyRevision(answer.data.personUpdatedAt, true);
    // The editor closes now, in its own commit: on a phone that closes the
    // sheet (and hands focus back) before anything the refresh answers can
    // place focus, which a modal sheet would otherwise refuse (APR-004).
    flushSync(() => setEditing(undefined));
    const outcome = await refresh();
    setFeedback(
      outcome.status === "loaded" && props.savedAfterSummary &&
        props.summaryText
        ? `${props.summaryText(outcome.page)} Profile fact saved.`
        : "Profile fact saved.",
    );
    focusOn("state");
  };

  const invalid = (errors: Record<string, FieldError | undefined>) => {
    // The contract refuses a fact made of nothing as a whole; the section
    // says so on the field a reader fills first.
    const wording = props.form.wording.empty;
    if (errors[""] && wording) {
      form.setError(wording.field as never, {
        message: wording.message,
        type: "empty",
      });
    }
    setFormNotice("Correct the highlighted profile details before saving.");
  };

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (choices.blocked || preparing) {
      setFormNotice("Options are unavailable. No changes were saved.");
      formState.current?.focus();
      return;
    }
    void form.handleSubmit(
      (body) => save(body),
      (errors) => invalid(errors as Record<string, FieldError | undefined>),
    )(event);
  };

  const remove = async (record: ProfileFactRecord) => {
    if (confirming !== record.id) {
      setConfirming(record.id);
      setFeedback("Press the delete button again to confirm.");
      focusOn("state");
      return;
    }
    const answer = await settle(() =>
      deleteProfileFact(personId, section, record.id, {
        expectedPersonUpdatedAt: revision.current,
        expectedUpdatedAt: record.updatedAt,
        section,
      }, workspaceId)
    );
    if (answer.status !== "ready" || !answer.data) {
      setFeedback(
        answer.problem?.detail ?? "Delete is temporarily unavailable.",
      );
      return;
    }
    applyRevision(answer.data.personUpdatedAt, true);
    await refresh();
    setFeedback("Profile fact deleted.");
    focusOn("state");
  };

  const showPage = async (cursor: string | undefined, index: number) => {
    setPaging(true);
    const answer = await request(() =>
      listProfileFacts(personId, section, cursor ? { cursor } : {}, workspaceId)
    );
    setPaging(false);
    // A newer read of the section replaced this one.
    if (!answer) return;
    const current = pageRef.current;
    if (answer.status !== "ready" || !answer.data || !current) {
      setFeedback("That profile fact page is temporarily unavailable.");
      return;
    }
    const read = answer.data;
    const options = mergeOptions(
      current.options,
      read.options,
      read.records.flatMap((record) => record.selectedOptions ?? []),
    );
    const next: FactPage = {
      ...current,
      cursors: [...current.cursors.slice(0, index), cursor],
      index,
      nextCursor: read.nextCursor,
      options,
      records: read.records,
    };
    learn(options);
    setPage(next);
    setExpanded(false);
    setConfirming(undefined);
    setFeedback(undefined);
    publish.page(next);
  };

  const busy = status === "loading";
  const records = page?.records ?? [];
  const editable = page !== undefined && !archived && !page.archived;
  const { noun } = props;
  const addLabel = props.addLabel?.(records) ??
    (props.singleton && records.length > 0 ? `Edit ${noun}` : `Add ${noun}`);
  const summaryText = props.summaryText ??
    ((loaded: FactPage) => pageSummary(noun, pageShape(loaded)));
  const line = status === "loading"
    ? `Loading ${noun}…`
    : feedback ?? (page && status === "loaded" ? summaryText(page) : "");
  const inRail = props.addControl !== "button";

  const add = (
    <Button
      data-profile-fact-add=""
      disabled={busy}
      hidden={!editable}
      onClick={(event) => void open(undefined, event.currentTarget)}
      ref={addButton}
      type="button"
      {...(inRail
        ? {
          "aria-label": addLabel,
          className: "profile-rail-add",
          "data-profile-fact-add-icon": "",
        }
        : { variant: "outline" as const })}
    >
      {inRail ? <span aria-hidden="true">+</span> : addLabel}
    </Button>
  );

  return (
    <>
      {inRail && props.heading ? createPortal(add, props.heading) : null}
      <p
        className="section-state"
        data-profile-fact-state=""
        data-rail-summary={status === "loaded" && feedback === undefined
          ? "true"
          : undefined}
        ref={stateLine}
        tabIndex={-1}
      >
        {line}
      </p>
      <Button
        data-profile-fact-retry=""
        disabled={busy}
        hidden={!failed}
        onClick={() => void retry()}
        ref={retryButton}
        type="button"
        variant="outline"
      >
        Retry
      </Button>
      {inRail
        ? (
          <>
            <FactList
              busy={busy}
              confirming={confirming}
              editable={editable}
              expanded={expanded}
              noun={noun}
              onEdit={(record, opener) => void open(record, opener)}
              onExpand={() => setExpanded((shown) => !shown)}
              onRemove={(record) => void remove(record)}
              pages={
                <FactPages
                  disabled={busy || paging}
                  label={`${section} fact pages`}
                  noun={noun}
                  onPage={(cursor, index) => void showPage(cursor, index)}
                  page={page}
                />
              }
              options={page?.options ?? []}
              records={records}
              remove={props.remove}
              rows={props.rows}
            />
          </>
        )
        : add}
      <form
        className="profile-fact-form"
        data-profile-fact-form=""
        hidden={editing === undefined}
        method="post"
        noValidate
        onSubmit={submit}
        ref={formElement}
      >
        {editing
          ? (
            <FactFormProvider
              key={editing.generation}
              value={{
                choices: choices.options,
                form: form as unknown as FactFormContext["form"],
                lookup: props.lookup
                  ? (
                    <OptionSearch
                      busy={choices.searching}
                      labels={props.lookup.labels}
                      more={choices.more}
                      onSearch={(text, next) => void search(text, next)}
                    />
                  )
                  : null,
              }}
            >
              {props.form.fields}
            </FactFormProvider>
          )
          : null}
        <p
          className="section-state"
          data-profile-fact-form-state=""
          ref={formState}
          role="alert"
          tabIndex={-1}
        >
          {formNotice}
        </p>
        <div className={formActionsVariants()} data-form-actions="">
          <Button disabled={choices.blocked || preparing} type="submit">
            Save profile fact
          </Button>
          <Button onClick={cancel} type="button" variant="outline">
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}
