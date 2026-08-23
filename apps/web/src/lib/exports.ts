import {
  createExportDownload,
  createWorkspaceExport,
  type ExportSummary,
  listExports,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";

function element<T extends Element>(selector: string): T | undefined {
  return document.querySelector<T>(selector) ?? undefined;
}

function renderHistory(
  exports: readonly ExportSummary[],
  workspaceId: string,
  announce: (message: string) => void,
): void {
  const history = element<HTMLOListElement>("[data-export-history]");
  if (!history) return;
  history.replaceChildren(...exports.map((run) => {
    const item = document.createElement("li");
    const heading = document.createElement("strong");
    heading.textContent = `${run.manifest.rows.people.count} person${
      run.manifest.rows.people.count === 1 ? "" : "s"
    }`;
    const details = document.createElement("span");
    details.textContent = `${run.status[0]?.toUpperCase()}${
      run.status.slice(1)
    } · ${new Date(run.createdAt).toLocaleString()}`;
    item.append(heading, details);
    if (run.status === "completed") {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "button-secondary";
      action.textContent = "Prepare download";
      action.addEventListener("click", async () => {
        action.disabled = true;
        announce("Creating a short-lived download…");
        const result = await createExportDownload(run.exportId, workspaceId)
          .catch(() => undefined);
        if (!result?.ok) {
          action.disabled = false;
          announce(
            result?.problem.detail ?? "A download could not be prepared.",
          );
          return;
        }
        const link = document.createElement("a");
        link.className = "button-link";
        link.href = result.value.href;
        link.textContent = "Download export";
        link.setAttribute("download", "");
        action.replaceWith(link);
        announce(
          `Download ready until ${
            new Date(result.value.expiresAt).toLocaleTimeString()
          }.`,
        );
        link.focus();
      });
      item.append(action);
    }
    return item;
  }));
}

export async function mountExports(): Promise<void> {
  const root = element<HTMLElement>("[data-export-settings]");
  const state = element<HTMLElement>("[data-export-state]");
  const create = element<HTMLButtonElement>("[data-export-create]");
  const retry = element<HTMLButtonElement>("[data-export-retry]");
  if (!root || !state || !create) return;
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") {
    state.textContent = "Your session could not be confirmed.";
    return;
  }
  if (session.session.member.role === "member") {
    root.replaceChildren(state);
    state.textContent =
      "Workspace export requires owner or administrator access.";
    return;
  }
  const workspaceId = session.session.workspace.id;
  const announce = (message: string) => {
    state.textContent = message;
  };
  const load = async () => {
    announce("Loading export history…");
    const loaded = await listExports(workspaceId).catch(() => undefined);
    if (!loaded?.ok) {
      announce("Export history could not be loaded.");
      if (retry) retry.hidden = false;
      return;
    }
    if (retry) retry.hidden = true;
    renderHistory(loaded.value.exports, workspaceId, announce);
    announce(
      loaded.value.exports.length === 0
        ? "No exports yet."
        : `${loaded.value.exports.length} export${
          loaded.value.exports.length === 1 ? "" : "s"
        }.`,
    );
  };
  retry?.addEventListener("click", () => void load());
  let creating = false;
  create.addEventListener("click", async () => {
    if (creating) return;
    creating = true;
    create.disabled = true;
    announce("Creating portable export…");
    try {
      const result = await createWorkspaceExport(workspaceId).catch(() =>
        undefined
      );
      if (!result?.ok) {
        announce(
          result?.problem.detail ?? "The export could not be completed.",
        );
        return;
      }
      await load();
      announce(
        `Export completed for ${result.value.manifest.rows.people.count} person${
          result.value.manifest.rows.people.count === 1 ? "" : "s"
        }.`,
      );
    } finally {
      creating = false;
      create.disabled = false;
    }
  });
  await load();
}
