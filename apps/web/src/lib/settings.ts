import { formatInstant, loadTimePreferences } from "./time-presentation.ts";
import {
  deletePersonalIdentity,
  getMemberPreferences,
  getPersonalLifecyclePreview,
  getSettingsProfile,
  getWorkspaceSettings,
  leaveCurrentWorkspace,
  listMemberSessions,
  revokeMemberSession,
  updateMemberPreferences,
  updateSettingsProfile,
  updateWorkspaceSettings,
} from "../../../../packages/contracts/generated/auth-client.ts";
import {
  clearActiveWorkspace,
  resolveWorkspaceSession,
  setActiveWorkspace,
  WORKSPACE_CHANGE_REQUEST_EVENT,
  type WorkspaceChangeRequestDetail,
} from "./workspace-context.ts";

let activeBeforeUnload: ((event: Event) => void) | undefined;
let activeWorkspaceChangeRequest: ((event: Event) => void) | undefined;

async function selectedWorkspace(): Promise<string | undefined> {
  const resolved = await resolveWorkspaceSession();
  return resolved.status === "ready"
    ? resolved.session.workspace.id
    : undefined;
}

function lifecycleStatus(message: string): void {
  const target = document.querySelector<HTMLElement>("#lifecycle-status");
  if (target) target.textContent = message;
}

export async function mountPersonalLifecycle(
  selectedWorkspaceId?: string,
  navigate: (path: string) => void = (path) => globalThis.location.assign(path),
): Promise<void> {
  const region = document.querySelector<HTMLElement>("#account-lifecycle");
  const leaveForm = document.querySelector<HTMLFormElement>(
    "#leave-workspace-form",
  );
  const deleteForm = document.querySelector<HTMLFormElement>(
    "#delete-identity-form",
  );
  if (!region || !leaveForm || !deleteForm) return;
  const workspaceId = selectedWorkspaceId ?? await selectedWorkspace();
  if (!workspaceId) {
    return lifecycleStatus("Your session could not be confirmed.");
  }
  const loaded = await getPersonalLifecyclePreview(workspaceId).catch(() =>
    undefined
  );
  if (!loaded?.ok) {
    return lifecycleStatus(
      loaded?.problem.detail ?? "Current account impact could not be loaded.",
    );
  }
  const preview = loaded.value;
  document.querySelector<HTMLElement>("#lifecycle-loading")!.hidden = true;
  document.querySelector<HTMLElement>("#lifecycle-counts")!.hidden = false;
  document.querySelector<HTMLElement>("#lifecycle-membership-count")!
    .textContent = String(preview.memberships.length);
  document.querySelector<HTMLElement>("#lifecycle-session-count")!
    .textContent = String(preview.activeSessionCount);
  document.querySelector<HTMLElement>("#leave-confirmation-value")!
    .textContent = preview.confirmations.leaveWorkspace;
  document.querySelector<HTMLElement>("#delete-confirmation-value")!
    .textContent = preview.confirmations.deleteIdentity;
  const membershipList = document.querySelector<HTMLUListElement>(
    "#lifecycle-memberships",
  )!;
  membershipList.replaceChildren(...preview.memberships.map((membership) => {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = membership.workspace.name;
    const detail = document.createElement("span");
    detail.textContent = membership.finalOwner
      ? `${membership.role} · final active owner`
      : membership.status === "suspended"
      ? `${membership.role} · suspended`
      : membership.role;
    item.append(name, detail);
    return item;
  }));
  const blockers = document.querySelector<HTMLElement>("#lifecycle-blockers")!;
  const current = preview.memberships.find((membership) =>
    membership.workspace.id === workspaceId
  );
  const currentBlocked = current?.finalOwner === true;
  const deleteBlocked = preview.blockingWorkspaces.length > 0;
  if (deleteBlocked) {
    const names = preview.blockingWorkspaces.map((workspace) => workspace.name)
      .join(", ");
    blockers.hidden = false;
    blockers.textContent =
      `You are the final active owner of ${names}. Transfer ownership in Members before leaving an owned workspace or deleting your identity. Workspace deletion is a separate owner action.`;
  }
  const leaveButton = leaveForm.querySelector<HTMLButtonElement>("button")!;
  const deleteButton = deleteForm.querySelector<HTMLButtonElement>("button")!;
  leaveButton.disabled = currentBlocked;
  deleteButton.disabled = deleteBlocked;
  leaveForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    leaveButton.disabled = true;
    lifecycleStatus("Revalidating membership impact…");
    const result = await leaveCurrentWorkspace({
      confirmation: input(leaveForm, "confirmation").value,
      password: input(leaveForm, "password").value,
    }, workspaceId).catch(() => undefined);
    if (!result?.ok) {
      lifecycleStatus(
        result?.problem.detail ?? "The workspace could not be left.",
      );
      leaveButton.disabled = currentBlocked;
      return;
    }
    if (result.value.nextWorkspaceId) {
      setActiveWorkspace(result.value.nextWorkspaceId);
    } else {
      clearActiveWorkspace();
    }
    navigate(result.value.next);
  });
  deleteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    deleteButton.disabled = true;
    lifecycleStatus("Reauthenticating and revalidating every membership…");
    const result = await deletePersonalIdentity({
      confirmation: input(deleteForm, "confirmation").value,
      password: input(deleteForm, "password").value,
    }, workspaceId).catch(() => undefined);
    if (!result?.ok) {
      lifecycleStatus(
        result?.problem.detail ?? "Your personal identity was not deleted.",
      );
      deleteButton.disabled = deleteBlocked;
      return;
    }
    clearActiveWorkspace();
    navigate(result.value.next);
  });
}

function status(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>("#settings-status") ?? undefined;
}

function input(form: HTMLFormElement, name: string): HTMLInputElement {
  return form.elements.namedItem(name) as HTMLInputElement;
}

function select(form: HTMLFormElement, name: string): HTMLSelectElement {
  return form.elements.namedItem(name) as HTMLSelectElement;
}

function setUnavailable(message: string): void {
  const target = status();
  if (target) target.textContent = message;
}

function settingsFormControls(
  form: HTMLFormElement,
): (HTMLButtonElement | HTMLInputElement | HTMLSelectElement)[] {
  return Array.from(form.elements).filter((control) =>
    control instanceof HTMLButtonElement ||
    control instanceof HTMLInputElement ||
    control instanceof HTMLSelectElement
  );
}

function beginSettingsFormLoading(
  form: HTMLFormElement,
  message: string,
): void {
  for (const control of settingsFormControls(form)) control.disabled = true;
  setUnavailable(message);
}

function prepareLoadedSettingsForm(
  form: HTMLFormElement,
): ReturnType<typeof prepareSettingsForm> {
  for (const control of settingsFormControls(form)) {
    if (!(control instanceof HTMLButtonElement)) control.disabled = false;
  }
  return prepareSettingsForm(form);
}

function markSettingsFormReady(form: HTMLFormElement): void {
  for (const control of settingsFormControls(form)) {
    if (control instanceof HTMLButtonElement) control.disabled = false;
  }
  setUnavailable("");
}

function formSnapshot(form: HTMLFormElement): string {
  return JSON.stringify(Array.from(new FormData(form).entries()));
}

function prepareSettingsForm(form: HTMLFormElement): {
  markSaved(): void;
  showErrors(errors: Readonly<Record<string, string>>): boolean;
  validate(): boolean;
} {
  const dirtyStatus = document.querySelector<HTMLElement>("#settings-dirty");
  const errorSummary = document.querySelector<HTMLElement>("#settings-errors");
  let baseline = formSnapshot(form);
  let dirty = false;
  const firstInvalid = (): HTMLElement | undefined =>
    Array.from(form.elements).find((control) =>
      control instanceof HTMLElement &&
      "validity" in control &&
      !(control as HTMLInputElement).validity.valid
    ) as HTMLElement | undefined;
  const showValidation = (): void => {
    if (errorSummary) {
      errorSummary.hidden = false;
      errorSummary.textContent = "Review the highlighted fields and try again.";
    }
    firstInvalid()?.focus();
  };
  const updateDirty = (): void => {
    dirty = formSnapshot(form) !== baseline;
    form.dataset.dirty = String(dirty);
    if (dirtyStatus) {
      dirtyStatus.textContent = dirty
        ? "Unsaved changes."
        : "All changes saved.";
      dirtyStatus.dataset.state = dirty ? "dirty" : "saved";
    }
  };
  form.addEventListener("input", updateDirty);
  form.addEventListener("change", updateDirty);
  form.addEventListener("invalid", (event) => {
    (event.target as HTMLElement).setAttribute("aria-invalid", "true");
    queueMicrotask(showValidation);
  }, true);
  form.addEventListener("input", (event) => {
    const control = event.target as HTMLInputElement;
    control.setCustomValidity?.("");
    const fieldError = form.querySelector<HTMLElement>(
      `[data-field-error="${control.name}"]`,
    );
    if (fieldError) fieldError.textContent = "";
    if (control.validity?.valid) control.removeAttribute("aria-invalid");
  });
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
    const discard = globalThis.confirm(
      "You have unsaved changes in this workspace. Discard them and switch workspaces?",
    );
    if (!discard) {
      event.preventDefault();
      return;
    }
    request.detail.onProceed(() => {
      baseline = formSnapshot(form);
      updateDirty();
      if (dirtyStatus) dirtyStatus.textContent = "Unsaved changes discarded.";
    });
  };
  globalThis.addEventListener(
    WORKSPACE_CHANGE_REQUEST_EVENT,
    activeWorkspaceChangeRequest,
  );
  updateDirty();
  return {
    markSaved() {
      baseline = formSnapshot(form);
      updateDirty();
      if (errorSummary) errorSummary.hidden = true;
    },
    showErrors(errors) {
      let applied = false;
      for (const [name, message] of Object.entries(errors)) {
        const control = form.elements.namedItem(name);
        if (!(control instanceof HTMLInputElement)) continue;
        control.setCustomValidity(message);
        control.setAttribute("aria-invalid", "true");
        const fieldError = form.querySelector<HTMLElement>(
          `[data-field-error="${name}"]`,
        );
        if (fieldError) fieldError.textContent = message;
        applied = true;
      }
      if (applied) showValidation();
      return applied;
    },
    validate() {
      if (form.checkValidity()) return true;
      showValidation();
      return false;
    },
  };
}

export async function mountProfileSettings(): Promise<void> {
  const form = document.querySelector<HTMLFormElement>("#profile-form");
  if (!form) return;
  beginSettingsFormLoading(form, "Loading your profile…");
  const workspaceId = await selectedWorkspace();
  if (!workspaceId) {
    return setUnavailable("Your session could not be confirmed.");
  }
  const loaded = await getSettingsProfile(workspaceId).catch(() => undefined);
  if (!loaded?.ok) return setUnavailable("Your profile could not be loaded.");
  input(form, "email").value = loaded.value.profile.email;
  input(form, "firstName").value = loaded.value.profile.firstName;
  input(form, "lastName").value = loaded.value.profile.lastName;
  const guard = prepareLoadedSettingsForm(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!guard.validate()) return;
    setUnavailable("Saving profile…");
    const result = await updateSettingsProfile({
      firstName: input(form, "firstName").value.trim(),
      lastName: input(form, "lastName").value.trim(),
    }, workspaceId).catch(() => undefined);
    if (result?.ok) guard.markSaved();
    setUnavailable(
      result?.ok
        ? "Profile saved."
        : result?.problem.detail ?? "Profile could not be saved.",
    );
  });
  markSettingsFormReady(form);
}

export async function mountPreferenceSettings(): Promise<void> {
  const form = document.querySelector<HTMLFormElement>("#preferences-form");
  if (!form) return;
  beginSettingsFormLoading(form, "Loading your preferences…");
  const workspaceId = await selectedWorkspace();
  if (!workspaceId) {
    return setUnavailable("Your session could not be confirmed.");
  }
  const loaded = await getMemberPreferences(workspaceId).catch(() => undefined);
  if (!loaded?.ok) {
    return setUnavailable("Your preferences could not be loaded.");
  }
  const value = loaded.value.preferences;
  input(form, "locale").value = value.locale;
  input(form, "timezone").value = value.timezone ?? "";
  input(form, "currencyCode").value = value.currencyCode ?? "";
  input(form, "fluidLayout").checked = value.fluidLayout;
  select(form, "temperatureScale").value = value.temperatureScale;
  select(form, "measurementSystem").value = value.measurementSystem;
  select(form, "contactSortOrder").value = value.contactSortOrder;
  select(form, "contactNameOrder").value = value.contactNameOrder;
  const guard = prepareLoadedSettingsForm(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!guard.validate()) return;
    setUnavailable("Saving preferences…");
    const timezone = input(form, "timezone").value.trim();
    const currencyCode = input(form, "currencyCode").value.trim().toUpperCase();
    const result = await updateMemberPreferences({
      contactNameOrder: select(form, "contactNameOrder")
        .value as typeof value.contactNameOrder,
      contactSortOrder: select(form, "contactSortOrder")
        .value as typeof value.contactSortOrder,
      ...(currencyCode ? { currencyCode } : {}),
      fluidLayout: input(form, "fluidLayout").checked,
      locale: input(form, "locale").value.trim(),
      measurementSystem: select(form, "measurementSystem")
        .value as typeof value.measurementSystem,
      temperatureScale: select(form, "temperatureScale")
        .value as typeof value.temperatureScale,
      ...(timezone ? { timezone } : {}),
    }, workspaceId).catch(() => undefined);
    if (
      !result?.ok && result?.problem.status === 400 &&
      guard.showErrors(result.problem.errors ?? {})
    ) {
      return setUnavailable(result.problem.detail);
    }
    if (result?.ok) guard.markSaved();
    setUnavailable(
      result?.ok
        ? "Preferences saved."
        : result?.problem.detail ?? "Preferences could not be saved.",
    );
  });
  markSettingsFormReady(form);
}

export async function mountSecuritySettings(): Promise<void> {
  const list = document.querySelector<HTMLUListElement>("#session-list");
  const count = document.querySelector<HTMLElement>("#session-count");
  if (!list || !count) return;
  const workspaceId = await selectedWorkspace();
  if (!workspaceId) {
    return setUnavailable("Your session could not be confirmed.");
  }
  const timePreferences = await loadTimePreferences(workspaceId);
  const render = async (): Promise<void> => {
    const loaded = await listMemberSessions(workspaceId).catch(() => undefined);
    if (!loaded?.ok) {
      return setUnavailable("Your sessions could not be loaded.");
    }
    count.textContent = `${loaded.value.sessions.length} active`;
    list.replaceChildren(...loaded.value.sessions.map((session) => {
      const row = document.createElement("li");
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = session.current
        ? "This session"
        : session.userAgent ?? "Browser session";
      const detail = document.createElement("small");
      detail.textContent = `Last active ${
        formatInstant(session.lastSeenAt, timePreferences)
      }${session.ipAddress ? ` · ${session.ipAddress}` : ""}`;
      copy.append(title, detail);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = session.current ? "Revoke and sign out" : "Revoke";
      button.addEventListener("click", async () => {
        button.disabled = true;
        const result = await revokeMemberSession(session.id, workspaceId).catch(
          () => undefined,
        );
        if (!result?.ok) {
          setUnavailable(
            result?.problem.detail ?? "Session could not be revoked.",
          );
          button.disabled = false;
          return;
        }
        if (result.value.current) {
          globalThis.location.assign("/auth/sign-in");
          return;
        }
        setUnavailable("Session revoked.");
        await render();
      });
      row.append(copy, button);
      return row;
    }));
    setUnavailable(loaded.value.sessions.length ? "" : "No active sessions.");
  };
  await render();
}

export async function mountWorkspaceSettings(): Promise<void> {
  const form = document.querySelector<HTMLFormElement>("#workspace-form");
  if (!form) return;
  beginSettingsFormLoading(form, "Loading workspace settings…");
  const workspaceId = await selectedWorkspace();
  if (!workspaceId) {
    return setUnavailable("Your session could not be confirmed.");
  }
  const loaded = await getWorkspaceSettings(workspaceId).catch(() => undefined);
  if (!loaded?.ok) {
    return setUnavailable(
      loaded?.problem.detail ?? "Workspace settings could not be loaded.",
    );
  }
  const value = loaded.value.workspace;
  for (
    const [name, current] of Object.entries({
      name: value.name,
      slug: value.slug ?? "",
      defaultLocale: value.defaultLocale,
      defaultTimezone: value.defaultTimezone ?? "",
      defaultCurrencyCode: value.defaultCurrencyCode ?? "",
      defaultReminderTime: value.defaultReminderTime,
    })
  ) input(form, name).value = current;
  const guard = prepareLoadedSettingsForm(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!guard.validate()) return;
    const slug = input(form, "slug").value.trim();
    const defaultTimezone = input(form, "defaultTimezone").value.trim();
    const defaultCurrencyCode = input(form, "defaultCurrencyCode").value.trim()
      .toUpperCase();
    setUnavailable("Saving workspace settings…");
    const result = await updateWorkspaceSettings({
      name: input(form, "name").value.trim(),
      ...(slug ? { slug } : {}),
      defaultLocale: input(form, "defaultLocale").value.trim(),
      ...(defaultTimezone ? { defaultTimezone } : {}),
      ...(defaultCurrencyCode ? { defaultCurrencyCode } : {}),
      defaultReminderTime: input(form, "defaultReminderTime").value,
    }, workspaceId).catch(() => undefined);
    if (
      !result?.ok && result?.problem.status === 400 &&
      guard.showErrors(result.problem.errors ?? {})
    ) {
      return setUnavailable(result.problem.detail);
    }
    if (result?.ok) guard.markSaved();
    setUnavailable(
      result?.ok
        ? "Workspace settings saved."
        : result?.problem.detail ?? "Workspace settings could not be saved.",
    );
  });
  markSettingsFormReady(form);
}
