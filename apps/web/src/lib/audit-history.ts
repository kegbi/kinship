import {
  formatInstant,
  loadTimePreferences,
  type TimePreferences,
} from "./time-presentation.ts";
import {
  type AuditDateDetail,
  type AuditDetail,
  type AuditEvent,
  type AuditHistoryInput,
  listPersonAudit,
  listWorkspaceAudit,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";

let historyAbort: AbortController | undefined;
let summaryAbort: AbortController | undefined;

function formatAction(action: string): string {
  return action.replaceAll(/[._-]+/g, " ").replace(
    /^./,
    (value) => value.toUpperCase(),
  );
}

const datePrecisionLabels: Readonly<
  Record<AuditDateDetail["precision"], string>
> = {
  day: "day only",
  full: "full date",
  month: "month only",
  month_day: "month and day",
  unknown: "unknown date",
  year: "year only",
  year_month: "year and month",
};

function isAuditDateDetail(value: AuditDetail): value is AuditDateDetail {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<AuditDateDetail>;
  return Object.keys(value).every((key) =>
    key === "isYearApproximate" || key === "precision"
  ) && typeof candidate.isYearApproximate === "boolean" &&
    typeof candidate.precision === "string" &&
    candidate.precision in datePrecisionLabels;
}

function formatDetail(key: string, value: AuditDetail): string {
  if (isAuditDateDetail(value)) {
    return `${value.isYearApproximate ? "Approximate " : ""}${
      datePrecisionLabels[value.precision]
    }`;
  }
  if (value === null) return "Not set";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    return key === "from" || key === "status" || key === "to"
      ? formatAction(value)
      : value;
  }
  return "Protected detail";
}

function renderEvent(
  event: AuditEvent,
  timePreferences: TimePreferences | undefined,
): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "audit-event";
  const heading = document.createElement("strong");
  heading.textContent = formatAction(event.action);
  const context = document.createElement("p");
  context.textContent = [
    event.actor.name,
    event.person?.name,
    event.subject.type,
  ].filter(Boolean).join(" · ");
  const details = document.createElement("p");
  const values = Object.entries(event.details).map(([key, value]) =>
    `${formatAction(key)}: ${formatDetail(key, value)}`
  );
  details.textContent = values.length > 0
    ? values.join(" · ")
    : "No non-sensitive details stored.";
  const timestamp = document.createElement("time");
  timestamp.dateTime = event.occurredAt;
  timestamp.textContent = formatInstant(event.occurredAt, timePreferences);
  item.append(heading, context, details, timestamp);
  if (event.redacted) {
    const redacted = document.createElement("span");
    redacted.className = "state-badge";
    redacted.textContent = "Redacted";
    item.append(redacted);
  }
  return item;
}

function isoValue(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function filterInput(form: HTMLFormElement): AuditHistoryInput {
  const fields = form.elements;
  const text = (name: string) =>
    (fields.namedItem(name) as HTMLInputElement | null)?.value.trim() ?? "";
  const from = isoValue(text("from"));
  const to = isoValue(text("to"));
  return {
    ...(text("action") ? { action: text("action") } : {}),
    ...(text("actorMemberId") ? { actorMemberId: text("actorMemberId") } : {}),
    ...(from ? { from } : {}),
    limit: 20,
    ...(text("personId") ? { personId: text("personId") } : {}),
    ...(to ? { to } : {}),
  };
}

export async function mountAuditHistory(personId?: string): Promise<void> {
  const form = document.querySelector<HTMLFormElement>("[data-audit-filters]");
  const state = document.querySelector<HTMLElement>("[data-audit-state]");
  const list = document.querySelector<HTMLOListElement>("[data-audit-list]");
  const more = document.querySelector<HTMLButtonElement>("[data-audit-more]");
  const retry = document.querySelector<HTMLButtonElement>("[data-audit-retry]");
  const clear = document.querySelector<HTMLButtonElement>("[data-audit-clear]");
  const heading = document.querySelector<HTMLElement>("[data-audit-heading]");
  const personCrumb = document.querySelector<HTMLAnchorElement>(
    "[data-breadcrumb-person]",
  );
  if (!form || !state || !list || !more || !retry) return;
  historyAbort?.abort();
  const abort = new AbortController();
  historyAbort = abort;
  let generation = 0;
  let nextCursor: string | undefined;
  let retryCursor: string | undefined;

  const load = async (cursor?: string) => {
    const current = ++generation;
    const isContinuation = Boolean(cursor);
    if (!isContinuation) {
      list.replaceChildren();
      nextCursor = undefined;
      retryCursor = undefined;
      more.hidden = true;
    }
    state.textContent = cursor
      ? "Loading older audit events…"
      : "Loading audit history…";
    retry.hidden = true;
    more.disabled = true;
    const session = await resolveWorkspaceSession();
    if (abort.signal.aborted || current !== generation) return;
    if (session.status !== "ready") {
      if (personId && personCrumb?.querySelector(".skeleton")) {
        personCrumb.textContent = "Person";
      }
      more.disabled = false;
      retryCursor = cursor;
      state.textContent = session.status === "access-lost"
        ? `Sign in again to review audit history.${
          isContinuation ? " Existing results are unchanged." : ""
        }`
        : isContinuation
        ? "Older audit events could not be loaded. Existing results are unchanged. Try again."
        : "Audit history could not be loaded. Try again.";
      retry.hidden = false;
      return;
    }
    const input = {
      ...filterInput(form),
      ...(cursor ? { cursor } : {}),
    };
    const workspaceId = session.session.workspace.id;
    const timePreferences = await loadTimePreferences(workspaceId);
    const result =
      await (personId
        ? listPersonAudit(personId, input, workspaceId)
        : listWorkspaceAudit(input, workspaceId)).catch(() => undefined);
    if (abort.signal.aborted || current !== generation) return;
    more.disabled = false;
    if (!result?.ok) {
      if (personId && personCrumb?.querySelector(".skeleton")) {
        personCrumb.textContent = "Person";
      }
      let retryable = true;
      if (result && !result.ok && result.problem.status === 403) {
        retryCursor = undefined;
        state.textContent = isContinuation
          ? "You no longer have permission to continue this audit history. Existing results are unchanged."
          : "You do not have permission to review audit history. Owner or administrator access is required.";
        if (isContinuation) retryable = false;
      } else if (result && !result.ok && result.problem.status === 404) {
        retryCursor = undefined;
        state.textContent = isContinuation
          ? "This audit scope is no longer available. Existing results are unchanged. Adjust filters to start a new search."
          : "This audit scope was not found in the active workspace.";
        if (isContinuation) retryable = false;
      } else if (result && !result.ok && result.problem.status === 409) {
        retryCursor = undefined;
        state.textContent =
          `This audit page is stale. Restart the filtered history.${
            isContinuation ? " Existing results are unchanged." : ""
          }`;
        nextCursor = undefined;
        more.hidden = true;
      } else {
        retryCursor = cursor;
        state.textContent = isContinuation
          ? "Older audit events could not be loaded. Existing results are unchanged. Try again."
          : "Audit history could not be loaded. Try again.";
      }
      if (!retryable) {
        nextCursor = undefined;
        more.hidden = true;
      }
      retry.hidden = !retryable;
      return;
    }
    if (heading && result.value.person) {
      heading.textContent = `${result.value.person.name} audit history`;
    }
    if (personId && result.value.person) {
      if (personCrumb) {
        personCrumb.href = `/app/people/${encodeURIComponent(personId)}`;
        personCrumb.textContent = result.value.person.name;
      }
    }
    const rendered = result.value.items.map((event) =>
      renderEvent(event, timePreferences)
    );
    if (cursor) list.append(...rendered);
    else list.replaceChildren(...rendered);
    nextCursor = result.value.nextCursor;
    retryCursor = undefined;
    more.hidden = !nextCursor;
    retry.hidden = true;
    state.textContent = list.children.length === 0
      ? "No audit events match this scope."
      : `${list.children.length} audit event${
        list.children.length === 1 ? "" : "s"
      } in immutable newest-first order.${
        result.value.status === "archived"
          ? " Archived person history remains readable."
          : ""
      }`;
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    nextCursor = undefined;
    void load();
  }, { signal: abort.signal });
  clear?.addEventListener("click", () => {
    form.reset();
    nextCursor = undefined;
    void load();
  }, { signal: abort.signal });
  more.addEventListener("click", () => {
    if (nextCursor) void load(nextCursor);
  }, { signal: abort.signal });
  retry.addEventListener("click", () => {
    const cursor = retryCursor;
    if (!cursor) nextCursor = undefined;
    void load(cursor);
  }, { signal: abort.signal });
  await load();
}

export async function mountPersonAuditSummary(
  personId: string,
  workspaceId: string,
  timePreferences?: TimePreferences,
): Promise<void> {
  const section = document.querySelector<HTMLElement>(
    "[data-person-audit-summary]",
  );
  const state = section?.querySelector<HTMLElement>(
    "[data-person-audit-state]",
  );
  const badge = section?.querySelector<HTMLElement>(
    "[data-person-audit-badge]",
  );
  const list = section?.querySelector<HTMLOListElement>(
    "[data-person-audit-list]",
  );
  const link = section?.querySelector<HTMLAnchorElement>(
    "[data-person-audit-link]",
  );
  const retry = section?.querySelector<HTMLButtonElement>(
    "[data-person-audit-retry]",
  );
  if (!section || !state || !badge || !list || !link || !retry) return;
  summaryAbort?.abort();
  const abort = new AbortController();
  summaryAbort = abort;
  const auditHref = `/app/people/${encodeURIComponent(personId)}/audit`;
  let generation = 0;
  const load = async () => {
    const current = ++generation;
    section.dataset.sectionState = "loading";
    badge.textContent = "Loading";
    state.textContent = "Loading authorized audit summary…";
    list.replaceChildren();
    link.hidden = true;
    link.removeAttribute("href");
    retry.hidden = true;
    const result = await listPersonAudit(personId, { limit: 3 }, workspaceId)
      .catch(() => undefined);
    if (abort.signal.aborted || current !== generation) return;
    if (!result?.ok) {
      section.dataset.sectionState = result && !result.ok &&
          result.problem.status === 403
        ? "forbidden"
        : "error";
      badge.textContent = result && !result.ok && result.problem.status === 403
        ? "Forbidden"
        : "Unavailable";
      state.textContent = result && !result.ok && result.problem.status === 403
        ? "Audit summary requires owner or administrator permission."
        : "Audit summary could not be loaded. Other profile sections remain available.";
      retry.hidden = false;
      return;
    }
    section.dataset.sectionState = "ready";
    badge.textContent = "Authorized";
    link.href = auditHref;
    link.hidden = false;
    list.replaceChildren(
      ...result.value.items.map((event) => renderEvent(event, timePreferences)),
    );
    state.textContent = result.value.items.length === 0
      ? "No audit events recorded for this person."
      : `${result.value.items.length} recent authorized audit event${
        result.value.items.length === 1 ? "" : "s"
      }.`;
  };
  retry.addEventListener("click", () => void load(), {
    signal: abort.signal,
  });
  await load();
}
