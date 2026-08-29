import {
  type ApiResult,
  createPersonalizationEntry,
  deletePersonalizationEntry,
  listPersonalizationEntries,
  type PersonalizationEntry,
  type PersonalizationSection,
  updatePersonalizationEntry,
} from "../../../../packages/contracts/generated/auth-client.ts";
import {
  resolveWorkspaceSession,
  WORKSPACE_CHANGE_REQUEST_EVENT,
  type WorkspaceChangeRequestDetail,
} from "./workspace-context.ts";

export const PERSONALIZATION_SECTIONS: readonly {
  readonly id: PersonalizationSection;
  readonly label: string;
}[] = [
  { id: "profile-modules", label: "Profile modules" },
  { id: "gender-options", label: "Gender options" },
  { id: "contact-method-types", label: "Contact method types" },
  { id: "contact-labels", label: "Contact labels" },
  { id: "activity-types", label: "Activity types" },
  { id: "emotion-options", label: "Emotion options" },
  { id: "life-event-types", label: "Life event types" },
  { id: "relationship-types", label: "Relationship types" },
  { id: "pet-categories", label: "Pet categories" },
  { id: "reminder-rules", label: "Reminder rules" },
  { id: "tags", label: "Tags" },
];

let activeBeforeUnload: ((event: Event) => void) | undefined;
let activePopstate: ((event: PopStateEvent) => void) | undefined;
let activeWorkspaceChangeRequest: ((event: Event) => void) | undefined;

interface PersonalizationHistoryState {
  readonly index: number;
  readonly section: PersonalizationSection;
}

const MAX_PERSONALIZATION_HISTORY_INDEX = 10_000;

function acceptedSection(value: unknown): value is PersonalizationSection {
  return typeof value === "string" &&
    PERSONALIZATION_SECTIONS.some(({ id }) => id === value);
}

function personalizationHistoryState(
  value: unknown,
): PersonalizationHistoryState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as { readonly personalization?: unknown })
    .personalization;
  if (!candidate || typeof candidate !== "object") return undefined;
  const { index, section } = candidate as {
    readonly index?: unknown;
    readonly section?: unknown;
  };
  return Number.isSafeInteger(index) && Number(index) >= 0 &&
      Number(index) <= MAX_PERSONALIZATION_HISTORY_INDEX &&
      acceptedSection(section)
    ? { index: Number(index), section }
    : undefined;
}

function historyValue(
  index: number,
  section: PersonalizationSection,
): Record<string, unknown> {
  const existing = globalThis.history.state;
  return {
    ...(existing && typeof existing === "object" ? existing : {}),
    personalization: { index, section },
  };
}

export function resolvePersonalizationSection(
  search: string,
): PersonalizationSection {
  const requested = new URLSearchParams(search).get("section");
  return acceptedSection(requested) ? requested : "profile-modules";
}

function status(message: string, focus = false): void {
  const target = document.querySelector<HTMLElement>("#personalization-status");
  if (!target) return;
  target.textContent = message;
  if (focus) target.focus();
}

export async function mountPersonalization(): Promise<void> {
  const list = document.querySelector<HTMLUListElement>(
    "#personalization-list",
  );
  const heading = document.querySelector<HTMLElement>(
    "#personalization-heading",
  );
  const createForm = document.querySelector<HTMLFormElement>(
    "#personalization-create",
  );
  if (!list || !heading || !createForm) return;
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") {
    return status("Your session could not be confirmed.");
  }
  const workspaceId = session.session.workspace.id;
  let current = resolvePersonalizationSection(globalThis.location.search);
  const initialHistory = personalizationHistoryState(globalThis.history.state);
  let currentIndex = initialHistory?.section === current
    ? initialHistory.index
    : 0;
  globalThis.history.replaceState(
    historyValue(currentIndex, current),
    "",
    `?section=${current}`,
  );
  let entries: readonly PersonalizationEntry[] = [];
  let renderedSection: PersonalizationSection | undefined;
  let requestGeneration = 0;
  let baseline = "";
  let dirty = false;
  let hasAuthoritativeBaseline = false;
  let activeDirtyForm: HTMLFormElement | undefined;
  let dirtyFormCount = 0;
  const dirtyStatus = document.querySelector<HTMLElement>(
    "#personalization-dirty",
  );
  type FormValueControl =
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement;
  interface FormValueState {
    readonly checked?: boolean;
    readonly control: FormValueControl;
    readonly selected?: readonly boolean[];
    readonly value: string;
  }
  const formBaselines = new WeakMap<
    HTMLFormElement,
    { readonly snapshot: string; readonly states: readonly FormValueState[] }
  >();
  const forms = (): readonly HTMLFormElement[] => [
    createForm,
    ...list.querySelectorAll<HTMLFormElement>("form"),
  ];
  const formControls = (form: HTMLFormElement): readonly FormValueControl[] =>
    Array.from(form.elements).filter((control): control is FormValueControl =>
      (control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement ||
        control instanceof HTMLTextAreaElement) &&
      Boolean(control.name) &&
      !(control instanceof HTMLInputElement &&
        ["button", "reset", "submit"].includes(control.type))
    );
  const formSnapshot = (form: HTMLFormElement): string =>
    JSON.stringify(
      formControls(form).map((control) => ({
        checked: control instanceof HTMLInputElement &&
            ["checkbox", "radio"].includes(control.type)
          ? control.checked
          : undefined,
        name: control.name,
        selected: control instanceof HTMLSelectElement
          ? Array.from(control.options).map((option) => option.selected)
          : undefined,
        type: control instanceof HTMLInputElement
          ? control.type
          : control.tagName,
        value: control.value,
      })),
    );
  const captureForm = (form: HTMLFormElement): void => {
    formBaselines.set(form, {
      snapshot: formSnapshot(form),
      states: formControls(form).map((control) => ({
        ...(control instanceof HTMLInputElement &&
            ["checkbox", "radio"].includes(control.type)
          ? { checked: control.checked }
          : {}),
        control,
        ...(control instanceof HTMLSelectElement
          ? {
            selected: Array.from(control.options).map((option) =>
              option.selected
            ),
          }
          : {}),
        value: control.value,
      })),
    });
  };
  const restoreForm = (form: HTMLFormElement): void => {
    const saved = formBaselines.get(form);
    if (!saved) return;
    for (const state of saved.states) {
      state.control.value = state.value;
      if (
        state.checked !== undefined &&
        state.control instanceof HTMLInputElement
      ) state.control.checked = state.checked;
      if (
        state.selected && state.control instanceof HTMLSelectElement
      ) {
        Array.from(state.control.options).forEach((option, index) => {
          option.selected = state.selected?.[index] ?? false;
        });
      }
    }
  };
  const snapshot = (): string =>
    JSON.stringify(forms().map((form) => formSnapshot(form)));
  const showDirty = (message?: string): void => {
    if (!dirtyStatus) return;
    dirtyStatus.textContent = message ??
      (dirty ? "Unsaved changes." : "All changes saved.");
    dirtyStatus.dataset.state = dirty ? "dirty" : "saved";
  };
  const setDirtyBlocked = (
    control: FormValueControl | HTMLButtonElement,
    blocked: boolean,
  ): void => {
    if (blocked && control.dataset.dirtyBlocked === undefined) {
      control.dataset.dirtyBlocked = String(control.disabled);
      control.disabled = true;
      control.setAttribute("aria-describedby", "personalization-dirty");
      control.title =
        "Save or revert the active draft before using this action.";
    } else if (!blocked && control.dataset.dirtyBlocked !== undefined) {
      control.disabled = control.dataset.dirtyBlocked === "true";
      delete control.dataset.dirtyBlocked;
      control.removeAttribute("aria-describedby");
      control.removeAttribute("title");
    }
  };
  const updateMutationAvailability = (): void => {
    for (const form of forms()) {
      const active = form === activeDirtyForm;
      form.querySelectorAll<HTMLButtonElement>('button[type="submit"]')
        .forEach((button) =>
          setDirtyBlocked(button, dirty && (!active || dirtyFormCount > 1))
        );
      form.querySelectorAll<HTMLButtonElement>(
        'button[type="button"]:not([data-personalization-revert])',
      ).forEach((button) => setDirtyBlocked(button, dirty));
      const revert = form.querySelector<HTMLButtonElement>(
        "[data-personalization-revert]",
      );
      if (revert) revert.hidden = !(dirty && active);
    }
  };
  const focusActiveDraft = (): void => {
    activeDirtyForm?.querySelector<FormValueControl>(
      "input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
    )?.focus();
  };
  const guardPrimaryMutation = (form: HTMLFormElement): boolean => {
    if (!activeDirtyForm) return true;
    if (activeDirtyForm === form && dirtyFormCount === 1) return true;
    showDirty("Finish or revert the active draft first.");
    focusActiveDraft();
    return false;
  };
  const guardImplicitMutation = (): boolean => {
    if (!activeDirtyForm) return true;
    showDirty("Finish or revert the active draft first.");
    focusActiveDraft();
    return false;
  };
  const updateDirty = (): void => {
    if (!hasAuthoritativeBaseline) {
      dirty = false;
      dirtyFormCount = 0;
      activeDirtyForm = undefined;
      updateMutationAvailability();
      showDirty();
      return;
    }
    const wasDirty = dirty;
    const dirtyForms = forms().filter((form) =>
      formBaselines.get(form)?.snapshot !== formSnapshot(form)
    );
    dirtyFormCount = dirtyForms.length;
    dirty = dirtyForms.length > 0 || snapshot() !== baseline;
    if (!activeDirtyForm || !dirtyForms.includes(activeDirtyForm)) {
      activeDirtyForm = dirtyForms[0];
    }
    updateMutationAvailability();
    if (dirty || wasDirty) showDirty();
  };
  const markBaseline = (message?: string): void => {
    baseline = snapshot();
    forms().forEach(captureForm);
    hasAuthoritativeBaseline = true;
    dirty = false;
    dirtyFormCount = 0;
    activeDirtyForm = undefined;
    updateMutationAvailability();
    showDirty(message);
  };
  const attachRevert = (
    form: HTMLFormElement,
    button: HTMLButtonElement,
  ): void => {
    button.dataset.personalizationRevert = "true";
    button.hidden = true;
    button.type = "button";
    button.textContent = "Revert";
    button.addEventListener("click", () => {
      if (!hasAuthoritativeBaseline) return;
      const focusTarget = formControls(form).find((control) =>
        !control.disabled
      );
      restoreForm(form);
      updateDirty();
      showDirty("Changes reverted.");
      focusTarget?.focus();
    });
  };
  const createRevert = document.createElement("button");
  attachRevert(createForm, createRevert);
  createForm.append(createRevert);
  const navigationCleanMessage = (): string | false | undefined => {
    if (!dirty) return undefined;
    if (
      !globalThis.confirm(
        "You have unsaved personalization changes. Discard them and continue?",
      )
    ) return false;
    return "Changes discarded.";
  };
  type MutationControl =
    | HTMLButtonElement
    | HTMLInputElement
    | HTMLSelectElement;
  type MutationControlState = readonly [MutationControl, boolean];
  let activeLoadControls: readonly MutationControlState[] | undefined;
  const mutationControls = (): readonly MutationControl[] =>
    Array.from(document.querySelectorAll<MutationControl>(
      "#personalization-create input, #personalization-create select, #personalization-create button, #personalization-list input, #personalization-list select, #personalization-list button",
    ));
  const beginSectionLoad = (): readonly MutationControlState[] => {
    const controls = activeLoadControls ??
      mutationControls().map((control) => [control, control.disabled] as const);
    activeLoadControls = controls;
    list.setAttribute("aria-busy", "true");
    createForm.setAttribute("aria-busy", "true");
    mutationControls().forEach((control) => control.disabled = true);
    return controls;
  };
  const finishSectionLoad = (
    controls: readonly MutationControlState[],
    restore: boolean,
  ): void => {
    list.setAttribute("aria-busy", "false");
    createForm.setAttribute("aria-busy", "false");
    activeLoadControls = undefined;
    if (restore) {
      controls.forEach(([control, disabled]) => control.disabled = disabled);
    }
  };

  const render = async (
    section = current,
    focusHeading = false,
    cleanMessage?: string,
  ): Promise<boolean> => {
    const previousControls = beginSectionLoad();
    const generation = ++requestGeneration;
    const metadata = PERSONALIZATION_SECTIONS.find(({ id }) => id === section)!;
    status(`Loading ${metadata.label.toLowerCase()}…`);
    const result = await listPersonalizationEntries(section, workspaceId).catch(
      () => undefined,
    );
    if (generation !== requestGeneration) return false;
    if (!result?.ok) {
      const message = result?.problem.detail ??
        "This section could not be loaded.";
      if (renderedSection === undefined) {
        finishSectionLoad(previousControls, false);
        dirty = false;
        dirtyFormCount = 0;
        activeDirtyForm = undefined;
        updateMutationAvailability();
        showDirty();
        showInitialLoadFailure(message, section, focusHeading);
      } else {
        finishSectionLoad(previousControls, true);
        updateMutationAvailability();
        if (section === current && section !== renderedSection) {
          showInitialLoadFailure(
            message,
            section,
            focusHeading,
            cleanMessage,
          );
        } else status(message, focusHeading);
      }
      return false;
    }
    heading.textContent = metadata.label;
    document.querySelectorAll<HTMLAnchorElement>(
      "[data-personalization-section]",
    )
      .forEach((link) => {
        const active = link.dataset.personalizationSection === section;
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
    entries = result.value.entries;
    const canCreate = result.value.capabilities?.create ?? true;
    if (renderedSection !== section) createForm.reset();
    createForm.hidden = !canCreate;
    const createName = createForm.elements.namedItem(
      "name",
    ) as HTMLInputElement;
    const existingForward = createForm.querySelector(
      '[data-create-field="forward"]',
    );
    const existingReverse = createForm.querySelector(
      '[data-create-field="reverse"]',
    );
    const existingDays = createForm.querySelector('[data-create-field="days"]');
    existingForward?.remove();
    existingReverse?.remove();
    existingDays?.remove();
    const createNameContainer = createName.closest("label") ?? createName;
    const createNameHidden = section === "relationship-types" ||
      section === "reminder-rules";
    createNameContainer.hidden = createNameHidden;
    createName.required = !createNameHidden;
    createName.disabled = !canCreate || createNameHidden;
    const createButton = createForm.querySelector("button")!;
    createButton.disabled = !canCreate;
    createRevert.disabled = false;
    if (section === "relationship-types") {
      const field = (direction: "forward" | "reverse", labelText: string) => {
        const label = document.createElement("label");
        label.dataset.createField = direction;
        label.textContent = labelText;
        const input = document.createElement("input");
        input.name = `${direction}Label`;
        input.maxLength = 200;
        input.required = true;
        label.append(input);
        return label;
      };
      createForm.insertBefore(field("forward", "Forward label"), createButton);
      createForm.insertBefore(field("reverse", "Reverse label"), createButton);
    } else if (section === "reminder-rules") {
      const label = document.createElement("label");
      label.dataset.createField = "days";
      label.textContent = "Days before";
      const input = document.createElement("input");
      input.name = "daysBefore";
      input.type = "number";
      input.min = "0";
      input.max = "3650";
      input.required = true;
      label.append(input);
      createForm.insertBefore(label, createButton);
    }
    list.replaceChildren(...entries.map((item) => {
      const itemCapabilities = item.capabilities ?? {
        delete: item.canDelete,
        disable: true,
        editValue: false,
        rename: true,
        reorder: true,
        replace: item.canDelete,
        setDefault: current === "gender-options",
      };
      const itemKind = item.kind ?? "named";
      const itemReadOnly = item.readOnly ??
        !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(item.id);
      const row = document.createElement("li");
      row.className = "personalization-row";
      const form = document.createElement("form");
      form.className = "personalization-entry-form";
      const fields: HTMLElement[] = [];
      const inputField = (
        labelText: string,
        fieldName: string,
        value: string,
      ) => {
        const label = document.createElement("label");
        label.textContent = labelText;
        const input = document.createElement("input");
        input.name = fieldName;
        input.setAttribute("aria-label", `${labelText} for ${item.name}`);
        input.maxLength = 200;
        input.required = true;
        input.value = value;
        input.disabled = itemReadOnly;
        label.append(input);
        fields.push(label);
        return input;
      };
      let name: HTMLInputElement | undefined;
      let forwardLabel: HTMLInputElement | undefined;
      let reverseLabel: HTMLInputElement | undefined;
      let daysBefore: HTMLInputElement | undefined;
      if (itemKind === "relationship-type") {
        forwardLabel = inputField(
          "Forward label",
          "forwardLabel",
          item.forwardLabel ?? "",
        );
        reverseLabel = inputField(
          "Reverse label",
          "reverseLabel",
          item.reverseLabel ?? "",
        );
      } else if (itemKind === "reminder-rule") {
        daysBefore = inputField(
          "Days before",
          "daysBefore",
          String(item.daysBefore ?? 0),
        );
        daysBefore.type = "number";
        daysBefore.min = "0";
        daysBefore.max = "3650";
        daysBefore.disabled = itemReadOnly || !itemCapabilities.editValue;
      } else if (itemReadOnly) {
        const value = document.createElement("strong");
        value.textContent = item.name;
        fields.push(value);
      } else {
        name = inputField("Name", "name", item.name);
      }
      const orderLabel = document.createElement("label");
      orderLabel.textContent = "Order";
      const order = document.createElement("input");
      order.name = "sortOrder";
      order.setAttribute("aria-label", `Order for ${item.name}`);
      order.type = "number";
      order.min = "0";
      order.max = "10000";
      order.value = String(item.sortOrder);
      order.disabled = itemReadOnly || !itemCapabilities.reorder;
      orderLabel.append(order);
      if (itemCapabilities.reorder) fields.push(orderLabel);
      const detail = document.createElement("p");
      detail.textContent = `${item.referenceCount} reference${
        item.referenceCount === 1 ? "" : "s"
      } · ${item.isActive ? "Enabled" : "Disabled"}${
        item.isDefault ? " · Default" : ""
      }`;
      const actions = document.createElement("div");
      actions.className = "personalization-actions";
      if (!itemReadOnly) {
        const save = document.createElement("button");
        save.type = "submit";
        save.textContent = "Save";
        if (
          itemCapabilities.editValue || itemCapabilities.rename ||
          itemCapabilities.reorder
        ) {
          actions.append(save);
        }
        const revert = document.createElement("button");
        attachRevert(form, revert);
        actions.append(revert);
        if (itemCapabilities.disable) {
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.textContent = item.isActive ? "Disable" : "Enable";
          toggle.addEventListener("click", async () => {
            if (!guardImplicitMutation()) return;
            toggle.disabled = true;
            const changed = await updatePersonalizationEntry(current, item.id, {
              expectedUpdatedAt: item.updatedAt,
              isActive: !item.isActive,
            }, workspaceId).catch(() => undefined);
            if (changed?.ok) {
              toggle.disabled = false;
              if (await render()) status("Option updated.", true);
              else {
                markBaseline();
                showRefreshFailure();
              }
            } else {
              toggle.disabled = false;
              status(
                changed?.problem.detail ?? "Option could not be updated.",
                true,
              );
            }
          });
          actions.append(toggle);
        }
        if (!item.isDefault && itemCapabilities.setDefault) {
          const makeDefault = document.createElement("button");
          makeDefault.type = "button";
          makeDefault.textContent = "Set default";
          makeDefault.addEventListener("click", async () => {
            if (!guardImplicitMutation()) return;
            const changed = await updatePersonalizationEntry(current, item.id, {
              expectedUpdatedAt: item.updatedAt,
              isDefault: true,
            }, workspaceId).catch(() => undefined);
            if (changed?.ok) {
              if (await render()) status("Default updated.", true);
              else {
                markBaseline();
                showRefreshFailure();
              }
            } else {
              status(
                changed?.problem.detail ?? "Default could not be updated.",
                true,
              );
            }
          });
          actions.append(makeDefault);
        }
        if (itemCapabilities.delete) {
          const replacement = document.createElement("select");
          replacement.setAttribute(
            "aria-label",
            `Replacement for ${item.name}`,
          );
          const replacementOption = (
            label: string,
            value: string,
          ): HTMLOptionElement => {
            const option = document.createElement("option");
            option.textContent = label;
            option.value = value;
            return option;
          };
          replacement.append(
            replacementOption("Choose replacement", ""),
            ...entries.filter((candidate) => candidate.id !== item.id).map((
              candidate,
            ) => replacementOption(candidate.name, candidate.id)),
          );
          if (item.referenceCount > 0) actions.append(replacement);
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = item.referenceCount > 0
            ? "Replace and delete"
            : "Delete";
          remove.addEventListener("click", async () => {
            if (!guardImplicitMutation()) return;
            if (item.referenceCount > 0 && !replacement.value) {
              replacement.focus();
              return status(
                `${item.referenceCount} references require a replacement.`,
                true,
              );
            }
            const deleted = await deletePersonalizationEntry(
              current,
              item.id,
              item.updatedAt,
              replacement.value || undefined,
              workspaceId,
            ).catch(() => undefined);
            if (deleted?.ok) {
              if (await render()) {
                status(
                  "Option deleted; existing history was retained.",
                  true,
                );
              } else {
                markBaseline();
                showRefreshFailure();
              }
            } else {
              status(
                deleted?.problem.detail ?? "Option could not be deleted.",
                true,
              );
            }
          });
          actions.append(remove);
        }
      } else {
        const fixed = document.createElement("span");
        fixed.className = "state-badge calm";
        fixed.textContent = item.readOnly === true
          ? "Read-only shared option"
          : "Shared required option";
        actions.append(fixed);
      }
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!guardPrimaryMutation(form)) return;
        const changed = await updatePersonalizationEntry(current, item.id, {
          ...(daysBefore && itemCapabilities.editValue
            ? { daysBefore: Number(daysBefore.value) }
            : {}),
          expectedUpdatedAt: item.updatedAt,
          ...(forwardLabel ? { forwardLabel: forwardLabel.value.trim() } : {}),
          ...(name ? { name: name.value.trim() } : {}),
          ...(reverseLabel ? { reverseLabel: reverseLabel.value.trim() } : {}),
          ...(itemCapabilities.reorder
            ? { sortOrder: Number(order.value) }
            : {}),
        }, workspaceId).catch(() => undefined);
        if (changed?.ok) {
          if (await render()) status("Option saved.", true);
          else {
            markBaseline();
            showRefreshFailure();
          }
        } else {
          status(
            changed?.problem.detail ?? "Option could not be saved.",
            true,
          );
        }
      });
      form.append(...fields, detail, actions);
      row.append(form);
      return row;
    }));
    if (!entries.length) {
      status(
        canCreate
          ? "No options yet. Create the first option for this workspace."
          : "No shared options are available.",
      );
    } else status("");
    finishSectionLoad(previousControls, false);
    renderedSection = section;
    markBaseline(cleanMessage);
    if (focusHeading) heading.focus();
    return true;
  };

  const showRefreshFailure = (): void => {
    const target = document.querySelector<HTMLElement>(
      "#personalization-status",
    );
    if (!target) return;
    target.replaceChildren(
      document.createTextNode(
        "Change saved, but this section could not be refreshed. ",
      ),
    );
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.addEventListener("click", async () => {
      retry.disabled = true;
      if (await render()) status("Section refreshed.", true);
      else showRefreshFailure();
    });
    target.append(retry);
    target.focus();
  };

  const showInitialLoadFailure = (
    message: string,
    section: PersonalizationSection,
    focus: boolean,
    cleanMessage?: string,
  ): void => {
    const target = document.querySelector<HTMLElement>(
      "#personalization-status",
    );
    if (!target) return;
    target.replaceChildren(document.createTextNode(`${message} `));
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.addEventListener("click", async () => {
      retry.disabled = true;
      await render(section, focus, cleanMessage);
    });
    target.append(retry);
    if (focus) target.focus();
  };

  document.querySelectorAll<HTMLAnchorElement>("[data-personalization-section]")
    .forEach((link) =>
      link.addEventListener("click", async (event) => {
        event.preventDefault();
        const selected = link.dataset.personalizationSection;
        if (
          !selected ||
          !PERSONALIZATION_SECTIONS.some(({ id }) => id === selected)
        ) {
          // Section links are generated from this catalog; keep malformed DOM
          // state inert if one is introduced outside this module.
          return;
        }
        if (selected === current) {
          status("That personalization section is already open.");
          return;
        }
        const cleanMessage = navigationCleanMessage();
        if (cleanMessage === false) return;
        const target = selected as PersonalizationSection;
        const targetIndex = currentIndex + 1;
        current = target;
        currentIndex = targetIndex;
        globalThis.history.pushState(
          historyValue(currentIndex, current),
          "",
          `?section=${current}`,
        );
        await render(target, true, cleanMessage);
      })
    );
  if (activePopstate) {
    globalThis.removeEventListener("popstate", activePopstate);
  }
  let suppressedRestorationIndex: number | undefined;
  const restoreCurrentEntry = (): void => {
    globalThis.history.replaceState(
      historyValue(currentIndex, current),
      "",
      `?section=${current}`,
    );
  };
  const restorePoppedEntry = (target: PersonalizationHistoryState): void => {
    const delta = currentIndex - target.index;
    if (delta === 0 || Math.abs(delta) > MAX_PERSONALIZATION_HISTORY_INDEX) {
      restoreCurrentEntry();
      return;
    }
    suppressedRestorationIndex = currentIndex;
    globalThis.history.go(delta);
  };
  activePopstate = async (event) => {
    const target = personalizationHistoryState(event.state);
    if (suppressedRestorationIndex !== undefined) {
      const expected = suppressedRestorationIndex;
      suppressedRestorationIndex = undefined;
      if (
        target?.index === expected && target.section === current &&
        globalThis.location.search === `?section=${current}`
      ) return;
      restoreCurrentEntry();
      return;
    }
    if (
      !target ||
      (target.index === currentIndex && target.section !== current)
    ) {
      restoreCurrentEntry();
      return;
    }
    if (target.index === currentIndex && target.section === current) return;
    let cleanMessage: string | undefined;
    if (dirty) {
      if (
        !globalThis.confirm(
          "You have unsaved personalization changes. Discard them and continue?",
        )
      ) {
        restorePoppedEntry(target);
        return;
      }
      cleanMessage = "Changes discarded.";
    }
    if (!await render(target.section, true, cleanMessage)) {
      restorePoppedEntry(target);
      return;
    }
    current = target.section;
    currentIndex = target.index;
  };
  globalThis.addEventListener("popstate", activePopstate);
  const dirtyListener = (): void => updateDirty();
  createForm.addEventListener("input", dirtyListener);
  createForm.addEventListener("change", dirtyListener);
  list.addEventListener("input", dirtyListener);
  list.addEventListener("change", dirtyListener);
  if (activeBeforeUnload) {
    globalThis.removeEventListener("beforeunload", activeBeforeUnload);
  }
  activeBeforeUnload = (event: Event): void => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = true;
  };
  globalThis.addEventListener("beforeunload", activeBeforeUnload);
  if (activeWorkspaceChangeRequest) {
    globalThis.removeEventListener(
      WORKSPACE_CHANGE_REQUEST_EVENT,
      activeWorkspaceChangeRequest,
    );
  }
  activeWorkspaceChangeRequest = (event: Event): void => {
    if (!dirty) return;
    const request = event as CustomEvent<WorkspaceChangeRequestDetail>;
    if (
      !globalThis.confirm(
        "You have unsaved personalization changes. Discard them and switch workspaces?",
      )
    ) {
      event.preventDefault();
      return;
    }
    request.detail.onProceed(() => {
      markBaseline("Changes discarded for workspace switch.");
    });
  };
  globalThis.addEventListener(
    WORKSPACE_CHANGE_REQUEST_EVENT,
    activeWorkspaceChangeRequest,
  );
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!guardPrimaryMutation(createForm)) return;
    const name = createForm.elements.namedItem("name") as HTMLInputElement;
    const daysBefore = createForm.elements.namedItem("daysBefore") as
      | HTMLInputElement
      | null;
    const forwardLabel = createForm.elements.namedItem("forwardLabel") as
      | HTMLInputElement
      | null;
    const reverseLabel = createForm.elements.namedItem("reverseLabel") as
      | HTMLInputElement
      | null;
    const section = current;
    const generation = ++requestGeneration;
    let created:
      | ApiResult<{
        readonly entry: PersonalizationEntry;
        readonly status: "saved";
      }>
      | undefined;
    if (section === "reminder-rules" && daysBefore) {
      created = await createPersonalizationEntry(section, {
        daysBefore: Number(daysBefore.value),
      }, workspaceId).catch(() => undefined);
    } else if (
      section === "relationship-types" && forwardLabel && reverseLabel
    ) {
      created = await createPersonalizationEntry(section, {
        forwardLabel: forwardLabel.value.trim(),
        reverseLabel: reverseLabel.value.trim(),
        sortOrder: entries.length,
      }, workspaceId).catch(() => undefined);
    } else if (section === "contact-labels" || section === "tags") {
      created = await createPersonalizationEntry(section, {
        name: name.value.trim(),
      }, workspaceId).catch(() => undefined);
    } else if (
      section !== "emotion-options" && section !== "pet-categories"
    ) {
      created = await createPersonalizationEntry(section, {
        name: name.value.trim(),
        sortOrder: entries.length,
      }, workspaceId).catch(() => undefined);
    }
    if (generation !== requestGeneration || section !== current) return;
    if (created?.ok) {
      if (await render()) {
        createForm.reset();
        markBaseline();
        status("Option created.", true);
      } else {
        markBaseline();
        showRefreshFailure();
      }
    } else {
      status(
        created?.problem.detail ?? "Option could not be created.",
        true,
      );
    }
  });
  await render();
}
