/**
 * Mounting a profile fact section into the person shell (GAP-029).
 *
 * Six fact sections are rail blocks; tags is the editor beside the hero's
 * tag preview. Each mounts as its own island over the element the shell drew
 * for it, and the rail's first settle waits for each first read, as it did
 * for the vanilla module. The island takes over the element's content but
 * keeps what other owners render into it: a rail block's heading, where the
 * rail island shows the block's count and this island its add control, and
 * the hero's tag preview slot beside the tags editor.
 */

import type { ComponentType } from "react";
import type { ProfileFactSectionId } from "../../../../../../packages/contracts/generated/auth-client.ts";
import { mountIsland } from "../../../islands/core/index.ts";
import {
  type PersonProfile,
  sectionHidden,
  type SectionMount,
} from "../section-mounts.ts";
import type { FactSectionProps } from "./fact-editor.tsx";

/** What a fact section's component receives. */
export interface FactIslandProps extends FactSectionProps {
  /** The profile answer the page loaded. */
  readonly initial?: PersonProfile | undefined;
}

/** The children of a fact section that belong to other owners. */
const KEPT = ":scope > header, :scope > [data-person-tags-slot]";

/**
 * The mount of section `section`, rendered by `Section` as island `island`.
 * Without the section's element there is nothing to own, and it resolves
 * with a no-op.
 */
export function factSectionMount(
  island: string,
  section: ProfileFactSectionId,
  Section: ComponentType<FactIslandProps>,
): SectionMount {
  return (container, props) => {
    const root = container.querySelector<HTMLElement>(
      `[data-profile-fact-section="${section}"]`,
    );
    if (!root) return Promise.resolve(() => undefined);
    const kept = [...root.querySelectorAll<HTMLElement>(KEPT)];
    const heading = kept.find((element) => element.localName === "header");
    // The island draws the add control; the shell's hidden one goes.
    heading?.querySelector("[data-profile-fact-add]")?.remove();
    const counted = props.initial?.summary?.sectionCounts.find((entry) =>
      entry.id === section
    );
    return new Promise((resolve) => {
      const unmount = mountIsland(
        root,
        island,
        <Section
          archived={props.archived}
          heading={heading}
          hidden={sectionHidden(props, section)}
          initial={props.initial}
          onSettled={() => resolve(unmount)}
          personId={props.personId}
          personUpdatedAt={props.initial?.person.updatedAt ?? ""}
          root={root}
          total={counted?.status === "ready" ? counted.count : undefined}
          workspaceId={props.workspaceId}
        />,
      );
      // The first render replaced the element's content; what other owners
      // render into goes back in front of it in the same task.
      root.prepend(...kept);
    });
  };
}
