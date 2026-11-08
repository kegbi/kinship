/**
 * The person rail in one read (AUD-Q3, FEQ-04 step 4).
 *
 * The person page's rail shows ten sections, and each used to cost the page
 * its own request: the seven profile facts, the relationships with their
 * types, the important dates, and the reminders. This composes the first
 * page of each from the module that owns it, through that module's public
 * read — the same use case, with the same actor, the same permission and
 * visibility checks, and the same cursors its own endpoint answers with — so
 * the composition can neither widen nor narrow what a member sees, and a
 * module's rules stay written once.
 *
 * Each section answers on its own. A module that hides a section, or refuses
 * the actor, makes it `hidden`; a module that fails or cannot find the
 * person makes it `unavailable`, and the sections beside it still answer.
 *
 * The reads run one after another. Each takes a pooled connection for its own
 * transaction, and the pool is small (`DATABASE_POOL_MAX`), so one page open
 * must not hold most of it at once.
 *
 * Nothing here writes: every later page, refresh, and mutation still goes to
 * the owning module's own endpoint.
 */

import type {
  ImportantDateManagement,
  ProfileFactManagement,
} from "../../../modules/people/public.ts";
import type { ReminderManagement } from "../../../modules/planning/public.ts";
import type { RelationshipManagement } from "../../../modules/relationships/public.ts";

/** The profile fact sections the rail shows, in rail order. */
export const PERSON_RAIL_FACT_SECTIONS = [
  "contact-methods",
  "addresses",
  "first-meeting",
  "work",
  "food-preferences",
  "pets",
  "tags",
] as const;

export type PersonRailFactSection = typeof PERSON_RAIL_FACT_SECTIONS[number];

/** One rail section, as the person page receives it. */
export type PersonRailSection<Value> =
  | { readonly status: "ready"; readonly value: Value }
  | { readonly status: "hidden" | "unavailable" };

type Answer<Read extends (...args: never[]) => Promise<unknown>> = Awaited<
  ReturnType<Read>
>;

type FactAnswer = Answer<ProfileFactManagement["list"]>;
type DateAnswer = Answer<ImportantDateManagement["list"]>;
type RelationshipAnswer = Answer<RelationshipManagement["list"]>;
type RelationshipTypeAnswer = Answer<RelationshipManagement["listTypes"]>;
type ReminderAnswer = Answer<ReminderManagement["listPerson"]>;

export type PersonRailFacts = Extract<
  FactAnswer,
  { readonly records: readonly unknown[] }
>;
export type PersonRailImportantDates = Extract<
  DateAnswer,
  { readonly dates: readonly unknown[] }
>;
export interface PersonRailRelationships {
  readonly list: Extract<
    RelationshipAnswer,
    { readonly relationships: readonly unknown[] }
  >;
  readonly types: Extract<
    RelationshipTypeAnswer,
    { readonly options: readonly unknown[] }
  >;
}
export type PersonRailReminders = Extract<
  ReminderAnswer,
  { readonly status: "ready" }
>;

export type PersonRail =
  & {
    readonly [Section in PersonRailFactSection]: PersonRailSection<
      PersonRailFacts
    >;
  }
  & {
    readonly "important-dates": PersonRailSection<PersonRailImportantDates>;
    readonly relationships: PersonRailSection<PersonRailRelationships>;
    readonly reminders: PersonRailSection<PersonRailReminders>;
  };

/**
 * The owning modules' public reads the rail is composed from. The actor is
 * passed through as the request resolved it, so a read that trusts the
 * request's admission still does.
 */
export interface PersonRailSources {
  readonly facts: Pick<ProfileFactManagement, "list">;
  readonly importantDates: Pick<ImportantDateManagement, "list">;
  readonly relationships: Pick<RelationshipManagement, "list" | "listTypes">;
  readonly reminders: Pick<ReminderManagement, "listPerson">;
}

/**
 * The first page's size for the paged sections: the contract's default page,
 * which their own endpoints read when the page asks for none (relationships
 * and reminders).
 */
export const PERSON_RAIL_PAGE = 20;

const HIDDEN = { status: "hidden" } as const;
const UNAVAILABLE = { status: "unavailable" } as const;

/** A section whose read threw is unavailable; the others still answer. */
async function section<Value>(
  read: () => Promise<PersonRailSection<Value>>,
): Promise<PersonRailSection<Value>> {
  try {
    return await read();
  } catch {
    return UNAVAILABLE;
  }
}

function facts(answer: FactAnswer): PersonRailSection<PersonRailFacts> {
  if (answer.status === "forbidden" || answer.status === "hidden") {
    return HIDDEN;
  }
  return answer.status === "ready" || answer.status === "archived"
    ? { status: "ready", value: answer }
    : UNAVAILABLE;
}

function importantDates(
  answer: DateAnswer,
): PersonRailSection<PersonRailImportantDates> {
  if (answer.status === "forbidden") return HIDDEN;
  return answer.status === "ready" || answer.status === "archived"
    ? { status: "ready", value: answer }
    : UNAVAILABLE;
}

function relationships(
  list: RelationshipAnswer,
  types: RelationshipTypeAnswer,
): PersonRailSection<PersonRailRelationships> {
  if (
    list.status === "forbidden" || list.status === "hidden" ||
    types.status === "forbidden" || types.status === "hidden"
  ) return HIDDEN;
  return (list.status === "ready" || list.status === "archived") &&
      types.status === "ready"
    ? { status: "ready", value: { list, types } }
    : UNAVAILABLE;
}

function reminders(
  answer: ReminderAnswer,
): PersonRailSection<PersonRailReminders> {
  if (answer.status === "forbidden") return HIDDEN;
  if (answer.status !== "ready") return UNAVAILABLE;
  return { status: "ready", value: answer };
}

export function createPersonRail(sources: PersonRailSources) {
  return async (
    actor: Parameters<PersonRailSources["facts"]["list"]>[0],
    personId: string,
  ): Promise<PersonRail> => {
    const factSections: Partial<
      Record<PersonRailFactSection, PersonRailSection<PersonRailFacts>>
    > = {};
    for (const id of PERSON_RAIL_FACT_SECTIONS) {
      factSections[id] = await section(async () =>
        facts(await sources.facts.list(actor, personId, id))
      );
    }
    const relationshipSection = await section(async () => {
      const list = await sources.relationships.list(actor, personId, {
        limit: PERSON_RAIL_PAGE,
      });
      // A hidden or refused list needs no vocabulary beside it.
      if (list.status === "forbidden" || list.status === "hidden") {
        return HIDDEN;
      }
      return relationships(list, await sources.relationships.listTypes(actor));
    });
    const dateSection = await section(async () =>
      importantDates(await sources.importantDates.list(actor, personId))
    );
    const reminderSection = await section(async () =>
      reminders(
        await sources.reminders.listPerson(actor, personId, {
          limit: PERSON_RAIL_PAGE,
        }),
      )
    );
    return {
      ...(factSections as Record<
        PersonRailFactSection,
        PersonRailSection<PersonRailFacts>
      >),
      "important-dates": dateSection,
      relationships: relationshipSection,
      reminders: reminderSection,
    };
  };
}
