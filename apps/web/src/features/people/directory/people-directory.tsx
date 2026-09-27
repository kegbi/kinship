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
  getMemberPreferences,
  listPeople,
  listPeopleTagOptions,
  type PeopleDirectoryLifecycle,
  type PeopleDirectoryPerson,
  type PeopleDirectorySort,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import {
  mountIsland,
  settle,
  useLatestRequest,
} from "../../../islands/core/index.ts";
import type { PersonNameOrder } from "../../../lib/person-name.ts";
import { readStaticForm } from "../../../lib/static-form.ts";
import { resolveWorkspaceSession } from "../../../lib/workspace-context.ts";
import {
  directoryInput,
  directoryLocation,
  directoryReducer,
  emptyCopy,
  errorCopy,
  initialDirectory,
  isSort,
  personDetails,
  personName,
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

export function PeopleDirectory(props: PeopleDirectoryProps) {
  const { lifecycle } = props;
  const [state, dispatch] = useReducer(
    directoryReducer,
    query().get("tag") ?? "",
    initialDirectory,
  );
  const listRequest = useLatestRequest();
  const tagRequest = useLatestRequest();
  const search = useRef<HTMLInputElement>(null);
  const tagSearch = useRef<HTMLInputElement>(null);
  const error = useRef<HTMLElement>(null);
  const context = useRef<Context | undefined>(undefined);
  // What the next read asks for, as the reader last left it.
  const reading = useRef({
    sort: state.sort,
    tagId: state.tag.selected,
  });
  const settled = useRef(props.onSettled);

  const load = async (append: boolean): Promise<void> => {
    const known = context.current;
    if (!known) return;
    const cursor = append ? state.nextCursor : undefined;
    const current = {
      search: search.current?.value ?? "",
      sort: reading.current.sort,
      tagId: reading.current.tagId,
    };
    dispatch({ append, type: "loading" });
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
      filtered: Boolean(current.search.trim() || current.tagId),
      lifecycle,
      nextCursor: page.nextCursor,
      people: page.people,
      type: "loaded",
    });
  };

  const loadTags = async (append: boolean): Promise<void> => {
    const known = context.current;
    if (!known) return;
    const cursor = append ? state.tag.cursor : undefined;
    const text = tagSearch.current?.value.trim() ?? "";
    const selectedTagId = reading.current.tagId;
    dispatch({ append, type: "tags-loading" });
    const answer = await tagRequest(() =>
      listPeopleTagOptions({
        ...(cursor ? { cursor } : {}),
        ...(text ? { search: text } : {}),
        ...(selectedTagId ? { selectedTagId } : {}),
      }, known.workspaceId)
    );
    if (!answer) return;
    if (answer.status !== "ready") {
      dispatch({ type: "tags-failed" });
      return;
    }
    dispatch({ append, page: answer.data!, type: "tags-loaded" });
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
    await Promise.all([load(false), loadTags(false)]);
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

  const chooseTag = (value: string) => {
    reading.current.tagId = value;
    dispatch({ selected: value, type: "tag" });
  };

  const { loading, status } = state;
  const archived = lifecycle === "archived";
  const empty = emptyCopy(state.filtered, lifecycle);
  const failure = errorCopy(state.forbidden);
  const listShown = status === "ready" ||
    (status === "loading" && state.appending);

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
            disabled={loading}
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
              disabled={loading}
              id="people-tag-options-search"
              name="tagSearch"
              maxLength={200}
              placeholder="Tag name"
              type="search"
            />
            <button
              disabled={loading || state.tag.loading}
              id="people-tag-options-search-button"
              onClick={() => void loadTags(false)}
              type="button"
            >
              Search tags
            </button>
          </div>
          <label htmlFor="people-directory-tag">Tag</label>
          <select
            disabled={loading}
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
              disabled={loading || state.tag.loading}
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
        </fieldset>
        <label>
          Sort by
          <select
            disabled={loading}
            id="people-directory-sort"
            name="sort"
            onChange={(event) =>
              chooseSort(event.target.value as PeopleDirectorySort)}
            value={state.sort}
          >
            <option value="given-name">Given name</option>
            <option value="family-name">Family name</option>
            <option value="recently-added">Recently added</option>
          </select>
        </label>
        <button disabled={loading} type="submit">Find people</button>
      </form>

      <p
        aria-live="polite"
        className="sr-status"
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

      <ul
        aria-label={archived ? "Archived people" : "Active people"}
        className="people-directory-list"
        hidden={!listShown || state.people.length === 0}
        id="people-directory-list"
      >
        {state.people.map((person) => (
          <PersonItem
            key={person.id}
            nameOrder={state.nameOrder}
            person={person}
          />
        ))}
      </ul>
      <div className="directory-pagination">
        <button
          disabled={loading}
          hidden={!state.nextCursor || !listShown}
          id="people-directory-more"
          onClick={() => void load(true)}
          type="button"
        >
          Load more people
        </button>
      </div>
    </>
  );
}

function PersonItem(
  props: {
    readonly nameOrder: PersonNameOrder;
    readonly person: PeopleDirectoryPerson;
  },
) {
  const { person } = props;
  const name = personName(person, props.nameOrder);
  const remaining = person.tagCount - person.tags.length;
  return (
    <li>
      <a className="person-directory-link" href={`/app/people/${person.id}`}>
        <h2>{name}</h2>
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
