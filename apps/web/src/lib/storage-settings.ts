import {
  getStorageSettings,
  type StorageFileLookupItem,
  type StorageSettings,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";
import { bindSubmitEarly } from "./early-submit.ts";

function element<T extends Element>(selector: string): T | undefined {
  return document.querySelector<T>(selector) ?? undefined;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)
  } ${unit}`;
}

function renderResult(file: StorageFileLookupItem): HTMLLIElement {
  const item = document.createElement("li");
  const heading = document.createElement("strong");
  heading.textContent = file.title;
  const filename = document.createElement("span");
  filename.textContent = file.filename;
  const details = document.createElement("small");
  details.textContent = `${file.kind} · ${
    formatBytes(file.byteSize)
  } · ${file.status}${file.personName ? ` · ${file.personName}` : ""}`;
  const id = document.createElement("code");
  id.textContent = file.fileId;
  item.append(heading, filename, details, id);
  return item;
}

function renderSummary(value: StorageSettings): void {
  const values: Readonly<Record<string, string>> = {
    "[data-storage-total-files]": String(value.usage.totalFiles),
    "[data-storage-total-bytes]": formatBytes(value.usage.totalBytes),
    "[data-storage-available]": String(value.usage.available),
    "[data-storage-missing]": String(value.usage.missing),
    "[data-storage-processing]": String(value.usage.processing),
    "[data-storage-quarantined]": String(value.usage.quarantined),
    "[data-storage-limit]": formatBytes(value.maximumUploadBytes),
    "[data-storage-provider]": value.provider.name,
    "[data-storage-bucket]": value.provider.bucket,
    "[data-storage-health]": value.provider.health === "available"
      ? "Available"
      : value.provider.health === "not-initialized"
      ? "Not initialized"
      : "Unavailable",
  };
  for (const [selector, text] of Object.entries(values)) {
    const target = element<HTMLElement>(selector);
    if (target) target.textContent = text;
  }
}

function clearInventory(): void {
  for (
    const selector of [
      "[data-storage-total-files]",
      "[data-storage-total-bytes]",
      "[data-storage-available]",
      "[data-storage-missing]",
      "[data-storage-processing]",
      "[data-storage-quarantined]",
      "[data-storage-limit]",
      "[data-storage-provider]",
      "[data-storage-bucket]",
      "[data-storage-health]",
    ]
  ) {
    const target = element<HTMLElement>(selector);
    if (target) target.textContent = "";
  }
  element<HTMLUListElement>("[data-storage-results]")?.replaceChildren();
}

export async function mountStorageSettings(): Promise<void> {
  const root = element<HTMLElement>("[data-storage-settings]");
  const state = element<HTMLElement>("[data-storage-state]");
  const form = element<HTMLFormElement>("[data-storage-search]");
  const searchState = element<HTMLElement>("[data-storage-search-state]");
  const results = element<HTMLUListElement>("[data-storage-results]");
  const retry = element<HTMLButtonElement>("[data-storage-retry]");
  if (!root || !state || !form || !searchState || !results || !retry) return;
  const submission = bindSubmitEarly(form);

  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") {
    state.textContent = "Your session could not be confirmed.";
    retry.hidden = false;
    retry.addEventListener("click", () => void mountStorageSettings(), {
      once: true,
    });
    return;
  }
  if (session.session.member.role === "member") {
    clearInventory();
    form.remove();
    state.textContent =
      "Storage diagnostics require workspace owner or administrator access.";
    return;
  }

  let generation = 0;
  let lastQuery: string | undefined;
  const load = async (query?: string): Promise<void> => {
    const current = ++generation;
    lastQuery = query;
    state.textContent = query
      ? "Searching workspace file metadata…"
      : "Loading workspace storage diagnostics…";
    retry.hidden = true;
    const loaded = await getStorageSettings(query, session.session.workspace.id)
      .catch(() => undefined);
    if (current !== generation) return;
    if (!loaded?.ok) {
      if (loaded && !loaded.ok && loaded.problem.status === 403) {
        clearInventory();
        form.remove();
        state.textContent =
          "Storage diagnostics require workspace owner or administrator access.";
        return;
      }
      state.textContent = query
        ? "File metadata search could not be completed. Existing usage remains visible."
        : "Workspace storage diagnostics could not be loaded.";
      retry.hidden = false;
      return;
    }
    renderSummary(loaded.value);
    results.replaceChildren(...loaded.value.files.map(renderResult));
    searchState.textContent = query
      ? loaded.value.files.length === 0
        ? "No files match this workspace lookup."
        : `${loaded.value.files.length} matching file${
          loaded.value.files.length === 1 ? "" : "s"
        }. Results are limited to 20.`
      : "Search by file ID, filename, title, or person name.";
    state.textContent = loaded.value.provider.health === "available"
      ? "Storage diagnostics are current."
      : "Metadata is current, but the configured provider is unavailable.";
  };

  retry.addEventListener("click", () => void load(lastQuery));
  await load();
  // Handled after the first load so a lookup submitted while it ran is not
  // superseded by it.
  submission.handle(() => {
    const query = new FormData(form).get("query")?.toString().trim();
    if (!query) {
      searchState.textContent =
        "Enter a file ID, filename, title, or person name.";
      return;
    }
    void load(query);
  });
}
