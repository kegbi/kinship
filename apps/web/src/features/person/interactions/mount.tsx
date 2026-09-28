/**
 * Mounting the notes and activities cards into the person shell (GAP-031).
 * They activate with the Timeline zone, and the zone's settle waits for both
 * first reads, as it did for the vanilla module.
 */

import { mountIsland } from "../../../islands/core/index.ts";
import { sectionHidden, type SectionMount } from "../section-mounts.ts";
import { statusRegion } from "../status-region.ts";
import { PersonInteractions } from "./person-interactions.tsx";

export const PERSON_INTERACTIONS_ISLAND = "person-interactions";

/**
 * Mounts the island over both cards inside `container` and resolves, once
 * their first reads have settled, with the function that unmounts it.
 * Without both cards there is nothing to own, and it resolves with a no-op.
 */
export const mountPersonInteractions: SectionMount = (container, props) => {
  const activities = container.querySelector<HTMLElement>(
    '[data-profile-section="activities"]',
  );
  const notes = container.querySelector<HTMLElement>(
    '[data-profile-section="notes"]',
  );
  if (!activities || !notes) return Promise.resolve(() => undefined);
  return new Promise((resolve) => {
    // The notes card renders through a portal, which appends; its shell
    // content goes in the same task as the first commit.
    notes.replaceChildren();
    const unmount = mountIsland(
      activities,
      PERSON_INTERACTIONS_ISLAND,
      <PersonInteractions
        archived={props.archived}
        hidden={{
          activities: sectionHidden(props, "activities"),
          notes: sectionHidden(props, "notes"),
        }}
        onSettled={() => resolve(unmount)}
        personId={props.personId}
        sections={{ activities, notes }}
        statusRegion={statusRegion(props)}
        workspaceId={props.workspaceId}
      />,
    );
  });
};
