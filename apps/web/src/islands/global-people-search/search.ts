/**
 * What the palette shows, without the DOM (GAP-027, GAP-048).
 *
 * The palette answers three kinds of query: nothing typed shows the people
 * the member viewed recently, `>` lists the commands the member may run, and
 * anything else searches the workspace: its people, notes, activities,
 * journal posts, and tasks, each under its own heading. These functions turn
 * each answer into the groups of rows the list renders; the island only
 * fetches and draws.
 *
 * Names and commands match by `name_search.ts`: in either script and on
 * either keyboard layout. Each row carries the ranges of its text the query
 * matched, which the list marks.
 */

import type {
  PersonAvatar,
  SearchEntityResult,
  SearchResults,
  SessionContext,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  nameMatches,
  type NameMatchRange,
  nameMatchRanges,
} from "../../../../../packages/contracts/schemas/name_search.ts";
import {
  displayPersonName,
  type PersonNameOrder,
} from "../../lib/person-name.ts";
import { groups } from "../../lib/settings-destinations.ts";

export type MemberRole = SessionContext["member"]["role"];

export interface PaletteCommand {
  readonly command?: "log-interaction";
  readonly label: string;
  readonly path?: string;
}

export interface SearchPerson {
  readonly archived: boolean;
  /** How the row draws the person (GAP-045); initials when absent. */
  readonly avatar?: PersonAvatar | undefined;
  readonly formalNames?: readonly string[];
  readonly id: string;
  readonly name: string;
  readonly nickname?: string;
}

/** The kinds of record a search finds beside people. */
export type EntityKind = SearchEntityResult["kind"];

/** The parts of a row's text the query matched, in order, never overlapping. */
export type MatchRanges = readonly NameMatchRange[];

/** One option of the list, keyed uniquely within its answer. */
export type PaletteRow =
  | {
    /** Whether the person the record belongs to is archived. */
    readonly archived: boolean;
    readonly entity: EntityKind;
    readonly key: string;
    readonly kind: "entity";
    /** The record's own name: its title, or the person a note is about. */
    readonly label: string;
    readonly labelMatches?: MatchRanges;
    readonly path: string;
    /** The person a titled record belongs to, beside its title. */
    readonly person?: string;
    readonly snippet: string;
    readonly snippetMatches?: MatchRanges;
  }
  | {
    readonly archived: boolean;
    readonly avatar?: PersonAvatar | undefined;
    readonly key: string;
    readonly kind: "person";
    readonly label: string;
    readonly labelMatches?: MatchRanges;
    readonly path: string;
  }
  | {
    readonly key: string;
    readonly kind: "add";
    readonly label: string;
    readonly path: string;
  }
  | {
    readonly command?: "log-interaction";
    readonly key: string;
    readonly kind: "command";
    readonly label: string;
    readonly labelMatches?: MatchRanges;
    readonly path?: string;
  };

/**
 * A run of rows. A search's groups carry the heading that names them; the
 * recent people and the commands are one group without a heading.
 */
export interface PaletteGroup {
  readonly heading?: string;
  readonly id: string;
  readonly rows: readonly PaletteRow[];
}

/** What the palette shows for one query once its answer is known. */
export interface PaletteAnswer {
  /** The copy under the input when nothing matched, or nothing to show. */
  readonly empty?: string;
  readonly groups: readonly PaletteGroup[];
  /**
   * The people answered but the other groups could not in time: the list
   * shows the people with a quiet note that the rest is unavailable.
   */
  readonly partial?: true;
  readonly problem: boolean;
  readonly status: string;
}

/** Every row of an answer, in the order the list draws them. */
export function answerRows(answer: PaletteAnswer): readonly PaletteRow[] {
  return answer.groups.flatMap((group) => group.rows);
}

const primaryCommands: readonly PaletteCommand[] = [
  { command: "log-interaction", label: "Log interaction" },
  { label: "Add person", path: "/app/people/new" },
  { label: "Add task", path: "/app/tasks" },
  { label: "Today", path: "/app" },
  { label: "People", path: "/app/people" },
  { label: "Tasks", path: "/app/tasks" },
  { label: "Journal", path: "/app/journal" },
  { label: "Settings", path: "/app/settings" },
];

const accessRank: Readonly<Record<MemberRole, number>> = {
  admin: 1,
  member: 0,
  owner: 2,
};

/** The commands a member of `role` may run, settings included. */
export function commandIndex(role: MemberRole): readonly PaletteCommand[] {
  const settingsCommands = groups.flatMap((group) =>
    group.destinations
      .filter((destination) =>
        accessRank[role] >= accessRank[destination.access]
      )
      .map((destination) => ({
        label: `${group.label} · ${destination.label}`,
        path: destination.href,
      }))
  );
  return [...primaryCommands, ...settingsCommands];
}

/**
 * Where `query` matches `text`: the whole query if it does, otherwise each of
 * its words, as a text search finds them. Search operators (`-word`, quotes,
 * `or`) are not words to mark.
 */
export function matchRanges(text: string, query: string): MatchRanges {
  const whole = nameMatchRanges(text, query);
  if (whole.length > 0) return whole;
  const words = query.split(/\s+/)
    .filter((word) => !word.startsWith("-"))
    .map((word) => word.replace(/^"+|"+$/g, ""))
    .filter((word) => word !== "" && word.toLowerCase() !== "or");
  if (words.length < 2) return [];
  const ranges = words.flatMap((word) => nameMatchRanges(text, word))
    .sort((left, right) => left.start - right.start);
  const merged: NameMatchRange[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) {
      merged[merged.length - 1] = {
        start: last.start,
        end: Math.max(last.end, range.end),
      };
    } else {
      merged.push(range);
    }
  }
  return merged;
}

/** `{ [key]: ranges }` when `query` matches `text`, otherwise nothing. */
function matched<Key extends "labelMatches" | "snippetMatches">(
  key: Key,
  text: string,
  query: string | undefined,
): Partial<Record<Key, MatchRanges>> {
  const ranges = query ? matchRanges(text, query) : [];
  return ranges.length > 0
    ? { [key]: ranges } as Partial<Record<Key, MatchRanges>>
    : {};
}

function matchingCommands(
  commands: readonly PaletteCommand[],
  filter: string,
): readonly PaletteCommand[] {
  if (!filter.trim()) return commands;
  return commands.filter((command) => nameMatches(command.label, filter));
}

function commandRows(
  commands: readonly PaletteCommand[],
  filter?: string,
): readonly PaletteRow[] {
  return commands.map((command, index) => ({
    ...(command.command ? { command: command.command } : {}),
    key: `command:${index}`,
    kind: "command",
    label: command.label,
    ...matched("labelMatches", command.label, filter),
    ...(command.path ? { path: command.path } : {}),
  }));
}

function counted(amount: number, one: string, many: string): string {
  return `${amount} ${amount === 1 ? one : many}`;
}

function count(amount: number, one: string, many: string): string {
  return `${counted(amount, one, many)} found`;
}

/** The answer to a `>` query: `filter` is what follows the `>`. */
export function commandAnswer(
  commands: readonly PaletteCommand[],
  filter: string,
): PaletteAnswer {
  const matches = matchingCommands(commands, filter);
  return {
    ...(matches.length === 0 ? { empty: "No commands match" } : {}),
    groups: [{ id: "commands", rows: commandRows(matches, filter) }],
    problem: false,
    status: count(matches.length, "command", "commands"),
  };
}

/** The initials a person's avatar shows, from the name the row reads. */
export { nameInitials as initials } from "../../lib/person-name.ts";

/** A person the search found, named in the member's order. */
export function resultPerson(
  person: {
    readonly avatar?: PersonAvatar;
    readonly familyName?: string;
    readonly givenName: string;
    readonly id: string;
    readonly middleName?: string;
    readonly nickname?: string;
  },
  nameOrder: PersonNameOrder,
): SearchPerson {
  return {
    // The search lists people as the active directory does.
    archived: false,
    ...(person.avatar ? { avatar: person.avatar } : {}),
    formalNames: [
      displayPersonName({ ...person, nickname: "" }, "given_family_nickname"),
      displayPersonName({ ...person, nickname: "" }, "family_given_nickname"),
    ],
    id: person.id,
    name: displayPersonName(person, nameOrder),
    ...(person.nickname ? { nickname: person.nickname } : {}),
  };
}

/**
 * Where "Add … as a new person" goes: the first word is the given name and
 * the rest the family name.
 */
export function addPersonPath(query: string): string {
  const firstSpace = query.indexOf(" ");
  const givenName = firstSpace === -1 ? query : query.slice(0, firstSpace);
  const familyName = firstSpace === -1
    ? ""
    : query.slice(firstSpace + 1).trim();
  const parameters = new URLSearchParams({ givenName });
  if (familyName) parameters.set("familyName", familyName);
  return `/app/people/new?${parameters.toString()}`;
}

function matchesExactly(person: SearchPerson, query: string): boolean {
  return person.name.toLocaleLowerCase() === query ||
    (person.formalNames ?? []).some((name) =>
      name.toLocaleLowerCase() === query
    ) ||
    person.nickname?.toLocaleLowerCase() === query;
}

/**
 * The people rows for a people query, or for the recent people when `query`
 * is absent. A query nobody matches exactly offers to add that person, and
 * one no person matches at all also offers the commands it names.
 */
function peopleRows(
  people: readonly SearchPerson[],
  commands: readonly PaletteCommand[],
  query?: string,
): readonly PaletteRow[] {
  const rows: PaletteRow[] = people.map((person) => ({
    archived: person.archived,
    ...(person.avatar ? { avatar: person.avatar } : {}),
    key: `person:${person.id}`,
    kind: "person",
    label: person.name,
    ...matched("labelMatches", person.name, query),
    path: `/app/people/${encodeURIComponent(person.id)}`,
  }));
  if (query) {
    const normalized = query.toLocaleLowerCase();
    if (!people.some((person) => matchesExactly(person, normalized))) {
      rows.push({
        key: "add",
        kind: "add",
        label: `Add "${query}" as a new person`,
        path: addPersonPath(query),
      });
    }
    if (people.length === 0) {
      rows.push(...commandRows(matchingCommands(commands, query), query));
    }
  }
  return rows;
}

/** The answer for the people the member viewed recently. */
export function peopleAnswer(
  people: readonly SearchPerson[],
  commands: readonly PaletteCommand[],
): PaletteAnswer {
  return {
    groups: [{ id: "people", rows: peopleRows(people, commands) }],
    problem: false,
    status: count(people.length, "person", "people"),
  };
}

/** The groups a search answers beside people, with how each is named. */
const ENTITY_GROUPS: Readonly<
  Record<
    Exclude<SearchResults["groups"][number]["kind"], "people">,
    { readonly heading: string; readonly one: string; readonly many: string }
  >
> = {
  activities: { heading: "Activities", many: "activities", one: "activity" },
  "journal-posts": {
    heading: "Journal posts",
    many: "journal posts",
    one: "journal post",
  },
  notes: { heading: "Notes", many: "notes", one: "note" },
  tasks: { heading: "Tasks", many: "tasks", one: "task" },
};

function entityRow(result: SearchEntityResult, query: string): PaletteRow {
  const own = result.title ??
    (result.kind === "journal-post"
      ? "Journal post"
      : result.person?.name ?? "Untitled");
  return {
    archived: result.person?.archived ?? false,
    entity: result.kind,
    key: `${result.kind}:${result.id}`,
    kind: "entity",
    label: own,
    ...matched("labelMatches", own, query),
    path: result.href,
    ...(result.person && result.title ? { person: result.person.name } : {}),
    snippet: result.snippet,
    ...matched("snippetMatches", result.snippet, query),
  };
}

/** "a", "a and b", or "a, b, and c". */
function listed(parts: readonly string[]): string {
  if (parts.length < 3) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

/**
 * The answer to a workspace search: the people rows under "People", then
 * each other group that found something under its own heading. The status
 * counts people always and every other group that found something.
 */
export function searchAnswer(
  results: SearchResults,
  commands: readonly PaletteCommand[],
  nameOrder: PersonNameOrder,
  query: string,
): PaletteAnswer {
  const people = results.groups.flatMap((group) =>
    group.kind === "people"
      ? group.results.map((person) => resultPerson(person, nameOrder))
      : []
  );
  const groups: PaletteGroup[] = [{
    heading: "People",
    id: "people",
    rows: peopleRows(people, commands, query),
  }];
  const counts = [counted(people.length, "person", "people")];
  const partial = results.groups.some((group) =>
    group.kind !== "people" && group.unavailable === true
  );
  for (const group of results.groups) {
    if (group.kind === "people" || group.results.length === 0) continue;
    const named = ENTITY_GROUPS[group.kind];
    groups.push({
      heading: named.heading,
      id: group.kind,
      rows: group.results.map((result) => entityRow(result, query)),
    });
    counts.push(counted(group.results.length, named.one, named.many));
  }
  return {
    ...(counts.length === 1 && people.length === 0 && !partial
      ? { empty: "Nothing in this workspace matches" }
      : {}),
    groups,
    ...(partial ? { partial: true as const } : {}),
    problem: false,
    status: `${listed(counts)} found${
      partial ? "; other results are temporarily unavailable" : ""
    }`,
  };
}

/** The answer when search could not be reached. */
export const UNAVAILABLE_ANSWER: PaletteAnswer = {
  groups: [],
  problem: true,
  status: "Search is temporarily unavailable",
};
