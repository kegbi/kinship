/**
 * Mounting the rail summary into the person shell (GAP-028). The page mounts
 * it before any rail block loads, so every count a block publishes finds its
 * reader.
 */

import { railSummaryFromProfile } from "../../features/person/profile-summary.ts";
import type { SectionMount } from "../../features/person/section-mounts.ts";
import { RAIL_SECTION_ORDER } from "../../features/person/sections.ts";
import { mountIsland } from "../core/index.ts";
import { PersonRail, type RailBlock } from "./person-rail.tsx";

export const PERSON_RAIL_ISLAND = "person-rail";

/**
 * Mounts the island over the rail's heading inside `container`, with a count
 * chip in every rail block's heading, and resolves with the function that
 * unmounts it. Without the heading there is nothing to own.
 */
export const mountPersonRail: SectionMount = (container, props) => {
  const heading = container.querySelector<HTMLElement>(
    ".profile-facts-heading",
  );
  if (!heading) return Promise.resolve(() => undefined);
  const blocks = RAIL_SECTION_ORDER.flatMap<RailBlock>((id) => {
    const section = container.querySelector<HTMLElement>(
      `[data-profile-section="${id}"]`,
    );
    const countSlot = section?.querySelector<HTMLElement>(
      "[data-rail-count-slot]",
    );
    return section && countSlot ? [{ countSlot, id, section }] : [];
  });
  // A portal appends, so the chips the shell drew go in the same task as the
  // first commit and nothing blank is painted.
  for (const block of blocks) block.countSlot.replaceChildren();
  return Promise.resolve(
    mountIsland(
      heading,
      PERSON_RAIL_ISLAND,
      <PersonRail
        blocks={blocks}
        initial={railSummaryFromProfile(props.initial?.summary)}
      />,
    ),
  );
};
