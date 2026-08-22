import { getTodayRecentPeople } from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";

let recentPeopleAbort: AbortController | undefined;

export async function mountTodayRecentPeople(): Promise<void> {
  const region = document.querySelector<HTMLElement>(
    "#today-recent-people-region",
  );
  const badge = document.querySelector<HTMLElement>(
    "#today-recent-people-badge",
  );
  const state = document.querySelector<HTMLElement>(
    "#today-recent-people-state",
  );
  const list = document.querySelector<HTMLUListElement>(
    "#today-recent-people-list",
  );
  const retry = document.querySelector<HTMLButtonElement>(
    "#today-recent-people-retry",
  );
  if (!region || !badge || !state || !list || !retry) return;

  recentPeopleAbort?.abort();
  const abort = new AbortController();
  recentPeopleAbort = abort;
  let generation = 0;

  const load = async (focusAfter = false) => {
    const current = ++generation;
    region.dataset.regionState = "loading";
    badge.textContent = "Loading";
    state.textContent = "Loading recently viewed people…";
    retry.hidden = true;
    const session = await resolveWorkspaceSession();
    if (abort.signal.aborted || current !== generation) return;
    if (session.status !== "ready") {
      region.dataset.regionState = "error";
      badge.textContent = "Unavailable";
      state.textContent = "Recently viewed people could not be loaded.";
      retry.hidden = false;
      if (focusAfter) state.focus();
      return;
    }
    const result = await getTodayRecentPeople(session.session.workspace.id)
      .catch(() => undefined);
    if (abort.signal.aborted || current !== generation) return;
    if (!result?.ok) {
      region.dataset.regionState = "error";
      badge.textContent = "Unavailable";
      state.textContent =
        "Recently viewed people could not be loaded. Other Today regions are still available.";
      retry.hidden = false;
      if (focusAfter) state.focus();
      return;
    }
    list.replaceChildren(...result.value.people.map((person) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.className = "button-secondary today-touch-target";
      link.href = `/app/people/${encodeURIComponent(person.id)}`;
      link.textContent = person.name;
      item.append(link);
      if (person.archived) {
        const lifecycle = document.createElement("span");
        lifecycle.className = "state-badge calm";
        lifecycle.textContent = "Archived";
        item.append(lifecycle);
      }
      return item;
    }));
    const count = result.value.people.length;
    region.dataset.regionState = count === 0 ? "empty" : "ready";
    badge.textContent = count === 0 ? "Empty" : `${count} recent`;
    state.textContent = count === 0
      ? "No recently viewed people yet. Open a person to create a return path."
      : `${count} recently viewed ${count === 1 ? "person" : "people"}.`;
    retry.hidden = true;
    if (focusAfter) state.focus();
  };

  retry.addEventListener("click", () => void load(true), {
    signal: abort.signal,
  });
  await load();
}
