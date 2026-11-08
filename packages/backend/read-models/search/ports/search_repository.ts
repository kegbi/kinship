/**
 * What the workspace search reads (GAP-048, `SEARCH-001`).
 *
 * The repository answers, for one workspace and one query, the rows of each
 * group the actor may see: people as the active directory lists them, and the
 * notes, activities, journal posts, and tasks their owning modules list. It
 * decides visibility; the application decides the snippet and the link.
 */

import type { PersonAvatarRecord } from "../../../modules/people/public.ts";

export interface SearchActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

/** The person an entity belongs to, named by the display-name rule. */
export interface SearchPersonReference {
  readonly archived: boolean;
  readonly id: string;
  readonly name: string;
}

/** One person the directory would list for the query. */
export interface SearchPersonRecord {
  /** The stored colour, and the image file only while it can be drawn. */
  readonly avatar?: PersonAvatarRecord;
  readonly familyName?: string;
  readonly givenName: string;
  readonly id: string;
  readonly middleName?: string;
  readonly nickname?: string;
}

/**
 * A person the member viewed recently (FEQ-05): what an empty query answers,
 * in the order the member viewed them. Unlike a search, it may be archived.
 */
export interface SearchRecentPersonRecord extends SearchPersonRecord {
  readonly archived: boolean;
}

/** What every matched note, activity, journal post, and task carries. */
export interface SearchEntityRecord {
  readonly id: string;
  /** The plain text the snippet is cut from. */
  readonly text: string;
  readonly title?: string;
}

/**
 * A note or an activity: always opened on a person who still exists, in a
 * section the person workspace shows. The repository leaves out any other.
 */
export interface SearchPersonEntityRecord extends SearchEntityRecord {
  readonly person: SearchPersonReference;
}

/** A journal post, read at its own item (`/app/journal/:journalItemId`). */
export interface SearchJournalPostRecord extends SearchEntityRecord {
  readonly journalItemId: string;
}

/**
 * A task: every one the tasks page lists. It names its person only while
 * that person exists, and opens on the person's tasks section only while the
 * workspace shows that section; otherwise it opens on the tasks page.
 */
export interface SearchTaskRecord extends SearchEntityRecord {
  readonly person?: SearchPersonReference;
  readonly sectionShown: boolean;
}

/** How the people group is ordered: the member's contact sort preference. */
export type SearchPeopleSort = "family-name" | "given-name";

/**
 * One `replace(text, from, to)` of the name fold, applied in order to the
 * lowercased name. The transport supplies the steps; the repository only
 * repeats them, so the rules have one home.
 */
export type SearchNameFoldStep = readonly [from: string, to: string];

export interface SearchCriteria {
  readonly limit: number;
  /**
   * How every stored name is folded, after `lower()`, before it is matched
   * against `nameForms`: the query's own spellings across scripts and
   * keyboard layouts. A name also matches the query as typed, so no forms
   * means that match alone.
   */
  readonly nameFold: readonly SearchNameFoldStep[];
  readonly nameForms: readonly string[];
  /** The trimmed query, one to two hundred characters. */
  readonly query: string;
  readonly sort: SearchPeopleSort;
  /**
   * The query's positive words, lowercased. The text statement cuts each
   * stored text to a window around the first of them, so a match deep in a
   * long note still reaches its snippet.
   */
  readonly terms: readonly string[];
}

/** What one search reads: the people group and the four text groups. */
export interface SearchRecords {
  readonly activities: readonly SearchPersonEntityRecord[];
  readonly journalPosts: readonly SearchJournalPostRecord[];
  readonly notes: readonly SearchPersonEntityRecord[];
  readonly people: readonly SearchPersonRecord[];
  readonly tasks: readonly SearchTaskRecord[];
}

export type SearchTextRecords = Omit<SearchRecords, "people">;

/**
 * A statement cut short by the search's statement timeout. Any other
 * failure is thrown.
 */
export interface SearchTimedOut {
  readonly status: "timed-out";
}

/**
 * Two statements, so a slow text scan never holds up people search: people
 * on the directory's own indexed pattern first, then the four text groups.
 * An empty query reads the member's recent people instead, in one statement.
 */
export interface SearchRepository {
  /**
   * The people in the member's recent list, as Today's recent people reads
   * it: in this workspace, not deleted, archived ones included.
   */
  recentPeople(
    command: SearchActor & { readonly limit: number },
  ): Promise<
    | {
      readonly people: readonly SearchRecentPersonRecord[];
      readonly status: "ready";
    }
    | SearchTimedOut
  >;
  searchPeople(
    command: SearchActor & SearchCriteria,
  ): Promise<
    | {
      readonly people: readonly SearchPersonRecord[];
      readonly status: "ready";
    }
    | SearchTimedOut
  >;
  searchText(
    command: SearchActor & SearchCriteria,
  ): Promise<
    (SearchTextRecords & { readonly status: "ready" }) | SearchTimedOut
  >;
}
