/**
 * Mounting the calls and conversations cards into the person shell
 * (GAP-031). They activate with the Timeline zone, and the zone's settle
 * waits for their first read, as it did for the vanilla module.
 */

import { mountIsland } from "../../../islands/core/index.ts";
import { sectionHidden, type SectionMount } from "../section-mounts.ts";
import { PersonCommunications } from "./communications.tsx";

export const PERSON_COMMUNICATIONS_ISLAND = "person-communications";

/**
 * Mounts the island over both cards inside `container` and resolves, once
 * the first read has settled, with the function that unmounts it. Without
 * both cards there is nothing to own, and it resolves with a no-op.
 */
export const mountPersonCommunications: SectionMount = (container, props) => {
  const call = container.querySelector<HTMLElement>(
    '[data-communication-kind="call"]',
  );
  const conversation = container.querySelector<HTMLElement>(
    '[data-communication-kind="conversation"]',
  );
  if (!call || !conversation) return Promise.resolve(() => undefined);
  return new Promise((resolve) => {
    // The conversations card renders through a portal, which appends; its
    // shell content goes in the same task as the first commit.
    conversation.replaceChildren();
    const unmount = mountIsland(
      call,
      PERSON_COMMUNICATIONS_ISLAND,
      <PersonCommunications
        archived={props.archived}
        hidden={{
          calls: sectionHidden(props, "calls"),
          conversations: sectionHidden(props, "conversations"),
        }}
        onSettled={() => resolve(unmount)}
        personId={props.personId}
        sections={{ call, conversation }}
        timePreferences={props.preferences}
        workspaceId={props.workspaceId}
      />,
    );
  });
};
