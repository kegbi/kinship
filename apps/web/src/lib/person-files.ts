import {
  listPersonFiles,
  type PersonFile,
  personFileContentUrl,
  removePersonFile,
  uploadPersonFile,
} from "../../../../packages/contracts/generated/auth-client.ts";

interface FileSection {
  readonly add: HTMLButtonElement;
  readonly badge: HTMLElement;
  readonly cancel: HTMLButtonElement;
  readonly form: HTMLFormElement;
  readonly kind: PersonFile["kind"];
  readonly list: HTMLUListElement;
  readonly retry: HTMLButtonElement;
  readonly root: HTMLElement;
  readonly state: HTMLElement;
}

function sections(): readonly FileSection[] {
  return [...document.querySelectorAll<HTMLElement>("[data-person-files]")]
    .flatMap((root) => {
      const kind = root.dataset.personFiles;
      const add = root.querySelector<HTMLButtonElement>("[data-file-add]");
      const badge = root.querySelector<HTMLElement>("[data-file-badge]");
      const cancel = root.querySelector<HTMLButtonElement>(
        "[data-file-cancel]",
      );
      const form = root.querySelector<HTMLFormElement>("[data-file-form]");
      const list = root.querySelector<HTMLUListElement>("[data-file-list]");
      const retry = root.querySelector<HTMLButtonElement>(
        "[data-file-refresh]",
      );
      const state = root.querySelector<HTMLElement>("[data-file-state]");
      return (kind === "document" || kind === "photo") && add && badge &&
          cancel && form && list && retry && state
        ? [{ add, badge, cancel, form, kind, list, retry, root, state }]
        : [];
    });
}

function readableSize(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function render(
  section: FileSection,
  files: readonly PersonFile[],
  archived: boolean,
): void {
  section.list.replaceChildren();
  const visible = files.filter((file) => file.kind === section.kind);
  section.badge.textContent = `${visible.length} saved`;
  section.root.dataset.sectionState = visible.length === 0 ? "empty" : "ready";
  section.add.hidden = archived;
  if (visible.length === 0) {
    section.state.textContent = `No ${
      section.kind === "photo" ? "photos" : "documents"
    } saved.`;
    return;
  }
  section.state.textContent = `${visible.length} ${
    section.kind === "photo" ? "photo" : "document"
  }${visible.length === 1 ? "" : "s"} saved.`;
  for (const file of visible) {
    const item = document.createElement("li");
    item.dataset.fileId = file.fileId;
    item.dataset.fileStatus = file.status;
    const summary = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = file.title;
    const detail = document.createElement("p");
    detail.textContent = `${file.filename} · ${readableSize(file.byteSize)}`;
    const state = document.createElement("span");
    state.className = `state-badge${
      file.status === "available" ? " calm" : ""
    }`;
    state.textContent = file.status === "available"
      ? "Available"
      : file.status === "missing"
      ? "Bytes missing"
      : file.status === "quarantined"
      ? "Quarantined"
      : "Processing";
    summary.append(title, detail, state);
    item.append(summary);
    const actions = document.createElement("div");
    actions.className = "form-actions";
    if (file.status === "available") {
      const open = document.createElement("a");
      open.className = "button-secondary";
      open.href = personFileContentUrl(file.personId, file.fileId);
      open.textContent = "Download";
      actions.append(open);
    }
    if (!archived) {
      const remove = document.createElement("button");
      remove.className = "button-danger";
      remove.dataset.fileRemove = file.fileId;
      remove.type = "button";
      remove.textContent = "Remove";
      actions.append(remove);
    }
    item.append(actions);
    section.list.append(item);
  }
}

export async function mountPersonFiles(options: {
  readonly archived: boolean;
  readonly personId: string;
  readonly workspaceId: string;
}): Promise<void> {
  const mounted = sections();
  if (mounted.length === 0) return;
  let archived = options.archived;
  let files: readonly PersonFile[] = [];
  let mutating = false;

  const announce = (message: string): void => {
    for (const section of mounted) section.state.textContent = message;
  };
  const repaint = (): void => {
    for (const section of mounted) render(section, files, archived);
  };
  const refresh = async (): Promise<boolean> => {
    const result = await listPersonFiles(options.personId, options.workspaceId)
      .catch(() => undefined);
    if (!result?.ok) {
      announce(
        result && !result.ok
          ? result.problem.detail
          : "Files are temporarily unavailable.",
      );
      for (const section of mounted) section.badge.textContent = "Unavailable";
      for (const section of mounted) {
        section.root.dataset.sectionState = "error";
      }
      for (const section of mounted) section.retry.hidden = false;
      return false;
    }
    files = result.value.files;
    for (const section of mounted) section.retry.hidden = true;
    repaint();
    return true;
  };

  for (const section of mounted) {
    section.retry.addEventListener("click", () => void refresh());
    section.add.addEventListener("click", () => {
      if (archived) return;
      section.form.hidden = false;
      section.form.querySelector<HTMLInputElement>('input[name="title"]')
        ?.focus();
    });
    section.cancel.addEventListener("click", () => {
      section.form.reset();
      section.form.hidden = true;
      section.add.focus();
      section.state.textContent = "Upload cancelled. No file was stored.";
    });
    section.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (archived || mutating) return;
      const input = section.form.querySelector<HTMLInputElement>(
        'input[name="file"]',
      );
      const title =
        section.form.querySelector<HTMLInputElement>('input[name="title"]')
          ?.value.trim() ?? "";
      const file = input?.files?.[0];
      if (!file || !title) {
        section.state.textContent = "Choose a file and add a title.";
        return;
      }
      mutating = true;
      section.state.textContent = "Uploading file…";
      const result = await uploadPersonFile(
        options.personId,
        { file, kind: section.kind, title },
        options.workspaceId,
      ).catch(() => undefined);
      mutating = false;
      if (!result?.ok) {
        section.state.textContent = result && !result.ok
          ? result.problem.detail
          : "The file could not be uploaded.";
        return;
      }
      section.form.reset();
      section.form.hidden = true;
      if (!(await refresh())) return;
      section.state.textContent = result.value.file.status === "quarantined"
        ? "File saved in quarantine and cannot be downloaded."
        : "File uploaded.";
    });
    section.list.addEventListener("click", async (event) => {
      const button = (event.target as Element | null)?.closest<
        HTMLButtonElement
      >("[data-file-remove]");
      const fileId = button?.dataset.fileRemove;
      if (!button || !fileId || archived || mutating) return;
      mutating = true;
      button.disabled = true;
      section.state.textContent = "Removing file…";
      const result = await removePersonFile(
        options.personId,
        fileId,
        options.workspaceId,
      ).catch(() => undefined);
      mutating = false;
      if (!result?.ok) {
        button.disabled = false;
        section.state.textContent = result && !result.ok
          ? result.problem.detail
          : "The file could not be removed.";
        return;
      }
      if (!(await refresh())) {
        button.disabled = false;
        return;
      }
      section.state.textContent = "File removed.";
    });
  }

  document.addEventListener("person-lifecycle-changed", (event) => {
    const detail = (event as CustomEvent<{
      readonly archived?: unknown;
      readonly personId?: unknown;
    }>).detail;
    if (
      detail?.personId !== options.personId ||
      typeof detail.archived !== "boolean"
    ) return;
    archived = detail.archived;
    if (archived) {
      for (const section of mounted) {
        section.form.reset();
        section.form.hidden = true;
      }
    }
    repaint();
  });

  await refresh();
}
