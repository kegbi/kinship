import {
  createImportantDate,
  deleteImportantDate,
  type ImportantDate,
  type ImportantDateInput,
  listImportantDates,
  type ProblemDetails,
  updateImportantDate,
} from "../../../../packages/contracts/generated/auth-client.ts";

interface ImportantDateElements {
  readonly add: HTMLButtonElement;
  readonly age: HTMLInputElement;
  readonly approximate: HTMLInputElement;
  readonly approximateRow: HTMLElement;
  readonly badge: HTMLElement;
  readonly cancel: HTMLButtonElement;
  readonly day: HTMLInputElement;
  readonly form: HTMLFormElement;
  readonly formState: HTMLElement;
  readonly kind: HTMLSelectElement;
  readonly label: HTMLInputElement;
  readonly labelRow: HTMLElement;
  readonly list: HTMLUListElement;
  readonly month: HTMLSelectElement;
  readonly notes: HTMLTextAreaElement;
  readonly precision: HTMLSelectElement;
  readonly section: HTMLElement;
  readonly state: HTMLElement;
  readonly version: HTMLInputElement;
  readonly year: HTMLInputElement;
}

function elements(): ImportantDateElements | undefined {
  const section = document.querySelector<HTMLElement>(
    "#profile-section-important-dates",
  );
  const add = document.querySelector<HTMLButtonElement>("#important-date-add");
  const age = document.querySelector<HTMLInputElement>("#important-date-age");
  const approximate = document.querySelector<HTMLInputElement>(
    "#important-date-approximate",
  );
  const approximateRow = document.querySelector<HTMLElement>(
    "#important-date-approximate-row",
  );
  const badge = document.querySelector<HTMLElement>("#important-dates-badge");
  const cancel = document.querySelector<HTMLButtonElement>(
    "#important-date-cancel",
  );
  const day = document.querySelector<HTMLInputElement>("#important-date-day");
  const form = document.querySelector<HTMLFormElement>("#important-date-form");
  const formState = document.querySelector<HTMLElement>(
    "#important-date-form-state",
  );
  const kind = document.querySelector<HTMLSelectElement>(
    "#important-date-kind",
  );
  const label = document.querySelector<HTMLInputElement>(
    "#important-date-label",
  );
  const labelRow = document.querySelector<HTMLElement>(
    "#important-date-label-row",
  );
  const list = document.querySelector<HTMLUListElement>(
    "#important-dates-list",
  );
  const month = document.querySelector<HTMLSelectElement>(
    "#important-date-month",
  );
  const notes = document.querySelector<HTMLTextAreaElement>(
    "#important-date-notes",
  );
  const precision = document.querySelector<HTMLSelectElement>(
    "#important-date-precision",
  );
  const state = document.querySelector<HTMLElement>("#important-dates-state");
  const version = document.querySelector<HTMLInputElement>(
    "#important-date-version",
  );
  const year = document.querySelector<HTMLInputElement>("#important-date-year");
  return section && add && age && approximate && approximateRow && badge &&
      cancel && day && form && formState && kind && label && labelRow && list &&
      month && notes && precision && state && version && year
    ? {
      add,
      age,
      approximate,
      approximateRow,
      badge,
      cancel,
      day,
      form,
      formState,
      kind,
      label,
      labelRow,
      list,
      month,
      notes,
      precision,
      section,
      state,
      version,
      year,
    }
    : undefined;
}

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthName(month: number | undefined): string {
  return month === undefined ? "Unknown month" : monthNames[month - 1] ?? "";
}

export function formatImportantDate(date: ImportantDate): string {
  const year = date.isYearApproximate ? `about ${date.year}` : `${date.year}`;
  if (date.precision === "full") {
    return `${monthName(date.month)} ${date.day}, ${year}`;
  }
  if (date.precision === "year_month") {
    return `${monthName(date.month)} ${year}`;
  }
  if (date.precision === "month_day") {
    return `${monthName(date.month)} ${date.day} (year unknown)`;
  }
  if (date.precision === "year") return year;
  if (date.precision === "month") {
    return `${monthName(date.month)} (year unknown)`;
  }
  if (date.precision === "day") {
    return `Day ${date.day} (month and year unknown)`;
  }
  return "Date unknown";
}

function title(date: ImportantDate): string {
  if (date.kind === "birthday") return "Birthday";
  if (date.kind === "deceased") return "Date of death";
  if (date.kind === "first_met") return "First meeting";
  return date.label ?? "Custom date";
}

function problemMessage(problem: ProblemDetails): string {
  if (problem.status === 404) return "This person is no longer available.";
  if (problem.status === 401 || problem.status === 403) {
    return "Your active workspace no longer permits this action.";
  }
  if (problem.status === 409) return problem.detail;
  return "Important dates are temporarily unavailable. Try again.";
}

function formProblemMessage(problem: ProblemDetails): string {
  if (problem.status !== 400) return problemMessage(problem);
  return Object.values(problem.errors ?? {})[0] ?? problem.detail;
}

function clearFormProblem(ui: ImportantDateElements): void {
  for (const control of [ui.day, ui.label, ui.month, ui.year]) {
    control.removeAttribute("aria-invalid");
    control.removeAttribute("aria-describedby");
  }
  ui.formState.textContent = "";
}

function showFormProblem(
  ui: ImportantDateElements,
  problem: ProblemDetails | undefined,
): void {
  clearFormProblem(ui);
  const field = problem ? Object.keys(problem.errors ?? {})[0] : undefined;
  const control = field === "day"
    ? ui.day
    : field === "label"
    ? ui.label
    : field === "month"
    ? ui.month
    : field === "year"
    ? ui.year
    : undefined;
  if (control) {
    control.setAttribute("aria-invalid", "true");
    control.setAttribute("aria-describedby", ui.formState.id);
  }
  ui.formState.textContent = problem
    ? formProblemMessage(problem)
    : "Important date saving is temporarily unavailable.";
  ui.formState.focus();
}

function applyKind(ui: ImportantDateElements): void {
  const custom = ui.kind.value === "custom";
  ui.labelRow.hidden = !custom;
  ui.label.required = custom;
  if (!custom) ui.label.value = "";
}

function applyPrecision(ui: ImportantDateElements): void {
  const required = new Set(
    ui.precision.value === "full"
      ? ["year", "month", "day"]
      : ui.precision.value === "year_month"
      ? ["year", "month"]
      : ui.precision.value === "month_day"
      ? ["month", "day"]
      : ui.precision.value === "unknown"
      ? []
      : [ui.precision.value],
  );
  for (
    const [name, input] of [
      ["year", ui.year],
      ["month", ui.month],
      ["day", ui.day],
    ] as const
  ) {
    const active = required.has(name);
    input.disabled = !active;
    input.required = active;
    input.closest<HTMLElement>("[data-date-component]")!.hidden = !active;
    if (!active) input.value = "";
  }
  const hasYear = required.has("year");
  ui.approximateRow.hidden = !hasYear;
  ui.approximate.disabled = !hasYear;
  ui.age.disabled = !hasYear;
  if (!hasYear) {
    ui.approximate.checked = false;
    ui.age.checked = false;
  }
}

function input(ui: ImportantDateElements): ImportantDateInput {
  return {
    ...(ui.day.disabled ? {} : { day: Number(ui.day.value) }),
    isAgeBased: ui.age.checked,
    isYearApproximate: ui.approximate.checked,
    kind: ui.kind.value as ImportantDateInput["kind"],
    ...(ui.label.value.trim() ? { label: ui.label.value.trim() } : {}),
    ...(ui.month.disabled ? {} : { month: Number(ui.month.value) }),
    ...(ui.notes.value.trim() ? { notes: ui.notes.value.trim() } : {}),
    precision: ui.precision.value as ImportantDateInput["precision"],
    ...(ui.year.disabled ? {} : { year: Number(ui.year.value) }),
  };
}

function fill(ui: ImportantDateElements, date?: ImportantDate): void {
  ui.form.reset();
  ui.form.dataset.dateId = date?.id ?? "";
  ui.version.value = date?.updatedAt ?? "";
  ui.kind.value = date?.kind ?? "birthday";
  ui.precision.value = date?.precision ?? "full";
  applyKind(ui);
  applyPrecision(ui);
  ui.label.value = date?.label ?? "";
  ui.year.value = date?.year === undefined ? "" : `${date.year}`;
  ui.month.value = date?.month === undefined ? "" : `${date.month}`;
  ui.day.value = date?.day === undefined ? "" : `${date.day}`;
  ui.approximate.checked = date?.isYearApproximate ?? false;
  ui.age.checked = date?.isAgeBased ?? false;
  ui.notes.value = date?.notes ?? "";
  clearFormProblem(ui);
}

function render(
  ui: ImportantDateElements,
  dates: readonly ImportantDate[],
  archived: boolean,
  onEdit: (date: ImportantDate) => void,
  onDelete: (date: ImportantDate, button: HTMLButtonElement) => void,
): void {
  ui.list.replaceChildren();
  for (const date of dates) {
    const item = document.createElement("li");
    const content = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = title(date);
    const value = document.createElement("span");
    value.textContent = formatImportantDate(date);
    const scheduling = document.createElement("small");
    scheduling.textContent = date.scheduling === "annual-reminder"
      ? "Annual reminder scheduled because month and day are known."
      : "No reminder scheduled; month and day are not both known.";
    content.append(heading, value, scheduling);
    item.append(content);
    if (!archived) {
      const actions = document.createElement("div");
      actions.className = "important-date-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = `Edit ${title(date)}`;
      edit.addEventListener("click", () => onEdit(date));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = `Delete ${title(date)}`;
      remove.addEventListener("click", () => onDelete(date, remove));
      actions.append(edit, remove);
      item.append(actions);
    }
    ui.list.append(item);
  }
  ui.state.textContent = archived
    ? dates.length === 0
      ? "No important dates recorded. This archived person is read-only."
      : "Important dates loaded. This archived person is read-only."
    : dates.length === 0
    ? "No important dates recorded."
    : `${dates.length} important ${
      dates.length === 1 ? "date" : "dates"
    } loaded.`;
  ui.badge.textContent = archived ? "Read only" : "Ready";
  ui.badge.classList.toggle("calm", !archived);
  ui.section.dataset.sectionState = "ready";
  ui.add.hidden = archived;
}

export async function mountImportantDates(
  personId: string,
  workspaceId: string,
  archived: boolean,
): Promise<void> {
  const ui = elements();
  if (!ui) return;
  let lifecycleArchived = archived;
  let dates: readonly ImportantDate[] = [];
  const listed = await listImportantDates(personId, workspaceId).catch(() =>
    undefined
  );
  if (!listed || !listed.ok) {
    ui.section.dataset.sectionState = listed?.problem.status === 401 ||
        listed?.problem.status === 403
      ? "forbidden"
      : "error";
    ui.badge.textContent = listed?.problem.status === 401 ||
        listed?.problem.status === 403
      ? "Forbidden"
      : "Error";
    ui.state.textContent = listed
      ? problemMessage(listed.problem)
      : "Important dates are temporarily unavailable. Try again.";
    return;
  }
  dates = listed.value.dates;

  const rerender = () =>
    render(
      ui,
      dates,
      lifecycleArchived,
      (date) => {
        fill(ui, date);
        ui.form.hidden = false;
        ui.form.querySelector<HTMLElement>("input:not([type=hidden]), select")
          ?.focus();
      },
      async (date, button) => {
        if (button.dataset.confirm !== "true") {
          button.dataset.confirm = "true";
          button.textContent = `Confirm delete ${title(date)}`;
          ui.state.textContent = "Press the delete button again to confirm.";
          return;
        }
        button.disabled = true;
        const result = await deleteImportantDate(
          personId,
          date.id,
          { expectedUpdatedAt: date.updatedAt },
          workspaceId,
        ).catch(() => undefined);
        if (!result || !result.ok) {
          button.disabled = false;
          button.dataset.confirm = "false";
          button.textContent = `Delete ${title(date)}`;
          ui.state.textContent = result
            ? problemMessage(result.problem)
            : "Important date deletion is temporarily unavailable.";
          return;
        }
        dates = dates.filter((candidate) => candidate.id !== date.id);
        rerender();
      },
    );
  rerender();

  document.addEventListener("person-lifecycle-changed", (event) => {
    const detail = (event as CustomEvent<{ readonly archived?: boolean }>)
      .detail;
    if (typeof detail?.archived !== "boolean") return;
    lifecycleArchived = detail.archived;
    if (lifecycleArchived) ui.form.hidden = true;
    rerender();
  });

  ui.kind.addEventListener("change", () => applyKind(ui));
  ui.precision.addEventListener("change", () => applyPrecision(ui));
  ui.add.addEventListener("click", () => {
    fill(ui);
    ui.form.hidden = false;
    ui.kind.focus();
  });
  ui.cancel.addEventListener("click", () => {
    ui.form.hidden = true;
    ui.add.focus();
  });
  ui.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!ui.form.reportValidity()) return;
    const dateId = ui.form.dataset.dateId;
    const result = dateId
      ? await updateImportantDate(
        personId,
        dateId,
        { ...input(ui), expectedUpdatedAt: ui.version.value },
        workspaceId,
      ).catch(() => undefined)
      : await createImportantDate(personId, input(ui), workspaceId).catch(() =>
        undefined
      );
    if (!result || !result.ok) {
      showFormProblem(ui, result?.problem);
      return;
    }
    dates = dateId
      ? dates.map((date) => date.id === dateId ? result.value.date : date)
      : [...dates, result.value.date];
    dates = [...dates].sort((left, right) =>
      (left.year ?? 10_000) - (right.year ?? 10_000) ||
      (left.month ?? 13) - (right.month ?? 13) ||
      (left.day ?? 32) - (right.day ?? 32) ||
      left.kind.localeCompare(right.kind) ||
      (left.label ?? "").localeCompare(right.label ?? "") ||
      left.id.localeCompare(right.id)
    );
    ui.form.hidden = true;
    rerender();
    ui.state.focus();
  });
}
