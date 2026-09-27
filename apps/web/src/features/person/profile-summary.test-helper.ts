/**
 * Test support: what the vanilla sections have told the rail and hero
 * islands, folded with the islands' own reducers and rendered as the islands
 * render it, so a section's suite asserts what it publishes without mounting
 * React.
 */

import {
  firstMeetingText,
  HERO_FACTS_EVENT,
  type HeroFactChange,
  type HeroFacts,
  heroFactsReducer,
  RAIL_SUMMARY_EVENT,
  railCountText,
  type RailSummary,
  type RailSummaryChange,
  railSummaryReducer,
} from "./profile-summary.ts";
import type { RailSectionId } from "./sections.ts";

export type CapturedVital =
  | "birthday"
  | "deceased"
  | "first-meeting"
  | "last-contact"
  | "next-reminder"
  | "stay-in-touch"
  | "work";

export interface CapturedProfileSummary {
  /** The count chip's text, or `undefined` while it shows none. */
  readonly railCount: (section: RailSectionId) => string | undefined;
  /** Whether the block is collapsed as empty. */
  readonly railEmpty: (section: RailSectionId) => boolean;
  /** A vital as the hero shows it; "" until a section published it. */
  readonly vital: (slot: CapturedVital) => string;
  /** The tag preview's text, or `undefined` while it is hidden. */
  readonly tags: () => string | undefined;
  readonly stop: () => void;
}

const NOT_RECORDED = "Not recorded";

export function captureProfileSummary(): CapturedProfileSummary {
  let rail: RailSummary = {};
  let hero: HeroFacts = { lastContact: "", nextReminder: "", stayInTouch: "" };
  const onRail = (event: Event) => {
    rail = railSummaryReducer(
      rail,
      (event as CustomEvent<RailSummaryChange>).detail,
    );
  };
  const onHero = (event: Event) => {
    hero = heroFactsReducer(
      hero,
      (event as CustomEvent<HeroFactChange>).detail,
    );
  };
  document.addEventListener(RAIL_SUMMARY_EVENT, onRail);
  document.addEventListener(HERO_FACTS_EVENT, onHero);
  return {
    railCount: (section) => railCountText(rail[section]),
    railEmpty: (section) => rail[section]?.empty === true,
    stop: () => {
      document.removeEventListener(RAIL_SUMMARY_EVENT, onRail);
      document.removeEventListener(HERO_FACTS_EVENT, onHero);
    },
    tags: () => {
      const tags = hero.tags;
      if (!tags) return undefined;
      if (tags.names.length === 0) return "No tags saved";
      return tags.names.join("") + (tags.more > 0 ? `+${tags.more} more` : "");
    },
    vital: (slot) => {
      switch (slot) {
        case "birthday":
          return hero.birthday ?? NOT_RECORDED;
        case "deceased":
          return hero.deceased ?? NOT_RECORDED;
        case "work":
          return hero.work ?? NOT_RECORDED;
        case "first-meeting":
          return firstMeetingText(hero) ?? NOT_RECORDED;
        case "last-contact":
          return hero.lastContact;
        case "next-reminder":
          return hero.nextReminder;
        case "stay-in-touch":
          return hero.stayInTouch;
      }
    },
  };
}
