import { mountLoadMore } from "./load-more.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";
import {
  formatCalendarDate,
  formatInstant,
  loadTimePreferences,
  type TimePreferences,
} from "./time-presentation.ts";
import {
  createJournalPost,
  deleteJournalItem,
  getJournalItem,
  type JournalLinkableActivity,
  type JournalTimelineItem,
  linkJournalActivity,
  listJournal,
  saveJournalDayRating,
  updateJournalPost,
} from "../../../../packages/contracts/generated/auth-client.ts";

interface JournalElements {
  readonly add: HTMLButtonElement | undefined;
  readonly cancel: HTMLButtonElement | undefined;
  readonly form: HTMLFormElement | undefined;
  readonly formState: HTMLElement | undefined;
  readonly list: HTMLOListElement;
  readonly retry: HTMLButtonElement;
  readonly state: HTMLElement;
}

function elements(): JournalElements | undefined {
  const list = document.querySelector<HTMLOListElement>("[data-journal-list]");
  const retry = document.querySelector<HTMLButtonElement>(
    "[data-journal-retry]",
  );
  const state = document.querySelector<HTMLElement>("[data-journal-state]");
  if (!list || !retry || !state) return undefined;
  return {
    add: document.querySelector<HTMLButtonElement>("[data-journal-add]") ??
      undefined,
    cancel:
      document.querySelector<HTMLButtonElement>("[data-journal-cancel]") ??
        undefined,
    form: document.querySelector<HTMLFormElement>("[data-journal-form]") ??
      undefined,
    formState:
      document.querySelector<HTMLElement>("[data-journal-form-state]") ??
        undefined,
    list,
    retry,
    state,
  };
}

function localDateTimeValue(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${
    pad(value.getDate())
  }T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function parseLocalDateTime(value: string): string | undefined {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/,
  );
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match.map(Number);
  const parsed = new Date(year!, month! - 1, day, hour, minute);
  if (
    !Number.isFinite(parsed.valueOf()) || parsed.getFullYear() !== year ||
    parsed.getMonth() !== month! - 1 || parsed.getDate() !== day ||
    parsed.getHours() !== hour || parsed.getMinutes() !== minute
  ) return undefined;
  return parsed.toISOString();
}

function heading(item: JournalTimelineItem): string {
  if (item.type === "post") return item.post.title ?? "Journal post";
  if (item.type === "day-rating") {
    return `Day rating: ${item.dayRating.rating}/5`;
  }
  return item.activity.summary;
}

function renderActivityOptions(
  timePreferences: TimePreferences | undefined,
  form: HTMLFormElement,
  activities: readonly JournalLinkableActivity[],
): void {
  const select = form.elements.namedItem("activityId") as HTMLSelectElement;
  const placeholder = document.createElement("option");
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.value = "";
  placeholder.textContent = activities.length === 0
    ? "No unlinked activities available"
    : "Select an activity";
  select.replaceChildren(
    placeholder,
    ...activities.map((activity) => {
      const option = document.createElement("option");
      option.value = activity.id;
      option.textContent = `${activity.summary} · ${
        formatInstant(activity.happenedAt, timePreferences)
      }`;
      return option;
    }),
  );
}

function renderItem(
  workspaceId: string,
  timePreferences: TimePreferences | undefined,
  item: JournalTimelineItem,
  refresh: () => Promise<void>,
): HTMLLIElement {
  const entry = document.createElement("li");
  entry.dataset.journalItemId = item.id;
  entry.dataset.journalItemType = item.type;
  const title = document.createElement("h2");
  const link = document.createElement("a");
  link.href = `/app/journal/${item.id}`;
  link.textContent = heading(item);
  title.append(link);
  const time = document.createElement("time");
  time.dateTime = item.type === "day-rating"
    ? item.dayRating.ratedOn
    : item.occurredAt;
  time.textContent = item.type === "day-rating"
    ? formatCalendarDate(
      item.dayRating.ratedOn,
      timePreferences?.locale ?? "en",
    )
    : formatInstant(item.occurredAt, timePreferences);
  const body = document.createElement("p");
  body.textContent = item.type === "post"
    ? item.post.body
    : item.type === "day-rating"
    ? item.dayRating.comment ?? ""
    : "Activity linked to this timeline.";
  const actions = document.createElement("div");
  actions.className = "form-actions";
  if (item.type === "post") {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => {
      const form = document.querySelector<HTMLFormElement>(
        "[data-journal-form]",
      );
      if (!form) return;
      form.hidden = false;
      form.dataset.editPostId = item.post.id;
      const type = form.elements.namedItem("type") as HTMLSelectElement;
      type.value = "post";
      type.disabled = true;
      (form.elements.namedItem("title") as HTMLInputElement).value =
        item.post.title ?? "";
      (form.elements.namedItem("body") as HTMLTextAreaElement).value =
        item.post.body;
      (form.elements.namedItem("occurredAt") as HTMLInputElement).value =
        localDateTimeValue(new Date(item.occurredAt));
      form.querySelector<HTMLInputElement>('textarea[name="body"]')?.focus();
    });
    actions.append(edit);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove";
  remove.addEventListener("click", async () => {
    remove.disabled = true;
    const result = await deleteJournalItem(item.id, workspaceId);
    if (result.ok) await refresh();
    else {
      remove.disabled = false;
      document.querySelector<HTMLElement>("[data-journal-state]")!.textContent =
        result.problem.detail;
    }
  });
  actions.append(remove);
  entry.append(title, time, body, actions);
  return entry;
}

function setFormType(form: HTMLFormElement): void {
  const type = (form.elements.namedItem("type") as HTMLSelectElement).value;
  form.querySelectorAll<HTMLElement>("[data-journal-post]").forEach((node) =>
    node.hidden = type !== "post"
  );
  form.querySelectorAll<HTMLElement>("[data-journal-rating]").forEach((node) =>
    node.hidden = type !== "day-rating"
  );
  form.querySelectorAll<HTMLElement>("[data-journal-activity]").forEach((
    node,
  ) => node.hidden = type !== "activity");
}

function resetForm(form: HTMLFormElement): void {
  form.reset();
  delete form.dataset.editPostId;
  (form.elements.namedItem("type") as HTMLSelectElement).disabled = false;
  const now = new Date();
  (form.elements.namedItem("occurredAt") as HTMLInputElement).value =
    localDateTimeValue(now);
  (form.elements.namedItem("ratedOn") as HTMLInputElement).value =
    localDateTimeValue(now).slice(0, 10);
  setFormType(form);
}

export async function mountJournal(): Promise<void> {
  const surface = elements();
  if (!surface) return;
  let workspaceId: string | undefined;
  let items: JournalTimelineItem[] = [];
  // The loader is looked up when the control is pressed, by which time
  // `refresh` below exists.
  const more = mountLoadMore("journal", (cursor) => refresh(cursor));
  const refresh = async (cursor?: string) => {
    surface.state.textContent = "Loading journal…";
    surface.retry.hidden = true;
    const detail = document.querySelector<HTMLElement>("[data-journal-detail]");
    const itemId = detail
      ? globalThis.location.pathname.split("/").filter(Boolean).at(-1)
      : undefined;
    const session = await resolveWorkspaceSession();
    if (session.status !== "ready") {
      workspaceId = undefined;
      surface.state.textContent =
        "Your journal session could not be confirmed.";
      surface.retry.hidden = false;
      surface.list.replaceChildren();
      return;
    }
    workspaceId = session.session.workspace.id;
    const timePreferences = await loadTimePreferences(workspaceId);
    const result = itemId
      ? await getJournalItem(itemId, workspaceId)
      : await listJournal(workspaceId, cursor ? { cursor } : {});
    if (!result.ok) {
      surface.state.textContent = result.problem.detail;
      surface.retry.hidden = false;
      surface.list.replaceChildren();
      more.present(undefined);
      return;
    }
    const page = "item" in result.value
      ? [result.value.item]
      : result.value.items;
    items = cursor ? [...items, ...page] : [...page];
    more.present(
      "item" in result.value ? undefined : result.value.nextCursor,
    );
    if (surface.form && "activities" in result.value) {
      renderActivityOptions(
        timePreferences,
        surface.form,
        result.value.activities,
      );
    }
    surface.list.replaceChildren(
      ...items.map((item) =>
        renderItem(workspaceId!, timePreferences, item, refresh)
      ),
    );
    surface.state.textContent = items.length === 0
      ? "No journal items yet."
      : `${items.length} journal item${items.length === 1 ? "" : "s"}.`;
  };
  surface.retry.addEventListener("click", () => void refresh());
  surface.add?.addEventListener("click", () => {
    if (!surface.form) return;
    resetForm(surface.form);
    surface.form.hidden = false;
    (surface.form.elements.namedItem("type") as HTMLSelectElement).focus();
  });
  surface.cancel?.addEventListener("click", () => {
    if (surface.form) surface.form.hidden = true;
  });
  (surface.form?.elements.namedItem("type") as HTMLSelectElement | null)
    ?.addEventListener("change", () => setFormType(surface.form!));
  surface.form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!surface.form || !surface.formState || !workspaceId) return;
    const data = new FormData(surface.form);
    const type = (surface.form.elements.namedItem(
      "type",
    ) as HTMLSelectElement).value;
    surface.formState.textContent = "Saving…";
    let result;
    if (type === "post") {
      const occurredAt = parseLocalDateTime(String(data.get("occurredAt")));
      if (!occurredAt) {
        surface.formState.textContent = "Choose a valid date and time.";
        return;
      }
      const input = {
        body: String(data.get("body")),
        occurredAt,
        ...(String(data.get("title")).trim()
          ? { title: String(data.get("title")) }
          : {}),
      };
      result = surface.form.dataset.editPostId
        ? await updateJournalPost(
          surface.form.dataset.editPostId,
          input,
          workspaceId,
        )
        : await createJournalPost(input, workspaceId);
    } else if (type === "day-rating") {
      result = await saveJournalDayRating({
        ...(String(data.get("comment")).trim()
          ? { comment: String(data.get("comment")) }
          : {}),
        ratedOn: String(data.get("ratedOn")),
        rating: Number(data.get("rating")),
      }, workspaceId);
    } else {
      const activityId = String(data.get("activityId"));
      if (!activityId) {
        surface.formState.textContent = "Choose an activity to link.";
        return;
      }
      result = await linkJournalActivity(activityId, workspaceId);
    }
    if (!result.ok) {
      surface.formState.textContent = result.problem.detail;
      return;
    }
    surface.form.hidden = true;
    surface.formState.textContent = "";
    await refresh();
  });
  await refresh();
}
