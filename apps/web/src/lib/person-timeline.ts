import {
  formatInstant,
  formatPartialDate,
  type TimePreferences,
} from "./time-presentation.ts";
import {
  listPersonTimeline,
  type PersonTimelineItem,
  type PersonTimelineKind,
} from "../../../../packages/contracts/generated/auth-client.ts";

interface TimelineElements {
  readonly filters: readonly HTMLButtonElement[];
  readonly list: HTMLUListElement;
  readonly more: HTMLButtonElement;
  readonly retry: HTMLButtonElement;
  readonly root: HTMLElement;
  readonly state: HTMLElement;
}

type TimelineFilter = "all" | PersonTimelineKind;

interface TimelineRequest {
  readonly append: boolean;
  readonly cursor?: string;
}

let timelineAbort: AbortController | undefined;

const kindLabels: Record<PersonTimelineKind, string> = {
  activity: "Activity",
  call: "Call",
  conversation: "Conversation",
  "life-event": "Life event",
  note: "Note",
};

function elements(): TimelineElements | undefined {
  const root = document.querySelector<HTMLElement>("#person-timeline");
  const state = root?.querySelector<HTMLElement>("[data-timeline-state]");
  const list = root?.querySelector<HTMLUListElement>("[data-timeline-list]");
  const more = root?.querySelector<HTMLButtonElement>("[data-timeline-more]");
  const retry = root?.querySelector<HTMLButtonElement>(
    "[data-timeline-retry]",
  );
  const filters = root
    ? [...root.querySelectorAll<HTMLButtonElement>("[data-timeline-filter]")]
    : [];
  return root && state && list && more && retry && filters.length > 0
    ? { filters, list, more, retry, root, state }
    : undefined;
}

function displayDate(
  item: PersonTimelineItem,
  preferences: TimePreferences | undefined,
): string {
  if (item.calendarDate) {
    return formatPartialDate(
      item.calendarDate,
      item.datePrecision,
      preferences?.locale ?? "en",
    );
  }
  if (item.datePrecision === "full") {
    return formatInstant(item.occurredAt, preferences);
  }
  const instant = new Date(item.occurredAt);
  return formatPartialDate(
    {
      year: instant.getUTCFullYear(),
      month: instant.getUTCMonth() + 1,
      day: instant.getUTCDate(),
    },
    item.datePrecision,
    preferences?.locale ?? "en",
  );
}

function dateTimeValue(item: PersonTimelineItem): string | undefined {
  if (item.datePrecision === "full" && !item.calendarDate) {
    return item.occurredAt;
  }
  if (
    item.datePrecision === "month" || item.datePrecision === "day" ||
    item.datePrecision === "unknown"
  ) return undefined;
  const instant = new Date(item.occurredAt);
  const components = item.calendarDate ??
    {
      year: instant.getUTCFullYear(),
      month: instant.getUTCMonth() + 1,
      day: instant.getUTCDate(),
    };
  const year = components.year === undefined
    ? undefined
    : String(components.year).padStart(4, "0");
  const month = components.month === undefined
    ? undefined
    : String(components.month).padStart(2, "0");
  const day = components.day === undefined
    ? undefined
    : String(components.day).padStart(2, "0");
  if (item.datePrecision === "year") return year;
  if (item.datePrecision === "year_month") {
    return year && month ? `${year}-${month}` : undefined;
  }
  if (item.datePrecision === "month_day") {
    return month && day ? `${month}-${day}` : undefined;
  }
  return year && month && day ? `${year}-${month}-${day}` : undefined;
}

function detailLines(item: PersonTimelineItem): string[] {
  const lines: string[] = [];
  if (item.participants?.length) {
    lines.push(
      `Participants: ${
        item.participants.map((entry) => entry.name).join(", ")
      }`,
    );
  }
  if (item.activityType) lines.push(`Category: ${item.activityType}`);
  if (item.emotions?.length) {
    lines.push(
      `Emotions: ${item.emotions.map((entry) => entry.name).join(", ")}`,
    );
  }
  if (item.contactWasCaller !== undefined) {
    lines.push(item.contactWasCaller ? "Incoming call" : "Outgoing call");
  }
  if (item.channelType) lines.push(`Channel: ${item.channelType}`);
  if (item.contactMethod) lines.push(`Via ${item.contactMethod}`);
  if (item.messages?.length) {
    for (const message of item.messages) {
      lines.push(
        `${
          message.direction === "inbound" ? "Inbound" : "Outbound"
        }: ${message.content}`,
      );
    }
  } else if (item.kind === "conversation") {
    lines.push("Direction not recorded");
  }
  return lines;
}

function renderItem(
  item: PersonTimelineItem,
  preferences: TimePreferences | undefined,
): HTMLLIElement {
  const row = document.createElement("li");
  row.dataset.timelineId = item.id;
  row.dataset.timelineKind = item.kind;
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const dateTime = dateTimeValue(item);
  const date = document.createElement(dateTime ? "time" : "span");
  date.dataset.timelineDate = "";
  date.className = "person-timeline-date";
  date.textContent = displayDate(item, preferences);
  if (date instanceof HTMLTimeElement && dateTime) date.dateTime = dateTime;
  const type = document.createElement("span");
  type.className = "person-timeline-type";
  type.textContent = kindLabels[item.kind];
  const summaryExcerpt = document.createElement("span");
  summaryExcerpt.className = "person-timeline-summary-excerpt";
  summaryExcerpt.textContent = item.excerpt ?? item.title ??
    "No details recorded.";
  summary.append(date, type, summaryExcerpt);

  const title = document.createElement("strong");
  title.textContent = item.title ?? kindLabels[item.kind];
  const excerpt = document.createElement("p");
  excerpt.textContent = item.excerpt ?? "No details recorded.";
  details.append(summary, title, excerpt);
  const lines = detailLines(item);
  if (lines.length) {
    const list = document.createElement("ul");
    list.append(...lines.map((line) => {
      const detail = document.createElement("li");
      detail.textContent = line;
      return detail;
    }));
    details.append(list);
  }
  row.append(details);
  return row;
}

function applyFilter(
  filters: readonly HTMLButtonElement[],
  selected: TimelineFilter,
): void {
  for (const button of filters) {
    const pressed = button.dataset.timelineFilter === selected;
    button.setAttribute("aria-pressed", String(pressed));
  }
}

function timelineFilter(button: HTMLButtonElement): TimelineFilter | undefined {
  const value = button.dataset.timelineFilter;
  return value === "all" || value === "activity" || value === "call" ||
      value === "conversation" || value === "life-event" || value === "note"
    ? value
    : undefined;
}

export async function mountPersonTimeline(options: {
  readonly timePreferences?: TimePreferences | undefined;
  readonly personId: string;
  readonly workspaceId: string;
}): Promise<void> {
  timelineAbort?.abort();
  const view = elements();
  if (!view) return;
  const abort = new AbortController();
  timelineAbort = abort;
  let selected: TimelineFilter = "all";
  let nextCursor: string | undefined;
  let lastRequest: TimelineRequest = { append: false };
  let requestSequence = 0;

  const load = async (request: TimelineRequest): Promise<void> => {
    const sequence = ++requestSequence;
    lastRequest = request;
    view.root.dataset.timelineState = "loading";
    view.state.textContent = request.append
      ? "Loading older events…"
      : "Loading the timeline…";
    view.retry.hidden = true;
    view.more.disabled = true;
    if (!request.append) {
      nextCursor = undefined;
      view.list.replaceChildren();
      view.more.hidden = true;
    }
    const result = await listPersonTimeline(
      options.personId,
      {
        ...(request.cursor ? { cursor: request.cursor } : {}),
        ...(selected === "all" ? {} : { kind: selected }),
        limit: 20,
      },
      options.workspaceId,
    ).catch(() => undefined);
    if (sequence !== requestSequence) return;

    if (result?.ok) {
      const appendedRows = result.value.items.map((item) =>
        renderItem(item, options.timePreferences)
      );
      view.list.append(...appendedRows);
      nextCursor = result.value.nextCursor;
      const count = view.list.children.length;
      view.root.dataset.timelineState = count === 0 ? "empty" : "ready";
      view.state.textContent = count === 0
        ? "No timeline events recorded."
        : `${count} timeline event${count === 1 ? "" : "s"}`;
      view.more.disabled = false;
      view.more.hidden = !nextCursor;
      if (request.append) {
        if (nextCursor) {
          view.more.focus();
        } else {
          appendedRows[0]?.querySelector<HTMLElement>("summary")?.focus();
        }
      }
      return;
    }

    const status = result && !result.ok ? result.problem.status : 503;
    view.root.dataset.timelineState = status === 403
      ? "forbidden"
      : status === 404
      ? "not-found"
      : "error";
    view.state.textContent = status === 403
      ? "You no longer have access to this person's timeline."
      : status === 404
      ? "This person is no longer available."
      : result && !result.ok
      ? result.problem.detail
      : "The timeline is temporarily unavailable.";
    view.more.hidden = true;
    view.more.disabled = false;
    view.retry.hidden = status < 500;
  };

  for (const button of view.filters) {
    const filter = timelineFilter(button);
    if (!filter) continue;
    button.addEventListener("click", () => {
      selected = filter;
      applyFilter(view.filters, selected);
      void load({ append: false });
    });
    button.disabled = false;
  }
  view.more.addEventListener("click", () => {
    if (nextCursor) void load({ append: true, cursor: nextCursor });
  });
  view.retry.addEventListener("click", () => void load(lastRequest));
  document.addEventListener("person-timeline-changed", (event) => {
    const detail = (event as CustomEvent<{
      readonly personIds?: unknown;
    }>).detail;
    if (
      !Array.isArray(detail?.personIds) ||
      !detail.personIds.includes(options.personId)
    ) return;
    void load({ append: false });
  }, { signal: abort.signal });
  await load({ append: false });
}
