/**
 * The profile facts rail's summary (GAP-028): the column heading, and each
 * rail block's count chip and collapsed empty state.
 *
 * Each of the rail's nine blocks has its own owner — the profile fact islands
 * (GAP-029) and the vanilla modules GAP-031 migrates — and each block's body
 * is theirs. What the rail itself shows about
 * them is this island's: it starts from the counts the profile summary
 * already knows (UXD-002B), then folds in each count a block publishes as it
 * loads (`features/person/profile-summary.ts`). A chip renders through a
 * portal into the slot the block's heading reserves for it.
 */

import { useLayoutEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  railCountText,
  type RailSummary,
  type SummaryStore,
} from "../../features/person/profile-summary.ts";
import type { RailSectionId } from "../../features/person/sections.ts";

/** A rail block and the slot in its heading the count chip renders into. */
export interface RailBlock {
  readonly id: RailSectionId;
  readonly section: HTMLElement;
  readonly countSlot: HTMLElement;
}

export interface PersonRailProps {
  readonly blocks: readonly RailBlock[];
  /**
   * The counts the profile answer carried, with every change the blocks
   * published since the mount started listening.
   */
  readonly summary: SummaryStore<RailSummary>;
}

export function PersonRail(props: PersonRailProps) {
  const summary = useSyncExternalStore(
    props.summary.subscribe,
    props.summary.get,
  );

  useLayoutEffect(() => {
    for (const block of props.blocks) {
      if (summary[block.id]?.empty) {
        block.section.setAttribute("data-rail-empty", "true");
      } else block.section.removeAttribute("data-rail-empty");
    }
  }, [props.blocks, summary]);

  return (
    <>
      <h2 id="profile-facts-heading">Profile facts</h2>
      <p>The people, places, and details that matter.</p>
      {props.blocks.map((block) => {
        const text = railCountText(summary[block.id]);
        return createPortal(
          <span
            className="profile-rail-count"
            data-profile-rail-count=""
            hidden={text === undefined}
          >
            {text ?? ""}
          </span>,
          block.countSlot,
          block.id,
        );
      })}
    </>
  );
}
