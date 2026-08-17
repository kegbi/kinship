import {
  type ActivityOrNoteInteraction,
  getActivityReport,
  getTodayFavoriteNotes,
  getTodayRecentActivity,
  listInteractionOptions,
  listPeople,
  recordInteraction,
} from "../../../../packages/contracts/generated/auth-client.ts";
import {
  resolveWorkspaceSession,
  WORKSPACE_CHANGE_REQUEST_EVENT,
} from "./workspace-context.ts";

const INTERACTION_CREATED_EVENT = "kinship:interaction-created";
let captureAbort: AbortController | undefined;
let todayAbort: AbortController | undefined;
let reportAbort: AbortController | undefined;
let personAbort: AbortController | undefined;

function localDateTime(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function profilePersonId(): string | undefined {
  return /^\/app\/people\/([0-9a-f-]{36})(?:\/activity-report)?\/?$/i
    .exec(globalThis.location.pathname)?.[1];
}

function setDialogOpen(dialog: HTMLDialogElement, open: boolean): void {
  if (open) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  } else if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function option(value: string, label: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function displayName(person: {
  readonly familyName?: string;
  readonly givenName: string;
  readonly nickname?: string;
}): string {
  return [person.givenName, person.familyName].filter(Boolean).join(" ") ||
    person.nickname || "Unnamed person";
}

function renderOptionPage(
  select: HTMLSelectElement,
  records: readonly { readonly id: string; readonly name: string }[],
  blank?: string,
): void {
  const selected = new Map(
    [...select.selectedOptions].map((
      entry,
    ) => [entry.value, entry.textContent ?? entry.value]),
  );
  const values = new Map(records.map((entry) => [entry.id, entry.name]));
  for (const [id, name] of selected) values.set(id, name);
  select.replaceChildren(
    ...(blank === undefined ? [] : [option("", blank)]),
    ...[...values].slice(0, 70).map(([id, name]) => option(id, name)),
  );
  for (const entry of select.options) {
    entry.selected = selected.has(entry.value);
  }
}

export async function mountInteractionCapture(): Promise<void> {
  const dialog = document.querySelector<HTMLDialogElement>(
    "#interaction-capture-dialog",
  );
  const form = document.querySelector<HTMLFormElement>(
    "#interaction-capture-form",
  );
  const status = document.querySelector<HTMLElement>(
    "#interaction-capture-status",
  );
  const openers = [...document.querySelectorAll<HTMLButtonElement>(
    "[data-quick-capture]",
  )];
  if (!dialog || !form || !status || openers.length === 0) return;
  captureAbort?.abort();
  const abort = new AbortController();
  captureAbort = abort;
  const signal = abort.signal;
  const fields = form.elements;
  const kind = fields.namedItem("kind") as HTMLSelectElement;
  const participants = fields.namedItem("participantIds") as HTMLSelectElement;
  const happenedAt = fields.namedItem("happenedAt") as HTMLInputElement;
  const happenedAtError = form.querySelector<HTMLElement>(
    "#interaction-happened-at-error",
  );
  const occurrence = form.querySelector<HTMLElement>(
    "[data-interaction-occurrence]",
  ) ?? happenedAt.closest("label");
  const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const activityFields = form.querySelector<HTMLElement>(
    '[data-interaction-kind="activity"]',
  )!;
  const noteFields = form.querySelector<HTMLElement>(
    '[data-interaction-kind="note"]',
  )!;
  const activityType = fields.namedItem("activityTypeId") as HTMLSelectElement;
  const emotionIds = fields.namedItem("emotionIds") as HTMLSelectElement;
  const participantSearch = fields.namedItem("participantSearch") as
    | HTMLInputElement
    | null;
  const activityTypeSearch = fields.namedItem("activityTypeSearch") as
    | HTMLInputElement
    | null;
  const emotionSearch = fields.namedItem("emotionSearch") as
    | HTMLInputElement
    | null;
  const participantsMore = form.querySelector<HTMLButtonElement>(
    "[data-participants-more]",
  );
  const activityTypesMore = form.querySelector<HTMLButtonElement>(
    "[data-activity-types-more]",
  );
  const emotionsMore = form.querySelector<HTMLButtonElement>(
    "[data-emotions-more]",
  );
  let dirty = false;
  let saving = false;
  let requestId = crypto.randomUUID();
  let participantCursor: string | undefined;
  let activityTypeCursor: string | undefined;
  let emotionCursor: string | undefined;
  type SelectorLoadState = {
    cursorSearch: string;
    generation: number;
  };
  const participantLoad: SelectorLoadState = {
    cursorSearch: "",
    generation: 0,
  };
  const activityTypeLoad: SelectorLoadState = {
    cursorSearch: "",
    generation: 0,
  };
  const emotionLoad: SelectorLoadState = { cursorSearch: "", generation: 0 };
  const searchValue = (input: HTMLInputElement | null): string =>
    input?.value.trim() ?? "";
  const beginSelectorLoad = (
    state: SelectorLoadState,
    input: HTMLInputElement | null,
  ) => ({ generation: ++state.generation, search: searchValue(input) });
  const selectorLoadIsCurrent = (
    state: SelectorLoadState,
    request: { readonly generation: number; readonly search: string },
    input: HTMLInputElement | null,
  ): boolean =>
    !signal.aborted && request.generation === state.generation &&
    request.search === searchValue(input);
  let availability = { activity: false, note: false };
  for (const opener of openers) {
    opener.disabled = true;
    opener.dataset.interactionCaptureReady = "false";
  }

  const setKind = () => {
    const note = kind.value === "note";
    const firstSelected = participants.selectedOptions[0]?.value;
    activityFields.hidden = note;
    noteFields.hidden = !note;
    if (occurrence) occurrence.hidden = note;
    happenedAt.disabled = note;
    happenedAt.required = !note;
    if (note) {
      happenedAt.removeAttribute("aria-invalid");
      if (happenedAtError) happenedAtError.textContent = "";
    }
    participants.multiple = !note;
    if (note && firstSelected) participants.value = firstSelected;
  };
  kind.addEventListener("change", () => {
    dirty = true;
    setKind();
  }, { signal });
  form.addEventListener("input", () => dirty = true, { signal });
  globalThis.addEventListener(WORKSPACE_CHANGE_REQUEST_EVENT, (event) => {
    if (dirty || saving) event.preventDefault();
  }, { signal });

  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") {
    status.textContent = session.status === "access-lost"
      ? "Sign in again before recording an interaction."
      : "Quick capture is temporarily unavailable.";
    for (const opener of openers) opener.disabled = true;
    return;
  }
  const workspaceId = session.session.workspace.id;
  const preferred = profilePersonId();
  const [people, interactionOptions] = await Promise.all([
    listPeople({
      limit: 20,
      ...(preferred ? { selectedPersonId: preferred } : {}),
    }, workspaceId).catch(() => undefined),
    listInteractionOptions({ limit: 20 }, workspaceId).catch(() => undefined),
  ]);
  if (signal.aborted) return;
  if (!people?.ok || !interactionOptions?.ok) {
    status.textContent =
      "Quick capture options could not be loaded. Reload to try again.";
    for (const opener of openers) opener.disabled = true;
    return;
  }
  const initialPeople = [
    ...people.value.people.map((person) => ({
      id: person.id,
      name: displayName(person),
    })),
    ...(people.value.selected
      ? [{
        id: people.value.selected.id,
        name: displayName(people.value.selected),
      }]
      : []),
  ];
  renderOptionPage(participants, initialPeople);
  renderOptionPage(
    activityType,
    interactionOptions.value.activityTypes,
    "No category",
  );
  renderOptionPage(emotionIds, interactionOptions.value.emotions);
  participantCursor = people.value.nextCursor;
  activityTypeCursor = interactionOptions.value.activityTypesNextCursor;
  emotionCursor = interactionOptions.value.emotionsNextCursor;
  participantLoad.cursorSearch = "";
  activityTypeLoad.cursorSearch = "";
  emotionLoad.cursorSearch = "";
  availability = interactionOptions.value.availability;
  if (participantsMore) participantsMore.hidden = !participantCursor;
  if (activityTypesMore) activityTypesMore.hidden = !activityTypeCursor;
  if (emotionsMore) emotionsMore.hidden = !emotionCursor;
  for (const entry of kind.options) {
    entry.disabled = entry.value === "activity"
      ? !availability.activity
      : !availability.note;
  }
  if (!availability.activity && availability.note) kind.value = "note";
  if (availability.activity) kind.value = "activity";
  happenedAt.value = localDateTime();
  if (preferred) {
    const selected = [...participants.options].find((entry) =>
      entry.value === preferred
    );
    if (selected) selected.selected = true;
  }
  setKind();

  let activeOpener: HTMLButtonElement | undefined;
  const resetDraft = () => {
    form.reset();
    renderOptionPage(participants, initialPeople);
    renderOptionPage(
      activityType,
      interactionOptions.value.activityTypes,
      "No category",
    );
    renderOptionPage(emotionIds, interactionOptions.value.emotions);
    participantCursor = people.value.nextCursor;
    activityTypeCursor = interactionOptions.value.activityTypesNextCursor;
    emotionCursor = interactionOptions.value.emotionsNextCursor;
    participantLoad.cursorSearch = "";
    activityTypeLoad.cursorSearch = "";
    emotionLoad.cursorSearch = "";
    if (participantsMore) participantsMore.hidden = !participantCursor;
    if (activityTypesMore) activityTypesMore.hidden = !activityTypeCursor;
    if (emotionsMore) emotionsMore.hidden = !emotionCursor;
    kind.value = availability.activity ? "activity" : "note";
    happenedAt.value = localDateTime();
    if (preferred) {
      const selected = [...participants.options].find((entry) =>
        entry.value === preferred
      );
      if (selected) selected.selected = true;
    }
    happenedAt.removeAttribute("aria-invalid");
    if (happenedAtError) happenedAtError.textContent = "";
    status.textContent = "";
    requestId = crypto.randomUUID();
    dirty = false;
    setKind();
  };
  const dismissCapture = () => {
    if (saving) return;
    if (dirty && !globalThis.confirm("Discard this unsaved interaction?")) {
      return;
    }
    setDialogOpen(dialog, false);
    resetDraft();
    activeOpener?.focus();
  };

  const loadPeoplePage = async (cursor?: string) => {
    const request = beginSelectorLoad(participantLoad, participantSearch);
    const result = await listPeople({
      ...(cursor ? { cursor } : {}),
      limit: 20,
      ...(request.search ? { search: request.search } : {}),
      ...(preferred ? { selectedPersonId: preferred } : {}),
    }, workspaceId).catch(() => undefined);
    if (
      !result?.ok ||
      !selectorLoadIsCurrent(participantLoad, request, participantSearch)
    ) return;
    renderOptionPage(participants, [
      ...result.value.people.map((person) => ({
        id: person.id,
        name: displayName(person),
      })),
      ...(result.value.selected
        ? [{
          id: result.value.selected.id,
          name: displayName(result.value.selected),
        }]
        : []),
    ]);
    participantCursor = result.value.nextCursor;
    participantLoad.cursorSearch = request.search;
    if (participantsMore) participantsMore.hidden = !participantCursor;
  };
  participantSearch?.addEventListener("change", () => {
    participantCursor = undefined;
    participantLoad.cursorSearch = searchValue(participantSearch);
    if (participantsMore) participantsMore.hidden = true;
    void loadPeoplePage();
  }, { signal });
  participantsMore?.addEventListener("click", () => {
    if (
      participantCursor &&
      participantLoad.cursorSearch === searchValue(participantSearch)
    ) void loadPeoplePage(participantCursor);
  }, { signal });

  const loadVocabulary = async (
    target: "activity-type" | "emotion",
    cursor?: string,
  ) => {
    const load = target === "activity-type" ? activityTypeLoad : emotionLoad;
    const search = target === "activity-type"
      ? activityTypeSearch
      : emotionSearch;
    const request = beginSelectorLoad(load, search);
    const result = await listInteractionOptions({
      ...(target === "activity-type"
        ? {
          ...(cursor ? { activityTypeCursor: cursor } : {}),
          ...(request.search ? { activityTypeSearch: request.search } : {}),
        }
        : {
          ...(cursor ? { emotionCursor: cursor } : {}),
          ...(request.search ? { emotionSearch: request.search } : {}),
        }),
      limit: 20,
    }, workspaceId).catch(() => undefined);
    if (!result?.ok || !selectorLoadIsCurrent(load, request, search)) return;
    if (target === "activity-type") {
      renderOptionPage(activityType, result.value.activityTypes, "No category");
      activityTypeCursor = result.value.activityTypesNextCursor;
      activityTypeLoad.cursorSearch = request.search;
      if (activityTypesMore) activityTypesMore.hidden = !activityTypeCursor;
    } else {
      renderOptionPage(emotionIds, result.value.emotions);
      emotionCursor = result.value.emotionsNextCursor;
      emotionLoad.cursorSearch = request.search;
      if (emotionsMore) emotionsMore.hidden = !emotionCursor;
    }
  };
  activityTypeSearch?.addEventListener("change", () => {
    activityTypeCursor = undefined;
    activityTypeLoad.cursorSearch = searchValue(activityTypeSearch);
    if (activityTypesMore) activityTypesMore.hidden = true;
    void loadVocabulary("activity-type");
  }, { signal });
  emotionSearch?.addEventListener("change", () => {
    emotionCursor = undefined;
    emotionLoad.cursorSearch = searchValue(emotionSearch);
    if (emotionsMore) emotionsMore.hidden = true;
    void loadVocabulary("emotion");
  }, { signal });
  activityTypesMore?.addEventListener("click", () => {
    if (
      activityTypeCursor &&
      activityTypeLoad.cursorSearch === searchValue(activityTypeSearch)
    ) {
      void loadVocabulary("activity-type", activityTypeCursor);
    }
  }, { signal });
  emotionsMore?.addEventListener("click", () => {
    if (
      emotionCursor && emotionLoad.cursorSearch === searchValue(emotionSearch)
    ) void loadVocabulary("emotion", emotionCursor);
  }, { signal });

  const openCapture = (
    opener: HTMLButtonElement,
    intended: "activity" | "note" | undefined,
  ) => {
    if (opener.disabled) return;
    if (
      dialog.open && activeOpener === opener &&
      (!intended || kind.value === intended)
    ) return;
    activeOpener = opener;
    if (intended && availability[intended]) {
      kind.value = intended;
      setKind();
    }
    status.textContent = "";
    setDialogOpen(dialog, true);
    kind.focus();
  };
  for (const opener of openers) {
    const intended = opener.dataset.interactionIntendedKind as
      | "activity"
      | "note"
      | undefined;
    opener.addEventListener("click", () => openCapture(opener, intended), {
      signal,
    });
    opener.addEventListener("keydown", (event) => {
      if (
        event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar"
      ) {
        return;
      }
      event.preventDefault();
      if (!event.repeat) openCapture(opener, intended);
    }, { signal });
    opener.dataset.interactionCaptureReady = "true";
    opener.disabled = Boolean(opener.hidden) ||
      (intended
        ? !availability[intended]
        : !availability.activity && !availability.note);
  }
  form.querySelector<HTMLButtonElement>("[data-interaction-cancel]")
    ?.addEventListener("click", dismissCapture, { signal });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismissCapture();
  }, { signal });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving) return;
    if (
      (kind.value === "activity" && !availability.activity) ||
      (kind.value === "note" && !availability.note)
    ) {
      status.textContent =
        "This interaction kind is hidden in workspace personalization.";
      kind.focus();
      return;
    }
    const selectedParticipants = [...participants.selectedOptions].map((
      entry,
    ) => entry.value);
    if (selectedParticipants.length === 0) {
      status.textContent = "Choose at least one participant.";
      participants.focus();
      return;
    }
    const occurrenceDate = kind.value === "activity"
      ? new Date(happenedAt.value)
      : undefined;
    if (
      kind.value === "activity" &&
      (!happenedAt.value || !occurrenceDate ||
        Number.isNaN(occurrenceDate.getTime()))
    ) {
      happenedAt.setAttribute("aria-invalid", "true");
      if (happenedAtError) {
        happenedAtError.textContent = "Enter a valid occurrence date and time.";
      }
      status.textContent = "Enter a valid occurrence date and time.";
      happenedAt.focus();
      return;
    }
    happenedAt.removeAttribute("aria-invalid");
    if (happenedAtError) happenedAtError.textContent = "";
    saving = true;
    submit.disabled = true;
    status.textContent = "Saving interaction…";
    try {
      const input = kind.value === "note"
        ? {
          body: (fields.namedItem("body") as HTMLTextAreaElement).value,
          isFavorited: (fields.namedItem("isFavorited") as HTMLInputElement)
            .checked,
          kind: "note" as const,
          personId: selectedParticipants[0]!,
          requestId,
        }
        : {
          ...(activityType.value ? { activityTypeId: activityType.value } : {}),
          ...((fields.namedItem("description") as HTMLTextAreaElement).value
            ? {
              description:
                (fields.namedItem("description") as HTMLTextAreaElement)
                  .value,
            }
            : {}),
          emotionIds: [...emotionIds.selectedOptions].map((entry) =>
            entry.value
          ),
          happenedAt: occurrenceDate!.toISOString(),
          kind: "activity" as const,
          participantIds: selectedParticipants,
          requestId,
          summary: (fields.namedItem("summary") as HTMLInputElement).value,
        };
      const result = await recordInteraction(input, workspaceId);
      if (!result.ok) {
        status.textContent = result.problem.detail;
        submit.focus();
        return;
      }
      dirty = false;
      requestId = crypto.randomUUID();
      status.textContent = result.value.record.kind === "note"
        ? "Note saved."
        : "Activity saved.";
      globalThis.dispatchEvent(
        new CustomEvent(INTERACTION_CREATED_EVENT, {
          detail: result.value.record,
        }),
      );
    } catch {
      status.textContent = "The interaction could not be saved. Try again.";
      submit.focus();
    } finally {
      saving = false;
      submit.disabled = false;
    }
  }, { signal });
}

function renderInteraction(entry: ActivityOrNoteInteraction): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "interaction-item";
  const heading = document.createElement("strong");
  heading.textContent = entry.kind === "activity" ? entry.summary : "Note";
  const detail = document.createElement("p");
  detail.textContent = entry.kind === "activity"
    ? [
      entry.participants.map((participant) => participant.name).join(", "),
      entry.activityType ? `Category: ${entry.activityType}` : "",
      entry.emotions?.length > 0
        ? `Emotions: ${
          entry.emotions.map((emotion) => emotion.name).join(", ")
        }`
        : "",
      entry.description,
    ].filter(Boolean).join(" · ")
    : `${
      entry.participants?.[0]?.name ?? entry.person?.name ?? "Person"
    } · ${entry.body}`;
  const timestamp = document.createElement("time");
  const value = entry.kind === "activity" ? entry.happenedAt : entry.createdAt;
  timestamp.dateTime = value;
  timestamp.textContent = value
    ? new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value))
    : "Recently";
  item.append(heading, detail, timestamp);
  return item;
}

export async function mountTodayInteractions(): Promise<void> {
  const favoriteRegion = document.querySelector<HTMLElement>(
    "#today-favorite-notes-region",
  );
  const favoriteState = document.querySelector<HTMLElement>(
    "#today-favorite-notes-state",
  );
  const favorites = document.querySelector<HTMLUListElement>(
    "#today-favorite-notes",
  );
  const favoriteRetry = document.querySelector<HTMLButtonElement>(
    "#today-favorite-notes-retry",
  );
  const recentState = document.querySelector<HTMLElement>(
    "#today-recent-activity-state",
  );
  const recent = document.querySelector<HTMLUListElement>(
    "#today-recent-activity",
  );
  const recentRetry = document.querySelector<HTMLButtonElement>(
    "#today-recent-activity-retry",
  );
  if (
    !favoriteRegion || !favoriteState || !favorites || !favoriteRetry ||
    !recentState || !recent || !recentRetry
  ) return;
  todayAbort?.abort();
  const abort = new AbortController();
  todayAbort = abort;
  let favoriteGeneration = 0;
  let recentGeneration = 0;
  const loadFavorites = async () => {
    const current = ++favoriteGeneration;
    favoriteRegion.hidden = false;
    favoriteState.textContent = "Loading favorite notes…";
    favoriteRetry.hidden = true;
    const session = await resolveWorkspaceSession();
    if (abort.signal.aborted || current !== favoriteGeneration) return;
    if (session.status !== "ready") {
      favoriteState.textContent = "Favorite notes are unavailable.";
      favoriteRetry.hidden = false;
      return;
    }
    const result = await getTodayFavoriteNotes(session.session.workspace.id)
      .catch(() => undefined);
    if (abort.signal.aborted || current !== favoriteGeneration) return;
    if (!result?.ok) {
      favoriteState.textContent =
        "Favorite notes could not be loaded. Recent activity is unchanged.";
      favoriteRetry.hidden = false;
      return;
    }
    favorites.replaceChildren(
      ...result.value.items.map(renderInteraction),
    );
    favoriteState.textContent = `${result.value.items.length} favorite note${
      result.value.items.length === 1 ? "" : "s"
    }.`;
    favoriteRetry.hidden = true;
    favoriteRegion.hidden = result.value.items.length === 0;
  };
  const loadRecent = async () => {
    const current = ++recentGeneration;
    recentState.textContent = "Loading recent activity…";
    recentRetry.hidden = true;
    const session = await resolveWorkspaceSession();
    if (abort.signal.aborted || current !== recentGeneration) return;
    if (session.status !== "ready") {
      recentState.textContent = "Recent activity is unavailable.";
      recentRetry.hidden = false;
      return;
    }
    const result = await getTodayRecentActivity(session.session.workspace.id)
      .catch(() => undefined);
    if (abort.signal.aborted || current !== recentGeneration) return;
    if (!result?.ok) {
      recentState.textContent =
        "Recent activity could not be loaded. Favorite notes are unchanged.";
      recentRetry.hidden = false;
      return;
    }
    recent.replaceChildren(...result.value.items.map(renderInteraction));
    recentState.textContent = result.value.items.length === 0
      ? "No activities or notes recorded yet."
      : `${result.value.items.length} recent interaction${
        result.value.items.length === 1 ? "" : "s"
      }.`;
    recentRetry.hidden = true;
  };
  favoriteRetry.addEventListener("click", () => void loadFavorites(), {
    signal: abort.signal,
  });
  recentRetry.addEventListener("click", () => void loadRecent(), {
    signal: abort.signal,
  });
  await Promise.all([loadFavorites(), loadRecent()]);
  globalThis.addEventListener(INTERACTION_CREATED_EVENT, () => {
    void loadFavorites();
    void loadRecent();
  }, {
    signal: abort.signal,
  });
}

export async function mountActivityReport(
  personId = profilePersonId(),
): Promise<void> {
  const state = document.querySelector<HTMLElement>("#activity-report-state");
  const heading = document.querySelector<HTMLElement>(
    "#activity-report-heading",
  );
  const list = document.querySelector<HTMLUListElement>(
    "#activity-report-list",
  );
  const more = document.querySelector<HTMLButtonElement>(
    "#activity-report-more",
  );
  if (!state || !heading || !list || !personId) return;
  reportAbort?.abort();
  const abort = new AbortController();
  reportAbort = abort;
  let generation = 0;
  let nextCursor: string | undefined;
  const yearValue = new URLSearchParams(globalThis.location.search).get("year");
  const year = yearValue ? Number(yearValue) : undefined;
  const load = async (cursor?: string) => {
    const current = ++generation;
    const session = await resolveWorkspaceSession();
    if (abort.signal.aborted || current !== generation) return;
    if (session.status !== "ready") {
      state.textContent = "Activity report unavailable.";
      return;
    }
    const reportInput = {
      ...(cursor ? { cursor } : {}),
      limit: 20,
      ...(typeof year === "number" && Number.isSafeInteger(year)
        ? { year }
        : {}),
    };
    const result = await getActivityReport(
      personId,
      reportInput,
      session.session.workspace.id,
    ).catch(() => undefined);
    if (abort.signal.aborted || current !== generation) return;
    if (!result?.ok) {
      state.textContent = result && !result.ok && result.problem.status === 404
        ? "Person not found in this workspace."
        : "Activity report could not be loaded. Saved interactions are unchanged.";
      return;
    }
    heading.textContent = `${result.value.person.name} activity`;
    const rendered = result.value.items.map(renderInteraction);
    if (cursor) list.append(...rendered);
    else list.replaceChildren(...rendered);
    nextCursor = result.value.nextCursor;
    if (more) more.hidden = !nextCursor;
    state.textContent = list.children.length === 0
      ? "No activities or notes for this period."
      : `${list.children.length} recorded item${
        list.children.length === 1 ? "" : "s"
      }.`;
  };
  more?.addEventListener("click", () => {
    if (nextCursor) void load(nextCursor);
  }, { signal: abort.signal });
  await load();
  globalThis.addEventListener(INTERACTION_CREATED_EVENT, () => {
    nextCursor = undefined;
    void load();
  }, { signal: abort.signal });
}

export async function mountPersonInteractions(
  personId: string,
  workspaceId: string,
  archived: boolean,
  hidden: { readonly activities: boolean; readonly notes: boolean },
): Promise<void> {
  const activityState = document.querySelector<HTMLElement>(
    "#person-activities-state",
  );
  const noteState = document.querySelector<HTMLElement>("#person-notes-state");
  const activityList = document.querySelector<HTMLUListElement>(
    "#person-activities-list",
  );
  const noteList = document.querySelector<HTMLUListElement>(
    "#person-notes-list",
  );
  const activityRetry = document.querySelector<HTMLButtonElement>(
    "#person-activities-retry",
  );
  const noteRetry = document.querySelector<HTMLButtonElement>(
    "#person-notes-retry",
  );
  if (!activityState || !noteState || !activityList || !noteList) return;
  personAbort?.abort();
  const abort = new AbortController();
  personAbort = abort;
  let activityGeneration = 0;
  let noteGeneration = 0;
  const sections = {
    activities: document.querySelector<HTMLElement>(
      '[data-profile-section="activities"]',
    ),
    notes: document.querySelector<HTMLElement>(
      '[data-profile-section="notes"]',
    ),
  };
  const reportLink = document.querySelector<HTMLAnchorElement>(
    "[data-activity-report-link]",
  );
  if (reportLink) {
    reportLink.href = `/app/people/${
      encodeURIComponent(personId)
    }/activity-report`;
  }
  for (const kind of ["activities", "notes"] as const) {
    const unavailable = hidden[kind];
    const section = sections[kind];
    if (section) {
      section.hidden = unavailable;
      section.dataset.sectionState = unavailable ? "hidden" : "loading";
    }
    const directoryItem = document.querySelector<HTMLElement>(
      `[data-section-link="${kind}"]`,
    )?.closest<HTMLElement>("li");
    if (directoryItem) directoryItem.hidden = unavailable;
  }
  const captureButtons = [
    ...document.querySelectorAll<HTMLButtonElement>(
      "[data-person-interaction-capture]",
    ),
  ];
  let lifecycleArchived = archived;
  const applyCaptureVisibility = () => {
    for (const button of captureButtons) {
      const intended = button.dataset.interactionIntendedKind;
      const moduleHidden = (intended === "activity" && hidden.activities) ||
        (intended === "note" && hidden.notes);
      button.hidden = lifecycleArchived || moduleHidden;
      button.disabled = lifecycleArchived || moduleHidden ||
        button.dataset.interactionCaptureReady === "false";
    }
  };
  applyCaptureVisibility();
  document.addEventListener("person-lifecycle-changed", (event) => {
    const detail = (event as CustomEvent<{
      readonly archived?: unknown;
      readonly personId?: unknown;
    }>).detail;
    if (detail?.personId !== personId || typeof detail.archived !== "boolean") {
      return;
    }
    lifecycleArchived = detail.archived;
    applyCaptureVisibility();
  }, { signal: abort.signal });
  const loadActivities = async () => {
    const current = ++activityGeneration;
    if (hidden.activities) {
      activityState.textContent =
        "Activities are hidden by workspace personalization.";
      if (activityRetry) activityRetry.hidden = true;
      return;
    }
    if (sections.activities) {
      sections.activities.dataset.sectionState = "loading";
    }
    activityState.textContent = "Loading recent activities…";
    if (activityRetry) activityRetry.hidden = true;
    const result = await getActivityReport(
      personId,
      { kind: "activity", limit: 20 },
      workspaceId,
    ).catch(() => undefined);
    if (abort.signal.aborted || current !== activityGeneration) return;
    if (!result?.ok) {
      if (sections.activities) {
        sections.activities.dataset.sectionState = "error";
      }
      activityState.textContent =
        "Activities could not be loaded. Saved activity is unchanged.";
      if (activityRetry) activityRetry.hidden = false;
    } else {
      if (sections.activities) {
        sections.activities.dataset.sectionState = "ready";
      }
      const activities = result.value.items.filter((entry) =>
        entry.kind === "activity"
      );
      activityList.replaceChildren(...activities.map(renderInteraction));
      activityState.textContent = activities.length === 0
        ? "No activities recorded yet."
        : `${activities.length} recent activit${
          activities.length === 1 ? "y" : "ies"
        }.`;
      if (activityRetry) activityRetry.hidden = true;
    }
  };
  const loadNotes = async () => {
    const current = ++noteGeneration;
    if (hidden.notes) {
      noteState.textContent = "Notes are hidden by workspace personalization.";
      if (noteRetry) noteRetry.hidden = true;
      return;
    }
    if (sections.notes) sections.notes.dataset.sectionState = "loading";
    noteState.textContent = "Loading recent notes…";
    if (noteRetry) noteRetry.hidden = true;
    const result = await getActivityReport(
      personId,
      { kind: "note", limit: 20 },
      workspaceId,
    ).catch(() => undefined);
    if (abort.signal.aborted || current !== noteGeneration) return;
    if (!result?.ok) {
      if (sections.notes) sections.notes.dataset.sectionState = "error";
      noteState.textContent =
        "Notes could not be loaded. Saved notes are unchanged.";
      if (noteRetry) noteRetry.hidden = false;
    } else {
      if (sections.notes) sections.notes.dataset.sectionState = "ready";
      const notes = result.value.items.filter((entry) => entry.kind === "note");
      noteList.replaceChildren(...notes.map(renderInteraction));
      noteState.textContent = notes.length === 0
        ? "No notes recorded yet."
        : `${notes.length} recent note${notes.length === 1 ? "" : "s"}.`;
      if (noteRetry) noteRetry.hidden = true;
    }
  };
  activityRetry?.addEventListener("click", () => void loadActivities(), {
    signal: abort.signal,
  });
  noteRetry?.addEventListener("click", () => void loadNotes(), {
    signal: abort.signal,
  });
  await Promise.all([loadActivities(), loadNotes()]);
  globalThis.addEventListener(INTERACTION_CREATED_EVENT, () => {
    void loadActivities();
    void loadNotes();
  }, {
    signal: abort.signal,
  });
}
