import {
  formatInstant,
  loadTimePreferences,
  type TimePreferences,
} from "./time-presentation.ts";
import {
  commitImport,
  createImportDryRun,
  getImportReport,
  type ImportReport,
  type ImportSummary,
  listImports,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { IMPORT_SOURCE_MAX_BYTES } from "../../../../packages/contracts/imports.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";

function element<T extends Element>(selector: string): T | undefined {
  return document.querySelector<T>(selector) ?? undefined;
}
function renderReport(report: ImportReport, status?: string): void {
  const root = element<HTMLElement>("[data-import-report]");
  if (!root) return;
  root.hidden = false;
  const values: Readonly<Record<string, number>> = {
    "[data-import-contacts]": report.counts.contacts,
    "[data-import-missing]": report.counts.missingFiles,
    "[data-import-orphans]": report.counts.orphans,
    "[data-import-credentials]": report.counts.legacyCredentialsDiscarded,
    "[data-import-unsupported]": report.counts.unsupported,
  };
  for (const [selector, value] of Object.entries(values)) {
    const target = element<HTMLElement>(selector);
    if (target) target.textContent = String(value);
  }
  const diagnostics = element<HTMLUListElement>("[data-import-diagnostics]");
  diagnostics?.replaceChildren(...report.diagnostics.map((diagnostic) => {
    const item = document.createElement("li");
    item.dataset.severity = diagnostic.severity;
    item.textContent = diagnostic.message;
    return item;
  }));
  const statusElement = element<HTMLElement>("[data-import-status]");
  if (statusElement && status) statusElement.textContent = status;
}
function renderHistory(
  imports: readonly ImportSummary[],
  timePreferences: TimePreferences | undefined,
): void {
  const history = element<HTMLOListElement>("[data-import-history]");
  if (!history) return;
  history.replaceChildren(...imports.map((run) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `/app/settings/import/${run.importId}`;
    link.textContent = `${run.report.counts.contacts} contact${
      run.report.counts.contacts === 1 ? "" : "s"
    }`;
    const details = document.createElement("span");
    details.textContent = `${
      run.status === "dry_run"
        ? "Dry run"
        : run.status === "completed"
        ? "Completed"
        : "Failed"
    } · ${formatInstant(run.createdAt, timePreferences)}`;
    item.append(link, details);
    return item;
  }));
}

export async function mountImports(): Promise<void> {
  const root = element<HTMLElement>(
    "[data-import-index], [data-import-new], [data-import-report-page]",
  );
  const state = element<HTMLElement>("[data-import-state]");
  if (!root || !state) return;
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") {
    state.textContent = "Your session could not be confirmed.";
    return;
  }
  if (session.session.member.role === "member") {
    root.replaceChildren();
    state.textContent =
      "Workspace import requires owner or administrator access.";
    return;
  }
  const workspaceId = session.session.workspace.id;
  const timePreferences = await loadTimePreferences(workspaceId);
  if (root.hasAttribute("data-import-index")) {
    const load = async () => {
      state.textContent = "Loading import history…";
      const loaded = await listImports(workspaceId).catch(() => undefined);
      const retry = element<HTMLButtonElement>("[data-import-retry]");
      if (!loaded?.ok) {
        state.textContent = "Import history could not be loaded.";
        if (retry) retry.hidden = false;
        return;
      }
      if (retry) retry.hidden = true;
      renderHistory(loaded.value.imports, timePreferences);
      state.textContent = loaded.value.imports.length === 0
        ? "No imports yet."
        : `${loaded.value.imports.length} import${
          loaded.value.imports.length === 1 ? "" : "s"
        }.`;
    };
    element<HTMLButtonElement>("[data-import-retry]")?.addEventListener(
      "click",
      () => void load(),
    );
    await load();
    return;
  }
  if (root.hasAttribute("data-import-report-page")) {
    const importId = location.pathname.match(
      /\/app\/settings\/import\/([0-9a-f-]{36})\/?$/i,
    )?.[1];
    if (!importId) {
      state.textContent = "This import report is unavailable.";
      return;
    }
    const load = async () => {
      const loaded = await getImportReport(importId, workspaceId).catch(() =>
        undefined
      );
      const retry = element<HTMLButtonElement>("[data-import-retry]");
      if (!loaded?.ok) {
        state.textContent = loaded?.problem.status === 404
          ? "This import does not exist in the active workspace."
          : "The import report could not be loaded.";
        if (retry) retry.hidden = false;
        return;
      }
      if (retry) retry.hidden = true;
      renderReport(
        loaded.value.report,
        loaded.value.status === "completed"
          ? "Completed"
          : loaded.value.status === "dry_run"
          ? "Awaiting confirmation"
          : "Failed",
      );
      state.textContent = "Import report is current.";
    };
    element<HTMLButtonElement>("[data-import-retry]")?.addEventListener(
      "click",
      () => void load(),
    );
    await load();
    return;
  }

  const form = element<HTMLFormElement>("[data-import-form]");
  const input = element<HTMLInputElement>(
    "[data-import-form] input[type=file]",
  );
  const detection = element<HTMLElement>("[data-import-detection]");
  const confirmation = element<HTMLInputElement>("[data-import-confirm]");
  const commit = element<HTMLButtonElement>("[data-import-commit]");
  const submit = form?.querySelector<HTMLButtonElement>("button[type=submit]");
  if (!form || !input || !detection || !confirmation || !commit) return;
  let source: unknown;
  let importId: string | undefined;
  let validatingSource: unknown;
  const resetCommitState = () => {
    importId = undefined;
    confirmation.checked = false;
    commit.disabled = true;
    const report = element<HTMLElement>("[data-import-report]");
    if (report) report.hidden = true;
  };
  const detect = async () => {
    source = undefined;
    resetCommitState();
    const file = input.files?.[0];
    if (!file) {
      detection.textContent = "Choose an export to detect its format.";
      return;
    }
    if (file.size > IMPORT_SOURCE_MAX_BYTES) {
      detection.textContent = "This file exceeds the 1.5 MB staging limit.";
      return;
    }
    try {
      const contents = await file.text();
      if (input.files?.[0] !== file) return;
      const parsed = JSON.parse(contents) as {
        format?: unknown;
        version?: unknown;
      };
      if (parsed.format !== "monica-json" || parsed.version !== 1) {
        detection.textContent =
          "Unsupported export. Choose Monica JSON version 1.";
        return;
      }
      source = parsed;
      detection.textContent = "Monica JSON version 1 detected.";
    } catch {
      if (input.files?.[0] !== file) return;
      detection.textContent = "This file is not valid JSON.";
    }
  };
  input.addEventListener("change", () => void detect());
  // A file chosen while the session was resolving fired its change event
  // before this listener existed.
  if (input.files?.length) void detect();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (validatingSource) return;
    if (!source) {
      state.textContent = "Choose a supported Monica JSON export first.";
      return;
    }
    resetCommitState();
    const ownedSource = source;
    validatingSource = ownedSource;
    input.disabled = true;
    if (submit) submit.disabled = true;
    state.textContent = "Validating bounded staging…";
    try {
      const result = await createImportDryRun(ownedSource, workspaceId).catch(
        () => undefined,
      );
      if (source !== ownedSource) {
        state.textContent = "Source changed. Validate the selected export.";
        return;
      }
      if (!result?.ok) {
        state.textContent = result?.problem.detail ??
          "The import could not be validated.";
        return;
      }
      importId = result.value.importId;
      renderReport(result.value.report);
      state.textContent =
        "Dry run complete. Review the report before committing.";
    } finally {
      if (validatingSource === ownedSource) validatingSource = undefined;
      input.disabled = false;
      if (submit) submit.disabled = false;
    }
  });
  confirmation.addEventListener("change", () => {
    commit.disabled = !confirmation.checked || !importId;
  });
  commit.addEventListener("click", async () => {
    if (!confirmation.checked || !importId) return;
    commit.disabled = true;
    state.textContent = "Committing validated import…";
    const result = await commitImport(importId, workspaceId).catch(() =>
      undefined
    );
    if (!result?.ok) {
      state.textContent = result?.problem.detail ??
        "The import could not be committed.";
      commit.disabled = false;
      return;
    }
    const link = document.createElement("a");
    link.className = "button-link secondary-link";
    link.href = `/app/settings/import/${result.value.importId}`;
    link.textContent = "Open import report";
    commit.replaceWith(link);
    state.textContent =
      `Import completed: ${result.value.peopleCreated} created, ${result.value.peopleReused} reused.`;
  });
}
