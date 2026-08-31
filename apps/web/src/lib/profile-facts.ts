import {
  createProfileFact,
  deleteProfileFact,
  getPerson,
  listPeople,
  listPeopleTagOptions,
  listProfileFacts,
  type PersonPrimaryContactMethod,
  type ProfileFactCreateInputBySection,
  type ProfileFactOption,
  type ProfileFactRecord,
  type ProfileFactSection,
  type ProfileFactSectionId,
  type ProfileFactUpdateInputBySection,
  updateProfileFact,
} from "../../../../packages/contracts/generated/auth-client.ts";
import {
  setFirstMeetingPlace,
  setRailCount,
  setRailEmpty,
  setVitalStat,
} from "./person-facts-rail.ts";
import {
  announceRailEditorOpened,
  onForeignRailEditorOpened,
} from "./rail-editors.ts";
import { insertProfileRailExpander } from "./profile-rail-expander.ts";
import { showToast } from "./toasts.ts";

interface FactElements {
  readonly add: HTMLButtonElement;
  readonly badge?: HTMLElement;
  readonly form: HTMLFormElement;
  readonly list?: HTMLUListElement;
  readonly root: HTMLElement;
  readonly state: HTMLElement;
}

const sections: readonly ProfileFactSectionId[] = [
  "contact-methods",
  "addresses",
  "first-meeting",
  "work",
  "food-preferences",
  "pets",
  "tags",
];

function elements(section: ProfileFactSectionId): FactElements | undefined {
  const root = document.querySelector<HTMLElement>(
    `[data-profile-fact-section="${section}"]`,
  );
  const add = root?.querySelector<HTMLButtonElement>("[data-profile-fact-add]");
  const form = root?.querySelector<HTMLFormElement>("[data-profile-fact-form]");
  const state = root?.querySelector<HTMLElement>("[data-profile-fact-state]");
  if (!root || !add || !form || !state) return undefined;
  const badge = root.querySelector<HTMLElement>("[data-profile-fact-badge]") ??
    undefined;
  const list =
    root.querySelector<HTMLUListElement>("[data-profile-fact-list]") ??
      undefined;
  return {
    add,
    ...(badge ? { badge } : {}),
    form,
    ...(list ? { list } : {}),
    root,
    state,
  };
}

function input(
  labelText: string,
  name: string,
  type = "text",
  required = false,
  maxLength = 2_000,
): HTMLLabelElement {
  const label = document.createElement("label");
  label.append(document.createTextNode(labelText));
  const control = document.createElement("input");
  control.name = name;
  control.type = type;
  control.required = required;
  control.maxLength = maxLength;
  label.append(control);
  return label;
}

function textarea(
  labelText: string,
  name: string,
  required = false,
): HTMLLabelElement {
  const label = document.createElement("label");
  label.append(document.createTextNode(labelText));
  const control = document.createElement("textarea");
  control.name = name;
  control.maxLength = 2_000;
  control.required = required;
  control.rows = 3;
  label.append(control);
  return label;
}

function checkbox(labelText: string, name: string): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "checkbox-row";
  const control = document.createElement("input");
  control.name = name;
  control.type = "checkbox";
  label.append(control, document.createTextNode(labelText));
  return label;
}

function actionButton(text: string, marker: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button-secondary";
  button.textContent = text;
  button.dataset[marker] = "";
  return button;
}

function select(
  labelText: string,
  name: string,
  options: readonly ProfileFactOption[],
  multiple = false,
  required = false,
): HTMLLabelElement {
  const label = document.createElement("label");
  label.append(document.createTextNode(labelText));
  const control = document.createElement("select");
  control.name = name;
  control.multiple = multiple;
  control.required = required;
  if (!multiple) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Select an option";
    control.append(empty);
  }
  for (const option of options) {
    const item = document.createElement("option");
    item.value = option.id;
    item.textContent = option.name;
    control.append(item);
  }
  label.append(control);
  return label;
}

function controls(
  form: HTMLFormElement,
): { cancel: HTMLButtonElement; save: HTMLButtonElement } {
  const actions = document.createElement("div");
  actions.className = "form-actions";
  const save = document.createElement("button");
  save.className = "button-primary";
  save.type = "submit";
  save.textContent = "Save profile fact";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "button-secondary";
  cancel.textContent = "Cancel";
  actions.append(save, cancel);
  form.append(actions);
  return { cancel, save };
}

function buildForm(
  section: ProfileFactSectionId,
  form: HTMLFormElement,
  options: readonly ProfileFactOption[],
): HTMLButtonElement {
  form.replaceChildren();
  form.noValidate = true;
  if (section === "contact-methods") {
    form.append(
      select(
        "Contact type",
        "typeId",
        options.filter((option) => option.kind === "contact-type"),
        false,
        true,
      ),
      input("Contact value", "value", "text", true),
      select(
        "Contact labels",
        "labelIds",
        options.filter((option) => option.kind === "contact-label"),
        true,
      ),
      checkbox("Primary for this contact type", "isPrimary"),
      textarea("Contact notes", "notes"),
      input(
        "Search contact options",
        "profileOptionSearch",
        "search",
        false,
        200,
      ),
      actionButton("Search contact options", "profileOptionSearch"),
      actionButton("Load more contact options", "profileOptionMore"),
    );
  } else if (section === "addresses") {
    form.append(
      input("Address name", "displayName", "text", false, 200),
      input("Street", "street", "text", false, 500),
      input("City", "city", "text", false, 200),
      input("Region", "region", "text", false, 200),
      input("Postal code", "postalCode", "text", false, 50),
      input("Country", "country", "text", false, 200),
      select("Address labels", "labelIds", options, true),
      checkbox("Primary address", "isPrimary"),
      input(
        "Search address labels",
        "profileOptionSearch",
        "search",
        false,
        200,
      ),
      actionButton("Search address labels", "profileOptionSearch"),
      actionButton("Load more address labels", "profileOptionMore"),
    );
  } else if (section === "first-meeting") {
    form.append(
      input("Where or how you first met", "placeText", "text", false, 500),
      input("Search people", "introducedBySearch", "search", false, 200),
      actionButton("Search people", "peopleSearch"),
      actionButton("Load more people", "peopleMore"),
      select("Introduced by", "introducedByPersonId", options),
      textarea("First meeting story", "notes"),
    );
  } else if (section === "work") {
    form.append(
      input("Role or title", "title", "text", true, 200),
      select(
        "Existing organization",
        "organizationId",
        options.filter((option) => option.kind === "organization"),
      ),
      input("New organization", "organizationName", "text", false, 200),
      input(
        "Search organizations",
        "profileOptionSearch",
        "search",
        false,
        200,
      ),
      actionButton("Search organizations", "profileOptionSearch"),
      actionButton("Load more organizations", "profileOptionMore"),
      input("Start date", "startOn", "date"),
      input("End date", "endOn", "date"),
      checkbox("Current role", "isCurrent"),
      textarea("Role description", "description"),
    );
  } else if (section === "food-preferences") {
    form.append(
      textarea(
        "Food, allergy, and dietary preferences",
        "foodPreferences",
        true,
      ),
    );
  } else if (section === "pets") {
    form.append(
      input("Pet name", "name", "text", false, 200),
      select("Pet category", "categoryId", options),
      textarea("Pet notes", "notes"),
      input(
        "Search pet categories",
        "profileOptionSearch",
        "search",
        false,
        200,
      ),
      actionButton("Search pet categories", "profileOptionSearch"),
      actionButton("Load more pet categories", "profileOptionMore"),
    );
  } else {
    form.append(
      input("Search tags", "tagSearch", "search", false, 200),
      actionButton("Search tags", "tagSearch"),
      actionButton("Load more tags", "tagMore"),
      select("Assigned tags", "tagIds", options, true),
    );
  }
  const status = document.createElement("p");
  status.dataset.profileFactFormState = "";
  status.className = "section-state";
  status.setAttribute("role", "alert");
  status.tabIndex = -1;
  form.append(status);
  return controls(form).cancel;
}

function setValue(form: HTMLFormElement, name: string, value: unknown): void {
  const control = form.elements.namedItem(name);
  if (control instanceof HTMLInputElement) {
    if (control.type === "checkbox") control.checked = value === true;
    else control.value = typeof value === "string" ? value : "";
  } else if (control instanceof HTMLTextAreaElement) {
    control.value = typeof value === "string" ? value : "";
  } else if (control instanceof HTMLSelectElement) {
    const selected = Array.isArray(value) ? new Set(value) : new Set([value]);
    for (const option of control.options) {
      option.selected = selected.has(option.value);
    }
  }
}

function replaceOptions(
  control: HTMLSelectElement,
  options: readonly ProfileFactOption[],
  append: boolean,
): void {
  const selected = new Set(
    Array.from(control.selectedOptions, (option) => option.value),
  );
  const existing = new Set(
    append ? Array.from(control.options, (option) => option.value) : [],
  );
  if (!append) control.replaceChildren();
  if (!control.multiple && !append) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Select an option";
    control.append(empty);
  }
  for (const option of options) {
    if (existing.has(option.id)) continue;
    const item = document.createElement("option");
    item.value = option.id;
    item.textContent = option.name;
    item.selected = selected.has(option.id);
    control.append(item);
    existing.add(option.id);
  }
}

function mergeOptions(
  ...groups: readonly (readonly ProfileFactOption[])[]
): readonly ProfileFactOption[] {
  return [...new Map(
    groups.flat().map((option) => [option.id, option]),
  ).values()];
}

function fill(form: HTMLFormElement, record?: ProfileFactRecord): void {
  form.dataset.factId = record?.id ?? "";
  form.dataset.expectedUpdatedAt = record?.updatedAt ?? "";
  form.reset();
  if (!record) return;
  for (const [name, value] of Object.entries(record.value)) {
    if (
      record.section === "work" && name === "organizationName" &&
      record.value.organizationId
    ) continue;
    setValue(form, name, value);
  }
}

function renderFieldErrors(
  form: HTMLFormElement,
  errors: Readonly<Record<string, string>> = {},
): void {
  form.querySelectorAll("[data-profile-fact-field-error]").forEach((node) =>
    node.remove()
  );
  form.querySelectorAll("[aria-invalid]").forEach((node) =>
    node.removeAttribute("aria-invalid")
  );
  let first: HTMLElement | undefined;
  for (const [name, message] of Object.entries(errors)) {
    const control = form.elements.namedItem(name);
    if (!(control instanceof HTMLElement)) continue;
    control.setAttribute("aria-invalid", "true");
    const error = document.createElement("span");
    error.dataset.profileFactFieldError = "";
    error.className = "field-error";
    error.textContent = message;
    control.insertAdjacentElement("afterend", error);
    first ??= control;
  }
  first?.focus();
}

const profileFactTextLimits: Readonly<
  Record<ProfileFactSectionId, Readonly<Record<string, number>>>
> = {
  addresses: {
    city: 200,
    country: 200,
    displayName: 200,
    postalCode: 50,
    region: 200,
    street: 500,
  },
  "contact-methods": { notes: 2_000, value: 2_000 },
  "first-meeting": { notes: 2_000, placeText: 500 },
  "food-preferences": { foodPreferences: 2_000 },
  pets: { name: 200, notes: 2_000 },
  tags: {},
  work: { description: 2_000, organizationName: 200, title: 200 },
};

function clientValidationErrors(
  section: ProfileFactSectionId,
  form: HTMLFormElement,
  selectedTagIds?: readonly string[],
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  const value = (name: string) => {
    const control = form.elements.namedItem(name);
    if (
      !(control instanceof HTMLInputElement) &&
      !(control instanceof HTMLTextAreaElement) &&
      !(control instanceof HTMLSelectElement)
    ) return "";
    const normalized = control.value.trim();
    if (
      control instanceof HTMLInputElement ||
      control instanceof HTMLTextAreaElement
    ) control.value = normalized;
    return normalized;
  };
  for (
    const [name, maximum] of Object.entries(profileFactTextLimits[section])
  ) {
    if (value(name).length > maximum) {
      errors[name] = `Enter no more than ${maximum} characters.`;
    }
  }
  if (section === "contact-methods") {
    if (!value("typeId")) errors.typeId = "Choose a contact type.";
    if (!value("value")) errors.value = "Enter a contact value.";
  } else if (section === "addresses") {
    if (
      !["displayName", "street", "city", "region", "postalCode", "country"]
        .some((name) => value(name))
    ) errors.displayName = "Enter address details.";
  } else if (section === "first-meeting") {
    if (
      !value("introducedByPersonId") && !value("placeText") && !value("notes")
    ) errors.placeText = "Enter first-meeting details.";
  } else if (section === "work") {
    if (!value("title")) errors.title = "Enter a role or title.";
  } else if (section === "food-preferences") {
    if (!value("foodPreferences")) {
      errors.foodPreferences = "Enter food preferences.";
    }
  } else if (section === "pets") {
    if (!value("name") && !value("categoryId")) {
      errors.name = "Enter a pet name or category.";
    }
  }
  if (["addresses", "contact-methods"].includes(section)) {
    const labels = form.elements.namedItem("labelIds");
    const labelCount = labels instanceof HTMLSelectElement
      ? labels.selectedOptions.length
      : 0;
    if (labelCount > 20) {
      errors.labelIds = "Choose no more than 20 labels.";
    }
  }
  if (section === "tags" && (selectedTagIds?.length ?? 0) > 500) {
    errors.tagIds = "Choose no more than 500 tags.";
  }
  return errors;
}

function formInput(
  section: ProfileFactSectionId,
  form: HTMLFormElement,
  expectedPersonUpdatedAt: string,
):
  | ProfileFactCreateInputBySection[ProfileFactSectionId]
  | ProfileFactUpdateInputBySection[ProfileFactSectionId]
  | undefined {
  const data = new FormData(form);
  const textValue = (name: string) => String(data.get(name) ?? "").trim();
  const optional = (name: string) => textValue(name) || undefined;
  const base = {
    expectedPersonUpdatedAt,
    ...(form.dataset.factId ? { id: form.dataset.factId } : {}),
    ...(form.dataset.expectedUpdatedAt
      ? { expectedUpdatedAt: form.dataset.expectedUpdatedAt }
      : {}),
  };
  if (section === "contact-methods") {
    const notes = optional("notes");
    return {
      ...base,
      section: "contact-methods",
      typeId: textValue("typeId"),
      value: textValue("value"),
      labelIds: data.getAll("labelIds").map(String),
      isPrimary: data.get("isPrimary") === "on",
      ...(notes ? { notes } : {}),
    };
  }
  if (section === "addresses") {
    const details = Object.fromEntries(
      ["displayName", "street", "city", "region", "postalCode", "country"]
        .flatMap((name) => optional(name) ? [[name, optional(name)]] : []),
    );
    if (Object.keys(details).length === 0) return undefined;
    return {
      ...base,
      ...details,
      section: "addresses",
      labelIds: data.getAll("labelIds").map(String),
      isPrimary: data.get("isPrimary") === "on",
    } as unknown as ProfileFactCreateInputBySection["addresses"];
  }
  if (section === "first-meeting") {
    const placeText = optional("placeText");
    const notes = optional("notes");
    const introducedByPersonId = optional("introducedByPersonId");
    if (!introducedByPersonId && !placeText && !notes) return undefined;
    return {
      ...base,
      section: "first-meeting",
      ...(introducedByPersonId ? { introducedByPersonId } : {}),
      ...(placeText ? { placeText } : {}),
      ...(notes ? { notes } : {}),
    } as ProfileFactCreateInputBySection["first-meeting"];
  }
  if (section === "work") {
    const organizationId = optional("organizationId");
    const organizationName = organizationId
      ? undefined
      : optional("organizationName");
    const startOn = optional("startOn");
    const endOn = optional("endOn");
    const description = optional("description");
    return {
      ...base,
      section: "work",
      title: textValue("title"),
      isCurrent: data.get("isCurrent") === "on",
      ...(organizationId ? { organizationId } : {}),
      ...(organizationName ? { organizationName } : {}),
      ...(startOn ? { startOn } : {}),
      ...(endOn ? { endOn } : {}),
      ...(description ? { description } : {}),
    };
  }
  if (section === "food-preferences") {
    return {
      ...base,
      foodPreferences: textValue("foodPreferences"),
      section: "food-preferences",
    };
  }
  if (section === "pets") {
    const name = optional("name");
    const categoryId = optional("categoryId");
    const notes = optional("notes");
    if (!name && !categoryId) return undefined;
    return {
      ...base,
      section: "pets",
      ...(name ? { name } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(notes ? { notes } : {}),
    } as ProfileFactCreateInputBySection["pets"];
  }
  return {
    ...base,
    section: "tags",
    tagIds: data.getAll("tagIds").map(String),
  };
}

function summary(
  record: ProfileFactRecord,
  options: readonly ProfileFactOption[],
): string {
  if (record.section === "contact-methods") {
    return `${
      options.find((option) => option.id === record.value.typeId)?.name ??
        "Contact"
    }: ${record.value.value ?? ""}`;
  }
  if (record.section === "addresses") {
    return [
      record.value.displayName,
      record.value.street,
      record.value.city,
      record.value.country,
    ].filter(Boolean).join(", ");
  }
  if (record.section === "first-meeting") {
    return [record.value.placeText, record.value.notes].filter(Boolean).join(
      " — ",
    ) ||
      "No first-meeting context saved";
  }
  if (record.section === "work") {
    return [record.value.title, record.value.organizationName].filter(Boolean)
      .join(" at ");
  }
  if (record.section === "food-preferences") {
    return record.value.foodPreferences ?? "No food preferences saved";
  }
  if (record.section === "pets") {
    return [
      record.value.name,
      options.find((option) => option.id === record.value.categoryId)?.name,
    ].filter(Boolean).join(" · ");
  }
  return "Tag assignments";
}

type ClampedProfileFactSection = "first-meeting" | "food-preferences";

function insertProfileRailTextClamp(
  description: HTMLParagraphElement,
  section: ClampedProfileFactSection,
): void {
  description.classList.add("profile-rail-clamped-summary");
  requestAnimationFrame(() => {
    if (
      !description.isConnected ||
      description.scrollHeight <= description.clientHeight
    ) return;
    const control = document.createElement("button");
    control.type = "button";
    control.className = "button-secondary profile-rail-summary-control";
    const suffix = document.createElement("span");
    suffix.className = "sr-only";
    suffix.textContent = ` ${section.replaceAll("-", " ")}`;
    const setExpanded = (expanded: boolean) => {
      if (expanded) description.dataset.expanded = "true";
      else delete description.dataset.expanded;
      control.setAttribute("aria-expanded", String(expanded));
      control.replaceChildren(
        document.createTextNode(expanded ? "Less" : "More"),
        suffix,
      );
    };
    setExpanded(false);
    control.addEventListener(
      "click",
      () => setExpanded(control.getAttribute("aria-expanded") !== "true"),
    );
    description.insertAdjacentElement("afterend", control);
  });
}

function addressSummaryLines(
  record: Extract<ProfileFactRecord, { readonly section: "addresses" }>,
  options: readonly ProfileFactOption[],
): readonly string[] {
  const label = record.value.displayName ??
    options.find((option) => record.value.labelIds.includes(option.id))?.name;
  const locality = [
    record.value.city,
    record.value.region,
    record.value.postalCode,
    record.value.country,
  ].filter((value): value is string => Boolean(value)).join(", ");
  return [label, record.value.street, locality].filter(
    (value): value is string => Boolean(value),
  );
}

function selectWorkSummaryRecord(
  records: readonly ProfileFactRecord[],
): Extract<ProfileFactRecord, { readonly section: "work" }> | undefined {
  const work = records.filter(
    (record): record is Extract<
      ProfileFactRecord,
      { readonly section: "work" }
    > => record.section === "work",
  );
  const current = work.filter((record) => record.value.endOn === undefined);
  const candidates = current.length > 0 ? current : work;
  const date = (record: typeof candidates[number]) =>
    current.length > 0 ? record.value.startOn ?? "" : record.value.endOn ?? "";
  return [...candidates].sort((left, right) => {
    const leftDate = date(left);
    const rightDate = date(right);
    if (leftDate !== rightDate) return leftDate > rightDate ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  })[0];
}

type RailProfileFactSection = Exclude<ProfileFactSectionId, "tags">;

function clearRailPresentation(section: RailProfileFactSection): void {
  setRailCount(section, undefined);
  setRailEmpty(section, false);
  if (section === "work") setVitalStat("work", undefined);
  if (section === "first-meeting") setFirstMeetingPlace(undefined);
}

function publishRailPresentation(
  section: RailProfileFactSection,
  snapshot: ProfileFactSection,
): void {
  setRailCount(section, snapshot.records.length);
  setRailEmpty(section, snapshot.records.length === 0);
  if (section === "work") {
    const record = snapshot.records.find((record) => record.section === "work");
    setVitalStat(
      "work",
      record ? summary(record, snapshot.options) : undefined,
    );
  }
  if (section === "first-meeting") {
    const record = snapshot.records.find((record) =>
      record.section === "first-meeting"
    );
    setFirstMeetingPlace(
      record?.section === "first-meeting" ? record.value.placeText : undefined,
    );
  }
}

function renderTags(
  record: Extract<ProfileFactRecord, { readonly section: "tags" }>,
  options: readonly ProfileFactOption[],
): void {
  const list = document.querySelector<HTMLUListElement>("#person-profile-tags");
  if (!list) return;
  list.hidden = false;
  const selected = new Set(record.value.tagIds);
  const names = options.filter((option) => selected.has(option.id));
  list.replaceChildren();
  if (!names.length) {
    const item = document.createElement("li");
    item.className = "profile-tag-empty";
    item.textContent = "No tags saved";
    list.append(item);
  } else {
    for (const option of names.slice(0, 8)) {
      const item = document.createElement("li");
      item.textContent = option.name;
      list.append(item);
    }
    if (names.length > 8) {
      const more = document.createElement("li");
      more.textContent = `+${names.length - 8} more`;
      list.append(more);
    }
  }
}

export async function mountProfileFacts(
  personId: string,
  workspaceId: string,
  initiallyArchived: boolean,
  initialPersonUpdatedAt: string,
  initialPrimaryContactMethods?: readonly PersonPrimaryContactMethod[],
): Promise<void> {
  let archived = initiallyArchived;
  let personUpdatedAt = initialPersonUpdatedAt;
  let primaryContactMethods = initialPrimaryContactMethods;
  let renderContactMethods: (() => void) | undefined;
  const snapshots = new Map<ProfileFactSectionId, ProfileFactSection>();
  const ownForms = sections.flatMap((section) => {
    const form = elements(section)?.form;
    return form ? [form] : [];
  });
  onForeignRailEditorOpened(ownForms, (form) => {
    form.hidden = true;
    form.reset();
  });
  const applyPersonRevision = (
    candidate: string,
    announce = false,
  ): string => {
    const canonical = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
    if (canonical.test(candidate) && candidate > personUpdatedAt) {
      personUpdatedAt = candidate;
      if (announce) {
        document.dispatchEvent(
          new CustomEvent("person-revision-changed", {
            detail: { personUpdatedAt },
          }),
        );
      }
    }
    return personUpdatedAt;
  };
  const refreshPrimaryContactMethods = async (): Promise<void> => {
    const result = await getPerson(personId, workspaceId, "summary").catch(
      () => undefined,
    );
    const refreshed = result?.ok
      ? result.value.summary?.primaryContactMethods
      : undefined;
    if (refreshed === undefined) return;
    primaryContactMethods = refreshed;
    renderContactMethods?.();
  };

  const load = async (section: ProfileFactSectionId): Promise<void> => {
    const target = elements(section);
    if (!target) return;
    if (section === "contact-methods") renderContactMethods = undefined;
    target.root.dataset.sectionState = "loading";
    target.state.textContent = `Loading ${section.replaceAll("-", " ")}…`;
    target.badge && (target.badge.textContent = "Loading");
    const result = await listProfileFacts(personId, section, {}, workspaceId)
      .catch(() => undefined);
    if (!result || !result.ok) {
      const forbidden = result && !result.ok &&
        [401, 403].includes(result.problem.status);
      target.root.dataset.sectionState = forbidden ? "forbidden" : "error";
      target.state.textContent = forbidden
        ? "Your active workspace no longer permits this action."
        : "This profile section is temporarily unavailable. Try again.";
      target.badge &&
        (target.badge.textContent = forbidden ? "Forbidden" : "Error");
      if (section !== "tags") {
        setRailEmpty(section, false);
        if (forbidden) clearRailPresentation(section);
      }
      return;
    }
    let snapshot: ProfileFactSection = {
      ...result.value,
      options: mergeOptions(
        result.value.options,
        result.value.records.flatMap((record) => record.selectedOptions ?? []),
      ),
    };
    applyPersonRevision(snapshot.personUpdatedAt);
    snapshots.set(section, snapshot);
    if (snapshot.status === "hidden") {
      snapshots.delete(section);
      target.root.dataset.sectionState = "hidden";
      target.root.hidden = true;
      target.list?.replaceChildren();
      target.root.querySelector("[data-profile-fact-pagination]")?.remove();
      target.form.replaceChildren();
      target.form.onsubmit = null;
      target.form.removeAttribute("data-fact-id");
      target.form.removeAttribute("data-expected-updated-at");
      target.state.textContent = "";
      target.badge && (target.badge.textContent = "Hidden");
      target.add.onclick = null;
      target.add.hidden = true;
      if (section !== "tags") clearRailPresentation(section);
      if (section === "tags") {
        const preview = document.querySelector<HTMLElement>(
          "#person-profile-tags",
        );
        if (preview) {
          preview.replaceChildren();
          preview.hidden = true;
        }
      }
      const profileSection = target.root.dataset.profileSection;
      if (profileSection) {
        document.querySelector<HTMLElement>(
          `[data-section-link="${profileSection}"]`,
        )?.closest("li")?.setAttribute("hidden", "");
      }
      return;
    }
    target.root.hidden = false;
    const profileSection = target.root.dataset.profileSection;
    if (profileSection) {
      document.querySelector<HTMLElement>(
        `[data-section-link="${profileSection}"]`,
      )?.closest("li")?.removeAttribute("hidden");
    }
    target.root.dataset.sectionState = snapshot.status === "archived"
      ? "read-only"
      : "ready";
    target.badge &&
      (target.badge.textContent = snapshot.status === "archived"
        ? "Read-only"
        : "Ready");
    target.state.textContent = snapshot.records.length
      ? `${snapshot.records.length} saved.`
      : `No ${section.replaceAll("-", " ")} saved.`;
    target.add.hidden = archived || snapshot.status === "archived";
    const addLabel = section === "tags"
      ? "Edit tags"
      : snapshot.records.length &&
          ["first-meeting", "food-preferences"].includes(section)
      ? `Edit ${section.replaceAll("-", " ")}`
      : `Add ${section.replaceAll("-", " ")}`;
    if (target.add.hasAttribute("data-profile-fact-add-icon")) {
      target.add.setAttribute("aria-label", addLabel);
    } else target.add.textContent = addLabel;
    buildForm(section, target.form, snapshot.options);
    let prepareEditor = (
      _record?: ProfileFactRecord,
    ): Promise<boolean> => Promise.resolve(true);
    let tagSelection: (() => readonly string[]) | undefined;
    if (section === "first-meeting") {
      const search = target.form.elements.namedItem("introducedBySearch");
      const control = target.form.elements.namedItem("introducedByPersonId");
      const searchButton = target.form.querySelector<HTMLButtonElement>(
        "[data-people-search]",
      );
      const moreButton = target.form.querySelector<HTMLButtonElement>(
        "[data-people-more]",
      );
      if (
        search instanceof HTMLInputElement &&
        control instanceof HTMLSelectElement && searchButton && moreButton
      ) {
        let cursor: string | undefined;
        let prepared = false;
        let selectedId = snapshot.records[0]?.section === "first-meeting"
          ? snapshot.records[0].value.introducedByPersonId
          : undefined;
        const known = new Map<string, ProfileFactOption>();
        const lookup = async (append: boolean, hydrate = false) => {
          if (prepared && control.value) selectedId = control.value;
          searchButton.disabled = true;
          moreButton.disabled = true;
          const people = await listPeople({
            ...(append && cursor ? { cursor } : {}),
            excludePersonId: personId,
            limit: 20,
            ...(search.value.trim() ? { search: search.value.trim() } : {}),
            ...(hydrate && selectedId ? { selectedPersonId: selectedId } : {}),
          }, workspaceId).catch(() => undefined);
          searchButton.disabled = false;
          moreButton.disabled = false;
          if (!people || !people.ok) {
            target.form.querySelector<HTMLButtonElement>(
              'button[type="submit"]',
            )!
              .disabled = true;
            moreButton.hidden = true;
            target.state.textContent =
              "Current introducer could not be verified. No changes were saved.";
            return false;
          }
          if (
            hydrate && selectedId &&
            (!people.value.selected ||
              people.value.selected.id !== selectedId ||
              selectedId === personId)
          ) {
            target.form.querySelector<HTMLButtonElement>(
              'button[type="submit"]',
            )!
              .disabled = true;
            target.state.textContent =
              "Current introducer could not be verified. No changes were saved.";
            moreButton.hidden = true;
            return false;
          }
          const candidates = [
            ...(people.value.selected ? [people.value.selected] : []),
            ...people.value.people,
          ].filter((person) => person.id !== personId).map((person) => ({
            id: person.id,
            name: [person.givenName, person.familyName].filter(Boolean).join(
              " ",
            ),
          }));
          for (const option of candidates) known.set(option.id, option);
          const preserved = selectedId && known.has(selectedId)
            ? [known.get(selectedId)!]
            : [];
          replaceOptions(
            control,
            [...preserved, ...candidates],
            append,
          );
          if (selectedId) {
            setValue(target.form, "introducedByPersonId", selectedId);
          }
          cursor = people.value.nextCursor;
          moreButton.hidden = !cursor;
          target.form.querySelector<HTMLButtonElement>('button[type="submit"]')!
            .disabled = false;
          prepared = true;
          return true;
        };
        searchButton.onclick = () => void lookup(false);
        moreButton.onclick = () => void lookup(true);
        prepareEditor = async () => prepared || await lookup(false, true);
      }
    }
    if (section === "tags") {
      const search = target.form.elements.namedItem("tagSearch");
      const control = target.form.elements.namedItem("tagIds");
      const searchButton = target.form.querySelector<HTMLButtonElement>(
        "[data-tag-search]",
      );
      const moreButton = target.form.querySelector<HTMLButtonElement>(
        "[data-tag-more]",
      );
      const submit = target.form.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      if (
        search instanceof HTMLInputElement &&
        control instanceof HTMLSelectElement && searchButton && moreButton &&
        submit
      ) {
        let cursor: string | undefined;
        let prepared = false;
        const existingIds = snapshot.records[0]?.section === "tags"
          ? snapshot.records[0].value.tagIds
          : [];
        const assigned = new Map<string, ProfileFactOption>();
        for (const option of snapshot.options) {
          if (existingIds.includes(option.id)) assigned.set(option.id, option);
        }
        const capture = () => {
          for (const option of control.options) {
            if (option.selected) {
              assigned.set(option.value, {
                id: option.value,
                name: option.textContent ?? option.value,
              });
            } else if (assigned.has(option.value)) {
              assigned.delete(option.value);
            }
          }
          return [...assigned.keys()];
        };
        const lookup = async (append: boolean) => {
          capture();
          searchButton.disabled = true;
          moreButton.disabled = true;
          const tags = await listPeopleTagOptions({
            ...(append && cursor ? { cursor } : {}),
            ...(search.value.trim() ? { search: search.value.trim() } : {}),
          }, workspaceId).catch(() => undefined);
          searchButton.disabled = false;
          moreButton.disabled = false;
          if (!tags || !tags.ok) {
            submit.disabled = true;
            moreButton.hidden = true;
            target.state.textContent =
              "Tag options are temporarily unavailable. No assignments can be changed.";
            return;
          }
          submit.disabled = false;
          replaceOptions(
            control,
            [...assigned.values(), ...tags.value.options],
            append,
          );
          setValue(target.form, "tagIds", [...assigned.keys()]);
          cursor = tags.value.nextCursor;
          moreButton.hidden = !cursor;
        };
        searchButton.onclick = () => void lookup(false);
        moreButton.onclick = () => void lookup(true);
        prepareEditor = async () => {
          if (prepared) return true;
          if (existingIds.some((id) => !assigned.has(id))) {
            submit.disabled = true;
            target.state.textContent =
              "Current tag assignments could not be verified. No assignments can be changed.";
            return false;
          }
          const page = await listPeopleTagOptions({}, workspaceId).catch(() =>
            undefined
          );
          if (
            !page || !page.ok
          ) {
            submit.disabled = true;
            target.state.textContent =
              "Current tag assignments could not be verified. No assignments can be changed.";
            return false;
          }
          replaceOptions(
            control,
            [...assigned.values(), ...page.value.options],
            false,
          );
          setValue(target.form, "tagIds", [...assigned.keys()]);
          cursor = page.value.nextCursor;
          moreButton.hidden = !cursor;
          prepared = true;
          return true;
        };
        tagSelection = capture;
      }
    }
    if (["contact-methods", "addresses", "pets", "work"].includes(section)) {
      const search = target.form.elements.namedItem("profileOptionSearch");
      const searchButton = target.form.querySelector<HTMLButtonElement>(
        "[data-profile-option-search]",
      );
      const moreButton = target.form.querySelector<HTMLButtonElement>(
        "[data-profile-option-more]",
      );
      const submit = target.form.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      const optionControls = section === "contact-methods"
        ? ["typeId", "labelIds"]
        : section === "addresses"
        ? ["labelIds"]
        : section === "work"
        ? ["organizationId"]
        : ["categoryId"];
      if (
        search instanceof HTMLInputElement && searchButton && moreButton &&
        submit
      ) {
        let cursor: string | undefined;
        let prepared = false;
        const selected = new Map(
          snapshot.options.map((option) => [option.id, option]),
        );
        const capture = () => {
          for (const name of optionControls) {
            const control = target.form.elements.namedItem(name);
            if (!(control instanceof HTMLSelectElement)) continue;
            for (const option of control.options) {
              if (option.value && option.selected) {
                selected.set(option.value, {
                  id: option.value,
                  name: option.textContent ?? option.value,
                });
              } else if (option.value && selected.has(option.value)) {
                selected.delete(option.value);
              }
            }
          }
        };
        const lookup = async (append: boolean) => {
          capture();
          searchButton.disabled = true;
          moreButton.disabled = true;
          const result = await listProfileFacts(personId, section, {
            includeOptions: true,
            ...(append && cursor ? { optionCursor: cursor } : {}),
            ...(search.value.trim()
              ? { optionSearch: search.value.trim() }
              : {}),
          }, workspaceId).catch(() => undefined);
          searchButton.disabled = false;
          moreButton.disabled = false;
          if (!result || !result.ok) {
            submit.disabled = true;
            moreButton.hidden = true;
            target.state.textContent =
              "Profile options are temporarily unavailable. No changes were saved.";
            return false;
          }
          for (const name of optionControls) {
            const control = target.form.elements.namedItem(name);
            if (!(control instanceof HTMLSelectElement)) continue;
            const kind = name === "typeId"
              ? "contact-type"
              : name === "categoryId"
              ? "pet-category"
              : name === "organizationId"
              ? "organization"
              : "contact-label";
            const page = result.value.options.filter((option) =>
              option.kind === kind
            );
            replaceOptions(
              control,
              [
                ...selected.values().filter((option) => option.kind === kind),
                ...page,
              ],
              append,
            );
          }
          cursor = result.value.nextOptionsCursor;
          moreButton.hidden = !cursor;
          submit.disabled = false;
          prepared = true;
          return true;
        };
        searchButton.onclick = () => void lookup(false);
        moreButton.onclick = () => void lookup(true);
        moreButton.hidden = true;
        const previousPrepare = prepareEditor;
        prepareEditor = async (record) => {
          if (record?.referencesResolved === false) {
            submit.disabled = true;
            target.state.textContent =
              "Current profile references could not be verified. No changes were saved.";
            target.state.focus();
            return false;
          }
          const ready = await previousPrepare(record) &&
            (prepared || await lookup(false));
          if (!ready) return false;
          const descriptors = record?.selectedOptions ?? [];
          for (const option of descriptors) selected.set(option.id, option);
          for (const name of optionControls) {
            const control = target.form.elements.namedItem(name);
            if (!(control instanceof HTMLSelectElement)) continue;
            const kind = name === "typeId"
              ? "contact-type"
              : name === "categoryId"
              ? "pet-category"
              : name === "organizationId"
              ? "organization"
              : "contact-label";
            replaceOptions(
              control,
              descriptors.filter((option) => option.kind === kind),
              true,
            );
          }
          return true;
        };
        if (section === "work") {
          const organization = target.form.elements.namedItem(
            "organizationId",
          );
          const newOrganization = target.form.elements.namedItem(
            "organizationName",
          );
          if (
            organization instanceof HTMLSelectElement &&
            newOrganization instanceof HTMLInputElement
          ) {
            organization.addEventListener("change", () => {
              if (organization.value) newOrganization.value = "";
            });
            newOrganization.addEventListener("input", () => {
              if (newOrganization.value.trim()) organization.value = "";
            });
          }
        }
      }
    }
    if (section === "tags") {
      const tagRecord = snapshot.records[0];
      if (tagRecord?.section === "tags") {
        renderTags(tagRecord, snapshot.options);
      }
    }
    const renderRecords = () => {
      target.list?.replaceChildren();
      target.root.querySelector("[data-profile-fact-expander]")?.remove();
      const summarizedById = section === "contact-methods" &&
          primaryContactMethods?.length
        ? new Map(primaryContactMethods.map((method) => [method.id, method]))
        : undefined;
      const primaryById = summarizedById &&
          snapshot.records.some((record) => summarizedById.has(record.id))
        ? summarizedById
        : undefined;
      const addressSummaryId = section === "addresses"
        ? snapshot.records.find((record) => record.section === "addresses")?.id
        : undefined;
      const workSummaryId = section === "work"
        ? selectWorkSummaryRecord(snapshot.records)?.id
        : undefined;
      const hiddenItems: HTMLLIElement[] = [];
      for (const record of snapshot.records) {
        const item = document.createElement("li");
        const description = document.createElement("p");
        const primary = primaryById?.get(record.id);
        if (record.section === "contact-methods" && primary) {
          const value = record.value.value ?? "";
          const label = snapshot.options.find((option) =>
            option.id === record.value.typeId
          )
            ?.name ?? "Contact";
          description.append(document.createTextNode(`${label}: `));
          if (primary.href) {
            const link = document.createElement("a");
            link.href = primary.href;
            link.textContent = value;
            description.append(link);
          } else description.append(document.createTextNode(value));
          const copyButton = document.createElement("button");
          copyButton.type = "button";
          copyButton.className =
            "button-secondary profile-rail-summary-control profile-contact-copy";
          copyButton.textContent = "Copy";
          copyButton.setAttribute("aria-label", `Copy ${value}`);
          copyButton.addEventListener("click", async () => {
            try {
              await navigator.clipboard.writeText(value);
              showToast({ message: `Copied ${value}`, tone: "success" });
            } catch {
              showToast({
                message: "Copy failed. Select the value and copy it manually.",
                tone: "error",
              });
            }
          });
          item.append(description, copyButton);
        } else if (record.section === "addresses") {
          description.className = "profile-address-summary";
          description.append(
            ...addressSummaryLines(record, snapshot.options).map((line) => {
              const value = document.createElement("span");
              value.textContent = line;
              return value;
            }),
          );
          item.append(description);
        } else {
          description.textContent = summary(record, snapshot.options);
          if (
            record.section === "first-meeting" ||
            record.section === "food-preferences"
          ) insertProfileRailTextClamp(description, record.section);
          item.append(description);
        }
        if (
          (primaryById && !primary) ||
          (addressSummaryId !== undefined && record.id !== addressSummaryId) ||
          (workSummaryId !== undefined && record.id !== workSummaryId)
        ) {
          item.hidden = true;
          hiddenItems.push(item);
        }
        if (!archived && snapshot.status !== "archived") {
          const edit = document.createElement("button");
          edit.type = "button";
          edit.className = "button-secondary";
          edit.textContent = `Edit ${summary(record, snapshot.options)}`;
          edit.addEventListener("click", async () => {
            const submit = target.form.querySelector<HTMLButtonElement>(
              'button[type="submit"]',
            );
            if (submit) submit.disabled = true;
            const ready = await prepareEditor(record);
            if (!ready) return;
            fill(target.form, record);
            target.form.hidden = false;
            if (submit && ready) submit.disabled = false;
            target.form.querySelector<HTMLElement>("input, select, textarea")
              ?.focus();
            announceRailEditorOpened(target.form);
          });
          item.append(edit);
          if (section !== "tags") {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "button-danger";
            remove.textContent = section === "food-preferences"
              ? "Clear food preferences"
              : `Delete ${summary(record, snapshot.options)}`;
            let confirming = false;
            remove.addEventListener("click", async () => {
              if (!confirming) {
                confirming = true;
                remove.textContent = section === "food-preferences"
                  ? "Confirm clear food preferences"
                  : `Confirm delete ${summary(record, snapshot.options)}`;
                target.state.textContent =
                  "Press the delete button again to confirm.";
                target.state.focus();
                return;
              }
              const deleted = await deleteProfileFact(
                personId,
                section,
                record.id,
                {
                  expectedPersonUpdatedAt: personUpdatedAt,
                  expectedUpdatedAt: record.updatedAt,
                  section,
                },
                workspaceId,
              ).catch(() => undefined);
              if (!deleted || !deleted.ok) {
                target.state.textContent = deleted && !deleted.ok
                  ? deleted.problem.detail
                  : "Delete is temporarily unavailable.";
                return;
              }
              applyPersonRevision(deleted.value.personUpdatedAt, true);
              if (section === "contact-methods") {
                await Promise.all([
                  load(section),
                  refreshPrimaryContactMethods(),
                ]);
              } else await load(section);
              target.state.textContent = "Profile fact deleted.";
              target.state.focus();
            });
            item.append(remove);
          }
        }
        target.list?.append(item);
      }
      if (target.list && hiddenItems.length) {
        const isWork = section === "work";
        insertProfileRailExpander(target.list, hiddenItems, {
          accessibleSuffix: isWork
            ? "work roles"
            : section.replaceAll("-", " "),
          collapsedLabel: isWork
            ? "Show history"
            : `+ ${hiddenItems.length} more`,
          datasetKey: "profileFactExpander",
        });
      }
      if (section !== "tags") {
        publishRailPresentation(section, snapshot);
      }
    };
    if (section === "contact-methods") renderContactMethods = renderRecords;
    renderRecords();
    target.root.querySelector("[data-profile-fact-pagination]")?.remove();
    if (target.list) {
      const pagination = document.createElement("nav");
      pagination.dataset.profileFactPagination = "";
      pagination.setAttribute("aria-label", `${section} fact pages`);
      const previousFacts = document.createElement("button");
      previousFacts.type = "button";
      previousFacts.className = "button-secondary";
      previousFacts.dataset.profileFactPrevious = "";
      previousFacts.textContent = `Previous ${section.replaceAll("-", " ")}`;
      const moreFacts = document.createElement("button");
      moreFacts.type = "button";
      moreFacts.className = "button-secondary";
      moreFacts.dataset.profileFactMore = "";
      moreFacts.textContent = `Next ${section.replaceAll("-", " ")}`;
      const pageCursors: Array<string | undefined> = [undefined];
      let pageIndex = 0;
      const updatePagination = () => {
        previousFacts.hidden = pageIndex === 0;
        moreFacts.hidden = !snapshot.nextCursor;
      };
      const showPage = async (
        cursor: string | undefined,
        nextIndex: number,
      ) => {
        previousFacts.disabled = true;
        moreFacts.disabled = true;
        const next = await listProfileFacts(personId, section, {
          ...(cursor ? { cursor } : {}),
        }, workspaceId).catch(() => undefined);
        previousFacts.disabled = false;
        moreFacts.disabled = false;
        if (!next || !next.ok) {
          target.state.textContent =
            "That profile fact page is temporarily unavailable.";
          return;
        }
        const nextDescriptors = next.value.records.flatMap((record) =>
          record.selectedOptions ?? []
        );
        pageIndex = nextIndex;
        snapshot = {
          ...snapshot,
          ...(next.value.nextCursor
            ? { nextCursor: next.value.nextCursor }
            : { nextCursor: undefined }),
          options: mergeOptions(
            snapshot.options,
            next.value.options,
            nextDescriptors,
          ),
          records: next.value.records,
        } as ProfileFactSection;
        snapshots.set(section, snapshot);
        renderRecords();
        updatePagination();
      };
      moreFacts.onclick = async () => {
        if (!snapshot.nextCursor) return;
        const cursor = snapshot.nextCursor;
        pageCursors[pageIndex + 1] = cursor;
        pageCursors.length = pageIndex + 2;
        await showPage(cursor, pageIndex + 1);
      };
      previousFacts.onclick = async () => {
        if (pageIndex === 0) return;
        await showPage(pageCursors[pageIndex - 1], pageIndex - 1);
      };
      pagination.append(previousFacts, moreFacts);
      updatePagination();
      target.list.insertAdjacentElement("afterend", pagination);
    }
    target.add.onclick = async () => {
      const submit = target.form.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      if (submit) submit.disabled = true;
      const ready = await prepareEditor();
      if (!ready) return;
      const currentSnapshot = snapshots.get(section) ?? snapshot;
      const singleton =
        ["first-meeting", "food-preferences", "tags"].includes(section)
          ? currentSnapshot.records[0]
          : undefined;
      fill(target.form, singleton);
      target.form.hidden = false;
      if (submit && ready) submit.disabled = false;
      target.form.querySelector<HTMLElement>("input, select, textarea")
        ?.focus();
      announceRailEditorOpened(target.form);
    };
    const cancel = target.form.querySelector<HTMLButtonElement>(
      '.form-actions button[type="button"]',
    );
    if (cancel) {
      cancel.onclick = () => {
        target.form.hidden = true;
        target.form.reset();
        target.add.focus();
        target.state.textContent = "Edit cancelled. No changes were saved.";
      };
    }
    target.form.onsubmit = async (event) => {
      event.preventDefault();
      const submit = target.form.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      const formState = target.form.querySelector<HTMLElement>(
        "[data-profile-fact-form-state]",
      );
      if (submit?.disabled) {
        if (formState) {
          formState.textContent =
            "Options are unavailable. No changes were saved.";
          formState.focus();
        }
        return;
      }
      const selectedTagIds = section === "tags" && tagSelection
        ? tagSelection()
        : undefined;
      const clientErrors = clientValidationErrors(
        section,
        target.form,
        selectedTagIds,
      );
      if (Object.keys(clientErrors).length) {
        if (formState) {
          formState.textContent =
            "Correct the highlighted profile details before saving.";
          formState.focus();
        }
        renderFieldErrors(target.form, clientErrors);
        return;
      }
      let input = formInput(section, target.form, personUpdatedAt);
      if (!input) {
        const field = section === "addresses"
          ? "displayName"
          : section === "first-meeting"
          ? "placeText"
          : "name";
        if (formState) {
          formState.textContent = "Enter the required profile details.";
          formState.focus();
        }
        renderFieldErrors(target.form, {
          [field]: section === "pets"
            ? "Enter a pet name or category."
            : `Enter ${section.replaceAll("-", " ")} details.`,
        });
        return;
      }
      if (section === "tags" && selectedTagIds) {
        input = { ...input, section: "tags", tagIds: selectedTagIds };
      }
      const saved = "id" in input
        ? await updateProfileFact(
          personId,
          section,
          input.id,
          input as ProfileFactUpdateInputBySection[typeof section],
          workspaceId,
        ).catch(() => undefined)
        : await createProfileFact(
          personId,
          section,
          input as ProfileFactCreateInputBySection[typeof section],
          workspaceId,
        ).catch(() => undefined);
      if (!saved || !saved.ok) {
        if (formState) {
          formState.textContent = saved && !saved.ok
            ? saved.problem.detail
            : "Save is temporarily unavailable.";
          formState.focus();
        }
        if (saved && !saved.ok) {
          renderFieldErrors(target.form, saved.problem.errors);
        }
        return;
      }
      renderFieldErrors(target.form);
      applyPersonRevision(saved.value.personUpdatedAt, true);
      target.form.hidden = true;
      if (section === "contact-methods") {
        await Promise.all([load(section), refreshPrimaryContactMethods()]);
      } else await load(section);
      target.state.textContent = "Profile fact saved.";
      target.state.focus();
    };
  };

  document.addEventListener("person-lifecycle-changed", (event) => {
    archived =
      (event as CustomEvent<{ readonly archived: boolean }>).detail.archived;
    for (const section of sections) void load(section);
  });
  document.addEventListener("person-revision-changed", (event) => {
    const candidate = (event as CustomEvent<{
      readonly personUpdatedAt: string;
    }>).detail.personUpdatedAt;
    const revision = applyPersonRevision(candidate);
    for (const section of ["tags", "food-preferences"] as const) {
      const snapshot = snapshots.get(section);
      if (!snapshot) continue;
      const records = snapshot.records.map((record) => ({
        ...record,
        updatedAt: revision,
      })) as readonly ProfileFactRecord[];
      snapshots.set(section, {
        ...snapshot,
        personUpdatedAt: revision,
        records,
      });
      const target = elements(section);
      if (target?.form.dataset.expectedUpdatedAt) {
        target.form.dataset.expectedUpdatedAt = revision;
      }
    }
  });
  await Promise.all(sections.map(load));
}
