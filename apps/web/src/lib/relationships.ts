import {
  createRelatedPersonRelationship,
  createRelationship,
  deleteRelationship,
  listPeople,
  listRelationships,
  listRelationshipTypes,
  type Relationship,
  type RelationshipDisplay,
  type RelationshipType,
  updateRelationship,
} from "../../../../packages/contracts/generated/auth-client.ts";

interface Elements {
  readonly add: HTMLButtonElement;
  readonly badge: HTMLElement;
  readonly form: HTMLFormElement;
  readonly duplicateChoices: HTMLElement;
  readonly createAnyway: HTMLButtonElement;
  readonly list: HTMLUListElement;
  readonly loadMore: HTMLButtonElement;
  readonly previous: HTMLButtonElement;
  readonly section: HTMLElement;
  readonly state: HTMLElement;
  readonly target: HTMLSelectElement;
  readonly selectExisting: HTMLButtonElement;
  readonly type: HTMLSelectElement;
  readonly typeNext: HTMLButtonElement;
  readonly typePrevious: HTMLButtonElement;
  readonly typeSearch: HTMLInputElement;
  readonly typeSearchButton: HTMLButtonElement;
}

function elements(): Elements | undefined {
  const section = document.querySelector<HTMLElement>(
    "#profile-section-relationships",
  );
  const badge = document.querySelector<HTMLElement>("#relationships-badge");
  const state = document.querySelector<HTMLElement>("#relationships-state");
  const list = document.querySelector<HTMLUListElement>("#relationships-list");
  const add = document.querySelector<HTMLButtonElement>("#relationship-add");
  const loadMore = document.querySelector<HTMLButtonElement>(
    "#relationships-load-more",
  );
  const previous = document.querySelector<HTMLButtonElement>(
    "#relationships-previous",
  );
  const form = document.querySelector<HTMLFormElement>("#relationship-form");
  const target = document.querySelector<HTMLSelectElement>(
    "#relationship-target",
  );
  const duplicateChoices = document.querySelector<HTMLElement>(
    "#relationship-duplicate-choices",
  );
  const selectExisting = document.querySelector<HTMLButtonElement>(
    "#relationship-select-existing",
  );
  const createAnyway = document.querySelector<HTMLButtonElement>(
    "#relationship-create-anyway",
  );
  const type = document.querySelector<HTMLSelectElement>("#relationship-type");
  const typeNext = document.querySelector<HTMLButtonElement>(
    "#relationship-types-next",
  );
  const typePrevious = document.querySelector<HTMLButtonElement>(
    "#relationship-types-previous",
  );
  const typeSearch = document.querySelector<HTMLInputElement>(
    "#relationship-type-search",
  );
  const typeSearchButton = document.querySelector<HTMLButtonElement>(
    "#relationship-type-search-button",
  );
  return section && badge && state && list && loadMore && previous && add &&
      form && target && type && typeNext && typePrevious && typeSearch &&
      typeSearchButton && duplicateChoices && selectExisting && createAnyway
    ? {
      add,
      badge,
      createAnyway,
      duplicateChoices,
      form,
      list,
      loadMore,
      previous,
      section,
      selectExisting,
      state,
      target,
      type,
      typeNext,
      typePrevious,
      typeSearch,
      typeSearchButton,
    }
    : undefined;
}

function option(
  select: HTMLSelectElement,
  value: string,
  label: string,
  disabled = false,
) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  item.disabled = disabled;
  select.append(item);
}

function displayName(
  person: {
    readonly familyName?: string;
    readonly givenName: string;
    readonly nickname?: string;
  },
) {
  return [person.givenName, person.familyName].filter(Boolean).join(" ") ||
    person.nickname || "Unnamed person";
}

function problemState(status: number) {
  return status === 401 || status === 403 ? "forbidden" : "error";
}

function normalizePersonRevision(value: unknown): string | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return;
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/,
  );
  if (!match) return;
  return `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}Z`;
}
let removeActiveLifecycleListener: (() => void) | undefined;

export async function mountRelationships(
  personId: string,
  workspaceId: string,
  archived: boolean,
  hidden = false,
  initialPersonUpdatedAt = "",
): Promise<void> {
  const ui = elements();
  if (!ui) return;
  removeActiveLifecycleListener?.();
  removeActiveLifecycleListener = undefined;
  const mountGeneration = String(
    Number(ui.section.dataset.relationshipMountGeneration ?? "0") + 1,
  );
  ui.section.dataset.relationshipMountGeneration = mountGeneration;
  const isCurrentMount = () =>
    ui.section.dataset.relationshipMountGeneration === mountGeneration;
  if (hidden) {
    ui.list.replaceChildren();
    ui.form.reset();
    ui.form.hidden = true;
    ui.duplicateChoices.hidden = true;
    ui.add.hidden = true;
    ui.add.disabled = true;
    for (const control of ui.form.elements) {
      if (
        control instanceof HTMLButtonElement ||
        control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement
      ) control.disabled = true;
    }
    ui.section.hidden = true;
    ui.section.dataset.sectionState = "hidden";
    document.querySelector<HTMLElement>("#main-content")?.focus();
    return;
  }
  ui.section.hidden = false;
  type RelatedDraft = {
    readonly familyName: string;
    readonly givenName: string;
    readonly relationshipTypeId: string;
  };
  type ListState = "error" | "forbidden" | "loading" | "ready";
  type RelationshipStatus = "archived" | "hidden" | "ready";
  type TypeState = "error" | "hidden" | "loading" | "ready";
  type PeopleSearchState = "error" | "idle" | "loading";
  let currentStatus: RelationshipStatus = archived ? "archived" : "ready";
  let listState: ListState = "loading";
  let listProblem = "";
  let typeState: TypeState = "loading";
  let typeProblem = "";
  let duplicateDraft: RelatedDraft | undefined;
  let types: readonly RelationshipType[] = [];
  let selectedTypes = new Map<string, RelationshipType>();
  let current:
    readonly (Relationship & { readonly display: RelationshipDisplay })[] = [];
  let currentCursor: string | undefined;
  let nextCursor: string | undefined;
  const previousCursors: (string | undefined)[] = [];
  let typeCursor: string | undefined;
  let typeNextCursor: string | undefined;
  const typePreviousCursors: (string | undefined)[] = [];
  let typeSearch = "";
  let listRequestGeneration = 0;
  let typeRequestGeneration = 0;
  let restoreOpenFormAfterTypeLoad = false;
  let peopleSearchGeneration = 0;
  let peopleSearchState: PeopleSearchState = "idle";
  let peopleSearchProblem = "";
  let lifecycleRevision = normalizePersonRevision(initialPersonUpdatedAt) ?? "";
  const populateTypes = (
    select: HTMLSelectElement,
    selectedId = "",
    currentType?: RelationshipType,
  ) => {
    const descriptors = new Map<string, RelationshipType>();
    for (const type of types) descriptors.set(type.id, type);
    for (const type of selectedTypes.values()) descriptors.set(type.id, type);
    if (currentType) descriptors.set(currentType.id, currentType);
    select.replaceChildren();
    option(select, "", "Select relationship type");
    for (const type of descriptors.values()) {
      option(
        select,
        type.id,
        `${type.forwardLabel} / ${type.reverseLabel}${
          type.archived ? " (archived)" : ""
        }`,
        type.archived,
      );
    }
    select.value = selectedId;
  };
  const render = (
    relationships:
      readonly (Relationship & { readonly display: RelationshipDisplay })[],
  ) => {
    ui.list.replaceChildren();
    if (relationships.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "No relationships saved.";
      ui.list.append(empty);
    }
    for (const relationship of relationships) {
      const item = document.createElement("li");
      item.dataset.relationshipId = relationship.id;
      const name = relationship.display.name ?? "Related person";
      const text = document.createElement("p");
      text.textContent = `${relationship.display.label}: ${name}`;
      item.append(text);
      if (
        listState === "ready" && currentStatus === "ready" &&
        typeState === "ready"
      ) {
        const editor = document.createElement("select");
        editor.ariaLabel = `Relationship type for ${name}`;
        populateTypes(editor, relationship.relationshipTypeId, {
          archived: relationship.relationshipTypeArchived,
          forwardLabel: relationship.forwardLabel,
          id: relationship.relationshipTypeId,
          reverseLabel: relationship.reverseLabel,
        });
        const save = document.createElement("button");
        save.type = "button";
        save.textContent = `Save relationship with ${name}`;
        const selectable = () =>
          Boolean(editor.value) && !editor.selectedOptions[0]?.disabled;
        save.disabled = !selectable();
        editor.onchange = () => save.disabled = !selectable();
        save.onclick = async () => {
          if (!selectable()) {
            ui.state.textContent =
              "Choose an active relationship type before saving.";
            ui.state.focus();
            return;
          }
          const result = await updateRelationship(personId, relationship.id, {
            expectedUpdatedAt: relationship.updatedAt,
            relationshipTypeId: editor.value,
          }, workspaceId).catch(() => undefined);
          if (!result || !result.ok) {
            ui.state.textContent = result && !result.ok
              ? result.problem.detail
              : "Relationship change is temporarily unavailable.";
            ui.state.focus();
            return;
          }
          await load();
          if (
            listState === "ready" && currentStatus === "ready" &&
            typeState === "ready"
          ) {
            ui.state.textContent =
              "Relationship updated on both person workspaces.";
            ui.state.focus();
          }
        };
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = `Unlink ${name}`;
        remove.onclick = async () => {
          const result = await deleteRelationship(personId, relationship.id, {
            expectedUpdatedAt: relationship.updatedAt,
          }, workspaceId).catch(() => undefined);
          if (!isCurrentMount()) return;
          if (!result || !result.ok) {
            ui.state.textContent = result && !result.ok
              ? result.problem.detail
              : "Unlink is temporarily unavailable.";
            ui.state.focus();
            return;
          }
          await load();
          if (!isCurrentMount()) return;
          if (
            listState === "ready" && currentStatus === "ready" &&
            typeState === "ready"
          ) {
            ui.state.textContent =
              "People unlinked. Neither person was deleted.";
            ui.state.focus();
          }
        };
        item.append(editor, save, remove);
      }
      ui.list.append(item);
    }
  };
  const disableForm = (disabled: boolean) => {
    for (const control of ui.form.elements) {
      if (
        control instanceof HTMLButtonElement ||
        control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement
      ) control.disabled = disabled;
    }
  };
  const disablePeopleSelection = (disabled: boolean) => {
    ui.target.disabled = disabled;
    ui.createAnyway.disabled = disabled;
    ui.selectExisting.disabled = disabled;
    for (
      const control of ui.form.querySelectorAll<
        HTMLButtonElement | HTMLInputElement
      >(
        'button[type="submit"], input[name="newGivenName"], input[name="newFamilyName"]',
      )
    ) control.disabled = disabled;
  };
  const cancelPeopleSearch = () => {
    peopleSearchGeneration++;
    peopleSearchState = "idle";
    peopleSearchProblem = "";
  };
  const clearDraftState = () => {
    cancelPeopleSearch();
    duplicateDraft = undefined;
    ui.form.reset();
    ui.form.hidden = true;
    ui.duplicateChoices.hidden = true;
    ui.target.replaceChildren();
    option(ui.target, "", "Select existing person");
    ui.type.replaceChildren();
    option(ui.type, "", "Select relationship type");
    types = [];
    selectedTypes.clear();
    typeCursor = undefined;
    typeNextCursor = undefined;
    typePreviousCursors.length = 0;
    typeSearch = "";
  };
  const clearSensitiveState = () => {
    clearDraftState();
    ui.list.replaceChildren();
    current = [];
    currentCursor = undefined;
    nextCursor = undefined;
    previousCursors.length = 0;
  };
  const invalidateRequests = () => {
    listRequestGeneration++;
    typeRequestGeneration++;
    cancelPeopleSearch();
    restoreOpenFormAfterTypeLoad = false;
  };
  const applySectionState = () => {
    const concealed = currentStatus === "hidden" || typeState === "hidden";
    if (concealed) {
      clearSensitiveState();
      disableForm(true);
      ui.section.hidden = true;
      ui.section.dataset.sectionState = "hidden";
      ui.badge.textContent = "Hidden";
      ui.add.hidden = true;
      ui.add.disabled = true;
      ui.loadMore.hidden = true;
      ui.previous.hidden = true;
      document.querySelector<HTMLElement>("#main-content")?.focus();
      return;
    }
    ui.section.hidden = false;
    const readOnly = listState === "ready" && currentStatus === "archived";
    const typesUnavailable = typeState === "error";
    const writesReady = listState === "ready" && currentStatus === "ready" &&
      typeState === "ready";
    disableForm(!writesReady);
    ui.type.disabled = !writesReady;
    ui.add.hidden = !writesReady;
    ui.add.disabled = !writesReady;
    if (!writesReady) {
      ui.form.hidden = true;
      ui.duplicateChoices.hidden = true;
      duplicateDraft = undefined;
      ui.typeNext.hidden = true;
      ui.typePrevious.hidden = true;
    } else {
      ui.typeNext.hidden = !typeNextCursor;
      ui.typePrevious.hidden = typePreviousCursors.length === 0;
    }
    if (listState === "error" || listState === "forbidden") {
      cancelPeopleSearch();
      ui.section.dataset.sectionState = listState;
      ui.badge.textContent = listState === "forbidden"
        ? "Unavailable"
        : "Try again";
      ui.state.textContent = listProblem;
      ui.state.focus();
      return;
    }
    if (readOnly) {
      cancelPeopleSearch();
      ui.section.dataset.sectionState = "read-only";
      ui.badge.textContent = "Read-only";
      ui.state.textContent =
        "Relationships are read-only because this person is archived.";
      ui.state.focus();
      return;
    }
    if (typesUnavailable) {
      cancelPeopleSearch();
      ui.section.dataset.sectionState = "error";
      ui.badge.textContent = "Unavailable";
      ui.state.textContent = typeProblem;
      ui.state.focus();
      return;
    }
    if (listState === "loading" || typeState === "loading") {
      ui.section.dataset.sectionState = "loading";
      ui.badge.textContent = "Loading";
      ui.state.textContent = "Loading relationships…";
      return;
    }
    if (peopleSearchState === "loading") {
      disablePeopleSelection(true);
      ui.section.dataset.sectionState = "loading";
      ui.badge.textContent = "Searching";
      ui.state.textContent = "Searching people…";
      return;
    }
    if (peopleSearchState === "error") {
      disablePeopleSelection(true);
      ui.section.dataset.sectionState = "error";
      ui.badge.textContent = "Unavailable";
      ui.state.textContent = peopleSearchProblem;
      ui.state.focus();
      return;
    }
    disablePeopleSelection(false);
    ui.section.dataset.sectionState = "ready";
    ui.badge.textContent = "Ready";
    ui.state.textContent = current.length
      ? `${current.length} relationship${current.length === 1 ? "" : "s"}.`
      : "";
  };
  const load = async (cursor?: string) => {
    const requestGeneration = ++listRequestGeneration;
    listState = "loading";
    render(current);
    applySectionState();
    const result = await listRelationships(
      personId,
      { ...(cursor ? { cursor } : {}), limit: 20 },
      workspaceId,
    ).catch(() => undefined);
    if (
      !isCurrentMount() || requestGeneration !== listRequestGeneration
    ) return false;
    if (!result || !result.ok) {
      const state = result && !result.ok
        ? problemState(result.problem.status)
        : "error";
      listState = state === "forbidden" ? "forbidden" : "error";
      listProblem = state === "forbidden"
        ? "Your active workspace no longer permits this action."
        : "This relationship section is temporarily unavailable. Try again.";
      render(current);
      applySectionState();
      return true;
    }
    listState = "ready";
    currentStatus = result.value.status;
    current = result.value.relationships;
    currentCursor = cursor;
    nextCursor = result.value.nextCursor;
    render(current);
    ui.loadMore.hidden = !nextCursor;
    ui.previous.hidden = previousCursors.length === 0;
    applySectionState();
    return true;
  };
  ui.loadMore.onclick = async () => {
    if (!nextCursor) return;
    previousCursors.push(currentCursor);
    if (await load(nextCursor)) ui.list.focus();
  };
  ui.previous.onclick = async () => {
    if (previousCursors.length === 0) return;
    if (await load(previousCursors.pop())) ui.list.focus();
  };
  const loadTypes = async (cursor?: string) => {
    const requestGeneration = ++typeRequestGeneration;
    restoreOpenFormAfterTypeLoad ||= !ui.form.hidden;
    const selected = [
      ...new Set([
        ui.type.value,
        ...current.map((relationship) => relationship.relationshipTypeId),
      ].filter(Boolean)),
    ].slice(0, 20);
    typeState = "loading";
    render(current);
    applySectionState();
    const result = await listRelationshipTypes({
      ...(cursor ? { cursor } : {}),
      ...(typeSearch ? { search: typeSearch } : {}),
      ...(selected.length ? { selected } : {}),
    }, workspaceId).catch(() => undefined);
    if (
      !isCurrentMount() || requestGeneration !== typeRequestGeneration
    ) return false;
    if (!result || !result.ok) {
      restoreOpenFormAfterTypeLoad = false;
      typeState = "error";
      typeProblem = result && !result.ok
        ? result.problem.detail
        : "Relationship types are temporarily unavailable.";
      types = [];
      selectedTypes.clear();
      render(current);
      applySectionState();
      return false;
    }
    if (result.value.status === "hidden") {
      restoreOpenFormAfterTypeLoad = false;
      typeState = "hidden";
      applySectionState();
      return false;
    }
    typeState = "ready";
    typeProblem = "";
    const retained = ui.type.value;
    types = result.value.options;
    selectedTypes = new Map((result.value.selected ?? []).map((type) => [
      type.id,
      type,
    ]));
    typeCursor = cursor;
    typeNextCursor = result.value.nextCursor;
    populateTypes(ui.type, retained);
    ui.typeNext.hidden = !typeNextCursor;
    ui.typePrevious.hidden = typePreviousCursors.length === 0;
    render(current);
    applySectionState();
    if (
      restoreOpenFormAfterTypeLoad && listState === "ready" &&
      currentStatus === "ready" && typeState === "ready"
    ) ui.form.hidden = false;
    restoreOpenFormAfterTypeLoad = false;
    return true;
  };
  ui.typeNext.onclick = async () => {
    if (!typeNextCursor) return;
    typePreviousCursors.push(typeCursor);
    if (await loadTypes(typeNextCursor)) ui.type.focus();
  };
  ui.typePrevious.onclick = async () => {
    if (typePreviousCursors.length === 0) return;
    if (await loadTypes(typePreviousCursors.pop())) ui.type.focus();
  };
  ui.typeSearchButton.onclick = async () => {
    typeSearch = ui.typeSearch.value.trim();
    typeCursor = undefined;
    typePreviousCursors.length = 0;
    if (await loadTypes(undefined)) ui.type.focus();
  };
  ui.add.onclick = () => {
    ui.form.hidden = false;
    ui.form.querySelector<HTMLElement>("input, select")?.focus();
  };
  const cancel = ui.form.querySelector<HTMLButtonElement>(
    "#relationship-cancel",
  );
  if (cancel) {
    cancel.onclick = () => {
      cancelPeopleSearch();
      duplicateDraft = undefined;
      ui.duplicateChoices.hidden = true;
      ui.form.reset();
      ui.form.hidden = true;
      ui.add.focus();
    };
  }
  const search = ui.form.querySelector<HTMLInputElement>(
    "#relationship-person-search",
  );
  const searchButton = ui.form.querySelector<HTMLButtonElement>(
    "#relationship-person-search-button",
  );
  const findPeople = async (term: string) => {
    const requestGeneration = ++peopleSearchGeneration;
    peopleSearchState = "loading";
    peopleSearchProblem = "";
    applySectionState();
    const result = await listPeople({
      excludePersonId: personId,
      limit: 20,
      search: term,
    }, workspaceId).catch(() => undefined);
    if (
      !isCurrentMount() || requestGeneration !== peopleSearchGeneration
    ) return;
    if (
      listState !== "ready" || currentStatus !== "ready" ||
      typeState !== "ready" || ui.form.hidden
    ) {
      peopleSearchState = "idle";
      return;
    }
    ui.target.replaceChildren();
    option(ui.target, "", "Select existing person");
    if (!result?.ok) {
      peopleSearchState = "error";
      peopleSearchProblem =
        "People search is temporarily unavailable. Try again.";
      applySectionState();
      return;
    }
    for (const person of result.value.people) {
      option(ui.target, person.id, displayName(person));
    }
    peopleSearchState = "idle";
    applySectionState();
    ui.target.focus();
  };
  if (search && searchButton) {
    searchButton.onclick = () => findPeople(search.value);
  }
  const onLifecycleChanged = (event: Event) => {
    if (!isCurrentMount()) return;
    const detail = (event as CustomEvent<{
      readonly archived?: unknown;
      readonly personId?: unknown;
      readonly personUpdatedAt?: unknown;
      readonly state?: unknown;
    }>).detail;
    const eventRevision = normalizePersonRevision(detail?.personUpdatedAt);
    if (
      detail?.personId !== personId ||
      (detail.state !== "active" && detail.state !== "archived") ||
      detail.archived !== (detail.state === "archived") ||
      !eventRevision ||
      (lifecycleRevision && eventRevision <= lifecycleRevision)
    ) return;
    lifecycleRevision = eventRevision;
    invalidateRequests();
    clearDraftState();
    currentCursor = undefined;
    nextCursor = undefined;
    previousCursors.length = 0;
    ui.loadMore.hidden = true;
    ui.previous.hidden = true;
    if (detail.state === "archived") {
      currentStatus = "archived";
      listState = "ready";
      typeState = "loading";
      render(current);
      applySectionState();
      return;
    }
    currentStatus = "ready";
    listState = "loading";
    typeState = "loading";
    render(current);
    applySectionState();
    void Promise.all([loadTypes(undefined), load(undefined)]);
  };
  document.addEventListener("person-lifecycle-changed", onLifecycleChanged);
  removeActiveLifecycleListener = () =>
    document.removeEventListener(
      "person-lifecycle-changed",
      onLifecycleChanged,
    );
  const saveRelatedPerson = async (
    draft: RelatedDraft,
    duplicateOverride = false,
  ) => {
    const created = await createRelatedPersonRelationship(personId, {
      person: {
        ...(duplicateOverride ? { duplicateOverride: true } : {}),
        givenName: draft.givenName,
        ...(draft.familyName ? { familyName: draft.familyName } : {}),
        isPartial: !draft.givenName,
      },
      relationshipTypeId: draft.relationshipTypeId,
    }, workspaceId).catch(() => undefined);
    if (
      created && !created.ok &&
      created.problem.code === "related_person_possible_duplicate"
    ) {
      duplicateDraft = draft;
      ui.duplicateChoices.hidden = false;
      ui.state.textContent =
        "A person with this name may already exist. Select the existing person or explicitly create another.";
      ui.selectExisting.focus();
      return;
    }
    if (!created || !created.ok) {
      ui.state.textContent = created && !created.ok
        ? created.problem.detail
        : "Related person creation is temporarily unavailable.";
      ui.state.focus();
      return;
    }
    duplicateDraft = undefined;
    ui.duplicateChoices.hidden = true;
    ui.form.hidden = true;
    ui.form.reset();
    await load();
    if (
      listState === "ready" && currentStatus === "ready" &&
      typeState === "ready"
    ) {
      ui.state.textContent =
        "Related person and relationship saved together on both person workspaces.";
      ui.state.focus();
    }
  };
  ui.selectExisting.onclick = async () => {
    if (!duplicateDraft) return;
    ui.duplicateChoices.hidden = true;
    await findPeople(
      [duplicateDraft.givenName, duplicateDraft.familyName].filter(Boolean)
        .join(" "),
    );
  };
  ui.createAnyway.onclick = async () => {
    if (!duplicateDraft) return;
    ui.duplicateChoices.hidden = true;
    await saveRelatedPerson(duplicateDraft, true);
  };
  ui.form.onsubmit = async (event) => {
    event.preventDefault();
    if (
      listState !== "ready" || currentStatus !== "ready" ||
      typeState !== "ready" || peopleSearchState !== "idle"
    ) {
      applySectionState();
      ui.state.focus();
      return;
    }
    const data = new FormData(ui.form);
    const targetPersonId = String(data.get("targetPersonId") ?? "");
    const newGivenName = String(data.get("newGivenName") ?? "").trim();
    const newFamilyName = String(data.get("newFamilyName") ?? "").trim();
    const relationshipTypeId = String(data.get("relationshipTypeId") ?? "");
    const selectedType = ui.type.selectedOptions[0];
    if (!targetPersonId && (newGivenName || newFamilyName)) {
      if (!relationshipTypeId || selectedType?.disabled) {
        ui.state.textContent = "Choose an active relationship type.";
        ui.state.focus();
        return;
      }
      await saveRelatedPerson({
        familyName: newFamilyName,
        givenName: newGivenName,
        relationshipTypeId,
      });
      return;
    }
    if (!targetPersonId || !relationshipTypeId || selectedType?.disabled) {
      ui.state.textContent =
        "Choose or create another person and select a relationship type.";
      ui.state.focus();
      return;
    }
    const result = await createRelationship(personId, {
      relationshipTypeId,
      targetPersonId,
    }, workspaceId).catch(() => undefined);
    if (!result || !result.ok) {
      ui.state.textContent = result && !result.ok
        ? result.problem.detail
        : "Relationship creation is temporarily unavailable.";
      ui.state.focus();
      return;
    }
    ui.form.hidden = true;
    ui.form.reset();
    await load();
    if (
      listState === "ready" && currentStatus === "ready" &&
      typeState === "ready"
    ) {
      ui.state.textContent = result.value.status === "existing"
        ? "That relationship already exists."
        : "Relationship saved on both person workspaces.";
      ui.state.focus();
    }
  };
  await loadTypes(undefined);
  await load(undefined);
}
