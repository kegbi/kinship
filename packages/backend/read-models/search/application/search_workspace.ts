/**
 * Workspace search (GAP-048, `SEARCH-001`): one query over the people, notes,
 * activities, journal posts, and tasks the member may read.
 *
 * The repository decides which rows are visible, by the rules each owning
 * module lists its own rows with. This file bounds the request, revalidates
 * the actor, cuts each snippet, and names where each result opens: a person's
 * workspace section through the catalog's `?section=` deep link, a journal
 * post's own item page, or the tasks page for a task with no person to open.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type { ActorRevalidation } from "../../../modules/workspaces/public.ts";
import type { PersonAvatarRecord } from "../../../modules/people/public.ts";
import type {
  SearchActor,
  SearchEntityRecord,
  SearchNameFoldStep,
  SearchPeopleSort,
  SearchPersonReference,
  SearchRepository,
  SearchTextRecords,
} from "../ports/search_repository.ts";

export interface ReadModelTransaction {
  readonly opaque: unknown;
}

/** The results each group answers when the caller names no size. */
export const SEARCH_LIMIT_DEFAULT = 5;
/** The most results any one group answers. */
export const SEARCH_LIMIT_MAXIMUM = 10;
/** The longest query, as the contract publishes it. */
export const SEARCH_QUERY_MAXIMUM = 200;
/** The characters a snippet keeps before its ellipses. */
export const SEARCH_SNIPPET_LENGTH = 160;
/** How much of the text before the first match a snippet keeps. */
const SNIPPET_LEAD = 40;

export interface SearchInput {
  readonly limit?: number;
  /** How names are folded before `nameForms` is matched (`SEARCH-001`). */
  readonly nameFold?: readonly SearchNameFoldStep[];
  /** The query's folded spellings a person's name may contain. */
  readonly nameForms?: readonly string[];
  readonly query: string;
  readonly sort?: SearchPeopleSort;
}

export type SearchEntityKind = "activity" | "journal-post" | "note" | "task";

export interface SearchPersonResult {
  readonly avatar?: PersonAvatarRecord;
  readonly familyName?: string;
  readonly givenName: string;
  readonly href: string;
  readonly id: string;
  readonly kind: "person";
  readonly middleName?: string;
  readonly nickname?: string;
}

export interface SearchEntityResult {
  readonly href: string;
  readonly id: string;
  readonly kind: SearchEntityKind;
  readonly person?: SearchPersonReference;
  readonly snippet: string;
  readonly title?: string;
}

/**
 * A text group. `unavailable` marks one its statement could not answer —
 * timed out or failed — while the people group still did.
 */
export interface SearchEntityGroup<Kind extends string> {
  readonly kind: Kind;
  readonly results: readonly SearchEntityResult[];
  readonly unavailable?: true;
}

export type SearchGroups = readonly [
  { readonly kind: "people"; readonly results: readonly SearchPersonResult[] },
  SearchEntityGroup<"notes">,
  SearchEntityGroup<"activities">,
  SearchEntityGroup<"journal-posts">,
  SearchEntityGroup<"tasks">,
];

export type SearchResult =
  | Failure<"forbidden" | "unavailable">
  | {
    readonly groups: SearchGroups;
    readonly query: string;
    readonly status: "ready";
  };

/** The group size this search serves, clamped to what it will answer. */
function limitOf(limit: number | undefined): number {
  const bounded = Math.trunc(limit ?? SEARCH_LIMIT_DEFAULT);
  if (!Number.isFinite(bounded)) return SEARCH_LIMIT_DEFAULT;
  return Math.max(1, Math.min(SEARCH_LIMIT_MAXIMUM, bounded));
}

/**
 * The words a snippet looks for: the query's positive terms, lowercased,
 * without the search operators. A negated term (`-fox`) finds nothing to
 * show, and `or` joins rather than names.
 */
export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/)
    .filter((term) => !term.startsWith("-"))
    .map((term) => term.replace(/^"+|"+$/g, ""))
    .filter((term) => term !== "" && term !== "or");
}

/**
 * Where `term` first occurs in `characters`, as a code-point index, compared
 * case-insensitively. Lowercasing can change a character's length ("İ" is one
 * unit and lowercases to two), so each position of the lowered text is
 * mapped back to the code point it came from.
 */
function firstMatch(characters: readonly string[], term: string): number {
  let lowered = "";
  const origin: number[] = [];
  characters.forEach((character, index) => {
    const lower = character.toLowerCase();
    for (let unit = 0; unit < lower.length; unit++) origin.push(index);
    lowered += lower;
  });
  const at = lowered.indexOf(term);
  return at < 0 ? -1 : origin[at]!;
}

/**
 * A short plain-text excerpt of `text` around the first word of `query` it
 * contains. Whitespace and control characters collapse to single spaces, and
 * nothing is interpreted: whatever markup the text holds stays literal text
 * for the reader to escape. Lengths and cuts count code points, so an emoji
 * is never split in half.
 */
export function searchSnippet(text: string, query: string): string {
  const characters = Array.from(text.replace(/[\s\p{Cc}]+/gu, " ").trim());
  if (characters.length <= SEARCH_SNIPPET_LENGTH) return characters.join("");
  const hits = searchTerms(query).map((term) => firstMatch(characters, term))
    .filter((index) => index >= 0);
  const first = hits.length > 0 ? Math.min(...hits) : 0;
  const start = Math.max(
    0,
    Math.min(first - SNIPPET_LEAD, characters.length - SEARCH_SNIPPET_LENGTH),
  );
  const end = start + SEARCH_SNIPPET_LENGTH;
  return `${start > 0 ? "…" : ""}${
    characters.slice(start, end).join("").trim()
  }${end < characters.length ? "…" : ""}`;
}

function personHref(personId: string, section?: string): string {
  const path = `/app/people/${encodeURIComponent(personId)}`;
  return section ? `${path}?section=${section}` : path;
}

function entity(
  kind: SearchEntityKind,
  record: SearchEntityRecord & { readonly person?: SearchPersonReference },
  query: string,
  href: string,
): SearchEntityResult {
  return {
    href,
    id: record.id,
    kind,
    ...(record.person ? { person: record.person } : {}),
    snippet: searchSnippet(record.text, query),
    ...(record.title ? { title: record.title } : {}),
  };
}

const UNAVAILABLE_TEXT = {
  activities: [],
  journalPosts: [],
  notes: [],
  tasks: [],
} as const satisfies SearchTextRecords;

const EMPTY_GROUPS: SearchGroups = [
  { kind: "people", results: [] },
  { kind: "notes", results: [] },
  { kind: "activities", results: [] },
  { kind: "journal-posts", results: [] },
  { kind: "tasks", results: [] },
];

/**
 * Read models carry no actor join of their own: the `workspaces` port answers
 * whether the actor may still read the workspace, and the repository scopes
 * every group by that workspace alone.
 */
export function createWorkspaceSearch(dependencies: {
  readonly actors: ActorRevalidation;
  readonly repository: SearchRepository;
  readonly transaction: {
    run<T>(
      work: (transaction: ReadModelTransaction) => Promise<T>,
    ): Promise<T>;
  };
}) {
  const readable = async (actor: SearchActor): Promise<boolean> =>
    await dependencies.transaction.run((transaction) =>
      dependencies.actors.revalidate({ ...actor, lock: false, transaction })
    ) === "active";

  return {
    search: async (
      actor: SearchActor,
      input: SearchInput,
    ): Promise<SearchResult> => {
      if (!await readable(actor)) return { status: "forbidden" };
      const query = input.query.trim().slice(0, SEARCH_QUERY_MAXIMUM).trim();
      if (!query) return { groups: EMPTY_GROUPS, query, status: "ready" };
      const command = {
        memberId: actor.memberId,
        role: actor.role,
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        limit: limitOf(input.limit),
        nameFold: input.nameFold ?? [],
        nameForms: input.nameForms ?? [],
        query,
        sort: input.sort ?? "given-name",
        terms: searchTerms(query),
      } as const;
      const people = await dependencies.repository.searchPeople(command);
      if (people.status === "timed-out") return { status: "unavailable" };
      // The text groups are a second statement: whatever stops it, people
      // still answer and the four text groups say they could not.
      const text = await dependencies.repository.searchText(command)
        .catch(() => undefined);
      const found = text?.status === "ready" ? text : UNAVAILABLE_TEXT;
      const unavailable = text?.status === "ready"
        ? {}
        : { unavailable: true as const };
      return {
        groups: [
          {
            kind: "people",
            results: people.people.map((person) => ({
              ...person,
              href: personHref(person.id),
              kind: "person" as const,
            })),
          },
          {
            kind: "notes",
            results: found.notes.map((note) =>
              entity("note", note, query, personHref(note.person.id, "notes"))
            ),
            ...unavailable,
          },
          {
            kind: "activities",
            results: found.activities.map((activity) =>
              entity(
                "activity",
                activity,
                query,
                personHref(activity.person.id, "activities"),
              )
            ),
            ...unavailable,
          },
          {
            kind: "journal-posts",
            results: found.journalPosts.map((post) =>
              entity(
                "journal-post",
                post,
                query,
                `/app/journal/${encodeURIComponent(post.journalItemId)}`,
              )
            ),
            ...unavailable,
          },
          {
            kind: "tasks",
            results: found.tasks.map((task) =>
              entity(
                "task",
                task,
                query,
                task.person && task.sectionShown
                  ? personHref(task.person.id, "tasks")
                  : "/app/tasks",
              )
            ),
            ...unavailable,
          },
        ],
        query,
        status: "ready",
      };
    },
  };
}

export type WorkspaceSearch = ReturnType<typeof createWorkspaceSearch>;
