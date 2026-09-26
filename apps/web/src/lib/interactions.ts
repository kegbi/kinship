/**
 * Today's favorite notes and recent activity, and a person's activity report
 * (INTERACTION-001). Quick capture and the person's notes and activities
 * cards are islands (GAP-031, `features/interactions/` and
 * `features/person/interactions/`); these two projections stay vanilla until
 * GAP-033 and refresh whenever Quick capture announces a saved interaction.
 */

import {
  formatInstant,
  loadTimePreferences,
  type TimePreferences,
} from "./time-presentation.ts";
import {
  type ActivityOrNoteInteraction,
  getActivityReport,
  getTodayFavoriteNotes,
  getTodayRecentActivity,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";
import {
  INTERACTION_CREATED_EVENT,
  profilePersonId,
} from "../features/interactions/shared.ts";

let todayAbort: AbortController | undefined;
let reportAbort: AbortController | undefined;

function renderInteraction(
  entry: ActivityOrNoteInteraction,
  timePreferences: TimePreferences | undefined,
): HTMLLIElement {
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
    ? formatInstant(value, timePreferences)
    : "Recently";
  item.append(heading, detail, timestamp);
  return item;
}

export async function mountTodayInteractions(): Promise<void> {
  todayAbort?.abort();
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
    const timePreferences = await loadTimePreferences(
      session.session.workspace.id,
    );
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
      ...result.value.items.map((entry) =>
        renderInteraction(entry, timePreferences)
      ),
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
    const timePreferences = await loadTimePreferences(
      session.session.workspace.id,
    );
    const result = await getTodayRecentActivity(session.session.workspace.id)
      .catch(() => undefined);
    if (abort.signal.aborted || current !== recentGeneration) return;
    if (!result?.ok) {
      recentState.textContent =
        "Recent activity could not be loaded. Favorite notes are unchanged.";
      recentRetry.hidden = false;
      return;
    }
    recent.replaceChildren(
      ...result.value.items.map((entry) =>
        renderInteraction(entry, timePreferences)
      ),
    );
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
  globalThis.addEventListener(INTERACTION_CREATED_EVENT, (event) => {
    const kind = (event as CustomEvent<{ readonly kind?: unknown }>).detail
      ?.kind;
    if (kind !== "activity") void loadFavorites();
    void loadRecent();
  }, {
    signal: abort.signal,
  });
  await Promise.all([loadFavorites(), loadRecent()]);
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
  const personCrumb = document.querySelector<HTMLAnchorElement>(
    "[data-breadcrumb-person]",
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
      if (personCrumb?.querySelector('[data-slot="skeleton"]')) {
        personCrumb.textContent = "Person";
      }
      state.textContent = "Activity report unavailable.";
      return;
    }
    const timePreferences = await loadTimePreferences(
      session.session.workspace.id,
    );
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
      if (personCrumb?.querySelector('[data-slot="skeleton"]')) {
        personCrumb.textContent = "Person";
      }
      state.textContent = result && !result.ok && result.problem.status === 404
        ? "Person not found in this workspace."
        : "Activity report could not be loaded. Saved interactions are unchanged.";
      return;
    }
    heading.textContent = `${result.value.person.name} activity`;
    if (personCrumb) {
      personCrumb.href = `/app/people/${encodeURIComponent(personId)}`;
      personCrumb.textContent = result.value.person.name;
    }
    const rendered = result.value.items.map((entry) =>
      renderInteraction(entry, timePreferences)
    );
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
