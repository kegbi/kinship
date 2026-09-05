import {
  getMemberPreferences,
  listPeople,
  listPeopleTagOptions,
  type PeopleDirectoryInput,
  type PeopleDirectoryLifecycle,
  type PeopleDirectoryPerson,
  type PeopleDirectorySort,
  type PeopleDirectoryTag,
  type PeopleTagOptionsPage,
  type ProblemDetails,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";
import { displayPersonName, type PersonNameOrder } from "./person-name.ts";

interface DirectoryElements {
  readonly announcement: HTMLElement;
  readonly empty: HTMLElement;
  readonly error: HTMLElement;
  readonly form: HTMLFormElement;
  readonly list: HTMLUListElement;
  readonly loadMore: HTMLButtonElement;
  readonly retry: HTMLButtonElement;
  readonly search: HTMLInputElement;
  readonly sort: HTMLSelectElement;
  readonly state: HTMLElement;
  readonly tag: HTMLSelectElement;
  readonly tagMore: HTMLButtonElement;
  readonly tagSearch: HTMLInputElement;
  readonly tagSearchButton: HTMLButtonElement;
  readonly tagStatus: HTMLElement;
}

function elements(): DirectoryElements | undefined {
  const announcement = document.querySelector<HTMLElement>(
    "#people-directory-announcement",
  );
  const empty = document.querySelector<HTMLElement>(
    "#people-directory-empty",
  );
  const error = document.querySelector<HTMLElement>(
    "#people-directory-error",
  );
  const form = document.querySelector<HTMLFormElement>(
    "#people-directory-controls",
  );
  const list = document.querySelector<HTMLUListElement>(
    "#people-directory-list",
  );
  const loadMore = document.querySelector<HTMLButtonElement>(
    "#people-directory-more",
  );
  const retry = document.querySelector<HTMLButtonElement>(
    "#people-directory-retry",
  );
  const search = document.querySelector<HTMLInputElement>(
    "#people-directory-search",
  );
  const sort = document.querySelector<HTMLSelectElement>(
    "#people-directory-sort",
  );
  const state = document.querySelector<HTMLElement>(
    "#people-directory-state",
  );
  const tag = document.querySelector<HTMLSelectElement>(
    "#people-directory-tag",
  );
  const tagMore = document.querySelector<HTMLButtonElement>(
    "#people-tag-options-more",
  );
  const tagSearch = document.querySelector<HTMLInputElement>(
    "#people-tag-options-search",
  );
  const tagSearchButton = document.querySelector<HTMLButtonElement>(
    "#people-tag-options-search-button",
  );
  const tagStatus = document.querySelector<HTMLElement>(
    "#people-tag-options-status",
  );
  return announcement && empty && error && form && list && loadMore && retry &&
      search && sort && state && tag && tagMore && tagSearch &&
      tagSearchButton && tagStatus
    ? {
      announcement,
      empty,
      error,
      form,
      list,
      loadMore,
      retry,
      search,
      sort,
      state,
      tag,
      tagMore,
      tagSearch,
      tagSearchButton,
      tagStatus,
    }
    : undefined;
}

function lifecycle(): PeopleDirectoryLifecycle {
  return document.querySelector<HTMLElement>("[data-people-lifecycle]")
      ?.dataset.peopleLifecycle === "archived"
    ? "archived"
    : "active";
}

function isSort(value: string | null): value is PeopleDirectorySort {
  return value === "given-name" || value === "family-name" ||
    value === "recently-added";
}

function hydrateControls(
  directory: DirectoryElements,
  defaultSort: PeopleDirectorySort,
): void {
  const query = new URLSearchParams(globalThis.location.search);
  directory.search.value = query.get("search") ?? "";
  const sort = query.get("sort");
  directory.sort.value = isSort(sort) ? sort : defaultSort;
  directory.tag.dataset.initialValue = query.get("tag") ?? "";
}

function input(
  directory: DirectoryElements,
  selectedLifecycle: PeopleDirectoryLifecycle,
  cursor?: string,
): PeopleDirectoryInput {
  const search = directory.search.value.trim();
  const tagId = directory.tag.value || directory.tag.dataset.initialValue;
  return {
    ...(cursor ? { cursor } : {}),
    lifecycle: selectedLifecycle,
    limit: 20,
    ...(search ? { search } : {}),
    sort: directory.sort.value as PeopleDirectorySort,
    ...(tagId ? { tagId } : {}),
  };
}

function updateLocation(
  directory: DirectoryElements,
  defaultSort: PeopleDirectorySort,
): void {
  const query = new URLSearchParams();
  if (directory.search.value.trim()) {
    query.set("search", directory.search.value.trim());
  }
  const selectedTag = directory.tag.value ||
    directory.tag.dataset.initialValue;
  if (selectedTag) query.set("tag", selectedTag);
  if (
    directory.sort.value !== defaultSort ||
    isSort(new URLSearchParams(globalThis.location.search).get("sort"))
  ) {
    query.set("sort", directory.sort.value);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  globalThis.history.replaceState(
    {},
    "",
    `${globalThis.location.pathname}${suffix}`,
  );
}

function personItem(
  person: PeopleDirectoryPerson,
  nameOrder: PersonNameOrder,
): HTMLLIElement {
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.href = `/app/people/${person.id}`;
  link.className = "person-directory-link";
  const heading = document.createElement("h2");
  heading.textContent = displayPersonName(person, nameOrder);
  const details = document.createElement("p");
  details.className = "directory-person-details";
  details.textContent = [
    person.isStarred ? "Favorite" : "",
    person.isPartial ? "Partial identity" : "",
    person.lifecycle === "archived" ? "Archived · read-only" : "",
  ].filter(Boolean).join(" · ") || "Open person workspace";
  link.append(heading, details);
  if (person.tagCount > 0) {
    const tags = document.createElement("ul");
    tags.className = "directory-person-tags";
    tags.setAttribute(
      "aria-label",
      `Tags for ${
        displayPersonName(person, nameOrder)
      }: ${person.tagCount} total`,
    );
    for (const tag of person.tags) {
      const tagItem = document.createElement("li");
      tagItem.textContent = tag.name;
      tags.append(tagItem);
    }
    const remaining = person.tagCount - person.tags.length;
    if (remaining > 0) {
      const more = document.createElement("li");
      more.className = "directory-person-tags-more";
      more.textContent = `+${remaining} more`;
      more.setAttribute(
        "aria-label",
        `${remaining} more ${remaining === 1 ? "tag" : "tags"} not shown`,
      );
      tags.append(more);
    }
    link.append(tags);
  }
  item.append(link);
  return item;
}

function tagOption(tag: PeopleDirectoryTag): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = tag.id;
  option.textContent = tag.name;
  return option;
}

function renderTagOptions(
  directory: DirectoryElements,
  page: PeopleTagOptionsPage,
  append: boolean,
): void {
  const selected = directory.tag.value || directory.tag.dataset.initialValue ||
    "";
  if (!append) {
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "All tags";
    const selectedTag = selected
      ? page.selected ?? { id: selected, name: "Selected tag" }
      : undefined;
    directory.tag.replaceChildren(
      all,
      ...(selectedTag ? [tagOption(selectedTag)] : []),
    );
  }
  const existing = new Set(
    [...directory.tag.options].map((option) => option.value),
  );
  for (const tag of page.options) {
    if (!existing.has(tag.id)) {
      directory.tag.append(tagOption(tag));
      existing.add(tag.id);
    }
  }
  directory.tag.value = selected;
  directory.tag.dataset.initialValue = selected;
}

function emptyCopy(
  directory: DirectoryElements,
  selectedLifecycle: PeopleDirectoryLifecycle,
): void {
  const filtered = directory.search.value.trim() || directory.tag.value;
  const heading = directory.empty.querySelector("h2");
  const detail = directory.empty.querySelector("p");
  if (heading) {
    heading.textContent = filtered
      ? "No people match these filters"
      : selectedLifecycle === "archived"
      ? "No archived people"
      : "No people yet";
  }
  if (detail) {
    detail.textContent = filtered
      ? "Try a different name or tag."
      : selectedLifecycle === "archived"
      ? "People you archive will appear here."
      : "Add your first person when you are ready.";
  }
}

function renderError(
  directory: DirectoryElements,
  problem?: ProblemDetails,
): void {
  directory.state.hidden = true;
  directory.empty.hidden = true;
  directory.list.hidden = true;
  directory.loadMore.hidden = true;
  directory.error.hidden = false;
  const heading = directory.error.querySelector("h2");
  const detail = directory.error.querySelector("p");
  const forbidden = problem?.status === 401 || problem?.status === 403;
  if (heading) {
    heading.textContent = forbidden
      ? "People unavailable"
      : "People temporarily unavailable";
  }
  if (detail) {
    detail.textContent = forbidden
      ? "Your current session or active workspace no longer permits this view."
      : "Your saved people have not changed. Check your connection and try again.";
  }
  directory.error.focus();
}

export async function mountPeopleDirectory(): Promise<void> {
  const directory = elements();
  if (!directory) return;
  const selectedLifecycle = lifecycle();
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") {
    renderError(
      directory,
      session.status === "access-lost"
        ? {
          code: "people_forbidden",
          detail: "Access lost",
          status: 403,
          title: "People unavailable",
          type: "about:blank",
        }
        : undefined,
    );
    return;
  }

  const preferences = await getMemberPreferences(session.session.workspace.id)
    .catch(() => undefined);
  const nameOrder = preferences?.ok
    ? preferences.value.preferences.contactNameOrder
    : "given_family_nickname";
  const defaultSort = preferences?.ok &&
      preferences.value.preferences.contactSortOrder === "family_name_asc"
    ? "family-name"
    : "given-name";
  hydrateControls(directory, defaultSort);
  let nextCursor: string | undefined;
  let requestSequence = 0;
  let tagCursor: string | undefined;
  let tagRequestSequence = 0;
  const loadTags = async (append: boolean): Promise<void> => {
    const sequence = ++tagRequestSequence;
    directory.tagSearchButton.disabled = true;
    directory.tagMore.disabled = true;
    directory.tagStatus.textContent = append
      ? "Loading more tag options…"
      : "Loading tag options…";
    const selectedTagId = directory.tag.value ||
      directory.tag.dataset.initialValue;
    const search = directory.tagSearch.value.trim();
    const result = await listPeopleTagOptions({
      ...(append && tagCursor ? { cursor: tagCursor } : {}),
      ...(search ? { search } : {}),
      ...(selectedTagId ? { selectedTagId } : {}),
    }, session.session.workspace.id).catch(() => undefined);
    if (sequence !== tagRequestSequence) return;
    directory.tagSearchButton.disabled = false;
    directory.tagMore.disabled = false;
    if (!result || !result.ok) {
      directory.tagMore.hidden = true;
      directory.tagStatus.textContent =
        "Tag options are temporarily unavailable.";
      return;
    }
    renderTagOptions(directory, result.value, append);
    tagCursor = result.value.nextCursor;
    directory.tagMore.hidden = !tagCursor;
    const count = directory.tag.options.length - 1;
    directory.tagStatus.textContent = `${count} tag ${
      count === 1 ? "option" : "options"
    } shown.`;
  };
  const load = async (append: boolean): Promise<void> => {
    const sequence = ++requestSequence;
    directory.form.querySelectorAll("input, select, button").forEach(
      (control) => (control as HTMLInputElement).disabled = true,
    );
    directory.loadMore.disabled = true;
    directory.error.hidden = true;
    directory.empty.hidden = true;
    if (!append) {
      directory.state.hidden = false;
      directory.list.hidden = true;
      directory.loadMore.hidden = true;
    }
    const result = await listPeople(
      input(directory, selectedLifecycle, append ? nextCursor : undefined),
      session.session.workspace.id,
    ).catch(() => undefined);
    if (sequence !== requestSequence) return;
    directory.form.querySelectorAll("input, select, button").forEach(
      (control) => (control as HTMLInputElement).disabled = false,
    );
    directory.loadMore.disabled = false;
    if (!result) {
      renderError(directory);
      return;
    }
    if (!result.ok) {
      if (append && result.problem.code === "stale_cursor") {
        nextCursor = undefined;
        directory.announcement.textContent =
          "The people list changed. Showing current results.";
        await load(false);
        return;
      }
      renderError(directory, result.problem);
      return;
    }
    directory.state.hidden = true;
    directory.error.hidden = true;
    if (!append) {
      directory.list.replaceChildren();
      updateLocation(directory, defaultSort);
    }
    directory.list.append(
      ...result.value.people.map((person) => personItem(person, nameOrder)),
    );
    nextCursor = result.value.nextCursor;
    const count = directory.list.children.length;
    directory.empty.hidden = count > 0;
    directory.list.hidden = count === 0;
    directory.loadMore.hidden = !nextCursor;
    if (count === 0) emptyCopy(directory, selectedLifecycle);
    directory.announcement.textContent = count === 0
      ? "No people found."
      : `${count} ${selectedLifecycle} ${
        count === 1 ? "person" : "people"
      } shown.`;
  };

  directory.form.addEventListener("submit", (event) => {
    event.preventDefault();
    nextCursor = undefined;
    void load(false);
  });
  directory.loadMore.addEventListener("click", () => void load(true));
  directory.retry.addEventListener("click", () => void load(false));
  directory.tag.addEventListener("change", () => {
    directory.tag.dataset.initialValue = directory.tag.value;
  });
  directory.tagSearchButton.addEventListener("click", () => {
    tagCursor = undefined;
    void loadTags(false);
  });
  directory.tagMore.addEventListener("click", () => void loadTags(true));
  await Promise.all([load(false), loadTags(false)]);
}
