/**
 * The relationships rail block as an island (GAP-031).
 *
 * The block lists a person's relationships grouped by type and direction,
 * changes a relationship's type or unlinks it in place, and adds one to an
 * existing person or to a new related person created with it. Its state
 * moves through one pure reducer (`relationships.ts`), and what it shows is
 * derived in one place (`relationshipsView`).
 *
 * It has two read slots. Every read of the block — its relationships, its
 * relationship types, or both together — goes through the first, and the
 * controls that would start another stay disabled while one is in flight, so
 * one never retires another. The editor's people search goes through the
 * second. A lifecycle change, or the island unmounting, retires both, so a
 * late answer never reaches a block that has moved on. Writes are never
 * optimistic: each re-reads the relationships and only then says so.
 *
 * It tells the rail its count and empty state through `profile-summary.ts`,
 * as the vanilla block it replaced did, and announces a state the reader must hear
 * without scrolling the page under a pending click (REL-039). The editor
 * keeps the rail editors' rules; the phone sheet moves the form and the
 * status line, so every element of the block always renders and the form
 * stays last.
 */

import {
  type SyntheticEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";
import {
  Combobox,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox.tsx";
import { Search } from "lucide-react";
import { Avatar } from "@/components/ui/avatar.tsx";
import {
  createRelatedPersonRelationship,
  createRelationship,
  deleteRelationship,
  listPeople,
  listRelationships,
  listRelationshipTypes,
  type RelationshipListPage,
  type RelationshipType,
  updateRelationship,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { Button } from "@/components/ui/button.tsx";
import { formActionsVariants } from "@/components/ui/variants.ts";
import {
  mountIsland,
  settle,
  type Settled,
  useDocumentEvent,
  useLatestRequest,
} from "../../../islands/core/index.ts";
import {
  registerRailEditors,
  requestRailEditorOpen,
} from "../../../lib/rail-editors.ts";
import { saveWithLockedForm } from "../../../lib/unsaved-changes.ts";
import { nameInitials } from "../../../lib/person-name.ts";
import { Quiet } from "../facts/fact-list.tsx";
import { setRailCount, setRailEmpty } from "../profile-summary.ts";
import { sectionHidden, type SectionMount } from "../section-mounts.ts";
import {
  editorVisible,
  groupRelationships,
  initialRelationshipsState,
  lifecycleChange,
  normalizeRevision,
  personName,
  type RelatedDraft,
  relatedName,
  type RelationshipFocus,
  relationshipsReducer,
  relationshipsView,
  type Row,
  rowType,
  selectedTypeIds,
  summaryRowIds,
  typeChoices,
} from "./relationships.ts";

export const PERSON_RELATIONSHIPS_ISLAND = "person-relationships";

export interface PersonRelationshipsProps {
  readonly personId: string;
  readonly workspaceId: string;
  readonly archived: boolean;
  /** The person's revision the page loaded; older lifecycle news is ignored. */
  readonly personUpdatedAt?: string | undefined;
  /** The block the island renders into; it carries the section state. */
  readonly root: HTMLElement;
  /** The shell's heading the add control renders into. */
  readonly heading?: HTMLElement | undefined;
  /** Called once, when the first read has settled either way. */
  readonly onSettled?: () => void;
}

type TypeAnswer = Settled<
  Extract<
    Awaited<ReturnType<typeof listRelationshipTypes>>,
    { readonly ok: true }
  >["value"]
>;
type ListAnswer = Settled<RelationshipListPage>;

const PAGE = 20;

/** An answer that retires whatever a slot was waiting for. */
const retired = () => Promise.resolve({ ok: true as const, value: undefined });

function focusMain(): void {
  document.getElementById("main-content")?.focus({ preventScroll: true });
}

export function PersonRelationships(props: PersonRelationshipsProps) {
  const { personId, root, workspaceId } = props;
  const [state, dispatch] = useReducer(
    relationshipsReducer,
    props.archived,
    initialRelationshipsState,
  );
  const view = relationshipsView(state);
  const sectionRequest = useLatestRequest();
  const peopleRequest = useLatestRequest();
  // The newest lifecycle revision, read by the event handler in the task the
  // event arrives, before any render.
  const revision = useRef(normalizeRevision(props.personUpdatedAt) ?? "");
  const form = useRef<HTMLFormElement>(null);
  const stateLine = useRef<HTMLParagraphElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const peopleSearch = useRef<HTMLInputElement>(null);
  const typeSearch = useRef<HTMLInputElement>(null);
  const givenNameInput = useRef<HTMLInputElement>(null);
  const familyNameInput = useRef<HTMLInputElement>(null);
  const typeSelect = useRef<HTMLSelectElement>(null);
  const selectExisting = useRef<HTMLButtonElement>(null);
  const settled = useRef(props.onSettled);

  const typeRequest = (
    cursor: string | undefined,
    search: string,
    selected: readonly string[],
  ) =>
    listRelationshipTypes({
      ...(cursor ? { cursor } : {}),
      ...(search ? { search } : {}),
      ...(selected.length ? { selected } : {}),
    }, workspaceId);

  const listRequest = (cursor: string | undefined) =>
    listRelationships(
      personId,
      { ...(cursor ? { cursor } : {}), limit: PAGE },
      workspaceId,
    );

  const applyTypes = (
    answer: TypeAnswer,
    cursor: string | undefined,
    focus?: RelationshipFocus,
  ) => {
    if (answer.status !== "ready" || !answer.data) {
      dispatch({ detail: answer.problem?.detail, type: "types-failed" });
      return;
    }
    dispatch({
      cursor,
      nextCursor: answer.data.nextCursor,
      options: answer.data.options,
      selected: answer.data.selected,
      status: answer.data.status,
      type: "types-loaded",
      ...(focus ? { focus } : {}),
    });
  };

  const applyList = (
    answer: ListAnswer,
    cursor: string | undefined,
    notice?: string,
  ) => {
    if (answer.status !== "ready" || !answer.data) {
      dispatch({ status: answer.problem?.status, type: "list-failed" });
      return;
    }
    dispatch({
      cursor,
      page: answer.data,
      type: "list-loaded",
      ...(notice ? { notice } : {}),
    });
  };

  /** Reads the first page of relationships and of their types together. */
  const readAll = (): Promise<void> => {
    const selected = selectedTypeIds("", state.rows);
    return sectionRequest(async () => {
      const [types, rows] = await Promise.all([
        settle(() => typeRequest(undefined, "", selected)),
        settle(() => listRequest(undefined)),
      ]);
      return { ok: true as const, value: { rows, types } };
    }).then((answer) => {
      // A lifecycle change retired this read.
      if (!answer) return;
      const { rows, types } = answer.data!;
      applyTypes(types, undefined);
      applyList(rows, undefined);
    });
  };

  /** Reads a page of relationships; answers whether the answer landed. */
  const readList = async (
    cursor: string | undefined,
    options: {
      readonly previous?: readonly (string | undefined)[];
      readonly notice?: string;
    } = {},
  ): Promise<boolean> => {
    dispatch({
      type: "list-loading",
      ...(options.previous ? { previous: options.previous } : {}),
    });
    const answer = await sectionRequest(() => listRequest(cursor));
    if (!answer) return false;
    applyList(answer, cursor, options.notice);
    return true;
  };

  /** Reads a page of relationship types, keeping the chosen type in view. */
  const readTypes = async (
    cursor: string | undefined,
    options: {
      readonly previous: readonly (string | undefined)[];
      readonly search?: string;
    },
  ): Promise<void> => {
    const search = options.search ?? state.typeSearch;
    const selected = selectedTypeIds(state.typeId, state.rows);
    dispatch({
      previous: options.previous,
      type: "types-loading",
      ...(options.search !== undefined ? { search: options.search } : {}),
    });
    const answer = await sectionRequest(() =>
      typeRequest(cursor, search, selected)
    );
    if (answer) applyTypes(answer, cursor, "type");
  };

  const findPeople = async (term: string): Promise<void> => {
    const answer = await peopleRequest(() =>
      listPeople(
        { excludePersonId: personId, limit: PAGE, search: term },
        workspaceId,
      )
    );
    if (!answer) return;
    if (answer.status !== "ready" || !answer.data) {
      dispatch({ type: "people-failed" });
      return;
    }
    dispatch({
      people: answer.data.people.map((person) => ({
        id: person.id,
        name: personName(person),
      })),
      type: "people-found",
    });
  };

  const searchPeople = useEffectEvent((term: string) => findPeople(term));
  const editorOpen = editorVisible(state);
  useEffect(() => {
    // Retire the old answer before the debounce, including when cleared or closed.
    void peopleRequest(retired);
    if (!editorOpen || state.targetId || !state.peopleQuery.trim()) return;
    const timer = setTimeout(
      () => void searchPeople(state.peopleQuery.trim()),
      250,
    );
    return () => {
      clearTimeout(timer);
      void peopleRequest(retired);
    };
  }, [editorOpen, peopleRequest, state.peopleQuery, state.targetId]);

  // The first read starts in the loading state the island mounted with.
  const first = useEffectEvent(() => readAll());
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  useLayoutEffect(() => {
    root.setAttribute("data-section-state", view.sectionState);
    root.toggleAttribute("hidden", view.kind === "hidden");
  }, [root, view.kind, view.sectionState]);

  // A hidden module leaves no draft behind in the form either.
  useLayoutEffect(() => {
    if (view.kind === "hidden") form.current?.reset();
  }, [view.kind]);

  // What the block shows reaches the rail after each change.
  const count = state.rows.length;
  useEffect(() => {
    if (view.kind === "hidden") {
      setRailCount("relationships", undefined);
      setRailEmpty("relationships", false);
    } else if (view.kind === "ready" || view.kind === "read-only") {
      setRailCount("relationships", count);
      setRailEmpty("relationships", view.kind === "ready" && count === 0);
    } else if (view.kind !== "loading" && view.kind !== "searching") {
      setRailEmpty("relationships", false);
    }
  }, [count, view.kind]);

  // A state the reader must hear is announced where the reader is, without
  // scrolling the page (REL-039).
  useLayoutEffect(() => {
    if (view.announce === "state") {
      stateLine.current?.focus({ preventScroll: true });
    } else if (view.announce === "main") focusMain();
  }, [view.announce, view.kind]);

  useLayoutEffect(() => {
    const focus = state.focus?.target;
    if (!focus) return;
    const element = {
      add: addButton.current,
      field: form.current?.querySelector<HTMLElement>("input, select"),
      list: list.current,
      "select-existing": selectExisting.current,
      state: stateLine.current,
      target: peopleSearch.current,
      type: typeSelect.current,
    }[focus];
    element?.focus();
  }, [state.focus]);

  // The rail's one-editor rule and, on a phone, the modal sheet. Another
  // editor closing this one leaves focus where the reader is going.
  useLayoutEffect(() => {
    const element = form.current!;
    return registerRailEditors([element], () => {
      element.reset();
      flushSync(() => dispatch({ type: "close" }));
    });
  }, []);

  useDocumentEvent("person-lifecycle-changed", (event) => {
    const change = lifecycleChange(event.detail, personId, revision.current);
    if (!change) return;
    revision.current = change.revision;
    void sectionRequest(retired);
    void peopleRequest(retired);
    form.current?.reset();
    dispatch({ archived: change.archived, type: "lifecycle" });
    if (!change.archived) void readAll();
  });

  const writable = view.writesReady;
  const busy = state.list === "loading" || state.types === "loading";

  const saveRow = async (row: Row, relationshipTypeId: string) => {
    const answer = await settle(() =>
      updateRelationship(personId, row.id, {
        expectedUpdatedAt: row.updatedAt,
        relationshipTypeId,
      }, workspaceId)
    );
    if (answer.status !== "ready") {
      dispatch({
        focus: "state",
        notice: answer.problem?.detail ??
          "Relationship change is temporarily unavailable.",
        type: "notice",
      });
      return;
    }
    await readList(undefined, {
      notice: "Relationship updated on both person workspaces.",
    });
  };

  const unlink = async (row: Row) => {
    const answer = await settle(() =>
      deleteRelationship(personId, row.id, {
        expectedUpdatedAt: row.updatedAt,
      }, workspaceId)
    );
    if (answer.status !== "ready") {
      dispatch({
        focus: "state",
        notice: answer.problem?.detail ?? "Unlink is temporarily unavailable.",
        type: "notice",
      });
      return;
    }
    await readList(undefined, {
      notice: "People unlinked. Neither person was deleted.",
    });
  };

  const saveRelated = async (draft: RelatedDraft, override = false) => {
    const element = form.current!;
    const answer = await saveWithLockedForm(
      element,
      () =>
        settle(() =>
          createRelatedPersonRelationship(personId, {
            person: {
              ...(override ? { duplicateOverride: true } : {}),
              givenName: draft.givenName,
              ...(draft.familyName ? { familyName: draft.familyName } : {}),
              isPartial: !draft.givenName,
            },
            relationshipTypeId: draft.relationshipTypeId,
          }, workspaceId)
        ),
    );
    if (answer.problem?.code === "related_person_possible_duplicate") {
      dispatch({ draft, type: "duplicate" });
      return;
    }
    if (answer.status !== "ready") {
      dispatch({
        focus: "state",
        notice: answer.problem?.detail ??
          "Related person creation is temporarily unavailable.",
        type: "notice",
      });
      return;
    }
    element.reset();
    dispatch({ type: "close" });
    await readList(undefined, {
      notice:
        "Related person and relationship saved together on both person workspaces.",
    });
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = form.current!;
    if (!writable || state.people !== "idle") {
      dispatch({ target: "state", type: "focus" });
      return;
    }
    const givenName = givenNameInput.current!.value.trim();
    const familyName = familyNameInput.current!.value.trim();
    const { targetId, typeId } = state;
    const archivedType = typeChoices(state.typeOptions, state.selectedTypes)
      .find((choice) => choice.id === typeId)?.archived === true;
    if (!targetId && (givenName || familyName)) {
      if (!typeId || archivedType) {
        dispatch({
          focus: "state",
          notice: "Choose an active relationship type.",
          type: "notice",
        });
        return;
      }
      await saveRelated({ familyName, givenName, relationshipTypeId: typeId });
      return;
    }
    if (!targetId || !typeId || archivedType) {
      dispatch({
        focus: "state",
        notice:
          "Choose or create another person and select a relationship type.",
        type: "notice",
      });
      return;
    }
    const answer = await saveWithLockedForm(
      element,
      () =>
        settle(() =>
          createRelationship(personId, {
            relationshipTypeId: typeId,
            targetPersonId: targetId,
          }, workspaceId)
        ),
    );
    if (answer.status !== "ready" || !answer.data) {
      dispatch({
        focus: "state",
        notice: answer.problem?.detail ??
          "Relationship creation is temporarily unavailable.",
        type: "notice",
      });
      return;
    }
    element.reset();
    dispatch({ type: "close" });
    await readList(undefined, {
      notice: answer.data.status === "existing"
        ? "That relationship already exists."
        : "Relationship saved on both person workspaces.",
    });
  };

  const add = (opener: HTMLElement) => {
    if (!requestRailEditorOpen(form.current!, false, opener)) return;
    dispatch({ type: "open" });
  };

  const cancel = () => {
    form.current?.reset();
    dispatch({ focus: true, type: "close" });
  };

  // Each page control shows only while there is a page to go to.
  const nextPage = async () => {
    if (
      await readList(state.nextCursor, {
        previous: [...state.previous, state.cursor],
      })
    ) list.current?.focus();
  };

  const previousPage = async () => {
    const previous = state.previous.slice(0, -1);
    if (await readList(state.previous.at(-1), { previous })) {
      list.current?.focus();
    }
  };

  const groups = groupRelationships(state.rows);
  const inView = summaryRowIds(state.rows);
  const collapsed = state.rows.length - inView.size;
  const shown = (row: Row) => state.expanded || inView.has(row.id);
  const locked = !writable || view.peopleLocked;
  const choices = typeChoices(state.typeOptions, state.selectedTypes);
  const text = state.notice ?? view.text;

  const addControl = (
    <Button
      aria-label="Add relationship"
      className="profile-rail-add"
      disabled={!writable}
      hidden={!writable}
      id="relationship-add"
      onClick={(event) => add(event.currentTarget)}
      ref={addButton}
      type="button"
    >
      <span aria-hidden="true">+</span>
    </Button>
  );

  return (
    <>
      {props.heading ? createPortal(addControl, props.heading) : null}
      <p
        className="section-state"
        data-rail-editor-feedback=""
        data-rail-summary={view.summary && state.notice === undefined
          ? "true"
          : undefined}
        id="relationships-state"
        ref={stateLine}
        tabIndex={-1}
      >
        {text || null}
      </p>
      <ul
        aria-label="Saved relationships"
        className="profile-fact-list"
        id="relationships-list"
        ref={list}
        tabIndex={-1}
      >
        {view.kind === "hidden"
          ? null
          : state.rows.length === 0
          ? <li>No relationships saved.</li>
          : (
            <>
              {groups.map((group) => (
                <li
                  className="relationship-summary-group"
                  data-relationship-group={group.relationshipTypeId}
                  hidden={!group.rows.some(shown)}
                  key={group.key}
                >
                  <p className="relationship-summary-group-label">
                    {`${group.label} (${group.rows.length})`}
                  </p>
                  <ul className="relationship-summary-group-list">
                    {group.rows.map((row) => (
                      <li
                        data-relationship-id={row.id}
                        hidden={!shown(row)}
                        key={row.id}
                      >
                        <p className="relationship-summary-row">
                          <span className="sr-only">
                            {`${row.display.label}: `}
                          </span>
                          {row.display.name
                            ? (
                              <a
                                className="profile-fact-value"
                                href={`/app/people/${row.display.personId}`}
                              >
                                {row.display.name}
                              </a>
                            )
                            : (
                              <span className="profile-fact-value">
                                {relatedName(row)}
                              </span>
                            )}
                        </p>
                        {writable
                          ? (
                            <RowEditor
                              key={`${row.relationshipTypeId}:${row.updatedAt}`}
                              onSave={(typeId) => void saveRow(row, typeId)}
                              onUnlink={() => void unlink(row)}
                              options={state.typeOptions}
                              row={row}
                              selected={state.selectedTypes}
                            />
                          )
                          : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              {collapsed > 0
                ? (
                  <li className="relationship-summary-expander">
                    <Button
                      aria-expanded={state.expanded}
                      className="profile-rail-summary-control profile-rail-expander"
                      onClick={() => dispatch({ type: "expand" })}
                      type="button"
                      variant="outline"
                    >
                      <Quiet
                        action={state.expanded
                          ? "Show fewer"
                          : `+ ${collapsed} more`}
                        context="relationships"
                      />
                    </Button>
                  </li>
                )
                : null}
            </>
          )}
      </ul>
      <nav aria-label="Relationship pages" className={formActionsVariants()}>
        <Button
          disabled={busy}
          hidden={state.previous.length === 0}
          id="relationships-previous"
          onClick={() => void previousPage()}
          type="button"
          variant="outline"
        >
          Previous relationships
        </Button>
        <Button
          disabled={busy}
          hidden={!state.nextCursor}
          id="relationships-load-more"
          onClick={() => void nextPage()}
          type="button"
          variant="outline"
        >
          Next relationships
        </Button>
      </nav>
      <form
        className="profile-fact-form"
        hidden={!editorVisible(state)}
        id="relationship-form"
        inert={state.reserved}
        method="post"
        noValidate
        onSubmit={(event) => void submit(event)}
        ref={form}
      >
        <fieldset disabled={!writable}>
          <legend>Choose an existing person</legend>
          <Combobox
            autoHighlight
            disabled={!writable}
            filter={null}
            inline
            inputValue={state.peopleQuery}
            items={state.candidates}
            itemToStringLabel={(person) => person.name}
            isItemEqualToValue={(a, b) => a.id === b.id}
            onInputValueChange={(query, details) => {
              if (
                details.reason === "input-change" ||
                details.reason === "input-clear"
              ) {
                dispatch({ query, type: "people-query" });
              }
            }}
            onValueChange={(person) => {
              if (person) dispatch({ targetId: person.id, type: "choose" });
            }}
            open={editorOpen && !state.targetId && !!state.peopleQuery.trim()}
            value={state.candidates.find((person) =>
              person.id === state.targetId
            ) ?? null}
          >
            <label htmlFor="relationship-person-search">Search people</label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
              />
              <ComboboxInput
                aria-describedby="relationship-people-status"
                aria-expanded={editorOpen && !state.targetId &&
                  state.candidates.length > 0}
                className="pl-10!"
                id="relationship-person-search"
                maxLength={200}
                placeholder="Search by name…"
                ref={peopleSearch}
                type="search"
              />
            </div>
            <input
              disabled={!writable}
              id="relationship-target"
              name="targetPersonId"
              type="hidden"
              value={state.targetId}
            />
            {!state.targetId && state.candidates.length > 0
              ? (
                <ComboboxList aria-label="People results">
                  {(person: { readonly id: string; readonly name: string }) => (
                    <ComboboxItem key={person.id} value={person}>
                      <Avatar initials={nameInitials(person.name)} />
                      <strong className="min-w-0 wrap-anywhere">
                        {person.name}
                      </strong>
                    </ComboboxItem>
                  )}
                </ComboboxList>
              )
              : null}
          </Combobox>
          <p
            aria-live="polite"
            className="m-0 text-sm text-muted-foreground"
            id="relationship-people-status"
            role="status"
          >
            {state.targetId
              ? `Selected: ${state.peopleQuery}`
              : state.people === "loading"
              ? "Searching people…"
              : state.people === "error"
              ? "People search is temporarily unavailable. Edit the search to try again."
              : state.peopleQuery.trim()
              ? state.candidates.length
                ? `${state.candidates.length} people found. Use arrow keys and Enter to select.`
                : "No matching people. Try another name or create a related person below."
              : "Type a name to find a person in this workspace."}
          </p>
        </fieldset>
        <fieldset disabled={!writable}>
          <legend>Or create a new related person</legend>
          <div className="form-grid">
            <label>
              New person given name{" "}
              <input
                disabled={locked}
                maxLength={200}
                name="newGivenName"
                ref={givenNameInput}
              />
            </label>
            <label>
              New person family name{" "}
              <input
                disabled={locked}
                maxLength={200}
                name="newFamilyName"
                ref={familyNameInput}
              />
            </label>
          </div>
        </fieldset>
        <fieldset disabled={!writable}>
          <legend>Relationship type</legend>
          <label>
            Search relationship types{" "}
            <input
              disabled={!writable}
              id="relationship-type-search"
              maxLength={200}
              ref={typeSearch}
              type="search"
            />
          </label>
          <Button
            disabled={!writable}
            id="relationship-type-search-button"
            onClick={() =>
              void readTypes(undefined, {
                previous: [],
                search: typeSearch.current!.value.trim(),
              })}
            type="button"
            variant="outline"
          >
            Search relationship types
          </Button>
          <label>
            Relationship type{" "}
            <select
              disabled={!writable}
              id="relationship-type"
              name="relationshipTypeId"
              onChange={(event) =>
                dispatch({ type: "choose", typeId: event.target.value })}
              ref={typeSelect}
              required
              value={state.typeId}
            >
              <option value="">Select relationship type</option>
              {choices.map((choice) => (
                <option
                  disabled={choice.archived}
                  key={choice.id}
                  value={choice.id}
                >
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <nav
            aria-label="Relationship type pages"
            className={formActionsVariants()}
          >
            <Button
              disabled={!writable}
              hidden={!writable || state.typePrevious.length === 0}
              id="relationship-types-previous"
              onClick={() =>
                void readTypes(state.typePrevious.at(-1), {
                  previous: state.typePrevious.slice(0, -1),
                })}
              type="button"
              variant="outline"
            >
              Previous relationship types
            </Button>
            <Button
              disabled={!writable}
              hidden={!writable || !state.typeNextCursor}
              id="relationship-types-next"
              onClick={() =>
                void readTypes(state.typeNextCursor, {
                  previous: [...state.typePrevious, state.typeCursor],
                })}
              type="button"
              variant="outline"
            >
              Next relationship types
            </Button>
          </nav>
        </fieldset>
        <div
          aria-label="Possible duplicate person choices"
          hidden={!state.duplicate || !writable}
          id="relationship-duplicate-choices"
          role="group"
        >
          <p>A person with this name may already exist.</p>
          <Button
            disabled={locked}
            id="relationship-select-existing"
            onClick={() => {
              const draft = state.duplicate;
              if (!draft) return;
              dispatch({ type: "dismiss-duplicate" });
              dispatch({
                query: [draft.givenName, draft.familyName].filter(Boolean).join(
                  " ",
                ),
                type: "people-query",
              });
              peopleSearch.current?.focus();
            }}
            ref={selectExisting}
            type="button"
            variant="outline"
          >
            Select existing person
          </Button>
          <Button
            disabled={locked}
            id="relationship-create-anyway"
            onClick={() => {
              const draft = state.duplicate;
              if (!draft) return;
              dispatch({ type: "dismiss-duplicate" });
              void saveRelated(draft, true);
            }}
            type="button"
            variant="outline"
          >
            Create anyway
          </Button>
        </div>
        <div className={formActionsVariants()} data-form-actions="">
          <Button disabled={locked} type="submit">Save relationship</Button>
          <Button
            disabled={!writable}
            id="relationship-cancel"
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

/**
 * A row's type picker and its Save and Unlink controls. The picker's choice
 * is the row's own until saved; a row read again starts from its new type.
 */
function RowEditor(
  props: {
    readonly row: Row;
    readonly options: readonly RelationshipType[];
    readonly selected: readonly RelationshipType[];
    readonly onSave: (relationshipTypeId: string) => void;
    readonly onUnlink: () => void;
  },
) {
  const { row } = props;
  const [value, setValue] = useState(row.relationshipTypeId);
  const choices = typeChoices(props.options, props.selected, rowType(row));
  const selectable = value !== "" &&
    choices.find((choice) => choice.id === value)?.archived === false;
  const name = relatedName(row);
  return (
    <div className="relationship-row-editor">
      <select
        aria-label={`Relationship type for ${name}`}
        onChange={(event) => setValue(event.target.value)}
        value={value}
      >
        <option value="">Select relationship type</option>
        {choices.map((choice) => (
          <option disabled={choice.archived} key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
      <Button
        disabled={!selectable}
        onClick={() => props.onSave(value)}
        type="button"
      >
        <Quiet action="Save" context={`relationship with ${name}`} />
      </Button>
      <Button
        className="profile-rail-remove"
        onClick={props.onUnlink}
        type="button"
        variant="destructive"
      >
        <Quiet action="Unlink" context={name} />
      </Button>
    </div>
  );
}

/**
 * Mounts the block over the element the shell drew for it and resolves, once
 * its first read has settled, with the function that unmounts it. The
 * block's heading stays: the rail island shows the count there and this
 * island its add control. A workspace that turned the module off sees no
 * block and no request is made. Without the block and its form, the markup
 * the shell always draws, there is nothing to own.
 */
export const mountPersonRelationships: SectionMount = (container, props) => {
  const root = container.querySelector<HTMLElement>(
    "#profile-section-relationships",
  );
  if (!root?.querySelector("#relationship-form")) {
    return Promise.resolve(() => undefined);
  }
  const heading = root.querySelector<HTMLElement>(":scope > header") ??
    undefined;
  heading?.querySelector("#relationship-add")?.remove();
  if (sectionHidden(props, "relationships")) {
    root.hidden = true;
    root.dataset.sectionState = "hidden";
    setRailCount("relationships", undefined);
    setRailEmpty("relationships", false);
    focusMain();
    return Promise.resolve(() => undefined);
  }
  return new Promise((resolve) => {
    const unmount = mountIsland(
      root,
      PERSON_RELATIONSHIPS_ISLAND,
      <PersonRelationships
        archived={props.archived}
        heading={heading}
        onSettled={() => resolve(unmount)}
        personId={props.personId}
        personUpdatedAt={props.initial?.person.updatedAt}
        root={root}
        workspaceId={props.workspaceId}
      />,
    );
    if (heading) root.prepend(heading);
  });
};
