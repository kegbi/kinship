/**
 * The person profile section registry (GAP-028).
 *
 * `/app/people/:personId` is one canonical workspace made of the 22 sections
 * the page catalog lists for `people.profile`, in catalog order. This file is
 * the one place that says what each section is: its stable id and title,
 * where it renders (`zone`), its glyph, the workspace profile module that
 * will switch it off (`visibilityKey`, GAP-047), and how its owner mounts
 * (`mount`: since GAP-033 every section is an island). Every consumer reads
 * it rather than keeping its own list:
 *
 * - the static shell renders each section's chrome, the section directory,
 *   and the zones from it (`person-profile-shell.astro`, `PersonSection`);
 * - `features/person/workspace.ts` maps sections to filter zones, activates
 *   each zone's owners, and resolves `?section=` deep links with it;
 * - `features/person/section-mounts.ts` supplies each owner's loader and is
 *   typed so a loader's kind always matches the entry here;
 * - `tools/gateway_contract_test.ts` imports it to prove the shell keeps the
 *   accepted canonical sections.
 *
 * It is pure data so Deno tools can import it: the loaders, which reach DOM
 * and React modules, live beside it in `section-mounts.ts`.
 */

import type { SectionIconName } from "../../lib/section-icons.ts";

/** The four stream zones, in the order the page shows them. */
export type StreamZoneId = "timeline" | "planning" | "things" | "admin";

/**
 * Where a section renders: in the hero (the identity editor), in the profile
 * facts rail, or in one of the stream zones.
 */
export type SectionZone = "hero" | "rail" | StreamZoneId;

/** The filter a section belongs to; `facts` stays visible under every view. */
export type FilterZone = "facts" | StreamZoneId;

/**
 * Who owns a section's DOM. Every section is a React island since GAP-033
 * retired the vanilla modules; the kind stays so a loader's type is tied to
 * its entry.
 */
export type SectionMountKind = "island";

/**
 * The workspace profile modules (`workspace_profile_modules.key`) a section
 * answers to. A section without one is always shown.
 */
export type SectionVisibilityKey =
  | "activities"
  | "addresses"
  | "calls"
  | "contact-methods"
  | "conversations"
  | "first-meeting"
  | "food-preferences"
  | "life-events"
  | "notes"
  | "pets"
  | "relationships"
  | "tasks"
  | "work";

export interface PersonSectionEntry<
  Id extends string = string,
  Kind extends SectionMountKind = SectionMountKind,
> {
  readonly id: Id;
  readonly title: string;
  readonly zone: SectionZone;
  /** The glyph beside the heading; the hero's identity editor has none. */
  readonly icon: SectionIconName | null;
  readonly visibilityKey: SectionVisibilityKey | null;
  readonly mount: Kind;
}

const section = <
  const Id extends string,
  const Kind extends SectionMountKind,
>(
  id: Id,
  title: string,
  zone: SectionZone,
  icon: SectionIconName | null,
  visibilityKey: SectionVisibilityKey | null,
  mount: Kind,
): PersonSectionEntry<Id, Kind> => ({
  icon,
  id,
  mount,
  title,
  visibilityKey,
  zone,
});

/** Every section of the person workspace, in page-catalog order. */
export const PERSON_SECTIONS = [
  section("identity-summary", "Identity summary", "hero", null, null, "island"),
  section(
    "important-dates",
    "Important dates",
    "rail",
    "important-dates",
    null,
    "island",
  ),
  section(
    "contact-methods",
    "Contact methods",
    "rail",
    "contact-methods",
    "contact-methods",
    "island",
  ),
  section(
    "addresses",
    "Addresses",
    "rail",
    "addresses",
    "addresses",
    "island",
  ),
  section(
    "relationships",
    "Relationships",
    "rail",
    "relationships",
    "relationships",
    "island",
  ),
  section(
    "first-meeting",
    "First meeting",
    "rail",
    "first-meeting",
    "first-meeting",
    "island",
  ),
  section("work", "Work", "rail", "work", "work", "island"),
  section(
    "food-preferences",
    "Food preferences",
    "rail",
    "food-preferences",
    "food-preferences",
    "island",
  ),
  section("pets", "Pets", "rail", "pets", "pets", "island"),
  section(
    "life-events",
    "Life events",
    "timeline",
    "life-events",
    "life-events",
    "island",
  ),
  section("notes", "Notes", "timeline", "notes", "notes", "island"),
  section(
    "conversations",
    "Conversations",
    "timeline",
    "conversations",
    "conversations",
    "island",
  ),
  section("calls", "Calls", "timeline", "calls", "calls", "island"),
  section(
    "activities",
    "Activities",
    "timeline",
    "activities",
    "activities",
    "island",
  ),
  section("tasks", "Tasks", "planning", "tasks", "tasks", "island"),
  section("reminders", "Reminders", "planning", "reminders", null, "island"),
  section(
    "stay-in-touch",
    "Stay in touch",
    "rail",
    "stay-in-touch",
    null,
    "island",
  ),
  section("gifts", "Gifts", "things", "gifts", null, "island"),
  section("debts", "Debts", "things", "debts", null, "island"),
  section("documents", "Documents", "things", "documents", null, "island"),
  section("photos", "Photos", "things", "photos", null, "island"),
  section("audit-summary", "Audit summary", "admin", "audit", null, "island"),
] as const;

export type PersonSectionId = typeof PERSON_SECTIONS[number]["id"];

/**
 * The document event an owner sends, with `{ sectionId }`, when it finds its
 * section's profile module turned off after the page loaded; the section
 * navigation then treats the section as hidden.
 */
export const SECTION_HIDDEN_EVENT = "person-section-hidden";

/**
 * The document event the hero sends, with `{ sectionId, view }`, to have the
 * section navigation show a section in a view — Audit history in Admin.
 */
export const SECTION_REQUEST_EVENT = "person-section-requested";

/** The entry for `id`, when `id` names a section. */
export function personSection(
  id: string | null | undefined,
): PersonSectionEntry<PersonSectionId> | undefined {
  return PERSON_SECTIONS.find((entry) => entry.id === id);
}

/**
 * The rail's display order, which groups the facts people reach for first
 * rather than following catalog order (PRF-001).
 */
export const RAIL_SECTION_ORDER = [
  "contact-methods",
  "relationships",
  "important-dates",
  "addresses",
  "work",
  "pets",
  "food-preferences",
  "first-meeting",
  "stay-in-touch",
] as const satisfies readonly PersonSectionId[];

export type RailSectionId = typeof RAIL_SECTION_ORDER[number];

/** The stream zones in page order, each with its heading. */
export const STREAM_ZONES = [
  { id: "timeline", title: "Timeline" },
  { id: "planning", title: "Planning" },
  { id: "things", title: "Things" },
  { id: "admin", title: "Admin" },
] as const satisfies readonly {
  readonly id: StreamZoneId;
  readonly title: string;
}[];

/** The rail's sections in rail order. */
export function railSections(): readonly PersonSectionEntry<RailSectionId>[] {
  return RAIL_SECTION_ORDER.map((id) =>
    PERSON_SECTIONS.find((entry) => entry.id === id) as PersonSectionEntry<
      RailSectionId
    >
  );
}

/** A stream zone's sections, in catalog order. */
export function zoneSections(
  zone: StreamZoneId,
): readonly PersonSectionEntry<PersonSectionId>[] {
  return PERSON_SECTIONS.filter((entry) => entry.zone === zone);
}

/**
 * The filter a section belongs to. Rail sections are facts, visible under
 * every view. The identity editor lives in the hero but files under Admin, so
 * its deep link reveals the Admin view (UXD-002A).
 */
export function filterZone(entry: PersonSectionEntry): FilterZone {
  if (entry.zone === "rail") return "facts";
  if (entry.zone === "hero") return "admin";
  return entry.zone;
}
