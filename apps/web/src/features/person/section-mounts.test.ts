// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonProfileSectionId } from "../../../../../packages/contracts/generated/auth-client.ts";
import { stubApi } from "../../testing/api.ts";
import {
  ids,
  personProfile,
  preferences as memberPreferences,
  profileSummary,
  revision,
  sectionProps,
} from "../../testing/fixtures.ts";
import { drawShell } from "../../testing/render.tsx";
import { mountImportantDates } from "../../lib/important-dates.ts";
import { mountRelationships } from "../../lib/relationships.ts";
import { mountPersonReminders } from "../../lib/reminders.ts";
import { mountPersonInteractions } from "../../lib/interactions.ts";
import { mountCommunications } from "../../lib/communications.ts";
import { mountTaskSurface } from "../../lib/tasks.ts";
import { mountPersonFiles } from "../../lib/person-files.ts";
import { mountPersonAuditSummary } from "../../lib/audit-history.ts";
import { mountGiftsIsland } from "../../islands/person-gifts/mount.tsx";
import { mountPersonTimeline } from "../../islands/person-timeline/mount.tsx";
import { mountPersonLifeEvents } from "../../islands/person-life-events/mount.tsx";
import { mountPersonRail } from "../../islands/person-rail/mount.tsx";
import { mountPersonHero } from "../../islands/person-hero/mount.tsx";
import { mountAddresses } from "./facts/addresses.tsx";
import { mountContactMethods } from "./facts/contact-methods.tsx";
import { mountFirstMeeting } from "./facts/first-meeting.tsx";
import { mountFoodPreferences } from "./facts/food.tsx";
import { mountPets } from "./facts/pets.tsx";
import { mountTags } from "./facts/tags.tsx";
import { mountWork } from "./facts/work.tsx";
import {
  RAIL_MOUNT,
  SECTION_MOUNTS,
  sectionHidden,
  sectionOwners,
  type SectionProps,
  TAGS_MOUNT,
  TIMELINE_MOUNT,
} from "./section-mounts.ts";
import { PERSON_SECTIONS, railSections, zoneSections } from "./sections.ts";

vi.mock("../../lib/important-dates.ts", () => ({
  mountImportantDates: vi.fn(async () => {}),
}));
vi.mock("../../lib/relationships.ts", () => ({
  mountRelationships: vi.fn(async () => {}),
}));
vi.mock("../../lib/reminders.ts", () => ({
  mountPersonReminders: vi.fn(async () => {}),
}));
vi.mock("../../lib/interactions.ts", () => ({
  mountPersonInteractions: vi.fn(async () => {}),
}));
vi.mock("../../lib/communications.ts", () => ({
  mountCommunications: vi.fn(async () => {}),
}));
vi.mock("../../lib/tasks.ts", () => ({
  mountTaskSurface: vi.fn(async () => {}),
}));
vi.mock("../../lib/person-files.ts", () => ({
  mountPersonFiles: vi.fn(async () => {}),
}));
vi.mock("../../lib/audit-history.ts", () => ({
  mountPersonAuditSummary: vi.fn(async () => {}),
}));
vi.mock("../../islands/person-gifts/mount.tsx", () => ({
  mountGiftsIsland: vi.fn(() => Promise.resolve(() => {})),
}));

const { person: personId, workspace: workspaceId } = ids;
const preferences = memberPreferences();

const props = (hidden: readonly PersonProfileSectionId[] = []) =>
  sectionProps({
    archived: true,
    initial: personProfile({
      person: {
        profileSections: hidden.map((id) => ({ id, status: "hidden" })),
      },
      summary: profileSummary(),
    }),
    preferences,
  });

async function mount(
  id: keyof typeof SECTION_MOUNTS,
  given: SectionProps,
): Promise<unknown> {
  const owner = await SECTION_MOUNTS[id].load();
  const unmount = await owner(document.body, given);
  expect(unmount).toBeTypeOf("function");
  unmount();
  return unmount;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GAP-028 section owners", () => {
  it("gives every section an owner of the kind its registry entry declares", () => {
    for (const section of PERSON_SECTIONS) {
      expect(SECTION_MOUNTS[section.id].kind).toBe(section.mount);
    }
  });

  it("mounts an owner shared by several sections once per zone", () => {
    expect(sectionOwners(railSections())).toEqual([
      SECTION_MOUNTS["contact-methods"],
      SECTION_MOUNTS.relationships,
      SECTION_MOUNTS["important-dates"],
      SECTION_MOUNTS.addresses,
      SECTION_MOUNTS.work,
      SECTION_MOUNTS.pets,
      SECTION_MOUNTS["food-preferences"],
      SECTION_MOUNTS["first-meeting"],
      SECTION_MOUNTS["stay-in-touch"],
    ]);
    expect(sectionOwners(zoneSections("timeline"))).toEqual([
      SECTION_MOUNTS["life-events"],
      SECTION_MOUNTS.notes,
      SECTION_MOUNTS.calls,
    ]);
    expect(SECTION_MOUNTS.reminders).toBe(SECTION_MOUNTS["stay-in-touch"]);
    expect(SECTION_MOUNTS.debts).toBe(SECTION_MOUNTS.gifts);
  });

  it("mounts the migrated surfaces as islands", async () => {
    expect(TIMELINE_MOUNT.kind).toBe("island");
    expect(await TIMELINE_MOUNT.load()).toBe(mountPersonTimeline);
    expect(RAIL_MOUNT.kind).toBe("island");
    expect(await RAIL_MOUNT.load()).toBe(mountPersonRail);
    expect(SECTION_MOUNTS["identity-summary"].kind).toBe("island");
    expect(await SECTION_MOUNTS["identity-summary"].load()).toBe(
      mountPersonHero,
    );
    expect(SECTION_MOUNTS["life-events"].kind).toBe("island");
    expect(await SECTION_MOUNTS["life-events"].load()).toBe(
      mountPersonLifeEvents,
    );
  });

  it("GAP-029 mounts each profile fact section, and the tags editor, as its own island", async () => {
    const facts = {
      addresses: mountAddresses,
      "contact-methods": mountContactMethods,
      "first-meeting": mountFirstMeeting,
      "food-preferences": mountFoodPreferences,
      pets: mountPets,
      work: mountWork,
    } as const;
    for (const [id, mount] of Object.entries(facts)) {
      const entry = SECTION_MOUNTS[id as keyof typeof facts];
      expect(entry.kind).toBe("island");
      expect(await entry.load()).toBe(mount);
    }
    expect(
      new Set(
        Object.keys(facts).map((id) =>
          SECTION_MOUNTS[id as keyof typeof facts]
        ),
      ).size,
    ).toBe(6);
    expect(TAGS_MOUNT.kind).toBe("island");
    expect(await TAGS_MOUNT.load()).toBe(mountTags);
  });

  it("GAP-029 resolves a fact section with nothing to own at once", async () => {
    const api = stubApi();
    drawShell("");
    await mount("pets", sectionProps());
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("reads a hidden module from the profile the page loaded", () => {
    expect(sectionHidden(props(["notes"]), "notes")).toBe(true);
    expect(sectionHidden(props(["notes"]), "calls")).toBe(false);
    expect(sectionHidden(sectionProps(), "notes")).toBe(false);
  });

  it("hands each vanilla module the arguments it always took", async () => {
    const hidden = props([
      "activities",
      "calls",
      "relationships",
      "tasks",
    ]);
    await mount("important-dates", hidden);
    expect(mountImportantDates).toHaveBeenCalledWith(
      personId,
      workspaceId,
      true,
    );
    await mount("relationships", hidden);
    expect(mountRelationships).toHaveBeenCalledWith(
      personId,
      workspaceId,
      true,
      true,
      revision,
    );
    await mount("reminders", hidden);
    expect(mountPersonReminders).toHaveBeenCalledWith({
      archived: true,
      personId,
      timePreferences: preferences,
      workspaceId,
    });
    await mount("notes", hidden);
    expect(mountPersonInteractions).toHaveBeenCalledWith(
      personId,
      workspaceId,
      true,
      { activities: true, notes: false },
    );
    await mount("calls", hidden);
    expect(mountCommunications).toHaveBeenCalledWith(
      personId,
      workspaceId,
      true,
      { calls: true, conversations: false },
      preferences,
    );
    await mount("tasks", hidden);
    expect(mountTaskSurface).toHaveBeenCalledWith({
      archived: true,
      hidden: true,
      personId,
      timePreferences: preferences,
      workspaceId,
    });
    await mount("photos", hidden);
    expect(mountPersonFiles).toHaveBeenCalledWith({
      archived: true,
      personId,
      workspaceId,
    });
    await mount("audit-summary", hidden);
    expect(mountPersonAuditSummary).toHaveBeenCalledWith(
      personId,
      workspaceId,
      preferences,
    );
    await mount("debts", hidden);
    expect(mountGiftsIsland).toHaveBeenCalledWith({
      archived: true,
      personId,
      workspaceId,
    });
  });
});
