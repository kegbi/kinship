/**
 * Mounting the gifts and debts island into the person profile shell.
 *
 * The shell is static, so the person and workspace arrive at runtime and the
 * cards activate with their zone. `features/person/workspace.ts` mounts it in
 * the "things" zone exactly where it registered the vanilla module, and the
 * zone's settle waits for the first list answer as it did before.
 */

import { statusRegion } from "../../features/person/status-region.ts";
import { mountIsland } from "../core/index.ts";
import { PersonGifts } from "./person-gifts.tsx";

export const PERSON_GIFTS_ISLAND = "person-gifts";

/**
 * Mounts the island over both cards and resolves, once the first list answer
 * has settled, with the function that unmounts it. Without both cards there
 * is nothing to own, and it resolves with a no-op.
 */
export function mountGiftsIsland(options: {
  readonly archived: boolean;
  readonly personId: string;
  readonly workspaceId: string;
  /** Whether the profile already promoted its state lines (REL-052). */
  readonly statesLive?: (() => boolean) | undefined;
}): Promise<() => void> {
  const gift = document.querySelector<HTMLElement>(
    '[data-person-gifts="gift"]',
  );
  const debt = document.querySelector<HTMLElement>(
    '[data-person-gifts="debt"]',
  );
  if (!gift || !debt) return Promise.resolve(() => undefined);
  return new Promise((resolve) => {
    // The debt card renders through a portal, which appends; its skeleton
    // goes in the same task as the first commit, so nothing blank is painted.
    debt.replaceChildren();
    const unmount = mountIsland(
      gift,
      PERSON_GIFTS_ISLAND,
      <PersonGifts
        archived={options.archived}
        onSettled={() => resolve(unmount)}
        personId={options.personId}
        sections={{ debt, gift }}
        statusRegion={statusRegion(options)}
        workspaceId={options.workspaceId}
      />,
    );
  });
}
