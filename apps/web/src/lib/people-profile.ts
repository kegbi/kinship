import {
  archivePerson,
  deletePerson,
  editPerson,
  getPerson,
  getPersonDeletionImpact,
  type PersonIdentity,
  type PersonProfileIdentity,
  type ProblemDetails,
  restorePerson,
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

function renderLifecycleState(
  profile: ProfileElements,
  lifecycle: LifecycleElements,
  state: "active" | "archived",
): void {
  const archived = state === "archived";
  profile.archived.hidden = !archived;
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
  profile.avatar.textContent = initials(person);
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
    lifecycle.editOpen.focus();
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
    state = action === "archive" ? "archived" : "active";
    renderLifecycleState(profile, lifecycle, state);
    announce(
      action === "archive"
        ? "Person archived. They now appear in Archived people."
        : "Person restored. They now appear in People.",
    );
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
    lifecycle.deleteOpen.focus();
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
  mountLifecycleActions(
    profile,
    result.value.person,
    result.value.status,
    id,
    session.session.workspace.id,
  );
}
