/**
 * Mounting the unified timeline into the person shell (GAP-028). The card
 * activates with the Timeline zone, and the zone's settle waits for its
 * first page, as it did for the vanilla module.
 */

import {
  type SectionMount,
  summaryCount,
} from "../../features/person/section-mounts.ts";
import { statusRegion } from "../../features/person/status-region.ts";
import { mountIsland } from "../core/index.ts";
import { PersonTimeline } from "./person-timeline.tsx";

export const PERSON_TIMELINE_ISLAND = "person-timeline";

/** The sections whose records the timeline merges. */
const MERGED = [
  "notes",
  "activities",
  "calls",
  "conversations",
  "life-events",
] as const;

/**
 * Mounts the island over `#person-timeline` inside `container` and resolves,
 * once the first page has settled, with the function that unmounts it.
 * Without the card there is nothing to own, and it resolves with a no-op.
 */
export const mountPersonTimeline: SectionMount = (container, props) => {
  const section = container.matches("#person-timeline")
    ? container
    : container.querySelector<HTMLElement>("#person-timeline");
  if (!section) return Promise.resolve(() => undefined);
  return new Promise((resolve) => {
    const unmount = mountIsland(
      section,
      PERSON_TIMELINE_ISLAND,
      <PersonTimeline
        empty={MERGED.every((id) => summaryCount(props, id) === 0)}
        onSettled={() => resolve(unmount)}
        personId={props.personId}
        preferences={props.preferences}
        section={section}
        statusRegion={statusRegion(props)}
        workspaceId={props.workspaceId}
      />,
    );
  });
};
