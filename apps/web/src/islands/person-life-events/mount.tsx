/**
 * Mounting the life-events card into the person shell (GAP-028). It
 * activates with the Timeline zone, and the zone's settle waits for its first
 * read, as it did for the vanilla module.
 */

import {
  sectionHidden,
  type SectionMount,
} from "../../features/person/section-mounts.ts";
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
        hidden={sectionHidden(props, "life-events")}
        onSettled={() => resolve(unmount)}
        personId={props.personId}
        section={section}
        workspaceId={props.workspaceId}
      />,
    );
  });
};
