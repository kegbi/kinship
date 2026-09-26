/**
 * Mounting the person hero into the static shell (GAP-028). The page mounts
 * it as soon as the profile answer arrives and before any section loads, so
 * every vital a section publishes finds its reader.
 */

import {
  sectionHidden,
  type SectionMount,
} from "../../features/person/section-mounts.ts";
import { mountIsland } from "../core/index.ts";
import { type HeroSlots, PersonHero } from "./person-hero.tsx";

export const PERSON_HERO_ISLAND = "person-hero";

function slot(container: HTMLElement, name: string): HTMLElement | undefined {
  return container.querySelector<HTMLElement>(`[${name}]`) ?? undefined;
}

/**
 * The hero's mount, sending a deleted person's page to `navigate` — the
 * browser's location unless a test says otherwise. It mounts the island over
 * the hero inside `container` and resolves with the function that unmounts
 * it. Without the profile answer or the hero's slots there is nothing to
 * own, and it resolves with a no-op.
 */
export const personHeroMount = (
  navigate?: (path: string) => void,
): SectionMount =>
(container, props) => {
  const root = slot(container, "data-person-hero");
  const menu = slot(container, "data-person-menu-slot");
  const vitals = slot(container, "data-person-vitals-slot");
  const tags = slot(container, "data-person-tags-slot");
  const lifecycle = slot(container, "data-person-lifecycle-slot");
  const archived = slot(container, "data-person-archived-slot");
  const profile = props.initial;
  if (
    !root || !menu || !vitals || !tags || !lifecycle || !archived || !profile
  ) {
    return Promise.resolve(() => undefined);
  }
  const slots: HeroSlots = {
    archived,
    lifecycle,
    menu,
    miniAvatar: slot(container, "data-zone-mini-avatar"),
    miniName: slot(container, "data-zone-mini-name"),
    tags,
    vitals,
  };
  // Portals append, so the skeletons the shell drew in each slot go in the
  // same task as the first commit and nothing blank is painted.
  for (const target of Object.values(slots)) target?.replaceChildren();
  return Promise.resolve(
    mountIsland(
      root,
      PERSON_HERO_ISLAND,
      <PersonHero
        archived={props.archived}
        dueInformation={profile.dueInformation}
        identity={profile.person}
        personId={props.personId}
        preferences={props.preferences}
        slots={slots}
        tagsHidden={sectionHidden(props, "tags")}
        workspaceId={props.workspaceId}
        {...(navigate ? { navigate } : {})}
      />,
    ),
  );
};

export const mountPersonHero: SectionMount = personHeroMount();
