import {
  createWorkspaceInvitation,
  getWorkspaceMembers,
  listManagedMembers,
  updateManagedMember,
  type WorkspaceMembers,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";

interface MemberElements {
  readonly form: HTMLFormElement;
  readonly formStatus: HTMLElement;
  readonly invitationCount: HTMLElement;
  readonly memberCount: HTMLElement;
  readonly memberList: HTMLUListElement;
  readonly managedList?: HTMLUListElement;
  readonly managedState?: HTMLElement;
  readonly membersState: HTMLElement;
  readonly pendingList: HTMLUListElement;
  readonly pendingState: HTMLElement;
  readonly submit: HTMLButtonElement;
}

function elements(): MemberElements | undefined {
  const form = document.querySelector<HTMLFormElement>("#invitation-form");
  const formStatus = document.querySelector<HTMLElement>("#invitation-status");
  const invitationCount = document.querySelector<HTMLElement>(
    "#invitation-count",
  );
  const memberCount = document.querySelector<HTMLElement>("#member-count");
  const memberList = document.querySelector<HTMLUListElement>("#member-list");
  const managedList = document.querySelector<HTMLUListElement>("#managed-list");
  const managedState = document.querySelector<HTMLElement>("#managed-state");
  const membersState = document.querySelector<HTMLElement>("#members-state");
  const pendingList = document.querySelector<HTMLUListElement>("#pending-list");
  const pendingState = document.querySelector<HTMLElement>("#pending-state");
  const submit = form?.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  return form && formStatus && invitationCount && memberCount && memberList &&
      membersState && pendingList && pendingState && submit
    ? {
      form,
      formStatus,
      invitationCount,
      memberCount,
      memberList,
      ...(managedList && managedState ? { managedList, managedState } : {}),
      membersState,
      pendingList,
      pendingState,
      submit,
    }
    : undefined;
}

async function renderManagement(
  ui: MemberElements,
  workspaceId: string,
): Promise<void> {
  if (!ui.managedList || !ui.managedState) return;
  const managedList = ui.managedList;
  const managedState = ui.managedState;
  const result = await listManagedMembers(workspaceId).catch(() => undefined);
  if (!result?.ok) {
    managedState.textContent = result?.problem.detail ??
      "Member administration is unavailable.";
    return;
  }
  managedList.replaceChildren(...result.value.members.map((member) => {
    const row = document.createElement("li");
    const copy = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = member.name || member.email;
    copy.append(strong);
    const controls = document.createElement("span");
    controls.className = "member-controls";
    const role = document.createElement("select");
    role.setAttribute("aria-label", `Access level for ${member.email}`);
    for (const value of ["owner", "admin", "member"] as const) {
      const option = document.createElement("option");
      option.textContent = value[0]!.toUpperCase() + value.slice(1);
      option.value = value;
      role.add(option);
    }
    role.value = member.role;
    const active = document.createElement("select");
    active.setAttribute("aria-label", `Status for ${member.email}`);
    for (const value of ["active", "suspended"] as const) {
      const option = document.createElement("option");
      option.textContent = value[0]!.toUpperCase() + value.slice(1);
      option.value = value;
      active.add(option);
    }
    active.value = member.status;
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      save.disabled = true;
      const updated = await updateManagedMember(member.id, {
        role: role.value as "admin" | "member" | "owner",
        status: active.value as "active" | "suspended",
      }, workspaceId).catch(() => undefined);
      save.disabled = false;
      const message = updated?.ok
        ? `${member.email} updated.`
        : updated?.problem.detail ?? "Member could not be updated.";
      if (updated?.ok) await renderManagement(ui, workspaceId);
      managedState.hidden = false;
      managedState.textContent = message;
    });
    controls.append(role, active, save);
    row.append(copy, controls);
    return row;
  }));
  managedList.hidden = result.value.members.length === 0;
  managedState.hidden = result.value.members.length > 0;
  if (result.value.members.length === 0) {
    managedState.textContent = "No manageable members.";
  }
}

function listRow(
  primary: string,
  secondary: string,
  badge: string,
): HTMLLIElement {
  const row = document.createElement("li");
  const copy = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = primary;
  const detail = document.createElement("small");
  detail.textContent = secondary;
  copy.append(strong, detail);
  const role = document.createElement("span");
  role.className = "role-badge";
  role.textContent = badge;
  row.append(copy, role);
  return row;
}

function renderLists(ui: MemberElements, value: WorkspaceMembers): void {
  ui.memberList.replaceChildren(
    ...value.members.map((member) =>
      listRow(member.name || member.email, member.email, member.role)
    ),
  );
  ui.memberList.hidden = value.members.length === 0;
  ui.membersState.hidden = value.members.length > 0;
  ui.membersState.textContent = "No active members are available.";
  ui.memberCount.textContent = `${value.members.length} active`;
  ui.pendingList.replaceChildren(
    ...value.invitations.map((invitation) =>
      listRow(
        invitation.email,
        `Expires ${
          new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
            new Date(invitation.expiresAt),
          )
        }`,
        invitation.role,
      )
    ),
  );
  ui.pendingList.hidden = value.invitations.length === 0;
  ui.pendingState.hidden = value.invitations.length > 0;
  ui.pendingState.textContent = "No pending invitations.";
  ui.invitationCount.textContent = `${value.invitations.length} pending`;
}

export async function mountMembersPage(): Promise<void> {
  const ui = elements();
  if (!ui) return;
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") {
    ui.form.hidden = true;
    ui.membersState.textContent = "Your session could not be confirmed.";
    ui.pendingState.textContent = "Pending invitations are unavailable.";
    return;
  }
  const workspaceId = session.session.workspace.id;
  const load = async (): Promise<void> => {
    const result = await getWorkspaceMembers(workspaceId).catch(() =>
      undefined
    );
    if (!result?.ok) {
      const forbidden = result?.problem.status === 403;
      ui.form.hidden = forbidden;
      ui.membersState.textContent = forbidden
        ? "Only workspace owners and admins can view members."
        : "Members could not be loaded. Try again.";
      ui.pendingState.textContent = forbidden
        ? "Pending invitations are restricted."
        : "Pending invitations could not be loaded.";
      ui.memberCount.textContent = "Unavailable";
      ui.invitationCount.textContent = "Unavailable";
      return;
    }
    renderLists(ui, result.value);
    await renderManagement(ui, workspaceId);
  };
  await load();
  ui.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(ui.form);
    const role = String(data.get("role")) === "admin" ? "admin" : "member";
    ui.submit.disabled = true;
    ui.formStatus.textContent = "Creating and delivering the invitation…";
    const result = await createWorkspaceInvitation({
      email: String(data.get("email") ?? "").trim().toLowerCase(),
      role,
    }, workspaceId).catch(() => undefined);
    ui.submit.disabled = false;
    if (result?.ok) {
      ui.form.reset();
      ui.formStatus.textContent =
        "Invitation sent. The link can be used once within seven days.";
      await load();
      return;
    }
    ui.formStatus.textContent = result?.problem.code === "already_member"
      ? "That person is already an active member."
      : result?.problem.code === "invitation_forbidden"
      ? "Only a workspace owner or admin can send invitations."
      : result?.problem.detail ??
        "The invitation could not be sent. Try again.";
  });
}
