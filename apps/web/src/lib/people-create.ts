import {
  createPerson,
  type PersonIdentity,
  type PersonInput,
  type ProblemDetails,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";

function input(form: HTMLFormElement, name: string): HTMLInputElement {
  return form.elements.namedItem(name) as HTMLInputElement;
}

function optional(value: string): string | undefined {
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function displayName(person: PersonIdentity): string {
  const formal = [person.givenName, person.familyName].filter(Boolean).join(
    " ",
  );
  return formal || person.nickname || "Unnamed person";
}

function setFieldError(
  form: HTMLFormElement,
  name: string,
  message: string,
): void {
  const control = input(form, name);
  control.setCustomValidity(message);
  control.setAttribute("aria-invalid", "true");
  const target = form.querySelector<HTMLElement>(
    `[data-field-error="${name}"]`,
  );
  if (target) target.textContent = message;
}

function clearErrors(form: HTMLFormElement): void {
  for (const control of Array.from(form.elements)) {
    if (!(control instanceof HTMLInputElement)) continue;
    control.setCustomValidity("");
    control.removeAttribute("aria-invalid");
  }
  for (
    const target of form.querySelectorAll<HTMLElement>("[data-field-error]")
  ) {
    target.textContent = "";
  }
  const summary = document.querySelector<HTMLElement>("#people-form-errors");
  if (summary) summary.hidden = true;
}

function showErrors(
  form: HTMLFormElement,
  errors: Readonly<Record<string, string>>,
): void {
  const summary = document.querySelector<HTMLElement>("#people-form-errors");
  if (summary) {
    summary.hidden = false;
    summary.textContent =
      "Review the highlighted identity fields and try again.";
  }
  for (const [name, message] of Object.entries(errors)) {
    if (form.elements.namedItem(name) instanceof HTMLInputElement) {
      setFieldError(form, name, message);
    }
  }
  const first = form.querySelector<HTMLElement>("[aria-invalid='true']");
  (first ?? summary)?.focus();
}

function value(form: HTMLFormElement, duplicateOverride = false): PersonInput {
  const familyName = optional(input(form, "familyName").value);
  const middleName = optional(input(form, "middleName").value);
  const nickname = optional(input(form, "nickname").value);
  return {
    ...(duplicateOverride ? { duplicateOverride: true } : {}),
    ...(familyName ? { familyName } : {}),
    givenName: input(form, "givenName").value.trim(),
    isPartial: input(form, "isPartial").checked,
    ...(middleName ? { middleName } : {}),
    ...(nickname ? { nickname } : {}),
  };
}

function localErrors(person: PersonInput): Readonly<Record<string, string>> {
  if (!person.givenName && !person.familyName && !person.nickname) {
    return { givenName: "Enter a given name, family name, or nickname." };
  }
  if (!person.givenName && !person.isPartial) {
    return {
      isPartial:
        "Mark this person as partial when their given name is unknown.",
    };
  }
  return {};
}

function showCreated(person: PersonIdentity, next: string): void {
  document.querySelector<HTMLElement>("#people-create-heading")!.hidden = true;
  document.querySelector<HTMLFormElement>("#people-create-form")!.hidden = true;
  const created = document.querySelector<HTMLElement>("#created-person")!;
  const name = document.querySelector<HTMLElement>("#created-person-name")!;
  name.textContent = displayName(person);
  for (
    const field of [
      "givenName",
      "middleName",
      "familyName",
      "nickname",
    ] as const
  ) {
    const target = document.querySelector<HTMLElement>(
      `[data-person-field="${field}"]`,
    );
    if (target) target.textContent = person[field] || "Unknown";
  }
  const partial = document.querySelector<HTMLElement>(
    "#created-person-partial",
  );
  if (partial) partial.hidden = !person.isPartial;
  created.hidden = false;
  document.body.dataset.pageId = "people.profile";
  history.replaceState({}, "", next);
  name.focus();
}

function problemDetail(problem: ProblemDetails | undefined): string {
  return problem?.detail ?? "The person could not be created. Try again.";
}

export async function mountPeopleCreate(): Promise<void> {
  const form = document.querySelector<HTMLFormElement>("#people-create-form");
  const status = document.querySelector<HTMLElement>("#people-create-status");
  const duplicate = document.querySelector<HTMLElement>("#duplicate-warning");
  if (!form || !status || !duplicate) return;
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") {
    status.textContent = "Your active workspace could not be confirmed.";
    return;
  }
  const workspaceId = session.session.workspace.id;
  let addAnother = false;
  let pending = false;

  const submit = async (duplicateOverride = false): Promise<void> => {
    if (pending) return;
    clearErrors(form);
    const person = value(form, duplicateOverride);
    const errors = localErrors(person);
    if (Object.keys(errors).length > 0) {
      showErrors(form, errors);
      return;
    }
    pending = true;
    for (const button of form.querySelectorAll<HTMLButtonElement>("button")) {
      button.disabled = true;
    }
    status.textContent = "Saving person…";
    const result = await createPerson(person, workspaceId).catch(() =>
      undefined
    );
    pending = false;
    for (const button of form.querySelectorAll<HTMLButtonElement>("button")) {
      button.disabled = false;
    }
    if (!result?.ok) {
      status.textContent = problemDetail(result?.problem);
      if (result?.problem.code === "possible_duplicate") {
        duplicate.hidden = false;
        document.querySelector<HTMLElement>("#duplicate-detail")!.textContent =
          result.problem.detail;
        duplicate.focus();
        return;
      }
      if (result?.problem.errors) showErrors(form, result.problem.errors);
      return;
    }
    duplicate.hidden = true;
    if (addAnother) {
      const createdName = displayName(result.value.person);
      form.reset();
      addAnother = false;
      status.textContent = `${createdName} created. Add another person.`;
      input(form, "givenName").focus();
      return;
    }
    showCreated(result.value.person, result.value.next);
  };

  form.addEventListener("input", (event) => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement)) return;
    control.setCustomValidity("");
    control.removeAttribute("aria-invalid");
    const target = form.querySelector<HTMLElement>(
      `[data-field-error="${control.name}"]`,
    );
    if (target) target.textContent = "";
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    addAnother = (event as SubmitEvent).submitter?.id === "save-add-another";
    void submit();
  });
  document.querySelector<HTMLButtonElement>("#create-anyway")?.addEventListener(
    "click",
    () => void submit(true),
  );
  document.querySelector<HTMLButtonElement>("#review-person")?.addEventListener(
    "click",
    () => {
      duplicate.hidden = true;
      input(form, "givenName").focus();
    },
  );
}
