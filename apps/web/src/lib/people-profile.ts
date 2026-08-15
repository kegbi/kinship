import {
  getPerson,
  type PersonIdentity,
  type ProblemDetails,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";

interface ProfileElements {
  readonly archived: HTMLElement;
  readonly heading: HTMLElement;
  readonly partial: HTMLElement;
  readonly ready: HTMLElement;
  readonly state: HTMLElement;
}

type ProfileState = "forbidden" | "not-found" | "unavailable";

function elements(): ProfileElements | undefined {
  const archived = document.querySelector<HTMLElement>(
    "#person-profile-archived",
  );
  const heading = document.querySelector<HTMLElement>("#person-profile-name");
  const partial = document.querySelector<HTMLElement>(
    "#person-profile-partial",
  );
  const ready = document.querySelector<HTMLElement>("#person-profile-ready");
  const state = document.querySelector<HTMLElement>("#person-profile-state");
  return archived && heading && partial && ready && state
    ? { archived, heading, partial, ready, state }
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
      link: "/app/people/new",
      linkLabel: "Add a person",
    },
    unavailable: {
      detail:
        "Kinship could not load this identity. Your saved data has not changed.",
      heading: "Person temporarily unavailable",
      link: globalThis.location.pathname,
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

function renderReady(
  profile: ProfileElements,
  person: PersonIdentity,
  status: "archived" | "ready",
): void {
  const name = displayName(person);
  profile.heading.textContent = name;
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
  profile.archived.hidden = status !== "archived";
  profile.state.hidden = true;
  profile.ready.hidden = false;
  document.title = `${name} — Kinship`;
  profile.heading.focus();
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
  renderReady(profile, result.value.person, result.value.status);
}
