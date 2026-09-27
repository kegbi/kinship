/**
 * What the person workspace's sections tell its hero and rail (GAP-028).
 *
 * The hero island owns the vital stats, the stay-in-touch due state, and the
 * tag preview; the rail island owns each rail section's count and collapsed
 * empty state. The facts behind them are loaded by the sections that own
 * them — important dates, profile facts, relationships, reminders, and
 * communications; the profile facts are islands (GAP-029) and the rest stay
 * vanilla until GAP-031. Those modules used to write the hero's and rail's
 * DOM directly; now every owner publishes the fact here, one document event
 * per change, and the owning island folds
 * it into its state with the pure reducers below. The islands mount before
 * any section loads (`features/person/workspace.ts`), so no change is sent before
 * its reader listens.
 */

import type {
  PersonDueInformation,
  PersonProfileIdentity,
  PersonProfileSummary,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import type { RailSectionId } from "./sections.ts";

// --- Reading what the sections publish ------------------------------------

/**
 * The state one island folds from one summary event, readable with React's
 * `useSyncExternalStore`.
 *
 * It listens from the moment it is created — before the island's first
 * render — so a change a section publishes in the same task as the mount, or
 * while React has yet to run the island's effects, is folded in and never
 * lost. And because React reads it as an external store, a change published
 * outside React renders by the next microtask rather than whenever a
 * scheduler task gets to it.
 */
export interface SummaryStore<State> {
  readonly get: () => State;
  readonly subscribe: (listener: () => void) => () => void;
  /** Stops listening; the state stays as it was. */
  readonly stop: () => void;
}

export function summaryStore<State, Change>(
  event: string,
  reducer: (state: State, change: Change) => State,
  initial: State,
): SummaryStore<State> {
  let state = initial;
  const listeners = new Set<() => void>();
  const onChange = (published: Event) => {
    const change = (published as CustomEvent<Change | undefined>).detail;
    if (change === undefined || change === null) return;
    state = reducer(state, change);
    for (const listener of listeners) listener();
  };
  document.addEventListener(event, onChange);
  return {
    get: () => state,
    stop: () => document.removeEventListener(event, onChange),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// --- The rail --------------------------------------------------------------

export const RAIL_SUMMARY_EVENT = "person-rail-summary-changed";

/** Whether a count covers every record or only the page on screen. */
export type RailCountScope = "total" | "page";

export type RailSummaryChange =
  | {
    readonly section: RailSectionId;
    readonly count: number | undefined;
    readonly scope: RailCountScope;
  }
  | { readonly section: RailSectionId; readonly empty: boolean };

export interface RailSectionSummary {
  /** Absent while the count is unknown, hidden, or failed to load. */
  readonly count?: number;
  readonly scope: RailCountScope;
  /** True when the section is known to hold nothing; it collapses. */
  readonly empty: boolean;
}

export type RailSummary = Readonly<
  Partial<Record<RailSectionId, RailSectionSummary>>
>;

function publish<T>(name: string, detail: T): void {
  document.dispatchEvent(new CustomEvent<T>(name, { detail }));
}

/** Shows `count` beside the section's heading, or clears it. */
export function setRailCount(
  section: RailSectionId,
  count: number | undefined,
  scope: RailCountScope = "total",
): void {
  publish<RailSummaryChange>(RAIL_SUMMARY_EVENT, { count, scope, section });
}

/** Collapses the section to its heading while it holds nothing. */
export function setRailEmpty(section: RailSectionId, empty: boolean): void {
  publish<RailSummaryChange>(RAIL_SUMMARY_EVENT, { empty, section });
}

const UNKNOWN: RailSectionSummary = { empty: false, scope: "total" };

export function railSummaryReducer(
  state: RailSummary,
  change: RailSummaryChange,
): RailSummary {
  const current = state[change.section] ?? UNKNOWN;
  if ("empty" in change) {
    return { ...state, [change.section]: { ...current, empty: change.empty } };
  }
  const { count: _count, ...rest } = current;
  return {
    ...state,
    [change.section]: change.count === undefined
      ? { ...rest, scope: change.scope }
      : { ...rest, count: change.count, scope: change.scope },
  };
}

/** The rail sections the profile summary counts. */
const SUMMARY_RAIL_SECTIONS: ReadonlySet<string> = new Set<RailSectionId>([
  "addresses",
  "contact-methods",
  "first-meeting",
  "food-preferences",
  "pets",
  "relationships",
  "work",
]);

/**
 * The counts the profile summary already knows, shown before each section
 * refreshes its own (UXD-002B). A hidden module shows no count.
 */
export function railSummaryFromProfile(
  summary: PersonProfileSummary | undefined,
): RailSummary {
  const state: Partial<Record<RailSectionId, RailSectionSummary>> = {};
  for (const entry of summary?.sectionCounts ?? []) {
    if (!SUMMARY_RAIL_SECTIONS.has(entry.id)) continue;
    state[entry.id as RailSectionId] = entry.status === "hidden"
      ? UNKNOWN
      : { count: entry.count, empty: entry.count === 0, scope: "total" };
  }
  return state;
}

/** The text of a section's count chip, or `undefined` when it shows none. */
export function railCountText(
  summary: RailSectionSummary | undefined,
): string | undefined {
  if (summary?.count === undefined) return undefined;
  return `${summary.count}${summary.scope === "page" ? " on this page" : ""}`;
}

// --- The hero --------------------------------------------------------------

export const HERO_FACTS_EVENT = "person-hero-facts-changed";

/** A tag preview: up to eight names and how many more there are. */
export interface TagPreview {
  readonly names: readonly string[];
  readonly more: number;
}

export type HeroFactChange =
  | {
    readonly slot:
      | "birthday"
      | "deceased"
      | "first-meeting-date"
      | "first-meeting-place"
      | "work";
    readonly text: string | undefined;
  }
  | {
    readonly slot: "last-contact" | "next-reminder" | "stay-in-touch";
    readonly text: string;
  }
  | { readonly slot: "tags"; readonly tags: TagPreview | undefined };

export interface HeroFacts {
  readonly birthday?: string;
  /** The date of death the important dates hold (GAP-047). */
  readonly deceased?: string;
  readonly work?: string;
  readonly firstMeetingDate?: string;
  readonly firstMeetingPlace?: string;
  readonly lastContact: string;
  readonly nextReminder: string;
  readonly stayInTouch: string;
  /** Absent while the tags module is hidden. */
  readonly tags?: TagPreview;
}

type OptionalFact =
  | "birthday"
  | "deceased"
  | "firstMeetingDate"
  | "firstMeetingPlace"
  | "work";

const OPTIONAL_SLOTS = {
  birthday: "birthday",
  deceased: "deceased",
  "first-meeting-date": "firstMeetingDate",
  "first-meeting-place": "firstMeetingPlace",
  work: "work",
} as const satisfies Record<string, OptionalFact>;

function withOptional<K extends keyof HeroFacts>(
  state: HeroFacts,
  key: K,
  value: HeroFacts[K] | undefined,
): HeroFacts {
  const { [key]: _previous, ...rest } = state;
  return (value === undefined ? rest : { ...rest, [key]: value }) as HeroFacts;
}

export function heroFactsReducer(
  state: HeroFacts,
  change: HeroFactChange,
): HeroFacts {
  switch (change.slot) {
    case "tags":
      return withOptional(state, "tags", change.tags);
    case "last-contact":
      return { ...state, lastContact: change.text };
    case "next-reminder":
      return { ...state, nextReminder: change.text };
    case "stay-in-touch":
      return { ...state, stayInTouch: change.text };
    default:
      return withOptional(
        state,
        OPTIONAL_SLOTS[change.slot],
        change.text || undefined,
      );
  }
}

/** The first eight names of `names`, and how many more there are. */
export function tagPreview(names: readonly string[]): TagPreview {
  return { more: Math.max(0, names.length - 8), names: names.slice(0, 8) };
}

/**
 * The hero's facts as the profile answer states them, before any section
 * refreshes one. `format` renders an instant in the member's time zone.
 */
export function heroFactsFromProfile(
  person: PersonProfileIdentity,
  dueInformation: PersonDueInformation,
  tagsHidden: boolean,
  format: (instant: string) => string,
): HeroFacts {
  return {
    lastContact: person.lastContactAt
      ? format(person.lastContactAt)
      : "None recorded",
    nextReminder: dueInformation.nextReminderAt
      ? format(dueInformation.nextReminderAt)
      : "Not recorded",
    stayInTouch: dueInformation.stayInTouchAt ? "Loading cadence…" : "Not set",
    ...(tagsHidden ? {} : {
      tags: {
        more: Math.max(0, person.tagCount - person.tags.length),
        names: person.tags.map((tag) => tag.name),
      },
    }),
  };
}

/** The first meeting's vital: its date when known, else its place. */
export function firstMeetingText(facts: HeroFacts): string | undefined {
  return facts.firstMeetingDate ?? facts.firstMeetingPlace;
}

/** Shows `text` as the birthday or work vital; empty means not recorded. */
export function setVitalStat(
  slot: "birthday" | "work",
  text: string | undefined,
): void {
  publish<HeroFactChange>(HERO_FACTS_EVENT, { slot, text });
}

/** The date of death the hero shows beside the deceased state (GAP-047). */
export function setDeceasedDate(text: string | undefined): void {
  publish<HeroFactChange>(HERO_FACTS_EVENT, { slot: "deceased", text });
}

/**
 * The document event the hero sends, with `{ kind, opened }`, to have the
 * important dates open their editor on that kind of date (GAP-047): the date
 * of death, once a member marks the person deceased. The date is written
 * through the important dates' own route, never the hero's. A listener that
 * opened its editor, and so took focus, calls `opened`.
 */
export const DATE_REQUEST_EVENT = "person-important-date-requested";

/** What a date request carries. */
export interface ImportantDateRequest {
  readonly kind: "deceased";
  /** Called by the listener that opened its editor for the request. */
  readonly opened: () => void;
}

/**
 * Asks the important dates to record a date of death. Answers whether an
 * editor opened for it — false while the dates are loading or failed, or when
 * the member declined to discard another editor's draft — so the caller can
 * keep focus where it belongs.
 */
export function requestImportantDate(kind: "deceased"): boolean {
  let opened = false;
  publish<ImportantDateRequest>(DATE_REQUEST_EVENT, {
    kind,
    opened: () => {
      opened = true;
    },
  });
  return opened;
}

/** The first meeting's date, which the vital prefers to its place. */
export function setFirstMeetingDate(text: string | undefined): void {
  publish<HeroFactChange>(HERO_FACTS_EVENT, {
    slot: "first-meeting-date",
    text,
  });
}

export function setFirstMeetingPlace(text: string | undefined): void {
  publish<HeroFactChange>(HERO_FACTS_EVENT, {
    slot: "first-meeting-place",
    text,
  });
}

/** The last contact vital, already formatted. */
export function setLastContact(text: string): void {
  publish<HeroFactChange>(HERO_FACTS_EVENT, { slot: "last-contact", text });
}

/** The next reminder vital, already formatted. */
export function setNextReminder(text: string): void {
  publish<HeroFactChange>(HERO_FACTS_EVENT, { slot: "next-reminder", text });
}

/** The stay-in-touch due state the hero announces. */
export function setStayInTouch(text: string): void {
  publish<HeroFactChange>(HERO_FACTS_EVENT, { slot: "stay-in-touch", text });
}

/** The hero's tag preview; `undefined` hides it with its module. */
export function setTagPreview(tags: TagPreview | undefined): void {
  publish<HeroFactChange>(HERO_FACTS_EVENT, { slot: "tags", tags });
}
