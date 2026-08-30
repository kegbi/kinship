import {
  archivePerson,
  deletePerson,
  editPerson,
  getPerson,
  getPersonDeletionImpact,
  type PersonDueInformation,
  type PersonIdentity,
  type PersonProfileIdentity,
  type PersonProfileSummary,
  type ProblemDetails,
  recordPersonView,
  restorePerson,
  type SessionContext,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";
import { mountImportantDates } from "./important-dates.ts";
import { mountProfileFacts } from "./profile-facts.ts";
import { mountRelationships } from "./relationships.ts";
import { mountPersonInteractions } from "./interactions.ts";
import { mountCommunications } from "./communications.ts";
import { mountPersonAuditSummary } from "./audit-history.ts";
import { mountTaskSurface } from "./tasks.ts";
import { mountPersonReminders } from "./reminders.ts";
import { mountPersonFiles } from "./person-files.ts";
import { mountPersonGifts } from "./person-gifts.ts";
import { mountPersonLifeEvents } from "./person-life-events.ts";
import {
  type PersonFactRailSectionId,
  setFirstMeetingDate,
  setFirstMeetingPlace,
  setRailCount,
  setRailEmpty,
  setVitalStat,
} from "./person-facts-rail.ts";
import { showToast } from "./toasts.ts";
import { mountUnsavedChangesGuard } from "./unsaved-changes.ts";

interface ProfileElements {
  readonly archived: HTMLElement;
  readonly archivedBanner: HTMLElement;
  readonly avatar: HTMLElement;
  readonly breadcrumbName: HTMLElement;
  readonly deceased: HTMLElement;
  readonly description: HTMLElement;
  readonly due: HTMLElement;
  readonly favorite: HTMLElement;
  readonly heading: HTMLElement;
  readonly nickname: HTMLElement;
  readonly partial: HTMLElement;
  readonly ready: HTMLElement;
  readonly sectionNotice: HTMLElement;
  readonly sections: HTMLElement;
  readonly self: HTMLElement;
  readonly state: HTMLElement;
  readonly tags: HTMLUListElement;
  readonly tagsContainer: HTMLElement;
}

type ProfileState = "forbidden" | "not-found" | "unavailable";

interface SectionNavigationContext {
  activateZone?: (zone: Zone) => Promise<void>;
  readonly hiddenSectionIds: ReadonlySet<string>;
  memberRole: SessionContext["member"]["role"];
  readonly zoneFilter?: ZoneFilterContext;
}

type Zone = "timeline" | "planning" | "things" | "admin";
type ZoneView = Zone | "all";

interface ZoneFilterContext {
  activate?: (zone: Zone) => Promise<void>;
  readonly buttons: readonly HTMLButtonElement[];
  readonly zones: readonly HTMLElement[];
}

interface ZoneRegistry {
  readonly activate: (zone: Zone) => Promise<void>;
  readonly register: (zone: Zone, mount: () => Promise<void>) => void;
  readonly settled: () => Promise<void>;
}

interface ZoneRegistryEntry {
  activation?: Promise<void>;
  readonly mounts: Array<() => Promise<void>>;
}

interface LifecycleElements {
  readonly archive: HTMLButtonElement;
  readonly deleteCancel: HTMLButtonElement;
  readonly deleteConfirm: HTMLButtonElement;
  readonly deleteDialog: HTMLDialogElement;
  readonly deleteForm: HTMLFormElement;
  readonly deleteInput: HTMLInputElement;
  readonly deleteMessage: HTMLElement;
  readonly deleteOpen: HTMLButtonElement;
  readonly editCancel: HTMLButtonElement;
  readonly editForm: HTMLFormElement;
  readonly editOpen: HTMLButtonElement;
  readonly restore: HTMLButtonElement;
  readonly status: HTMLElement;
}

const summaryRailSectionIds = new Set<PersonFactRailSectionId>([
  "contact-methods",
  "relationships",
  "addresses",
  "work",
  "pets",
  "food-preferences",
  "first-meeting",
]);

const SECTION_ZONE = {
  "contact-methods": "facts",
  addresses: "facts",
  relationships: "facts",
  "important-dates": "facts",
  work: "facts",
  pets: "facts",
  "food-preferences": "facts",
  "first-meeting": "facts",
  "stay-in-touch": "facts",
  "life-events": "timeline",
  notes: "timeline",
  conversations: "timeline",
  calls: "timeline",
  activities: "timeline",
  tasks: "planning",
  reminders: "planning",
  gifts: "things",
  debts: "things",
  documents: "things",
  photos: "things",
  "audit-summary": "admin",
  "identity-summary": "admin",
} as const;

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
      SECTION_ZONE[requestedSection as keyof typeof SECTION_ZONE] === "facts");
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
    button.classList.toggle("button-primary", selected);
    button.classList.toggle("button-secondary", !selected);
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

function createZoneRegistry(): ZoneRegistry {
  const zones = new Map<Zone, ZoneRegistryEntry>();
  const entry = (zone: Zone) => {
    const current = zones.get(zone);
    if (current) return current;
    const created: ZoneRegistryEntry = { mounts: [] };
    zones.set(zone, created);
    return created;
  };
  const register = (zone: Zone, mount: () => Promise<void>): void => {
    entry(zone).mounts.push(mount);
  };
  const activate = (zone: Zone): Promise<void> => {
    const current = entry(zone);
    current.activation ??= Promise.all(
      current.mounts.map((mount) => Promise.resolve().then(mount)),
    ).then(() => undefined).finally(() => {
      document.querySelector<HTMLElement>(`[data-zone="${zone}"]`)
        ?.removeAttribute("aria-busy");
    });
    return current.activation;
  };
  return {
    activate,
    register,
    settled: () =>
      Promise.all(
        [...zones.values()].flatMap((zone) =>
          zone.activation ? [zone.activation] : []
        ),
      ).then(() => undefined),
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

function deferPersonView(personId: string, workspaceId: string): void {
  const record = () => {
    void recordPersonView(personId, workspaceId).catch(() => undefined);
  };
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(record);
    return;
  }
  globalThis.setTimeout(record, 0);
}

function seedRailSummary(
  summary: PersonProfileSummary | undefined,
): void {
  if (!summary) return;
  for (const entry of summary.sectionCounts) {
    if (!summaryRailSectionIds.has(entry.id as PersonFactRailSectionId)) {
      continue;
    }
    const sectionId = entry.id as PersonFactRailSectionId;
    if (entry.status === "hidden") {
      setRailCount(sectionId, undefined);
      setRailEmpty(sectionId, false);
      continue;
    }
    setRailCount(sectionId, entry.count);
    setRailEmpty(sectionId, entry.count === 0);
  }
}

function elements(): ProfileElements | undefined {
  const archived = document.querySelector<HTMLElement>(
    "#person-profile-archived",
  );
  const archivedBanner = document.querySelector<HTMLElement>(
    "[data-person-archived-banner]",
  );
  const avatar = document.querySelector<HTMLElement>("#person-profile-avatar");
  const breadcrumbName = document.querySelector<HTMLElement>(
    "[data-person-breadcrumb-name]",
  );
  const deceased = document.querySelector<HTMLElement>(
    "#person-profile-deceased",
  );
  const description = document.querySelector<HTMLElement>(
    "[data-profile-description]",
  );
  const due = document.querySelector<HTMLElement>("#person-profile-due-state");
  const favorite = document.querySelector<HTMLElement>(
    "#person-profile-favorite",
  );
  const heading = document.querySelector<HTMLElement>("#person-profile-name");
  const nickname = document.querySelector<HTMLElement>(
    "#person-profile-nickname",
  );
  const partial = document.querySelector<HTMLElement>(
    "#person-profile-partial",
  );
  const ready = document.querySelector<HTMLElement>("#person-profile-ready");
  const sectionNotice = document.querySelector<HTMLElement>(
    "#person-profile-section-notice",
  );
  const sections = document.querySelector<HTMLElement>(
    "#person-profile-sections",
  );
  const self = document.querySelector<HTMLElement>("#person-profile-self");
  const state = document.querySelector<HTMLElement>("#person-profile-state");
  const tags = document.querySelector<HTMLUListElement>("#person-profile-tags");
  const tagsContainer = document.querySelector<HTMLElement>(
    '[data-profile-fact-section="tags"]',
  );
  return archived && archivedBanner && avatar && breadcrumbName && deceased &&
      description && due && favorite && heading && nickname && partial &&
      ready && sectionNotice && sections && self && state && tags &&
      tagsContainer
    ? {
      archived,
      archivedBanner,
      avatar,
      breadcrumbName,
      deceased,
      description,
      due,
      favorite,
      heading,
      nickname,
      partial,
      ready,
      sectionNotice,
      sections,
      self,
      state,
      tags,
      tagsContainer,
    }
    : undefined;
}

function personId(): string | undefined {
  return /^\/app\/people\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i
    .exec(globalThis.location.pathname)?.[1];
}

function displayName(person: PersonIdentity): string {
  const formal = [person.givenName, person.familyName].filter(Boolean).join(
    " ",
  );
  return formal || person.nickname || "Unnamed person";
}

function lifecycleElements(): LifecycleElements | undefined {
  const archive = document.querySelector<HTMLButtonElement>("#person-archive");
  const deleteCancel = document.querySelector<HTMLButtonElement>(
    "#person-delete-cancel",
  );
  const deleteConfirm = document.querySelector<HTMLButtonElement>(
    '#person-delete-form button[type="submit"]',
  );
  const deleteDialog = document.querySelector<HTMLDialogElement>(
    "#person-delete-dialog",
  );
  const deleteForm = document.querySelector<HTMLFormElement>(
    "#person-delete-form",
  );
  const deleteInput = document.querySelector<HTMLInputElement>(
    "#person-delete-confirmation",
  );
  const deleteMessage = document.querySelector<HTMLElement>(
    "#person-delete-impact",
  );
  const deleteOpen = document.querySelector<HTMLButtonElement>(
    "#person-delete-open",
  );
  const editCancel = document.querySelector<HTMLButtonElement>(
    "#person-edit-cancel",
  );
  const editForm = document.querySelector<HTMLFormElement>("#person-edit-form");
  const editOpen = document.querySelector<HTMLButtonElement>(
    "#person-edit-open",
  );
  const restore = document.querySelector<HTMLButtonElement>("#person-restore");
  const status = document.querySelector<HTMLElement>(
    "#person-lifecycle-status",
  );
  return archive && deleteCancel && deleteConfirm && deleteDialog &&
      deleteForm && deleteInput &&
      deleteMessage &&
      deleteOpen && editCancel && editForm && editOpen && restore && status
    ? {
      archive,
      deleteCancel,
      deleteConfirm,
      deleteDialog,
      deleteForm,
      deleteInput,
      deleteMessage,
      deleteOpen,
      editCancel,
      editForm,
      editOpen,
      restore,
      status,
    }
    : undefined;
}

function initials(person: PersonIdentity): string {
  const values = [person.givenName, person.familyName].flatMap((value) =>
    value ? [value] : []
  );
  const source = values.length > 0 ? values : [person.nickname ?? "?"];
  return source.map((value) => value.trim().at(0) ?? "").join("").slice(0, 2)
    .toLocaleUpperCase();
}

function renderZoneMiniIdentity(person: PersonIdentity): void {
  const avatar = document.querySelector<HTMLElement>(
    "[data-zone-mini-avatar]",
  );
  const name = document.querySelector<HTMLElement>("[data-zone-mini-name]");
  if (avatar) avatar.textContent = initials(person);
  if (name) name.textContent = displayName(person);
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
  profile.state.replaceChildren();
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Person workspace";
  const heading = document.createElement("h1");
  heading.textContent = copy.heading;
  const detail = document.createElement("p");
  detail.textContent = copy.detail;
  const link = document.createElement("a");
  link.className = "button-link";
  link.href = copy.link;
  link.textContent = copy.linkLabel;
  profile.state.append(eyebrow, heading, detail, link);
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
    `${title} — turned off for this workspace.`,
  );
  if (memberRole === "owner" || memberRole === "admin") {
    const personalization = document.createElement("a");
    personalization.href =
      "/app/settings/personalization?section=profile-modules";
    personalization.textContent = "Open personalization";
    profile.sectionNotice.append(" ", personalization);
  } else {
    profile.sectionNotice.append(
      " A workspace owner or admin can turn this section back on.",
    );
  }
  profile.sectionNotice.dataset.sectionNotice = id;
  profile.sectionNotice.hidden = false;
}

function renderSectionNavigation(
  profile: ProfileElements,
  hiddenSectionIds: ReadonlySet<string>,
): void {
  for (
    const link of profile.sections.querySelectorAll<HTMLAnchorElement>(
      "[data-section-link]",
    )
  ) {
    link.closest<HTMLElement>("li")!.hidden = hiddenSectionIds.has(
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
    !id || navigation.hiddenSectionIds.has(id) || !(id in SECTION_ZONE)
  ) return undefined;
  const zone = SECTION_ZONE[id as keyof typeof SECTION_ZONE];
  if (zone === "facts") return undefined;
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

function focusSection(
  profile: ProfileElements,
  navigation: SectionNavigationContext,
  id: string | null,
  preserveInteractiveFocus = false,
  replaceActivatedView = false,
): boolean {
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
  target.scrollIntoView?.({ block: "start" });
  target.focus({ preventScroll: true });
  return true;
}

function currentSection(): string | null {
  return new URLSearchParams(globalThis.location.search).get("section");
}

function reconcileSectionLocation(
  profile: ProfileElements,
  navigation: SectionNavigationContext,
  preserveInteractiveFocus = false,
): void {
  if (
    focusSection(
      profile,
      navigation,
      currentSection(),
      preserveInteractiveFocus,
    )
  ) return;
  clearCurrentSection(profile);
  if (preserveInteractiveFocus && hasMeaningfulInteractiveFocus()) return;
  profile.heading.focus({ preventScroll: true });
}

function mountSectionNavigation(
  profile: ProfileElements,
  navigation: SectionNavigationContext,
): void {
  profile.sections.addEventListener("click", (event) => {
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
      "[data-section-link]",
    );
    const id = link?.dataset.sectionLink;
    if (!link || !id || !section(id)) return;
    event.preventDefault();
    const url = new URL(globalThis.location.href);
    url.searchParams.set("section", id);
    const zone = SECTION_ZONE[id as keyof typeof SECTION_ZONE];
    const view = currentView();
    if (view !== "all" && zone !== "facts" && zone !== view) {
      url.searchParams.set("view", zone);
    }
    globalThis.history.pushState({}, "", url);
    focusSection(profile, navigation, id);
  });
  globalThis.addEventListener("popstate", () => {
    if (navigation.zoneFilter) {
      const view = currentView();
      applyZoneView(navigation.zoneFilter, view);
      if (view !== "all") void navigation.activateZone?.(view);
    }
    reconcileSectionLocation(profile, navigation);
  });
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

function mountPersonMenu(
  profile: ProfileElements,
  navigation: SectionNavigationContext,
): void {
  const toggle = document.querySelector<HTMLButtonElement>(
    "#person-menu-toggle",
  );
  const menu = document.querySelector<HTMLElement>("#person-menu");
  const auditHistory = document.querySelector<HTMLButtonElement>(
    "#person-audit-history",
  );
  if (!toggle || !menu || !auditHistory) return;

  toggle.addEventListener(
    "click",
    () => setPersonMenuOpen(menu.hasAttribute("hidden")),
  );
  menu.addEventListener("click", (event) => {
    const item = (event.target as Element | null)?.closest("a, button");
    if (!item || !menu.contains(item)) return;
    setPersonMenuOpen(false);
    if (item !== auditHistory) return;

    const sectionId = "audit-summary";
    const zone = SECTION_ZONE[sectionId];
    const url = new URL(globalThis.location.href);
    url.searchParams.set("section", sectionId);
    url.searchParams.set("view", zone);
    if (navigation.zoneFilter) {
      applyZoneView(navigation.zoneFilter, zone);
    }
    globalThis.history.pushState({}, "", url);
    focusSection(profile, navigation, sectionId);
  });
}

function setPersonMenuOpen(open: boolean): void {
  const toggle = document.querySelector<HTMLButtonElement>(
    "#person-menu-toggle",
  );
  const menu = document.querySelector<HTMLElement>("#person-menu");
  if (!toggle || !menu) return;
  menu.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
}

function focusPersonMenuItem(item: HTMLElement): void {
  setPersonMenuOpen(true);
  item.focus();
}

function renderTags(
  target: HTMLUListElement,
  person: PersonProfileIdentity,
): void {
  target.replaceChildren();
  if (person.tags.length === 0) {
    const empty = document.createElement("li");
    empty.className = "profile-tag-empty";
    empty.textContent = "No tags saved";
    target.append(empty);
    return;
  }
  for (const tag of person.tags) {
    const item = document.createElement("li");
    item.textContent = tag.name;
    target.append(item);
  }
  const remaining = person.tagCount - person.tags.length;
  if (remaining > 0) {
    const more = document.createElement("li");
    more.textContent = `+${remaining} more`;
    target.append(more);
  }
}

function renderReady(
  profile: ProfileElements,
  person: PersonProfileIdentity,
  dueInformation: PersonDueInformation,
  status: "archived" | "ready",
  workspaceId: string,
  navigation: SectionNavigationContext,
): void {
  const name = displayName(person);
  profile.heading.textContent = name;
  profile.breadcrumbName.textContent = name;
  profile.nickname.textContent = person.nickname ? `“${person.nickname}”` : "";
  profile.nickname.hidden = !person.nickname;
  profile.avatar.textContent = initials(person);
  const savedState = document.querySelector<HTMLElement>(
    "#person-profile-saved-state",
  );
  if (savedState) savedState.textContent = "Identity saved";
  renderZoneMiniIdentity(person);
  for (
    const field of [
      "givenName",
      "middleName",
      "familyName",
      "nickname",
      "gender",
    ] as const
  ) {
    const target = document.querySelector<HTMLElement>(
      `[data-profile-field="${field}"]`,
    );
    if (target) {
      target.textContent = person[field] ||
        (field === "gender" ? "Not set" : "Unknown");
    }
  }
  profile.description.textContent = person.description ||
    "No description saved.";
  profile.partial.hidden = !person.isPartial;
  profile.favorite.hidden = !person.isStarred;
  profile.deceased.hidden = !person.isDeceased;
  profile.self.hidden = !person.isSelf;
  profile.archived.hidden = status !== "archived";
  profile.due.textContent = dueInformation.detail;
  const lastContact = document.querySelector<HTMLElement>(
    "[data-profile-last-contact]",
  );
  if (lastContact) {
    lastContact.textContent = person.lastContactAt
      ? new Date(person.lastContactAt).toLocaleString()
      : "None recorded";
  }
  const nextReminder = document.querySelector<HTMLElement>(
    '[data-person-vital-value="next-reminder"]',
  );
  if (nextReminder) {
    nextReminder.textContent = dueInformation.nextReminderAt
      ? new Date(dueInformation.nextReminderAt).toLocaleString()
      : "Not recorded";
  }
  setVitalStat("birthday", undefined);
  setVitalStat("work", undefined);
  setFirstMeetingDate(undefined);
  setFirstMeetingPlace(undefined);
  renderTags(profile.tags, person);
  const tagsHidden = navigation.hiddenSectionIds.has("tags");
  profile.tags.hidden = tagsHidden;
  profile.tagsContainer.hidden = tagsHidden;
  renderSectionNavigation(profile, navigation.hiddenSectionIds);
  profile.state.hidden = true;
  profile.ready.hidden = false;
  profile.ready.removeAttribute("aria-busy");
  const vcard = document.querySelector<HTMLAnchorElement>(
    "#person-export-vcard",
  );
  if (vcard) {
    vcard.href = `/api/v1/people/${
      encodeURIComponent(person.id)
    }/vcard?workspaceId=${encodeURIComponent(workspaceId)}`;
    vcard.hidden = false;
  }
  document.title = `${name} — Kinship`;
  if (!focusSection(profile, navigation, currentSection(), false, true)) {
    profile.heading.focus();
  }
}

function renderLifecycleState(
  profile: ProfileElements,
  lifecycle: LifecycleElements,
  state: "active" | "archived",
): void {
  const archived = state === "archived";
  profile.archived.hidden = !archived;
  profile.archivedBanner.hidden = !archived;
  lifecycle.editOpen.hidden = archived;
  lifecycle.archive.hidden = archived;
  lifecycle.restore.hidden = !archived;
  lifecycle.editForm.hidden = true;
}

function fillEditForm(
  lifecycle: LifecycleElements,
  person: PersonIdentity,
): void {
  const fields = lifecycle.editForm.elements;
  (fields.namedItem("givenName") as HTMLInputElement).value = person.givenName;
  (fields.namedItem("middleName") as HTMLInputElement).value =
    person.middleName ?? "";
  (fields.namedItem("familyName") as HTMLInputElement).value =
    person.familyName ?? "";
  (fields.namedItem("nickname") as HTMLInputElement).value = person.nickname ??
    "";
  (fields.namedItem("isPartial") as HTMLInputElement).checked =
    person.isPartial;
}

function updateIdentity(
  profile: ProfileElements,
  person: PersonIdentity,
): void {
  const name = displayName(person);
  profile.heading.textContent = name;
  profile.breadcrumbName.textContent = name;
  profile.nickname.textContent = person.nickname ? `“${person.nickname}”` : "";
  profile.nickname.hidden = !person.nickname;
  profile.avatar.textContent = initials(person);
  renderZoneMiniIdentity(person);
  for (
    const field of [
      "givenName",
      "middleName",
      "familyName",
      "nickname",
    ] as const
  ) {
    const target = document.querySelector<HTMLElement>(
      `[data-profile-field="${field}"]`,
    );
    if (target) target.textContent = person[field] || "Unknown";
  }
  profile.partial.hidden = !person.isPartial;
  document.title = `${name} — Kinship`;
}

function mountLifecycleActions(
  profile: ProfileElements,
  initialPerson: PersonProfileIdentity,
  initialState: "archived" | "ready",
  personId: string,
  workspaceId: string,
): void {
  const lifecycle = lifecycleElements();
  if (!lifecycle) return;
  let person: PersonIdentity = initialPerson;
  let updatedAt = initialPerson.updatedAt;
  let state: "active" | "archived" = initialState === "archived"
    ? "archived"
    : "active";
  let deleteConfirmation = "";
  let deleteRequestSequence = 0;
  let deleteSubmitting = false;
  fillEditForm(lifecycle, person);
  renderLifecycleState(profile, lifecycle, state);
  document.addEventListener("person-revision-changed", (event) => {
    updatedAt = (event as CustomEvent<{
      readonly personUpdatedAt: string;
    }>).detail.personUpdatedAt;
  });

  const announce = (message: string): void => {
    lifecycle.status.textContent = message;
  };
  const disableActions = (disabled: boolean): void => {
    for (
      const button of [
        lifecycle.archive,
        lifecycle.deleteOpen,
        lifecycle.editOpen,
        lifecycle.restore,
      ]
    ) button.disabled = disabled;
  };

  lifecycle.editOpen.addEventListener("click", () => {
    fillEditForm(lifecycle, person);
    lifecycle.editForm.hidden = false;
    (lifecycle.editForm.elements.namedItem("givenName") as HTMLInputElement)
      .focus();
  });
  lifecycle.editCancel.addEventListener("click", () => {
    lifecycle.editForm.hidden = true;
    focusPersonMenuItem(lifecycle.editOpen);
    announce("Edit cancelled. No changes were saved.");
  });
  lifecycle.editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(lifecycle.editForm);
    const result = await editPerson(personId, {
      expectedUpdatedAt: updatedAt,
      familyName: String(data.get("familyName") ?? ""),
      givenName: String(data.get("givenName") ?? ""),
      isPartial: data.get("isPartial") === "on",
      middleName: String(data.get("middleName") ?? ""),
      nickname: String(data.get("nickname") ?? ""),
    }, workspaceId).catch(() => undefined);
    if (!result || !result.ok) {
      announce(
        result && !result.ok
          ? result.problem.detail
          : "Person update is temporarily unavailable.",
      );
      return;
    }
    person = result.value.person;
    updatedAt = result.value.person.updatedAt;
    document.dispatchEvent(
      new CustomEvent("person-revision-changed", {
        detail: { personUpdatedAt: updatedAt },
      }),
    );
    lifecycle.editForm.hidden = true;
    updateIdentity(profile, person);
    announce("Person identity updated.");
    profile.heading.focus();
  });

  const transition = async (action: "archive" | "restore"): Promise<void> => {
    disableActions(true);
    const result = await (action === "archive" ? archivePerson : restorePerson)(
      personId,
      { expectedUpdatedAt: updatedAt },
      workspaceId,
    ).catch(() => undefined);
    disableActions(false);
    if (!result || !result.ok) {
      announce(
        result && !result.ok
          ? result.problem.detail
          : `Person ${action} is temporarily unavailable.`,
      );
      return;
    }
    person = result.value.person;
    updatedAt = result.value.person.updatedAt;
    document.dispatchEvent(
      new CustomEvent("person-revision-changed", {
        detail: { personUpdatedAt: updatedAt },
      }),
    );
    state = action === "archive" ? "archived" : "active";
    renderLifecycleState(profile, lifecycle, state);
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: {
          archived: state === "archived",
          personId,
          personUpdatedAt: updatedAt,
          state,
        },
      }),
    );
    if (action === "archive") {
      showToast({
        action: {
          label: "Undo",
          onSelect: () => void transition("restore"),
        },
        message: "Person archived. They now appear in Archived people.",
        tone: "success",
      });
    } else {
      showToast({
        message: "Person restored. They now appear in People.",
        tone: "success",
      });
    }
    profile.heading.focus();
  };
  lifecycle.archive.addEventListener("click", () => void transition("archive"));
  lifecycle.restore.addEventListener("click", () => void transition("restore"));

  const cancelDelete = (): void => {
    deleteRequestSequence += 1;
    deleteSubmitting = false;
    lifecycle.deleteConfirm.disabled = false;
    if (lifecycle.deleteDialog.open) lifecycle.deleteDialog.close();
    lifecycle.deleteForm.reset();
    focusPersonMenuItem(lifecycle.deleteOpen);
    announce("Delete cancelled. No changes were made.");
  };
  lifecycle.deleteCancel.addEventListener("click", cancelDelete);
  lifecycle.deleteDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    cancelDelete();
  });
  lifecycle.deleteDialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [
      lifecycle.deleteInput,
      lifecycle.deleteConfirm,
      lifecycle.deleteCancel,
    ].filter((control) => !control.disabled);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    const active = document.activeElement;
    if (
      event.shiftKey &&
      (active === first || active === lifecycle.deleteDialog ||
        !lifecycle.deleteDialog.contains(active))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (active === last || active === lifecycle.deleteDialog ||
        !lifecycle.deleteDialog.contains(active))
    ) {
      event.preventDefault();
      first.focus();
    }
  });
  lifecycle.deleteOpen.addEventListener("click", async () => {
    const requestSequence = ++deleteRequestSequence;
    lifecycle.deleteMessage.textContent = "Loading deletion impact…";
    lifecycle.deleteForm.reset();
    lifecycle.deleteConfirm.disabled = true;
    lifecycle.deleteDialog.showModal();
    const result = await getPersonDeletionImpact(personId, workspaceId).catch(
      () => undefined,
    );
    if (
      requestSequence !== deleteRequestSequence ||
      !lifecycle.deleteDialog.open
    ) return;
    if (!result || !result.ok) {
      lifecycle.deleteMessage.textContent = result && !result.ok
        ? result.problem.detail
        : "Deletion impact is temporarily unavailable.";
      return;
    }
    deleteConfirmation = result.value.impact.confirmation;
    updatedAt = result.value.impact.person.updatedAt;
    lifecycle.deleteMessage.textContent =
      `This person will be hidden from Kinship. Related records are retained. Enter ${deleteConfirmation} to continue.`;
    lifecycle.deleteConfirm.disabled = false;
    lifecycle.deleteInput.focus();
  });
  lifecycle.deleteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (deleteSubmitting) return;
    deleteSubmitting = true;
    lifecycle.deleteConfirm.disabled = true;
    const result = await deletePerson(personId, {
      confirmation: lifecycle.deleteInput.value,
      expectedUpdatedAt: updatedAt,
    }, workspaceId).catch(() => undefined);
    if (!result || !result.ok) {
      deleteSubmitting = false;
      lifecycle.deleteConfirm.disabled = false;
      lifecycle.deleteMessage.textContent = result && !result.ok
        ? result.problem.detail
        : "Person deletion is temporarily unavailable.";
      lifecycle.deleteInput.focus();
      return;
    }
    deleteRequestSequence += 1;
    lifecycle.deleteDialog.close();
    globalThis.location.assign(result.value.next);
  });
}

function problemState(problem: ProblemDetails): ProfileState {
  if (problem.status === 404) return "not-found";
  if (problem.status === 401 || problem.status === 403) return "forbidden";
  return "unavailable";
}

export async function mountPeopleProfile(): Promise<void> {
  const profile = elements();
  if (!profile) return;
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
  mountSectionNavigation(profile, sectionNavigation);
  mountPersonMenu(profile, sectionNavigation);
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") {
    renderState(
      profile,
      session.status === "access-lost" ? "forbidden" : "unavailable",
    );
    return;
  }
  const result = await getPerson(
    id,
    session.session.workspace.id,
    "summary",
  ).catch(() => undefined);
  if (!result) {
    renderState(profile, "unavailable");
    return;
  }
  if (!result.ok) {
    renderState(profile, problemState(result.problem));
    return;
  }
  if (shouldShowPersonFirstRun(result.value.summary, result.value.status)) {
    showPersonFirstRun();
  }
  for (const section of result.value.person.profileSections ?? []) {
    if (section.status === "hidden") {
      hiddenSectionIds.add(section.id);
    }
  }
  sectionNavigation.memberRole = session.session.member.role;
  mountLifecycleActions(
    profile,
    result.value.person,
    result.value.status,
    id,
    session.session.workspace.id,
  );
  const zoneRegistry = createZoneRegistry();
  const { activate, register } = zoneRegistry;
  sectionNavigation.activateZone = activate;
  if (zoneFilter) zoneFilter.activate = activate;
  register(
    "timeline",
    () =>
      mountPersonInteractions(
        id,
        session.session.workspace.id,
        result.value.status === "archived",
        {
          activities: sectionNavigation.hiddenSectionIds.has("activities"),
          notes: sectionNavigation.hiddenSectionIds.has("notes"),
        },
      ),
  );
  register(
    "timeline",
    () =>
      mountPersonLifeEvents(
        id,
        session.session.workspace.id,
        sectionNavigation.hiddenSectionIds.has("life-events"),
      ),
  );
  register(
    "timeline",
    () =>
      mountCommunications(
        id,
        session.session.workspace.id,
        result.value.status === "archived",
        {
          calls: sectionNavigation.hiddenSectionIds.has("calls"),
          conversations: sectionNavigation.hiddenSectionIds.has(
            "conversations",
          ),
        },
      ),
  );
  register(
    "planning",
    () =>
      mountTaskSurface({
        archived: result.value.status === "archived",
        hidden: sectionNavigation.hiddenSectionIds.has("tasks"),
        personId: id,
        workspaceId: session.session.workspace.id,
      }),
  );
  register(
    "things",
    () =>
      mountPersonFiles({
        archived: result.value.status === "archived",
        personId: id,
        workspaceId: session.session.workspace.id,
      }),
  );
  register(
    "things",
    () =>
      mountPersonGifts({
        archived: result.value.status === "archived",
        personId: id,
        workspaceId: session.session.workspace.id,
      }),
  );
  register(
    "admin",
    () => mountPersonAuditSummary(id, session.session.workspace.id),
  );
  const selectedView = currentView();
  if (selectedView !== "all") void activate(selectedView);
  mountZoneVisibilityActivation(activate);
  renderReady(
    profile,
    result.value.person,
    result.value.dueInformation,
    result.value.status,
    session.session.workspace.id,
    sectionNavigation,
  );
  mountUnsavedChangesGuard({
    confirmMessage:
      "You have unsaved changes on this person. Discard them and switch workspaces?",
    root: profile.ready,
  });
  seedRailSummary(result.value.summary);
  deferPersonView(id, session.session.workspace.id);
  const eagerRail = Promise.all([
    mountImportantDates(
      id,
      session.session.workspace.id,
      result.value.status === "archived",
    ),
    mountProfileFacts(
      id,
      session.session.workspace.id,
      result.value.status === "archived",
      result.value.person.updatedAt,
      result.value.summary?.primaryContactMethods,
    ),
    mountRelationships(
      id,
      session.session.workspace.id,
      result.value.status === "archived",
      sectionNavigation.hiddenSectionIds.has("relationships"),
      result.value.person.updatedAt,
    ),
    mountPersonReminders({
      archived: result.value.status === "archived",
      personId: id,
      workspaceId: session.session.workspace.id,
    }),
  ]).finally(() => {
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
  reconcileSectionLocation(profile, sectionNavigation, true);
}
