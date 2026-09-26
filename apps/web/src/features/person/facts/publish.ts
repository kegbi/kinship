/**
 * What a fact section tells the hero and the rail (GAP-029).
 *
 * The rail island shows each block's count chip and collapses an empty
 * block; the hero shows the work and first-meeting vitals and the tag
 * preview. A fact section publishes each of those through
 * `profile-summary.ts` whenever what it shows changes, exactly as the vanilla
 * module did, so the hero and the rail keep their numbers.
 */

import {
  setFirstMeetingPlace,
  setRailCount,
  setRailEmpty,
  setTagPreview,
  setVitalStat,
  tagPreview,
} from "../profile-summary.ts";
import type { FactPublisher } from "./fact-editor.tsx";
import {
  type FactPage,
  factSummary,
  pageShape,
  railPresentation,
  tagNames,
} from "./records.ts";

/** The fact sections that are rail blocks: all but tags. */
export type RailFactSection =
  | "addresses"
  | "contact-methods"
  | "first-meeting"
  | "food-preferences"
  | "pets"
  | "work";

/** A vital the hero shows from a section's records. */
export interface FactVital {
  readonly page: (page: FactPage) => void;
  readonly clear: () => void;
}

/** A rail block's count chip and empty state, and any vital it feeds. */
export function railPublisher(
  section: RailFactSection,
  vital?: FactVital,
): FactPublisher {
  return {
    clear: () => {
      setRailCount(section, undefined);
      setRailEmpty(section, false);
      vital?.clear();
    },
    // A block that failed to read is never shown as empty.
    failed: () => setRailEmpty(section, false),
    page: (page) => {
      const rail = railPresentation(pageShape(page));
      setRailCount(section, rail.count, rail.scope);
      setRailEmpty(section, rail.empty);
      vital?.page(page);
    },
  };
}

/** The hero's work vital: the first role the section lists. */
export const workVital: FactVital = {
  clear: () => setVitalStat("work", undefined),
  page: (page) => {
    const record = page.records.find((entry) => entry.section === "work");
    setVitalStat(
      "work",
      record ? factSummary(record, page.options) : undefined,
    );
  },
};

/** The hero's first-meeting vital, when no date says when it was. */
export const firstMeetingVital: FactVital = {
  clear: () => setFirstMeetingPlace(undefined),
  page: (page) => {
    const record = page.records.find((entry) =>
      entry.section === "first-meeting"
    );
    setFirstMeetingPlace(
      record?.section === "first-meeting" ? record.value.placeText : undefined,
    );
  },
};

/** The hero's tag preview, which hides with the tags module. */
export const tagPublisher: FactPublisher = {
  clear: () => setTagPreview(undefined),
  failed: () => undefined,
  page: (page) => {
    const record = page.records.find((entry) => entry.section === "tags");
    if (record?.section === "tags") {
      setTagPreview(tagPreview(tagNames(record, page.options)));
    }
  },
};
