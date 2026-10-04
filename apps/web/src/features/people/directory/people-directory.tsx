/**
 * The people directory as one island (GAP-033): `/app/people` and
 * `/app/people/archived`. It replaces `lib/people-directory.ts`.
 *
 * `PeopleDirectory.astro` draws the heading and the whole directory region;
 * the island renders the region again over it at once, adopting a search the
 * reader typed while it loaded. The static Find people and Search tags
 * controls ship disabled, so nothing is submitted before this handler
 * exists (REL-041).
 *
 * While it resolves the workspace its controls are live: a search submitted
 * then is served by the first load, as REL-041 requires.
 *
 * Its state moves through `directoryReducer`. It has two read slots, never
 * more: one for the workspace, the member's name and sort order, and every
 * page of people, so only the latest list answer lands; and one for the
 * tag picker's pages of options. While a list read is in flight every
 * control waits, and Load more people is hidden unless that read continues
 * the list.
 *
 * GAP-051 (PEOPLE-009) adds the selection and the bulk bar to the same
 * reducer. A bulk request is not a third slot: the bar is inert while one
 * runs, so there is never a second, and when it answers the report is kept
 * and the list is read again once, through the list slot.
 *
 * GAP-053 (PEOPLE-010) adds the starred filter, starred-first, two more
 * orders, a star on starred rows, and the tag facet. The facet is not a
 * third slot either: it is read with the tag options' first page, through
 * the tag slot, when the directory starts and after a bulk run changed the
 * counts. A facet chip applies the existing tag filter and reads the list.
 *
 * REL-066 gives the bar's tag choice its own picker, `BulkTagPicker`: a
 * surface of its own, drawn only while the choice is open, with its own pure
 * reducer (`bulk-tag-picker.ts`) and one request slot. It lists tags apart
 * from the tag filter, so the filter's search never narrows what a bulk
 * action can pick, and reaches every tag by its own search and More tags.
 * The directory itself keeps its two slots.
 */

import {
  type RefObject,
  type SyntheticEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import { flushSync } from "react-dom";
import {
  bulkPeople,
  exportPeopleVCards,
  getMemberPreferences,
  listPeople,
  listPeopleTagFacet,
  listPeopleTagOptions,
  type PeopleDirectoryLifecycle,
  type PeopleDirectoryPerson,
  type PeopleDirectorySort,
  type PeopleDirectoryTag,
  type PeopleTagOptionsInput,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { Avatar } from "@/components/ui/avatar.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { DeleteConfirmation } from "./delete-confirmation.tsx";
import {
  deleteSelection,
  type DeletionPreview,
  previewDeletionSelection,
} from "./delete-selection.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import {
  mountIsland,
  settle,
  useLatestRequest,
} from "../../../islands/core/index.ts";
import {
  nameInitials,
  type PersonNameOrder,
} from "../../../lib/person-name.ts";
import { readStaticForm } from "../../../lib/static-form.ts";
import { resolveWorkspaceSession } from "../../../lib/workspace-context.ts";
import {
  bulkTagPickerReducer,
  initialBulkTagPicker,
  tagOptionsInput,
} from "./bulk-tag-picker.ts";
import {
  type BulkKind,
  bulkProblemReport,
  type BulkReport,
  bulkReport,
  directoryInput,
  directoryLocation,
  type DirectoryQuery,
  directoryReducer,
  emptyCopy,
  errorCopy,
  exportReport,
  facetLabel,
  type FacetState,
  initialDirectory,
  isSort,
  personDetails,
  personName,
  starredCriteria,
} from "./directory.ts";

export const PEOPLE_DIRECTORY_ISLAND = "people-directory";

export interface PeopleDirectoryProps {
  readonly lifecycle: PeopleDirectoryLifecycle;
  /** A search typed into the static form before the island took over. */
  readonly typedSearch?: string | undefined;
  /** A tag search typed into the static form before the island took over. */
  readonly typedTagSearch?: string | undefined;
  /** Called once, when the first list read has settled either way. */
  readonly onSettled?: () => void;
}

interface Context {
  readonly workspaceId: string;
  readonly nameOrder: PersonNameOrder;
  readonly defaultSort: PeopleDirectorySort;
}

type ContextAnswer =
  | { readonly status: "ready"; readonly context: Context }
  | { readonly status: "access-lost" | "unavailable" };

/** The workspace and the member's name and sort order, in that order. */
async function readContext(): Promise<ContextAnswer> {
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") return { status: session.status };
  const workspaceId = session.session.workspace.id;
  const preferences = await settle(() => getMemberPreferences(workspaceId));
  const saved = preferences.data?.preferences;
  return {
    context: {
      defaultSort: saved?.contactSortOrder === "family_name_asc"
        ? "family-name"
        : "given-name",
      nameOrder: saved?.contactNameOrder ?? "given_family_nickname",
      workspaceId,
    },
    status: "ready",
  };
}

const query = () => new URLSearchParams(globalThis.location.search);

/** Hands a downloaded file to the browser to save. */
function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // The browser has taken the file once the click is handled; the address is
  // released a little later for the engines that read it asynchronously.
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function PeopleDirectory(props: PeopleDirectoryProps) {
  const { lifecycle } = props;
  const [state, dispatch] = useReducer(
    directoryReducer,
    query().get("tag") ?? "",
    (tag: string) =>
      initialDirectory(tag, starredCriteria(globalThis.location.search)),
  );
  const listRequest = useLatestRequest();
  const tagRequest = useLatestRequest();
  const search = useRef<HTMLInputElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const tagSearch = useRef<HTMLInputElement>(null);
  const error = useRef<HTMLElement>(null);
  const bulkTagSearch = useRef<HTMLInputElement>(null);
  // The bar control a choice was opened from, which takes focus back. The
  // tag choice replaces the bar's buttons, so it is found again by its step.
  const opener = useRef<string>("");
  // The people the last run was started for, so dismissing its report can
  // hand focus back to the first of them once the selection has gone.
  const lastRun = useRef<readonly string[]>([]);
  const context = useRef<Context | undefined>(undefined);
  // What the next read asks for, as the reader last left it.
  const reading = useRef({
    applied: undefined as DirectoryQuery | undefined,
    sort: state.sort,
    starred: state.starred,
    starredFirst: state.starredFirst,
    tagId: state.tag.selected,
  });
  const settled = useRef(props.onSettled);
  // A facet read is owed until one answers: a newer tag read that replaces
  // the one counting carries it over, so the facet never stays counting.
  const facetOwed = useRef(false);

  const load = async (append: boolean): Promise<void> => {
    const known = context.current;
    if (!known) return;
    if (
      append &&
      (state.loading || state.bulk.running || state.bulk.step !== "idle" ||
        !state.nextCursor)
    ) return;
    const cursor = append ? state.nextCursor : undefined;
    const current = append && reading.current.applied
      ? reading.current.applied
      : {
        search: search.current?.value ?? "",
        sort: reading.current.sort,
        starred: reading.current.starred,
        starredFirst: reading.current.starredFirst,
        tagId: reading.current.tagId,
      };
    // Flush the reducer before an observer or double activation can ask again.
    flushSync(() => dispatch({ append, type: "loading" }));
    const answer = await listRequest(() =>
      listPeople(directoryInput(lifecycle, current, cursor), known.workspaceId)
    );
    if (!answer) return;
    if (answer.status !== "ready") {
      if (append && answer.problem?.code === "stale_cursor") {
        dispatch({
          announcement: "The people list changed. Showing current results.",
          type: "announce",
        });
        await load(false);
        return;
      }
      const status = answer.problem?.status;
      dispatch({ forbidden: status === 401 || status === 403, type: "failed" });
      return;
    }
    const page = answer.data!;
    if (!append) {
      reading.current.applied = current;
      globalThis.history.replaceState(
        {},
        "",
        directoryLocation(
          globalThis.location.pathname,
          globalThis.location.search,
          current,
          known.defaultSort,
        ),
      );
    }
    dispatch({
      append,
      filtered: Boolean(
        current.search.trim() || current.tagId || current.starred,
      ),
      lifecycle,
      nextCursor: page.nextCursor,
      people: page.people,
      type: "loaded",
    });
  };

  /**
   * A page of tag options and, when `facet` asks, the tag facet with it:
   * both through the tag slot, so only the latest answer of either lands.
   */
  const loadTags = async (append: boolean, asked = false): Promise<void> => {
    const known = context.current;
    if (!known) return;
    if (asked) facetOwed.current = true;
    const facet = facetOwed.current;
    const cursor = append ? state.tag.cursor : undefined;
    const text = tagSearch.current?.value.trim() ?? "";
    const selectedTagId = reading.current.tagId;
    dispatch({ append, type: "tags-loading" });
    // The options land as soon as they answer, so a slow facet never holds
    // the tag picker; the facet lands after them unless a newer tag read
    // replaced this one, which then carries the owed facet itself.
    let retired: AbortSignal | undefined;
    const answer = await tagRequest(async (signal) => {
      retired = signal;
      const counts = facet
        ? settle(() => listPeopleTagFacet(lifecycle, known.workspaceId))
        : undefined;
      const options = await settle(() =>
        listPeopleTagOptions({
          ...(cursor ? { cursor } : {}),
          ...(text ? { search: text } : {}),
          ...(selectedTagId ? { selectedTagId } : {}),
        }, known.workspaceId)
      );
      return { ok: true as const, value: { counts, options } };
    });
    if (!answer) return;
    const { counts, options } = answer.data!;
    if (options.status !== "ready") {
      dispatch({ type: "tags-failed" });
    } else {
      dispatch({ append, page: options.data!, type: "tags-loaded" });
    }
    if (!counts) return;
    const counted = await counts;
    if (retired?.aborted) return;
    facetOwed.current = false;
    dispatch(
      counted.status === "ready"
        ? { facet: counted.data!, type: "facet-loaded" }
        : { type: "facet-failed" },
    );
  };

  /** Resolves the workspace and preferences, then reads both lists. */
  const start = async (): Promise<void> => {
    const answer = await listRequest<ContextAnswer>(() =>
      readContext().then((value) => ({ ok: true as const, value }))
    );
    if (!answer) return;
    const resolved = answer.data!;
    if (resolved.status !== "ready") {
      dispatch({
        forbidden: resolved.status === "access-lost",
        type: "failed",
      });
      return;
    }
    context.current = resolved.context;
    const requested = query().get("sort");
    const sort = isSort(requested) ? requested : resolved.context.defaultSort;
    reading.current.sort = sort;
    dispatch({
      defaultSort: resolved.context.defaultSort,
      nameOrder: resolved.context.nameOrder,
      sort,
      type: "context",
    });
    await Promise.all([load(false), loadTags(false, true)]);
  };

  // A search typed while the page loaded is kept over the address's.
  const typed = useRef({
    search: props.typedSearch,
    tag: props.typedTagSearch,
  });
  useLayoutEffect(() => {
    search.current!.value = typed.current.search || query().get("search") ||
      "";
    tagSearch.current!.value = typed.current.tag ?? "";
  }, []);

  const first = useEffectEvent(() => start());
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  useLayoutEffect(() => {
    if (state.status === "error") error.current?.focus();
  }, [state.status]);

  /** The people a report names, as the list shows them now. */
  const shownNames = () =>
    new Map(
      state.people.map((person) => [
        person.id,
        personName(person, state.nameOrder),
      ]),
    );

  const runBulk = async (
    kind: Exclude<BulkKind, "export" | "delete">,
    tag?: { readonly id: string; readonly name: string },
  ): Promise<void> => {
    // The bar is drawn only over a loaded list and is inert while a run is
    // in flight, so the workspace is known and nothing else is running.
    const known = context.current!;
    const names = shownNames();
    const personIds = [...state.selection];
    lastRun.current = personIds;
    dispatch({ kind, type: "bulk-start" });
    const answer = await settle(() =>
      bulkPeople({
        action: kind,
        personIds,
        ...(tag ? { tagId: tag.id } : {}),
      }, known.workspaceId)
    );
    if (answer.status !== "ready") {
      dispatch({
        clearSelection: false,
        report: bulkProblemReport(kind, answer.problem?.detail),
        type: "bulk-finished",
      });
      return;
    }
    dispatch({
      clearSelection: true,
      report: bulkReport(kind, answer.data!, names, tag?.name),
      type: "bulk-finished",
    });
    // The run changed who carries which tag in this view, so the facet's
    // counts are read again with the list.
    await Promise.all([load(false), loadTags(false, true)]);
  };

  const runDelete = async (
    previews: readonly DeletionPreview[],
  ): Promise<void> => {
    const names = shownNames();
    lastRun.current = [...state.selection];
    dispatch({ kind: "delete", type: "bulk-start" });
    const answer = await deleteSelection(
      previews,
      context.current!.workspaceId,
    );
    dispatch({
      clearSelection: true,
      report: bulkReport("delete", answer, names),
      type: "bulk-finished",
    });
    await Promise.all([load(false), loadTags(false, true)]);
  };

  const exportSelection = async (): Promise<void> => {
    // The bar is drawn only over a loaded list and is inert while a run is
    // in flight, so the workspace is known and nothing else is running.
    const known = context.current!;
    const personIds = [...state.selection];
    lastRun.current = personIds;
    dispatch({ kind: "export", type: "bulk-start" });
    const answer = await settle(() =>
      exportPeopleVCards({ personIds }, known.workspaceId)
    );
    let finished: BulkReport;
    if (answer.status === "ready") {
      const file = answer.data!;
      saveFile(file.blob, file.filename);
      finished = exportReport(personIds.length - file.skipped, file.skipped);
    } else {
      finished = bulkProblemReport("export", answer.problem?.detail);
    }
    dispatch({
      clearSelection: false,
      report: finished,
      type: "bulk-finished",
    });
  };

  // A choice opens inside its click, so its first control takes focus while
  // the click is still being handled (REL-051).
  const openStep = (
    step: "confirm-archive" | "confirm-delete" | "tag" | "untag",
  ) => {
    opener.current = step;
    flushSync(() => dispatch({ step, type: "bulk-step" }));
    // The tag choice opens on its search, the first of its controls.
    if (step === "tag" || step === "untag") bulkTagSearch.current?.focus();
  };

  const closeStep = () => {
    flushSync(() => dispatch({ step: "idle", type: "bulk-step" }));
    document.querySelector<HTMLElement>(
      `[data-bulk-opener="${opener.current}"]`,
    )?.focus();
  };

  // Dismissing the report returns focus to the bar while a selection
  // remains, otherwise to the first person the run was for, never the body.
  const dismissReport = () => {
    flushSync(() => dispatch({ type: "bulk-dismiss" }));
    const target =
      document.querySelector<HTMLElement>("#people-bulk-bar button") ??
        document.querySelector<HTMLElement>(
          `[data-person-select="${lastRun.current[0] ?? ""}"]`,
        ) ??
        document.querySelector<HTMLElement>("#people-directory-select-all") ??
        document.querySelector<HTMLElement>("#people-directory-search");
    target?.focus();
  };

  // The picker is drawn only over a loaded list, so the workspace is known.
  const readBulkTags = (input: PeopleTagOptionsInput) =>
    listPeopleTagOptions(input, context.current!.workspaceId);

  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Before the workspace is known, the first load serves the submission.
    void load(false);
  };

  // The select offers only the three sorts.
  const chooseSort = (value: PeopleDirectorySort) => {
    reading.current.sort = value;
    dispatch({ sort: value, type: "sort" });
  };

  const chooseTag = (value: string, name?: string) => {
    reading.current.tagId = value;
    dispatch({
      selected: value,
      type: "tag",
      ...(name === undefined ? {} : { name }),
    });
  };

  // A facet chip applies the tag filter at once; the chosen chip clears it.
  const chooseFacetTag = (id: string, name: string) => {
    chooseTag(reading.current.tagId === id ? "" : id, name);
    void load(false);
  };

  const chooseStarred = (starred: boolean) => {
    reading.current.starred = starred;
    dispatch({ starred, type: "starred" });
  };

  const chooseStarredFirst = (starredFirst: boolean) => {
    reading.current.starredFirst = starredFirst;
    dispatch({ starredFirst, type: "starred-first" });
  };

  const { loading, status } = state;
  const running = state.bulk.running !== undefined;
  // A bulk run holds every control the list is read with, as a read does.
  const busy = loading || running;
  const archived = lifecycle === "archived";
  const empty = emptyCopy(state.filtered, lifecycle);
  const failure = errorCopy(state.forbidden);
  const listShown = status === "ready" ||
    (status === "loading" && state.appending);

  const continueList = useEffectEvent(() => void load(true));
  useEffect(() => {
    if (
      !state.nextCursor || busy || state.bulk.step !== "idle" ||
      !globalThis.IntersectionObserver
    ) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) continueList();
    }, { rootMargin: "160px" });
    observer.observe(more.current!);
    return () => observer.disconnect();
  }, [state.nextCursor, busy, state.bulk.step]);

  return (
    <>
      <form
        className="people-directory-controls"
        id="people-directory-controls"
        method="post"
        onSubmit={submit}
        role="search"
      >
        <label className="directory-search-field">
          Search people
          <input
            ref={search}
            autoComplete="off"
            disabled={busy}
            id="people-directory-search"
            maxLength={200}
            name="search"
            placeholder="Name or nickname"
            type="search"
          />
        </label>
        <fieldset className="directory-tag-picker">
          <legend>Tag filter</legend>
          <label htmlFor="people-tag-options-search">Search tag options</label>
          <div className="directory-tag-search">
            <input
              ref={tagSearch}
              autoComplete="off"
              disabled={busy}
              id="people-tag-options-search"
              name="tagSearch"
              maxLength={200}
              placeholder="Tag name"
              type="search"
            />
            <button
              disabled={busy || state.tag.loading}
              id="people-tag-options-search-button"
              onClick={() => void loadTags(false)}
              type="button"
            >
              Search tags
            </button>
          </div>
          <label htmlFor="people-directory-tag">Tag</label>
          <select
            disabled={busy}
            id="people-directory-tag"
            name="tag"
            onChange={(event) => chooseTag(event.target.value)}
            value={state.tag.selected}
          >
            <option value="">All tags</option>
            {state.tag.options.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
          <div className="directory-tag-pagination">
            <button
              disabled={busy || state.tag.loading}
              hidden={!state.tag.cursor}
              id="people-tag-options-more"
              onClick={() => void loadTags(true)}
              type="button"
            >
              Load more tags
            </button>
            <p
              aria-live="polite"
              id="people-tag-options-status"
              role="status"
            >
              {state.tag.status}
            </p>
          </div>
          <TagFacet
            busy={busy}
            facet={state.facet}
            onChoose={chooseFacetTag}
            onMore={() => tagSearch.current?.focus()}
            selected={state.tag.selected}
          />
        </fieldset>
        <label>
          Sort by
          <select
            disabled={busy}
            id="people-directory-sort"
            name="sort"
            onChange={(event) =>
              chooseSort(event.target.value as PeopleDirectorySort)}
            value={state.sort}
          >
            <option value="given-name">Given name</option>
            <option value="family-name">Family name</option>
            <option value="recently-added">Recently added</option>
            <option value="last-contacted">Last contacted</option>
            <option value="recently-updated">Recently updated</option>
          </select>
        </label>
        <fieldset className="directory-starred">
          <legend>Starred people</legend>
          <label>
            <input
              checked={state.starred}
              disabled={busy}
              id="people-directory-starred"
              name="starred"
              onChange={(event) => chooseStarred(event.target.checked)}
              type="checkbox"
            />
            Starred only
          </label>
          <label>
            <input
              checked={state.starredFirst}
              disabled={busy}
              id="people-directory-starred-first"
              name="starredFirst"
              onChange={(event) => chooseStarredFirst(event.target.checked)}
              type="checkbox"
            />
            Starred first
          </label>
        </fieldset>
        <button disabled={busy} type="submit">Find people</button>
      </form>

      <p
        aria-live="polite"
        className="directory-count"
        id="people-directory-announcement"
        role="status"
      >
        {state.announcement}
      </p>

      <section
        aria-live="polite"
        className="directory-state"
        hidden={status !== "context" &&
          !(status === "loading" && !state.appending)}
        id="people-directory-state"
        role="status"
      >
        <div aria-hidden="true" className="directory-loading-mark"></div>
        <div>
          <h2>Loading {archived ? "archived " : ""}people…</h2>
          <p>Looking only in your active workspace.</p>
        </div>
      </section>

      <section
        ref={error}
        className="directory-state directory-error"
        hidden={status !== "error"}
        id="people-directory-error"
        role="alert"
        tabIndex={-1}
      >
        <div>
          <h2>{failure.heading}</h2>
          <p>{failure.detail}</p>
          <button
            id="people-directory-retry"
            onClick={() => void (context.current ? load(false) : start())}
            type="button"
          >
            Try again
          </button>
        </div>
      </section>

      <section
        className="directory-state directory-empty"
        hidden={status !== "ready" || state.people.length > 0}
        id="people-directory-empty"
        tabIndex={-1}
      >
        <div>
          <h2>{empty.heading}</h2>
          <p>{empty.detail}</p>
          {archived ? null : (
            <a
              className={buttonVariants({
                className: "mt-(--space-4)",
                shape: "pill",
              })}
              href="/app/people/new"
            >
              Add a person
            </a>
          )}
        </div>
      </section>

      <p aria-live="polite" role="status">
        {state.bulk.running === "delete" ? "Deleting selected people…" : ""}
      </p>

      {state.bulk.report
        ? (
          <BulkResult
            onDismiss={dismissReport}
            report={state.bulk.report}
            sequence={state.bulk.sequence}
          />
        )
        : null}

      {listShown && state.people.length > 0
        ? (
          <div className="directory-selection">
            <label className="directory-select-all">
              <input
                checked={state.people.every((person) =>
                  state.selection.includes(person.id)
                )}
                disabled={busy}
                id="people-directory-select-all"
                onChange={(event) =>
                  dispatch({
                    selected: event.target.checked,
                    type: "select-page",
                  })}
                type="checkbox"
              />
              Select all {state.people.length} shown
            </label>
            <p
              aria-live="polite"
              className="directory-selection-notice"
              id="people-selection-notice"
              role="status"
            >
              {state.selectionNotice}
            </p>
          </div>
        )
        : null}

      <ul
        aria-label={archived ? "Archived people" : "Active people"}
        className="people-directory-list"
        hidden={!listShown || state.people.length === 0}
        id="people-directory-list"
      >
        {state.people.map((person) => (
          <PersonItem
            disabled={busy}
            key={person.id}
            nameOrder={state.nameOrder}
            onSelect={(selected) =>
              dispatch({ personId: person.id, selected, type: "select" })}
            person={person}
            selected={state.selection.includes(person.id)}
          />
        ))}
      </ul>
      <div className="directory-pagination">
        <button
          disabled={busy}
          hidden={!state.nextCursor || !listShown}
          ref={more}
          id="people-directory-more"
          onClick={() => void load(true)}
          type="button"
        >
          Load more people
        </button>
      </div>

      {state.selection.length > 0
        ? (
          <div
            aria-busy={running}
            aria-label="Bulk actions"
            className="people-bulk-bar"
            id="people-bulk-bar"
            inert={busy}
            role="toolbar"
          >
            <p className="people-bulk-count">
              {state.selection.length} selected
            </p>
            {state.bulk.step === "tag" || state.bulk.step === "untag"
              ? (
                <BulkTagPicker
                  key={state.bulk.step}
                  onApply={(step, tag) => void runBulk(step, tag)}
                  onCancel={closeStep}
                  read={readBulkTags}
                  searchRef={bulkTagSearch}
                  step={state.bulk.step}
                />
              )
              : (
                <div className="people-bulk-actions">
                  {
                    /* An archived person is read-only, so the archived view
                    offers no tagging: every person would be refused. */
                  }
                  {archived ? null : (
                    <>
                      <Button
                        data-bulk-opener="tag"
                        onClick={() => openStep("tag")}
                        type="button"
                        variant="outline"
                      >
                        Add tag…
                      </Button>
                      <Button
                        data-bulk-opener="untag"
                        onClick={() => openStep("untag")}
                        type="button"
                        variant="outline"
                      >
                        Remove tag…
                      </Button>
                    </>
                  )}
                  {archived
                    ? (
                      <Button
                        onClick={() => void runBulk("restore")}
                        type="button"
                        variant="outline"
                      >
                        Restore
                      </Button>
                    )
                    : (
                      <Button
                        data-bulk-opener="confirm-archive"
                        onClick={() => openStep("confirm-archive")}
                        type="button"
                        variant="outline"
                      >
                        Archive
                      </Button>
                    )}
                  <Button
                    data-bulk-opener="confirm-delete"
                    onClick={() => openStep("confirm-delete")}
                    type="button"
                    variant="destructive"
                  >
                    Delete
                  </Button>
                  <Button
                    onClick={() => void exportSelection()}
                    type="button"
                    variant="outline"
                  >
                    Export vCard
                  </Button>
                  <Button
                    onClick={() => dispatch({ type: "clear-selection" })}
                    type="button"
                    variant="outline"
                  >
                    Clear
                  </Button>
                </div>
              )}
          </div>
        )
        : null}

      {state.bulk.step === "confirm-delete"
        ? (
          <DeleteConfirmation
            personIds={state.selection}
            names={shownNames()}
            read={(signal, progress) =>
              previewDeletionSelection(
                state.selection,
                context.current!.workspaceId,
                signal,
                progress,
              )}
            onCancel={closeStep}
            onConfirm={(previews) => void runDelete(previews)}
          />
        )
        : null}

      {state.bulk.step === "confirm-archive"
        ? (
          <ArchiveConfirmation
            count={state.selection.length}
            onCancel={closeStep}
            onConfirm={() => void runBulk("archive")}
          />
        )
        : null}
    </>
  );
}

/**
 * The bar's tag choice (REL-066): the tag options a bulk action can pick,
 * read apart from the tag filter. It reads the first page when it opens;
 * its search and More tags reach the rest. Only the latest read lands, so a
 * search a newer one replaced is never shown.
 */
function BulkTagPicker(
  props: {
    readonly onApply: (
      step: "tag" | "untag",
      tag: PeopleDirectoryTag,
    ) => void;
    readonly onCancel: () => void;
    readonly read: (
      input: PeopleTagOptionsInput,
    ) => ReturnType<typeof listPeopleTagOptions>;
    readonly searchRef: RefObject<HTMLInputElement | null>;
    readonly step: "tag" | "untag";
  },
) {
  const { onApply, onCancel, read, searchRef: search, step } = props;
  const [picker, dispatch] = useReducer(
    bulkTagPickerReducer,
    initialBulkTagPicker,
  );
  const request = useLatestRequest();
  const adding = step === "tag";

  const load = async (append: boolean): Promise<void> => {
    const text = append ? picker.query : search.current!.value.trim();
    const input = tagOptionsInput(text, append ? picker.cursor : undefined);
    dispatch({ append, query: text, type: "loading" });
    const answer = await request(() => read(input));
    if (!answer) return;
    flushSync(() =>
      dispatch(
        answer.status === "ready"
          ? { append, page: answer.data!, type: "loaded" }
          : { append, type: "failed" },
      )
    );
    // More tags goes once the last page has come; focus moves to the
    // options it brought rather than falling to the page. A failed page
    // keeps the control, and focus on it, to try again.
    if (append && answer.status === "ready" && !answer.data!.nextCursor) {
      document.querySelector<HTMLElement>("#people-bulk-tag")?.focus();
    }
  };

  const first = useEffectEvent(() => load(false));
  useEffect(() => {
    void first();
  }, []);

  const chosen = picker.options.find((option) => option.id === picker.chosen);
  return (
    <div className="people-bulk-choice">
      <label htmlFor="people-bulk-tag-search">
        {adding ? "Search tags to add" : "Search tags to remove"}
      </label>
      <input
        ref={search}
        autoComplete="off"
        id="people-bulk-tag-search"
        maxLength={200}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void load(false);
        }}
        placeholder="Tag name"
        type="search"
      />
      <Button onClick={() => void load(false)} type="button" variant="outline">
        Search
      </Button>
      <label htmlFor="people-bulk-tag">
        {adding ? "Tag to add" : "Tag to remove"}
      </label>
      <select
        id="people-bulk-tag"
        onChange={(event) =>
          dispatch({ id: event.target.value, type: "choose" })}
        value={picker.chosen}
      >
        {picker.options.map((option) => (
          <option key={option.id} value={option.id}>{option.name}</option>
        ))}
      </select>
      {picker.cursor
        ? (
          // Busy rather than disabled while its page loads (REL-077), as
          // `LoadMore` is: some browsers drop focus from a button that
          // becomes disabled, so it stays focusable and ignores activation.
          <Button
            aria-busy={picker.loading ? "true" : undefined}
            aria-disabled={picker.loading ? "true" : undefined}
            onClick={() => picker.loading || void load(true)}
            type="button"
            variant="outline"
          >
            More tags
          </Button>
        )
        : null}
      <Button
        disabled={!chosen}
        onClick={() => chosen && onApply(step, chosen)}
        type="button"
      >
        {adding ? "Add tag" : "Remove tag"}
      </Button>
      <Button onClick={onCancel} type="button" variant="outline">
        Cancel
      </Button>
      <p aria-live="polite" id="people-bulk-tag-status" role="status">
        {picker.status}
      </p>
    </div>
  );
}

/**
 * The tag facet (GAP-053): the view's most carried tags as chips with their
 * person counts. A chip applies the tag filter; the chosen chip is pressed
 * and clears it. When more tags are in use, More tags… moves to the tag
 * options search, where every tag stays reachable.
 */
function TagFacet(
  props: {
    readonly busy: boolean;
    readonly facet: FacetState;
    readonly onChoose: (id: string, name: string) => void;
    readonly onMore: () => void;
    readonly selected: string;
  },
) {
  const { facet } = props;
  return (
    <div
      aria-labelledby="people-tag-facet-heading"
      className="directory-tag-facet"
      id="people-tag-facet"
      role="group"
    >
      <p className="directory-tag-facet-heading" id="people-tag-facet-heading">
        Tags in this view
      </p>
      {facet.status === "ready" && facet.tags.length > 0
        ? (
          <ul aria-labelledby="people-tag-facet-heading">
            {facet.tags.map((entry) => (
              <li key={entry.id}>
                <button
                  aria-label={facetLabel(entry)}
                  aria-pressed={props.selected === entry.id}
                  className="directory-tag-chip"
                  disabled={props.busy}
                  onClick={() => props.onChoose(entry.id, entry.name)}
                  type="button"
                >
                  <span>{entry.name}</span>
                  <span aria-hidden="true" className="directory-tag-count">
                    {entry.count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
        : (
          <p className="directory-tag-facet-state">
            {facet.status === "loading"
              ? "Counting tags…"
              : facet.status === "unavailable"
              ? "Tag counts are temporarily unavailable."
              : "No tags are used in this view."}
          </p>
        )}
      {facet.status === "ready" && facet.truncated
        ? (
          <button
            className="directory-tag-facet-more"
            disabled={props.busy}
            onClick={props.onMore}
            type="button"
          >
            More tags…
          </button>
        )
        : null}
    </div>
  );
}

const plural = (count: number) =>
  `${count} ${count === 1 ? "person" : "people"}`;

/** Archiving moves people out of the active list, so it is asked first. */
function ArchiveConfirmation(
  props: {
    readonly count: number;
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
  },
) {
  return (
    <Dialog
      disablePointerDismissal
      // The dialog is open for as long as it is drawn, so any change is a
      // request to close it: Escape.
      onOpenChange={props.onCancel}
      open
    >
      <DialogContent className="w-[min(30rem,calc(100%-2rem))]">
        <DialogTitle>Archive {plural(props.count)}?</DialogTitle>
        <DialogDescription>
          They leave the active list and become read-only. You can restore them
          from Archived people.
        </DialogDescription>
        <div className="flex flex-wrap justify-end gap-(--space-2)">
          <DialogClose
            render={
              <Button type="button" variant="outline">
                Cancel
              </Button>
            }
          />
          <Button onClick={props.onConfirm} type="button">
            Archive {plural(props.count)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** What the last bulk action did, kept after the list refreshes. */
function BulkResult(
  props: {
    readonly onDismiss: () => void;
    readonly report: BulkReport;
    /** Which finished run this reports; each new one takes focus once. */
    readonly sequence: number;
  },
) {
  const { report } = props;
  const section = useRef<HTMLElement>(null);
  // Each finished bulk run hands focus to its report, since the bar it was
  // started from has usually gone with the selection.
  useLayoutEffect(() => {
    section.current?.focus();
  }, [props.sequence]);
  return (
    <section
      aria-labelledby="people-bulk-result-title"
      className="people-bulk-result"
      data-tone={report.tone}
      id="people-bulk-result"
      ref={section}
      tabIndex={-1}
    >
      <p id="people-bulk-result-title">
        <strong>{report.title}</strong>
      </p>
      {report.counts ? <p>{report.counts}</p> : null}
      {report.failures.length > 0
        ? (
          <ul aria-label="People not changed">
            {report.failures.map((failure, index) => (
              <li key={index}>{failure.name}: {failure.reason}</li>
            ))}
          </ul>
        )
        : null}
      <Button
        onClick={props.onDismiss}
        type="button"
        variant="outline"
      >
        Dismiss
      </Button>
    </section>
  );
}

function PersonItem(
  props: {
    readonly disabled: boolean;
    readonly nameOrder: PersonNameOrder;
    readonly onSelect: (selected: boolean) => void;
    readonly person: PeopleDirectoryPerson;
    readonly selected: boolean;
  },
) {
  const { person } = props;
  const name = personName(person, props.nameOrder);
  const remaining = person.tagCount - person.tags.length;
  return (
    <li>
      {/* Beside the link, not in it, so the link keeps its own name. */}
      <input
        aria-label={`Select ${name}`}
        data-person-select={person.id}
        checked={props.selected}
        className="directory-person-select"
        disabled={props.disabled}
        onChange={(event) => props.onSelect(event.target.checked)}
        type="checkbox"
      />
      <a className="person-directory-link" href={`/app/people/${person.id}`}>
        <span className="directory-person-heading">
          <Avatar avatar={person.avatar} initials={nameInitials(name)} />
          <h2>{name}</h2>
          {
            /* The row's details already say "Favorite" to a screen reader;
            the star is its mark for the eye (GAP-053). */
          }
          {person.isStarred
            ? (
              <span aria-hidden="true" className="directory-person-star">
                ★
              </span>
            )
            : null}
        </span>
        <p className="directory-person-details">{personDetails(person)}</p>
        {person.tagCount > 0
          ? (
            <ul
              aria-label={`Tags for ${name}: ${person.tagCount} total`}
              className="directory-person-tags"
            >
              {person.tags.map((tag) => <li key={tag.id}>{tag.name}</li>)}
              {remaining > 0
                ? (
                  <li
                    aria-label={`${remaining} more ${
                      remaining === 1 ? "tag" : "tags"
                    } not shown`}
                    className="directory-person-tags-more"
                  >
                    +{remaining} more
                  </li>
                )
                : null}
            </ul>
          )
          : null}
      </a>
    </li>
  );
}

/**
 * Mounts the directory over the region the page drew (`[data-people-directory]`)
 * and resolves, once the first list read has settled, with the function that
 * unmounts it. The page's `data-people-lifecycle` names the list it shows.
 */
export function mountPeopleDirectory(
  root: ParentNode = document,
): Promise<() => void> {
  const region = root.querySelector<HTMLElement>("[data-people-directory]");
  if (!region) return Promise.resolve(() => undefined);
  const lifecycle = region.closest<HTMLElement>("[data-people-lifecycle]")
      ?.dataset.peopleLifecycle === "archived"
    ? "archived"
    : "active";
  const typed = readStaticForm(
    region.querySelector<HTMLFormElement>("#people-directory-controls"),
  );
  return new Promise((resolve) => {
    const unmount = mountIsland(
      region,
      PEOPLE_DIRECTORY_ISLAND,
      <PeopleDirectory
        lifecycle={lifecycle}
        onSettled={() => resolve(unmount)}
        typedSearch={typed.values.search}
        typedTagSearch={typed.values.tagSearch}
      />,
    );
    typed.restoreFocus(region);
  });
}
