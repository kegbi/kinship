import {
  listPersonLifeEvents,
  type PersonLifeEvent,
} from "../../../../packages/contracts/generated/auth-client.ts";

interface LifeEventElements {
  readonly badge: HTMLElement;
  readonly list: HTMLOListElement;
  readonly retry: HTMLButtonElement;
  readonly root: HTMLElement;
  readonly state: HTMLElement;
}

function elements(): LifeEventElements | undefined {
  const root = document.querySelector<HTMLElement>("[data-person-life-events]");
  const badge = root?.querySelector<HTMLElement>("[data-life-event-badge]");
  const list = root?.querySelector<HTMLOListElement>("[data-life-event-list]");
  const retry = root?.querySelector<HTMLButtonElement>(
    "[data-life-event-retry]",
  );
  const state = root?.querySelector<HTMLElement>("[data-life-event-state]");
  return root && badge && list && retry && state
    ? { badge, list, retry, root, state }
    : undefined;
}

const month = new Intl.DateTimeFormat("en", {
  month: "long",
  timeZone: "UTC",
});

function monthName(value: number): string {
  return month.format(new Date(Date.UTC(2000, value - 1, 1)));
}

function displayDate(event: PersonLifeEvent): string {
  const { date } = event;
  if (date.precision === "full" && date.happenedAt) {
    return new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
      year: "numeric",
    }).format(new Date(date.happenedAt));
  }
  if (date.precision === "year_month" && date.year && date.month) {
    return `${monthName(date.month)} ${date.year}`;
  }
  if (date.precision === "month_day" && date.month && date.day) {
    return `${monthName(date.month)} ${date.day}`;
  }
  if (date.precision === "year" && date.year) return String(date.year);
  if (date.precision === "month" && date.month) return monthName(date.month);
  if (date.precision === "day" && date.day) return `Day ${date.day}`;
  return "Date unknown";
}

function render(
  view: LifeEventElements,
  events: readonly PersonLifeEvent[],
): void {
  view.list.replaceChildren();
  view.retry.hidden = true;
  view.badge.textContent = events.length === 0 ? "Empty" : "Ready";
  view.root.dataset.sectionState = events.length === 0 ? "empty" : "ready";
  view.state.textContent = events.length === 0
    ? "No life events saved."
    : `${events.length} life event${events.length === 1 ? "" : "s"}`;
  for (const event of events) {
    const item = document.createElement("li");
    item.dataset.lifeEventId = event.id;
    const heading = document.createElement("strong");
    heading.textContent = event.name ?? event.typeName ?? "Life event";
    const date = document.createElement("time");
    date.textContent = displayDate(event);
    if (event.date.happenedAt) date.dateTime = event.date.happenedAt;
    item.append(heading, date);
    if (event.typeName && event.typeName !== event.name) {
      const type = document.createElement("span");
      type.className = "state-badge calm";
      type.textContent = event.typeName;
      item.append(type);
    }
    if (event.note) {
      const note = document.createElement("p");
      note.textContent = event.note;
      item.append(note);
    }
    view.list.append(item);
  }
}

export async function mountPersonLifeEvents(
  personId: string,
  workspaceId?: string,
  hidden = false,
): Promise<void> {
  const view = elements();
  if (!view) return;
  if (hidden) {
    view.root.hidden = true;
    document.querySelector<HTMLElement>('[data-section-link="life-events"]')
      ?.closest("li")?.setAttribute("hidden", "");
    view.root.dataset.sectionState = "hidden";
    return;
  }
  const refresh = async (): Promise<void> => {
    view.root.dataset.sectionState = "loading";
    view.badge.textContent = "Loading";
    view.state.textContent = "Loading life events…";
    view.retry.hidden = true;
    const result = await listPersonLifeEvents(personId, workspaceId).catch(() =>
      undefined
    );
    if (result?.ok && result.value.status === "hidden") {
      view.list.replaceChildren();
      view.root.hidden = true;
      document.querySelector<HTMLElement>('[data-section-link="life-events"]')
        ?.closest("li")?.setAttribute("hidden", "");
      view.root.dataset.sectionState = "hidden";
      return;
    }
    if (result?.ok) {
      render(view, result.value.events);
      return;
    }
    const status = result && !result.ok ? result.problem.status : 503;
    view.root.dataset.sectionState = status === 403
      ? "forbidden"
      : status === 404
      ? "not-found"
      : "error";
    view.badge.textContent = status === 403 ? "Forbidden" : "Unavailable";
    view.state.textContent = result && !result.ok
      ? result.problem.detail
      : "Life events are temporarily unavailable. Other person sections remain available.";
    view.retry.hidden = status === 403 || status === 404;
  };
  view.retry.addEventListener("click", () => void refresh());
  await refresh();
}
