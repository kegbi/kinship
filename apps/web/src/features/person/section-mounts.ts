/**
 * Who mounts each person section, and how (GAP-028).
 *
 * `sections.ts` says whether an island or a vanilla module owns a section;
 * this says where that owner's code is. Every owner loads on demand and
 * answers one contract, `SectionMount`: given the workspace element the
 * sections live in and the `SectionProps` every section receives, it renders
 * or wires its sections and resolves, once its first answer has settled, with
 * the function that unmounts it. A module that owns several sections — notes
 * and activities, calls and conversations, reminders and the stay-in-touch
 * cadence — is one owner shared by those entries, so it mounts once.
 *
 * Until a section migrates, its entry adapts the vanilla module's existing
 * mount function to the contract; the module's own behaviour is unchanged.
 */

import type {
  getPerson,
  ResolvedMemberPreferences,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import type {
  PersonSectionEntry,
  PersonSectionId,
  SectionMountKind,
  SectionVisibilityKey,
} from "./sections.ts";
import { PERSON_SECTIONS } from "./sections.ts";

/** The profile answer the page loaded: identity, due state, and summary. */
export type PersonProfile = Extract<
  Awaited<ReturnType<typeof getPerson>>,
  { readonly ok: true }
>["value"];

/** What every section's owner receives. */
export interface SectionProps {
  readonly personId: string;
  readonly workspaceId: string;
  /** Whether the person is archived at the moment the owner mounts. */
  readonly archived: boolean;
  /** The member's locale, time zone, and name order, when they loaded. */
  readonly preferences?: ResolvedMemberPreferences | undefined;
  /** The profile answer the page already has, so no owner refetches it. */
  readonly initial?: PersonProfile | undefined;
}

/**
 * Mounts an owner into the workspace element `container` and resolves, when
 * its first load has settled, with the function that unmounts it.
 */
export type SectionMount = (
  container: HTMLElement,
  props: SectionProps,
) => Promise<() => void>;

export interface SectionMountEntry<Kind extends SectionMountKind> {
  readonly kind: Kind;
  readonly load: () => Promise<SectionMount>;
}

const nothing = (): void => undefined;

/**
 * Whether the workspace turned `key`'s profile module off. Tags are a module
 * without a section of their own: the hero previews them.
 */
export function sectionHidden(
  props: SectionProps,
  key: SectionVisibilityKey | "tags",
): boolean {
  return props.initial?.person.profileSections?.some((section) =>
    section.id === key && section.status === "hidden"
  ) ?? false;
}

function island(
  load: () => Promise<SectionMount>,
): SectionMountEntry<"island"> {
  return { kind: "island", load };
}

/** A vanilla module's mount, adapted to the contract; it never unmounts. */
function vanilla(
  load: () => Promise<(props: SectionProps) => Promise<void>>,
): SectionMountEntry<"vanilla"> {
  return {
    kind: "vanilla",
    load: () =>
      load().then((mount) => (_container, props) =>
        mount(props).then(() => nothing)
      ),
  };
}

// The hero island owns the identity section's editor with the rest of the
// hero; the page mounts it as soon as the profile answer arrives.
const hero = island(() =>
  import("../../islands/person-hero/mount.tsx").then((module) =>
    module.mountPersonHero
  )
);

// The important-dates rail block is an island (GAP-031).
const importantDates = island(() =>
  import("./important-dates/important-dates.tsx").then((module) =>
    module.mountImportantDates
  )
);

// Each profile fact section is its own island (GAP-029), loaded with the
// rail; `features/person/facts/` holds them and the editor they share.
const contactMethods = island(() =>
  import("./facts/contact-methods.tsx").then((module) =>
    module.mountContactMethods
  )
);

const addresses = island(() =>
  import("./facts/addresses.tsx").then((module) => module.mountAddresses)
);

const firstMeeting = island(() =>
  import("./facts/first-meeting.tsx").then((module) => module.mountFirstMeeting)
);

const work = island(() =>
  import("./facts/work.tsx").then((module) => module.mountWork)
);

const foodPreferences = island(() =>
  import("./facts/food.tsx").then((module) => module.mountFoodPreferences)
);

const pets = island(() =>
  import("./facts/pets.tsx").then((module) => module.mountPets)
);

// The relationships rail block is an island (GAP-031).
const relationships = island(() =>
  import("./relationships/person-relationships.tsx").then((module) =>
    module.mountPersonRelationships
  )
);

// One island owns the reminders card and the stay-in-touch rail block, which
// one read answers (GAP-031).
const reminders = island(() =>
  import("./reminders/person-reminders.tsx").then((module) =>
    module.mountPersonReminders
  )
);

const lifeEvents = island(() =>
  import("../../islands/person-life-events/mount.tsx").then((module) =>
    module.mountPersonLifeEvents
  )
);

// Notes and activities are one island (GAP-031), loaded with the Timeline
// zone; `features/person/interactions/` holds it.
const interactions = island(() =>
  import("./interactions/mount.tsx").then((module) =>
    module.mountPersonInteractions
  )
);

// Calls and conversations are one island (GAP-031), loaded with the
// Timeline zone; `features/person/communications/` holds it.
const communications = island(() =>
  import("./communications/mount.tsx").then((module) =>
    module.mountPersonCommunications
  )
);

// The task surface island serves this card and the `/app/tasks` page
// (GAP-031).
const tasks = island(() =>
  import("../tasks/task-surface.tsx").then((module) => module.mountPersonTasks)
);

// The gifts island (GAP-026) and React load with the Things zone, so a person
// page that never shows its Things pays nothing for them.
const gifts = island(() =>
  import("../../islands/person-gifts/mount.tsx").then(
    ({ mountGiftsIsland }) => (_container, props) =>
      mountGiftsIsland({
        archived: props.archived,
        personId: props.personId,
        workspaceId: props.workspaceId,
      }),
  )
);

const files = vanilla(() =>
  import("../../lib/person-files.ts").then(({ mountPersonFiles }) => (props) =>
    mountPersonFiles({
      archived: props.archived,
      personId: props.personId,
      workspaceId: props.workspaceId,
    })
  )
);

const auditSummary = vanilla(() =>
  import("../../lib/audit-history.ts").then(
    ({ mountPersonAuditSummary }) => (props) =>
      mountPersonAuditSummary(
        props.personId,
        props.workspaceId,
        props.preferences,
      ),
  )
);

type MountKindOf<Id extends PersonSectionId> = Extract<
  typeof PERSON_SECTIONS[number],
  { readonly id: Id }
>["mount"];

/**
 * Each section's owner. The type ties every loader's kind to the kind its
 * registry entry declares, so a section cannot silently change owner.
 */
export const SECTION_MOUNTS: {
  readonly [Id in PersonSectionId]: SectionMountEntry<MountKindOf<Id>>;
} = {
  "identity-summary": hero,
  "important-dates": importantDates,
  "contact-methods": contactMethods,
  addresses,
  relationships,
  "first-meeting": firstMeeting,
  work,
  "food-preferences": foodPreferences,
  pets,
  "life-events": lifeEvents,
  notes: interactions,
  conversations: communications,
  calls: communications,
  activities: interactions,
  tasks,
  reminders,
  "stay-in-touch": reminders,
  gifts,
  debts: gifts,
  documents: files,
  photos: files,
  "audit-summary": auditSummary,
};

/**
 * The unified timeline card heads the Timeline zone. It is not one of the 22
 * sections — it merges five of them — but it activates with that zone.
 */
export const TIMELINE_MOUNT: SectionMountEntry<"island"> = island(() =>
  import("../../islands/person-timeline/mount.tsx").then((module) =>
    module.mountPersonTimeline
  )
);

/**
 * The tags editor beside the hero's tag preview (GAP-029). Tags are a profile
 * module without a section of their own, so the editor is not one of the 22
 * sections; it mounts with the rail's blocks, as the vanilla module did.
 */
export const TAGS_MOUNT: SectionMountEntry<"island"> = island(() =>
  import("./facts/tags.tsx").then((module) => module.mountTags)
);

/**
 * The rail's own summary — its heading and each block's count chip — mounts
 * before the rail's blocks, so each count they publish finds its reader.
 */
export const RAIL_MOUNT: SectionMountEntry<"island"> = island(() =>
  import("../../islands/person-rail/mount.tsx").then((module) =>
    module.mountPersonRail
  )
);

/**
 * The distinct owners of `sections`, in first-seen order: an owner shared by
 * several sections appears once.
 */
export function sectionOwners(
  sections: readonly PersonSectionEntry<PersonSectionId>[],
): readonly SectionMountEntry<SectionMountKind>[] {
  return [...new Set(sections.map((entry) => SECTION_MOUNTS[entry.id]))];
}
