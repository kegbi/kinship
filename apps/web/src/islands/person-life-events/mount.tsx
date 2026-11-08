/**
 * Mounting the life-events card into the person shell (GAP-028, JOURNAL-002). It
 * activates with the Timeline zone, and the zone's settle waits for its first
 * read, as it did for the vanilla module.
 */

import {
  sectionHidden,
  type SectionMount,
  summaryCount,
} from "../../features/person/section-mounts.ts";
import { statusRegion } from "../../features/person/status-region.ts";
import { mountIsland } from "../core/index.ts";
import { PersonLifeEvents } from "./person-life-events.tsx";

export const PERSON_LIFE_EVENTS_ISLAND = "person-life-events";

/**
 * Mounts the island over the life-events card inside `container` and
 * resolves, once the first read has settled, with the function that unmounts
 * it. Without the card there is nothing to own, and it resolves with a no-op.
 */
export const mountPersonLifeEvents: SectionMount = (container, props) => {
  const section = container.querySelector<HTMLElement>(
    "[data-person-life-events]",
  );
  if (!section) return Promise.resolve(() => undefined);
  return new Promise((resolve) => {
    const unmount = mountIsland(
      section,
      PERSON_LIFE_EVENTS_ISLAND,
      <PersonLifeEvents
        archived={props.archived}
        hidden={sectionHidden(props, "life-events")}
        onSettled={() => resolve(unmount)}
        personId={props.personId}
        section={section}
        statusRegion={statusRegion(props)}
        total={summaryCount(props, "life-events")}
        workspaceId={props.workspaceId}
      />,
    );
  });
};
