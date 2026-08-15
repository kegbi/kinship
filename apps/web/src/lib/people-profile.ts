import {
  getPerson,
  type PersonProfileIdentity,
  type ProblemDetails,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";

interface ProfileElements {
  readonly archived: HTMLElement;
  readonly avatar: HTMLElement;
  readonly deceased: HTMLElement;
  readonly description: HTMLElement;
  readonly due: HTMLElement;
  readonly favorite: HTMLElement;
  readonly heading: HTMLElement;
  readonly partial: HTMLElement;
  readonly ready: HTMLElement;
  readonly sections: HTMLElement;
  readonly self: HTMLElement;
  readonly state: HTMLElement;
  readonly tags: HTMLUListElement;
}

type ProfileState = "forbidden" | "not-found" | "unavailable";

function elements(): ProfileElements | undefined {
  const archived = document.querySelector<HTMLElement>(
    "#person-profile-archived",
  );
  const avatar = document.querySelector<HTMLElement>("#person-profile-avatar");
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
  const partial = document.querySelector<HTMLElement>(
    "#person-profile-partial",
  );
  const ready = document.querySelector<HTMLElement>("#person-profile-ready");
  const sections = document.querySelector<HTMLElement>(
    "#person-profile-sections",
  );
  const self = document.querySelector<HTMLElement>("#person-profile-self");
  const state = document.querySelector<HTMLElement>("#person-profile-state");
  const tags = document.querySelector<HTMLUListElement>("#person-profile-tags");
  return archived && avatar && deceased && description && due && favorite &&
      heading && partial && ready && sections && self && state && tags
    ? {
      archived,
      avatar,
      deceased,
      description,
      due,
      favorite,
      heading,
      partial,
      ready,
      sections,
      self,
      state,
      tags,
    }
    : undefined;
}

function personId(): string | undefined {
  return /^\/app\/people\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i
    .exec(globalThis.location.pathname)?.[1];
}

function displayName(person: PersonProfileIdentity): string {
  const formal = [person.givenName, person.familyName].filter(Boolean).join(
    " ",
  );
  return formal || person.nickname || "Unnamed person";
}

function initials(person: PersonProfileIdentity): string {
  const values = [person.givenName, person.familyName].flatMap((value) =>
    value ? [value] : []
  );
  const source = values.length > 0 ? values : [person.nickname ?? "?"];
  return source.map((value) => value.trim().at(0) ?? "").join("").slice(0, 2)
    .toLocaleUpperCase();
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

function focusSection(id: string | null): boolean {
  const target = section(id);
  if (!target) return false;
  for (
    const link of document.querySelectorAll<HTMLAnchorElement>(
      "[data-section-link]",
    )
  ) {
    if (link.dataset.sectionLink === id) {
      link.setAttribute("aria-current", "location");
    } else {
      link.removeAttribute("aria-current");
    }
  }
  target.scrollIntoView?.({ block: "start" });
  target.focus({ preventScroll: true });
  return true;
}

function currentSection(): string | null {
  return new URLSearchParams(globalThis.location.search).get("section");
}

function reconcileSectionLocation(profile: ProfileElements): void {
  if (focusSection(currentSection())) return;
  for (
    const link of document.querySelectorAll<HTMLAnchorElement>(
      "[data-section-link]",
    )
  ) {
    link.removeAttribute("aria-current");
  }
  profile.heading.focus({ preventScroll: true });
}

function mountSectionNavigation(profile: ProfileElements): void {
  profile.sections.addEventListener("click", (event) => {
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
      "[data-section-link]",
    );
    const id = link?.dataset.sectionLink;
    if (!link || !id || !section(id)) return;
    event.preventDefault();
    const url = new URL(globalThis.location.href);
    url.searchParams.set("section", id);
    globalThis.history.pushState({}, "", url);
    focusSection(id);
  });
  globalThis.addEventListener("popstate", () => {
    reconcileSectionLocation(profile);
  });
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
  dueInformation: { readonly detail: string },
  status: "archived" | "ready",
): void {
  const name = displayName(person);
  profile.heading.textContent = name;
  profile.avatar.textContent = initials(person);
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
  renderTags(profile.tags, person);
  profile.state.hidden = true;
  profile.ready.hidden = false;
  document.title = `${name} — Kinship`;
  if (!focusSection(currentSection())) profile.heading.focus();
}

function problemState(problem: ProblemDetails): ProfileState {
  if (problem.status === 404) return "not-found";
  if (problem.status === 401 || problem.status === 403) return "forbidden";
  return "unavailable";
}

export async function mountPeopleProfile(): Promise<void> {
  const profile = elements();
  if (!profile) return;
  const id = personId();
  if (!id) {
    renderState(profile, "not-found");
    return;
  }
  mountSectionNavigation(profile);
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") {
    renderState(
      profile,
      session.status === "access-lost" ? "forbidden" : "unavailable",
    );
    return;
  }
  const result = await getPerson(id, session.session.workspace.id).catch(() =>
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
  renderReady(
    profile,
    result.value.person,
    result.value.dueInformation,
    result.value.status,
  );
}
