import {
  deleteWorkspace,
  getWorkspaceLifecyclePreview,
  resetWorkspace,
} from "../../../../packages/contracts/generated/auth-client.ts";
import {
  ACTIVE_WORKSPACE_KEY,
  resolveWorkspaceSession,
} from "./workspace-context.ts";

function input(form: HTMLFormElement, name: string): HTMLInputElement {
  return form.elements.namedItem(name) as HTMLInputElement;
}

export async function mountWorkspaceDanger(
  navigate: (path: string) => void = (path) => globalThis.location.assign(path),
): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-workspace-danger]");
  const status = document.querySelector<HTMLElement>("[data-danger-status]");
  const resetForm = document.querySelector<HTMLFormElement>(
    "[data-danger-reset]",
  );
  const deleteForm = document.querySelector<HTMLFormElement>(
    "[data-danger-delete]",
  );
  if (!root || !status || !resetForm || !deleteForm) return;
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready" || session.session.member.role !== "owner") {
    status.textContent = "An active owner session could not be confirmed.";
    resetForm.hidden = true;
    deleteForm.hidden = true;
    return;
  }
  const workspaceId = session.session.workspace.id;
  const loaded = await getWorkspaceLifecyclePreview(workspaceId).catch(() =>
    undefined
  );
  if (!loaded?.ok) {
    status.textContent = loaded?.problem.detail ??
      "Current workspace impact could not be loaded.";
    resetForm.hidden = true;
    deleteForm.hidden = true;
    return;
  }
  const preview = loaded.value;
  status.textContent = "Current impact loaded. Review it before confirming.";
  document.querySelector<HTMLElement>("[data-danger-sessions]")!.textContent =
    String(preview.activeSessionCount);
  document.querySelector<HTMLElement>("[data-reset-confirmation]")!
    .textContent = preview.confirmations.resetWorkspace;
  document.querySelector<HTMLElement>("[data-delete-confirmation]")!
    .textContent = preview.confirmations.deleteWorkspace;
  const counts = document.querySelector<HTMLElement>("[data-danger-counts]")!;
  counts.hidden = false;
  counts.replaceChildren(
    ...Object.entries(preview.counts).map(([name, value]) => {
      const row = document.createElement("div");
      const label = document.createElement("dt");
      const count = document.createElement("dd");
      label.textContent = name.replace(/([A-Z])/g, " $1").toLowerCase();
      count.textContent = String(value);
      row.append(label, count);
      return row;
    }),
  );

  const submit =
    (action: "delete" | "reset", form: HTMLFormElement) =>
    async (event: SubmitEvent) => {
      event.preventDefault();
      const button = form.querySelector<HTMLButtonElement>("button")!;
      button.disabled = true;
      status.textContent = "Reauthenticating and revalidating current impact…";
      const command = {
        confirmation: input(form, "confirmation").value,
        impactToken: preview.impactToken,
        password: input(form, "password").value,
      };
      const result =
        await (action === "reset"
          ? resetWorkspace(command, workspaceId)
          : deleteWorkspace(command, workspaceId)).catch(() => undefined);
      if (!result?.ok) {
        status.textContent = result?.problem.detail ??
          "The workspace was not changed.";
        button.disabled = false;
        return;
      }
      sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
      navigate(result.value.next);
    };
  resetForm.addEventListener("submit", submit("reset", resetForm));
  deleteForm.addEventListener("submit", submit("delete", deleteForm));
}
