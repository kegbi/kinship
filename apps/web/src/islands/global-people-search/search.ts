/**
 * What the people palette shows, without the DOM (GAP-027).
 *
 * The palette answers three kinds of query: nothing typed shows the people
 * the member viewed recently, `>` lists the commands the member may run, and
 * anything else searches the workspace's people. These functions turn each
 * answer into the rows the list renders; the island only fetches and draws.
 */

import type {
  PeopleDirectoryPerson,
  PersonAvatar,
  SessionContext,
} from "../../../../../packages/contracts/generated/auth-client.ts";
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

/** One option of the list, keyed uniquely within its answer. */
export type PaletteRow =
  | {
    readonly archived: boolean;
    readonly avatar?: PersonAvatar | undefined;
    readonly key: string;
    readonly kind: "person";
    readonly label: string;
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
    readonly path?: string;
  };

/** What the palette shows for one query once its answer is known. */
export interface PaletteAnswer {
  /** The copy under the input when nothing matched, or nothing to show. */
  readonly empty?: string;
  readonly problem: boolean;
  readonly rows: readonly PaletteRow[];
  readonly status: string;
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

function matchingCommands(
  commands: readonly PaletteCommand[],
  filter: string,
): readonly PaletteCommand[] {
  const normalizedFilter = filter.toLocaleLowerCase();
  return commands.filter((command) =>
    command.label.toLocaleLowerCase().includes(normalizedFilter)
  );
}

function commandRows(
  commands: readonly PaletteCommand[],
): readonly PaletteRow[] {
  return commands.map((command, index) => ({
    ...(command.command ? { command: command.command } : {}),
    key: `command:${index}`,
    kind: "command",
    label: command.label,
    ...(command.path ? { path: command.path } : {}),
  }));
}

function count(amount: number, one: string, many: string): string {
  return `${amount} ${amount === 1 ? one : many} found`;
}

/** The answer to a `>` query: `filter` is what follows the `>`. */
export function commandAnswer(
  commands: readonly PaletteCommand[],
  filter: string,
): PaletteAnswer {
  const matches = matchingCommands(commands, filter);
  return {
    ...(matches.length === 0 ? { empty: "No commands match" } : {}),
    problem: false,
    rows: commandRows(matches),
    status: count(matches.length, "command", "commands"),
  };
}

/** The initials a person's avatar shows, from the name the row reads. */
export { nameInitials as initials } from "../../lib/person-name.ts";

/** A directory answer's person, named in the member's order. */
export function directorySearchPerson(
  person: PeopleDirectoryPerson,
  nameOrder: PersonNameOrder,
): SearchPerson {
  return {
    archived: person.lifecycle === "archived",
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
 * The answer to a people query, or to the recent people when `query` is
 * absent. A query nobody matches exactly offers to add that person, and one
 * nobody matches at all also offers the commands it names.
 */
export function peopleAnswer(
  people: readonly SearchPerson[],
  commands: readonly PaletteCommand[],
  query?: string,
): PaletteAnswer {
  const rows: PaletteRow[] = people.map((person) => ({
    archived: person.archived,
    ...(person.avatar ? { avatar: person.avatar } : {}),
    key: `person:${person.id}`,
    kind: "person",
    label: person.name,
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
      rows.push(...commandRows(matchingCommands(commands, query)));
    }
  }
  return {
    ...(query && people.length === 0 ? { empty: "No people match" } : {}),
    problem: false,
    rows,
    status: count(people.length, "person", "people"),
  };
}

/** The answer when people search could not be reached. */
export const UNAVAILABLE_ANSWER: PaletteAnswer = {
  problem: true,
  rows: [],
  status: "People search is temporarily unavailable",
};
