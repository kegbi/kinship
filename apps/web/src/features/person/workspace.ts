/**
 * The person workspace's orchestration (GAP-028, moved here by GAP-033):
 * `/app/people/:personId` as one static shell that this module brings to
 * life. It resolves the session, the member's preferences, and the person;
 * mounts the hero and the rail summary, then each section's owner from the
 * section registry (`sections.ts`, `section-mounts.ts`) as its zone
 * activates; keeps the zone filter and the section navigation, `?section=`
 * and `?view=` deep links, the first-run card, and the page's states; and
 * marks the workspace `data-workspace-settled` once its first sections have
 * answered and its view is recorded (REL-046).
 *
 * It renders no markup of its own: the shell draws every element it shows,
 * and it only toggles, fills, and focuses them — the page states' copy, and
 * the hidden-section notice with its personalization link cloned from the
 * shell's `<template>`.
 */

import {
  getMemberPreferences,
  getPerson,
  type PersonProfileSummary,
  type ProblemDetails,
  recordPersonView,
  saveMemberUiState,
  type SessionContext,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  resolveWorkspaceSession,
  updateCachedSessionUiState,
} from "../../lib/workspace-context.ts";
import { mountUnsavedChangesGuard } from "../../lib/unsaved-changes.ts";
import {
  type FilterZone,
  filterZone,
  navigableSections,
  PERSON_SECTIONS,
  personSection,
  type PersonSectionEntry,
  type PersonSectionId,
  railSections,
  SECTION_HIDDEN_EVENT,
  SECTION_REQUEST_EVENT,
  type SectionMountKind,
  sectionTurnedOff,
  zoneSections,
} from "./sections.ts";
import {
  RAIL_MOUNT,
  SECTION_MOUNTS,
  type SectionMountEntry,
  sectionOwners,
  type SectionProps,
  TAGS_MOUNT,
  TIMELINE_MOUNT,
} from "./section-mounts.ts";
import { SECTION_NOTICE_LINK_TEMPLATE_ID } from "./shell-templates.ts";

/**
 * The page's own elements. The hero, the rail summary, and every section
 * belong to their owners (GAP-028); the page keeps the states, the section
 * navigation, and the zones.
 */
interface ProfileElements {
  readonly ready: HTMLElement;
  readonly sectionNotice: HTMLElement;
  readonly sections: HTMLElement;
  readonly state: HTMLElement;
  /** The state region's heading, detail, and way out, which the shell draws. */
  readonly stateHeading: HTMLElement;
  readonly stateDetail: HTMLElement;
  readonly stateLink: HTMLAnchorElement;
}

export { SECTION_NOTICE_LINK_TEMPLATE_ID };

type ProfileState = "forbidden" | "not-found" | "unavailable";

interface SectionNavigationContext {
  activateZone?: (zone: Zone) => Promise<void>;
  readonly hiddenSectionIds: Set<string>;
  memberRole: SessionContext["member"]["role"];
  readonly zoneFilter?: ZoneFilterContext;
}

type Zone = "timeline" | "planning" | "things" | "admin";
type ZoneView = Zone | "all";

interface ZoneFilterContext {
  activate?: (zone: Zone) => Promise<void>;
  readonly buttons: readonly HTMLButtonElement[];
  workspaceId?: string;
  readonly zones: readonly HTMLElement[];
}

interface ZoneRegistry {
  readonly activate: (zone: Zone) => Promise<void>;
  /**
   * Mounts the page's summaries — the hero island, which owns the identity
   * section, and the rail summary — before any section, so every vital and
   * count a section publishes finds its reader.
   */
  readonly mountSummaries: () => Promise<void>;
  /**
   * Mounts the rail's owners, and the tags editor beside the hero, now; each
   * owner mounts once per page.
   */
  readonly mountRail: () => Promise<void>;
  readonly settled: () => Promise<void>;
}

type SectionOwner = SectionMountEntry<SectionMountKind>;

/** The filter zone `id`'s section belongs to, when `id` names a section. */
function sectionFilterZone(id: string | null): FilterZone | undefined {
  const entry = personSection(id);
  return entry ? filterZone(entry) : undefined;
}

function currentView(): ZoneView {
  const view = new URLSearchParams(globalThis.location.search).get("view");
  return view === "timeline" || view === "planning" || view === "things" ||
      view === "admin"
    ? view
    : "all";
}

function shouldShowPersonFirstRun(
  summary: PersonProfileSummary | undefined,
  status: "archived" | "ready",
): boolean {
  if (!summary) return false;
  const requestedSection = currentSection();
  // Accepted boundary: sectionCounts omits important dates, gifts, debts,
  // documents, photos, and reminders without a next occurrence because it is
  // also the personalization key set; the per-visit exit keeps them reachable.
  return summary.sectionCounts.every((entry) =>
    entry.status === "hidden" || entry.count === 0
  ) && !summary.stayInTouchAt && !summary.nextReminderAt &&
    status !== "archived" && currentView() === "all" &&
    (!requestedSection ||
      sectionFilterZone(requestedSection) === "facts");
}

function showPersonFirstRun(): void {
  const card = document.querySelector<HTMLElement>("#person-first-run");
  if (!card) return;
  card.hidden = false;
  const switcher = document.querySelector<HTMLElement>(".zone-switcher");
  if (switcher) switcher.hidden = true;
  for (const zone of document.querySelectorAll<HTMLElement>("[data-zone]")) {
    zone.hidden = true;
  }
}

function exitPersonFirstRun(): boolean {
  const card = document.querySelector<HTMLElement>("#person-first-run");
  if (!card || card.hidden) return false;
  card.hidden = true;
  const switcher = document.querySelector<HTMLElement>(".zone-switcher");
  if (switcher) switcher.hidden = false;
  for (const zone of document.querySelectorAll<HTMLElement>("[data-zone]")) {
    zone.hidden = false;
  }
  return true;
}

function applyZoneView(filter: ZoneFilterContext, view: ZoneView): void {
  for (const button of filter.buttons) {
    const selected = button.dataset.zoneFilter === view;
    button.setAttribute("aria-pressed", String(selected));
  }
  for (const zone of filter.zones) {
    zone.hidden = view !== "all" && zone.dataset.zone !== view;
  }
}

function selectZone(filter: ZoneFilterContext, view: ZoneView): void {
  exitPersonFirstRun();
  applyZoneView(filter, view);
  if (view !== "all") void filter.activate?.(view);
  const url = new URL(globalThis.location.href);
  url.searchParams.set("view", view);
  globalThis.history.pushState({}, "", url);
  if (!filter.workspaceId) return;
  void saveMemberUiState({ personWorkspaceView: view }, filter.workspaceId)
    .then(
      (result) => {
        if (result.ok) updateCachedSessionUiState(result.value.uiState);
      },
    ).catch(() => undefined);
}

function mountZoneFilter(): ZoneFilterContext | undefined {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(
    "[data-zone-filter]",
  )];
  const zones = [...document.querySelectorAll<HTMLElement>("[data-zone]")];
  if (buttons.length === 0 || zones.length === 0) return undefined;
  const filter = { buttons, zones };
  applyZoneView(filter, currentView());
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const view = button.dataset.zoneFilter;
      if (
        view === "all" || view === "timeline" || view === "planning" ||
        view === "things" || view === "admin"
      ) selectZone(filter, view);
    });
  }
  return filter;
}

function mountZoneMiniIdentity(): void {
  const hero = document.querySelector<HTMLElement>(".person-profile-hero");
  const mini = document.querySelector<HTMLElement>(
    "[data-zone-mini-identity]",
  );
  if (!hero || !mini || typeof globalThis.IntersectionObserver !== "function") {
    return;
  }
  const observer = new IntersectionObserver(([entry]) => {
    mini.hidden = entry?.isIntersecting !== false;
  });
  observer.observe(hero);
}

/**
 * The sections of `sections` the workspace shows: a section whose profile
 * module is turned off is neither drawn nor mounted (GAP-047).
 */
function shownSections<Id extends PersonSectionId>(
  sections: readonly PersonSectionEntry<Id>[],
  hidden: ReadonlySet<string>,
): readonly PersonSectionEntry<Id>[] {
  return sections.filter((entry) => !sectionTurnedOff(entry, hidden));
}

/**
 * The owners a stream zone activates: its shown sections' owners, in order.
 * The unified timeline card heads the Timeline zone while any of its
 * sections is shown.
 */
function zoneOwners(
  zone: Zone,
  hidden: ReadonlySet<string>,
): readonly SectionOwner[] {
  const sections = shownSections(zoneSections(zone), hidden);
  return [
    ...(zone === "timeline" && sections.length > 0 ? [TIMELINE_MOUNT] : []),
    ...sectionOwners(sections),
  ];
}

/**
 * Takes every section the workspace turned off out of the page before any
 * owner mounts (GAP-047): its card is hidden and says so, so neither the
 * reader nor assistive technology meets an empty card.
 */
function hideTurnedOffSections(hidden: ReadonlySet<string>): void {
  for (const entry of PERSON_SECTIONS) {
    if (!sectionTurnedOff(entry, hidden)) continue;
    const card = section(entry.id);
    if (!card) continue;
    card.hidden = true;
    card.setAttribute("data-section-state", "hidden");
    card.removeAttribute("aria-busy");
  }
}

/**
 * Activates zones from the section registry (GAP-028). An owner shared by
 * several sections, or by the rail and a zone, mounts once however many of
 * them ask for it.
 */
function createZoneRegistry(
  mountOwner: (owner: SectionOwner) => Promise<void>,
  hidden: ReadonlySet<string>,
): ZoneRegistry {
  const owners = new Map<SectionOwner, Promise<void>>();
  const activations = new Map<Zone, Promise<void>>();
  const mount = (owner: SectionOwner): Promise<void> => {
    let mounted = owners.get(owner);
    if (!mounted) {
      mounted = Promise.resolve().then(() => mountOwner(owner));
      owners.set(owner, mounted);
    }
    return mounted;
  };
  const activate = (zone: Zone): Promise<void> => {
    let activation = activations.get(zone);
    if (!activation) {
      activation = Promise.all(zoneOwners(zone, hidden).map(mount)).then(() =>
        undefined
      ).finally(() => {
        document.querySelector<HTMLElement>(`[data-zone="${zone}"]`)
          ?.removeAttribute("aria-busy");
      });
      activations.set(zone, activation);
    }
    return activation;
  };
  return {
    activate,
    mountSummaries: () =>
      Promise.all([
        mount(SECTION_MOUNTS["identity-summary"]),
        mount(RAIL_MOUNT),
      ]).then(() => undefined),
    mountRail: () =>
      Promise.all(
        [...sectionOwners(shownSections(railSections(), hidden)), TAGS_MOUNT]
          .map(mount),
      ).then(() => undefined),
    settled: () => Promise.all(activations.values()).then(() => undefined),
  };
}

function mountZoneVisibilityActivation(
  activate: (zone: Zone) => Promise<void>,
): void {
  const zones = [...document.querySelectorAll<HTMLElement>("[data-zone]")]
    .flatMap<{ readonly element: HTMLElement; readonly zone: Zone }>(
      (element) => {
        const zone = element.dataset.zone;
        return zone === "timeline" || zone === "planning" ||
            zone === "things" ||
            zone === "admin"
          ? [{ element, zone }]
          : [];
      },
    );
  if (typeof globalThis.IntersectionObserver !== "function") {
    for (const { zone } of zones) void activate(zone);
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const observed of entries) {
      if (!observed.isIntersecting) continue;
      const match = zones.find(({ element }) => element === observed.target);
      if (!match) continue;
      observer.unobserve(match.element);
      void activate(match.zone);
    }
  }, { rootMargin: "400px" });
  for (const { element } of zones) observer.observe(element);
}

function promoteSectionStatusRegions(): void {
  for (
    const state of document.querySelectorAll<HTMLElement>(
      '.section-state:not(#person-lifecycle-status):not([role="alert"])',
    )
  ) {
    state.setAttribute("role", "status");
    state.setAttribute("aria-live", "polite");
  }
}

function afterFirstPaint(): Promise<void> {
  return new Promise((resolve) => {
    const painted = () => globalThis.setTimeout(resolve, 0);
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(painted);
      return;
    }
    painted();
  });
}

/** Records the view once the page is idle; resolves when that has answered. */
function deferPersonView(personId: string, workspaceId: string): Promise<void> {
  return new Promise((resolve) => {
    const record = () => {
      void recordPersonView(personId, workspaceId).catch(() => undefined)
        .finally(resolve);
    };
    if (typeof globalThis.requestIdleCallback === "function") {
      globalThis.requestIdleCallback(record);
      return;
    }
    globalThis.setTimeout(record, 0);
  });
}

function elements(): ProfileElements | undefined {
  const ready = document.querySelector<HTMLElement>("#person-profile-ready");
  const sectionNotice = document.querySelector<HTMLElement>(
    "#person-profile-section-notice",
  );
  const sections = document.querySelector<HTMLElement>(
    "#person-profile-sections",
  );
  const state = document.querySelector<HTMLElement>("#person-profile-state");
  const stateHeading = state?.querySelector<HTMLElement>(
    "[data-profile-state-heading]",
  );
  const stateDetail = state?.querySelector<HTMLElement>(
    "[data-profile-state-detail]",
  );
  const stateLink = state?.querySelector<HTMLAnchorElement>(
    "[data-profile-state-link]",
  );
  return ready && sectionNotice && sections && state && stateHeading &&
      stateDetail && stateLink
    ? {
      ready,
      sectionNotice,
      sections,
      state,
      stateDetail,
      stateHeading,
      stateLink,
    }
    : undefined;
}

/** The person's heading, which the hero island renders once it mounts. */
function heading(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>("#person-profile-name") ??
    undefined;
}

function personId(): string | undefined {
  return /^\/app\/people\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i
    .exec(globalThis.location.pathname)?.[1];
}

function renderState(profile: ProfileElements, state: ProfileState): void {
  const copy = {
    forbidden: {
      detail:
        "Your current session or active workspace does not permit this view.",
      heading: "Person unavailable",
      link: "/app",
      linkLabel: "Return to Today",
    },
    "not-found": {
      detail:
        "This person does not exist in the active workspace, or is no longer available.",
      heading: "Person not found",
      link: "/app/people",
      linkLabel: "Return to people",
    },
    unavailable: {
      detail:
        "Kinship could not load this person workspace. Your saved data has not changed.",
      heading: "Person temporarily unavailable",
      link: globalThis.location.pathname + globalThis.location.search,
      linkLabel: "Try again",
    },
  }[state];
  profile.ready.removeAttribute("aria-busy");
  profile.ready.hidden = true;
  profile.state.hidden = false;
  profile.stateHeading.textContent = copy.heading;
  profile.stateDetail.textContent = copy.detail;
  profile.stateLink.href = copy.link;
  profile.stateLink.textContent = copy.linkLabel;
  profile.state.focus();
}

function section(id: string | null): HTMLElement | undefined {
  if (!id) return undefined;
  return [...document.querySelectorAll<HTMLElement>("[data-profile-section]")]
    .find((candidate) => candidate.dataset.profileSection === id);
}

function sectionLink(
  profile: ProfileElements,
  id: string,
): HTMLAnchorElement | undefined {
  return [...profile.sections.querySelectorAll<HTMLAnchorElement>(
    "[data-section-link]",
  )].find((link) => link.dataset.sectionLink === id);
}

function clearCurrentSection(profile: ProfileElements): void {
  for (
    const link of profile.sections.querySelectorAll<HTMLAnchorElement>(
      "[data-section-link]",
    )
  ) {
    link.removeAttribute("aria-current");
  }
}

function clearSectionNotice(profile: ProfileElements): void {
  profile.sectionNotice.hidden = true;
  delete profile.sectionNotice.dataset.sectionNotice;
  profile.sectionNotice.replaceChildren();
}

function showHiddenSectionNotice(
  profile: ProfileElements,
  id: string,
  link: HTMLAnchorElement,
  memberRole: SessionContext["member"]["role"],
): void {
  const title = link.textContent!.trim();
  profile.sectionNotice.replaceChildren(
    `${title} — this section is hidden in this workspace.`,
  );
  if (memberRole === "owner" || memberRole === "admin") {
    const template = document.getElementById(SECTION_NOTICE_LINK_TEMPLATE_ID);
    if (template instanceof HTMLTemplateElement) {
      profile.sectionNotice.append(
        " ",
        document.importNode(template.content, true),
      );
    }
  } else {
    profile.sectionNotice.append(
      " A workspace owner or admin can turn this section back on.",
    );
  }
  profile.sectionNotice.dataset.sectionNotice = id;
  profile.sectionNotice.hidden = false;
}

/**
 * Shows a link for each section the page drew and the workspace shows, and
 * none for any other (GAP-047): the navigation never links to a section that
 * is turned off or not on the page.
 */
function renderSectionNavigation(
  profile: ProfileElements,
  hiddenSectionIds: ReadonlySet<string>,
): void {
  const rendered = new Set(
    [...document.querySelectorAll<HTMLElement>("[data-profile-section]")]
      .map((candidate) => candidate.dataset.profileSection!),
  );
  const linked = new Set<string>(
    navigableSections(rendered, hiddenSectionIds).map((entry) => entry.id),
  );
  for (
    const link of profile.sections.querySelectorAll<HTMLAnchorElement>(
      "[data-section-link]",
    )
  ) {
    link.closest<HTMLElement>("li")!.hidden = !linked.has(
      link.dataset.sectionLink!,
    );
  }
}

function hasMeaningfulInteractiveFocus(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.isConnected &&
    active.matches(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"]',
    );
}

function activateSectionZone(
  navigation: SectionNavigationContext,
  id: string | null,
): Zone | undefined {
  if (
    !id || navigation.hiddenSectionIds.has(id)
  ) return undefined;
  const zone = sectionFilterZone(id);
  if (zone === undefined || zone === "facts") return undefined;
  if (exitPersonFirstRun() && navigation.zoneFilter) {
    applyZoneView(navigation.zoneFilter, currentView());
  }
  void navigation.activateZone?.(zone);
  if (!navigation.zoneFilter) return undefined;
  const targetZone = navigation.zoneFilter.zones.find((candidate) =>
    candidate.dataset.zone === zone
  );
  if (!targetZone?.hidden) return undefined;
  applyZoneView(navigation.zoneFilter, zone);
  return zone;
}

/**
 * Why the page moves to a section (REL-045). The reader `navigate`s: the
 * section glides into place (asked for here, since the document itself never
 * scrolls smoothly, REL-046), or jumps for a reader who prefers reduced motion.
 * The page `load`s a deep link: it jumps there, so no animation is still
 * running when the reader reaches for the section's controls. Every zone has
 * `settle`d: the reader may already be pressing something, so their focus
 * stays, a section they can see stays where it is, and one that drifted out of
 * view jumps back.
 */
type SectionPlacement = "navigate" | "load" | "settle";

function focusSection(
  profile: ProfileElements,
  navigation: SectionNavigationContext,
  id: string | null,
  placement: SectionPlacement = "navigate",
  replaceActivatedView = false,
): boolean {
  const preserveInteractiveFocus = placement === "settle";
  const activatedZone = activateSectionZone(navigation, id);
  if (activatedZone && replaceActivatedView) {
    const url = new URL(globalThis.location.href);
    url.searchParams.set("view", activatedZone);
    globalThis.history.replaceState({}, "", url);
  }
  const target = section(id);
  if (!target) {
    clearSectionNotice(profile);
    return false;
  }
  const link = sectionLink(profile, id!)!;
  if (navigation.hiddenSectionIds.has(id!)) {
    clearCurrentSection(profile);
    if (profile.sectionNotice.dataset.sectionNotice !== id) {
      showHiddenSectionNotice(profile, id!, link, navigation.memberRole);
    }
    if (preserveInteractiveFocus && hasMeaningfulInteractiveFocus()) {
      return true;
    }
    profile.sectionNotice.focus({ preventScroll: true });
    return true;
  }
  clearSectionNotice(profile);
  if (id === "identity-summary") {
    const editOpen = document.querySelector<HTMLButtonElement>(
      "#person-edit-open",
    );
    if (!editOpen || editOpen.hidden || editOpen.disabled) return false;
    for (
      const candidate of profile.sections.querySelectorAll<HTMLAnchorElement>(
        "[data-section-link]",
      )
    ) {
      if (candidate === link) {
        candidate.setAttribute("aria-current", "location");
      } else {
        candidate.removeAttribute("aria-current");
      }
    }
    if (preserveInteractiveFocus && hasMeaningfulInteractiveFocus()) {
      return true;
    }
    editOpen.click();
    return true;
  }
  if (target.hidden) return false;
  for (
    const candidate of profile.sections.querySelectorAll<HTMLAnchorElement>(
      "[data-section-link]",
    )
  ) {
    if (candidate === link) {
      candidate.setAttribute("aria-current", "location");
    } else {
      candidate.removeAttribute("aria-current");
    }
  }
  if (preserveInteractiveFocus && hasMeaningfulInteractiveFocus()) return true;
  if (placement === "navigate") {
    target.scrollIntoView?.({
      behavior: prefersReducedMotion() ? "instant" : "smooth",
      block: "start",
    });
  } else if (placement === "load" || !inViewport(target)) {
    target.scrollIntoView?.({ behavior: "instant", block: "start" });
  }
  target.focus({ preventScroll: true });
  return true;
}

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
    false;
}

/** Whether any of `element` is inside the viewport. */
function inViewport(element: HTMLElement): boolean {
  const { bottom, height, top } = element.getBoundingClientRect();
  return height > 0 && bottom > 0 && top < globalThis.innerHeight;
}

function currentSection(): string | null {
  return new URLSearchParams(globalThis.location.search).get("section");
}

function reconcileSectionLocation(
  profile: ProfileElements,
  navigation: SectionNavigationContext,
  placement: "navigate" | "settle" = "navigate",
): void {
  if (focusSection(profile, navigation, currentSection(), placement)) return;
  clearCurrentSection(profile);
  if (placement === "settle" && hasMeaningfulInteractiveFocus()) return;
  heading()?.focus({ preventScroll: true });
}

function mountSectionNavigation(
  profile: ProfileElements,
  navigation: SectionNavigationContext,
  signal: AbortSignal,
): void {
  const directory = profile.sections.closest("details");
  directory?.addEventListener("toggle", () => {
    if (directory.open) {
      directory.closest(".person-workspace-navigation")?.scrollIntoView({
        block: "start",
        behavior: "instant",
      });
    }
  });
  profile.sections.addEventListener("click", (event) => {
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
      "[data-section-link]",
    );
    const id = link?.dataset.sectionLink;
    if (!link || !id || !section(id)) return;
    event.preventDefault();
    const url = new URL(globalThis.location.href);
    url.searchParams.set("section", id);
    const zone = sectionFilterZone(id);
    const view = currentView();
    if (
      view !== "all" && zone !== undefined && zone !== "facts" && zone !== view
    ) {
      url.searchParams.set("view", zone);
    }
    globalThis.history.pushState({}, "", url);
    if (directory) directory.open = false;
    focusSection(profile, navigation, id);
  });
  // The hero asks for a section in a view — Audit history in Admin.
  document.addEventListener(SECTION_REQUEST_EVENT, (event) => {
    const detail = (event as CustomEvent<{
      readonly sectionId?: unknown;
      readonly view?: unknown;
    }>).detail;
    const sectionId = detail?.sectionId;
    const view = detail?.view;
    if (
      typeof sectionId !== "string" ||
      (view !== "timeline" && view !== "planning" && view !== "things" &&
        view !== "admin")
    ) return;
    const url = new URL(globalThis.location.href);
    url.searchParams.set("section", sectionId);
    url.searchParams.set("view", view);
    if (navigation.zoneFilter) applyZoneView(navigation.zoneFilter, view);
    globalThis.history.pushState({}, "", url);
    focusSection(profile, navigation, sectionId);
  }, { signal });
  // An owner that finds its module turned off since the page loaded reports
  // it, and the section is hidden from navigation like any other (GAP-028).
  document.addEventListener(SECTION_HIDDEN_EVENT, (event) => {
    const sectionId = (event as CustomEvent<{ readonly sectionId?: unknown }>)
      .detail?.sectionId;
    if (typeof sectionId !== "string") return;
    navigation.hiddenSectionIds.add(sectionId);
    renderSectionNavigation(profile, navigation.hiddenSectionIds);
  }, { signal });
  globalThis.addEventListener("popstate", () => {
    if (navigation.zoneFilter) {
      const view = currentView();
      applyZoneView(navigation.zoneFilter, view);
      if (view !== "all") void navigation.activateZone?.(view);
    }
    reconcileSectionLocation(profile, navigation);
  }, { signal });
}

const FIRST_RUN_ACTIONS = {
  "first-meeting": {
    control: '[data-profile-section="first-meeting"] [data-profile-fact-add]',
    section: "first-meeting",
  },
  "important-dates": {
    control: "#important-date-add",
    section: "important-dates",
  },
  "stay-in-touch": {
    control: '[data-cadence-form] input[name="intervalCount"]',
    section: "stay-in-touch",
  },
} as const;

function mountPersonFirstRunActions(
  profile: ProfileElements,
  navigation: SectionNavigationContext,
  eagerRail: Promise<unknown>,
): void {
  document.querySelector<HTMLButtonElement>("[data-first-run-dismiss]")
    ?.addEventListener("click", exitPersonFirstRun);
  for (
    const button of document.querySelectorAll<HTMLButtonElement>(
      "[data-first-run-action]",
    )
  ) {
    button.addEventListener("click", async () => {
      const action = button.dataset.firstRunAction;
      if (!action || !(action in FIRST_RUN_ACTIONS)) return;
      const target =
        FIRST_RUN_ACTIONS[action as keyof typeof FIRST_RUN_ACTIONS];
      focusSection(profile, navigation, target.section);
      await eagerRail;
      const control = document.querySelector<
        HTMLButtonElement | HTMLInputElement
      >(target.control);
      if (
        !control || control.hidden || control.disabled ||
        control.closest("[hidden]")
      ) return;
      if (control instanceof HTMLButtonElement) control.click();
      else control.focus();
    });
  }
}

/**
 * Shows the resolved workspace: navigation without the sections the
 * workspace turned off, the ready region, and focus on the requested section
 * or the person's heading.
 */
function renderReady(
  profile: ProfileElements,
  navigation: SectionNavigationContext,
): void {
  // The tags editor belongs to its section; the page hides a turned-off
  // module's editor before it loads, as the hero hides its preview.
  const tags = document.querySelector<HTMLElement>(
    '[data-profile-fact-section="tags"]',
  );
  if (tags) tags.hidden = navigation.hiddenSectionIds.has("tags");
  renderSectionNavigation(profile, navigation.hiddenSectionIds);
  profile.state.hidden = true;
  profile.ready.hidden = false;
  profile.ready.removeAttribute("aria-busy");
  if (!focusSection(profile, navigation, currentSection(), "load", true)) {
    heading()?.focus();
  }
}

function problemState(problem: ProblemDetails): ProfileState {
  if (problem.status === 404) return "not-found";
  if (problem.status === 401 || problem.status === 403) return "forbidden";
  return "unavailable";
}

let profileAbort: AbortController | undefined;

/** Brings the person workspace the shell drew to life; see the top of this file. */
export async function mountPersonWorkspace(): Promise<void> {
  const profile = elements();
  if (!profile) return;
  // The hero and the rail summary show first; their code loads while the
  // session and the person do.
  void SECTION_MOUNTS["identity-summary"].load().catch(() => undefined);
  void RAIL_MOUNT.load().catch(() => undefined);
  const zoneFilter = mountZoneFilter();
  mountZoneMiniIdentity();
  const id = personId();
  if (!id) {
    renderState(profile, "not-found");
    return;
  }
  const hiddenSectionIds = new Set<string>();
  const sectionNavigation: SectionNavigationContext = {
    hiddenSectionIds,
    memberRole: "member",
    ...(zoneFilter ? { zoneFilter } : {}),
  };
  // A remounted workspace retires the previous mount's page listeners.
  profileAbort?.abort();
  profileAbort = new AbortController();
  const { signal } = profileAbort;
  mountSectionNavigation(profile, sectionNavigation, signal);
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") {
    renderState(
      profile,
      session.status === "access-lost" ? "forbidden" : "unavailable",
    );
    return;
  }
  const workspaceId = session.session.workspace.id;
  if (zoneFilter) zoneFilter.workspaceId = workspaceId;
  const storedView = session.session.uiState?.personWorkspaceView;
  if (
    !new URLSearchParams(globalThis.location.search).has("view") &&
    storedView && storedView !== "all"
  ) {
    const url = new URL(globalThis.location.href);
    url.searchParams.set("view", storedView);
    globalThis.history.replaceState({}, "", url);
    if (zoneFilter) applyZoneView(zoneFilter, storedView);
  }
  const preferences = await getMemberPreferences(workspaceId)
    .catch(() => undefined);
  const memberPreferences = preferences?.ok
    ? preferences.value.preferences
    : undefined;
  const result = await getPerson(id, workspaceId, "summary").catch(() =>
    undefined
  );
  if (!result) {
    renderState(profile, "unavailable");
    return;
  }
  if (!result.ok) {
    renderState(profile, problemState(result.problem));
    return;
  }
  const profileAnswer = result.value;
  if (shouldShowPersonFirstRun(profileAnswer.summary, profileAnswer.status)) {
    showPersonFirstRun();
  }
  for (const section of profileAnswer.person.profileSections ?? []) {
    if (section.status === "hidden") {
      hiddenSectionIds.add(section.id);
    }
  }
  sectionNavigation.memberRole = session.session.member.role;
  // The hero announces every lifecycle change; each owner mounted later
  // receives the archived state current when it mounts (REL-021).
  let archived = profileAnswer.status === "archived";
  document.addEventListener("person-lifecycle-changed", (event) => {
    const detail = (event as CustomEvent<{
      readonly archived?: unknown;
      readonly personId?: unknown;
    }>).detail;
    if (detail?.personId === id && typeof detail.archived === "boolean") {
      archived = detail.archived;
    }
  }, { signal });
  const sectionProps = (): SectionProps => ({
    archived,
    initial: profileAnswer,
    personId: id,
    preferences: memberPreferences,
    workspaceId,
  });
  hideTurnedOffSections(hiddenSectionIds);
  const zoneRegistry = createZoneRegistry(
    (owner) =>
      owner.load().then((mount) => mount(profile.ready, sectionProps())).then(
        () => undefined,
      ),
    hiddenSectionIds,
  );
  // A summary whose code cannot load leaves its skeleton, and every section
  // still loads.
  await zoneRegistry.mountSummaries().catch(() => undefined);
  const { activate } = zoneRegistry;
  sectionNavigation.activateZone = activate;
  if (zoneFilter) zoneFilter.activate = activate;
  const selectedView = currentView();
  if (selectedView !== "all") void activate(selectedView);
  mountZoneVisibilityActivation(activate);
  renderReady(profile, sectionNavigation);
  mountUnsavedChangesGuard({
    confirmMessage:
      "You have unsaved changes on this person. Discard them and switch workspaces?",
    root: profile.ready,
  });
  const viewRecorded = deferPersonView(id, workspaceId);
  const eagerRail = zoneRegistry.mountRail().finally(() => {
    document.querySelector<HTMLElement>(".profile-facts-rail")
      ?.removeAttribute("aria-busy");
    document.querySelector<HTMLElement>(
      '[data-profile-fact-section="tags"]',
    )?.removeAttribute("aria-busy");
  });
  mountPersonFirstRunActions(profile, sectionNavigation, eagerRail);
  await Promise.all([eagerRail, afterFirstPaint()]);
  await zoneRegistry.settled();
  promoteSectionStatusRegions();
  reconcileSectionLocation(profile, sectionNavigation, "settle");
  // REL-046: the workspace has nothing left in flight once its first sections
  // have answered and its view is recorded. Leaving earlier cancels those
  // requests, which on Linux WebKit left the next page's requests unanswered.
  void viewRecorded.then(() =>
    profile.ready.setAttribute("data-workspace-settled", "")
  );
}
